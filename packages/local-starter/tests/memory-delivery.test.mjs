import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initStarter, inspectStarter, renderStarter, writeMemory, writeHandoff } from '../src/core.mjs';
import { createDelivery } from '../src/delivery.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), "local delivery's $literal "));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'records');
  initStarter(root);
  return { parent, root };
}
const digest = (root, id) => inspectStarter(root).sources.find(s => s.id === id).sha256;
const bytes = root => Object.fromEntries(readdirSync(root).map(name => [name, readFileSync(join(root, name))]));
function invoke(args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return result;
}

test('memory replacement preserves other records and stays disabled until deliberately selected', t => {
  const { root } = fixture(t);
  const before = bytes(root), expected = digest(root, 'memory');
  const text = '2026-09-28: the fixture uses a blue lantern. Source: operator.\r\n';
  const receipt = writeMemory(root, text, expected);
  assert.equal(receipt.source, 'memory');
  assert.equal(receipt.bytes, Buffer.byteLength(text));
  assert.equal(receipt.sha256, digest(root, 'memory'));
  assert.equal(receipt.previous_sha256, expected);
  assert.equal(readFileSync(join(root, 'memories.md'), 'utf8'), text);
  for (const [name, content] of Object.entries(before)) {
    if (name !== 'memories.md') assert.deepEqual(readFileSync(join(root, name)), content);
  }
  assert.ok(!JSON.stringify(renderStarter(root)).includes('blue lantern'));
  const manifest = JSON.parse(before['manifest.json']);
  manifest.sources.find(s => s.id === 'memory').enabled = true;
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(renderStarter(root).sources.find(s => s.id === 'memory').content, text);
  assert.throws(() => writeMemory(root, 'stale overwrite', expected), { code: 'write_conflict' });
  assert.equal(readFileSync(join(root, 'memories.md'), 'utf8'), text);
  writeMemory(root, '', receipt.sha256);
  assert.equal(readFileSync(join(root, 'memories.md')).length, 0);
});

test('memory shares write safety while retaining an independent lock and fixed target', t => {
  const { root } = fixture(t);
  const expected = digest(root, 'memory');
  for (const value of ['愛'.repeat(1400), 'bad\u0000text', '\ud800']) {
    assert.throws(() => writeMemory(root, value, expected), { code: 'invalid_memory' });
  }
  assert.equal(readFileSync(join(root, 'memories.md')).length, 0);
  writeFileSync(join(root, '.memory.lock'), '', { mode: 0o600 });
  assert.throws(() => writeMemory(root, 'locked', expected), { code: 'write_locked' });
  writeHandoff(root, 'Handoff proceeds independently.', digest(root, 'handoff'));
  assert.equal(readFileSync(join(root, '.memory.lock')).length, 0);
});

test('memory CLI uses bounded UTF-8 stdin and rejects unknown targets and stale hashes', t => {
  const { root } = fixture(t);
  const expected = digest(root, 'memory');
  const content = '\ufeff記錄\r\n';
  const result = invoke(['memory', '--dir', root, '--expect', expected], content);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).source, 'memory');
  assert.equal(readFileSync(join(root, 'memories.md'), 'utf8'), content);
  for (const args of [
    ['memory', '--dir', root, '--expect', expected],
    ['memory', '--dir', root, '--expect', digest(root, 'memory'), '--path', 'identity.md'],
  ]) {
    const failure = invoke(args, 'private failed replacement');
    assert.notEqual(failure.status, 0);
    assert.equal(failure.stdout, '');
    assert.ok(!failure.stderr.includes('private failed replacement'));
    assert.equal(readFileSync(join(root, 'memories.md'), 'utf8'), content);
  }
});

test('delivery plans contain matching explicit bindings and do not install files', t => {
  const { parent, root } = fixture(t);
  const before = bytes(root);
  for (const harness of ['codex', 'claude-code']) {
    const output = invoke(['delivery', '--dir', root, '--harness', harness]);
    assert.equal(output.status, 0, output.stderr);
    const plan = JSON.parse(output.stdout);
    assert.equal(plan.installed, false);
    assert.equal(plan.host_delivery, 'unverified');
    assert.equal(plan.write_mode, 'none');
    const binding = JSON.parse(plan.files.find(f => f.path.endsWith('/binding.json')).content);
    assert.equal(binding.directory, root);
    assert.deepEqual(binding.writes, {});
    const rendered = spawnSync(binding.read[0], binding.read.slice(1), { encoding: 'utf8', timeout: 10000 });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(JSON.parse(rendered.stdout).format, 'agenttool-local-context/v1');
    assert.ok(plan.files.find(f => f.path.endsWith('/SKILL.md')).content.startsWith('---\nname: agenttool-local-context\n'));
    if (harness === 'claude-code') {
      const mcp = JSON.parse(plan.files.find(f => f.path === '.mcp.json').content).mcpServers.agenttool_local;
      assert.equal(mcp.command, process.execPath);
      assert.deepEqual(mcp.args.slice(1), ['--dir', root, '--write', 'none']);
    }
  }
  assert.deepEqual(bytes(root), before);
  assert.deepEqual(readdirSync(parent), ['records']);
});

test('explicit CLI delivery requires no MCP configuration and binds only selected saves', t => {
  const { root } = fixture(t);
  const result = invoke(['delivery', '--dir', root, '--harness', 'claude-code', '--transport', 'cli', '--write', 'handoff']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.ok(!plan.files.some(f => f.path === '.mcp.json'));
  const binding = JSON.parse(plan.files.find(f => f.path.endsWith('/binding.json')).content);
  assert.equal(binding.transport, 'cli');
  assert.deepEqual(Object.keys(binding.writes), ['handoff']);
  assert.notEqual(invoke(['delivery', '--dir', root, '--harness', 'codex', '--transport', 'http']).status, 0);
});

test('delivery write selection is closed and Windows Codex falls back without losing MCP or skill', () => {
  const plan = createDelivery({ harness: 'codex', dir: "C:\\notes\\private", platform: 'win32',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe', cliPath: 'C:\\code\\cli.mjs',
    mcpPath: 'C:\\code\\mcp.mjs', write: 'memory' });
  assert.equal(plan.hook.reason, 'UNSUPPORTED_HOOK_PLATFORM');
  assert.equal(plan.files.length, 3);
  const binding = JSON.parse(plan.files.find(f => f.path.endsWith('/binding.json')).content);
  assert.deepEqual(Object.keys(binding.writes), ['memory']);
  assert.ok(plan.files.find(f => f.path === '.codex/config.toml').content.includes('C:\\\\Program Files'));
  assert.throws(() => createDelivery({ harness: 'codex', dir: '/tmp/a', write: 'all' }), { code: 'INVALID_WRITE_MODE' });
  assert.throws(() => createDelivery({ harness: 'cursor', dir: '/tmp/a' }), { code: 'INVALID_HARNESS' });
  assert.throws(() => createDelivery({ harness: 'codex', dir: '/tmp/a', nodePath: 'bad\npath' }), { code: 'INVALID_PATH' });
});
