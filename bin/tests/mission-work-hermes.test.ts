/** Offline opt-in Hermes worker tests: no provider or live service. */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { canonicalMissionRequestBytes } from "../../api/src/services/collaboration/proof";
import { correspondenceCanonicalJson } from "../../api/src/services/correspondence/canonical";
import * as client from "../agenttool-mission.mjs";
import * as work from "../mission-work.mjs";
import * as hermes from "../mission-work-hermes.mjs";
import { contractDigest } from "../mission-work-contract.mjs";
const ORIGIN = "https://work-fixture.invalid";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sha = (value: string | Uint8Array) => `sha256:${hash(value)}`;
const canonical = correspondenceCanonicalJson;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mission work's fixture-")));
  chmodSync(root, 0o700);
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const missionId = randomUUID(), expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Two independent roots exchange selected observations",
    resources: [], acceptance_criteria: ["Explicitly review two source observations"], principalities: [] };
  const missionDigest = `sha256:${hash(correspondenceCanonicalJson(descriptor))}`;
  const seat = (label: string) => {
    const state = join(root, label), enrollment = client.init(state, ORIGIN);
    const profile = { format: "agenttool-mission-invitation/v1", origin: ORIGIN, mission_id: missionId,
      identity_id: randomUUID(), signing_key_id: randomUUID(), grant_id: randomUUID(), public_key: enrollment.public_key,
      expires_at: expiresAt, token: `atcm_${randomBytes(32).toString("base64url")}` };
    const invitation = join(root, `${label}-invitation.json`);
    writeFileSync(invitation, JSON.stringify(profile), { mode: 0o600 });
    client.importInvitation(state, invitation);
    const pin = Object.fromEntries(["identity_id", "signing_key_id", "grant_id", "public_key"].map(k => [k, profile[k as keyof typeof profile]]));
    const privateKey = createPrivateKey(readFileSync(join(state, "signing-key.pem")));
    const publicKey = createPublicKey(privateKey);
    return { state, profile, pin, privateKey, publicKey };
  };
  const requester = seat("requester"), worker = seat("worker"), seats = [requester, worker];
  const sourceBytes = Buffer.from("A lantern remains lit beside the river.\nA bridge gives both travellers a way home.\n", "utf8");
  const contract = { format: "agenttool-mission-work-contract/v1", task_id: randomUUID(), origin: ORIGIN,
    mission_id: missionId, mission_digest: missionDigest, requester: requester.pin, worker: worker.pin,
    expires_at: new Date(Date.now() + 1_800_000).toISOString(), title: "Read two selected lines",
    source: { label: "selected-source.txt", sha256: `sha256:${hash(sourceBytes)}`, bytes: sourceBytes.length },
    instruction: "Return two observations about this selected source.",
    acceptance_criteria: ["Quote two distinct source lines and explain each observation."],
    payment: "NOT_REQUIRED", profile: "two-source-observations/v1" };
  const observations = [
    { line: 1, quote: "A lantern remains lit beside the river.", note: "The light marks a place to return to." },
    { line: 2, quote: "A bridge gives both travellers a way home.", note: "The bridge supports both travellers." },
  ];
  const controls = {
    calls: [] as Array<{ method: string; target: string; grant_id: string; raw: string }>,
    events: [] as any[], postMode: "normal" as "normal" | "store-then-throw" | "throw-before-store",
    hidden: false, invitationStatus: 200, contextStatus: 200,
    mutateMetadata: (value: any) => value,
    mutatePage: (value: any) => value,
  };
  const metadata = (selected: typeof requester) => controls.mutateMetadata({
    mission: { mission_id: missionId, descriptor, mission_digest: missionDigest, expires_at: expiresAt, revoked_at: null },
    grant: { mission_id: missionId, ...selected.pin, origin: ORIGIN, expires_at: expiresAt, revoked_at: null,
      actions: ["mission.read", "mission.observe"], accepted_at: new Date().toISOString() },
  });
  const signedEvent = (selected: typeof requester, raw: string, timestamp: string, signature: string, sequence: number) => {
    const body = JSON.parse(raw), target = `/v1/collaboration/missions/${missionId}/events`;
    return { event_id: body.event_id, mission_id: missionId,
      identity_id: selected.pin.identity_id, signing_key_id: selected.pin.signing_key_id, grant_id: selected.pin.grant_id,
      received_seq: String(sequence), received_at: timestamp, observation: body,
      raw_body: raw, body_sha256: hash(raw), proof: { domain: "agenttool-collaboration-request/v1", origin: ORIGIN,
        method: "POST", request_target: target, raw_body: raw, body_sha256: hash(raw), timestamp,
        public_key: selected.pin.public_key, signature } };
  };
  const appendSigned = (selected: typeof requester, summary: string, eventId = randomUUID()) => {
    const raw = JSON.stringify({ event_id: eventId, summary }), timestamp = new Date().toISOString();
    const target = `/v1/collaboration/missions/${missionId}/events`;
    const bytes = canonicalMissionRequestBytes({ origin: ORIGIN, missionId, method: "POST", requestTarget: target,
      bodyBytes: Buffer.from(raw), proof: { grantId: selected.profile.grant_id, identityId: selected.profile.identity_id,
        keyId: selected.profile.signing_key_id, timestamp, signature: "" } });
    const admitted = signedEvent(selected, raw, timestamp, sign(null, bytes, selected.privateKey).toString("base64url"), controls.events.length + 1);
    controls.events.push(admitted);
    return admitted;
  };
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)), headers = new Headers(init.headers), method = String(init.method);
    const target = url.pathname + url.search, raw = init.body === undefined ? "" : String(init.body);
    const selected = seats.find(value => value.profile.grant_id === headers.get("X-Agenttool-Mission-Grant-Id"));
    if (!selected || url.origin !== ORIGIN || headers.get("Authorization") !== `Bearer ${selected.profile.token}` ||
        headers.get("X-Agenttool-Mission-Identity-Id") !== selected.profile.identity_id ||
        headers.get("X-Agenttool-Mission-Key-Id") !== selected.profile.signing_key_id) return response({ error: "fixture_scope_mismatch" }, 401);
    const timestamp = headers.get("X-Agenttool-Mission-Timestamp")!, signature = headers.get("X-Agenttool-Mission-Signature")!;
    // Independent API canonicalization checks the request bytes actually received.
    const bytes = canonicalMissionRequestBytes({ origin: ORIGIN, missionId, method: method as "POST" | "GET", requestTarget: target,
      bodyBytes: Buffer.from(raw), proof: { grantId: selected.profile.grant_id, identityId: selected.profile.identity_id,
        keyId: selected.profile.signing_key_id, timestamp, signature } });
    if (!verify(null, bytes, selected.publicKey, Buffer.from(signature, "base64url"))) return response({ error: "fixture_bad_signature" }, 401);
    controls.calls.push({ method, target, grant_id: selected.profile.grant_id, raw });
    if (url.pathname.endsWith("/invitation")) return response(metadata(selected), controls.invitationStatus);
    if (url.pathname.endsWith("/context")) return response(metadata(selected), controls.contextStatus);
    if (url.pathname.endsWith("/events") && method === "GET") {
      const after = url.searchParams.get("after")!, visible = controls.hidden ? [] : controls.events;
      const eligible = visible.filter(value => BigInt(value.received_seq) > BigInt(after)), page = eligible.slice(0, 20);
      return response(controls.mutatePage({ mission_id: missionId, events: structuredClone(page),
        page: { after, next_cursor: page.at(-1)?.received_seq ?? after, has_more: eligible.length > page.length } }));
    }
    if (url.pathname.endsWith("/events") && method === "POST") {
      if (controls.postMode === "throw-before-store") throw new Error("Synthetic request lost before storage");
      const admitted = signedEvent(selected, raw, timestamp, signature, controls.events.length + 1);
      controls.events.push(admitted);
      if (controls.postMode === "store-then-throw") throw new Error("Synthetic response lost after storage");
      return response({ event: admitted });
    }
    return response({ error: "fixture_unexpected_operation" }, 400);
  };
  return { root, requester, worker, sourceBytes, observations, contract, controls, fetchImpl, appendSigned };
}

type Fixture = ReturnType<typeof fixture>;
const posts = (f: Fixture) => f.controls.calls.filter(value => value.method === 'POST');
const advance = (f: Fixture, seat: Fixture['worker'], stage: string, payload?: unknown) =>
  work.advanceWork(seat.state, f.contract, stage, { sourceBytes: f.sourceBytes, fetchImpl: f.fetchImpl, payload });
const attemptRoot = (f: Fixture) => join(f.worker.state, 'work', f.contract.task_id, 'hermes-execution');
function permitFor(f: Fixture, stages = ['accept', 'deliver']) {
  const source = join(f.root, 'source.txt'); writeFileSync(source, f.sourceBytes, { mode: 0o600 });
  return { format: 'agenttool-hermes-work-permit/v1', permit_id: randomUUID(), task_id: f.contract.task_id,
    terms: contractDigest(f.contract), worker: f.worker.pin, source_file: source,
    expires_at: f.contract.expires_at, allowed_stages: stages,
    runtime: { kind: 'hermes-selected-source/v1', python_executable: '/usr/bin/python3', hermes_root: f.root },
    limits: { duration_seconds: 10, max_jobs: 1, max_deliveries: 1 } };
}
function success(f: Fixture, job: any, options: any) {
  const pin = JSON.parse(readFileSync(new URL('../mission-work-hermes-runtime.json', import.meta.url), 'utf8'));
  const artifact = { observations: structuredClone(f.observations) }, session = `test_${randomUUID()}`;
  const attestation = { format: 'agenttool-hermes-source-guard/v1', guard: 'pathless-source/v1',
    task_id: job.task_id, terms: job.terms, challenge: job.challenge, source_sha256: job.source.sha256,
    source_bytes: job.source.bytes, session_id: session, runtime_commit: pin.commit,
    runtime_sha256: pin.fingerprint, runtime_dirty: true, allowed_tools: ['read_selected_source'],
    context: 'explicit-job-only', boundary: 'model-tool-dispatch-not-os-sandbox' };
  writeFileSync(join(options.cwd, 'guard-attestation.json'), canonical(attestation), { mode: 0o600, flag: 'wx' });
  return { format: 'agenttool-hermes-source-result/v1', status: 'completed', task_id: job.task_id,
    terms: job.terms, challenge: job.challenge, artifact,
    evidence: { format: 'agenttool-hermes-source-evidence/v1', guard: 'pathless-source/v1',
      runtime_commit: pin.commit, runtime_sha256: pin.fingerprint, runtime_dirty: true, session_id: session,
      source_sha256: job.source.sha256, source_bytes: job.source.bytes,
      guard_attestation_sha256: sha(canonical(attestation)), read_calls: [{ tool_call_id: 'read_1',
        call_message_id: 2, result_message_id: 3,
        result_sha256: sha(canonical({ format: 'agenttool-selected-source/v1', challenge: job.challenge, source: job.source })) }],
      final_message_id: 4, final_sha256: sha(canonical({ challenge: job.challenge, artifact })),
      forbidden_requests: 0, completed: true } };
}
const run = (f: Fixture, permit: any, runner: any, extras = {}) => hermes.runHermesWork(f.worker.state, f.contract,
  permit, { fetchImpl: f.fetchImpl, pollIntervalMs: 1, runner, ...extras });
async function refused(operation: Promise<unknown>, reason: string) {
  try { await operation; throw new Error('Expected refusal'); }
  catch (error: any) { expect(error.stop_reason).toBe(reason); return error; }
}
const unlocked = (f: Fixture) => expect(existsSync(join(attemptRoot(f), 'running.lock'))).toBe(false);
function fakePython(f: Fixture, body: string) {
  const executable = join(f.root, 'fake-python');
  writeFileSync(executable, '#!/usr/bin/python3\nimport os,sys,json,time,signal,subprocess\njob=json.load(sys.stdin)\n' + body + '\n', { mode: 0o700 });
  return executable;
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error: any) { if (error.code === 'ESRCH') return false; throw error; }
}

describe.skipIf(process.platform === 'win32')('locally permitted finite Hermes work', () => {
  test('offline inspection binds exact terms without API, execution or state creation', () => {
    const f = fixture(), permit = permitFor(f), before = readdirSync(f.worker.state);
    const result = hermes.inspectHermesWork(f.worker.state, f.contract, permit);
    expect(result.terms).toBe(contractDigest(f.contract));
    expect(result.attempt).toBeNull(); expect(result.allowed_stages).toEqual(['accept', 'deliver']);
    expect(result.confinement).toBe('model_tool_boundary_not_os_sandbox');
    expect(f.controls.calls).toEqual([]); expect(readdirSync(f.worker.state)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain(f.worker.profile.token);
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
  });

  test('strict local permit refuses changed terms, role, authority, source and lifetime', () => {
    const f = fixture(), permit = permitFor(f);
    const mutations = [
      (p: any) => p.permit_id = [p.permit_id],
      (p: any) => p.terms = `sha256:${'0'.repeat(64)}`,
      (p: any) => p.worker = f.requester.pin,
      (p: any) => p.task_id = randomUUID(),
      (p: any) => p.allowed_stages = ['accept', 'deliver', 'review'],
      (p: any) => p.allowed_stages = ['deliver', 'accept'],
      (p: any) => p.runtime.model = 'peer-selected-model',
      (p: any) => p.limits.max_jobs = 2,
      (p: any) => p.limits.max_deliveries = 2,
      (p: any) => p.limits.duration_seconds = 901,
      (p: any) => p.expires_at = new Date(Date.parse(f.contract.expires_at) + 1).toISOString(),
      (p: any) => p.source_file = './relative-source',
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(permit); mutate(changed);
      expect(() => hermes.validateHermesWorkPermit(changed, f.contract)).toThrow();
    }
    expect(() => hermes.inspectHermesWork(f.requester.state, f.contract, permit)).toThrow();
    writeFileSync(permit.source_file, 'changed');
    expect(() => hermes.inspectHermesWork(f.worker.state, f.contract, permit)).toThrow();
    expect(f.controls.calls).toEqual([]); expect(existsSync(attemptRoot(f))).toBe(false);
  });

  test('watch starts before offer, then accepts and delivers one source-backed artifact without review', async () => {
    const f = fixture(), permit = permitFor(f);
    let launches = 0;
    const started = run(f, permit, async (job: any, options: any) => {
      launches++;
      expect(existsSync(join(attemptRoot(f), 'intent.json'))).toBe(true);
      expect(job.source.text).toBe(f.sourceBytes.toString('utf8'));
      expect(job.source.sha256).toBe(f.contract.source.sha256);
      expect(Object.keys(job).sort()).toEqual(['format', 'task_id', 'terms', 'source', 'instruction', 'acceptance_criteria', 'challenge', 'hermes_root'].sort());
      expect(JSON.stringify(job)).not.toContain(f.worker.state);
      expect(JSON.stringify(job)).not.toContain(f.worker.profile.token);
      expect(JSON.stringify(job)).not.toContain(permit.source_file);
      expect(job.challenge).toMatch(/^[0-9a-f]{64}$/);
      expect(options.timeoutMs).toBeLessThanOrEqual(10000);
      return success(f, job, options);
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(launches).toBe(0); expect(posts(f)).toHaveLength(0);
    expect(existsSync(join(attemptRoot(f), 'started.json'))).toBe(true);
    await advance(f, f.requester, 'offer');
    const result = await started;
    expect(result.status).toBe('stored'); expect(result.projection.status).toBe('delivered');
    expect(result.projection.artifact).toEqual({ observations: f.observations });
    expect(result.projection.review).toBeNull(); expect(result.projection.receipt).toBeNull();
    expect(launches).toBe(1); expect(posts(f)).toHaveLength(3);
    unlocked(f);
    await refused(run(f, { ...permit, permit_id: randomUUID() }, () => { launches++; }), 'attempt_exists');
    expect(launches).toBe(1); expect(posts(f)).toHaveLength(3);
    const inspection = hermes.inspectHermesWork(f.worker.state, f.contract, permit);
    expect(inspection.attempt.intent.previous.event_id).toBe(result.projection.records[1].event_id);
    expect(inspection.attempt.outcome.status).toBe('stored');
    for (const name of ['permit.json', 'started.json', 'intent.json', 'native-result.json', 'artifact.json', 'outcome.json'])
      expect(statSync(join(attemptRoot(f), name)).mode & 0o777).toBe(0o600);
  });

  test('deliver-only permit requires existing accepted work and never sends acceptance', async () => {
    const f = fixture(), permit = permitFor(f, ['deliver']); await advance(f, f.requester, 'offer');
    await refused(run(f, permit, () => { throw new Error('must not launch'); }), 'acceptance_required');
    expect(posts(f)).toHaveLength(1); unlocked(f);
    const other = fixture(), acceptedPermit = permitFor(other, ['deliver']);
    await advance(other, other.requester, 'offer'); await advance(other, other.worker, 'accept');
    const result = await run(other, acceptedPermit, (job: any, options: any) => success(other, job, options));
    expect(result.projection.status).toBe('delivered'); expect(posts(other)).toHaveLength(3);
  });

  test('local concurrent attempts serialize before poll and no replacement permit can launch', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
    let unblock!: () => void, entered!: () => void, launches = 0;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    const first = run(f, permit, async (job: any, options: any) => { launches++; entered(); await blocked; return success(f, job, options); });
    await enteredPromise;
    await refused(run(f, { ...permit, permit_id: randomUUID() }, () => { launches++; }), 'attempt_exists');
    unblock(); expect((await first).projection.status).toBe('delivered'); expect(launches).toBe(1); unlocked(f);
  });

  test('ambiguous acceptance never launches; exact later sync does not authorize automatic replay', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
    f.controls.postMode = 'store-then-throw'; let launched = false;
    await refused(run(f, permit, () => { launched = true; }), 'send_uncertain');
    expect(launched).toBe(false); expect(posts(f)).toHaveLength(2); unlocked(f);
    f.controls.postMode = 'normal';
    expect((await work.syncWork(f.worker.state, f.contract, { fetchImpl: f.fetchImpl })).status).toBe('work_accepted');
    await refused(run(f, permit, () => { launched = true; }), 'attempt_exists');
    expect(launched).toBe(false);
  });

  test('native launch failure remains consumed across reopening and does not deliver', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer'); let launches = 0;
    await expect(run(f, permit, () => { launches++; throw new Error('uncertain native admission'); })).rejects.toThrow();
    expect(existsSync(join(attemptRoot(f), 'intent.json'))).toBe(true); expect(posts(f)).toHaveLength(2);
    await refused(run(f, permit, () => { launches++; }), 'attempt_exists');
    expect(launches).toBe(1); unlocked(f);
  });

  test('native artifact, read proof, runtime pin and guard attestation must all match before signing', async () => {
    const mutations = [
      (r: any) => r.challenge = '0'.repeat(64),
      (r: any) => r.task_id = randomUUID(),
      (r: any) => r.terms = `sha256:${'0'.repeat(64)}`,
      (r: any) => r.artifact.observations[0].quote = 'Not in source',
      (r: any) => r.evidence.read_calls = [],
      (r: any) => r.evidence.read_calls[0].result_sha256 = `sha256:${'0'.repeat(64)}`,
      (r: any) => r.evidence.read_calls[0].result_message_id = r.evidence.final_message_id,
      (r: any) => r.evidence.runtime_sha256 = `sha256:${'0'.repeat(64)}`,
      (r: any) => r.evidence.final_sha256 = `sha256:${'0'.repeat(64)}`,
      (r: any) => r.evidence.guard_attestation_sha256 = `sha256:${'0'.repeat(64)}`,
      (r: any) => r.evidence.forbidden_requests = 1,
      (r: any) => r.evidence.completed = false,
      (r: any) => r.evidence.unexpected = true,
    ];
    for (const mutate of mutations) {
      const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
      await refused(run(f, permit, (job: any, options: any) => { const result = success(f, job, options); mutate(result); return result; }), 'verification_failed');
      expect(posts(f)).toHaveLength(2); unlocked(f);
    }
  });

  test('cancellation or grant revocation during native work prevents artifact publication', async () => {
    for (const change of ['cancel', 'revoke']) {
      const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
      const operation = run(f, permit, async (job: any, options: any) => {
        const result = success(f, job, options);
        if (change === 'cancel') await advance(f, f.requester, 'cancel', { reason: 'Task withdrawn during execution.' });
        else f.controls.mutateMetadata = value => ({ ...value, mission: { ...value.mission, revoked_at: new Date().toISOString() } });
        return result;
      });
      await expect(operation).rejects.toThrow();
      expect(posts(f).filter(value => value.grant_id === f.worker.pin.grant_id)).toHaveLength(1);
      expect(existsSync(join(attemptRoot(f), 'artifact.json'))).toBe(true); unlocked(f);
    }
  });

  test('ambiguous delivery saves artifact and exact outbox but never reruns or replaces send', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer'); let launches = 0;
    await refused(run(f, permit, (job: any, options: any) => {
      launches++; const result = success(f, job, options); f.controls.postMode = 'store-then-throw'; return result;
    }), 'send_uncertain');
    expect(posts(f)).toHaveLength(3); expect(existsSync(join(attemptRoot(f), 'artifact.json'))).toBe(true); unlocked(f);
    f.controls.postMode = 'normal';
    const synchronized = await work.syncWork(f.worker.state, f.contract, { fetchImpl: f.fetchImpl });
    expect(synchronized.status).toBe('delivered'); expect(synchronized.pending_intents).toEqual([]);
    await refused(run(f, permit, () => { launches++; }), 'attempt_exists'); expect(launches).toBe(1);
  });

  test('known stored delivery keeps stored_sync_required instead of converting it into a retry', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
    const fetchImpl = async (input: any, init: any) => {
      const result = await f.fetchImpl(input, init);
      if (init.method === 'POST' && f.controls.events.length === 3) f.controls.contextStatus = 503;
      return result;
    };
    const result = await run(f, permit, (job: any, options: any) => success(f, job, options), { fetchImpl });
    expect(result.status).toBe('stored_sync_required'); expect(result.event_id).toBe(f.controls.events[2].event_id);
    expect(posts(f)).toHaveLength(3); unlocked(f);
    await refused(run(f, permit, () => { throw new Error('must not replay'); }), 'attempt_exists');
  });

  test('pre-offer stop is finite, leaves one reserved attempt, and pre-abort creates none', async () => {
    const f = fixture(), permit = permitFor(f), controller = new AbortController();
    const result = run(f, permit, () => { throw new Error('no offer'); }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await refused(result, 'cancelled'); expect(posts(f)).toHaveLength(0); unlocked(f);
    await refused(run(f, permit, () => {}), 'attempt_exists');
    const other = fixture(), otherPermit = permitFor(other), stopped = new AbortController(); stopped.abort();
    await refused(run(other, otherPermit, () => {}, { signal: stopped.signal }), 'cancelled');
    expect(existsSync(attemptRoot(other))).toBe(false); expect(other.controls.calls).toEqual([]);
  });

  test('known stored acceptance with failed sync is reported without launching the model', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer'); let launches = 0;
    const fetchImpl = async (input: any, init: any) => {
      const result = await f.fetchImpl(input, init);
      if (init.method === 'POST' && f.controls.events.length === 2) f.controls.contextStatus = 503;
      return result;
    };
    const result = await run(f, permit, () => { launches++; }, { fetchImpl });
    expect(result.status).toBe('stored_sync_required'); expect(result.work_stage).toBe('accept');
    expect(launches).toBe(0); expect(posts(f)).toHaveLength(2); unlocked(f);
  });

  test('actual subprocess strips ambient credentials and preserves nonzero exit without leaking stderr', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
    permit.runtime.python_executable = fakePython(f, `
with open('environment.json','x') as target:
 json.dump({'secret_present': 'AGENTTOOL_TEST_SECRET' in os.environ, 'provider_present': 'OPENAI_API_KEY' in os.environ, 'safe': os.environ.get('HERMES_SAFE_MODE'), 'pid':os.getpid()},target)
sys.stderr.write('private diagnostic that must stay discarded')
sys.exit(17)`);
    const previous = { sentinel: process.env.AGENTTOOL_TEST_SECRET, provider: process.env.OPENAI_API_KEY };
    process.env.AGENTTOOL_TEST_SECRET = 'test-only-sentinel'; process.env.OPENAI_API_KEY = 'test-only-provider-sentinel';
    try {
      const error = await refused(run(f, permit, undefined), 'runtime_failed');
      expect(error.message).not.toContain('private diagnostic');
      const recorded = JSON.parse(readFileSync(join(attemptRoot(f), 'native', 'environment.json'), 'utf8'));
      expect(recorded.secret_present).toBe(false); expect(recorded.provider_present).toBe(false);
      expect(recorded.safe).toBe('1'); expect(alive(recorded.pid)).toBe(false);
      expect(posts(f)).toHaveLength(2); unlocked(f);
    } finally {
      if (previous.sentinel === undefined) delete process.env.AGENTTOOL_TEST_SECRET; else process.env.AGENTTOOL_TEST_SECRET = previous.sentinel;
      if (previous.provider === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.provider;
    }
  });

  test('actual subprocess output overflow kills the owned process before any delivery', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
    permit.runtime.python_executable = fakePython(f, `
with open('pid.json','x') as target: json.dump(os.getpid(),target)
while True:
 sys.stdout.write('x'*65536); sys.stdout.flush()`);
    await refused(run(f, permit, undefined), 'runtime_failed');
    const pid = JSON.parse(readFileSync(join(attemptRoot(f), 'native', 'pid.json'), 'utf8'));
    expect(alive(pid)).toBe(false); expect(posts(f)).toHaveLength(2); unlocked(f);
  });

  test('actual subprocess retains only the exact safe native failure-code envelope', async () => {
    for (const variant of ['valid', 'extra', 'nonstring']) {
      const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
      const failure = { format: 'agenttool-hermes-source-result/v1', status: 'failed',
        code: variant === 'nonstring' ? ['GUARD_SETUP_FAILED'] : 'GUARD_SETUP_FAILED',
        ...(variant === 'extra' ? { diagnostics: 'must never be returned' } : {}) };
      permit.runtime.python_executable = fakePython(f, `print(${JSON.stringify(JSON.stringify(failure))})\nsys.exit(1)`);
      const error = await refused(run(f, permit, undefined), 'runtime_failed');
      const outcome = JSON.parse(readFileSync(join(attemptRoot(f), 'outcome.json'), 'utf8'));
      expect(error.native_code).toBe(variant === 'valid' ? 'GUARD_SETUP_FAILED' : undefined);
      expect(outcome.native_code).toBe(variant === 'valid' ? 'GUARD_SETUP_FAILED' : undefined);
      expect(JSON.stringify(outcome)).not.toContain('diagnostics'); expect(posts(f)).toHaveLength(2);
    }
  });

  test('actual subprocess deadline reaps its owned child group within the finite window', async () => {
    const f = fixture(), permit = permitFor(f); await advance(f, f.requester, 'offer');
    permit.limits.duration_seconds = 3;
    permit.runtime.python_executable = fakePython(f, `
child=subprocess.Popen([sys.executable,'-I','-B','-c','import time; time.sleep(60)'])
def stop(sig,frame):
 child.wait(timeout=0.2)
 sys.exit(0)
signal.signal(signal.SIGTERM,stop)
with open('pids.json','x') as target: json.dump([os.getpid(),child.pid],target)
while True: time.sleep(1)`);
    const started = performance.now();
    await refused(run(f, permit, undefined), 'runtime_stopped');
    expect(performance.now() - started).toBeLessThan(3000);
    const pids = JSON.parse(readFileSync(join(attemptRoot(f), 'native', 'pids.json'), 'utf8'));
    expect(pids.every((pid: number) => !alive(pid))).toBe(true); expect(posts(f)).toHaveLength(2); unlocked(f);
  }, 5000);

  test('actual Node CLI inspection is offline and rejects provider override options', () => {
    const f = fixture(), permit = permitFor(f), contractPath = join(f.root, 'contract.json'), permitPath = join(f.root, 'permit.json');
    writeFileSync(contractPath, JSON.stringify(f.contract), { mode: 0o600 });
    writeFileSync(permitPath, JSON.stringify(permit), { mode: 0o600 });
    const blocker = join(f.root, 'block-network.cjs');
    writeFileSync(blocker, "globalThis.fetch=()=>{throw new Error('network forbidden')};", { mode: 0o600 });
    const cli = new URL('../agenttool-mission.mjs', import.meta.url).pathname;
    const args = ['--require', blocker, cli, 'work', 'inspect-hermes', '--state', f.worker.state,
      '--contract-file', contractPath, '--permit-file', permitPath];
    const options = { encoding: 'utf8' as const, timeout: 5000, env: { PATH: process.env.PATH, HOME: f.root } };
    const result = spawnSync('node', args, options);
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout).attempt).toBeNull();
    expect(existsSync(attemptRoot(f))).toBe(false);
    const invalid = spawnSync('node', [...args, '--provider', 'peer-provider'], options);
    expect(invalid.status).not.toBe(0); expect(existsSync(attemptRoot(f))).toBe(false);
  });
});
