#!/usr/bin/env node
// Test only the public file surface, copied outside the repository. An optional
// argument supplies a previously extracted archive instead of the build tree.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const input = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url));
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'local-starter-artifact-')));
const installed = path.join(scratch, 'plugin-cache', 'preview');
const manifest = JSON.parse(fs.readFileSync(path.join(input, 'package.json')));
const surface = ['dist', 'skills', '.codex-plugin', '.claude-plugin', 'plugin.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE'];
const snapshot = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')]));
function scan(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Archive contains a link');
    assert.ok(!['node_modules', 'src', 'binding.json'].includes(entry.name), 'Unexpected release entry');
    if (entry.isDirectory()) scan(file);
    else {
      assert.ok(entry.isFile());
      assert.ok(!entry.name.endsWith('.map'));
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!text.includes('/Users/') && !text.includes('/home/runner/work/'), 'Private build path');
    }
  }
}
const env = { PATH: path.dirname(process.execPath) };
let cli;
function invoke(args, inputText) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: scratch, env, input: inputText, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}
async function mcp(args, check) {
  const child = spawn(process.execPath, [path.join(installed, 'dist/agenttool-local-starter-mcp.js'), ...args], { cwd: scratch, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', id = 0;
  const pending = new Map();
  const ended = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), frame = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const request = pending.get(frame.id);
      assert.ok(request, 'Unsolicited MCP frame');
      clearTimeout(request.timer); pending.delete(frame.id); request.resolve(frame);
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error('MCP timeout')), 10000);
    pending.set(requestId, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
  });
  try {
    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'artifact-test', version: '1.0.0' } });
    assert.equal(initialized.result.serverInfo.version, manifest.version);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await check(rpc);
    assert.equal(stderr, '');
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    child.stdin.end(); child.kill('SIGTERM'); await ended;
  }
}

try {
  assert.equal(manifest.name, '@agenttool/local-starter');
  assert.notEqual(manifest.private, true);
  assert.deepEqual(manifest.files, surface);
  assert.equal(manifest.dependencies, undefined);
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) assert.equal(manifest.scripts?.[lifecycle], undefined);
  fs.mkdirSync(installed, { recursive: true });
  for (const name of [...surface, 'package.json']) fs.cpSync(path.join(input, name), path.join(installed, name), { recursive: true, dereference: false });
  scan(installed);
  cli = path.join(installed, manifest.bin['agenttool-local-starter']);
  for (const name of ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    const plugin = JSON.parse(fs.readFileSync(path.join(installed, name)));
    assert.equal(plugin.name, 'agenttool-local-starter');
    assert.equal(plugin.version, manifest.version);
    for (const capability of ['mcpServers', 'mcp', 'hooks', 'commands']) assert.equal(plugin[capability], undefined);
  }
  const skillDir = path.join(installed, 'skills/agenttool-local-context');
  assert.equal(path.resolve(skillDir, '../../dist/cli.mjs'), cli);
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /Installing this plugin exposes the skill only/);
  assert.ok(!fs.existsSync(path.join(skillDir, 'binding.json')));
  const root = path.join(scratch, 'chosen-notes');
  invoke(['init', '--dir', root]);
  const initial = snapshot(root);
  const status = invoke(['status', '--dir', root]);
  assert.equal(status.sources.length, 7);
  assert.equal(invoke(['render', '--dir', root, '--format', 'json']).format, 'agenttool-local-context/v1');
  for (const harness of ['codex', 'claude-code']) {
    const plan = invoke(['delivery', '--dir', root, '--harness', harness]);
    assert.equal(plan.installed, false);
    const binding = JSON.parse(plan.files.find(file => file.path.endsWith('/binding.json')).content);
    assert.equal(binding.directory, root);
    assert.equal(binding.read[1], cli);
    assert.deepEqual(binding.writes, {});
    const config = plan.files.find(file => file.path === (harness === 'codex' ? '.codex/config.toml' : '.mcp.json'));
    assert.ok(config.content.includes('agenttool-local-starter-mcp.js'));
    assert.ok(!config.content.includes('local-starter-mcp/src'));
    if (harness === 'claude-code') assert.equal(JSON.parse(config.content).mcpServers.agenttool_local.args[0], path.join(installed, 'dist/agenttool-local-starter-mcp.js'));
    assert.equal(invoke(['hook', '--dir', root, '--harness', harness]).hookSpecificOutput.hookEventName, 'SessionStart');
  }
  assert.deepEqual(snapshot(root), initial);
  await mcp(['--dir', root], async rpc => {
    const listed = await rpc('tools/list');
    assert.deepEqual(listed.result.tools.map(tool => tool.name), ['local_context_status', 'local_context_read']);
    assert.deepEqual(snapshot(root), initial);
    const read = await rpc('tools/call', { name: 'local_context_read', arguments: {} });
    assert.equal(read.result.structuredContent.format, 'agenttool-local-context/v1');
    const refused = await rpc('tools/call', { name: 'local_memory_save', arguments: {} });
    assert.ok(refused.error || refused.result.isError);
  });
  const handoffHash = status.sources.find(source => source.id === 'handoff').sha256;
  invoke(['handoff', '--dir', root, '--expect', handoffHash], 'Chosen next step: inspect the lantern.');
  await mcp(['--dir', root, '--write', 'memory'], async rpc => {
    const current = (await rpc('tools/call', { name: 'local_context_status', arguments: {} })).result.structuredContent;
    const expected = current.sources.find(source => source.id === 'memory').sha256;
    const saved = await rpc('tools/call', { name: 'local_memory_save', arguments: { text: 'Fixture decision retained explicitly.', expected_sha256: expected } });
    assert.equal(saved.result.structuredContent.source, 'memory');
    const read = (await rpc('tools/call', { name: 'local_context_read', arguments: {} })).result.structuredContent;
    assert.equal(read.sources.find(source => source.id === 'memory').status, 'disabled');
    const conflict = await rpc('tools/call', { name: 'local_memory_save', arguments: { text: 'Stale replacement', expected_sha256: expected } });
    assert.equal(conflict.result.structuredContent.code, 'write_conflict');
  });
  const retained = snapshot(root);
  const moved = path.join(scratch, 'plugin-cache', 'upgraded');
  fs.renameSync(installed, moved);
  cli = path.join(moved, 'dist/cli.mjs');
  const regenerated = invoke(['delivery', '--dir', root, '--harness', 'claude-code']);
  assert.equal(JSON.parse(regenerated.files.find(file => file.path === '.mcp.json').content).mcpServers.agenttool_local.args[0], path.join(moved, 'dist/agenttool-local-starter-mcp.js'));
  assert.deepEqual(snapshot(root), retained);
  fs.rmSync(moved, { recursive: true });
  assert.deepEqual(snapshot(root), retained);
  console.log(`Local Starter artifact checks passed on ${process.platform}/${process.arch}, Node ${process.versions.node}; isolated CLI, MCP, skill, config paths and cache removal.`);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
