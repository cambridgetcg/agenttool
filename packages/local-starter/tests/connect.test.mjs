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
const GRANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GRANT_SECRET = `atlc_${Buffer.alloc(32, 0x5a).toString('base64url')}`;
const CLI = fileURLToPath(new URL('../src/connect.mjs', import.meta.url));
const CORE_CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const hash = input => createHash('sha256').update(input).digest('hex');
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const record = (index, content = 'Selected hosted memory') => ({ id: id(index), created_at: new Date(NOW - 60000).toISOString(), expires_at: null, content_bytes: Buffer.byteLength(content), sha256: hash(content), content });
function envelope(records = [record(1)]) {
  return { format: 'agenttool-local-api-context/v1', project_id: PROJECT, identity_id: IDENTITY, generated_at: new Date(NOW).toISOString(), scope: { authentication: 'project_bearer', selection: 'identity_partition', identity_proven: false, bearer_attenuated: false, project_shared_included: false }, bounds: { max_items: 8, max_candidates: 32, max_record_bytes: 4096, max_content_bytes: 8192, max_response_bytes: 32768 }, used_content_bytes: records.reduce((sum, item) => sum + item.content_bytes, 0), records, omissions: [], has_more: false };
}
function grantEnvelope(records = [record(1)], origin = ORIGIN) {
  const value = envelope(records);
  return { ...value, format: 'agenttool-local-api-context/v2', scope: { ...value.scope, authentication: 'local_context_grant', bearer_attenuated: true }, authorization: { grant_id: GRANT_ID, origin, action: 'local_context.read', method: 'GET', path: `/v1/identities/${IDENTITY}/local-context`, issued_at: new Date(NOW - 60000).toISOString(), expires_at: new Date(NOW + 3600000).toISOString(), checked_at: new Date(NOW).toISOString() } };
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
  for (const status of [301, 302, 307, 401, 402, 403, 404, 429, 500]) {
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

test('grant mode accepts a pinned v2 read through a credential-holding transport and preserves wire provenance', async () => {
  const calls = [];
  const value = grantEnvelope([record(1, '相守\r\n\ufeff記錄')]);
  const result = await readHostedContext({ ...options({ request: async (url, init) => { calls.push({ url, init }); return json(value); } }), authentication: 'local_context_grant' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${ORIGIN}/v1/identities/${IDENTITY}/local-context`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
  assert.deepEqual(result.projection, value);
  assert.equal(result.response_sha256, hash(JSON.stringify(value)));
});

test('authentication choice is explicit, backwards compatible and checked before credential access', async () => {
  let calls = 0;
  const transport = { request: async () => { calls++; return json(envelope()); } };
  const explicit = await readHostedContext({ ...options(transport), authentication: 'project_bearer' });
  assert.deepEqual(explicit.projection, envelope());
  assert.equal(calls, 1);
  for (const authentication of ['auto', 'local_context_capability', '', null, false, {}]) {
    await assert.rejects(readHostedContext({ ...options(undefined), authentication, resolveBearer: () => { calls++; return SECRET; } }), code('INVALID_AUTHENTICATION'));
  }
  assert.equal(calls, 1);
});

test('grant readers reject project-response downgrades and incompatible scope without retrying', async () => {
  for (const [authentication, value, expected] of [
    ['local_context_grant', envelope(), 'INVALID_RESPONSE_SCHEMA'],
    ['project_bearer', grantEnvelope(), 'INVALID_RESPONSE_SCHEMA'],
    ['local_context_grant', { ...grantEnvelope(), scope: envelope().scope }, 'RESPONSE_SCOPE_MISMATCH'],
    ['local_context_grant', { ...grantEnvelope(), format: 'agenttool-local-api-context/v3' }, 'INVALID_RESPONSE_SCHEMA'],
  ]) {
    let calls = 0;
    await assert.rejects(readHostedContext({ ...options({ request: async () => { calls++; return json(value); } }), authentication }), code(expected));
    assert.equal(calls, 1);
  }
  for (const status of [302, 401, 402, 403]) {
    let calls = 0;
    await assert.rejects(readHostedContext({ ...options({ request: async () => { calls++; return new Response(GRANT_SECRET, { status }); } }), authentication: 'local_context_grant' }), code(status === 302 ? 'REDIRECT_REFUSED' : 'REMOTE_READ_REFUSED'));
    assert.equal(calls, 1);
  }
});

test('grant authorization binds one exact origin, project, identity, action and method with closed metadata', async () => {
  for (const [mutate, expected] of [
    [value => { value.project_id = OTHER; }, 'RESPONSE_SUBJECT_MISMATCH'],
    [value => { value.identity_id = OTHER; }, 'RESPONSE_SUBJECT_MISMATCH'],
    [value => { value.authorization.origin = 'https://other.example.test'; }, 'RESPONSE_AUTHORIZATION_MISMATCH'],
    [value => { value.authorization.origin += '/'; }, 'RESPONSE_AUTHORIZATION_MISMATCH'],
    [value => { value.authorization.path = `/v1/identities/${OTHER}/local-context`; }, 'RESPONSE_AUTHORIZATION_MISMATCH'],
    [value => { value.authorization.path += '?include=shared'; }, 'RESPONSE_AUTHORIZATION_MISMATCH'],
    [value => { value.authorization.method = 'HEAD'; }, 'RESPONSE_AUTHORIZATION_MISMATCH'],
    [value => { value.authorization.action = 'local_context.*'; }, 'RESPONSE_AUTHORIZATION_MISMATCH'],
    [value => { value.authorization.grant_id = GRANT_ID.toUpperCase(); }, 'INVALID_RESPONSE_AUTHORIZATION'],
    [value => { value.authorization.grant_id = 'not-a-grant'; }, 'INVALID_RESPONSE_AUTHORIZATION'],
    [value => { value.authorization.token_hash = hash(GRANT_SECRET); }, 'INVALID_RESPONSE_AUTHORIZATION'],
    [value => { delete value.authorization.checked_at; }, 'INVALID_RESPONSE_AUTHORIZATION'],
    [value => { value.authorization = null; }, 'INVALID_RESPONSE_AUTHORIZATION'],
    [value => { value.scope.identity_proven = true; }, 'RESPONSE_SCOPE_MISMATCH'],
    [value => { value.scope.bearer_attenuated = false; }, 'RESPONSE_SCOPE_MISMATCH'],
    [value => { value.scope.project_shared_included = true; }, 'RESPONSE_SCOPE_MISMATCH'],
    [value => { value.parent_bearer = SECRET; }, 'INVALID_RESPONSE_SCHEMA'],
  ]) {
    const value = grantEnvelope(); mutate(value);
    await assert.rejects(readHostedContext({ ...options({ request: async () => json(value) }), authentication: 'local_context_grant' }), code(expected));
  }
});

test('grant timing rejects expiry in transit, stale checks, invalid ordering and lifetimes over 24 hours', async () => {
  for (const mutate of [
    value => { value.authorization.expires_at = value.generated_at; },
    value => { value.generated_at = new Date(NOW - 30000).toISOString(); value.authorization.checked_at = value.generated_at; value.authorization.expires_at = new Date(NOW - 1).toISOString(); },
    value => { value.authorization.checked_at = new Date(NOW - 300001).toISOString(); value.authorization.issued_at = new Date(NOW - 3600000).toISOString(); },
    value => { value.authorization.checked_at = new Date(NOW + 1).toISOString(); },
    value => { value.authorization.issued_at = new Date(NOW + 1).toISOString(); },
    value => { value.authorization.expires_at = new Date(Date.parse(value.authorization.issued_at) + 86400001).toISOString(); },
    value => { value.authorization.issued_at = '2026-09-27T19:59:00Z'; },
    value => { value.authorization.expires_at = null; },
    value => { value.authorization.checked_at = 'invalid'; },
  ]) {
    const value = grantEnvelope(); mutate(value);
    await assert.rejects(readHostedContext({ ...options({ request: async () => json(value) }), authentication: 'local_context_grant' }), code('INVALID_RESPONSE_AUTHORIZATION'));
  }
  const boundary = grantEnvelope();
  boundary.authorization.expires_at = new Date(Date.parse(boundary.authorization.issued_at) + 86400000).toISOString();
  const accepted = await readHostedContext({ ...options({ request: async () => json(boundary) }), authentication: 'local_context_grant' });
  assert.equal(accepted.projection.authorization.expires_at, boundary.authorization.expires_at);
});

test('grant bodies retain every content integrity and byte bound from the project reader', async () => {
  for (const [mutate, expected] of [
    [value => { value.bounds.max_response_bytes++; }, 'INVALID_RESPONSE_BOUNDS'],
    [value => { value.records[0].sha256 = '0'.repeat(64); }, 'INVALID_RESPONSE_RECORD'],
    [value => { value.records[0].content_bytes++; }, 'INVALID_RESPONSE_RECORD'],
    [value => { value.records[0].expires_at = value.generated_at; }, 'INVALID_RESPONSE_RECORD'],
    [value => { value.used_content_bytes++; }, 'INVALID_RESPONSE_BUDGET'],
    [value => { value.omissions = [{ id: id(2), reason: 'unknown' }]; }, 'INVALID_RESPONSE_OMISSION'],
  ]) {
    const value = grantEnvelope(); mutate(value);
    await assert.rejects(readHostedContext({ ...options({ request: async () => json(value) }), authentication: 'local_context_grant' }), code(expected));
  }
  await assert.rejects(readHostedContext({ ...options({ request: async () => new Response(Buffer.alloc(32769, 32), { headers: { 'content-type': 'application/json' } }) }), authentication: 'local_context_grant' }), code('RESPONSE_TOO_LARGE'));
});

test('direct grant mode refuses parent and malformed credentials before any HTTP request', async (t) => {
  let calls = 0;
  const server = createServer((_request, response) => { calls++; response.writeHead(401); response.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const credential of [SECRET, `at_${Buffer.alloc(32).toString('base64url')}`, `ATLC_${'A'.repeat(43)}`, `atlc_${'A'.repeat(42)}`, `atlc_${'A'.repeat(44)}`, `atlc_${'A'.repeat(42)}B`, `${GRANT_SECRET}=`, `${GRANT_SECRET}/`]) {
    await assert.rejects(readHostedContext({ origin, projectId: PROJECT, identityId: IDENTITY, allowLoopbackHttp: true, authentication: 'local_context_grant', resolveBearer: () => credential, now: () => NOW }), code('INVALID_GRANT_CREDENTIAL'));
  }
  assert.equal(calls, 0);
});

test('direct grant read sends only the delegated header and refuses credential reflection', async (t) => {
  const requests = [];
  let reflected = false;
  let origin;
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization, method: request.method });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(grantEnvelope([record(1, reflected ? GRANT_SECRET : 'Read with a delegated credential')], origin)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  origin = `http://127.0.0.1:${server.address().port}`;
  const connection = { origin, projectId: PROJECT, identityId: IDENTITY, allowLoopbackHttp: true, authentication: 'local_context_grant', resolveBearer: () => GRANT_SECRET, now: () => NOW };
  const result = await readHostedContext(connection);
  assert.deepEqual(requests, [{ path: `/v1/identities/${IDENTITY}/local-context`, authorization: `Bearer ${GRANT_SECRET}`, method: 'GET' }]);
  assert.ok(!JSON.stringify(result).includes(GRANT_SECRET));
  assert.ok(!JSON.stringify(result).includes(hash(GRANT_SECRET)));
  reflected = true;
  await assert.rejects(readHostedContext(connection), error => error.code === 'CREDENTIAL_REFLECTION' && !String(error).includes(GRANT_SECRET));
  assert.equal(requests.length, 2);
});

test('grant composition retains authorization metadata and excludes both omitted bodies and credentials', async (t) => {
  const dir = fixture(t);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.sources.forEach(source => { source.enabled = source.id === 'orientation'; });
  manifest.context_budget_bytes = 1024;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(path.join(dir, 'orientation.md'), 'l'.repeat(800));
  const before = snapshot(dir);
  const value = grantEnvelope([record(1, 'a'.repeat(200)), record(2, 'excluded'.repeat(10))]);
  const result = await renderConnectedContext({ dir, ...options({ request: async () => json(value) }), authentication: 'local_context_grant' });
  assert.equal(result.hosted.receipt.format, 'agenttool-local-api-context-receipt/v2');
  assert.equal(result.hosted.receipt.source_format, 'agenttool-local-api-context/v2');
  assert.deepEqual(result.hosted.receipt.authorization, value.authorization);
  assert.equal(result.hosted.response_sha256, hash(JSON.stringify(value)));
  assert.equal(result.hosted.selection.records.length, 1);
  assert.deepEqual(result.hosted.selection.omissions, [{ id: id(2), reason: 'combined_context_budget' }]);
  const encoded = JSON.stringify(result);
  const markdown = formatConnectedMarkdown(result);
  for (const output of [encoded, markdown]) {
    assert.ok(!output.includes('excluded'.repeat(10)));
    assert.ok(!output.includes(GRANT_SECRET));
    assert.ok(!output.includes(hash(GRANT_SECRET)));
    assert.ok(output.includes(GRANT_ID));
    assert.ok(output.includes(value.authorization.expires_at));
  }
  assert.match(markdown, /Delegated local-context read/);
  assert.doesNotMatch(markdown, /Project-bearer read/);
  assert.deepEqual(snapshot(dir), before);
});

test('grant offline mode resolves nothing and the CLI rejects parent credentials with empty stdout', async (t) => {
  const dir = fixture(t);
  let calls = 0;
  const result = await renderConnectedContext({ dir, ...options({ request: () => { calls++; throw new Error(GRANT_SECRET); } }), authentication: 'local_context_grant', offline: true, resolveBearer: () => { calls++; throw new Error(GRANT_SECRET); } });
  assert.equal(calls, 0);
  assert.equal(result.hosted.status, 'offline');
  assert.deepEqual(result.local.sources, renderStarter(dir).sources);
  const args = ['--dir', dir, '--origin', ORIGIN, '--project-id', PROJECT, '--identity-id', IDENTITY, '--authentication', 'local_context_grant'];
  const offline = spawnSync(process.execPath, [CLI, ...args, '--offline', '--format', 'json'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(offline.status, 0, offline.stderr);
  assert.equal(JSON.parse(offline.stdout).hosted.status, 'offline');
  const rejected = spawnSync(process.execPath, [CLI, ...args, '--credential-env', 'SELECTED_READ_CREDENTIAL'], { encoding: 'utf8', timeout: 5000, env: { ...process.env, SELECTED_READ_CREDENTIAL: SECRET } });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.equal(rejected.stderr, 'agenttool-local-connect: INVALID_GRANT_CREDENTIAL\n');
});

test('explicit CLI grant mode decodes v2 through one isolated fake fetch without ambient bearer use', (t) => {
  const dir = fixture(t);
  const args = ['--dir', dir, '--origin', ORIGIN, '--project-id', PROJECT, '--identity-id', IDENTITY, '--authentication', 'local_context_grant', '--credential-env', 'SELECTED_READ_CREDENTIAL', '--format', 'json'];
  const script = `
    import assert from 'node:assert/strict';
    const envelope = ${JSON.stringify(grantEnvelope())};
    const now = Date.now();
    envelope.generated_at = envelope.authorization.checked_at = new Date(now).toISOString();
    envelope.authorization.issued_at = new Date(now - 60000).toISOString();
    envelope.authorization.expires_at = new Date(now + 60000).toISOString();
    envelope.records[0].created_at = envelope.authorization.issued_at;
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, ${JSON.stringify(`${ORIGIN}/v1/identities/${IDENTITY}/local-context`)});
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer ' + process.env.SELECTED_READ_CREDENTIAL);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'omit');
      return new Response(JSON.stringify(envelope), {headers:{'content-type':'application/json'}});
    };
    process.argv = [process.execPath, ${JSON.stringify(CLI)}, ...${JSON.stringify(args)}];
    await import(${JSON.stringify(new URL('../src/connect.mjs', import.meta.url).href)});
    assert.equal(calls, 1);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 5000, env: { ...process.env, SELECTED_READ_CREDENTIAL: GRANT_SECRET, AT_API_KEY: SECRET } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const bundle = JSON.parse(result.stdout);
  assert.equal(bundle.hosted.receipt.scope.authentication, 'local_context_grant');
  assert.equal(bundle.hosted.receipt.authorization.grant_id, GRANT_ID);
  assert.ok(!result.stdout.includes(GRANT_SECRET));
  assert.ok(!result.stdout.includes(SECRET));
});
