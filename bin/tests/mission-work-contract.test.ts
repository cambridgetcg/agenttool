/** Pure work-state tests. Keys and signed receipts are synthetic, with no I/O. */
import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { WorkError, validateContract, contractDigest, validateArtifact, buildWorkRecord, encodeWorkRecord, projectWork } from '../mission-work-contract.mjs';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const source = Buffer.from('Arrival is optional.\r\nRead the selected purpose.\nRefusal remains available.\n', 'utf8');
function participant() {
  const keys = generateKeyPairSync('ed25519');
  return { pin: { identity_id: randomUUID(), signing_key_id: randomUUID(), grant_id: randomUUID(),
    public_key: Buffer.from(keys.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64') }, privateKey: keys.privateKey };
}
function fixture() {
  const requester = participant(), worker = participant();
  const contract = { format: 'agenttool-mission-work-contract/v1', task_id: randomUUID(), origin: 'https://work-fixture.invalid',
    mission_id: randomUUID(), mission_digest: `sha256:${'a'.repeat(64)}`, requester: requester.pin, worker: worker.pin,
    expires_at: '2026-10-01T12:00:00.000Z', title: 'Review selected arrival text', source: { label: 'arrival.txt', sha256: `sha256:${sha(source)}`, bytes: source.length },
    instruction: 'Choose two source observations and explain why each matters.',
    acceptance_criteria: ['Two exact quotations from distinct source lines', 'A requester reviews the claims'],
    payment: 'NOT_REQUIRED', profile: 'two-source-observations/v1' };
  const artifact = { observations: [{ line: 1, quote: 'Arrival is optional.', note: 'Joining is a choice.' },
    { line: 3, quote: 'Refusal remains available.', note: 'The participant can refuse.' }] };
  function event(stage: string, previous: any, payload?: any, options: any = {}) {
    const sender = options.sender ?? (['offer', 'review', 'cancel'].includes(stage) ? requester : worker);
    const to = sender === requester ? worker : requester;
    const envelope = { format: 'agenttool-mission-chat/v1', conversation: options.conversation ?? contract.task_id, to_identity: to.pin.identity_id,
      kind: options.kind ?? 'message', text: options.text ?? encodeWorkRecord(contract, stage, previous, payload) };
    const observation = { event_id: options.eventId ?? randomUUID(), summary: JSON.stringify(envelope) };
    const raw = JSON.stringify(observation), timestamp = '2026-10-01T10:00:00.000Z';
    const target = `/v1/collaboration/missions/${contract.mission_id}/events`;
    const signatureDigest = createHash('sha256').update(['agenttool-collaboration-request/v1', contract.origin, 'POST', target,
      contract.mission_id, sender.pin.grant_id, sender.pin.identity_id, sender.pin.signing_key_id, sha(raw), timestamp].join('\0')).digest();
    const receipt = { event_id: observation.event_id, mission_id: contract.mission_id, identity_id: sender.pin.identity_id,
      signing_key_id: sender.pin.signing_key_id, grant_id: sender.pin.grant_id, received_seq: options.cursor ?? '1', received_at: timestamp,
      raw_body: raw, body_sha256: sha(raw), observation, proof: { domain: 'agenttool-collaboration-request/v1', origin: contract.origin,
        method: 'POST', request_target: target, raw_body: raw, body_sha256: sha(raw), timestamp,
        public_key: sender.pin.public_key, signature: sign(null, signatureDigest, sender.privateKey).toString('base64url') } };
    return { event_id: observation.event_id, cursor: receipt.received_seq, body_sha256: sha(raw), message: envelope, receipt };
  }
  const head = (item: any) => ({ event_id: item.event_id, body_sha256: item.body_sha256 });
  function chain(outcome = 'accepted') {
    const offer = event('offer', null), accept = event('accept', head(offer));
    const deliver = event('deliver', head(accept), artifact), review = event('review', head(deliver), { outcome, reason: 'Checked the selected quotes and notes.' });
    return { offer, accept, deliver, review, all: [offer, accept, deliver, review] };
  }
  return { contract, artifact, requester, worker, event, head, chain };
}

describe('pure selected work contract', () => {
  test('contract digest is key-order independent, terms-sensitive and immutable', () => {
    const { contract } = fixture(), validated = validateContract(contract);
    expect(contractDigest(Object.fromEntries(Object.entries(contract).reverse()))).toBe(contractDigest(contract));
    expect(contractDigest({ ...contract, instruction: 'Another chosen purpose' })).not.toBe(contractDigest(contract));
    expect(Object.isFrozen(validated.requester)).toBe(true);
    expect(Object.isFrozen(validated.acceptance_criteria)).toBe(true);
    contract.acceptance_criteria[0] = 'Later caller mutation';
    expect(validated.acceptance_criteria[0]).toBe('Two exact quotations from distinct source lines');
  });

  test('closed contract rejects wrong scope, money, conflated participants and invalid bounds', () => {
    const mutations = [
      (c: any) => { c.extra = true; }, (c: any) => { c.origin += '/'; }, (c: any) => { c.origin = 'http://work.invalid'; },
      (c: any) => { c.payment = 'SATISFIED'; }, (c: any) => { c.profile = 'execute-command/v1'; },
      (c: any) => { c.worker.identity_id = c.requester.identity_id; }, (c: any) => { c.worker.public_key = c.requester.public_key; },
      (c: any) => { c.worker.grant_id = c.requester.grant_id; }, (c: any) => { c.worker.signing_key_id = c.requester.signing_key_id; },
      (c: any) => { c.worker.public_key = c.worker.public_key.replace(/=$/, ''); },
      (c: any) => { c.expires_at = '2026-10-01'; }, (c: any) => { c.source.bytes = 0; },
      (c: any) => { c.source.bytes = 131073; }, (c: any) => { c.source.bytes = 1.5; },
      (c: any) => { c.title = 'x'.repeat(161); }, (c: any) => { c.instruction = '\ud800'; },
      (c: any) => { c.acceptance_criteria = []; }, (c: any) => { c.acceptance_criteria = Array(6).fill('criterion'); },
    ];
    for (const mutate of mutations) { const c = structuredClone(fixture().contract); mutate(c); expect(() => validateContract(c)).toThrow(WorkError); }
    let called = false;
    const c = fixture().contract;
    Object.defineProperty(c, 'title', { get() { called = true; return 'hidden'; } });
    expect(() => validateContract(c)).toThrow(WorkError); expect(called).toBe(false);
  });

  test('source validation binds original bytes, line numbers and exact quotations without certifying notes', () => {
    const { contract, artifact } = fixture();
    const result = validateArtifact(contract, artifact, source);
    expect(result).toEqual(artifact); expect(Object.isFrozen(result.observations[0])).toBe(true);
    expect(() => validateArtifact(contract, artifact, Buffer.from(source.toString().replace('\r\n', '\n')))).toThrow(WorkError);
    const sameLength = Buffer.from(source); sameLength[0] = 'a'.charCodeAt(0);
    expect(() => validateArtifact(contract, artifact, sameLength)).toThrow(WorkError);
    const badQuote = structuredClone(artifact); badQuote.observations[0].quote = 'arrival is optional.';
    expect(() => validateArtifact(contract, badQuote, source)).toThrow(WorkError);
    const wrongLine = structuredClone(artifact); wrongLine.observations[0].line = 2;
    expect(() => validateArtifact(contract, wrongLine, source)).toThrow(WorkError);
    const sameLine = structuredClone(artifact); sameLine.observations[1].line = 1;
    expect(() => validateArtifact(contract, sameLine, source)).toThrow(WorkError);
    const judgment = structuredClone(artifact); judgment.observations[0].note = 'An unsupported interpretation, still a participant claim.';
    expect(validateArtifact(contract, judgment, source)).toEqual(judgment);
  });

  test('source profile rejects malformed UTF-8, oversized inputs and malformed artifact fields', () => {
    const { contract, artifact } = fixture();
    const invalid = Buffer.from([0xc3, 0x28]);
    expect(() => validateArtifact({ ...contract, source: { ...contract.source, bytes: invalid.length, sha256: `sha256:${sha(invalid)}` } }, artifact, invalid)).toThrow(WorkError);
    for (const patch of [{ line: 0 }, { line: 0.5 }, { line: 99 }, { quote: '' }, { quote: 'q'.repeat(91) }, { note: 'n'.repeat(121) }, { command: 'run me' }]) {
      const changed = structuredClone(artifact); Object.assign(changed.observations[0], patch);
      expect(() => validateArtifact(contract, changed, source)).toThrow(WorkError);
    }
    expect(() => validateArtifact(contract, { observations: [artifact.observations[0]] }, source)).toThrow(WorkError);
    expect(() => validateArtifact(contract, artifact, new Uint8Array(new SharedArrayBuffer(source.length)))).toThrow(WorkError);
  });

  test('records have exact stage payloads, canonical bytes and bounded Unicode scalars', () => {
    const { contract, artifact, event, head } = fixture(), offer = event('offer', null);
    expect(JSON.parse(encodeWorkRecord(contract, 'deliver', head(offer), artifact))).toEqual(buildWorkRecord(contract, 'deliver', head(offer), artifact));
    for (const args of [['offer', head(offer)], ['accept', null], ['run', head(offer)], ['offer', null, {}],
      ['accept', head(offer), { reason: 'extra' }], ['review', head(offer), { outcome: 'unknown', reason: 'no' }],
      ['cancel', head(offer), { reason: 'r'.repeat(121) }], ['decline', head(offer), { reason: 'no', command: true }]]) {
      expect(() => buildWorkRecord(contract, ...args)).toThrow(WorkError);
    }
    expect(() => buildWorkRecord(contract, 'accept', { event_id: offer.event_id, body_sha256: `sha256:${offer.body_sha256}` })).toThrow(WorkError);
    const escaped = structuredClone(artifact); escaped.observations[0].note = '\u0001'.repeat(120);
    escaped.observations[1].note = '\u0001'.repeat(120);
    expect(() => encodeWorkRecord(contract, 'deliver', head(offer), escaped)).toThrow(WorkError);
  });

  test('one complete chain projects independently of input order or service cursor order', () => {
    const f = fixture(), c = f.chain();
    const result = projectWork(f.contract, [c.review, c.accept, c.offer, c.deliver, c.offer]);
    expect(result.status).toBe('review_accepted'); expect(result.head).toEqual(f.head(c.review));
    expect(result.records).toEqual(c.all); expect(result.artifact).toEqual(f.artifact);
    expect(result.receipt.result).toEqual(f.head(c.deliver)); expect(result.receipt.review).toEqual(f.head(c.review));
    expect(result.receipt.source_sha256).toBe(f.contract.source.sha256);
    expect(result.receipt.payment).toBe('NOT_REQUIRED');
    expect(result.receipt.limitations).toContain('review_is_requester_claim_not_quality_proof');
    expect(Object.isFrozen(result.records[0].receipt.proof)).toBe(true);
    c.offer.message.text = 'Caller changed its object';
    expect(result.records[0].message.text).not.toBe(c.offer.message.text);
  });

  test('prefixes and a rejected review preserve distinct statuses without an early success receipt', () => {
    const f = fixture(), c = f.chain('rejected');
    const statuses = ['none', 'offered', 'work_accepted', 'delivered', 'review_rejected'];
    for (let size = 0; size <= 4; size++) {
      const result = projectWork(f.contract, c.all.slice(0, size));
      expect(result.status).toBe(statuses[size]);
      expect(result.receipt === null).toBe(size < 4);
    }
    expect(projectWork(f.contract, c.all).receipt.outcome).toBe('rejected');
  });

  test('decline and either permitted cancellation are terminal, without a reviewed receipt', () => {
    const f = fixture(), c = f.chain();
    for (const [prefix, stage, status] of [[[c.offer], 'decline', 'declined'], [[c.offer], 'cancel', 'cancelled'], [[c.offer, c.accept], 'cancel', 'cancelled']] as const) {
      const terminal = f.event(stage, f.head(prefix.at(-1)), { reason: 'Chosen stop' });
      const result = projectWork(f.contract, [...prefix, terminal]);
      expect(result.status).toBe(status); expect(result.receipt).toBeNull();
      const next = f.event('accept', f.head(terminal));
      expect(() => projectWork(f.contract, [...prefix, terminal, next])).toThrow(WorkError);
    }
    expect(() => projectWork(f.contract, [...c.all.slice(0, 3), f.event('cancel', f.head(c.deliver), { reason: 'Too late' })])).toThrow(WorkError);
  });

  test('forks, repeated stages, missing predecessors and digest substitution fail closed', () => {
    const f = fixture(), c = f.chain();
    const secondOffer = f.event('offer', null), secondAccept = f.event('accept', f.head(c.offer));
    for (const records of [[c.offer, secondOffer], [c.offer, c.accept, secondAccept], [c.accept],
      [c.offer, f.event('deliver', f.head(c.offer), f.artifact)],
      [c.offer, f.event('accept', { ...f.head(c.offer), body_sha256: '0'.repeat(64) })],
      [c.offer, c.accept, f.event('accept', f.head(c.accept))]]) {
      expect(() => projectWork(f.contract, records)).toThrow(WorkError);
    }
    const changed = structuredClone(c.offer); changed.receipt.received_at = '2026-10-01T10:01:00.000Z';
    expect(() => projectWork(f.contract, [c.offer, changed])).toThrow(WorkError);
  });

  test('ACKs never act as acceptance and only the pinned stage role may author a record', () => {
    const f = fixture(), c = f.chain();
    const ack = f.event('accept', f.head(c.offer), undefined, { kind: 'read_ack' });
    expect(() => projectWork(f.contract, [c.offer, ack])).toThrow(WorkError);
    for (const [prefix, stage, previous, payload, sender] of [[[], 'offer', null, undefined, f.worker],
      [[c.offer], 'accept', f.head(c.offer), undefined, f.requester], [[c.offer, c.accept], 'deliver', f.head(c.accept), f.artifact, f.requester],
      [[c.offer, c.accept, c.deliver], 'review', f.head(c.deliver), { outcome: 'accepted', reason: 'self approved' }, f.worker]] as any[]) {
      expect(() => projectWork(f.contract, [...prefix, f.event(stage, previous, payload, { sender })])).toThrow(WorkError);
    }
  });

  test('selected task records reject foreign terms, noncanonical bytes, duplicate keys and unknown fields', () => {
    const f = fixture(), clean = encodeWorkRecord(f.contract, 'offer', null);
    const otherTerms = JSON.parse(clean); otherTerms.terms = `sha256:${'f'.repeat(64)}`;
    for (const raw of [' ' + clean, JSON.stringify(JSON.parse(clean), null, 2), clean.replace('"stage":"offer"', '"stage":"accept","stage":"offer"'),
      clean.replace('"format":', '"extra":true,"format":'), JSON.stringify(otherTerms), clean.replace('agenttool-mission-work/v1', 'agenttool-mission-work/v2')]) {
      expect(() => projectWork(f.contract, [f.event('offer', null, undefined, { text: raw })])).toThrow(WorkError);
    }
  });

  test('verified display substitution, wrong mission/origin/pin and expired evidence are refused', () => {
    const f = fixture(), c = f.chain();
    const mutations = [(x: any) => { x.message.text = encodeWorkRecord(f.contract, 'offer', null).replace('offer', 'accept'); },
      (x: any) => { x.receipt.mission_id = randomUUID(); }, (x: any) => { x.receipt.proof.origin = 'https://other.invalid'; },
      (x: any) => { x.receipt.signing_key_id = randomUUID(); }, (x: any) => { x.receipt.proof.public_key = f.worker.pin.public_key; },
      (x: any) => { x.receipt.raw_body += ' '; }, (x: any) => { x.receipt.received_at = '2026-10-01T12:00:00.001Z'; },
      (x: any) => { x.receipt.received_at = f.contract.expires_at; }, (x: any) => { x.receipt.proof.timestamp = f.contract.expires_at; }];
    for (const mutate of mutations) { const changed = structuredClone(c.offer); mutate(changed); expect(() => projectWork(f.contract, [changed])).toThrow(WorkError); }
    expect(() => projectWork(f.contract, [f.event('offer', null, undefined, { conversation: 'another-conversation' })])).toThrow(WorkError);
  });

  test('ordinary chat and another task remain outside this selected work chain', () => {
    const f = fixture(), other = fixture();
    const ordinary = f.event('offer', null, undefined, { text: 'Hello, received your invitation.', kind: 'read_ack' });
    expect(projectWork(f.contract, [ordinary, other.event('offer', null)]).status).toBe('none');
    expect(projectWork(f.contract, []).head).toBeNull();
  });
});
