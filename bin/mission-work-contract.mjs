/** Pure selected-work records over already verified mission chat receipts.
 * No I/O, clock, signing, execution authority, lease, payment or reputation.
 * The caller verifies chat signatures before projectWork, enforces current
 * expiry before sending, and supplies source bytes to validateArtifact.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const CONTRACT = 'agenttool-mission-work-contract/v1';
const WIRE = 'agenttool-mission-work/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const IDS = ['identity_id', 'signing_key_id', 'grant_id'];
const STAGES = ['offer', 'accept', 'deliver', 'review', 'decline', 'cancel'];
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

export class WorkError extends Error {
  constructor(message, stopReason = 'verification_failed') {
    super(message); this.name = 'WorkError'; this.stop_reason = stopReason;
  }
}
const fail = message => { throw new WorkError(message); };
function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Expected a plain work document.');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string') || keys.length !== fields.length
    || fields.some(key => !Object.hasOwn(value, key))) fail('Unexpected work document fields.');
  const result = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Work documents cannot contain accessors.');
    result[key] = descriptor.value;
  }
  return result;
}
function array(value, minimum, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum
    || Reflect.ownKeys(value).length !== value.length + 1) fail('Invalid bounded work array.');
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Work arrays must contain ordinary data elements.');
    return descriptor.value;
  });
}
function text(value, maximum) {
  if (typeof value !== 'string' || !value.length || value.length > maximum * 2
    || !value.isWellFormed() || value.includes('\0') || [...value].length > maximum) fail('Invalid bounded work text.');
  return value;
}
function matching(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('Invalid canonical work identifier or digest.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    fail('Expected a canonical UTC work timestamp.');
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function participant(value) {
  const p = object(value, [...IDS, 'public_key']);
  for (const key of IDS) matching(p[key], UUID);
  if (typeof p.public_key !== 'string') fail('Expected a pinned Ed25519 work key.');
  const bytes = Buffer.from(p.public_key, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== p.public_key) fail('Expected a canonical Ed25519 work key.');
  return p;
}

export function validateContract(value) {
  const c = object(value, ['format', 'task_id', 'origin', 'mission_id', 'mission_digest', 'requester', 'worker',
    'expires_at', 'title', 'source', 'instruction', 'acceptance_criteria', 'payment', 'profile']);
  if (c.format !== CONTRACT || c.payment !== 'NOT_REQUIRED' || c.profile !== 'two-source-observations/v1')
    fail('Unsupported work contract, payment or artifact profile.');
  matching(c.task_id, UUID); matching(c.mission_id, UUID); matching(c.mission_digest, SHA);
  let url; try { url = new URL(c.origin); } catch { fail('Expected a pinned HTTPS work origin.'); }
  if (typeof c.origin !== 'string' || c.origin.length > 512 || url.protocol !== 'https:' || url.origin !== c.origin
    || url.username || url.password) fail('Expected a pinned HTTPS work origin.');
  c.requester = participant(c.requester); c.worker = participant(c.worker);
  if (c.requester.identity_id === c.worker.identity_id || c.requester.public_key === c.worker.public_key)
    fail('Work requires separately pinned requester and worker identities and keys.');
  if (c.requester.grant_id === c.worker.grant_id || c.requester.signing_key_id === c.worker.signing_key_id)
    fail('Distinct work participants cannot share a grant or signing-key identifier.');
  date(c.expires_at); text(c.title, 160); text(c.instruction, 1000);
  c.source = object(c.source, ['label', 'sha256', 'bytes']);
  text(c.source.label, 160); matching(c.source.sha256, SHA);
  if (!Number.isSafeInteger(c.source.bytes) || c.source.bytes < 1 || c.source.bytes > 131072)
    fail('Work source must contain from 1 to 131072 bytes.');
  c.acceptance_criteria = array(c.acceptance_criteria, 1, 5).map(value => text(value, 240));
  return freeze(c);
}
export function contractDigest(value) { return `sha256:${hash(canonical(validateContract(value)))}`; }

function artifactShape(value) {
  const artifact = object(value, ['observations']);
  artifact.observations = array(artifact.observations, 2, 2).map(value => {
    const observation = object(value, ['line', 'quote', 'note']);
    if (!Number.isSafeInteger(observation.line) || observation.line < 1) fail('Source line numbers must be positive safe integers.');
    text(observation.quote, 90); text(observation.note, 120);
    return observation;
  });
  if (artifact.observations[0].line === artifact.observations[1].line) fail('Choose two distinct source lines.');
  return artifact;
}
/** Checks source binding and quotations only. Notes remain participant claims. */
export function validateArtifact(value, artifactValue, sourceBytes) {
  const contract = validateContract(value), artifact = artifactShape(artifactValue);
  if (!(sourceBytes instanceof Uint8Array) || sourceBytes.buffer instanceof SharedArrayBuffer)
    fail('Supply exact, unshared UTF-8 source bytes.');
  const bytes = Buffer.from(sourceBytes);
  if (bytes.length !== contract.source.bytes || `sha256:${hash(bytes)}` !== contract.source.sha256)
    fail('Artifact source bytes do not match the work contract.');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail('Work source must be strict UTF-8.'); }
  const lines = source.split(/\r\n|\n|\r/);
  for (const observation of artifact.observations) {
    if (observation.line > lines.length || !lines[observation.line - 1].includes(observation.quote))
      fail('Artifact quotation does not match its exact source line.');
  }
  return freeze(artifact);
}
function previous(value) {
  if (value === null) return null;
  const result = object(value, ['event_id', 'body_sha256']);
  matching(result.event_id, UUID); matching(result.body_sha256, HEX);
  return result;
}
function stagePayload(stage, payload) {
  if (stage === 'deliver') return { artifact: artifactShape(payload) };
  if (stage === 'review') {
    const review = object(payload, ['outcome', 'reason']);
    if (!['accepted', 'rejected'].includes(review.outcome)) fail('Choose an accepted or rejected work review.');
    text(review.reason, 120); return { review };
  }
  if (stage === 'decline' || stage === 'cancel') {
    const reason = object(payload, ['reason']); text(reason.reason, 120); return reason;
  }
  if (payload !== undefined) fail('This work stage carries no payload.');
  return {};
}
export function buildWorkRecord(value, stage, predecessor, payload) {
  const contract = validateContract(value);
  if (!STAGES.includes(stage)) fail('Unsupported work stage.');
  const parent = previous(predecessor);
  if ((stage === 'offer') !== (parent === null)) fail('Only an initial work offer has no predecessor.');
  const record = { format: WIRE, task_id: contract.task_id, terms: contractDigest(contract), stage,
    previous: parent, ...stagePayload(stage, payload) };
  text(canonical(record), 1000);
  return freeze(record);
}
export function encodeWorkRecord(contract, stage, predecessor, payload) {
  return canonical(buildWorkRecord(contract, stage, predecessor, payload));
}
function parseRecord(contract, selectedText) {
  let value;
  try { value = JSON.parse(selectedText); } catch { fail('Selected work text is not valid JSON.'); }
  const extras = value?.stage === 'deliver' ? ['artifact'] : value?.stage === 'review' ? ['review']
    : ['decline', 'cancel'].includes(value?.stage) ? ['reason'] : [];
  const record = object(value, ['format', 'task_id', 'terms', 'stage', 'previous', ...extras]);
  if (record.format !== WIRE || record.task_id !== contract.task_id || record.terms !== contractDigest(contract))
    fail('Selected work record does not bind the exact task terms.');
  const payload = record.stage === 'deliver' ? record.artifact : record.stage === 'review' ? record.review
    : ['decline', 'cancel'].includes(record.stage) ? { reason: record.reason } : undefined;
  const rebuilt = buildWorkRecord(contract, record.stage, record.previous, payload);
  if (canonical(rebuilt) !== selectedText) fail('Selected work text must use exact canonical JSON bytes.');
  return rebuilt;
}
function recordRole(stage) { return ['offer', 'review', 'cancel'].includes(stage) ? 'requester' : 'worker'; }
function head(item) { return { event_id: item.event_id, body_sha256: item.body_sha256 }; }

/** Input is the result of the chat signature verifier, never raw API JSON.
 * Additional binding checks prevent a caller from mixing a verified receipt
 * with different display text or another contract. They do not reverify crypto.
 */
function boundMessage(contract, input, record) {
  const item = object(input, ['event_id', 'cursor', 'body_sha256', 'message', 'receipt']);
  matching(item.event_id, UUID); matching(item.body_sha256, HEX);
  const receipt = object(item.receipt, ['event_id', 'mission_id', ...IDS, 'received_seq', 'received_at',
    'raw_body', 'body_sha256', 'observation', 'proof']);
  const proof = object(receipt.proof, ['domain', 'origin', 'method', 'request_target', 'raw_body', 'body_sha256',
    'timestamp', 'public_key', 'signature']);
  const role = recordRole(record.stage), actor = contract[role], other = contract[role === 'requester' ? 'worker' : 'requester'];
  if (!IDS.every(key => receipt[key] === actor[key]) || proof.public_key !== actor.public_key)
    fail('This work stage was not authored by its pinned participant.');
  if (receipt.event_id !== item.event_id || receipt.mission_id !== contract.mission_id
    || receipt.body_sha256 !== item.body_sha256 || receipt.received_seq !== item.cursor
    || typeof receipt.raw_body !== 'string' || Buffer.byteLength(receipt.raw_body) > 8192
    || hash(receipt.raw_body) !== item.body_sha256 || proof.raw_body !== receipt.raw_body
    || proof.body_sha256 !== item.body_sha256 || proof.domain !== 'agenttool-collaboration-request/v1'
    || proof.origin !== contract.origin || proof.method !== 'POST'
    || proof.request_target !== `/v1/collaboration/missions/${contract.mission_id}/events`)
    fail('Work message does not match its exact verified mission receipt.');
  date(receipt.received_at); date(proof.timestamp);
  if (Date.parse(receipt.received_at) >= Date.parse(contract.expires_at) || Date.parse(proof.timestamp) >= Date.parse(contract.expires_at))
    fail('Work evidence falls after the selected contract cutoff.');
  let observation, envelope;
  try { observation = JSON.parse(receipt.raw_body.replace(/^\uFEFF/, '')); envelope = JSON.parse(observation.summary); }
  catch { fail('Invalid work receipt observation.'); }
  if (observation.event_id !== item.event_id || !isDeepStrictEqual(observation, receipt.observation)
    || !isDeepStrictEqual(envelope, item.message) || item.message.format !== 'agenttool-mission-chat/v1'
    || item.message.conversation !== contract.task_id
    || item.message.to_identity !== other.identity_id || item.message.kind !== 'message')
    fail('Work display fields do not match the verified observation or destination.');
  // The prior chat verifier returns closed JSON data. Reconstruct its retained
  // projection from that verified shape instead of preserving mutable aliases.
  return JSON.parse(JSON.stringify({ ...item, receipt: { ...receipt, proof } }));
}

export function projectWork(value, verifiedMessages) {
  const contract = validateContract(value), messages = array(verifiedMessages, 0, 2000), nodes = new Map();
  for (const input of messages) {
    // Ordinary chat and another task's records do not enter this task journal.
    let candidate;
    try { candidate = JSON.parse(input?.message?.text); } catch { continue; }
    if (candidate?.task_id !== contract.task_id) continue;
    if (input.message.kind !== 'message') fail('A chat acknowledgement cannot transition selected work.');
    const record = parseRecord(contract, input.message.text), item = boundMessage(contract, input, record);
    const old = nodes.get(item.event_id);
    if (old) {
      if (!isDeepStrictEqual(old.item, item)) fail('A repeated work event changed its verified bytes or metadata.');
      continue;
    }
    nodes.set(item.event_id, { record, item });
  }
  const records = [], children = new Map();
  for (const node of nodes.values()) {
    const parent = node.record.previous;
    if (parent !== null) {
      const previousNode = nodes.get(parent.event_id);
      if (!previousNode || previousNode.item.body_sha256 !== parent.body_sha256) fail('Work predecessor evidence is missing or substituted.');
    }
    const key = parent?.event_id ?? null;
    if (children.has(key)) fail('Conflicting work successors require explicit inspection; no branch is selected.');
    children.set(key, node);
  }
  let current = children.get(null), status = 'none', artifact = null, review = null, resultHead = null;
  const allowed = { none: ['offer'], offered: ['accept', 'decline', 'cancel'], work_accepted: ['deliver', 'cancel'], delivered: ['review'] };
  while (current) {
    if (!(allowed[status] ?? []).includes(current.record.stage)) fail('Invalid or terminal work transition.');
    records.push(current.item);
    const { stage } = current.record;
    status = { offer: 'offered', accept: 'work_accepted', deliver: 'delivered', decline: 'declined', cancel: 'cancelled',
      review: current.record.review?.outcome === 'accepted' ? 'review_accepted' : 'review_rejected' }[stage];
    if (stage === 'deliver') { artifact = current.record.artifact; resultHead = head(current.item); }
    if (stage === 'review') review = current.record.review;
    current = children.get(current.item.event_id);
  }
  if (records.length !== nodes.size) fail('Work evidence does not form one complete offer-rooted chain.');
  const latest = records.length ? head(records[records.length - 1]) : null;
  const receipt = review ? { format: 'agenttool-mission-work-receipt/v1', task_id: contract.task_id, terms: contractDigest(contract),
    source_sha256: contract.source.sha256, result: resultHead, review: latest, outcome: review.outcome, payment: 'NOT_REQUIRED',
    scope: 'selected_source_and_pinned_participants_only', limitations: ['review_is_requester_claim_not_quality_proof',
      'no_execution_lease_payment_or_reputation_authority'] } : null;
  return freeze({ status, head: latest, records, artifact, review, receipt });
}
