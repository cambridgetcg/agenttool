import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initStarter, renderStarter } from '../src/core.mjs';
import { ConnectionError, readHostedContext, renderConnectedContext, formatConnectedMarkdown } from '../src/connect.mjs';

const PROJECT = '11111111-2222-4333-8444-555555555555';
const IDENTITY = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const ORIGIN = 'https://api.example.test';
const NOW = Date.parse('2026-09-27T20:00:00.000Z');
const SECRET = 'fixture-bearer-must-never-be-emitted';
const CLI = fileURLToPath(new URL('../src/connect.mjs', import.meta.url));
const CORE_CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const hash = input => createHash('sha256').update(input).digest('hex');
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const record = (index, content = 'Selected hosted memory') => ({ id: id(index), created_at: new Date(NOW - 60000).toISOString(), expires_at: null, content_bytes: Buffer.byteLength(content), sha256: hash(content), content });
function envelope(records = [record(1)]) {
  return { format: 'agenttool-local-api-context/v1', project_id: PROJECT, identity_id: IDENTITY, generated_at: new Date(NOW).toISOString(), scope: { authentication: 'project_bearer', selection: 'identity_partition', identity_proven: false, bearer_attenuated: false, project_shared_included: false }, bounds: { max_items: 8, max_candidates: 32, max_record_bytes: 4096, max_content_bytes: 8192, max_response_bytes: 32768 }, used_content_bytes: records.reduce((sum, item) => sum + item.content_bytes, 0), records, omissions: [], has_more: false };
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const options = transport => ({ origin: ORIGIN, projectId: PROJECT, identityId: IDENTITY, now: () => NOW, transport });
const code = expected => error => error instanceof ConnectionError && error.code === expected && !String(error).includes(SECRET);
function fixture(t) {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'local-connect-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'notes');
  initStarter(dir);
  return dir;
}
function snapshot(dir) { return Object.fromEntries(readdirSync(dir).map(name => [name, hash(readFileSync(path.join(dir, name)))])); }

test('injected broker-compatible transport receives one pinned GET with no bearer or ambient fetch', async () => {
  const calls = [];
  const supplied = envelope([record(1, '雨夜\r\n\ufeff記錄')]);
  const raw = JSON.stringify(supplied);
  const result = await readHostedContext(options({ request: async (url, init) => { calls.push({ url, init }); return json(supplied); } }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${ORIGIN}/v1/identities/${IDENTITY}/local-context`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
  assert.equal(result.response_sha256, hash(raw));
  assert.equal(result.origin, ORIGIN);
  assert.equal(result.projection.records[0].content, '雨夜\r\n\ufeff記錄');
  assert.equal(result.projection.scope.bearer_attenuated, false);
});

test('invalid origin, missing explicit subject, and conflicting credential sources fail before credential/network use', async () => {
  let calls = 0;
  const transport = { request: async () => { calls++; return json(envelope()); } };
  const resolveBearer = async () => { calls++; return SECRET; };
  for (const origin of ['http://api.example.test', 'http://localhost:1234', 'https://api.example.test/path', 'https://user:password@api.example.test', 'https://api.example.test/?key=secret', 'https://api.example.test/#part', 'https://API.example.test']) {
    await assert.rejects(readHostedContext({ ...options(transport), origin }), code('INVALID_ORIGIN'));
  }
  await assert.rejects(readHostedContext({ ...options(transport), identityId: 'me' }), code('INVALID_IDENTITY'));
  await assert.rejects(readHostedContext({ ...options(transport), projectId: undefined }), code('INVALID_PROJECT'));
  await assert.rejects(readHostedContext({ ...options(transport), resolveBearer }), code('CHOOSE_ONE_CREDENTIAL_TRANSPORT'));
  await assert.rejects(readHostedContext({ ...options(undefined), resolveBearer: undefined }), code('CHOOSE_ONE_CREDENTIAL_TRANSPORT'));
  assert.equal(calls, 0);
});

test('wrong project/identity, broader scope, unknown fields and changed wire bounds fail closed', async () => {
  for (const [mutate, expected] of [
    [value => { value.project_id = OTHER; }, 'RESPONSE_SUBJECT_MISMATCH'],
    [value => { value.identity_id = OTHER; }, 'RESPONSE_SUBJECT_MISMATCH'],
    [value => { value.scope.project_shared_included = true; }, 'RESPONSE_SCOPE_MISMATCH'],
    [value => { value.scope.identity_proven = true; }, 'RESPONSE_SCOPE_MISMATCH'],
    [value => { value.scope.selection = 'project'; }, 'RESPONSE_SCOPE_MISMATCH'],
    [value => { value.credential = SECRET; }, 'INVALID_RESPONSE_SCHEMA'],
    [value => { value.bounds.max_items = 100; }, 'INVALID_RESPONSE_BOUNDS'],
  ]) {
    const value = envelope(); mutate(value);
    await assert.rejects(readHostedContext(options({ request: async () => json(value) })), code(expected));
  }
});

test('hash, UTF-8 byte length, expiry, duplicate IDs and unsafe record fields are verified', async () => {
  for (const mutate of [
    value => { value.records[0].sha256 = 'a'.repeat(64); },
    value => { value.records[0].content_bytes++; },
    value => { value.records[0].expires_at = value.generated_at; },
    value => { value.generated_at = new Date(NOW - 60000).toISOString(); value.records[0].expires_at = new Date(NOW - 1).toISOString(); },
    value => { value.records[0].created_at = new Date(NOW + 300001).toISOString(); },
    value => { value.records[0].metadata = { private: SECRET }; },
    value => { value.records.push(value.records[0]); },
    value => { value.records = [record(1, 'bad\u0000text')]; },
    value => { value.records = [record(1, 'a'.repeat(4097))]; },
  ]) {
    const value = envelope(); mutate(value);
    await assert.rejects(readHostedContext(options({ request: async () => json(value) })), code('INVALID_RESPONSE_RECORD'));
  }
  const value = envelope(); value.used_content_bytes++;
  await assert.rejects(readHostedContext(options({ request: async () => json(value) })), code('INVALID_RESPONSE_BUDGET'));
});

test('stale/future snapshots and malformed omission inventories are rejected', async () => {
  for (const generated_at of [new Date(NOW - 300001).toISOString(), new Date(NOW + 300001).toISOString(), 'not-a-date']) {
    await assert.rejects(readHostedContext(options({ request: async () => json({ ...envelope(), generated_at }) })), code('RESPONSE_NOT_FRESH'));
  }
  for (const omissions of [[{ id: id(1), reason: 'item_limit' }], [{ id: id(2), reason: 'unknown' }], [{ id: id(2), reason: 'item_limit', content: SECRET }]]) {
    await assert.rejects(readHostedContext(options({ request: async () => json({ ...envelope(), omissions }) })), code('INVALID_RESPONSE_OMISSION'));
  }
});

test('redirects and HTTP refusals are never followed, retried, or treated as local state', async () => {
  for (const status of [301, 302, 307, 401, 403, 404, 429, 500]) {
    let calls = 0;
    const transport = { request: async () => { calls++; return new Response(SECRET, { status, headers: { location: 'https://other.example.test' } }); } };
    await assert.rejects(readHostedContext(options(transport)), code(status < 400 ? 'REDIRECT_REFUSED' : 'REMOTE_READ_REFUSED'));
    assert.equal(calls, 1);
  }
});

test('the wire byte cap works without Content-Length, and malformed UTF-8/JSON is refused', async () => {
  for (const [body, error] of [[Buffer.alloc(32769, 32), 'RESPONSE_TOO_LARGE'], [Buffer.from([0xc3, 0x28]), 'INVALID_RESPONSE_JSON'], ['{"broken":', 'INVALID_RESPONSE_JSON']]) {
    await assert.rejects(readHostedContext(options({ request: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) })), code(error));
  }
  await assert.rejects(readHostedContext(options({ request: async () => new Response(JSON.stringify(envelope()), { headers: { 'content-type': 'text/html' } }) })), code('INVALID_RESPONSE_TYPE'));
});

test('timeout and transport diagnostics cannot expose bearer or OS/server messages', async () => {
  let calls = 0;
  await assert.rejects(readHostedContext({ ...options({ request: async () => { calls++; return new Promise(() => {}); } }), timeoutMs: 10 }), code('REQUEST_TIMEOUT'));
  assert.equal(calls, 1);
  let cancelled = false;
  const stalled = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readHostedContext({ ...options({ request: async () => new Response(stalled, { headers: { 'content-type': 'application/json' } }) }), timeoutMs: 10 }), code('REQUEST_TIMEOUT'));
  assert.equal(cancelled, true);
  await assert.rejects(readHostedContext(options({ request: async () => { throw new Error(SECRET); } })), code('REQUEST_FAILED'));
  await assert.rejects(readHostedContext({ ...options(undefined), resolveBearer: async () => { throw new Error(SECRET); } }), code('REQUEST_FAILED'));
});

test('real loopback read sends a callback bearer only as an HTTP header and keeps it out of output', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization, method: request.method });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(envelope()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await readHostedContext({ origin, projectId: PROJECT, identityId: IDENTITY, allowLoopbackHttp: true, resolveBearer: async () => SECRET, now: () => NOW });
  assert.deepEqual(requests, [{ path: `/v1/identities/${IDENTITY}/local-context`, authorization: `Bearer ${SECRET}`, method: 'GET' }]);
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test('direct transport refuses exact credential reflections before emitting hosted context', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(envelope([record(1, SECRET)])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await assert.rejects(readHostedContext({ origin: `http://127.0.0.1:${server.address().port}`, projectId: PROJECT, identityId: IDENTITY, allowLoopbackHttp: true, resolveBearer: () => SECRET, now: () => NOW }), code('CREDENTIAL_REFLECTION'));
});

test('connected rendering uses one aggregate budget, keeps complete records, and changes no local files', async (t) => {
  const dir = fixture(t);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.sources.forEach(source => { source.enabled = source.id === 'orientation'; });
  manifest.context_budget_bytes = 1024;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(path.join(dir, 'orientation.md'), 'l'.repeat(800));
  const before = snapshot(dir);
  const value = envelope([record(1, 'a'.repeat(200)), record(2, 'b'.repeat(50)), record(3, 'ok')]);
  const result = await renderConnectedContext({ dir, ...options({ request: async () => json(value) }) });
  assert.equal(result.used_bytes, 1002);
  assert.deepEqual(result.hosted.selection.records.map(item => item.id), [id(1), id(3)]);
  assert.deepEqual(result.hosted.selection.omissions, [{ id: id(2), reason: 'combined_context_budget' }]);
  assert.equal(result.hosted.receipt.format, 'agenttool-local-api-context-receipt/v1');
  assert.equal(result.hosted.receipt.source_format, 'agenttool-local-api-context/v1');
  assert.ok(result.hosted.receipt.records.every(item => !Object.hasOwn(item, 'content')));
  assert.ok(!JSON.stringify(result).includes('b'.repeat(50)));
  assert.equal(result.hosted.response_sha256, hash(JSON.stringify(value)));
  const markdown = formatConnectedMarkdown(result);
  assert.match(markdown, /Selection does not prove identity control/);
  assert.ok(!markdown.includes('b'.repeat(50)));
  assert.deepEqual(snapshot(dir), before);
});

test('offline mode and the existing render/hook commands resolve no credentials and keep identical local behavior', async (t) => {
  const dir = fixture(t);
  let calls = 0;
  const result = await renderConnectedContext({ dir, origin: ORIGIN, projectId: PROJECT, identityId: IDENTITY, offline: true, resolveBearer: () => { calls++; throw new Error(SECRET); }, transport: { request: () => { calls++; throw new Error(SECRET); } } });
  assert.equal(result.hosted.status, 'offline');
  assert.equal(calls, 0);
  assert.deepEqual(result.local.sources, renderStarter(dir).sources);
  for (const args of [['render', '--dir', dir, '--format', 'json'], ['hook', '--dir', dir, '--harness', 'claude-code']]) {
    const processResult = spawnSync(process.execPath, [CORE_CLI, ...args], { encoding: 'utf8', timeout: 5000, env: { ...process.env, AT_API_KEY: SECRET } });
    assert.equal(processResult.status, 0, processResult.stderr);
    assert.ok(!processResult.stdout.includes(SECRET));
  }
});

test('explicit CLI offline output works without a credential and errors have no partial stdout', (t) => {
  const dir = fixture(t);
  const args = ['--dir', dir, '--origin', ORIGIN, '--project-id', PROJECT, '--identity-id', IDENTITY];
  const offline = spawnSync(process.execPath, [CLI, ...args, '--offline', '--format', 'json'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(offline.status, 0, offline.stderr);
  assert.equal(JSON.parse(offline.stdout).hosted.status, 'offline');
  for (const tail of [[], ['--credential-env', SECRET], ['--bearer', SECRET], ['--offline', '--offline']]) {
    const result = spawnSync(process.execPath, [CLI, ...args, ...tail], { encoding: 'utf8', timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^agenttool-local-connect: [A-Z_]+\n$/u);
    assert.ok(!result.stderr.includes(SECRET));
  }
});
