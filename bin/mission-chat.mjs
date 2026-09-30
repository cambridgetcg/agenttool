/** Explicit, finite mission chat. Contract: docs/COLLABORATION-MISSION-CLIENT.md#verified-chat-with-a-selected-peer.
 * Selected messages are visible to every mission reader. No wake, execution,
 * automatic acknowledgement, retry, persistent cursor, or provider is added.
 */
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { lstatSync, mkdirSync, opendirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as client from './agenttool-mission.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const IDS = ['identity_id', 'signing_key_id', 'grant_id'];
const MAX_PAGES = 100, MAX_OUTBOX_FILES = 2000;
const hash = value => createHash('sha256').update(value).digest('hex');

export class ChatError extends Error {
  constructor(reason, message, eventId) {
    super(message); this.name = 'ChatError'; this.stop_reason = reason;
    if (eventId) this.event_id = eventId;
  }
}
const fail = (message, reason = 'verification_failed') => { throw new ChatError(reason, message); };
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('Unexpected chat document fields.');
}
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) fail('Expected a lowercase UUID.'); return value; }
function date(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Expected a canonical UTC timestamp.');
  return Date.parse(value);
}
function text(value, max = 1000) {
  if (typeof value !== 'string' || !value.length || !value.isWellFormed() || value.includes('\0') || [...value].length > max) fail(`Expected nonempty well-formed text of at most ${max} Unicode scalars.`);
  return value;
}
export function validateConfig(value) {
  exact(value, ['format', 'mission_digest', 'conversation', 'peer', 'expires_at']);
  if (value.format !== 'agenttool-mission-chat-config/v1' || !SHA.test(value.mission_digest ?? '') ||
      typeof value.conversation !== 'string' || !SLUG.test(value.conversation)) fail('Invalid chat format, mission digest or conversation slug.');
  exact(value.peer, [...IDS, 'public_key']);
  for (const name of IDS) id(value.peer[name]);
  if (typeof value.peer.public_key !== 'string') fail('Expected a pinned Ed25519 public key.');
  const key = Buffer.from(value.peer.public_key, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value.peer.public_key) fail('Expected a pinned Ed25519 public key.');
  date(value.expires_at);
  return structuredClone(value);
}
export function message(config, to, kind, selectedText, inReplyTo) {
  if (typeof config?.conversation !== 'string' || !SLUG.test(config.conversation)) fail('Invalid conversation slug.');
  id(to);
  if (!['message', 'read_ack'].includes(kind)) fail('Choose message or read_ack.');
  const value = { format: 'agenttool-mission-chat/v1', conversation: config.conversation, to_identity: to, kind, text: text(selectedText) };
  if (inReplyTo !== undefined) value.in_reply_to = id(inReplyTo);
  if (kind === 'read_ack' && inReplyTo === undefined) fail('A read acknowledgement must reference the message explicitly read.');
  text(JSON.stringify(value)); // The serialized envelope shares the API's 1000-scalar limit.
  return value;
}
function normalClock() {
  return { now: () => Date.now(), monotonic: () => performance.now(), sleep: (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ChatError('cancelled', 'Chat operation cancelled.')); return; }
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new ChatError('cancelled', 'Chat operation cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
  }) };
}
function operation(options, seconds = 60) {
  const clock = options._clock ?? normalClock(); // Offline tests may replace time; the CLI never exposes this option.
  if (!clock || !['now', 'monotonic', 'sleep'].every(k => typeof clock[k] === 'function')) fail('Invalid clock.');
  const timeout = options.timeout ?? 20000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 20000) fail('Request timeout must be from 1 to 20000 milliseconds.');
  const start = clock.monotonic(), deadline = start + seconds * 1000;
  let expiry = Infinity, expiryDeadline = Infinity;
  const check = () => {
    if (options.signal?.aborted) fail('Chat operation cancelled.', 'cancelled');
    if (clock.now() >= expiry || clock.monotonic() >= expiryDeadline) fail('The selected chat or participant lifetime has expired.', 'grant_expired');
    if (clock.monotonic() >= deadline) fail('The finite chat read window ended.', 'duration');
  };
  return {
    clock, check,
    limit(value) { expiry = Math.min(expiry, value); expiryDeadline = Math.min(expiryDeadline, clock.monotonic() + expiry - clock.now()); },
    async call(fn, effect = false) {
      check();
      const monotonic = clock.monotonic(), remaining = deadline - monotonic;
      const lifetime = Math.min(expiryDeadline - monotonic, expiry - clock.now());
      const budget = Math.max(1, Math.ceil(Math.min(timeout, remaining, lifetime)));
      const timeoutReason = lifetime <= Math.min(timeout, remaining) ? 'grant_expired' : remaining <= timeout ? 'duration' : null;
      let result, requestSignal;
      const checkStopped = () => {
        check();
        // The request timer can fire just before a separately sampled clock reaches
        // its boundary. Retain that actual timeout's selected cause after the base
        // client redacts the transport error; do not reinterpret ambiguous effects.
        if (requestSignal?.aborted && requestSignal.reason?.name === 'TimeoutError' && timeoutReason)
          fail('The selected chat request deadline ended.', timeoutReason);
      };
      try { result = await fn({ fetchImpl: (url, init) => {
        requestSignal = init.signal;
        return (options.fetchImpl ?? fetch)(url, init);
      }, signal: options.signal, timeout: budget }); }
      catch (error) { if (!effect) checkStopped(); throw error; }
      if (!effect) checkStopped(); return result;
    },
    async pause() {
      check();
      await clock.sleep(Math.max(1, Math.min(3000, deadline - clock.monotonic(), expiryDeadline - clock.monotonic(), expiry - clock.now())), options.signal);
      check();
    },
  };
}
function localParticipant(state, config, op) {
  let p;
  try { p = client.participant(state); }
  catch (error) {
    if (error?.message === 'Invitation expiry is invalid or has passed.') fail('The participant invitation is expired or invalid.', 'grant_expired');
    fail('Cannot validate private participant state.');
  }
  if (IDS.every(k => config.peer[k] === p[k])) fail('Select a separate peer participant grant.');
  op.limit(Math.min(date(p.expires_at), date(config.expires_at)));
  return p;
}
function scopeFor(p, config, expiresAt) {
  return { origin: p.origin, mission_id: p.mission_id, mission_digest: config.mission_digest,
    conversation: config.conversation, local: Object.fromEntries(IDS.map(k => [k, p[k]])), peer: structuredClone(config.peer),
    expires_at: new Date(expiresAt).toISOString(), visibility: 'all_mission_readers', authority: 'descriptive_context_only' };
}
function checkParticipant(state, p, config, op) {
  const current = localParticipant(state, config, op);
  if (!isDeepStrictEqual(current, p)) fail('The participant changed during this chat operation.');
  op.check();
}
function metadata(view, p, config, send) {
  const m = view?.mission, g = view?.grant;
  if (!m || !g || m.mission_id !== p.mission_id || m.mission_digest !== config.mission_digest ||
      g.mission_id !== p.mission_id || g.origin !== p.origin || !IDS.every(k => g[k] === p[k]) ||
      m.revoked_at !== null || g.revoked_at !== null || !g.accepted_at || !Array.isArray(g.actions) ||
      !g.actions.includes('mission.read') || (send && !g.actions.includes('mission.observe'))) fail('The accepted mission or participant scope does not match this chat.');
  date(g.accepted_at);
  return Math.min(date(config.expires_at), date(p.expires_at), date(m.expires_at), date(g.expires_at));
}
async function prepare(state, config, op, send = false, onScope = () => {}) {
  const p = localParticipant(state, config, op);
  let expiresAt = Math.min(date(config.expires_at), date(p.expires_at));
  onScope(scopeFor(p, config, expiresAt));
  op.check();
  const invitation = await op.call(opts => client.invitation(state, opts));
  expiresAt = Math.min(expiresAt, metadata(invitation, p, config, send));
  op.limit(expiresAt); onScope(scopeFor(p, config, expiresAt));
  checkParticipant(state, p, config, op);
  const context = await op.call(opts => client.request(state, 'GET', '/context', '', opts));
  expiresAt = Math.min(expiresAt, metadata(context, p, config, send));
  op.limit(expiresAt); checkParticipant(state, p, config, op);
  const scope = scopeFor(p, config, expiresAt); onScope(scope);
  return { p, scope };
}
/** Inspect current accepted mission scope. No acceptance or local binding is written. */
export async function inspectChat(state, input, options = {}) {
  const config = validateConfig(input), op = operation(options);
  try { return (await prepare(state, config, op)).scope; }
  catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError(failureReason(error), 'Chat scope inspection could not be completed. No acceptance or message was sent.');
  }
}
function observation(raw) {
  let body;
  try { body = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { fail('Invalid signed observation JSON.'); }
  exact(body, ['event_id', 'summary', ...(body?.seat === undefined ? [] : ['seat'])]);
  id(body.event_id); text(body.summary);
  if (body.seat !== undefined) {
    exact(body.seat, ['device_id', 'session_id', 'harness']);
    for (const value of Object.values(body.seat)) text(value, 128);
  }
  return body;
}
// Shared with the explicit work client for historical receipt re-verification.
// This validates the signed event, not current grant authority or task consent.
export function verifyChatEvent(event, p, config) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('Invalid mission event.');
  id(event.event_id); client.cursor(event.received_seq);
  if (event.mission_id !== p.mission_id) fail('Event mission does not match.');
  for (const name of IDS) id(event[name]);
  if (!IDS.every(name => event[name] === config.peer[name])) return null;
  const raw = event.raw_body, proof = event.proof;
  if (typeof raw !== 'string' || !raw.isWellFormed() || Buffer.byteLength(raw) > 8192 || !proof ||
      proof.domain !== 'agenttool-collaboration-request/v1' || proof.origin !== p.origin || proof.method !== 'POST' ||
      proof.request_target !== `/v1/collaboration/missions/${p.mission_id}/events` || proof.raw_body !== raw ||
      proof.body_sha256 !== hash(raw) || event.body_sha256 !== hash(raw) || proof.public_key !== config.peer.public_key) fail('Selected peer event failed its proof binding.');
  date(proof.timestamp); date(event.received_at);
  if (typeof proof.signature !== 'string') fail('Invalid selected peer signature.');
  const signature = Buffer.from(proof.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== proof.signature) fail('Invalid selected peer signature.');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(config.peer.public_key, 'base64').toString('base64url') }, format: 'jwk' });
  if (!verify(null, client.requestDigest({ origin: p.origin, mission_id: p.mission_id, ...config.peer }, 'POST', proof.request_target, raw, proof.timestamp), key, signature)) fail('Invalid selected peer signature.');
  // Historical admitted proofs do not acquire a five-minute inbox expiry.
  const body = observation(raw);
  if (body.event_id !== event.event_id || !isDeepStrictEqual(body, event.observation)) fail('Signed observation and service projection disagree.');
  let envelope;
  try { envelope = JSON.parse(body.summary); } catch { return null; }
  if (envelope?.format !== 'agenttool-mission-chat/v1' || envelope.conversation !== config.conversation || envelope.to_identity !== p.identity_id) return null;
  exact(envelope, ['format', 'conversation', 'to_identity', 'kind', 'text', ...(envelope.in_reply_to === undefined ? [] : ['in_reply_to'])]);
  const validated = message(config, p.identity_id, envelope.kind, envelope.text, envelope.in_reply_to);
  // Return only protocol fields, never arbitrary service-supplied properties.
  const receipt = Object.fromEntries(['event_id', 'mission_id', ...IDS, 'received_seq', 'received_at', 'raw_body', 'body_sha256'].map(k => [k, event[k]]));
  receipt.observation = body;
  receipt.proof = Object.fromEntries(['domain', 'origin', 'method', 'request_target', 'raw_body', 'body_sha256', 'timestamp', 'public_key', 'signature'].map(k => [k, proof[k]]));
  return { event_id: event.event_id, cursor: event.received_seq, body_sha256: event.body_sha256, message: validated, receipt };
}
const selectedEvent = verifyChatEvent;
function failureReason(error) {
  if (error instanceof ChatError) return error.stop_reason;
  if (error instanceof Error && /^(Mission transport failed\.|Mission request refused:)/.test(error.message)) return 'transport_error';
  return 'verification_failed';
}
/** Return the first selected peer batch. Callers own consumption and persistence of next_cursor. */
export async function readChat(state, input, options = {}) {
  const config = validateConfig(input), after = client.cursor(options.after ?? '0');
  const seconds = options.seconds ?? 60, maxMessages = options.maxMessages ?? 20;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) fail('Read duration must be from 1 to 300 seconds.');
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 20) fail('Message limit must be from 1 to 20.');
  const op = operation(options, seconds), seen = new Map();
  let scope = null, next = after;
  const result = (stop_reason, messages = []) => ({ messages, next_cursor: next, scope, stop_reason });
  try {
    const { p } = await prepare(state, config, op, false, value => { scope = value; });
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      checkParticipant(state, p, config, op);
      const page = await op.call(opts => client.events(state, next, opts));
      checkParticipant(state, p, config, op);
      if (!page.events.length && page.page.has_more) fail('An empty event page cannot claim more events.');
      const selected = [], pendingSeen = new Map(seen);
      // Verify the complete page before returning any text or consuming a cursor.
      for (const event of page.events) {
        const item = selectedEvent(event, p, config);
        const fingerprint = hash(JSON.stringify([event.mission_id, ...IDS.map(k => event[k]), event.raw_body, event.body_sha256]));
        const previous = pendingSeen.get(event.event_id);
        if (previous !== undefined && previous !== fingerprint) fail('A repeated event UUID has changed identity or signed bytes.');
        pendingSeen.set(event.event_id, fingerprint);
        if (item && previous === undefined) selected.push(item);
      }
      op.check();
      if (selected.length) {
        const messages = selected.slice(0, maxMessages);
        if (selected.length > maxMessages) {
          const firstUnreturned = selected[maxMessages].cursor;
          const index = page.events.findIndex(e => e.received_seq === firstUnreturned);
          next = index > 0 ? page.events[index - 1].received_seq : next;
          return result('message_limit', messages);
        }
        next = page.page.next_cursor;
        return result(messages.length === maxMessages ? 'message_limit' : 'messages', messages);
      }
      for (const [key, value] of pendingSeen) seen.set(key, value);
      next = page.page.next_cursor;
      if (!page.page.has_more) await op.pause();
    }
    return result('scan_limit');
  } catch (error) { return result(failureReason(error)); }
}
function privateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) || realpathSync(path) !== path) fail('Chat directories must be real, owned and mode 0700.');
}
function outboxPending(state, config, op) {
  const path = join(client.stateRoot(state), 'outbox'); privateDirectory(path);
  const directory = opendirSync(path), names = [];
  try {
    for (let item; (item = directory.readSync());) {
      op.check();
      if (names.length >= MAX_OUTBOX_FILES) fail('Outbox scan limit reached; inspect and archive completed receipts explicitly.');
      if (!item.isFile()) fail('Outbox contains a link or nonregular entry; inspect it before sending.');
      names.push(item.name);
    }
  } finally { directory.closeSync(); }
  const files = new Set(names);
  for (const name of names) {
    op.check();
    if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    const eventId = name.slice(0, -5); id(eventId);
    let raw, body, envelope;
    try { raw = client.privateRead(join(path, name), 8192); body = observation(raw); }
    catch { fail('Cannot validate an outbox event; inspect it before sending.'); }
    if (body.event_id !== eventId) fail('An outbox filename does not match its event UUID.');
    try { envelope = JSON.parse(body.summary); } catch { continue; }
    if (envelope?.format !== 'agenttool-mission-chat/v1' || envelope.conversation !== config.conversation || envelope.to_identity !== config.peer.identity_id) continue;
    const receiptName = `${eventId}.receipt.json`;
    const uncertain = () => { throw new ChatError('send_uncertain', `Event ${eventId} has no matching outbox receipt. Inspect it and use an explicit exact-body retry if appropriate; do not send a replacement.`, eventId); };
    if (!files.has(receiptName)) uncertain();
    let receipt;
    try { receipt = JSON.parse(client.privateRead(join(path, receiptName), 65536)); } catch { uncertain(); }
    if (receipt?.event?.event_id !== eventId || receipt.event.body_sha256 !== hash(raw)) uncertain();
  }
}
function sendLock(state) {
  const root = client.stateRoot(state), path = join(root, 'chat-send.lock'), lockId = randomUUID();
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') fail('A chat send lock exists. Inspect its owner before explicit recovery.', 'send_in_flight');
    fail('Cannot create the private chat send lock.');
  }
  try { client.writeNew(join(path, 'owner.json'), JSON.stringify({ lock_id: lockId, pid: process.pid, created_at: new Date().toISOString() }) + '\n'); }
  catch { try { rmdirSync(path); } catch { /* Keep any uncertain lock for inspection. */ } fail('Cannot persist the chat send lock owner.'); }
  return () => {
    privateDirectory(path);
    const owner = JSON.parse(client.privateRead(join(path, 'owner.json')));
    if (owner.lock_id !== lockId || owner.pid !== process.pid) fail('Chat send lock ownership changed; inspect it before recovery.');
    unlinkSync(join(path, 'owner.json')); rmdirSync(path);
  };
}
async function publish(state, input, selectedText, options, reply) {
  const config = validateConfig(input), op = operation(options);
  const envelope = message(config, config.peer.identity_id, reply ? options.kind ?? 'message' : 'message', selectedText, reply ? id(options.inReplyTo) : undefined);
  // Establish the private state boundary before touching the lock. It serializes
  // chat sends only; the base participant client remains an explicit lower layer.
  localParticipant(state, config, op); op.check();
  const close = sendLock(state);
  let outcome, problem;
  try {
    outboxPending(state, config, op);
    const { p, scope } = await prepare(state, config, op, true);
    if (reply) {
      const reference = selectedEvent(options.reference, p, config);
      if (!reference || reference.event_id !== options.inReplyTo) fail('Reply requires the matching verified peer event in this conversation and destination.');
    }
    checkParticipant(state, p, config, op);
    let receipt;
    try { receipt = await op.call(opts => client.send(state, JSON.stringify(envelope), opts), true); }
    catch (error) {
      const match = error instanceof Error && /^Event ([0-9a-f-]{36}) remains saved in the outbox\./.exec(error.message);
      if (match && UUID.test(match[1])) throw new ChatError('send_uncertain', `Event ${match[1]} remains saved in the outbox without a verified receipt. Inspect the event before any explicit retry.`, match[1]);
      throw error;
    }
    const event = receipt.event;
    let cursor = null, receiptWarning;
    try {
      if (typeof event.received_seq !== 'string' || event.received_seq === '0') fail('Invalid storage receipt cursor.');
      cursor = client.cursor(event.received_seq);
    }
    catch { receiptWarning = 'Storage receipt matches the saved event UUID and bytes, but its cursor is invalid or missing. Do not advance a read cursor from this receipt.'; }
    // UUID + exact-body hash confirm storage independently of cursor metadata.
    // An unusable cursor must not disguise known success or suggest a resend.
    outcome = { event_id: event.event_id, cursor, status: 'stored', scope, message: envelope,
      ...(receiptWarning ? { receipt_warning: receiptWarning } : {}) };
  } catch (error) {
    problem = error instanceof ChatError ? error : new ChatError(failureReason(error), 'Chat send could not be completed. Inspect the outbox before any explicit retry.');
  } finally {
    try { close(); }
    catch {
      // A known stored event stays a success if local lock cleanup fails. Never
      // replace its receipt with a generic error that could invite a second send.
      if (outcome) { outcome.lock_remains = true; outcome.warning = 'Chat send lock cleanup failed; inspect the lock before another send.'; }
      else if (problem) problem.lock_remains = true;
    }
  }
  if (problem) throw problem;
  return outcome;
}
/** Explicitly start a new thread of selected text; recovery always uses the saved original event. */
export function sendChat(state, config, selectedText, options = {}) { return publish(state, config, selectedText, options, false); }
/** A read_ack is a voluntary signed claim of reading, not a native processing receipt. */
export function replyChat(state, config, selectedText, options = {}) { return publish(state, config, selectedText, options, true); }
