/** Explicit payment-free work over verified mission chat.
 * Contract: docs/COLLABORATION-MISSION-WORK.md.
 * No worker execution, distributed lease, payment or automatic retry.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as client from './agenttool-mission.mjs';
import * as chat from './mission-chat.mjs';
import { WorkError, validateContract, contractDigest, validateArtifact, encodeWorkRecord, projectWork } from './mission-work-contract.mjs';

const IDS = ['identity_id', 'signing_key_id', 'grant_id', 'public_key'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, reason = 'verification_failed') => { throw new WorkError(message, reason); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const pin = p => Object.fromEntries(IDS.map(k => [k, p[k]]));
const equalPin = (a, b) => IDS.every(k => a[k] === b[k]);

function local(state, input) {
  const contract = validateContract(input), participant = client.participant(state);
  if (participant.origin !== contract.origin || participant.mission_id !== contract.mission_id)
    fail('The local participant does not belong to this work mission.');
  const role = equalPin(participant, contract.requester) ? 'requester'
    : equalPin(participant, contract.worker) ? 'worker' : null;
  if (!role) fail('The local participant does not match a pinned work role.');
  const peer = contract[role === 'requester' ? 'worker' : 'requester'];
  const config = chat.validateConfig({ format: 'agenttool-mission-chat-config/v1', mission_digest: contract.mission_digest,
    conversation: contract.task_id, peer, expires_at: contract.expires_at });
  return { contract, participant, role, config, terms: contractDigest(contract) };
}

/** Selected files are read as bytes, never executed or located through remote text. */
export function readSource(path, contract) {
  if (!isAbsolute(path ?? '')) fail('Choose an absolute source-file path.');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 131072) fail('Choose a regular source file of at most 128 KiB.');
    bytes = readFileSync(fd);
  } finally { closeSync(fd); }
  verifySource(contract, bytes);
  return bytes;
}
function verifySource(contract, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== contract.source.bytes ||
      `sha256:${hash(bytes)}` !== contract.source.sha256) fail('Source bytes do not match the agreed work contract.');
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('The selected source must be valid UTF-8.'); }
}

function directory(path) {
  const st = lstatSync(path);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077) || realpathSync(path) !== path)
    fail('Work directories must be owned, real directories with mode 0700.');
}
function mkdir(path) {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  directory(path);
}
function privateJson(path, max = 65536) {
  try { return JSON.parse(client.privateRead(path, max)); }
  catch { fail('Cannot read a bounded private work record.'); }
}
function sameFile(path, value) {
  if (existsSync(path)) {
    if (!isDeepStrictEqual(privateJson(path), value)) fail('A saved work record has changed; inspect it before recovery.');
  } else client.writeNew(path, json(value));
}
function storage(state, selected) {
  const base = join(client.stateRoot(state), 'work'); mkdir(base);
  const root = join(base, selected.contract.task_id); mkdir(root);
  sameFile(join(root, 'contract.json'), selected.contract);
  mkdir(join(root, 'events')); mkdir(join(root, 'intents'));
  return root;
}
function files(path, cap) {
  directory(path);
  const names = readdirSync(path);
  if (names.length > cap) fail('Work storage limit reached; inspect it before recovery.');
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) fail('Unexpected work record filename.');
    // privateRead performs no-follow/type/ownership/size checks when read.
  }
  return names.sort();
}
function savedSubmission(state, summary, op) {
  const root = join(client.stateRoot(state), 'outbox'); directory(root);
  const names = readdirSync(root);
  if (names.length > 2000) fail('Outbox scan limit reached; inspect before work recovery.');
  const matches = [];
  for (const name of names) {
    op.check();
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    let raw, body;
    try { raw = client.privateRead(join(root, name), 8192); body = JSON.parse(raw); }
    catch { fail('Cannot inspect a saved outbox event.'); }
    if (body.summary !== summary) continue;
    if (body.event_id !== name.slice(0, -5)) fail('Outbox event does not match its filename.');
    matches.push({ event_id: body.event_id, raw_body: raw });
  }
  if (matches.length > 1) fail('Multiple outbox events match one work intent; inspect before recovery.', 'work_conflict');
  return matches[0] ?? null;
}
function lock(root) {
  const path = join(root, 'operation.lock'), owner = { id: randomUUID(), pid: process.pid };
  try { mkdirSync(path, { mode: 0o700 }); }
  catch { fail('A work operation lock exists; inspect it before explicit recovery.', 'work_in_flight'); }
  client.writeNew(join(path, 'owner.json'), json(owner));
  return () => {
    directory(path);
    if (!isDeepStrictEqual(privateJson(join(path, 'owner.json')), owner)) fail('Work operation lock ownership changed.');
    unlinkSync(join(path, 'owner.json')); rmdirSync(path);
    const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  };
}
function bounded(options, contract) {
  const remaining = Date.parse(contract.expires_at) - Date.now();
  if (remaining <= 0) fail('The work contract has expired.', 'grant_expired');
  const deadline = performance.now() + Math.min(60000, remaining);
  const timer = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(60000, remaining))));
  const signal = options.signal ? AbortSignal.any([timer, options.signal]) : timer;
  const check = () => {
    if (options.signal?.aborted) fail('Work operation cancelled.', 'cancelled');
    if (Date.now() >= Date.parse(contract.expires_at)) fail('The work contract has expired.', 'grant_expired');
    if (signal.aborted || performance.now() >= deadline) fail('The finite work operation window ended.', 'duration');
  };
  return { check, request: () => { check(); return { fetchImpl: options.fetchImpl, signal,
    timeout: Math.max(1, Math.min(20000, Math.ceil(deadline - performance.now()))) }; } };
}

/** Reuse the chat signature verifier for each direction, including saved local events. */
function verified(selected, event) {
  const { contract, participant, config } = selected;
  const isLocal = equalPin({ ...event, public_key: event?.proof?.public_key }, pin(participant));
  const item = isLocal
    ? chat.verifyChatEvent(event, { origin: contract.origin, mission_id: contract.mission_id, ...config.peer },
      { ...config, peer: pin(participant) })
    : chat.verifyChatEvent(event, participant, config);
  if (!item) return null;
  let body;
  try { body = JSON.parse(item.message.text); } catch { return null; }
  return body?.task_id === contract.task_id ? item : null;
}

/** Read-only inspection of the selected participant and work terms; creates no work files. */
export function inspectWork(state, input) {
  const selected = local(state, input);
  return { format: 'agenttool-mission-work-inspection/v1', task_id: selected.contract.task_id,
    terms: selected.terms, role: selected.role, contract: selected.contract,
    visibility: 'all_mission_readers', payment: 'NOT_REQUIRED',
    authority: 'work_evidence_only_no_execution_permission' };
}

async function refresh(state, selected, root, op) {
  const scope = await chat.inspectChat(state, selected.config, op.request());
  const all = [], ids = new Map();
  let after = '0', done = false;
  // Replay the complete admitted mission prefix, not a caller-selected cursor.
  // Completeness is relative to the trusted HTTPS service's supplied pages.
  for (let index = 0; index < 100; index++) {
    op.check();
    const page = await client.events(state, after, op.request());
    if (!page.events.length && page.page.has_more) fail('An empty work history page cannot claim more events.');
    for (const event of page.events) {
      const fingerprint = hash(JSON.stringify([event.mission_id, event.identity_id, event.grant_id,
        event.signing_key_id, event.raw_body, event.body_sha256]));
      if (ids.has(event.event_id)) fail('The mission prefix repeats an event UUID.');
      ids.set(event.event_id, fingerprint);
      const item = verified(selected, event);
      if (item) all.push(item);
    }
    after = page.page.next_cursor;
    if (!page.page.has_more) { done = true; break; }
  }
  if (!done) fail('The finite mission history limit was reached.', 'scan_limit');
  op.check();
  const current = local(state, selected.contract);
  if (!isDeepStrictEqual(current, selected)) fail('The selected local participant changed during the work operation.');
  const savedNames = files(join(root, 'events'), 100), seen = new Map(all.map(item => [item.event_id, item]));
  for (const name of savedNames) {
    op.check();
    const saved = privateJson(join(root, 'events', name));
    const item = verified(selected, saved);
    if (!item || item.event_id !== name.slice(0, -5) || !isDeepStrictEqual(item, seen.get(item.event_id)))
      fail('The current mission prefix does not reproduce a saved signed work event.', 'history_incomplete');
  }
  const projection = projectWork(selected.contract, all);
  for (const item of all) { op.check(); sameFile(join(root, 'events', `${item.event_id}.json`), item.receipt); }
  const pending = [];
  for (const name of files(join(root, 'intents'), 16)) {
    op.check();
    const intent = privateJson(join(root, 'intents', name));
    if (!intent || Object.keys(intent).sort().join(',') !== 'format,summary,task_id,terms' ||
        intent.format !== 'agenttool-mission-work-intent/v1' || intent.task_id !== selected.contract.task_id ||
        intent.terms !== selected.terms || typeof intent.summary !== 'string') fail('Invalid saved work intent.');
    // A persisted intent is reconciled only by its exact signed local event.
    const submission = savedSubmission(state, intent.summary, op);
    const matches = all.filter(item => submission && item.event_id === submission.event_id &&
      item.receipt.raw_body === submission.raw_body &&
      equalPin({ ...item.receipt, public_key: item.receipt.proof.public_key }, selected.participant)
      && item.receipt.observation.summary === intent.summary);
    if (matches.length > 1) fail('A work intent has multiple admitted events.', 'work_conflict');
    if (!matches.length) pending.push({ intent_id: name.slice(0, -5),
      ...(submission ? { event_id: submission.event_id } : {}),
      explanation: 'No exact admitted local event yet. Inspect the saved outbox before any explicit retry; do not send a replacement.' });
  }
  op.check();
  if (projection.receipt) sameFile(join(root, 'receipt.json'), projection.receipt);
  op.check();
  return { ...projection, scope, next_cursor: after, pending_intents: pending };
}

async function withWork(state, input, options, action) {
  const selected = local(state, input), op = bounded(options, selected.contract);
  op.check();
  const root = storage(state, selected), close = lock(root);
  let result, problem;
  try { result = await action(selected, root, op); }
  catch (error) { problem = error; }
  finally {
    try { close(); } catch {
      if (result) { result.lock_remains = true; result.warning = 'Work lock cleanup failed. Inspect it before another operation.'; }
      else if (problem) problem.lock_remains = true;
    }
  }
  if (problem) throw problem;
  return result;
}

/** Synchronize verified evidence to owner-only local storage; no messages are sent. */
export async function syncWork(state, input, options = {}) {
  return withWork(state, input, options, (selected, root, op) => refresh(state, selected, root, op));
}

/** One explicit stage only. Every intent is durable before the chat sender starts. */
export async function advanceWork(state, input, stage, options = {}) {
  const validated = validateContract(input);
  if (!['offer', 'accept', 'deliver', 'review', 'decline', 'cancel'].includes(stage)) fail('Unknown work stage.');
  if (['offer', 'accept', 'deliver', 'review'].includes(stage)) verifySource(validated, options.sourceBytes);
  if (stage === 'deliver') validateArtifact(validated, options.payload, options.sourceBytes);
  return withWork(state, validated, options, async (selected, root, op) => {
    const current = await refresh(state, selected, root, op);
    if (current.pending_intents.length) fail('An unresolved work intent exists. Sync or inspect its outbox; do not send a replacement.', 'send_uncertain');
    const allowed = { offer: ['requester', ['none']], accept: ['worker', ['offered']],
      deliver: ['worker', ['work_accepted']], review: ['requester', ['delivered']],
      decline: ['worker', ['offered']], cancel: ['requester', ['offered', 'work_accepted']] };
    if (selected.role !== allowed[stage][0] || !allowed[stage][1].includes(current.status))
      fail('This role or current work state cannot perform the selected stage.', 'invalid_transition');
    if (stage === 'review' && options.payload?.outcome === 'accepted')
      validateArtifact(validated, current.artifact, options.sourceBytes);
    const text = encodeWorkRecord(validated, stage, current.head, options.payload);
    const envelope = chat.message(selected.config, selected.config.peer.identity_id, 'message', text);
    // The complete nested envelope must fit the API before persisting an intent.
    const summary = JSON.stringify(envelope);
    op.check();
    const intentId = randomUUID();
    client.writeNew(join(root, 'intents', `${intentId}.json`), json({
      format: 'agenttool-mission-work-intent/v1', task_id: validated.task_id, terms: selected.terms, summary }));
    let stored;
    try { stored = await chat.sendChat(state, selected.config, text, op.request()); }
    catch (error) {
      const problem = new WorkError('Work intent remains saved. Inspect the exact outbox event before any explicit recovery.', 'send_uncertain');
      if (error?.event_id) problem.event_id = error.event_id;
      throw problem;
    }
    // Known storage success survives a later failed readback; it never suggests resend.
    try {
      const projection = await refresh(state, selected, root, op);
      return { status: 'stored', event_id: stored.event_id, cursor: stored.cursor, projection };
    } catch {
      return { status: 'stored_sync_required', event_id: stored.event_id, cursor: stored.cursor,
        warning: 'The exact message is stored; subsequent evidence sync did not complete. Run work sync, never a replacement send.' };
    }
  });
}

const HELP = `agenttool-mission work <command> --state ABS --contract-file ABS [options]
inspect                         Inspect selected terms and participant locally
sync                            Read the bounded complete mission prefix and save verified evidence
offer --source-file ABS          Offer the pinned source review
accept --source-file ABS         Explicitly accept the exact offered terms
deliver --source-file ABS --artifact-file ABS
                                Submit two source-backed observations
review --source-file ABS --review-file ABS
                                Record an explicit accepted/rejected reviewer decision
decline --reason-file ABS        Decline an offered task
cancel --reason-file ABS         Cancel an offered or accepted task
Contract, artifact, review and reason files must be owned regular files, mode 0600.
Source bytes must match the contract. No file is executed. Every network operation
lasts at most 60 seconds; there is no polling daemon, model launch or automatic retry.
Messages are visible to all mission readers. Read ACK, work acceptance, delivery,
review and payment are distinct; this protocol requires no payment.
`;
export async function workMain(argv) {
  const [command, ...args] = argv;
  if (!command || ['--help', 'help'].includes(command)) { process.stdout.write(HELP); return; }
  const extras = { inspect: [], sync: [], offer: ['source-file'], accept: ['source-file'],
    deliver: ['source-file', 'artifact-file'], review: ['source-file', 'review-file'],
    decline: ['reason-file'], cancel: ['reason-file'] };
  if (!Object.hasOwn(extras, command)) fail('Unknown work command. Use work --help.');
  const required = ['state', 'contract-file', ...extras[command]], flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !required.includes(name) || Object.hasOwn(flags, name) || !args[i + 1])
      fail('Unknown, repeated or incomplete work option.');
    flags[name] = args[i + 1];
  }
  for (const name of required) if (!isAbsolute(flags[name] ?? '')) fail('Provide all required absolute work file paths.');
  const contract = validateContract(privateJson(flags['contract-file'], 32768));
  const sourceBytes = flags['source-file'] ? readSource(flags['source-file'], contract) : undefined;
  let payload;
  if (flags['artifact-file']) payload = privateJson(flags['artifact-file'], 8192);
  if (flags['review-file']) payload = privateJson(flags['review-file'], 8192);
  if (flags['reason-file']) payload = { reason: client.privateRead(flags['reason-file'], 2048).trim() };
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const options = { sourceBytes, payload, signal: controller.signal };
    const result = command === 'inspect' ? inspectWork(flags.state, contract)
      : command === 'sync' ? await syncWork(flags.state, contract, options)
      : await advanceWork(flags.state, contract, command, options);
    process.stdout.write(json(result));
  } catch (error) {
    if (!(error instanceof WorkError) && !(error instanceof chat.ChatError)) throw error;
    process.stderr.write(json({ stop_reason: error.stop_reason, error: client.safeError(error),
      ...(error.event_id ? { event_id: error.event_id } : {}),
      ...(error.lock_remains ? { lock_remains: true } : {}) }));
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
