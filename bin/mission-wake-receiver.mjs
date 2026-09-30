/** Host-owned session routing. Contract: docs/COLLABORATION-MISSION-WAKE.md. */
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, rmdirSync, realpathSync, constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as client from './agenttool-mission.mjs';
import { validateHermesTarget } from './mission-wake-hermes.mjs';

const fail = message => { throw new Error(message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const MAX_ITEMS = 200;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('Unexpected receiver fields.');
}
function id(value) { if (!UUID.test(value ?? '')) fail('Expected a lowercase UUID.'); return value; }
function text(value, max = 1000) {
  if (typeof value !== 'string' || !value || !value.isWellFormed() || value.includes('\0') || [...value].length > max) fail('Invalid bounded receiver text.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Expected a canonical UTC timestamp.');
  return Date.parse(value);
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function same(a, b) { return canonical(a) === canonical(b); }
function privateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) || realpathSync(path) !== path) fail('Receiver directory must be real, owned and mode 0700.');
}
function directory(state) { client.stateRoot(state); const root = join(state, 'wake'); privateDirectory(root); return root; }
function syncDirectory(root) {
  const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function replace(root, name, value) {
  const target = join(root, name);
  // Refuse symlink/special-file replacements, even though rename itself is atomic.
  if (existsSync(target)) client.privateRead(target, 4_194_304);
  else { try { lstatSync(target); fail('Refuse a dangling receiver state link.'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  const temp = join(root, `.pending-${randomUUID()}`);
  client.writeNew(temp, json(value));
  renameSync(temp, target); syncDirectory(root);
}
function fingerprint(p) {
  return hash(JSON.stringify([p.origin, p.mission_id, p.grant_id, p.identity_id, p.signing_key_id, p.public_key, p.expires_at]));
}
function peer(value) {
  exact(value, ['identity_id', 'signing_key_id', 'grant_id', 'public_key']);
  for (const key of ['identity_id', 'signing_key_id', 'grant_id']) id(value[key]);
  const bytes = Buffer.from(value.public_key ?? '', 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value.public_key) fail('Expected a pinned Ed25519 public key.');
  return value;
}
function target(value) {
  if (value?.kind === 'codex') {
    exact(value, ['kind', 'thread_id', 'cwd']);
    text(value.thread_id, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(value.thread_id) || !isAbsolute(value.cwd) || realpathSync(value.cwd) !== value.cwd || !lstatSync(value.cwd).isDirectory()) fail('Select an exact Codex thread and real absolute working directory.');
  } else if (value?.kind === 'claude-channel') {
    exact(value, ['kind', 'session_label']); text(value.session_label, 128);
  } else if (value?.kind === 'hermes') validateHermesTarget(value);
  else fail('Select codex, claude-channel or hermes.');
  return value;
}
export function routeAddress(binding) {
  return { format: 'agenttool-mission-route/v1', origin: binding.origin, mission_id: binding.mission_id,
    identity_id: binding.identity_id, route_id: binding.route_id, harness: binding.target.kind, expires_at: binding.expires_at };
}
export async function bind(state, config, options = {}) {
  exact(config, ['mission_digest', 'peer', 'target', 'after', 'expires_at']);
  if (!SHA.test(config.mission_digest)) fail('Select the reviewed mission digest.');
  peer(config.peer); target(config.target); client.cursor(config.after);
  const p = client.participant(state), expiry = date(config.expires_at);
  if (expiry <= Date.now() || expiry > date(p.expires_at)) fail('Receiver expiry must be live and within the participant grant.');
  if (config.peer.identity_id === p.identity_id && config.peer.signing_key_id === p.signing_key_id && config.peer.grant_id === p.grant_id) fail('Peer must use a separate participant grant.');
  const view = await client.invitation(state, options);
  if (view.mission.mission_digest !== config.mission_digest) fail('Receiver mission digest does not match.');
  await client.request(state, 'GET', '/context', '', options); // Server checks current acceptance and read scope.
  const binding = { format: 'agenttool-mission-receiver/v1', route_id: randomUUID(), origin: p.origin,
    mission_id: p.mission_id, identity_id: p.identity_id, profile_sha256: fingerprint(p), ...structuredClone(config) };
  const root = join(state, 'wake'); mkdirSync(root, { mode: 0o700 }); privateDirectory(root);
  client.writeNew(join(root, 'binding.json'), json(binding));
  client.writeNew(join(root, 'inbox.json'), json({ format: 'agenttool-mission-inbox/v1', binding_sha256: hash(json(binding)), cursor: config.after, items: [] }));
  return routeAddress(binding);
}
function load(state) {
  const root = directory(state), binding = JSON.parse(client.privateRead(join(root, 'binding.json')));
  exact(binding, ['format', 'route_id', 'origin', 'mission_id', 'identity_id', 'profile_sha256', 'mission_digest', 'peer', 'target', 'after', 'expires_at']);
  if (binding.format !== 'agenttool-mission-receiver/v1' || !SHA.test(binding.mission_digest)) fail('Invalid receiver binding.');
  id(binding.route_id); id(binding.mission_id); id(binding.identity_id); client.origin(binding.origin);
  peer(binding.peer); target(binding.target); client.cursor(binding.after); date(binding.expires_at);
  const inbox = JSON.parse(client.privateRead(join(root, 'inbox.json'), 4_194_304));
  if (inbox.format !== 'agenttool-mission-inbox/v1' || inbox.binding_sha256 !== hash(json(binding)) || !Array.isArray(inbox.items) || inbox.items.length > MAX_ITEMS) fail('Inbox does not match its immutable receiver binding.');
  client.cursor(inbox.cursor);
  if (BigInt(inbox.cursor) < BigInt(binding.after)) fail('Inbox cursor precedes its binding.');
  const seen = new Set();
  for (const item of inbox.items) {
    id(item.event_id); client.cursor(item.cursor);
    if (seen.has(item.event_id) || !['pending', 'dispatching', 'delivered', 'processed', 'ack'].includes(item.status) || BigInt(item.cursor) > BigInt(inbox.cursor)) fail('Invalid inbox state.');
    seen.add(item.event_id);
    if (item.status !== 'pending' && item.status !== 'ack') id(item.delivery_id);
    if (!same(item.message, message(item.message?.to, item.message?.kind, item.message?.text, item.message?.in_reply_to)) || item.message.to !== binding.route_id ||
        (item.status === 'ack') !== (item.message.kind === 'ack') || !/^[0-9a-f]{64}$/.test(item.body_sha256)) fail('Invalid saved message.');
    if (item.processing_ack) {
      const ack = item.processing_ack;
      exact(ack, ['to', 'status', 'summary_sha256', 'attempted_at', ...(ack.status === 'stored' ? ['ack_event_id', 'cursor'] : [])]);
      if (binding.target.kind !== 'hermes' || item.status !== 'processed' || !['dispatching', 'stored'].includes(ack.status) ||
          !/^[0-9a-f]{64}$/.test(ack.summary_sha256 ?? '')) fail('Invalid saved processing ACK.');
      const receipt = hermesReceipt(item.receipt); id(ack.to); date(ack.attempted_at);
      if (ack.summary_sha256 !== hash(processingSummary(item, receipt, ack.to))) fail('Saved ACK intent no longer matches its processing receipt.');
      if (ack.status === 'stored') { id(ack.ack_event_id); if (typeof ack.cursor !== 'string' || ack.cursor === '0') fail('Invalid ACK cursor.'); client.cursor(ack.cursor); }
    }
  }
  return { root, binding, inbox };
}
export function status(state) {
  const { binding, inbox, root } = load(state);
  const counts = Object.fromEntries(['pending', 'dispatching', 'delivered', 'processed', 'ack'].map(s => [s, inbox.items.filter(i => i.status === s).length]));
  const locked = existsSync(join(root, 'lock'));
  const owner = locked ? JSON.parse(client.privateRead(join(root, 'lock', 'owner.json'))) : null;
  return { route: routeAddress(binding), cursor: inbox.cursor, counts, locked, lock: owner ? { lock_id: owner.lock_id, pid: owner.pid } : null,
    in_flight: inbox.items.filter(i => ['dispatching', 'delivered'].includes(i.status)).map(i => ({ event_id: i.event_id, delivery_id: i.delivery_id, status: i.status, receipt: i.receipt ?? null })),
    processing_acks: inbox.items.filter(i => i.processing_ack).map(i => ({ event_id: i.event_id, delivery_id: i.delivery_id, ...i.processing_ack })) };
}
function hermesReceipt(receipt) {
  exact(receipt, ['status', 'job_id', 'session_id', 'evidence_sha256']);
  if (receipt?.status !== 'processed' || !/^[0-9]{8}T[0-9]{6}-[0-9a-f]{12}$/.test(receipt.job_id ?? '') ||
      typeof receipt.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.session_id) ||
      !/^[0-9a-f]{64}$/.test(receipt.evidence_sha256 ?? '')) fail('Hermes receipt requires verified job, session and evidence.');
  return { status: 'processed', job_id: receipt.job_id, session_id: receipt.session_id, evidence_sha256: receipt.evidence_sha256 };
}
function processingSummary(item, receipt, to) {
  return JSON.stringify(message(to, 'ack', JSON.stringify({ format: 'agenttool-hermes-read-ack/v1',
    event_id: item.event_id, delivery_id: item.delivery_id, job_id: receipt.job_id, session_id: receipt.session_id,
    evidence_sha256: receipt.evidence_sha256 }), item.event_id));
}
export function message(to, kind, selectedText, inReplyTo) {
  id(to); if (!['message', 'ack'].includes(kind)) fail('Unknown message kind.');
  const value = { format: 'agenttool-session-message/v1', to, kind, text: text(selectedText) };
  if (inReplyTo !== undefined) value.in_reply_to = id(inReplyTo);
  text(JSON.stringify(value)); // The entire serialized envelope shares the API's 1000-scalar limit.
  return value;
}
function selectedEvent(event, binding, p) {
  id(event.event_id);
  if (event.mission_id !== binding.mission_id) fail('Event mission does not match.');
  const fields = ['identity_id', 'signing_key_id', 'grant_id'];
  for (const name of fields) id(event[name]);
  if (fields.every(name => event[name] === p[name])) return null;
  if (!fields.every(name => event[name] === binding.peer[name])) return null;
  const raw = event.raw_body, proof = event.proof;
  if (typeof raw !== 'string' || !raw.isWellFormed() || Buffer.byteLength(raw) > 8192 || !proof ||
      proof.domain !== 'agenttool-collaboration-request/v1' || proof.origin !== binding.origin || proof.method !== 'POST' ||
      proof.request_target !== `/v1/collaboration/missions/${binding.mission_id}/events` ||
      proof.raw_body !== raw || proof.body_sha256 !== hash(raw) || event.body_sha256 !== hash(raw) || proof.public_key !== binding.peer.public_key) fail('Selected peer event failed its proof binding.');
  date(proof.timestamp);
  const signature = Buffer.from(proof.signature ?? '', 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== proof.signature) fail('Invalid peer signature.');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(binding.peer.public_key, 'base64').toString('base64url') }, format: 'jwk' });
  const metadata = { origin: binding.origin, mission_id: binding.mission_id, ...binding.peer };
  if (!verify(null, client.requestDigest(metadata, 'POST', proof.request_target, raw, proof.timestamp), key, signature)) fail('Invalid peer signature.');
  // Historical admitted signatures stay verifiable; the admission freshness window is not an inbox TTL.
  let body; try { body = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { fail('Invalid signed observation JSON.'); }
  if (body.event_id !== event.event_id || typeof body.summary !== 'string' || !same(body, event.observation)) fail('Signed observation and event projection disagree.');
  let envelope; try { envelope = JSON.parse(body.summary); } catch { return null; }
  if (envelope?.format !== 'agenttool-session-message/v1' || envelope.to !== binding.route_id) return null;
  exact(envelope, ['format', 'to', 'kind', 'text', ...(envelope.in_reply_to === undefined ? [] : ['in_reply_to'])]);
  const validated = message(envelope.to, envelope.kind, envelope.text, envelope.in_reply_to);
  return { event_id: event.event_id, cursor: event.received_seq, body_sha256: event.body_sha256, message: validated,
    status: validated.kind === 'ack' ? 'ack' : 'pending' };
}
export function openReceiver(state) {
  const root = directory(state);
  const lock = join(root, 'lock'), lockId = randomUUID();
  mkdirSync(lock, { mode: 0o700 });
  let loaded;
  try {
    client.writeNew(join(lock, 'owner.json'), json({ lock_id: lockId, pid: process.pid, created_at: new Date().toISOString() }));
    loaded = load(state); // Read only after acquiring the lock: never restore a stale pre-lock snapshot.
  } catch (error) {
    if (existsSync(join(lock, 'owner.json'))) unlinkSync(join(lock, 'owner.json'));
    rmdirSync(lock); syncDirectory(root); throw error;
  }
  const { binding, inbox: initial } = loaded;
  let inbox = initial, closed = false, busy = false;
  const live = () => {
    if (closed) fail('Receiver is closed.');
    const p = client.participant(state);
    if (fingerprint(p) !== binding.profile_sha256) fail('Participant changed since receiver binding.');
    if (Date.now() >= date(binding.expires_at)) fail('Receiver has expired.');
    if (hash(client.privateRead(join(root, 'binding.json'))) !== inbox.binding_sha256) fail('Receiver binding changed.');
    return p;
  };
  const save = next => { replace(root, 'inbox.json', next); inbox = next; };
  const exclusive = async fn => {
    if (busy) fail('Receiver operation already active.');
    busy = true; try { return await fn(); } finally { busy = false; }
  };
  const next = () => {
    live();
    if (inbox.items.some(i => ['dispatching', 'delivered'].includes(i.status))) return null;
    return structuredClone(inbox.items.find(i => i.status === 'pending') ?? null);
  };
  return {
    binding: Object.freeze(structuredClone(binding)),
    snapshot: () => structuredClone(inbox),
    next,
    async poll(options = {}) { return exclusive(async () => {
      const p = live(), page = await client.events(state, inbox.cursor, options); live();
      if (!page.events.length && page.page.has_more) fail('Empty page cannot claim more events.');
      const updated = structuredClone(inbox), seenPage = new Set();
      for (const event of page.events) {
        if (seenPage.has(event.event_id)) fail('Duplicate event ID in one page.');
        seenPage.add(event.event_id);
        const item = selectedEvent(event, binding, p);
        if (!item) continue;
        const prior = updated.items.find(i => i.event_id === item.event_id);
        if (prior && (prior.body_sha256 !== item.body_sha256 || prior.cursor !== item.cursor)) fail('Repeated event UUID has changed receipt or bytes.');
        if (!prior) updated.items.push(item);
      }
      if (updated.items.length > MAX_ITEMS) fail('Receiver inbox is full; cursor was not advanced.');
      updated.cursor = page.page.next_cursor;
      if (!same(inbox, updated)) save(updated);
      return { cursor: inbox.cursor, has_more: page.page.has_more, received: inbox.items.length };
    }); },
    async dispatch(adapter, options = {}) { return exclusive(async () => {
      const item = next(); if (!item) return null;
      const view = await client.invitation(state, options);
      if (view.mission.mission_digest !== binding.mission_digest) fail('Mission binding changed.');
      await client.request(state, 'GET', '/context', '', options); live();
      item.status = 'dispatching'; item.delivery_id = randomUUID();
      save({ ...inbox, items: inbox.items.map(i => i.event_id === item.event_id ? item : i) });
      // No catch/replay: a lost adapter response may already have started a native turn.
      const receipt = await adapter.deliver(structuredClone(item), structuredClone(binding));
      if (!receipt || !['delivered', 'processed'].includes(receipt.status)) fail('Invalid delivery receipt; inspect the saved attempt.');
      if (binding.target.kind === 'codex' && (receipt.thread_id !== binding.target.thread_id || typeof receipt.turn_id !== 'string')) fail('Codex receipt does not match the bound thread.');
      const cleanReceipt = binding.target.kind === 'hermes' ? hermesReceipt(receipt) :
        { status: receipt.status, ...(binding.target.kind === 'codex' ? { thread_id: receipt.thread_id, turn_id: receipt.turn_id } : {}) };
      // A channel tool may acknowledge while stdout is flushing. Do not downgrade it.
      save({ ...inbox, items: inbox.items.map(i => i.event_id === item.event_id ? { ...i, status: i.status === 'processed' ? 'processed' : receipt.status, receipt: cleanReceipt } : i) });
      return { event_id: item.event_id, delivery_id: item.delivery_id, ...cleanReceipt };
    }); },
    async sendProcessingAck(eventId, deliveryId, to, options = {}) { return exclusive(async () => {
      live(); id(eventId); id(deliveryId); id(to);
      const item = inbox.items.find(i => i.event_id === eventId && i.delivery_id === deliveryId);
      if (binding.target.kind !== 'hermes' || !item || item.status !== 'processed' || item.resolved_by || item.acknowledged_by)
        fail('Automatic ACK requires a verified Hermes processing receipt.');
      const receipt = hermesReceipt(item.receipt);
      if (item.processing_ack) {
        if (item.processing_ack.to !== to) fail('Processing ACK destination changed.');
        if (item.processing_ack.status !== 'stored') fail('Processing ACK outcome is uncertain; inspect its outbox, never automatically resend.');
        return structuredClone(item.processing_ack);
      }
      const summary = processingSummary(item, receipt, to);
      await client.request(state, 'GET', '/context', '', options); live();
      options.signal?.throwIfAborted();
      // The server rechecks active read/observe scope. Intent precedes even the
      // client's durable outbox write: a crash at either boundary cannot resend.
      const intent = { to, status: 'dispatching', summary_sha256: hash(summary), attempted_at: new Date().toISOString() };
      save({ ...inbox, items: inbox.items.map(i => i === item ? { ...i, processing_ack: intent } : i) });
      const sent = await client.send(state, summary, options);
      if (sent.event.mission_id !== binding.mission_id || typeof sent.event.received_seq !== 'string' || sent.event.received_seq === '0')
        fail('Processing ACK receipt does not match the mission.');
      const stored = { ...intent, status: 'stored', ack_event_id: id(sent.event.event_id), cursor: client.cursor(sent.event.received_seq) };
      save({ ...inbox, items: inbox.items.map(i => i.event_id === eventId ? { ...i, processing_ack: stored } : i) });
      return structuredClone(stored);
    }); },
    acknowledge(eventId, deliveryId) {
      live(); id(eventId); id(deliveryId);
      const item = inbox.items.find(i => i.event_id === eventId && i.delivery_id === deliveryId);
      if (!item || !['dispatching', 'delivered', 'processed'].includes(item.status)) fail('Acknowledgement does not match an active delivery.');
      if (item.status !== 'processed') save({ ...inbox, items: inbox.items.map(i => i === item ? { ...i, status: 'processed', acknowledged_by: 'host_tool' } : i) });
      return { event_id: eventId, delivery_id: deliveryId, status: 'processed' };
    },
    resolve(eventId, deliveryId, outcome) {
      live(); if (busy) fail('Cannot resolve an active receiver operation.');
      if (!['processed', 'retry'].includes(outcome)) fail('Choose processed or retry after inspecting the native session.');
      const item = inbox.items.find(i => i.event_id === eventId && i.delivery_id === deliveryId);
      if (!item || !['dispatching', 'delivered'].includes(item.status)) fail('Resolution does not match an uncertain delivery.');
      save({ ...inbox, items: inbox.items.map(i => i === item ? { ...i, status: outcome === 'retry' ? 'pending' : 'processed', resolved_by: 'operator', resolution: outcome } : i) });
      return { event_id: eventId, outcome };
    },
    close() {
      if (closed) return;
      if (busy) fail('Wait for the active receiver operation before closing.');
      const owner = JSON.parse(client.privateRead(join(lock, 'owner.json')));
      if (owner.lock_id !== lockId) fail('Receiver lock changed.');
      unlinkSync(join(lock, 'owner.json')); rmdirSync(lock); syncDirectory(root); closed = true;
    },
  };
}
export function recoverLock(state, expectedLockId) {
  id(expectedLockId); const root = directory(state), lock = join(root, 'lock'); privateDirectory(lock);
  const owner = JSON.parse(client.privateRead(join(lock, 'owner.json')));
  if (owner.lock_id !== expectedLockId || !Number.isSafeInteger(owner.pid) || owner.pid < 1) fail('Lock owner does not match.');
  try { process.kill(owner.pid, 0); fail('Lock owner is still alive; stop it normally.'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  unlinkSync(join(lock, 'owner.json')); rmdirSync(lock); syncDirectory(root);
  return { recovered: true, lock_id: expectedLockId };
}
