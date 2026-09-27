import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StarterError, formatMarkdown, initStarter, inspectStarter, renderStarter,
  writeHandoff,
} from '../src/core.mjs';

const POSIX_ONLY = process.platform === 'win32'
  ? 'POSIX modes and symlinks are not Windows ACL evidence'
  : false;
const IDS = [
  'foundations', 'orientation', 'handoff', 'identity', 'preferences',
  'relationships', 'memory',
];
const FILES = {
  foundations: 'foundations.md', orientation: 'orientation.md',
  handoff: 'handoff.md', identity: 'identity.md', preferences: 'preferences.md',
  relationships: 'relationships.md', memory: 'memories.md',
};
const hash = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t, { initialize = true } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'agenttool-local-core-test-'));
  if (process.platform !== 'win32') chmodSync(parent, 0o700);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'starter');
  const result = initialize ? initStarter(root) : undefined;
  return { parent, root, result };
}

function manifest(root) {
  return JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
}

function editManifest(root, change) {
  const value = manifest(root);
  change(value);
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return value;
}

function put(root, id, content) {
  writeFileSync(join(root, FILES[id]), content, { mode: 0o600 });
}

function only(root, ids) {
  editManifest(root, (value) => {
    for (const source of value.sources) source.enabled = ids.includes(source.id);
  });
}

function source(bundle, id) {
  const value = bundle.sources.find((item) => item.id === id);
  assert.ok(value, `missing source report: ${id}`);
  return value;
}

function refuses(fn, code, privateText) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof StarterError);
    assert.equal(typeof error.code, 'string');
    if (code) assert.equal(error.code, code);
    if (privateText) assert.ok(!String(error).includes(privateText));
    return true;
  });
}

// Faults run in a child so modified built-in bindings cannot affect other tests.
// These model ambiguous local I/O outcomes, not power-loss or hostile-FS proof.
function faultProcess(root, body) {
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { join } from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const core = await import(process.argv[1]);
    const root = process.argv[2];
    const ioFailure = () => Object.assign(new Error('injected I/O failure'), { code: 'EIO' });
    ${body}
  `;
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e', script,
    new URL('../src/core.mjs', import.meta.url).href, root,
  ], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536, windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('fresh init creates a bounded opt-in starter and reports its privacy boundary', (t) => {
  const { root, result } = fixture(t);
  assert.equal(result.format, 'agenttool-local-init/v1');
  assert.equal(result.permissions, process.platform === 'win32'
    ? 'windows-acl-unverified' : 'posix-owner-only');
  assert.deepEqual(new Set(result.created), new Set(['manifest.json', ...Object.values(FILES)]));
  assert.deepEqual(new Set(readdirSync(root)), new Set(result.created));
  const config = manifest(root);
  assert.equal(config.format, 'agenttool-local-starter/v1');
  assert.equal(config.context_budget_bytes, 16384);
  assert.deepEqual(config.sources.map((item) => item.id), IDS);
  assert.deepEqual(config.sources.filter((item) => item.enabled).map((item) => item.id), IDS.slice(0, 3));
  assert.equal(config.sources.find((item) => item.id === 'handoff').max_age_hours, 72);
  for (const id of IDS.slice(3)) assert.equal(readFileSync(join(root, FILES[id])).length, 0);
});

test('init refuses existing directories and leaves their contents intact', (t) => {
  const { root } = fixture(t, { initialize: false });
  mkdirSync(root, { mode: 0o700 });
  const note = 'This directory belongs to an existing project.';
  writeFileSync(join(root, 'keep.txt'), note, { mode: 0o600 });
  refuses(() => initStarter(root), 'already_exists');
  assert.deepEqual(readdirSync(root), ['keep.txt']);
  assert.equal(readFileSync(join(root, 'keep.txt'), 'utf8'), note);
});

test('repeated init preserves an already initialized starter', (t) => {
  const { root } = fixture(t);
  put(root, 'handoff', 'A decision recorded after initialization.');
  const before = Object.fromEntries(readdirSync(root).map((name) => [name, readFileSync(join(root, name))]));
  refuses(() => initStarter(root), 'already_exists');
  assert.deepEqual(readdirSync(root).sort(), Object.keys(before).sort());
  for (const [name, bytes] of Object.entries(before)) assert.deepEqual(readFileSync(join(root, name)), bytes);
});

test('init requires an existing parent rather than making an arbitrary directory tree', (t) => {
  const { parent } = fixture(t, { initialize: false });
  const absentParent = join(parent, 'not-created');
  refuses(() => initStarter(join(absentParent, 'starter')));
  assert.equal(existsSync(absentParent), false);
});

test('a failed final file sync leaves incomplete init without publishing its manifest', (t) => {
  const { root } = fixture(t, { initialize: false });
  faultProcess(root, `
    const original = fs.fsyncSync;
    let calls = 0;
    fs.fsyncSync = (...args) => {
      calls++;
      if (calls === 8) throw ioFailure();
      return original(...args);
    };
    syncBuiltinESMExports();
    assert.throws(() => core.initStarter(root), (error) => error.code === 'init_incomplete');
    assert.equal(calls, 8);
    fs.fsyncSync = original;
    syncBuiltinESMExports();
    assert.equal(fs.existsSync(join(root, 'manifest.json')), false);
    assert.throws(() => core.inspectStarter(root), (error) => error.code === 'manifest_unavailable');
  `);
  for (const filename of Object.values(FILES)) assert.equal(existsSync(join(root, filename)), true);
  refuses(() => initStarter(root), 'already_exists');
});

test('an error reported after manifest publication requires inspection rather than retry', (t) => {
  const { root } = fixture(t, { initialize: false });
  faultProcess(root, `
    const original = fs.unlinkSync;
    let triggered = false;
    fs.unlinkSync = (file, ...args) => {
      const result = original(file, ...args);
      if (String(file).includes('.manifest-') && !triggered) {
        triggered = true;
        throw ioFailure();
      }
      return result;
    };
    syncBuiltinESMExports();
    assert.throws(() => core.initStarter(root), (error) => error.code === 'init_uncertain');
    assert.equal(triggered, true);
    fs.unlinkSync = original;
    syncBuiltinESMExports();
    assert.equal(core.inspectStarter(root).format, 'agenttool-local-status/v1');
    assert.throws(() => core.initStarter(root), (error) => error.code === 'already_exists');
  `);
  assert.equal(inspectStarter(root).format, 'agenttool-local-status/v1');
});

test('root lookup failures after initial stat expose only an opaque core error', (t) => {
  const { root } = fixture(t);
  faultProcess(root, `
    const originalRealpath = fs.realpathSync;
    const originalLstat = fs.lstatSync;
    const privateText = 'PRIVATE-ROOT-LOOKUP-80c51:' + root;
    for (const failure of ['realpath', 'second-stat']) {
      for (const operation of [
        () => core.renderStarter(root),
        () => core.inspectStarter(root),
        () => core.writeHandoff(root, 'A bounded record.', '0'.repeat(64)),
      ]) {
        let stats = 0;
        let injected = false;
        fs.realpathSync = (...args) => {
          if (failure === 'realpath') {
            injected = true;
            throw Object.assign(new Error(privateText), { code: 'EACCES', path: root });
          }
          return originalRealpath(...args);
        };
        fs.lstatSync = (...args) => {
          stats++;
          if (failure === 'second-stat' && stats === 2) {
            injected = true;
            throw Object.assign(new Error(privateText), { code: 'EIO', path: root });
          }
          return originalLstat(...args);
        };
        syncBuiltinESMExports();
        try {
          assert.throws(operation, (error) => {
            assert.ok(error instanceof core.StarterError);
            assert.equal(error.code, 'unsafe_root');
            assert.equal(error.message, 'unsafe_root');
            assert.ok(!String(error).includes(privateText));
            assert.ok(!JSON.stringify(error).includes(root));
            return true;
          });
          assert.equal(injected, true);
        } finally {
          fs.realpathSync = originalRealpath;
          fs.lstatSync = originalLstat;
          syncBuiltinESMExports();
        }
      }
    }
  `);
});

test('failed manifest readback cannot relabel a published init as incomplete', (t) => {
  const { parent } = fixture(t, { initialize: false });
  for (const readbackCode of ['EIO', 'EACCES']) {
    const root = join(parent, `starter-${readbackCode}`);
    faultProcess(root, `
      const originalUnlink = fs.unlinkSync;
      const originalLstat = fs.lstatSync;
      let publicationFinished = false;
      let readbackFailures = 0;
      fs.unlinkSync = (file, ...args) => {
        const result = originalUnlink(file, ...args);
        if (String(file).includes('.manifest-') && !publicationFinished) {
          publicationFinished = true;
          throw ioFailure();
        }
        return result;
      };
      fs.lstatSync = (file, ...args) => {
        if (publicationFinished && String(file).endsWith('manifest.json')) {
          readbackFailures++;
          throw Object.assign(new Error('injected manifest readback failure'), { code: '${readbackCode}' });
        }
        return originalLstat(file, ...args);
      };
      syncBuiltinESMExports();
      try {
        assert.throws(() => core.initStarter(root), (error) => {
          assert.ok(error instanceof core.StarterError);
          assert.equal(error.code, 'init_uncertain');
          return true;
        });
        assert.equal(publicationFinished, true);
        assert.ok(readbackFailures > 0);
      } finally {
        fs.unlinkSync = originalUnlink;
        fs.lstatSync = originalLstat;
        syncBuiltinESMExports();
      }
      assert.equal(core.inspectStarter(root).format, 'agenttool-local-status/v1');
      assert.throws(() => core.initStarter(root), (error) => error.code === 'already_exists');
    `);
    assert.equal(inspectStarter(root).format, 'agenttool-local-status/v1');
  }
});

test('render preserves selected order, exact UTF-8 bytes, and source provenance', (t) => {
  const { root } = fixture(t);
  const memory = '記住：可以休息。🌞\n';
  const orientation = 'Review the current request before choosing a task.\n';
  put(root, 'memory', memory);
  put(root, 'orientation', orientation);
  only(root, ['memory', 'orientation']);
  editManifest(root, (value) => {
    value.sources.sort((a, b) => Number(b.id === 'memory') - Number(a.id === 'memory'));
  });
  const now = Date.now();
  const bundle = renderStarter(root, { now });
  assert.equal(bundle.format, 'agenttool-local-context/v1');
  assert.equal(bundle.generated_at, new Date(now).toISOString());
  assert.equal(bundle.manifest_sha256, hash(readFileSync(join(root, 'manifest.json'))));
  assert.deepEqual(bundle.sources.map((item) => item.id), manifest(root).sources.map((item) => item.id));
  assert.equal(bundle.used_bytes, Buffer.byteLength(memory) + Buffer.byteLength(orientation));
  for (const [id, content] of [['memory', memory], ['orientation', orientation]]) {
    const item = source(bundle, id);
    assert.equal(item.path, FILES[id]);
    assert.equal(item.status, 'included');
    assert.equal(item.content, content);
    assert.equal(item.bytes, Buffer.byteLength(content));
    assert.equal(item.sha256, hash(content));
    assert.ok(Number.isFinite(Date.parse(item.modified_at)));
  }
});

test('disabled sources stay omitted even when their bodies would fail validation', (t) => {
  const { root } = fixture(t);
  const privateText = 'PRIVATE-RELATIONSHIP-NOT-SELECTED-838f0d';
  put(root, 'relationships', privateText);
  put(root, 'identity', Buffer.from([0xc3, 0x28]));
  put(root, 'memory', Buffer.alloc(20000, 0x41));
  const bundle = renderStarter(root);
  for (const id of ['relationships', 'identity', 'memory']) {
    const item = source(bundle, id);
    assert.equal(item.status, 'disabled');
    assert.equal(Object.hasOwn(item, 'content'), false);
    assert.equal(Object.hasOwn(item, 'sha256'), false);
    assert.equal(Object.hasOwn(item, 'bytes'), false);
  }
  assert.ok(!JSON.stringify(bundle).includes(privateText));
  assert.ok(!formatMarkdown(bundle).includes(privateText));
});

test('the byte budget omits whole sources and can still include later smaller sources', (t) => {
  const { root } = fixture(t);
  only(root, ['foundations', 'orientation', 'handoff']);
  editManifest(root, (value) => { value.context_budget_bytes = 1024; });
  put(root, 'foundations', '愛'.repeat(200));
  put(root, 'orientation', 'b'.repeat(500));
  put(root, 'handoff', 'c'.repeat(300));
  const bundle = renderStarter(root);
  assert.equal(bundle.budget_bytes, 1024);
  assert.equal(bundle.used_bytes, 900);
  assert.equal(source(bundle, 'foundations').status, 'included');
  assert.equal(source(bundle, 'orientation').status, 'budget');
  assert.equal(Object.hasOwn(source(bundle, 'orientation'), 'content'), false);
  assert.equal(source(bundle, 'handoff').content, 'c'.repeat(300));
});

test('per-source byte limits omit oversized UTF-8 content without truncating it', (t) => {
  const { root } = fixture(t);
  only(root, ['orientation']);
  editManifest(root, (value) => { value.sources.find((item) => item.id === 'orientation').max_bytes = 5; });
  put(root, 'orientation', '愛愛');
  const bundle = renderStarter(root);
  assert.equal(source(bundle, 'orientation').status, 'too_large');
  assert.equal(Object.hasOwn(source(bundle, 'orientation'), 'content'), false);
  assert.equal(bundle.used_bytes, 0);
  put(root, 'orientation', '愛ab');
  assert.equal(source(renderStarter(root), 'orientation').content, '愛ab');
});

test('missing and empty selected sources are reported separately', (t) => {
  const { root } = fixture(t);
  only(root, ['orientation', 'memory']);
  unlinkSync(join(root, FILES.orientation));
  put(root, 'memory', '');
  const bundle = renderStarter(root);
  assert.equal(source(bundle, 'orientation').status, 'missing');
  assert.equal(source(bundle, 'memory').status, 'empty');
  assert.equal(bundle.used_bytes, 0);
});

test('freshness is explicit and neither stale nor future context is silently included', (t) => {
  const { root } = fixture(t);
  only(root, ['handoff', 'orientation']);
  const now = Date.now();
  const old = new Date(now - 73 * 60 * 60 * 1000);
  utimesSync(join(root, FILES.handoff), old, old);
  const future = new Date(now + 60 * 60 * 1000);
  utimesSync(join(root, FILES.orientation), future, future);
  const bundle = renderStarter(root, { now });
  assert.equal(source(bundle, 'handoff').status, 'stale');
  assert.equal(source(bundle, 'orientation').status, 'future_timestamp');
  assert.equal(bundle.used_bytes, 0);
  for (const item of bundle.sources) assert.equal(Object.hasOwn(item, 'content'), false);
});

test('null age limits permit old records and small future clock jitter is tolerated', (t) => {
  const { root } = fixture(t);
  only(root, ['orientation', 'handoff']);
  const now = Date.now();
  const old = new Date(now - 400 * 24 * 60 * 60 * 1000);
  utimesSync(join(root, FILES.orientation), old, old);
  const slightlyFuture = new Date(now + 60 * 1000);
  utimesSync(join(root, FILES.handoff), slightlyFuture, slightlyFuture);
  assert.equal(source(renderStarter(root, { now }), 'orientation').status, 'included');
  assert.equal(source(renderStarter(root, { now }), 'handoff').status, 'included');
});

test('fingerprints change when source or manifest bytes change', (t) => {
  const { root } = fixture(t);
  put(root, 'orientation', 'Revision one.');
  const before = renderStarter(root);
  put(root, 'orientation', 'Revision two.');
  const after = renderStarter(root);
  assert.notEqual(source(before, 'orientation').sha256, source(after, 'orientation').sha256);
  assert.equal(before.manifest_sha256, after.manifest_sha256);
  editManifest(root, (value) => { value.context_budget_bytes = 8192; });
  assert.notEqual(renderStarter(root).manifest_sha256, before.manifest_sha256);
});

test('inspect fingerprints disabled slots without returning their private contents', (t) => {
  const { root } = fixture(t);
  const secrets = IDS.map((id) => `PRIVATE-${id}-CONTENT-73a6e52`);
  for (const [index, id] of IDS.entries()) put(root, id, secrets[index]);
  const status = inspectStarter(root);
  assert.equal(status.format, 'agenttool-local-status/v1');
  assert.equal(status.permissions, process.platform === 'win32'
    ? 'windows-acl-unverified' : 'posix-owner-only');
  assert.equal(status.budget_bytes, 16384);
  assert.equal(status.manifest_sha256, hash(readFileSync(join(root, 'manifest.json'))));
  assert.deepEqual(status.sources.map((item) => item.id), IDS);
  for (const [index, id] of IDS.entries()) {
    const item = source(status, id);
    assert.equal(item.enabled, index < 3);
    assert.equal(item.status, 'ready');
    assert.equal(item.sha256, hash(secrets[index]));
    assert.equal(item.bytes, Buffer.byteLength(secrets[index]));
    assert.equal(Object.hasOwn(item, 'content'), false);
    assert.ok(!JSON.stringify(status).includes(secrets[index]));
  }
});

test('markdown makes provenance, omitted sources, and the authority boundary visible', (t) => {
  const { root } = fixture(t);
  put(root, 'orientation', 'Inspect the current request.');
  const bundle = renderStarter(root);
  const markdown = formatMarkdown(bundle);
  assert.equal(typeof markdown, 'string');
  assert.ok(markdown.includes('Inspect the current request.'));
  assert.ok(markdown.includes(bundle.manifest_sha256));
  assert.ok(markdown.includes(source(bundle, 'orientation').sha256));
  assert.ok(markdown.includes('orientation.md'));
  assert.match(markdown, /disabled/i);
  assert.match(markdown, /(?:data|records)[\s\S]{0,180}not[\s\S]{0,80}authority/i);
});

for (const [name, mutate] of [
  ['unknown format', (value) => { value.format = 'arbitrary/v9'; }],
  ['budget below minimum', (value) => { value.context_budget_bytes = 1023; }],
  ['budget above maximum', (value) => { value.context_budget_bytes = 32769; }],
  ['fractional budget', (value) => { value.context_budget_bytes = 1024.5; }],
  ['missing source', (value) => { value.sources.pop(); }],
  ['duplicate source', (value) => { value.sources[6] = { ...value.sources[0] }; }],
  ['extra source path', (value) => { value.sources[0].path = '../private.txt'; }],
  ['non-boolean selection', (value) => { value.sources[0].enabled = 'yes'; }],
  ['zero source limit', (value) => { value.sources[0].max_bytes = 0; }],
  ['oversized source limit', (value) => { value.sources[0].max_bytes = 16385; }],
  ['zero age', (value) => { value.sources[0].max_age_hours = 0; }],
  ['oversized age', (value) => { value.sources[0].max_age_hours = 8761; }],
]) {
  test(`invalid manifest refuses context and metadata: ${name}`, (t) => {
    const { root } = fixture(t);
    editManifest(root, mutate);
    refuses(() => renderStarter(root), 'invalid_manifest');
    refuses(() => inspectStarter(root), 'invalid_manifest');
  });
}

test('malformed manifest errors do not repeat private source text', (t) => {
  const { root } = fixture(t);
  const privateText = 'PRIVATE-MALFORMED-MANIFEST-aa773c';
  writeFileSync(join(root, 'manifest.json'), `{"${privateText}":`, { mode: 0o600 });
  refuses(() => renderStarter(root), 'invalid_manifest', privateText);
  refuses(() => inspectStarter(root), 'invalid_manifest', privateText);
});

for (const [name, duplicate] of [
  ['top-level member', (text) => text.replace('"context_budget_bytes":16384', '"context_budget_bytes":1024,"context_budget_bytes":16384')],
  ['source selection', (text) => text.replace('"enabled":true', '"enabled":false,"enabled":true')],
  ['escaped source selection', (text) => text.replace('"enabled":true', '"enabled":false,"en\\u0061bled":true')],
]) {
  test(`duplicate manifest members cannot conceal an earlier value: ${name}`, (t) => {
    const { root } = fixture(t);
    const original = JSON.stringify(manifest(root));
    const ambiguous = duplicate(original);
    assert.notEqual(ambiguous, original);
    writeFileSync(join(root, 'manifest.json'), ambiguous, { mode: 0o600 });
    refuses(() => renderStarter(root), 'invalid_manifest');
    refuses(() => inspectStarter(root), 'invalid_manifest');
  });
}

test('ordinary escaped JSON keys remain valid when they are not duplicates', (t) => {
  const { root } = fixture(t);
  const original = JSON.stringify(manifest(root));
  const escaped = original.replace('"enabled":true', '"en\\u0061bled":true');
  assert.notEqual(escaped, original);
  writeFileSync(join(root, 'manifest.json'), escaped, { mode: 0o600 });
  assert.equal(source(renderStarter(root), 'foundations').status, 'included');
});

test('a BOM-prefixed manifest remains readable and is fingerprinted without rewriting it', (t) => {
  const { root } = fixture(t);
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(join(root, 'manifest.json'))]);
  writeFileSync(join(root, 'manifest.json'), bytes, { mode: 0o600 });
  assert.equal(renderStarter(root).manifest_sha256, hash(bytes));
  assert.equal(inspectStarter(root).manifest_sha256, hash(bytes));
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), bytes);
});

test('excessively nested manifest input produces a bounded public error', (t) => {
  const { root } = fixture(t);
  const depth = 1000;
  const nested = `${'{"x":'.repeat(depth)}0${'}'.repeat(depth)}`;
  writeFileSync(join(root, 'manifest.json'), nested, { mode: 0o600 });
  refuses(() => renderStarter(root), 'invalid_manifest');
});

for (const [name, bytes] of [
  ['broken UTF-8', Buffer.from([0xc3, 0x28])],
  ['NUL', Buffer.from('before\0after')],
  ['terminal escape', Buffer.from('before\u001b[31mafter')],
]) {
  test(`unusable source bytes are omitted: ${name}`, (t) => {
    const { root } = fixture(t);
    only(root, ['orientation']);
    put(root, 'orientation', bytes);
    const bundle = renderStarter(root);
    assert.equal(source(bundle, 'orientation').status, 'invalid_utf8');
    assert.equal(Object.hasOwn(source(bundle, 'orientation'), 'content'), false);
    assert.equal(bundle.used_bytes, 0);
    assert.equal(source(inspectStarter(root), 'orientation').status, 'invalid_utf8');
  });
}

test('ordinary tabs and line endings survive without byte normalization', (t) => {
  const { root } = fixture(t);
  const content = 'field\tvalue\r\n下一行\n';
  put(root, 'orientation', content);
  assert.equal(source(renderStarter(root), 'orientation').content, content);
  assert.equal(source(renderStarter(root), 'orientation').sha256, hash(content));
});

test('a UTF-8 byte order mark is preserved as source data and counted in the budget', (t) => {
  const { root } = fixture(t);
  only(root, ['orientation']);
  const content = '\ufeffA record saved by a BOM-writing editor.\n';
  put(root, 'orientation', content);
  const bundle = renderStarter(root);
  const item = source(bundle, 'orientation');
  assert.equal(item.content, content);
  assert.equal(item.bytes, Buffer.byteLength(item.content));
  assert.equal(bundle.used_bytes, Buffer.byteLength(content));
  assert.equal(item.sha256, hash(content));
});

test('nonregular sources are omitted and disabled nonregular sources remain disabled', (t) => {
  const { root } = fixture(t);
  unlinkSync(join(root, FILES.orientation));
  mkdirSync(join(root, FILES.orientation), { mode: 0o700 });
  unlinkSync(join(root, FILES.identity));
  mkdirSync(join(root, FILES.identity), { mode: 0o700 });
  const bundle = renderStarter(root);
  assert.equal(source(bundle, 'orientation').status, 'unsafe_file');
  assert.equal(source(bundle, 'identity').status, 'disabled');
  assert.equal(source(inspectStarter(root), 'identity').status, 'unsafe_file');
});

test('source symlinks and hardlinks never import their target content', { skip: POSIX_ONLY }, (t) => {
  const { parent, root } = fixture(t);
  const privateText = 'PRIVATE-OUTSIDE-CONTEXT-a1b8';
  const outside = join(parent, 'outside.txt');
  writeFileSync(outside, privateText, { mode: 0o600 });
  unlinkSync(join(root, FILES.orientation));
  symlinkSync(outside, join(root, FILES.orientation));
  unlinkSync(join(root, FILES.handoff));
  linkSync(outside, join(root, FILES.handoff));
  const bundle = renderStarter(root);
  assert.equal(source(bundle, 'orientation').status, 'unsafe_file');
  assert.equal(source(bundle, 'handoff').status, 'unsafe_file');
  assert.ok(!JSON.stringify(bundle).includes(privateText));
});

test('an existing parent alias is resolved but a symlink starter root is refused', { skip: POSIX_ONLY }, (t) => {
  const { parent } = fixture(t, { initialize: false });
  const realParent = join(parent, 'real-parent');
  mkdirSync(realParent, { mode: 0o700 });
  const aliasParent = join(parent, 'parent-alias');
  symlinkSync(realParent, aliasParent);
  initStarter(join(aliasParent, 'starter'));
  assert.equal(renderStarter(join(realParent, 'starter')).format, 'agenttool-local-context/v1');
  const aliasRoot = join(parent, 'root-alias');
  symlinkSync(join(realParent, 'starter'), aliasRoot);
  refuses(() => renderStarter(aliasRoot), 'unsafe_root');
  refuses(() => inspectStarter(aliasRoot), 'unsafe_root');
});

test('manifest symlinks and hardlinks are fatal rather than substituted configuration', { skip: POSIX_ONLY }, (t) => {
  const { parent, root } = fixture(t);
  const bytes = readFileSync(join(root, 'manifest.json'));
  const outside = join(parent, 'outside-manifest.json');
  writeFileSync(outside, bytes, { mode: 0o600 });
  unlinkSync(join(root, 'manifest.json'));
  symlinkSync(outside, join(root, 'manifest.json'));
  refuses(() => renderStarter(root), 'manifest_unavailable');
  unlinkSync(join(root, 'manifest.json'));
  linkSync(outside, join(root, 'manifest.json'));
  refuses(() => inspectStarter(root), 'manifest_unavailable');
});

test('POSIX init creates private files and refuses subsequently shared roots or records', { skip: POSIX_ONLY }, (t) => {
  const { root } = fixture(t);
  assert.equal(lstatSync(root).mode & 0o777, 0o700);
  for (const name of readdirSync(root)) assert.equal(lstatSync(join(root, name)).mode & 0o777, 0o600);
  chmodSync(join(root, FILES.orientation), 0o644);
  assert.equal(source(renderStarter(root), 'orientation').status, 'unsafe_file');
  chmodSync(root, 0o755);
  refuses(() => renderStarter(root), 'unsafe_root');
  refuses(() => inspectStarter(root), 'unsafe_root');
  chmodSync(root, 0o700);
  chmodSync(join(root, 'manifest.json'), 0o644);
  refuses(() => renderStarter(root), 'manifest_unavailable');
});

test('handoff writes are fixed-target, compare-and-swap updates with a content-free receipt', (t) => {
  const { root } = fixture(t);
  const before = Object.fromEntries(readdirSync(root).map((name) => [name, readFileSync(join(root, name))]));
  const previous = hash(before['handoff.md']);
  const content = 'PRIVATE-HANDOFF-6c51: 下一步檢查來源。\n';
  const receipt = writeHandoff(root, content, previous);
  assert.equal(receipt.format, 'agenttool-local-write/v1');
  assert.equal(receipt.source, 'handoff');
  assert.equal(receipt.previous_sha256, previous);
  assert.equal(receipt.sha256, hash(content));
  assert.equal(receipt.bytes, Buffer.byteLength(content));
  assert.equal(receipt.durability, 'file-fsync-and-rename');
  assert.ok(!JSON.stringify(receipt).includes(content));
  assert.equal(readFileSync(join(root, 'handoff.md'), 'utf8'), content);
  assert.deepEqual(readdirSync(root).sort(), Object.keys(before).sort());
  for (const [name, bytes] of Object.entries(before)) {
    if (name !== 'handoff.md') assert.deepEqual(readFileSync(join(root, name)), bytes);
  }
  assert.equal(source(renderStarter(root), 'handoff').sha256, receipt.sha256);
  if (process.platform !== 'win32') assert.equal(lstatSync(join(root, 'handoff.md')).mode & 0o777, 0o600);
});

test('a stale handoff hash cannot overwrite an intervening manual edit', (t) => {
  const { root } = fixture(t);
  const previous = hash(readFileSync(join(root, 'handoff.md')));
  const intervening = 'An independent writer has recorded a newer decision.';
  put(root, 'handoff', intervening);
  const namesBefore = readdirSync(root).sort();
  refuses(() => writeHandoff(root, 'My outdated draft.', previous), 'write_conflict');
  assert.equal(readFileSync(join(root, 'handoff.md'), 'utf8'), intervening);
  assert.deepEqual(readdirSync(root).sort(), namesBefore);
});

test('an ambiguous rename reports uncertainty and an old hash cannot replay the write', (t) => {
  const { root } = fixture(t);
  faultProcess(root, `
    const previous = core.inspectStarter(root).sources.find((item) => item.id === 'handoff').sha256;
    const original = fs.renameSync;
    let triggered = false;
    fs.renameSync = (...args) => {
      const result = original(...args);
      triggered = true;
      throw ioFailure();
    };
    syncBuiltinESMExports();
    assert.throws(() => core.writeHandoff(root, 'The replacement reached the filesystem.', previous),
      (error) => error.code === 'write_uncertain');
    assert.equal(triggered, true);
    fs.renameSync = original;
    syncBuiltinESMExports();
    assert.equal(fs.readFileSync(join(root, 'handoff.md'), 'utf8'), 'The replacement reached the filesystem.');
    assert.notEqual(core.inspectStarter(root).sources.find((item) => item.id === 'handoff').sha256, previous);
    assert.throws(() => core.writeHandoff(root, 'Unsafe automatic retry.', previous),
      (error) => error.code === 'write_conflict');
    assert.equal(fs.existsSync(join(root, '.handoff.lock')), false);
  `);
  assert.equal(readFileSync(join(root, 'handoff.md'), 'utf8'), 'The replacement reached the filesystem.');
});

test('an existing cooperative lock is preserved and never stolen', (t) => {
  const { root } = fixture(t);
  const before = readFileSync(join(root, 'handoff.md'));
  const lock = join(root, '.handoff.lock');
  writeFileSync(lock, '', { mode: 0o600 });
  const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  utimesSync(lock, past, past);
  const lockBefore = lstatSync(lock);
  refuses(() => writeHandoff(root, 'A second concurrent writer.', hash(before)), 'write_locked');
  assert.deepEqual(readFileSync(join(root, 'handoff.md')), before);
  assert.equal(lstatSync(lock).ino, lockBefore.ino);
  assert.equal(lstatSync(lock).mtimeMs, lockBefore.mtimeMs);
  assert.equal(readFileSync(lock).length, 0);
});

test('handoff writes validate expected fingerprints before changing any file', (t) => {
  const { root } = fixture(t);
  const before = readFileSync(join(root, 'handoff.md'));
  for (const invalid of ['', '0'.repeat(63), 'G'.repeat(64), null]) {
    refuses(() => writeHandoff(root, 'New record.', invalid), 'invalid_expected_hash');
  }
  assert.deepEqual(readFileSync(join(root, 'handoff.md')), before);
  assert.equal(existsSync(join(root, '.handoff.lock')), false);
});

test('handoff limits count UTF-8 bytes and reject controls without partial writes', (t) => {
  const { root } = fixture(t);
  editManifest(root, (value) => { value.sources.find((item) => item.id === 'handoff').max_bytes = 6; });
  put(root, 'handoff', 'old');
  const before = hash('old');
  for (const invalid of ['愛愛a', 'bad\0', '\u001b[31m', '\ud800']) {
    refuses(() => writeHandoff(root, invalid, before), 'invalid_handoff');
    assert.equal(readFileSync(join(root, 'handoff.md'), 'utf8'), 'old');
    assert.equal(existsSync(join(root, '.handoff.lock')), false);
  }
  const receipt = writeHandoff(root, '愛愛', before);
  assert.equal(receipt.bytes, 6);
  assert.equal(readFileSync(join(root, 'handoff.md'), 'utf8'), '愛愛');
});

test('writing a disabled handoff does not opt it into future context', (t) => {
  const { root } = fixture(t);
  only(root, ['foundations']);
  const before = hash(readFileSync(join(root, 'handoff.md')));
  writeHandoff(root, 'Saved but not selected.', before);
  assert.equal(source(renderStarter(root), 'handoff').status, 'disabled');
  assert.equal(source(inspectStarter(root), 'handoff').sha256, hash('Saved but not selected.'));
});

test('unsafe handoff aliases cannot be updated through the fixed write command', { skip: POSIX_ONLY }, (t) => {
  const { parent, root } = fixture(t);
  const outside = join(parent, 'other-owner-record.md');
  const before = 'Record belonging to another path.';
  writeFileSync(outside, before, { mode: 0o600 });
  unlinkSync(join(root, 'handoff.md'));
  linkSync(outside, join(root, 'handoff.md'));
  refuses(() => writeHandoff(root, 'Replacement.', hash(before)), 'unsafe_handoff');
  assert.equal(readFileSync(outside, 'utf8'), before);
  assert.equal(existsSync(join(root, '.handoff.lock')), false);
});

test('independent starter roots neither read nor update one another', (t) => {
  const first = fixture(t);
  const second = fixture(t);
  put(first.root, 'handoff', 'Only the first project.');
  put(second.root, 'handoff', 'Only the second project.');
  const beforeSecond = readFileSync(join(second.root, 'handoff.md'));
  writeHandoff(first.root, 'First project continues.', hash('Only the first project.'));
  assert.deepEqual(readFileSync(join(second.root, 'handoff.md')), beforeSecond);
  assert.ok(!JSON.stringify(renderStarter(first.root)).includes('Only the second project.'));
  assert.ok(!JSON.stringify(renderStarter(second.root)).includes('First project continues.'));
});
