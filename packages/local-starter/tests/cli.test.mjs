import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, cpSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAdapter, AdapterError } from '../src/adapters.mjs';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const PRIVATE_TEXT = 'fixture-private-record-never-in-error-output';

function run(args, { cli = CLI, input = undefined } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    input, encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024,
  });
  assert.ifError(result.error);
  return result;
}

function fixture(t, { copyCli = false } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "local starter's $literal "));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dir = path.join(parent, "core's files");
  let cli = CLI;
  if (copyCli) {
    const copied = path.join(parent, "code's files");
    cpSync(SRC, copied, { recursive: true });
    cli = path.join(copied, 'cli.mjs');
  }
  const init = run(['init', '--dir', dir], { cli });
  assert.equal(init.status, 0, init.stderr);
  return { dir, cli, parent };
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function expectSafeError(result, expectedStatus = undefined) {
  if (expectedStatus !== undefined) assert.equal(result.status, expectedStatus);
  else assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^agenttool-local-starter: (?:hook skipped: )?(?:[A-Z][A-Z0-9_]+|[a-z][a-z0-9_]+)\n$/u);
  assert.ok(!result.stderr.includes(PRIVATE_TEXT));
}

test('help needs no state; strict flags cannot accidentally initialize a directory', (t) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'local-starter-flags-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'must-not-exist');
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /never install settings/u);
  for (const args of [
    [], ['oops'], ['init', '--dir'], ['init', '--dir', dir, '--force', 'true'],
    ['init', '--dir', dir, '--dir', dir], ['init', '--dir', dir, 'extra'],
    ['init', '--dir', dir, '--help'], ['render', '--dir', dir, '--format', 'yaml'],
    ['handoff', '--dir', dir, '--expect', 'not-a-hash'],
  ]) expectSafeError(run(args), 2);
  assert.equal(existsSync(dir), false);
});

test('init, metadata status and rendering work with spaces and apostrophes in both CLI and data paths', (t) => {
  const { dir, cli } = fixture(t, { copyCli: true });
  assert.ok(existsSync(path.join(dir, 'manifest.json')));
  const repeated = run(['init', '--dir', dir], { cli });
  expectSafeError(repeated);
  assert.match(repeated.stderr, /: already_exists\n$/u);
  writeFileSync(path.join(dir, 'preferences.md'), PRIVATE_TEXT);
  const status = run(['status', '--dir', dir], { cli });
  assert.equal(status.status, 0, status.stderr);
  assert.doesNotThrow(() => JSON.parse(status.stdout));
  assert.ok(!status.stdout.includes(PRIVATE_TEXT));
  assert.ok(status.stdout.includes(hash(readFileSync(path.join(dir, 'handoff.md')))));
  const rendered = run(['render', '--dir', dir, '--format', 'json'], { cli });
  assert.equal(rendered.status, 0, rendered.stderr);
  const bundle = JSON.parse(rendered.stdout);
  assert.equal(bundle.format, 'agenttool-local-context/v1');
  assert.ok(bundle.sources.some(source => source.id === 'foundations' && source.status === 'included'));
  assert.ok(bundle.sources.some(source => source.id === 'preferences' && source.status === 'disabled'));
  assert.ok(!rendered.stdout.includes(PRIVATE_TEXT));
  const markdown = run(['render', '--dir', dir], { cli });
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.ok(markdown.stdout.length > 0);
});

test('handoff stdin is a bounded compare-and-swap update and a stale hash leaves the new record intact', (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'handoff.md');
  const expected = hash(readFileSync(file));
  const next = 'Next step: verify the local fixture.\n';
  const updated = run(['handoff', '--dir', dir, '--expect', expected], { input: next });
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(readFileSync(file, 'utf8'), next);
  const stale = run(['handoff', '--dir', dir, '--expect', expected], { input: PRIVATE_TEXT });
  expectSafeError(stale);
  assert.match(stale.stderr, /: write_conflict\n$/u);
  assert.equal(readFileSync(file, 'utf8'), next);
  expectSafeError(run(['handoff', '--dir', dir, '--expect', hash(next)], { input: Buffer.alloc(16385, 120) }), 2);
  assert.equal(readFileSync(file, 'utf8'), next);
  expectSafeError(run(['handoff', '--dir', dir, '--expect', hash(next)], { input: Buffer.from([0xff]) }), 2);
  assert.equal(readFileSync(file, 'utf8'), next);
});

test('handoff preserves a UTF-8 BOM, Unicode, and CRLF bytes exactly', (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'handoff.md');
  const expected = hash(readFileSync(file));
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('A reviewed handoff: 雨夜\r\n', 'utf8')]);
  const updated = run(['handoff', '--dir', dir, '--expect', expected], { input: bytes });
  assert.equal(updated.status, 0, updated.stderr);
  assert.deepEqual(readFileSync(file), bytes);
  const receipt = JSON.parse(updated.stdout);
  assert.equal(receipt.sha256, hash(bytes));
  assert.equal(receipt.bytes, bytes.length);
});

const SLOT_FILES = { handoff: 'handoff.md', memory: 'memories.md' };
const STRESS_ROUNDS = Math.max(1, Number.parseInt(process.env.LOCAL_STARTER_STRESS_ROUNDS ?? '', 10) || 12);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Start one real CLI writer. The caller decides when its stdin bytes and EOF
// arrive, so a test can make the producer slower than the writer process.
// A stdin error (EPIPE after an early exit) is recorded, not thrown, so the
// child's own exit status and stderr remain the diagnosis.
function startWriter(t, { command = 'handoff', dir, expected, input, stdin = 'pipe' }) {
  const child = spawn(process.execPath, [CLI, command, '--dir', dir, '--expect', expected], { stdio: [stdin, 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdinError;
  child.stdin?.on('error', error => { stdinError = error.code ?? 'error'; });
  const done = new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Fixture writer exceeded its deadline'));
    }, 10_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr, input, stdinError });
    });
  });
  return { child, done, input };
}

// Feed stdin as a producer would: everything at once, the first half with a
// late remainder and EOF, nothing until the gap has passed, or everything at
// once from a busy parent. In that last ("starved") shape the bytes leave
// synchronously but EOF waits for this event loop, which is what a loaded CI
// test runner did when the old CLI reported INTERNAL_ERROR.
async function deliver(writer, { mode = 'immediate', gap = 0 } = {}) {
  const { child: { stdin }, input } = writer;
  if (mode === 'late') await pause(gap);
  if (mode === 'split') {
    const middle = Math.floor(input.length / 2);
    stdin.write(input.slice(0, middle));
    await pause(gap);
    stdin.end(input.slice(middle));
    return;
  }
  stdin.end(input);
  if (mode === 'starved') {
    const until = Date.now() + gap;
    while (Date.now() < until) { /* Hold the event loop so EOF stays pending. */ }
  }
}

function assertWritten(result, file, expected) {
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdinError, undefined);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.previous_sha256, expected);
  assert.equal(receipt.sha256, hash(result.input));
  assert.equal(receipt.bytes, Buffer.byteLength(result.input));
  assert.equal(readFileSync(file, 'utf8'), result.input);
  assert.equal(hash(readFileSync(file)), receipt.sha256);
}

// Every contender is a real process holding one expected hash: exactly one may
// replace the slot, and every other one must report a typed refusal.
function assertOneWinner(results, { dir, command, expected }) {
  assert.ok(results.every(result => result.signal === null));
  const losers = results.filter(result => result.status !== 0);
  for (const loser of losers) {
    expectSafeError(loser, 1);
    assert.match(loser.stderr, /: write_(?:locked|conflict)\n$/u);
  }
  assert.equal(losers.length, results.length - 1);
  assertWritten(results.find(result => result.status === 0), path.join(dir, SLOT_FILES[command]), expected);
  assert.ok(results.every(result => result.stdinError === undefined));
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith(`.${command}`)), []);
}

test('four real CLI writers using one expected hash produce one winner and clean up their own lock/temp files', { timeout: 20_000 }, async (t) => {
  const { dir } = fixture(t);
  const expected = hash(readFileSync(path.join(dir, 'handoff.md')));
  // Start every process before sending EOF so the writers overlap rather than
  // reducing this check to a sequence of stale-hash invocations.
  const writers = Array.from({ length: 4 }, (_, i) =>
    startWriter(t, { dir, expected, input: `Concurrent fixture writer ${i}.\n` }));
  const allDone = Promise.all(writers.map(writer => writer.done));
  for (const writer of writers) await deliver(writer);
  assertOneWinner(await allDone, { dir, command: 'handoff', expected });
});

// Regression: reading stdin through process.stdin switched the pipe to
// O_NONBLOCK, so a producer that had not yet sent EOF made readSync throw
// EAGAIN and the CLI report INTERNAL_ERROR instead of contending for the lock.
test('handoff and memory wait for a slow stdin producer instead of failing internally', { timeout: 20_000 }, async (t) => {
  const runs = [];
  for (const mode of ['split', 'late', 'starved']) {
    const { dir } = fixture(t);
    for (const command of ['handoff', 'memory']) {
      const file = path.join(dir, SLOT_FILES[command]);
      const expected = hash(readFileSync(file));
      const writer = startWriter(t, { command, dir, expected, input: `A ${command} from a ${mode} producer.\n` });
      runs.push({ file, expected, mode, writer });
    }
  }
  // The gap is far longer than a Node start-up, so each writer is already
  // reading when its producer pauses or its parent is too busy to send EOF.
  await Promise.all(runs.map(({ mode, writer }) => deliver(writer, { mode, gap: 750 })));
  for (const { file, expected, writer } of runs) assertWritten(await writer.done, file, expected);
});

test('an inherited non-blocking stdin descriptor waits for its producer', { skip: process.platform === 'win32', timeout: 20_000 }, async (t) => {
  const { dir, parent } = fixture(t);
  const fifo = path.join(parent, 'stdin.fifo');
  const made = spawnSync('mkfifo', ['-m', '600', fifo], { encoding: 'utf8', timeout: 5_000 });
  if (made.error?.code === 'ENOENT') {
    t.skip('mkfifo is unavailable; no FIFO was created');
    return;
  }
  assert.ifError(made.error);
  assert.equal(made.status, 0, made.stderr);
  const file = path.join(dir, 'handoff.md');
  const expected = hash(readFileSync(file));
  const input = 'Written through an inherited non-blocking descriptor.\n';
  const readFd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writeFd = openSync(fifo, constants.O_WRONLY);
  try {
    const writer = startWriter(t, { dir, expected, input, stdin: readFd });
    // spawn() clears O_NONBLOCK on a child's stdio. A socket handle on the
    // shared FIFO description sets it again, as a host handing over a
    // non-blocking descriptor would; destroying it closes only this copy.
    new net.Socket({ fd: readFd, readable: false, writable: false }).destroy();
    writeSync(writeFd, input.slice(0, 10));
    await pause(750);
    // An early exit would surface here as EPIPE; keep the child's code as the diagnosis.
    let pipeError;
    try { writeSync(writeFd, input.slice(10)); } catch (error) { pipeError = error.code; }
    closeSync(writeFd);
    assertWritten(await writer.done, file, expected);
    assert.equal(pipeError, undefined);
  } finally {
    try { closeSync(writeFd); } catch { /* Already closed after delivery. */ }
  }
});

test(`${STRESS_ROUNDS} rounds of four writers with slow stdin producers always yield one winner and typed refusals`, { timeout: 60_000 + STRESS_ROUNDS * 5_000 }, async (t) => {
  const { dir } = fixture(t);
  const modes = ['immediate', 'split', 'late', 'starved'];
  for (let round = 0; round < STRESS_ROUNDS; round++) {
    const command = round % 2 ? 'memory' : 'handoff';
    const expected = hash(readFileSync(path.join(dir, SLOT_FILES[command])));
    const writers = Array.from({ length: 4 }, (_, i) =>
      startWriter(t, { command, dir, expected, input: `Round ${round}, ${command} writer ${i}.\n` }));
    const allDone = Promise.all(writers.map(writer => writer.done));
    // Deterministic jitter: each round mixes delivery shapes and 0-160 ms gaps,
    // so writers race for the lock while some producers are still sending.
    await Promise.all(writers.map((writer, i) =>
      deliver(writer, { mode: modes[(round + i) % modes.length], gap: ((round * 7 + i * 13) % 9) * 20 })));
    assertOneWinner(await allDone, { dir, command, expected });
  }
});

test('normal load failures are nonzero; hook load and flag failures return no context and exit zero', (t) => {
  const { dir } = fixture(t);
  writeFileSync(path.join(dir, 'manifest.json'), `{"private":"${PRIVATE_TEXT}"`);
  const failure = run(['render', '--dir', dir]);
  expectSafeError(failure, 1);
  assert.match(failure.stderr, /: invalid_manifest\n$/u);
  expectSafeError(run(['status', '--dir', dir]), 1);
  for (const harness of ['codex', 'claude-code', 'cursor']) {
    expectSafeError(run(['hook', '--dir', dir, '--harness', harness]), 0);
  }
  expectSafeError(run(['hook', '--dir', dir, '--harness', 'generic']), 0);
  expectSafeError(run(['hook', '--dir']), 0);
});

test('hook stdout uses the distinct documented schemas with no status or log contamination', (t) => {
  const { dir } = fixture(t);
  for (const harness of ['codex', 'claude-code', 'cursor']) {
    const result = run(['hook', '--dir', dir, '--harness', harness]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const response = JSON.parse(result.stdout);
    if (harness === 'cursor') {
      assert.deepEqual(Object.keys(response), ['additional_context']);
      assert.equal(typeof response.additional_context, 'string');
      assert.ok(response.additional_context.length > 0);
    } else {
      assert.deepEqual(Object.keys(response), ['hookSpecificOutput']);
      assert.equal(response.hookSpecificOutput.hookEventName, 'SessionStart');
      assert.equal(typeof response.hookSpecificOutput.additionalContext, 'string');
      assert.ok(response.hookSpecificOutput.additionalContext.length > 0);
    }
  }
});

test('adapter proposals preserve settings and expose explicit manual loading with unverified delivery', (t) => {
  const { dir, parent } = fixture(t);
  const before = readFileSync(path.join(dir, 'manifest.json'));
  const result = run(['adapter', '--dir', dir, '--harness', 'generic']);
  assert.equal(result.status, 0, result.stderr);
  const proposal = JSON.parse(result.stdout);
  assert.equal(proposal.installed, false);
  assert.equal(proposal.host_delivery, 'unverified');
  assert.equal(proposal.fragment, null);
  assert.equal(proposal.manual.argv[0], process.execPath);
  assert.ok(proposal.manual.argv.includes(dir));
  for (const name of ['.codex', '.claude', '.cursor', 'AGENTS.md', 'CLAUDE.md']) {
    assert.equal(existsSync(path.join(parent, name)), false);
    assert.equal(existsSync(path.join(dir, name)), false);
  }
  assert.deepEqual(readFileSync(path.join(dir, 'manifest.json')), before);
});

test('POSIX command fragments and Claude argument vectors run the fixture CLI literally, not a real host session', { skip: process.platform === 'win32' }, (t) => {
  const { dir, cli } = fixture(t, { copyCli: true });
  for (const harness of ['codex', 'claude-code', 'cursor']) {
    const proposal = createAdapter({ harness, dir, cliPath: cli });
    const handler = harness === 'cursor'
      ? proposal.fragment.hooks.sessionStart[0]
      : proposal.fragment.hooks.SessionStart[0].hooks[0];
    const result = harness === 'claude-code'
      ? spawnSync(handler.command, handler.args, { encoding: 'utf8', timeout: 10_000 })
      : spawnSync('/bin/sh', ['-c', handler.command], { encoding: 'utf8', timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.ok(harness === 'cursor' ? response.additional_context : response.hookSpecificOutput.additionalContext);
  }
});

test('native Windows proposal uses literal Claude argv; unsupported shell contracts refuse rather than guess', () => {
  const args = {
    dir: "C:\\Local files\\reader's $notes", cliPath: "C:\\Local files\\reader's tool\\cli.mjs",
    nodePath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32',
  };
  const claude = createAdapter({ ...args, harness: 'claude-code' });
  const command = claude.fragment.hooks.SessionStart[0].hooks[0];
  assert.equal(command.command, args.nodePath);
  assert.equal(command.args[0], args.cliPath);
  assert.ok(command.args.includes(args.dir));
  assert.equal(command.shell, undefined);
  for (const harness of ['codex', 'cursor']) {
    assert.throws(() => createAdapter({ ...args, harness }), error => error instanceof AdapterError && error.code === 'UNSUPPORTED_HOOK_PLATFORM');
  }
  assert.equal(createAdapter({ ...args, harness: 'generic' }).fragment, null);
});

test('adapter validation rejects path control characters without echoing private input', () => {
  assert.throws(() => createAdapter({ harness: 'codex', dir: `${PRIVATE_TEXT}\ninvalid` }), error => error instanceof AdapterError && error.code === 'INVALID_PATH' && !error.message.includes(PRIVATE_TEXT));
  assert.throws(() => createAdapter({ harness: PRIVATE_TEXT, dir: '/example' }), error => error instanceof AdapterError && error.code === 'INVALID_HARNESS');
});

test('maximum content budget remains intact while encoded JSON/hook stdout stays bounded', (t) => {
  const { dir } = fixture(t);
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.context_budget_bytes = 32768;
  for (const source of manifest.sources) {
    source.enabled = ['foundations', 'orientation'].includes(source.id);
    source.max_bytes = 16384;
  }
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const escaped = '\\\t\n"'.repeat(4096);
  assert.equal(Buffer.byteLength(escaped), 16384);
  writeFileSync(path.join(dir, 'foundations.md'), escaped);
  writeFileSync(path.join(dir, 'orientation.md'), escaped);
  for (const args of [
    ['render', '--dir', dir, '--format', 'json'],
    ['render', '--dir', dir],
    ['hook', '--dir', dir, '--harness', 'codex'],
    ['hook', '--dir', dir, '--harness', 'claude-code'],
    ['hook', '--dir', dir, '--harness', 'cursor'],
    ['status', '--dir', dir],
    ['adapter', '--dir', dir, '--harness', 'generic'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(Buffer.byteLength(result.stdout) <= 131072);
    if (args.includes('json')) {
      const bundle = JSON.parse(result.stdout);
      assert.equal(bundle.used_bytes, 32768);
      assert.equal(bundle.sources.find(source => source.id === 'foundations').content, escaped);
      assert.equal(bundle.sources.find(source => source.id === 'orientation').content, escaped);
    }
  }
});

test('final stdout boundary rejects an oversized serialized payload atomically and hooks still fail open', (t) => {
  const { dir, cli } = fixture(t, { copyCli: true });
  // A controlled core substitute isolates the CLI transport boundary. Current
  // valid records are smaller; this catches future upstream shape/budget drift.
  writeFileSync(path.join(path.dirname(cli), 'core.mjs'), `
    export class StarterError extends Error {}
    const text = String.fromCharCode(92).repeat(70000);
    export function renderStarter() { return { content: text }; }
    export function formatMarkdown() { return text; }
    export function inspectStarter() { return { content: text }; }
    export function initStarter() { return { content: text }; }
    export function writeHandoff() { return { content: text }; }
    export function writeMemory() { return { content: text }; }
  `);
  for (const args of [
    ['init', '--dir', dir], ['status', '--dir', dir],
    ['render', '--dir', dir, '--format', 'json'],
    ['handoff', '--dir', dir, '--expect', 'a'.repeat(64)],
    ['memory', '--dir', dir, '--expect', 'a'.repeat(64)],
  ]) {
    const result = run(args, { cli, input: '' });
    expectSafeError(result, 2);
    assert.match(result.stderr, /: OUTPUT_TOO_LARGE\n$/u);
  }
  for (const harness of ['codex', 'claude-code', 'cursor']) {
    const result = run(['hook', '--dir', dir, '--harness', harness], { cli });
    expectSafeError(result, 0);
    assert.match(result.stderr, /: OUTPUT_TOO_LARGE\n$/u);
  }
  const markdown = run(['render', '--dir', dir], { cli });
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.equal(Buffer.byteLength(markdown.stdout), 70001);
});

test('FIFO sources are omitted without waiting for a writer, and FIFO manifests fail safely', { skip: process.platform === 'win32' }, (t) => {
  const { dir } = fixture(t);
  const source = path.join(dir, 'handoff.md');
  unlinkSync(source);
  const fifo = spawnSync('mkfifo', ['-m', '600', source], { encoding: 'utf8', timeout: 5_000 });
  if (fifo.error?.code === 'ENOENT') {
    t.skip('mkfifo is unavailable; no FIFO was created');
    return;
  }
  assert.ifError(fifo.error);
  assert.equal(fifo.status, 0, fifo.stderr);
  const rendered = run(['render', '--dir', dir, '--format', 'json']);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(JSON.parse(rendered.stdout).sources.find(item => item.id === 'handoff').status, 'unsafe_file');
  unlinkSync(path.join(dir, 'manifest.json'));
  const manifestFifo = spawnSync('mkfifo', ['-m', '600', path.join(dir, 'manifest.json')], { encoding: 'utf8', timeout: 5_000 });
  assert.ifError(manifestFifo.error);
  assert.equal(manifestFifo.status, 0, manifestFifo.stderr);
  const failure = run(['render', '--dir', dir]);
  expectSafeError(failure, 1);
  assert.match(failure.stderr, /: manifest_unavailable\n$/u);
  expectSafeError(run(['hook', '--dir', dir, '--harness', 'codex']), 0);
});
