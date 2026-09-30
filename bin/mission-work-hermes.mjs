/** One locally permitted Hermes work attempt. Incoming work is data, never authority. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as client from './agenttool-mission.mjs';
import { inspectWork, readSource, syncWork, advanceWork } from './mission-work.mjs';
import { WorkError, validateContract, contractDigest, validateArtifact } from './mission-work-contract.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const NATIVE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const IDS = ['identity_id', 'signing_key_id', 'grant_id', 'public_key'];
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const json = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const fail = (message, reason = 'verification_failed') => { throw new WorkError(message, reason); };
function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)))
    fail('Unexpected Hermes work document fields.');
  const copy = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Hermes work documents cannot contain accessors.');
    copy[key] = descriptor.value;
  }
  return copy;
}
function path(value) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') ||
      !isAbsolute(value) || resolve(value) !== value) fail('Choose an exact absolute local path.');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail('Expected a canonical UTC permit expiry.');
  return Date.parse(value);
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Pure validation: a local permit grants only the explicitly listed worker stages. */
export function validateHermesWorkPermit(input, inputContract) {
  const contract = validateContract(inputContract);
  const permit = object(input, ['format', 'permit_id', 'task_id', 'terms', 'worker', 'source_file',
    'expires_at', 'allowed_stages', 'runtime', 'limits']);
  if (permit.format !== 'agenttool-hermes-work-permit/v1' || typeof permit.permit_id !== 'string' || !UUID.test(permit.permit_id) ||
      permit.task_id !== contract.task_id || permit.terms !== contractDigest(contract))
    fail('The local Hermes permit must bind the exact selected work contract.');
  permit.worker = object(permit.worker, IDS);
  if (!isDeepStrictEqual(permit.worker, contract.worker)) fail('The permit must pin the exact work worker.');
  permit.source_file = path(permit.source_file);
  if (timestamp(permit.expires_at) > timestamp(contract.expires_at)) fail('The permit cannot outlive the work contract.');
  if (!Array.isArray(permit.allowed_stages) || Object.getPrototypeOf(permit.allowed_stages) !== Array.prototype ||
      Reflect.ownKeys(permit.allowed_stages).length !== permit.allowed_stages.length + 1 ||
      ![['deliver'], ['accept', 'deliver']].some(stages => isDeepStrictEqual(stages, permit.allowed_stages)))
    fail('Permit stages must be deliver, or accept followed by deliver.');
  permit.allowed_stages = [...permit.allowed_stages];
  permit.runtime = object(permit.runtime, ['kind', 'python_executable', 'hermes_root']);
  if (permit.runtime.kind !== 'hermes-selected-source/v1') fail('Unsupported Hermes work runtime profile.');
  path(permit.runtime.python_executable); path(permit.runtime.hermes_root);
  permit.limits = object(permit.limits, ['duration_seconds', 'max_jobs', 'max_deliveries']);
  if (!Number.isInteger(permit.limits.duration_seconds) || permit.limits.duration_seconds < 1 ||
      permit.limits.duration_seconds > 900 || permit.limits.max_jobs !== 1 || permit.limits.max_deliveries !== 1)
    fail('Hermes work permits allow one job and delivery within 1–900 seconds.');
  return freeze(permit);
}

function directory(at) {
  const st = lstatSync(at);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077) || realpathSync(at) !== at)
    fail('Hermes work directories must be owned real directories with mode 0700.');
}
function durableDirectory(at) {
  mkdirSync(at, { mode: 0o700 });
  const fd = openSync(dirname(at), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function mkdir(at) {
  try { durableDirectory(at); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  directory(at);
}
function privateJson(at, max = 65536) {
  try { return JSON.parse(client.privateRead(at, max)); } catch { fail('Cannot read the selected bounded private Hermes work record.'); }
}
function runtimeFiles(runtime) {
  const executable = lstatSync(realpathSync(runtime.python_executable));
  const root = lstatSync(runtime.hermes_root);
  if (!executable.isFile() || !(executable.mode & 0o111) || (executable.mode & 0o022) ||
      ![0, process.getuid()].includes(executable.uid) || !root.isDirectory() ||
      root.uid !== process.getuid() || (root.mode & 0o022) || realpathSync(runtime.hermes_root) !== runtime.hermes_root)
    fail('Select an owned Hermes source directory and a trusted executable.');
}
function runtimePin() {
  let input;
  try {
    const bytes = readFileSync(new URL('./mission-work-hermes-runtime.json', import.meta.url));
    if (bytes.length > 65536) fail('Hermes runtime pin exceeds its fixed bound.');
    input = JSON.parse(bytes.toString('utf8'));
  } catch { fail('Cannot read the selected Hermes runtime compatibility pin.'); }
  const p = object(input, ['format', 'commit', 'tracked_diff_sha256', 'files', 'fingerprint']);
  if (p.format !== 'agenttool-hermes-runtime-pin/v1' || !/^[0-9a-f]{40}$/.test(p.commit ?? '') ||
      !SHA.test(p.tracked_diff_sha256 ?? '') || !SHA.test(p.fingerprint ?? '') || !p.files ||
      typeof p.files !== 'object' || Array.isArray(p.files) || !Object.keys(p.files).length ||
      Object.keys(p.files).length > 100 || Object.entries(p.files).some(([name, digest]) =>
        isAbsolute(name) || name.split('/').some(part => ['', '.', '..'].includes(part)) || !SHA.test(digest)))
    fail('Invalid Hermes runtime compatibility pin.');
  if (hash(canonical({ commit: p.commit, tracked_diff_sha256: p.tracked_diff_sha256, files: p.files })) !== p.fingerprint)
    fail('Hermes runtime compatibility pin fingerprint does not match.');
  return p;
}
function selected(state, inputContract, inputPermit) {
  const contract = validateContract(inputContract), permit = validateHermesWorkPermit(inputPermit, contract);
  const inspected = inspectWork(state, contract);
  if (inspected.role !== 'worker') fail('Only the pinned worker can run this local permit.');
  runtimeFiles(permit.runtime);
  if (realpathSync(permit.source_file) !== permit.source_file) fail('The selected source path must not contain symlinks.');
  const sourceBytes = readSource(permit.source_file, contract);
  const root = join(client.stateRoot(state), 'work', contract.task_id, 'hermes-execution');
  return { contract, permit, sourceBytes, root, terms: contractDigest(contract), permitDigest: hash(canonical(permit)),
    pinnedRuntime: runtimePin() };
}

/** Local inspection never creates an attempt, contacts the service, or starts a model. */
export function inspectHermesWork(state, inputContract, inputPermit) {
  const s = selected(state, inputContract, inputPermit);
  let attempt = null;
  if (existsSync(s.root)) {
    directory(s.root);
    attempt = { reserved: true, running_lock: existsSync(join(s.root, 'running.lock')),
      intent: existsSync(join(s.root, 'intent.json')) ? privateJson(join(s.root, 'intent.json')) : null,
      outcome: existsSync(join(s.root, 'outcome.json')) ? privateJson(join(s.root, 'outcome.json')) : null };
  }
  return { format: 'agenttool-hermes-work-inspection/v1', task_id: s.contract.task_id, terms: s.terms,
    permit_id: s.permit.permit_id, permit_digest: s.permitDigest, allowed_stages: s.permit.allowed_stages,
    source_sha256: s.contract.source.sha256, expires_at: s.permit.expires_at, attempt,
    runtime_commit: s.pinnedRuntime.commit, runtime_sha256: s.pinnedRuntime.fingerprint,
    authority: 'one_local_hermes_attempt_and_permitted_worker_stages_only',
    confinement: 'model_tool_boundary_not_os_sandbox', review: 'separate_requester_decision' };
}

function reserve(s) {
  mkdir(dirname(dirname(s.root))); mkdir(dirname(s.root));
  try { durableDirectory(s.root); }
  catch (error) {
    if (error.code === 'EEXIST') fail('A Hermes work attempt already exists. Inspect it; no automatic launch or send is allowed.', 'attempt_exists');
    throw error;
  }
  directory(s.root);
  client.writeNew(join(s.root, 'permit.json'), json(s.permit));
  const owner = { id: randomUUID(), pid: process.pid };
  const at = join(s.root, 'running.lock'); durableDirectory(at);
  client.writeNew(join(at, 'owner.json'), json(owner));
  return () => {
    directory(at);
    if (!isDeepStrictEqual(privateJson(join(at, 'owner.json')), owner)) fail('Hermes work lock ownership changed.');
    unlinkSync(join(at, 'owner.json')); rmdirSync(at);
    const fd = openSync(s.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  };
}

function windowFor(s, parent) {
  const started = performance.now();
  let until = Math.min(Date.now() + s.permit.limits.duration_seconds * 1000,
    Date.parse(s.permit.expires_at), Date.parse(s.contract.expires_at));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(cancel, Math.max(0, until - Date.now())); };
  arm();
  return {
    signal: controller.signal,
    limit(expiry) { until = Math.min(until, Date.parse(expiry)); arm(); },
    remaining: () => Math.max(0, Math.min(until - Date.now(), s.permit.limits.duration_seconds * 1000 - (performance.now() - started))),
    check() {
      if (parent?.aborted) fail('Hermes work was cancelled.', 'cancelled');
      if (Date.now() >= Date.parse(s.permit.expires_at) || Date.now() >= Date.parse(s.contract.expires_at))
        fail('The local permit or work contract expired.', 'grant_expired');
      if (controller.signal.aborted || this.remaining() <= 0) fail('The finite Hermes work window ended.', 'duration');
    },
    close() { clearTimeout(timer); parent?.removeEventListener('abort', cancel); }
  };
}
function sleep(ms, signal) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

/** Fixed subprocess, no shell/provider arguments and no ambient API credentials. */
async function nativeRunner(job, { cwd, signal, timeoutMs, runtime }) {
  const script = fileURLToPath(new URL('./mission-work-hermes-runner.py', import.meta.url));
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HERMES_SAFE_MODE: '1', PYTHONUNBUFFERED: '1' };
  for (const name of ['HOME', 'LANG', 'LC_ALL', 'TZ']) if (process.env[name]) env[name] = process.env[name];
  return new Promise((resolve, reject) => {
    let child, settled = false, problem = null, stdout = Buffer.alloc(0), stderrBytes = 0;
    let timer, killTimer, finalTimer;
    const ownedDeadline = performance.now() + timeoutMs;
    let shutdownDeadline = null;
    const kill = sig => { if (child?.pid) { try { process.kill(-child.pid, sig); } catch (error) { if (error.code !== 'ESRCH') problem ??= new WorkError('Owned Hermes cleanup could not be confirmed.', 'cleanup_unknown'); } } };
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(finalTimer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const stop = error => {
      if (problem) return; problem = error; kill('SIGTERM');
      shutdownDeadline = Math.min(ownedDeadline, performance.now() + 750);
      killTimer = setTimeout(() => kill('SIGKILL'), 250);
      finalTimer = setTimeout(() => finish(new WorkError('Owned Hermes shutdown was not confirmed; inspect before recovery.', 'cleanup_unknown')),
        Math.max(0, shutdownDeadline - performance.now()));
    };
    const abort = () => stop(new WorkError('The bounded Hermes runner was stopped.', 'runtime_stopped'));
    if (signal?.aborted || timeoutMs <= 1000) { finish(new WorkError('Insufficient bounded time for a Hermes job.', 'duration')); return; }
    try {
      child = spawn(runtime.python_executable, ['-I', '-B', script], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { finish(new WorkError('Hermes runner admission failed; this attempt remains consumed.', 'runtime_failed')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, Math.max(1, timeoutMs - 1000));
    child.on('error', () => finish(new WorkError('Hermes runner admission is unconfirmed; this attempt remains consumed.', 'runtime_failed')));
    child.stdin.on('error', () => stop(new WorkError('Hermes job input could not be delivered.', 'runtime_failed')));
    child.stdout.on('data', data => {
      if (stdout.length + data.length > 262144) { stop(new WorkError('Hermes output exceeded its fixed bound.', 'runtime_failed')); return; }
      stdout = Buffer.concat([stdout, data]);
    });
    child.stderr.on('data', data => { stderrBytes += data.length; if (stderrBytes > 262144) stop(new WorkError('Hermes diagnostics exceeded their fixed bound.', 'runtime_failed')); });
    child.on('close', async code => {
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(finalTimer);
      signal?.removeEventListener('abort', abort);
      // Every subprocess belongs to this fresh group; surviving descendants are stopped too.
      kill('SIGKILL');
      const cleanupUntil = Math.min(ownedDeadline, shutdownDeadline ?? (performance.now() + 500));
      for (;;) {
        try { process.kill(-child.pid, 0); }
        catch (error) {
          if (error.code === 'ESRCH') break;
          finish(new WorkError('Owned Hermes process-group cleanup was not confirmed.', 'cleanup_unknown')); return;
        }
        if (performance.now() >= cleanupUntil) {
          finish(new WorkError('Owned Hermes process-group cleanup was not confirmed.', 'cleanup_unknown')); return;
        }
        await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(20, cleanupUntil - performance.now()))));
      }
      if (problem) { finish(problem); return; }
      if (code !== 0) {
        const error = new WorkError('Hermes runner did not complete; inspect the private attempt before recovery.', 'runtime_failed');
        try {
          const failure = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout)), ['format', 'status', 'code']);
          if (failure.format === 'agenttool-hermes-source-result/v1' && failure.status === 'failed' &&
              typeof failure.code === 'string' && NATIVE_CODE.test(failure.code))
            error.native_code = failure.code;
        } catch { /* Only the closed native error code schema is retained, never raw diagnostics. */ }
        finish(error); return;
      }
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout))); }
      catch { finish(new WorkError('Hermes runner returned invalid bounded JSON.', 'verification_failed')); }
    });
    child.stdin.end(JSON.stringify(job));
  });
}

function validateResult(result, job, contract, sourceBytes, cwd, pinned) {
  const r = object(result, ['format', 'status', 'task_id', 'terms', 'challenge', 'artifact', 'evidence']);
  if (r.format !== 'agenttool-hermes-source-result/v1' || r.status !== 'completed' ||
      r.task_id !== job.task_id || r.terms !== job.terms || r.challenge !== job.challenge)
    fail('Hermes completion does not bind this exact fresh job.');
  validateArtifact(contract, r.artifact, sourceBytes);
  const e = object(r.evidence, ['format', 'guard', 'runtime_commit', 'runtime_sha256', 'runtime_dirty',
    'session_id', 'source_sha256', 'source_bytes', 'guard_attestation_sha256', 'read_calls',
    'final_message_id', 'final_sha256', 'forbidden_requests', 'completed']);
  if (e.format !== 'agenttool-hermes-source-evidence/v1' || e.guard !== 'pathless-source/v1' ||
      !/^[0-9a-f]{40}$/.test(e.runtime_commit ?? '') || !SHA.test(e.runtime_sha256 ?? '') ||
      typeof e.runtime_dirty !== 'boolean' || typeof e.session_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(e.session_id) || e.source_sha256 !== contract.source.sha256 ||
      e.source_bytes !== sourceBytes.length || !SHA.test(e.guard_attestation_sha256 ?? '') ||
      !SHA.test(e.final_sha256 ?? '') || !Number.isSafeInteger(e.final_message_id) || e.final_message_id < 1 ||
      e.forbidden_requests !== 0 || e.completed !== true || !Array.isArray(e.read_calls) ||
      e.read_calls.length < 1 || e.read_calls.length > 4)
    fail('Hermes native evidence is incomplete or does not match the selected source.');
  if (e.runtime_commit !== pinned.commit || e.runtime_sha256 !== pinned.fingerprint ||
      e.runtime_dirty !== (pinned.tracked_diff_sha256 !== hash('')))
    fail('Hermes native evidence does not match the locally pinned runtime.');
  const sourceResult = { format: 'agenttool-selected-source/v1', challenge: job.challenge, source: job.source };
  if (e.final_sha256 !== hash(canonical({ challenge: job.challenge, artifact: r.artifact })))
    fail('Hermes final output fingerprint does not match the returned artifact.');
  const attestation = { format: 'agenttool-hermes-source-guard/v1', guard: e.guard,
    task_id: job.task_id, terms: job.terms, challenge: job.challenge, source_sha256: e.source_sha256,
    source_bytes: e.source_bytes, session_id: e.session_id, runtime_commit: e.runtime_commit,
    runtime_sha256: e.runtime_sha256, runtime_dirty: e.runtime_dirty, allowed_tools: ['read_selected_source'],
    context: 'explicit-job-only', boundary: 'model-tool-dispatch-not-os-sandbox' };
  const attestationBytes = client.privateRead(join(cwd, 'guard-attestation.json'), 16384);
  if (attestationBytes !== canonical(attestation) || hash(attestationBytes) !== e.guard_attestation_sha256)
    fail('Hermes guard attestation does not match this private native job.');
  const toolIds = new Set(), messageIds = new Set();
  for (const value of e.read_calls) {
    const read = object(value, ['tool_call_id', 'call_message_id', 'result_message_id', 'result_sha256']);
    if (typeof read.tool_call_id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(read.tool_call_id) ||
        toolIds.has(read.tool_call_id) || !Number.isSafeInteger(read.call_message_id) || read.call_message_id < 1 ||
        !Number.isSafeInteger(read.result_message_id) || read.result_message_id <= read.call_message_id ||
        read.result_message_id >= e.final_message_id || messageIds.has(read.result_message_id) ||
        read.result_sha256 !== hash(canonical(sourceResult)))
      fail('Hermes read evidence does not describe distinct completed native tool results.');
    toolIds.add(read.tool_call_id); messageIds.add(read.result_message_id);
  }
  return { ...r, evidence: e };
}

/** Finite opt-in worker. Every existing attempt refuses automatic replay, including failures. */
export async function runHermesWork(state, inputContract, inputPermit, options = {}) {
  const s = selected(state, inputContract, inputPermit);
  if (options.runner !== undefined && typeof options.runner !== 'function') fail('Invalid local runner dependency.');
  const pollMs = options.pollIntervalMs ?? 15000;
  if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 30000) fail('Use a bounded positive poll interval.');
  const op = windowFor(s, options.signal);
  let close, result, problem;
  try {
    op.check(); close = reserve(s);
    client.writeNew(join(s.root, 'started.json'), json({ format: 'agenttool-hermes-work-attempt/v1',
      task_id: s.contract.task_id, terms: s.terms, permit_digest: s.permitDigest, started_at: new Date().toISOString() }));
    const request = () => ({ fetchImpl: options.fetchImpl, signal: op.signal });
    let projection;
    for (;;) {
      op.check(); projection = await syncWork(state, s.contract, request());
      op.limit(projection.scope.expires_at); op.check();
      if (projection.pending_intents.length) fail('An unresolved work send blocks native admission.', 'send_uncertain');
      if (projection.status === 'none') { await sleep(Math.min(pollMs, op.remaining()), op.signal); continue; }
      if (projection.status === 'offered') {
        if (!s.permit.allowed_stages.includes('accept')) fail('This permit does not authorize work acceptance.', 'acceptance_required');
        const accepted = await advanceWork(state, s.contract, 'accept', { ...request(), sourceBytes: s.sourceBytes });
        if (accepted.status === 'stored_sync_required') { result = { ...accepted, work_stage: 'accept' }; break; }
        projection = accepted.projection;
      }
      if (projection.status !== 'work_accepted') fail('The selected work is not available for one worker execution.', 'invalid_transition');
      op.check();
      const challenge = randomBytes(32).toString('hex');
      const job = { format: 'agenttool-hermes-source-job/v1', task_id: s.contract.task_id, terms: s.terms,
        source: { ...s.contract.source, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(s.sourceBytes) },
        instruction: s.contract.instruction, acceptance_criteria: s.contract.acceptance_criteria,
        challenge, hermes_root: s.permit.runtime.hermes_root };
      delete job.source.label;
      client.writeNew(join(s.root, 'intent.json'), json({ format: 'agenttool-hermes-work-execution-intent/v1',
        attempt_id: randomUUID(), task_id: s.contract.task_id, terms: s.terms, permit_digest: s.permitDigest,
        previous: projection.head, source_sha256: s.contract.source.sha256, source_bytes: s.sourceBytes.length,
        runtime_sha256: s.pinnedRuntime.fingerprint,
        challenge_sha256: hash(challenge), job_sha256: hash(canonical(job)),
        expires_at: new Date(Date.now() + op.remaining()).toISOString() }));
      const cwd = join(s.root, 'native'); durableDirectory(cwd);
      const native = await (options.runner ?? nativeRunner)(job, { cwd, signal: op.signal,
        timeoutMs: op.remaining(), runtime: s.permit.runtime });
      op.check();
      const verified = validateResult(native, job, s.contract, s.sourceBytes, cwd, s.pinnedRuntime);
      client.writeNew(join(s.root, 'native-result.json'), json(verified));
      client.writeNew(join(s.root, 'artifact.json'), json(verified.artifact));
      // The model never receives state/signing credentials. The host alone rechecks and signs.
      const current = await syncWork(state, s.contract, request()); op.check();
      if (current.pending_intents.length) fail('An unresolved work send blocks delivery.', 'send_uncertain');
      if (current.status !== 'work_accepted' || !isDeepStrictEqual(current.head, projection.head))
        fail('Work changed while Hermes was running; no delivery is authorized.', 'invalid_transition');
      result = { ...await advanceWork(state, s.contract, 'deliver', { ...request(), sourceBytes: s.sourceBytes,
        payload: verified.artifact }), work_stage: 'deliver' };
      break;
    }
    try {
      client.writeNew(join(s.root, 'outcome.json'), json({ format: 'agenttool-hermes-work-outcome/v1',
        status: result.status, event_id: result.event_id, cursor: result.cursor, stage: result.work_stage }));
    } catch {
      // A known stored event remains known even if this additional local receipt fails.
      result.local_record_failed = true;
      result.warning = 'The exact event is stored; the extra Hermes outcome record could not be saved. Inspect the existing attempt and work outbox; do not replay it.';
    }
  } catch (error) {
    problem = error;
    if (close && !existsSync(join(s.root, 'outcome.json'))) {
      try { client.writeNew(join(s.root, 'outcome.json'), json({ format: 'agenttool-hermes-work-outcome/v1',
        status: 'stopped', stop_reason: error?.stop_reason ?? 'runtime_failed',
        ...(typeof error?.native_code === 'string' && NATIVE_CODE.test(error.native_code) ? { native_code: error.native_code } : {}),
        ...(UUID.test(error?.event_id ?? '') ? { event_id: error.event_id } : {}) })); } catch { /* Preserve the primary failure and consumed attempt. */ }
    }
  } finally {
    op.close();
    if (close) try { close(); } catch {
      if (result) result.lock_remains = true;
      else if (problem) problem.lock_remains = true;
    }
  }
  if (problem) throw problem;
  return result;
}

export async function hermesWorkMain(argv) {
  const [command, ...args] = argv;
  if (!['run-hermes', 'inspect-hermes'].includes(command)) fail('Choose work run-hermes or inspect-hermes.');
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !['state', 'contract-file', 'permit-file'].includes(name) ||
        Object.hasOwn(flags, name) || !args[i + 1]) fail('Unknown, repeated or incomplete Hermes work option.');
    flags[name] = path(args[i + 1]);
  }
  for (const name of ['state', 'contract-file', 'permit-file']) path(flags[name]);
  const contract = privateJson(flags['contract-file'], 32768), permit = privateJson(flags['permit-file'], 32768);
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const result = command === 'inspect-hermes' ? inspectHermesWork(flags.state, contract, permit)
      : await runHermesWork(flags.state, contract, permit, { signal: controller.signal });
    process.stdout.write(json(result));
  } catch (error) {
    process.stderr.write(json({ stop_reason: error?.stop_reason ?? 'verification_failed',
      error: 'Hermes work stopped. Inspect this private attempt before any explicit recovery; do not replay it.',
      ...(typeof error?.native_code === 'string' && NATIVE_CODE.test(error.native_code) ? { native_code: error.native_code } : {}),
      ...(UUID.test(error?.event_id ?? '') ? { event_id: error.event_id } : {}),
      ...(error?.lock_remains ? { lock_remains: true } : {}) }));
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
