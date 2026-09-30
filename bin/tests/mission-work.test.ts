/** Offline work exchange: independent participant keys and API-canonical request proofs. */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalMissionRequestBytes } from "../../api/src/services/collaboration/proof";
import { correspondenceCanonicalJson } from "../../api/src/services/correspondence/canonical";
import * as client from "../agenttool-mission.mjs";
import * as work from "../mission-work.mjs";
import { encodeWorkRecord } from "../mission-work-contract.mjs";

const ORIGIN = "https://work-fixture.invalid";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
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
const posts = (f: Fixture) => f.controls.calls.filter(value => value.method === "POST");
function stateFiles(state: string) {
  return Object.fromEntries(readdirSync(state, { recursive: true }).map(String).sort().map(name => {
    const path = join(state, name);
    return [name, statSync(path).isFile() ? readFileSync(path).toString("base64") : "directory"];
  }));
}

async function refused(operation: Promise<unknown>, reason: string) {
  try { await operation; throw new Error("Expected work operation to refuse"); }
  catch (error: any) {
    expect(error.name).toBe("WorkError");
    expect(error.stop_reason).toBe(reason);
    return error;
  }
}
const advance = (f: Fixture, selected: Fixture["requester"], stage: string, payload?: unknown) =>
  work.advanceWork(selected.state, f.contract, stage, { fetchImpl: f.fetchImpl, sourceBytes: f.sourceBytes, payload });
const sync = (f: Fixture, selected: Fixture["requester"]) => work.syncWork(selected.state, f.contract, { fetchImpl: f.fetchImpl });

describe.skipIf(process.platform === "win32")("explicit signed mission work exchange", () => {
  test("offline inspection preserves both participant states and exposes no credential", () => {
    const f = fixture(), before = [stateFiles(f.requester.state), stateFiles(f.worker.state)];
    const requester = work.inspectWork(f.requester.state, f.contract), worker = work.inspectWork(f.worker.state, f.contract);
    expect(requester.role).toBe("requester"); expect(worker.role).toBe("worker");
    expect(requester.terms).toBe(worker.terms);
    expect(requester.visibility).toBe("all_mission_readers"); expect(requester.payment).toBe("NOT_REQUIRED");
    expect(f.requester.pin.public_key).not.toBe(f.worker.pin.public_key);
    expect(f.requester.pin.identity_id).not.toBe(f.worker.pin.identity_id);
    for (const result of [requester, worker]) {
      expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
      expect(JSON.stringify(result)).not.toContain(f.requester.profile.token);
      expect(JSON.stringify(result)).not.toContain(f.worker.profile.token);
    }
    expect(f.controls.calls).toEqual([]);
    expect([stateFiles(f.requester.state), stateFiles(f.worker.state)]).toEqual(before);
  });

  test("two independently rooted clients offer, accept, deliver and review, then reopen without replay", async () => {
    const f = fixture();
    expect((await sync(f, f.worker)).status).toBe("none");
    const offer = await advance(f, f.requester, "offer");
    expect(offer.status).toBe("stored"); expect(offer.projection.status).toBe("offered");
    expect((await sync(f, f.worker)).head.event_id).toBe(offer.event_id);
    const acceptance = await advance(f, f.worker, "accept");
    expect(acceptance.status).toBe("stored"); expect(acceptance.projection.status).toBe("work_accepted");
    const delivery = await advance(f, f.worker, "deliver", { observations: f.observations });
    expect(delivery.status).toBe("stored"); expect(delivery.projection.status).toBe("delivered");
    expect(delivery.projection.artifact).toEqual({ observations: f.observations });
    const review = await advance(f, f.requester, "review", { outcome: "accepted", reason: "Both selected lines support their observations." });
    expect(review.status).toBe("stored"); expect(review.projection.status).toBe("review_accepted");
    expect(review.projection.receipt).not.toBeNull();
    // Public functions reopen owner-only files, without an in-memory conversation object.
    expect(client.participant(f.worker.state).identity_id).toBe(f.worker.pin.identity_id);
    const reopened = await sync(f, f.worker);
    expect(reopened.status).toBe("review_accepted");
    expect(reopened.receipt).toEqual(review.projection.receipt);
    expect(reopened.pending_intents).toEqual([]);
    expect(reopened.records.map((record: any) => record.event_id)).toEqual([offer.event_id, acceptance.event_id, delivery.event_id, review.event_id]);
    const before = posts(f).length;
    await refused(advance(f, f.requester, "review", { outcome: "accepted", reason: "Already reviewed" }), "invalid_transition");
    await refused(advance(f, f.worker, "deliver", { observations: f.observations }), "invalid_transition");
    expect(posts(f)).toHaveLength(before); expect(before).toBe(4);
    expect(new Set(posts(f).map(call => call.grant_id))).toEqual(new Set([f.requester.pin.grant_id, f.worker.pin.grant_id]));
    for (const selected of [f.requester, f.worker]) {
      const serialized = JSON.stringify(work.inspectWork(selected.state, f.contract));
      expect(serialized).not.toContain(selected.profile.token);
      expect(serialized).not.toContain("PRIVATE KEY");
    }
  });

  test("wrong actors and changed source bytes cannot send an offered or accepted stage", async () => {
    const f = fixture();
    await refused(advance(f, f.worker, "offer"), "invalid_transition");
    const before = stateFiles(f.requester.state);
    await refused(work.advanceWork(f.requester.state, f.contract, "offer", {
      fetchImpl: f.fetchImpl, sourceBytes: Buffer.from(f.sourceBytes.toString().replace("lantern", "another")),
    }), "verification_failed");
    expect(stateFiles(f.requester.state)).toEqual(before); expect(posts(f)).toEqual([]);
    await advance(f, f.requester, "offer");
    await refused(advance(f, f.requester, "accept"), "invalid_transition");
    await refused(work.advanceWork(f.worker.state, f.contract, "accept", { fetchImpl: f.fetchImpl }), "verification_failed");
    await advance(f, f.worker, "accept");
    await refused(advance(f, f.requester, "deliver", { observations: f.observations }), "invalid_transition");
    const changed = structuredClone(f.observations); changed[1].quote = "A quote absent from the selected line.";
    await refused(advance(f, f.worker, "deliver", { observations: changed }), "verification_failed");
    expect(posts(f)).toHaveLength(2);
    expect((await sync(f, f.requester)).status).toBe("work_accepted");
  });

  test("mutated offered terms cannot be accepted by a fresh worker or overwrite saved terms", async () => {
    const f = fixture(); await advance(f, f.requester, "offer");
    const contract = structuredClone(f.contract); contract.instruction = "Replace the offered scope with different work.";
    await refused(work.advanceWork(f.worker.state, contract, "accept", { fetchImpl: f.fetchImpl, sourceBytes: f.sourceBytes }), "verification_failed");
    expect(posts(f)).toHaveLength(1);
    await refused(work.syncWork(f.requester.state, contract, { fetchImpl: f.fetchImpl }), "verification_failed");
    expect((await sync(f, f.requester)).status).toBe("offered");
  });

  test("decline, cancellation and explicit rejected review are terminal evidence", async () => {
    for (const terminal of ["decline", "cancel", "reject"]) {
      const f = fixture(); await advance(f, f.requester, "offer");
      let result;
      if (terminal === "reject") {
        await advance(f, f.worker, "accept");
        await advance(f, f.worker, "deliver", { observations: f.observations });
        result = await advance(f, f.requester, "review", { outcome: "rejected", reason: "The interpretation needs further work." });
      } else {
        const selected = terminal === "decline" ? f.worker : f.requester;
        result = await work.advanceWork(selected.state, f.contract, terminal, { fetchImpl: f.fetchImpl, payload: { reason: "No further work is requested." } });
      }
      expect(result.status).toBe("stored");
      expect(result.projection.status).toBe(terminal === "reject" ? "review_rejected" : terminal === "decline" ? "declined" : "cancelled");
      const count = posts(f).length;
      await refused(advance(f, f.worker, "accept"), "invalid_transition");
      expect(posts(f)).toHaveLength(count);
    }
  });

  test("revoked or narrowed live scope and pre-aborted calls cannot publish", async () => {
    for (const mutate of [
      (value: any) => { value.mission.revoked_at = new Date().toISOString(); return value; },
      (value: any) => { value.grant.actions = ["mission.read"]; return value; },
    ]) {
      const f = fixture(); f.controls.mutateMetadata = mutate;
      try { await advance(f, f.requester, "offer"); throw new Error("Expected current-scope refusal"); }
      catch (error: any) { expect(["verification_failed", "send_uncertain"]).toContain(error.stop_reason); }
      expect(posts(f)).toEqual([]);
    }
    const f = fixture(), before = stateFiles(f.requester.state), controller = new AbortController(); controller.abort();
    await refused(work.advanceWork(f.requester.state, f.contract, "offer", {
      fetchImpl: f.fetchImpl, sourceBytes: f.sourceBytes, signal: controller.signal,
    }), "cancelled");
    expect(f.controls.calls).toEqual([]); expect(stateFiles(f.requester.state)).toEqual(before);
  });

  test("lost POST response leaves a durable intent across restart; exact stored bytes reconcile it", async () => {
    const f = fixture(); f.controls.postMode = "store-then-throw"; f.controls.hidden = true;
    const problem = await refused(advance(f, f.requester, "offer"), "send_uncertain");
    expect(posts(f)).toHaveLength(1); expect(f.controls.events).toHaveLength(1);
    expect(problem.event_id).toBe(f.controls.events[0].event_id);
    const pending = await sync(f, f.requester);
    expect(pending.status).toBe("none"); expect(pending.pending_intents).toHaveLength(1);
    expect(readdirSync(join(f.requester.state, "outbox"))).toEqual([`${problem.event_id}.json`]);
    expect(JSON.parse(readFileSync(join(f.requester.state, "outbox", `${problem.event_id}.json`), "utf8"))).toEqual(f.controls.events[0].observation);
    f.controls.postMode = "normal";
    await refused(advance(f, f.requester, "offer"), "send_uncertain");
    expect(posts(f)).toHaveLength(1);
    f.controls.hidden = false;
    const reconciled = await sync(f, f.requester);
    expect(reconciled.status).toBe("offered"); expect(reconciled.head.event_id).toBe(problem.event_id);
    expect(reconciled.pending_intents).toEqual([]); expect(posts(f)).toHaveLength(1);
    await refused(advance(f, f.requester, "offer"), "invalid_transition");
    expect(posts(f)).toHaveLength(1);
  });

  test("an unobserved POST cannot be replaced after restart when the complete prefix is empty", async () => {
    const f = fixture(); f.controls.postMode = "throw-before-store";
    await refused(advance(f, f.requester, "offer"), "send_uncertain");
    expect(f.controls.events).toEqual([]); expect(posts(f)).toHaveLength(1);
    f.controls.postMode = "normal";
    expect((await sync(f, f.requester)).pending_intents).toHaveLength(1);
    await refused(advance(f, f.requester, "offer"), "send_uncertain");
    expect(posts(f)).toHaveLength(1);
  });

  test("a different signed event UUID with identical text cannot settle an ambiguous local outbox", async () => {
    const f = fixture(); f.controls.postMode = "throw-before-store";
    const problem = await refused(advance(f, f.requester, "offer"), "send_uncertain");
    const original = JSON.parse(readFileSync(join(f.requester.state, "outbox", `${problem.event_id}.json`), "utf8"));
    const substitute = f.appendSigned(f.requester, original.summary);
    expect(substitute.event_id).not.toBe(problem.event_id);
    const result = await sync(f, f.requester);
    expect(result.pending_intents).toHaveLength(1);
    await refused(advance(f, f.requester, "cancel", { reason: "Do not hide the original unresolved event." }), "send_uncertain");
    expect(posts(f)).toHaveLength(1);
  });

  test("overlapping commands from the same local state publish at most one offer", async () => {
    const f = fixture();
    const results = await Promise.allSettled([advance(f, f.requester, "offer"), advance(f, f.requester, "offer")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const blocked = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(blocked.reason).toMatchObject({ name: "WorkError", stop_reason: "work_in_flight" });
    expect(posts(f)).toHaveLength(1);
    expect((await sync(f, f.worker)).status).toBe("offered");
    expect(existsSync(join(f.requester.state, "work", f.contract.task_id, "operation.lock"))).toBe(false);
  });

  test("verified read acknowledgements, wrong actors and conflicting successors never become work acceptance", async () => {
    for (const variant of ["read_ack", "wrong_actor", "fork", "substituted_parent"]) {
      const f = fixture(), offer = await advance(f, f.requester, "offer");
      const original = f.controls.events[0], offerEnvelope = JSON.parse(original.observation.summary);
      const acceptance = { ...JSON.parse(offerEnvelope.text), stage: "accept",
        previous: { event_id: offer.event_id, body_sha256: variant === "substituted_parent" ? "0".repeat(64) : original.body_sha256 } };
      const actor = variant === "wrong_actor" ? f.requester : f.worker;
      const envelope = { ...offerEnvelope, to_identity: actor === f.worker ? f.requester.pin.identity_id : f.worker.pin.identity_id,
        text: correspondenceCanonicalJson(acceptance), kind: variant === "read_ack" ? "read_ack" : "message",
        ...(variant === "read_ack" ? { in_reply_to: offer.event_id } : {}) };
      f.appendSigned(actor, JSON.stringify(envelope));
      if (variant === "fork") f.appendSigned(actor, JSON.stringify(envelope));
      await refused(sync(f, f.requester), "verification_failed");
      expect(posts(f)).toHaveLength(1);
      // Invalid complete histories are not partially copied to the local journal.
      expect(readdirSync(join(f.requester.state, "work", f.contract.task_id, "events"))).toEqual([`${offer.event_id}.json`]);
    }
  });

  test("changed remote proof bytes and changed saved proofs are reverified instead of trusting a cache", async () => {
    for (const mutate of [
      (event: any) => { event.proof.signature = "A".repeat(86); },
      (event: any) => { event.raw_body += " "; },
      (event: any) => { event.observation.summary = "Unsigned replacement"; },
    ]) {
      const f = fixture(), offer = await advance(f, f.requester, "offer");
      await sync(f, f.worker);
      const before = stateFiles(f.worker.state), original = structuredClone(f.controls.events[0]);
      mutate(f.controls.events[0]);
      await expect(sync(f, f.worker)).rejects.toMatchObject({ stop_reason: "verification_failed" });
      expect(stateFiles(f.worker.state)).toEqual(before);
      expect(posts(f)).toHaveLength(1);
      f.controls.events[0] = original;
      const savedPath = join(f.worker.state, "work", f.contract.task_id, "events", `${offer.event_id}.json`);
      const saved = JSON.parse(readFileSync(savedPath, "utf8")); saved.proof.signature = "A".repeat(86);
      writeFileSync(savedPath, JSON.stringify(saved), { mode: 0o600 });
      await expect(sync(f, f.worker)).rejects.toMatchObject({ stop_reason: "verification_failed" });
      await expect(advance(f, f.worker, "accept")).rejects.toMatchObject({ stop_reason: "verification_failed" });
      expect(posts(f)).toHaveLength(1);
    }
  });

  test("an uncached local event with a corrupted proof key cannot disappear or permit a replacement offer", async () => {
    for (const corrupt of ["different_key", "missing_key"]) {
      const f = fixture();
      expect((await sync(f, f.requester)).status).toBe("none");
      const envelope = { format: "agenttool-mission-chat/v1", conversation: f.contract.task_id,
        to_identity: f.worker.pin.identity_id, kind: "message", text: encodeWorkRecord(f.contract, "offer", null) };
      // This valid admitted event has no local work intent or saved event yet,
      // as when selected observations were sent through the lower-layer client.
      const admitted = f.appendSigned(f.requester, JSON.stringify(envelope));
      if (corrupt === "different_key") admitted.proof.public_key = f.worker.pin.public_key;
      else delete admitted.proof.public_key;
      const before = stateFiles(f.requester.state), eventsBefore = structuredClone(f.controls.events);
      const taskRoot = join(f.requester.state, "work", f.contract.task_id);
      await expect(sync(f, f.requester)).rejects.toMatchObject({ name: "ChatError", stop_reason: "verification_failed" });
      await expect(advance(f, f.requester, "offer")).rejects.toMatchObject({ name: "ChatError", stop_reason: "verification_failed" });
      expect(posts(f)).toHaveLength(0);
      expect(f.controls.events).toEqual(eventsBefore);
      expect(readdirSync(join(taskRoot, "events"))).toEqual([]);
      expect(readdirSync(join(taskRoot, "intents"))).toEqual([]);
      expect(readdirSync(join(f.requester.state, "outbox"))).toEqual([]);
      expect(stateFiles(f.requester.state)).toEqual(before);
    }
  });

  test("an uncached local fork with a corrupted proof key cannot hide beside a saved offer", async () => {
    for (const corrupt of ["different_key", "missing_key"]) {
      const f = fixture(), offer = await advance(f, f.requester, "offer");
      const fork = f.appendSigned(f.requester, f.controls.events[0].observation.summary);
      if (corrupt === "different_key") fork.proof.public_key = f.worker.pin.public_key;
      else delete fork.proof.public_key;
      const before = stateFiles(f.requester.state), eventsBefore = structuredClone(f.controls.events);
      const taskRoot = join(f.requester.state, "work", f.contract.task_id), intentsBefore = readdirSync(join(taskRoot, "intents"));
      const postsBefore = posts(f).length;
      await expect(sync(f, f.requester)).rejects.toMatchObject({ name: "ChatError", stop_reason: "verification_failed" });
      await expect(advance(f, f.requester, "cancel", { reason: "Selected stop" })).rejects.toMatchObject({ name: "ChatError", stop_reason: "verification_failed" });
      expect(posts(f)).toHaveLength(postsBefore);
      expect(f.controls.events).toEqual(eventsBefore);
      expect(readdirSync(join(taskRoot, "events"))).toEqual([`${offer.event_id}.json`]);
      expect(readdirSync(join(taskRoot, "intents"))).toEqual(intentsBefore);
      expect(stateFiles(f.requester.state)).toEqual(before);
    }
  });

  test("a truncated complete prefix cannot hide a saved event or permit a fresh transition", async () => {
    const f = fixture(), offer = await advance(f, f.requester, "offer");
    await sync(f, f.worker);
    f.controls.hidden = true;
    await refused(sync(f, f.worker), "history_incomplete");
    await refused(advance(f, f.worker, "accept"), "history_incomplete");
    expect(posts(f)).toHaveLength(1);
    f.controls.hidden = false;
    const restored = await sync(f, f.worker);
    expect(restored.status).toBe("offered"); expect(restored.head.event_id).toBe(offer.event_id);
    expect(restored.pending_intents).toEqual([]);
  });

  test("a known stored send remains successful when its immediate readback becomes unavailable", async () => {
    const f = fixture();
    const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
      const response = await f.fetchImpl(input, init);
      if (init.method === "POST") f.controls.contextStatus = 503;
      return response;
    };
    const stored = await work.advanceWork(f.requester.state, f.contract, "offer", { fetchImpl, sourceBytes: f.sourceBytes });
    expect(stored.status).toBe("stored_sync_required"); expect(stored.event_id).toBe(f.controls.events[0].event_id);
    expect(posts(f)).toHaveLength(1);
    f.controls.contextStatus = 200;
    expect((await sync(f, f.requester)).pending_intents).toEqual([]);
    await refused(advance(f, f.requester, "offer"), "invalid_transition");
    expect(posts(f)).toHaveLength(1);
  });

  test("an endless well-formed mission prefix stops at 100 pages without persisting partial work", async () => {
    const f = fixture();
    for (let index = 0; index < 2000; index++) f.appendSigned(f.worker, "Unrelated signed mission observation");
    f.controls.mutatePage = value => { value.page.has_more = true; return value; };
    await refused(sync(f, f.requester), "scan_limit");
    expect(f.controls.calls.filter(call => call.target.includes("/events?"))).toHaveLength(100);
    expect(posts(f)).toEqual([]);
    expect(readdirSync(join(f.requester.state, "work", f.contract.task_id, "events"))).toEqual([]);
  });

  test("an empty page claiming more history or a repeated event cannot authorize a transition", async () => {
    for (const variant of ["empty_more", "duplicate"]) {
      const f = fixture();
      if (variant === "duplicate") {
        await advance(f, f.requester, "offer");
        f.controls.events.push({ ...f.controls.events[0], received_seq: "2" });
      } else f.controls.mutatePage = value => { value.page.has_more = true; return value; };
      await refused(sync(f, f.worker), "verification_failed");
      expect(posts(f)).toHaveLength(variant === "duplicate" ? 1 : 0);
    }
  });

  test("a signed but unsupported quotation can be rejected, while an accepting review refuses it", async () => {
    const f = fixture(); await advance(f, f.requester, "offer");
    const acceptance = await advance(f, f.worker, "accept"), acceptedEvent = f.controls.events.at(-1);
    const envelope = JSON.parse(acceptedEvent.observation.summary);
    const artifact = { observations: structuredClone(f.observations) }; artifact.observations[0].quote = "Unsupported quotation";
    const record = { ...JSON.parse(envelope.text), stage: "deliver",
      previous: { event_id: acceptance.event_id, body_sha256: acceptedEvent.body_sha256 }, artifact };
    f.appendSigned(f.worker, JSON.stringify({ ...envelope, text: correspondenceCanonicalJson(record) }));
    expect((await sync(f, f.requester)).status).toBe("delivered");
    await refused(advance(f, f.requester, "review", { outcome: "accepted", reason: "Accepting requires exact source validation." }), "verification_failed");
    expect(posts(f)).toHaveLength(2);
    const rejected = await advance(f, f.requester, "review", { outcome: "rejected", reason: "The quotation is absent from the selected source." });
    expect(rejected.status).toBe("stored"); expect(rejected.projection.status).toBe("review_rejected");
    expect(rejected.projection.receipt.outcome).toBe("rejected");
  });

  test("actual Node CLI routes offline inspect and refuses malformed files before any fetch", () => {
    const f = fixture(), contractPath = join(f.root, "contract.json"), marker = join(f.root, "network-attempt");
    const preload = join(f.root, "no-network.mjs");
    writeFileSync(contractPath, JSON.stringify(f.contract), { mode: 0o600 });
    writeFileSync(preload, `import { writeFileSync } from 'node:fs';\nglobalThis.fetch = () => { writeFileSync(${JSON.stringify(marker)}, 'blocked'); throw new Error('No network is allowed in this CLI fixture'); };\n`, { mode: 0o600 });
    const cli = (...args: string[]) => spawnSync("node", ["--import", pathToFileURL(preload).href,
      join(import.meta.dir, "..", "agenttool-mission.mjs"), "work", ...args], {
      encoding: "utf8", timeout: 5000, maxBuffer: 65536,
      env: { PATH: process.env.PATH!, LANG: "C", TZ: "UTC" },
    });
    const before = stateFiles(f.requester.state), common = ["--state", f.requester.state, "--contract-file", contractPath];
    const help = cli("--help"); expect(help.status).toBe(0); expect(help.stdout).toContain("work <command>");
    const inspected = cli("inspect", ...common);
    expect(inspected.status).toBe(0); expect(JSON.parse(inspected.stdout).role).toBe("requester");
    expect(inspected.stdout).not.toContain(f.requester.profile.token);
    expect(inspected.stdout).not.toContain("PRIVATE KEY");
    const sourcePath = join(f.root, "changed.txt"), linkPath = join(f.root, "source-link.txt");
    writeFileSync(sourcePath, "Different selected source", { mode: 0o600 }); symlinkSync(sourcePath, linkPath);
    for (const args of [
      ["inspect", ...common, "--execute", "yes"],
      ["inspect", ...common, "--state", f.requester.state],
      ["offer", ...common, "--source-file", sourcePath],
      ["offer", ...common, "--source-file", linkPath],
    ]) {
      const result = cli(...args); expect(result.status).not.toBe(0);
      expect(result.signal).toBeNull(); expect(result.stderr).not.toContain(f.requester.profile.token);
    }
    expect(existsSync(marker)).toBe(false); expect(stateFiles(f.requester.state)).toEqual(before);
  });
});
