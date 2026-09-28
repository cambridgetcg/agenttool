import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initStarter, inspectStarter } from '../../local-starter/src/core.mjs';
import { buildLocalContextMcpServer, LocalContextStdioTransport, MAX_WIRE_BYTES } from '../src/server.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const temporary = fs.mkdtempSync(path.join(tmpdir(), 'local-context-mcp-'));
const CANARY = 'PRIVATE_ARGUMENT_OR_NOTE_DO_NOT_REFLECT';
let nextFixture = 0;
after(() => fs.rmSync(temporary, { recursive: true, force: true }));

function fixture() {
  const dir = path.join(temporary, String(++nextFixture));
  initStarter(dir);
  return dir;
}
function body(dir, name) { return fs.readFileSync(path.join(dir, name), 'utf8'); }
function snapshot(dir) {
  return Object.fromEntries(fs.readdirSync(dir).sort().map((name) => [name, body(dir, name)]));
}
function hash(dir, id) { return inspectStarter(dir).sources.find((source) => source.id === id).sha256; }
function editManifest(dir, operation) {
  const manifest = JSON.parse(body(dir, 'manifest.json'));
  operation(manifest);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
}

class Peer {
  serial = 0;
  pending = new Map();
  buffer = '';
  raw = '';
  frames = [];
  invalidFrames = [];
  unsolicited = [];
  constructor(input, output) {
    this.input = input;
    output.on('data', (chunk) => {
      this.raw += chunk.toString('utf8');
      this.buffer += chunk.toString('utf8');
      while (this.buffer.includes('\n')) {
        const index = this.buffer.indexOf('\n');
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        this.frames.push(line + '\n');
        let response;
        try { response = JSON.parse(line); }
        catch { this.invalidFrames.push(line); continue; }
        const pending = this.pending.get(response.id);
        if (!pending) { this.unsolicited.push(response); continue; }
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        pending.resolve(response);
      }
    });
  }
  request(method, params = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('RPC deadline')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async initialize() {
    const response = await this.request('initialize', {
      protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'disposable-local-context-test', version: '1.0.0' },
    });
    this.input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return response;
  }
  call(name, args = {}) { return this.request('tools/call', { name, arguments: args }); }
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RPC closed'));
    }
    this.pending.clear();
  }
}

function start(args, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, cli, ...args], {
    env: { PATH: process.env.PATH ?? '' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { child, ended, stderr: () => stderr, peer: new Peer(child.stdin, child.stdout) };
}
async function withServer(dir, write, operation) {
  const processHandle = start(['--dir', dir, ...(write ? ['--write', write] : [])]);
  try {
    const initialized = await processHandle.peer.initialize();
    assert.deepEqual(initialized.result.capabilities, { tools: { listChanged: false } });
    await operation(processHandle.peer, initialized, processHandle);
    assert.equal(processHandle.stderr(), '');
    assert.deepEqual(processHandle.peer.invalidFrames, []);
    for (const frame of processHandle.peer.frames) assert.ok(Buffer.byteLength(frame) <= MAX_WIRE_BYTES);
  } finally {
    processHandle.peer.close();
    processHandle.child.stdin.end();
    processHandle.child.kill('SIGTERM');
    await processHandle.ended;
  }
}
function result(response) {
  assert.equal(response.error, undefined);
  assert.notEqual(response.result.isError, true);
  assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
  return response.result.structuredContent;
}
function refused(response) {
  assert.ok(response.error || response.result?.isError);
  assert.ok(!JSON.stringify(response).includes(CANARY));
}

test('native Node initialization/list has no note effects, network capability or automatic read', async () => {
  const dir = fixture();
  const before = snapshot(dir);
  await withServer(dir, undefined, async (peer, initialized) => {
    assert.match(initialized.result.instructions, /tool data/);
    const listed = await peer.request('tools/list');
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['local_context_status', 'local_context_read']);
    for (const tool of listed.result.tools) {
      assert.deepEqual(tool.inputSchema.properties, {});
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.annotations.openWorldHint, false);
    }
    assert.deepEqual(snapshot(dir), before);
    assert.deepEqual(peer.unsolicited, []);
  });
  const missing = path.join(temporary, 'never-created');
  await withServer(missing, undefined, async (peer) => {
    assert.ok((await peer.request('tools/list')).result.tools.length === 2);
    refused(await peer.call('local_context_read'));
    assert.equal(fs.existsSync(missing), false);
  });
});

test('native reads are fresh, disabled bodies are absent, status returns only metadata', async () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'identity.md'), CANARY);
  await withServer(dir, undefined, async (peer) => {
    const status = result(await peer.call('local_context_status'));
    assert.deepEqual(status, inspectStarter(dir));
    assert.ok(status.sources.every((source) => !('content' in source)));
    const before = result(await peer.call('local_context_read'));
    assert.equal(before.sources.find((source) => source.id === 'identity').status, 'disabled');
    fs.writeFileSync(path.join(dir, 'orientation.md'), 'Changed orientation after MCP startup.');
    const afterRead = result(await peer.call('local_context_read'));
    assert.equal(afterRead.sources.find((source) => source.id === 'orientation').content, 'Changed orientation after MCP startup.');
    assert.ok(!peer.raw.includes(CANARY));
  });
});

for (const mode of ['none', 'handoff', 'memory', 'both']) {
  test(`native ${mode} mode advertises and dispatches only explicitly selected writes`, async () => {
    const dir = fixture();
    await withServer(dir, mode, async (peer) => {
      const sources = ['handoff', 'memory'].filter((source) => mode === source || mode === 'both');
      const listed = (await peer.request('tools/list')).result.tools;
      assert.deepEqual(listed.map((tool) => tool.name), ['local_context_status', 'local_context_read', ...sources.map((source) => `local_${source}_save`)]);
      for (const source of ['handoff', 'memory']) {
        const previous = snapshot(dir);
        const expected = hash(dir, source);
        const text = `Chosen ${source} retained record.`;
        const saved = await peer.call(`local_${source}_save`, { text, expected_sha256: expected });
        if (!sources.includes(source)) {
          refused(saved);
          assert.deepEqual(snapshot(dir), previous);
          continue;
        }
        const annotation = listed.find((tool) => tool.name === `local_${source}_save`).annotations;
        assert.deepEqual(annotation, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
        const receipt = result(saved);
        assert.equal(receipt.source, source);
        assert.equal(receipt.previous_sha256, expected);
        assert.equal(receipt.sha256, hash(dir, source));
        const filename = source === 'memory' ? 'memories.md' : 'handoff.md';
        assert.ok(listed.find((tool) => tool.name === `local_${source}_save`).description.includes(filename));
        assert.equal(body(dir, filename), text);
        const afterSave = snapshot(dir);
        assert.deepEqual(afterSave, { ...previous, [filename]: text });
        const conflict = await peer.call(`local_${source}_save`, { text: CANARY, expected_sha256: expected });
        refused(conflict);
        assert.deepEqual(conflict.result.structuredContent, { format: 'agenttool-local-error/v1', code: 'write_conflict' });
        assert.match(conflict.result.content[0].text, /write_conflict/);
        assert.deepEqual(snapshot(dir), afterSave);
        if (source === 'memory') {
          const read = result(await peer.call('local_context_read'));
          assert.equal(read.sources.find((item) => item.id === 'memory').status, 'disabled');
          assert.equal(inspectStarter(dir).sources.find((item) => item.id === 'memory').enabled, false);
        }
      }
    });
  });
}

test('native strict schemas and opaque protocol errors do not expose private input', async () => {
  const dir = fixture();
  const before = snapshot(dir);
  await withServer(dir, 'both', async (peer) => {
    for (const name of ['local_context_status', 'local_context_read']) {
      for (const args of [{ [CANARY]: true }, { dir: CANARY }, { url: CANARY }, null, [], CANARY, 0])
        refused(await peer.call(name, args));
    }
    for (const args of [
      { text: CANARY }, { text: CANARY, expected_sha256: 'invalid' },
      { text: CANARY, expected_sha256: hash(dir, 'handoff'), dir: CANARY },
      { text: CANARY + '\u0000', expected_sha256: hash(dir, 'handoff') },
      { text: '\ud800', expected_sha256: hash(dir, 'handoff') },
      { text: '界'.repeat(6000), expected_sha256: hash(dir, 'handoff') },
      { text: 'x'.repeat(16385), expected_sha256: hash(dir, 'handoff') },
    ]) refused(await peer.call('local_handoff_save', args));
    for (const method of ['resources/list', 'prompts/list', 'resources/templates/list', 'sampling/createMessage', CANARY])
      refused(await peer.request(method));
    refused(await peer.call(CANARY));
    peer.input.write(`{"jsonrpc":"2.0","id":900,"method":"${CANARY}",invalid}\n`);
    result(await peer.call('local_context_status'));
    assert.ok(!peer.raw.includes(CANARY));
    assert.deepEqual(peer.unsolicited, []);
    assert.deepEqual(snapshot(dir), before);
  });
});

test('native stale, oversized and unsafe bodies remain omitted without mutation', async () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'orientation.md'), CANARY + 'x'.repeat(17000));
  fs.writeFileSync(path.join(dir, 'handoff.md'), CANARY);
  fs.utimesSync(path.join(dir, 'handoff.md'), new Date(0), new Date(0));
  fs.linkSync(path.join(dir, 'foundations.md'), path.join(temporary, `extra-link-${nextFixture}`));
  await withServer(dir, undefined, async (peer) => {
    const read = result(await peer.call('local_context_read'));
    assert.equal(read.sources.find((source) => source.id === 'orientation').status, 'too_large');
    assert.equal(read.sources.find((source) => source.id === 'handoff').status, 'stale');
    assert.equal(read.sources.find((source) => source.id === 'foundations').status, 'unsafe_file');
    assert.ok(!peer.raw.includes(CANARY));
  });
});

test('native failed response after rename reports uncertainty without replay or private exception text', async () => {
  const dir = fixture();
  const preloader = path.join(temporary, 'rename-after-effect.mjs');
  fs.writeFileSync(preloader, `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.renameSync;
    fs.renameSync = (...args) => {
      const value = original(...args);
      if (args[1] === ${JSON.stringify(path.join(fs.realpathSync(dir), 'handoff.md'))}) {
        fs.renameSync = original;
        syncBuiltinESMExports();
        throw new Error(${JSON.stringify(CANARY)});
      }
      return value;
    };
    syncBuiltinESMExports();
  `, { mode: 0o600 });
  const before = snapshot(dir);
  const expected = hash(dir, 'handoff');
  const processHandle = start(['--dir', dir, '--write', 'handoff'], ['--import', pathToFileURL(preloader).href]);
  try {
    await processHandle.peer.initialize();
    const saved = await processHandle.peer.call('local_handoff_save', { text: 'Chosen text applied once.', expected_sha256: expected });
    refused(saved);
    assert.deepEqual(saved.result.structuredContent, { format: 'agenttool-local-error/v1', code: 'write_uncertain' });
    assert.match(saved.result.content[0].text, /write_uncertain/);
    assert.deepEqual(snapshot(dir), { ...before, 'handoff.md': 'Chosen text applied once.' });
    const observed = result(await processHandle.peer.call('local_context_status'));
    assert.notEqual(observed.sources.find((source) => source.id === 'handoff').sha256, expected);
    assert.ok(!processHandle.peer.raw.includes(CANARY));
    assert.equal(processHandle.stderr(), '');
  } finally {
    processHandle.peer.close();
    processHandle.child.stdin.end();
    processHandle.child.kill('SIGTERM');
    await processHandle.ended;
  }
});

test('native CLI malformed options are opaque, help requires no context directory', async () => {
  const help = start(['--help']);
  assert.equal(await help.ended, 0);
  assert.match(help.peer.raw, /Usage:/);
  assert.equal(help.stderr(), '');
  for (const args of [[], ['--dir', 'relative'], ['--dir', '/' + CANARY, '--write', CANARY],
    ['--dir', '/one', '--dir', '/two'], ['--dir', '/one', '--write', 'none', '--write', 'both'],
    ['--dir', '/one', '--token', CANARY], ['--help', CANARY]]) {
    const processHandle = start(args);
    assert.equal(await processHandle.ended, 1);
    assert.equal(processHandle.peer.raw, '');
    assert.equal(processHandle.stderr(), 'Local context MCP could not start or continue.\n');
  }
});

test('SDK closes oversized partial input before any save or error reflection', async () => {
  const dir = fixture();
  const before = snapshot(dir);
  const input = new PassThrough();
  const output = new PassThrough();
  const peer = new Peer(input, output);
  const server = buildLocalContextMcpServer({ dir, write: 'both' });
  let closed = false;
  server.server.onerror = () => undefined;
  server.server.onclose = () => { closed = true; };
  await server.connect(new LocalContextStdioTransport(input, output));
  try {
    await peer.initialize();
    input.write('{"jsonrpc":"2.0","id":50,"method":"tools/call","params":{"name":"local_handoff_save","arguments":{"text":"' + CANARY);
    assert.equal(closed, false);
    input.write('x'.repeat(MAX_WIRE_BYTES));
    await Promise.resolve();
    assert.equal(closed, true);
    assert.equal(input.listenerCount('data'), 0);
    assert.deepEqual(snapshot(dir), before);
    assert.ok(!peer.raw.includes(CANARY));
  } finally { peer.close(); await server.close(); input.destroy(); output.destroy(); }
});

test('native oversized partial request closes without saving or exposing its body', async () => {
  const dir = fixture();
  const before = snapshot(dir);
  const processHandle = start(['--dir', dir, '--write', 'both']);
  let timer;
  try {
    await processHandle.peer.initialize();
    processHandle.child.stdin.write('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"local_memory_save","arguments":{"text":"' + CANARY);
    processHandle.child.stdin.write('x'.repeat(MAX_WIRE_BYTES));
    await Promise.race([
      processHandle.ended,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close deadline')), 5000); }),
    ]);
    assert.deepEqual(snapshot(dir), before);
    assert.ok(!processHandle.peer.raw.includes(CANARY));
    assert.equal(processHandle.stderr(), '');
  } finally {
    clearTimeout(timer);
    processHandle.peer.close();
    processHandle.child.kill('SIGTERM');
    await processHandle.ended;
  }
});

test('whole escaped MCP responses are capped and rejected rather than truncated', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new LocalContextStdioTransport(input, output);
  let raw = '';
  output.on('data', (chunk) => { raw += chunk.toString(); });
  try {
    const value = '\\'.repeat(MAX_WIRE_BYTES / 2);
    await transport.send({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: CANARY + value }] } });
    assert.ok(Buffer.byteLength(raw) <= MAX_WIRE_BYTES);
    assert.equal(JSON.parse(raw).error.code, -32603);
    assert.ok(!raw.includes(CANARY));
  } finally { await transport.close(); input.destroy(); output.destroy(); }
});

test('transport preserves only closed failure codes and reconstructs all failure text', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new LocalContextStdioTransport(input, output);
  let raw = '';
  output.on('data', (chunk) => { raw += chunk.toString(); });
  try {
    for (const [id, structuredContent] of [
      [1, { format: 'agenttool-local-error/v1', code: 'write_conflict' }],
      [2, { format: 'agenttool-local-error/v1', code: CANARY }],
      [3, { format: 'agenttool-local-error/v1', code: 'write_uncertain', detail: CANARY }],
      [4, undefined],
    ]) await transport.send({ jsonrpc: '2.0', id, result: {
      isError: true, content: [{ type: 'text', text: CANARY }], structuredContent,
    } });
    assert.deepEqual(raw.trim().split('\n').map((line) => JSON.parse(line).result.structuredContent.code),
      ['write_conflict', 'request_failed', 'request_failed', 'request_failed']);
    assert.ok(!raw.includes(CANARY));
  } finally { await transport.close(); input.destroy(); output.destroy(); }
});

test('native maximum selected content still fits complete encoded responses', async () => {
  const dir = fixture();
  editManifest(dir, (manifest) => {
    manifest.context_budget_bytes = 16384;
    for (const source of manifest.sources) {
      source.enabled = source.id === 'handoff';
      if (source.id === 'handoff') source.max_bytes = 16384;
    }
  });
  fs.writeFileSync(path.join(dir, 'handoff.md'), '\\'.repeat(16384));
  await withServer(dir, undefined, async (peer) => {
    const read = result(await peer.call('local_context_read'));
    assert.equal(read.used_bytes, 16384);
    assert.equal(read.sources.find((source) => source.id === 'handoff').content.length, 16384);
  });
});

test('native expanded 32 KiB manifest may exceed wire cap and refuses without partial note output', async () => {
  const dir = fixture();
  editManifest(dir, (manifest) => {
    manifest.context_budget_bytes = 32768;
    for (const source of manifest.sources) {
      source.enabled = ['handoff', 'orientation'].includes(source.id);
      source.max_bytes = 16384;
    }
  });
  for (const name of ['handoff.md', 'orientation.md'])
    fs.writeFileSync(path.join(dir, name), CANARY + '\\'.repeat(16384 - CANARY.length));
  await withServer(dir, undefined, async (peer) => {
    refused(await peer.call('local_context_read'));
    assert.ok(!peer.raw.includes(CANARY));
    const status = result(await peer.call('local_context_status'));
    assert.equal(status.budget_bytes, 32768);
  });
});
