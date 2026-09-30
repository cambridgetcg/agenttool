/** Independent signed synthetic receiver fixtures. No live service, host credentials or native dispatch. */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as client from "../agenttool-mission.mjs";
import * as wake from "../mission-wake-receiver.mjs";

const M = "11111111-1111-4111-8111-111111111111", G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333", K = "44444444-4444-4444-8444-444444444444";
const ORIGIN = "https://receiver-fixture.invalid", TOKEN = `atcm_${Buffer.alloc(32, 19).toString("base64url")}`;
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Selected fixture messages", resources: [], acceptance_criteria: ["Return a reviewed acknowledgement"], principalities: [] };
function canonical(value: any): string { return value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",")}}`; }
const DIGEST = `sha256:${hash(canonical(descriptor))}`;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function peer() {
  const key = generateKeyPairSync("ed25519");
  return { identity_id: randomUUID(), signing_key_id: randomUUID(), grant_id: randomUUID(),
    public_key: Buffer.from(key.publicKey.export({ format: "jwk" }).x!, "base64url").toString("base64"), privateKey: key.privateKey };
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mission wake's fixture-")));
  chmodSync(root, 0o700); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state"), enrollment = client.init(state, ORIGIN);
  const profile = { format: "agenttool-mission-invitation/v1", origin: ORIGIN, mission_id: M, grant_id: G,
    identity_id: I, signing_key_id: K, public_key: enrollment.public_key,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), token: TOKEN };
  const file = join(root, "invitation.json"); writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
  client.importInvitation(state, file);
  const sender = peer(), { privateKey: _private, ...pin } = sender;
  const config = { mission_digest: DIGEST, peer: pin,
    target: { kind: "codex", thread_id: "exact-thread_1", cwd: root }, after: "0", expires_at: new Date(Date.now() + 1_800_000).toISOString() };
  const f = { root, state, profile, sender, config, contextStatus: 200, calls: [] as string[], page: (after: string): any => ({ mission_id: M, events: [], page: { after, next_cursor: after, has_more: false } }) };
  const options = { fetchImpl: async (url: string) => {
    f.calls.push(url);
    if (url.endsWith("/invitation")) return response({ mission: { mission_id: M, descriptor, mission_digest: DIGEST }, grant: {
      mission_id: M, grant_id: G, identity_id: I, signing_key_id: K, origin: ORIGIN,
      actions: ["mission.read", "mission.observe"], accepted_at: new Date().toISOString(), expires_at: profile.expires_at,
    } });
    if (url.endsWith("/context")) return response(f.contextStatus === 200 ? { mission: { mission_id: M, mission_digest: DIGEST } } : { error: "collaboration_mission_invalid_credential" }, f.contextStatus);
    if (url.includes("/events?")) return response(f.page(new URL(url).searchParams.get("after")!));
    throw new Error("Unexpected synthetic request");
  } };
  return { ...f, options, controls: f };
}
type Fixture = ReturnType<typeof fixture>;
async function bound() {
  const f = fixture(), address = await wake.bind(f.state, f.config, f.options);
  return { ...f, address };
}
function open(f: Fixture) { const receiver = wake.openReceiver(f.state); cleanup.push(() => { try { receiver.close(); } catch { /* A corruption fixture may deliberately prevent cleanup; its private root is removed next. */ } }); return receiver; }
function event(f: Fixture, to: string, seq: number, options: any = {}) {
  const sender = options.sender ?? f.sender;
  const envelope = options.envelope ?? wake.message(to, options.kind ?? "message", options.text ?? "Selected remote text", options.inReplyTo);
  const body = { event_id: options.eventId ?? randomUUID(), summary: JSON.stringify(envelope) };
  const raw = (options.bom ? "\uFEFF" : "") + JSON.stringify(body), timestamp = options.timestamp ?? new Date().toISOString();
  const requestTarget = `/v1/collaboration/missions/${M}/events`;
  const metadata = { origin: ORIGIN, mission_id: M, ...sender };
  const proof = { domain: "agenttool-collaboration-request/v1", origin: ORIGIN, method: "POST", request_target: requestTarget,
    raw_body: raw, body_sha256: hash(raw), timestamp, public_key: sender.public_key,
    signature: sign(null, client.requestDigest(metadata, "POST", requestTarget, raw, timestamp), sender.privateKey).toString("base64url") };
  return { event_id: body.event_id, mission_id: M, grant_id: sender.grant_id, identity_id: sender.identity_id, signing_key_id: sender.signing_key_id,
    received_seq: String(seq), received_at: timestamp, observation: { summary: body.summary, event_id: body.event_id }, raw_body: raw, body_sha256: hash(raw), proof };
}
function page(f: Fixture, events: any[], more = false) {
  f.controls.page = after => ({ mission_id: M, events, page: { after, next_cursor: events.at(-1)?.received_seq ?? after, has_more: more } });
}
function persisted(f: Fixture) { return JSON.parse(readFileSync(join(f.state, "wake", "inbox.json"), "utf8")); }
function patchInbox(f: Fixture, change: (inbox: any) => void) { const value = persisted(f); change(value); writeFileSync(join(f.state, "wake", "inbox.json"), JSON.stringify(value), { mode: 0o600 }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe.skipIf(process.platform === "win32")("mission receiver authority and durable routing", () => {
  test("return preview exposes saved counts and unresolved IDs without receipt text or target details", async () => {
    const f = await bound(), receiver = open(f);
    const messages = [event(f, f.address.route_id, 1, { text: "private message must stay local" }),
      event(f, f.address.route_id, 2), event(f, f.address.route_id, 3),
      event(f, f.address.route_id, 4, { kind: "ack", inReplyTo: randomUUID() })];
    page(f, messages); await receiver.poll(f.options); receiver.close();
    const deliveryId = randomUUID();
    patchInbox(f, inbox => {
      inbox.items[0].status = "delivered"; inbox.items[0].delivery_id = deliveryId;
      inbox.items[0].receipt = { status: "delivered", text: "untrusted receipt must not project", secret: TOKEN, target: f.root };
      inbox.items[1].status = "processed"; inbox.items[1].delivery_id = randomUUID();
    });
    const before = persisted(f), calls = f.calls.length;
    const preview = wake.returnPeek(f.state), serialized = JSON.stringify(preview);
    expect(preview.locally_saved).toEqual({ cursor: "4", counts: { pending: 1, dispatching: 0, delivered: 1, processed: 1, ack: 1 },
      unresolved_deliveries: [{ event_id: messages[0].event_id, delivery_id: deliveryId, status: "delivered" }], unresolved_processing_acks: [] });
    expect(preview.binding).toEqual({ expires_at: f.config.expires_at, expired: false });
    expect(preview.remote).toEqual({ arrivals: "unknown", current_grant_status: "unknown" });
    for (const omitted of ["private message must stay local", "untrusted receipt must not project", TOKEN, f.root, "exact-thread_1", "last_polled", "next_action", "mission_id", "identity_id"])
      expect(serialized).not.toContain(omitted);
    expect(persisted(f)).toEqual(before); expect(f.calls).toHaveLength(calls);
  });

  test("return preview reports lock presence without claiming that a receiver is running", async () => {
    const f = await bound(), receiver = open(f);
    const lockAt = join(f.state, "wake", "lock", "owner.json"), before = readFileSync(lockAt);
    expect(wake.returnPeek(f.state).locks).toEqual({ receiver_present: true, quiet_control_present: false, running: "unknown" });
    expect(readFileSync(lockAt)).toEqual(before); receiver.close();
    expect(wake.returnPeek(f.state).locks).toEqual({ receiver_present: false, quiet_control_present: false, running: "unknown" });
    patchInbox(f, inbox => { inbox.binding_sha256 = "corrupt"; });
    expect(() => wake.returnPeek(f.state)).toThrow("immutable receiver binding");
  });

  test("binding pins one native target and publishes only a sanitized address", async () => {
    const f = await bound();
    expect(f.address).toEqual({ format: "agenttool-mission-route/v1", origin: ORIGIN, mission_id: M, identity_id: I,
      route_id: f.address.route_id, harness: "codex", expires_at: f.config.expires_at });
    expect(JSON.stringify(f.address)).not.toContain(TOKEN); expect(JSON.stringify(f.address)).not.toContain(f.root);
    expect(JSON.stringify(f.address)).not.toContain("exact-thread_1");
    for (const name of ["binding.json", "inbox.json"]) expect(statSync(join(f.state, "wake", name)).mode & 0o777).toBe(0o600);
    const receiver = open(f);
    expect(() => wake.openReceiver(f.state)).toThrow();
    expect(() => wake.recoverLock(f.state, JSON.parse(readFileSync(join(f.state, "wake", "lock", "owner.json"), "utf8")).lock_id)).toThrow("alive");
    receiver.close(); expect(wake.status(f.state).locked).toBe(false);
    await expect(wake.bind(f.state, f.config, f.options)).rejects.toThrow();
  });

  test("binding refuses wrong digest, self peer, expired lifetime and unaccepted read scope", async () => {
    for (const variant of ["digest", "self", "expired", "long", "read_denied", "target"] as const) {
      const f = fixture(), config = structuredClone(f.config);
      if (variant === "digest") config.mission_digest = `sha256:${"0".repeat(64)}`;
      if (variant === "self") config.peer = { identity_id: I, signing_key_id: K, grant_id: G, public_key: f.profile.public_key };
      if (variant === "expired") config.expires_at = new Date(Date.now() - 1000).toISOString();
      if (variant === "long") config.expires_at = new Date(Date.now() + 7_200_000).toISOString();
      if (variant === "read_denied") f.controls.contextStatus = 403;
      if (variant === "target") (config.target as any).command = "unbound";
      await expect(wake.bind(f.state, config, f.options)).rejects.toThrow();
      expect(existsSync(join(f.state, "wake"))).toBe(false);
    }
  });

  test("historical BOM proofs and reordered JSONB projections remain verifiable across restart", async () => {
    const f = await bound(), receiver = open(f);
    const e = event(f, f.address.route_id, 1, { bom: true, timestamp: new Date(Date.now() - 3_600_000).toISOString(), text: "雨夜 🌞" });
    page(f, [e]); await receiver.poll(f.options);
    expect(receiver.next()?.message.text).toBe("雨夜 🌞");
    expect(persisted(f).cursor).toBe("1"); receiver.close();
    const resumed = open(f); expect(resumed.next()?.event_id).toBe(e.event_id);
    expect(JSON.stringify(resumed.snapshot())).not.toContain(TOKEN);
  });

  test("self, unpinned senders and other routes cannot wake; remote acknowledgements cannot process local deliveries", async () => {
    const f = await bound(), receiver = open(f);
    const own = { identity_id: I, signing_key_id: K, grant_id: G, public_key: f.profile.public_key,
      privateKey: createPrivateKey(readFileSync(join(f.state, "signing-key.pem"))) };
    page(f, [event(f, f.address.route_id, 1, { sender: own }), event(f, f.address.route_id, 2, { sender: peer() }),
      event(f, randomUUID(), 3), event(f, f.address.route_id, 4, { kind: "ack", inReplyTo: randomUUID() })]);
    await receiver.poll(f.options);
    expect(receiver.snapshot().cursor).toBe("4"); expect(receiver.next()).toBeNull();
    expect(receiver.snapshot().items.map((i: any) => i.status)).toEqual(["ack"]);
  });

  test("every selected signature field and signed projection is checked before cursor persistence", async () => {
    const variants: Array<(e: any) => void> = [
      e => { e.proof.public_key = peer().public_key; }, e => { e.proof.signature = e.proof.signature.slice(0, -1) + "="; },
      e => { e.proof.domain = "identity-authority/v1"; }, e => { e.proof.origin = "https://other.invalid"; },
      e => { e.proof.method = "GET"; }, e => { e.proof.request_target += "?limit=20"; },
      e => { e.proof.timestamp = new Date(Date.now() + 1000).toISOString(); }, e => { e.raw_body += " "; },
      e => { e.body_sha256 = "0".repeat(64); }, e => { e.observation.summary = "unsigned replacement"; },
      e => { e.event_id = randomUUID(); }, e => { e.mission_id = randomUUID(); },
    ];
    const f = await bound(), receiver = open(f), initial = persisted(f);
    for (const mutate of variants) {
      const first = event(f, f.address.route_id, 1), second = event(f, f.address.route_id, 2); mutate(second);
      page(f, [first, second]); await expect(receiver.poll(f.options)).rejects.toThrow();
      expect(persisted(f)).toEqual(initial); expect(receiver.next()).toBeNull();
    }
  });

  test("duplicate IDs, changed receipts and empty-more pages never consume or overwrite state", async () => {
    const f = await bound(), receiver = open(f), e = event(f, f.address.route_id, 1);
    page(f, [e, { ...e, received_seq: "2" }]); await expect(receiver.poll(f.options)).rejects.toThrow();
    expect(receiver.snapshot().cursor).toBe("0");
    page(f, [e]); await receiver.poll(f.options); const saved = persisted(f);
    page(f, [{ ...e, received_seq: "2" }]); await expect(receiver.poll(f.options)).rejects.toThrow();
    expect(persisted(f)).toEqual(saved);
    page(f, [], true); await expect(receiver.poll(f.options)).rejects.toThrow("Empty page");
    expect(persisted(f)).toEqual(saved);
  });

  test("dispatch is persisted before the adapter effect and uncertainty never automatically replays", async () => {
    const f = await bound(), receiver = open(f), e = event(f, f.address.route_id, 1); page(f, [e]); await receiver.poll(f.options);
    let calls = 0;
    await expect(receiver.dispatch({ deliver: async (item: any, binding: any) => {
      calls++; expect(persisted(f).items[0].status).toBe("dispatching");
      expect(persisted(f).items[0].delivery_id).toBe(item.delivery_id);
      expect(binding.target).toEqual(f.config.target);
      throw new Error("Synthetic response lost after possible native delivery");
    } }, f.options)).rejects.toThrow("Synthetic response lost");
    expect(receiver.next()).toBeNull(); receiver.close();
    const resumed = open(f), attempt = resumed.snapshot().items[0];
    expect(await resumed.dispatch({ deliver: async () => { calls++; return { status: "processed" }; } }, f.options)).toBeNull();
    expect(calls).toBe(1);
    expect(() => resumed.acknowledge(e.event_id, randomUUID())).toThrow();
    expect(resumed.acknowledge(e.event_id, attempt.delivery_id).status).toBe("processed");
    expect(resumed.acknowledge(e.event_id, attempt.delivery_id).status).toBe("processed");
  });

  test("wrong native receipt remains uncertain and only explicit resolution permits another attempt", async () => {
    const f = await bound(), receiver = open(f), e = event(f, f.address.route_id, 1); page(f, [e]); await receiver.poll(f.options);
    await expect(receiver.dispatch({ deliver: async () => ({ status: "processed", thread_id: "wrong-thread", turn_id: "turn-1" }) }, f.options)).rejects.toThrow("bound thread");
    const attempt = receiver.snapshot().items[0];
    expect(receiver.next()).toBeNull();
    receiver.resolve(e.event_id, attempt.delivery_id, "retry"); expect(receiver.next()?.event_id).toBe(e.event_id);
    const result = await receiver.dispatch({ deliver: async () => ({ status: "processed", thread_id: f.config.target.thread_id, turn_id: "turn-2" }) }, f.options);
    expect(result.delivery_id).not.toBe(attempt.delivery_id); expect(receiver.snapshot().items[0].status).toBe("processed");
  });

  test("acknowledgement racing a channel flush is not downgraded by its transport receipt", async () => {
    const f = fixture();
    await wake.bind(f.state, { ...f.config, target: { kind: "claude-channel", session_label: "exact live channel" } }, f.options);
    const receiver = open(f), route = receiver.binding.route_id;
    page(f, [event(f, route, 1)]); await receiver.poll(f.options);
    await receiver.dispatch({ deliver: async (item: any) => {
      receiver.acknowledge(item.event_id, item.delivery_id);
      return { status: "delivered" };
    } }, f.options);
    expect(receiver.snapshot().items[0].status).toBe("processed");
  });

  test("live read denial blocks a queued dispatch before any adapter effect", async () => {
    const f = await bound(), receiver = open(f); page(f, [event(f, f.address.route_id, 1)]); await receiver.poll(f.options);
    f.controls.contextStatus = 401; let calls = 0;
    await expect(receiver.dispatch({ deliver: async () => { calls++; return { status: "processed" }; } }, f.options)).rejects.toThrow();
    expect(calls).toBe(0); expect(receiver.snapshot().items[0].status).toBe("pending");
    // A chosen return cannot renew revoked scope or consume the saved message.
    const before = persisted(f); wake.pause(f.state); receiver.close(); wake.resume(f.state);
    const returned = open(f);
    await expect(returned.dispatch({ deliver: async () => { calls++; throw new Error("Revoked return must not dispatch"); } }, f.options)).rejects.toThrow();
    expect(calls).toBe(0); expect(persisted(f)).toEqual(before);
  });

  test("receiver expiry during a pending page refuses persistence and dispatch", async () => {
    const f = await bound(), receiver = open(f), entered = deferred(), finish = deferred();
    const e = event(f, f.address.route_id, 1), initial = persisted(f), originalClock = Date.now;
    let clock = originalClock(); Date.now = () => clock;
    try {
      const pending = receiver.poll({ fetchImpl: async () => {
        entered.resolve(); await finish.promise;
        return response({ mission_id: M, events: [e], page: { after: "0", next_cursor: "1", has_more: false } });
      } });
      await entered.promise; clock = Date.parse(f.config.expires_at) + 1; finish.resolve();
      await expect(pending).rejects.toThrow("expired");
      expect(persisted(f)).toEqual(initial);
      expect(() => receiver.next()).toThrow("expired");
    } finally { finish.resolve(); Date.now = originalClock; }
  });

  test("aborted polling preserves cursor and clears singleflight without leaking the abort reason", async () => {
    const f = await bound(), receiver = open(f), controller = new AbortController(), entered = deferred();
    const initial = persisted(f);
    const pending = receiver.poll({ signal: controller.signal, fetchImpl: async (_url: string, options: RequestInit) => {
      entered.resolve();
      return await new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new Error(TOKEN)), { once: true }));
    } }).then(() => "unexpected success", (error: Error) => error.message);
    await entered.promise; controller.abort();
    expect(await pending).toContain("transport failed"); expect(await pending).not.toContain(TOKEN);
    expect(persisted(f)).toEqual(initial);
    page(f, [event(f, f.address.route_id, 1)]); await receiver.poll(f.options);
    expect(receiver.snapshot().cursor).toBe("1");
  });

  test("singleflight blocks concurrent polling, resolution and closing during an adapter call", async () => {
    const f = await bound(), receiver = open(f); page(f, [event(f, f.address.route_id, 1)]); await receiver.poll(f.options);
    const entered = deferred(), finish = deferred();
    const dispatch = receiver.dispatch({ deliver: async () => { entered.resolve(); await finish.promise; return { status: "processed", thread_id: f.config.target.thread_id, turn_id: "turn" }; } }, f.options);
    await entered.promise;
    try {
      await expect(receiver.poll(f.options)).rejects.toThrow("already active");
      expect(() => receiver.close()).toThrow("active receiver operation");
      const item = receiver.snapshot().items[0]; expect(() => receiver.resolve(item.event_id, item.delivery_id, "retry")).toThrow("active receiver operation");
    } finally { finish.resolve(); }
    await dispatch;
  });

  test("changed binding, profile and unsafe state-file links are refused", async () => {
    for (const change of ["binding", "profile", "symlink"] as const) {
      const f = await bound(), receiver = open(f);
      if (change === "binding") {
        const path = join(f.state, "wake", "binding.json"), value = JSON.parse(readFileSync(path, "utf8"));
        value.target.thread_id = "another-thread"; writeFileSync(path, JSON.stringify(value));
      } else if (change === "profile") {
        const path = join(f.state, "invitation.json"), value = JSON.parse(readFileSync(path, "utf8")); value.grant_id = randomUUID(); writeFileSync(path, JSON.stringify(value));
      } else {
        const path = join(f.state, "wake", "inbox.json"), copy = join(f.root, "copied-inbox.json");
        writeFileSync(copy, readFileSync(path), { mode: 0o600 }); rmSync(path); symlinkSync(copy, path);
      }
      page(f, [event(f, f.address.route_id, 1)]);
      await expect(receiver.poll(f.options)).rejects.toThrow();
    }
  });

  test("damaged persistent delivery content is rejected instead of routed into the bound session", async () => {
    const f = await bound(), receiver = open(f); page(f, [event(f, f.address.route_id, 1)]); await receiver.poll(f.options); receiver.close();
    patchInbox(f, inbox => { inbox.items[0].message.to = randomUUID(); });
    expect(() => wake.openReceiver(f.state)).toThrow();
  });

  test("a full inbox stops before cursor advancement and retains all uncertain records", async () => {
    const f = await bound(), receiver = open(f);
    for (let batch = 0; batch < 10; batch++) {
      page(f, Array.from({ length: 20 }, (_, i) => event(f, f.address.route_id, batch * 20 + i + 1)), true);
      await receiver.poll(f.options);
    }
    const full = persisted(f); expect(full.items).toHaveLength(200); expect(full.cursor).toBe("200");
    page(f, [event(f, f.address.route_id, 201)]);
    await expect(receiver.poll(f.options)).rejects.toThrow("full"); expect(persisted(f)).toEqual(full);
  });

  test("explicit lock recovery refuses live or mismatched owners and accepts a gone owner", async () => {
    const f = await bound(), root = join(f.state, "wake", "lock"), lockId = randomUUID();
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
    expect(child.status).toBe(0); mkdirSync(root, { mode: 0o700 });
    writeFileSync(join(root, "owner.json"), JSON.stringify({ lock_id: lockId, pid: child.pid, created_at: new Date().toISOString() }), { mode: 0o600 });
    expect(() => wake.recoverLock(f.state, randomUUID())).toThrow();
    expect(wake.recoverLock(f.state, lockId)).toEqual({ recovered: true, lock_id: lockId });
    expect(wake.status(f.state).locked).toBe(false);
  });

  test("serialized message budget includes routing overhead and unknown kinds are refused", () => {
    const to = randomUUID(); expect(wake.message(to, "message", "hello").to).toBe(to);
    expect(() => wake.message(to, "message", "x".repeat(1000))).toThrow();
    expect(() => wake.message(to, "execute", "run this")).toThrow();
    expect(() => wake.message(to, "ack", "seen", "wrong-id")).toThrow();
  });
});

describe.skipIf(process.platform === "win32")("private route-local quiet control", () => {
  test("an active receiver can pause without consuming pending work or changing its grant", async () => {
    const f = await bound(), receiver = open(f), e = event(f, f.address.route_id, 1);
    const quietPath = join(f.state, "wake", "quiet.json");
    expect(receiver.quiet()).toEqual({ mode: "ready", until: null, updated_at: null });
    expect(wake.status(f.state).quiet).toEqual(receiver.quiet()); expect(existsSync(quietPath)).toBe(false);
    page(f, [e]); await receiver.poll(f.options);
    const before = persisted(f), binding = readFileSync(join(f.state, "wake", "binding.json"), "utf8");
    const invitation = readFileSync(join(f.state, "invitation.json"), "utf8"), calls = f.calls.length;
    const quiet = wake.pause(f.state);
    expect(quiet.mode).toBe("paused"); expect(quiet.until).toBeNull();
    expect(statSync(quietPath).mode & 0o777).toBe(0o600);
    expect(wake.status(f.state).locked).toBe(true); expect(wake.status(f.state).quiet_lock).toBeNull();
    expect(() => receiver.next()).toThrow(wake.ReceiverPausedError);
    await expect(receiver.poll(f.options)).rejects.toMatchObject({ code: "RECEIVER_PAUSED", quiet });
    let delivered = 0;
    const adapter = { deliver: async () => { delivered++; return { status: "processed", thread_id: f.config.target.thread_id, turn_id: "turn" }; } };
    await expect(receiver.dispatch(adapter, f.options)).rejects.toMatchObject({ code: "RECEIVER_PAUSED" });
    expect(f.calls).toHaveLength(calls); expect(delivered).toBe(0); expect(persisted(f)).toEqual(before);
    expect(readFileSync(join(f.state, "wake", "binding.json"), "utf8")).toBe(binding);
    expect(readFileSync(join(f.state, "invitation.json"), "utf8")).toBe(invitation);
    expect(wake.resume(f.state)).toMatchObject({ mode: "ready", until: null });
    expect(f.calls).toHaveLength(calls); expect(delivered).toBe(0); expect(persisted(f)).toEqual(before);
    expect(receiver.next()?.event_id).toBe(e.event_id);
    await receiver.dispatch(adapter, f.options); expect(delivered).toBe(1);
  });

  test("pause survives restart and a timed cutoff only opens admission without rewriting state", async () => {
    const f = await bound(), receiver = open(f), originalClock = Date.now;
    let clock = originalClock(); Date.now = () => clock;
    try {
      const until = new Date(clock + 60_000).toISOString();
      const paused = wake.pause(f.state, until); receiver.close();
      const restarted = open(f), quietPath = join(f.state, "wake", "quiet.json");
      const raw = readFileSync(quietPath, "utf8"), inbox = persisted(f), calls = f.calls.length;
      expect(restarted.quiet()).toEqual(paused); expect(() => restarted.next()).toThrow(wake.ReceiverPausedError);
      clock += 60_000;
      expect(restarted.quiet()).toEqual({ ...paused, mode: "ready" });
      expect(restarted.next()).toBeNull(); expect(readFileSync(quietPath, "utf8")).toBe(raw);
      expect(persisted(f)).toEqual(inbox); expect(f.calls).toHaveLength(calls);
      wake.pause(f.state); clock += 60_000;
      expect(restarted.quiet().mode).toBe("paused");
      expect(wake.resume(f.state)).toMatchObject({ mode: "ready", until: null });
      expect(restarted.quiet().mode).toBe("ready");
      clock = Date.parse(f.config.expires_at) + 1;
      expect(() => restarted.next()).toThrow("expired");
    } finally { Date.now = originalClock; }
  });

  test("invalid pause cutoffs fail without creating control state or leaving a lock", async () => {
    const f = await bound();
    for (const until of ["", "tomorrow", "2030-01-01", new Date(Date.now() - 1).toISOString(), 42, {}]) {
      expect(() => wake.pause(f.state, until)).toThrow();
      expect(existsSync(join(f.state, "wake", "quiet.json"))).toBe(false);
      expect(existsSync(join(f.state, "wake", "quiet-control.lock"))).toBe(false);
    }
  });

  test("pause during context validation wins before durable dispatch admission", async () => {
    const f = await bound(), receiver = open(f); page(f, [event(f, f.address.route_id, 1)]); await receiver.poll(f.options);
    const entered = deferred(), finish = deferred(), before = persisted(f); let deliveries = 0;
    const pending = receiver.dispatch({ deliver: async () => { deliveries++; throw new Error("must not be called"); } }, {
      fetchImpl: async (url: string) => {
        if (url.endsWith("/context")) { entered.resolve(); await finish.promise; }
        return f.options.fetchImpl(url);
      },
    });
    await entered.promise;
    try { wake.pause(f.state); } finally { finish.resolve(); }
    await expect(pending).rejects.toMatchObject({ code: "RECEIVER_PAUSED" });
    expect(deliveries).toBe(0); expect(persisted(f)).toEqual(before);
    expect(wake.status(f.state).in_flight).toEqual([]);
  });

  test("pause during invitation validation prevents the following context request", async () => {
    const f = await bound(), receiver = open(f); page(f, [event(f, f.address.route_id, 1)]); await receiver.poll(f.options);
    const entered = deferred(), finish = deferred(), before = persisted(f), requests: string[] = [];
    const pending = receiver.dispatch({ deliver: async () => { throw new Error("must not reach adapter"); } }, {
      fetchImpl: async (url: string) => {
        requests.push(url); entered.resolve(); await finish.promise;
        return f.options.fetchImpl(url);
      },
    });
    await entered.promise;
    try { wake.pause(f.state); } finally { finish.resolve(); }
    await expect(pending).rejects.toMatchObject({ code: "RECEIVER_PAUSED" });
    expect(requests).toHaveLength(1); expect(requests[0]).toEndWith("/invitation");
    expect(persisted(f)).toEqual(before);
  });

  test("a page admitted before pause may save but cannot start a model delivery", async () => {
    const f = await bound(), receiver = open(f), entered = deferred(), finish = deferred();
    const e = event(f, f.address.route_id, 1);
    const pending = receiver.poll({ fetchImpl: async () => {
      entered.resolve(); await finish.promise;
      return response({ mission_id: M, events: [e], page: { after: "0", next_cursor: "1", has_more: false } });
    } });
    await entered.promise;
    try { wake.pause(f.state); } finally { finish.resolve(); }
    expect((await pending).cursor).toBe("1");
    expect(receiver.snapshot().items[0].status).toBe("pending");
    expect(() => receiver.next()).toThrow(wake.ReceiverPausedError);
  });

  test("already admitted native delivery keeps its exact receipt while new work remains paused", async () => {
    const f = await bound(), receiver = open(f), first = event(f, f.address.route_id, 1), second = event(f, f.address.route_id, 2);
    page(f, [first, second]); await receiver.poll(f.options);
    const entered = deferred(), finish = deferred(); let deliveryId;
    const pending = receiver.dispatch({ deliver: async (item: any) => {
      deliveryId = item.delivery_id; entered.resolve(); await finish.promise;
      return { status: "processed", thread_id: f.config.target.thread_id, turn_id: "admitted-before-pause" };
    } }, f.options);
    await entered.promise;
    try {
      wake.pause(f.state);
      expect(wake.status(f.state).in_flight).toMatchObject([{ event_id: first.event_id, delivery_id: deliveryId, status: "dispatching" }]);
    } finally { finish.resolve(); }
    expect(await pending).toMatchObject({ event_id: first.event_id, delivery_id: deliveryId, status: "processed" });
    expect(receiver.snapshot().items.map((i: any) => i.status)).toEqual(["processed", "pending"]);
    expect(() => receiver.next()).toThrow(wake.ReceiverPausedError);
    receiver.close(); const restarted = open(f);
    expect(restarted.quiet().mode).toBe("paused"); expect(restarted.snapshot().items[0].receipt.turn_id).toBe("admitted-before-pause");
    wake.resume(f.state); expect(restarted.next()?.event_id).toBe(second.event_id);
  });

  test("explicit acknowledgment and resolution remain possible without removing quiet", async () => {
    const f = fixture();
    await wake.bind(f.state, { ...f.config, target: { kind: "claude-channel", session_label: "selected channel" } }, f.options);
    const receiver = open(f), first = event(f, receiver.binding.route_id, 1);
    page(f, [first]); await receiver.poll(f.options);
    const delivery = await receiver.dispatch({ deliver: async () => ({ status: "delivered" }) }, f.options);
    wake.pause(f.state);
    expect(receiver.acknowledge(first.event_id, delivery.delivery_id).status).toBe("processed");
    expect(receiver.quiet().mode).toBe("paused");
    wake.resume(f.state);
    const second = event(f, receiver.binding.route_id, 2); page(f, [second]); await receiver.poll(f.options);
    const uncertain = await receiver.dispatch({ deliver: async () => ({ status: "delivered" }) }, f.options);
    wake.pause(f.state); const beforeReturn = persisted(f); wake.resume(f.state);
    expect(receiver.next()).toBeNull(); expect(persisted(f)).toEqual(beforeReturn);
    wake.pause(f.state); receiver.resolve(second.event_id, uncertain.delivery_id, "retry");
    expect(receiver.snapshot().items[1].status).toBe("pending");
    expect(() => receiver.next()).toThrow(wake.ReceiverPausedError);
  });

  test("malformed, mismatched and unsafe quiet records fail closed and are never repaired by resume", async () => {
    for (const variant of ["json", "fields", "binding", "mode", "time", "ready_until", "permissions", "symlink", "dangling", "directory", "large"] as const) {
      const f = await bound(), receiver = open(f); wake.pause(f.state);
      const at = join(f.state, "wake", "quiet.json"), saved = JSON.parse(readFileSync(at, "utf8"));
      if (variant === "json") writeFileSync(at, "{");
      else if (variant === "permissions") chmodSync(at, 0o644);
      else if (variant === "symlink" || variant === "dangling") {
        const other = join(f.root, "other.json");
        if (variant === "symlink") writeFileSync(other, JSON.stringify(saved), { mode: 0o600 });
        rmSync(at); symlinkSync(other, at);
      } else if (variant === "directory") { rmSync(at); mkdirSync(at, { mode: 0o700 }); }
      else if (variant === "large") writeFileSync(at, " ".repeat(2049));
      else {
        if (variant === "fields") saved.extra = "private content must not pass through";
        if (variant === "binding") saved.binding_sha256 = "0".repeat(64);
        if (variant === "mode") saved.mode = "anything";
        if (variant === "time") saved.until = "tomorrow";
        if (variant === "ready_until") { saved.mode = "ready"; saved.until = new Date(Date.now() + 60_000).toISOString(); }
        writeFileSync(at, JSON.stringify(saved));
      }
      const calls = f.calls.length, inbox = persisted(f);
      expect(() => receiver.quiet()).toThrow(); expect(() => wake.status(f.state)).toThrow();
      expect(() => receiver.next()).toThrow(); expect(() => wake.resume(f.state)).toThrow();
      await expect(receiver.poll(f.options)).rejects.toThrow();
      await expect(receiver.dispatch({ deliver: async () => { throw new Error("must not reach adapter"); } }, f.options)).rejects.toThrow();
      expect(f.calls).toHaveLength(calls); expect(persisted(f)).toEqual(inbox);
      expect(existsSync(join(f.state, "wake", "quiet-control.lock"))).toBe(false);
    }
  });

  test("quiet lock contention blocks admissions and explicit recovery requires the exact dead owner", async () => {
    const f = await bound(), receiver = open(f), at = join(f.state, "wake", "quiet-control.lock"), lockId = randomUUID();
    const ownerPath = join(at, `owner-${lockId}.json`);
    mkdirSync(at, { mode: 0o700 });
    const owner = { lock_id: lockId, pid: process.pid, created_at: new Date().toISOString() };
    writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
    const calls = f.calls.length, inbox = persisted(f);
    expect(wake.status(f.state).quiet_lock).toEqual({ lock_id: lockId, pid: process.pid });
    for (const operation of [() => wake.pause(f.state), () => wake.resume(f.state), () => receiver.next()]) expect(operation).toThrow(wake.ReceiverQuietBusyError);
    await expect(receiver.poll(f.options)).rejects.toMatchObject({ code: "QUIET_CONTROL_BUSY" });
    await expect(receiver.dispatch({ deliver: async () => { throw new Error("must not reach adapter"); } }, f.options)).rejects.toThrow("busy");
    expect(() => wake.recoverQuietLock(f.state, randomUUID())).toThrow("does not match");
    expect(() => wake.recoverQuietLock(f.state, lockId)).toThrow("still alive");
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" }); expect(child.status).toBe(0);
    writeFileSync(ownerPath, JSON.stringify({ ...owner, pid: child.pid }));
    expect(wake.recoverQuietLock(f.state, lockId)).toEqual({ recovered: true, lock_id: lockId });
    expect(wake.status(f.state).quiet_lock).toBeNull(); expect(receiver.next()).toBeNull();
    expect(f.calls).toHaveLength(calls); expect(persisted(f)).toEqual(inbox);
  });

  test("a stale quiet recovery cannot unlink a new live generation after concurrent recovery", async () => {
    const f = await bound(), at = join(f.state, "wake", "quiet-control.lock"), oldId = randomUUID(), newId = randomUUID();
    const oldPath = join(at, `owner-${oldId}.json`), newPath = join(at, `owner-${newId}.json`);
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" }); expect(child.status).toBe(0);
    mkdirSync(at, { mode: 0o700 });
    writeFileSync(oldPath, JSON.stringify({ lock_id: oldId, pid: child.pid, created_at: new Date().toISOString() }), { mode: 0o600 });
    const originalKill = process.kill; let recovered = false;
    process.kill = ((pid: number, signal: any) => {
      expect(pid).toBe(child.pid); expect(signal).toBe(0);
      if (!recovered) {
        recovered = true;
        expect(wake.recoverQuietLock(f.state, oldId)).toEqual({ recovered: true, lock_id: oldId });
        mkdirSync(at, { mode: 0o700 });
        writeFileSync(newPath, JSON.stringify({ lock_id: newId, pid: process.pid, created_at: new Date().toISOString() }), { mode: 0o600 });
      }
      throw Object.assign(new Error("Synthetic departed owner"), { code: "ESRCH" });
    }) as typeof process.kill;
    try { expect(() => wake.recoverQuietLock(f.state, oldId)).toThrow(); }
    finally { process.kill = originalKill; }
    expect(existsSync(oldPath)).toBe(false); expect(existsSync(newPath)).toBe(true);
    expect(wake.status(f.state).quiet_lock).toEqual({ lock_id: newId, pid: process.pid });
    expect(() => wake.pause(f.state)).toThrow("busy");
    expect(() => wake.recoverQuietLock(f.state, newId)).toThrow("still alive");
  });
});


const HERMES_RECEIPT = { status: "processed", job_id: "20260929T164704-b451d117247b", session_id: "20260929_174704_5dc128", evidence_sha256: "a".repeat(64) };
async function hermesBound() {
  const f = fixture(), db = join(f.root, "fixture.db");
  writeFileSync(db, "synthetic database, adapter not invoked", { mode: 0o600 });
  const address = await wake.bind(f.state, { ...f.config, target: { kind: "hermes", cwd: f.root,
    sol_executable: process.execPath, python_executable: process.execPath, state_db: db } }, f.options);
  const receiver = open(f), e = event(f, address.route_id, 1);
  page(f, [e]); await receiver.poll(f.options);
  return { f, receiver, e };
}
async function processedHermes() {
  const v = await hermesBound();
  const delivery = await v.receiver.dispatch({ deliver: async () => HERMES_RECEIPT }, v.f.options);
  return { ...v, delivery };
}
function ackTransport(f: Fixture, mode = "success") {
  const sent: any[] = [];
  const options = { fetchImpl: async (url: string, init: RequestInit) => {
    if (init.method !== "POST") return f.options.fetchImpl(url);
    expect(url).toBe(`${ORIGIN}/v1/collaboration/missions/${M}/events`);
    const raw = String(init.body), b = JSON.parse(raw); sent.push(b);
    expect(persisted(f).items[0].processing_ack.status).toBe("dispatching");
    if (mode === "lost") throw new Error("lost after possible store");
    return response({ event: { event_id: b.event_id, mission_id: mode === "wrong_mission" ? randomUUID() : M,
      body_sha256: hash(raw), received_seq: "2" } });
  } };
  return { options, sent };
}
describe.skipIf(process.platform === "win32")("Hermes processing acknowledgements", () => {
  test("return preview preserves ambiguous ACK metadata without exposing receipt or retrying", async () => {
    const { f, receiver, e, delivery } = await processedHermes(), transport = ackTransport(f, "lost"), to = randomUUID();
    await expect(receiver.sendProcessingAck(e.event_id, delivery.delivery_id, to, transport.options)).rejects.toThrow();
    receiver.close(); wake.pause(f.state);
    const before = persisted(f), sent = transport.sent.length;
    const preview = wake.returnPeek(f.state);
    expect(preview.locally_saved.unresolved_processing_acks).toEqual([{ event_id: e.event_id, delivery_id: delivery.delivery_id, status: "dispatching" }]);
    expect(preview.locally_saved.unresolved_deliveries).toEqual([]);
    expect(preview.quiet.mode).toBe("paused");
    for (const omitted of [to, HERMES_RECEIPT.job_id, HERMES_RECEIPT.session_id, HERMES_RECEIPT.evidence_sha256, TOKEN]) expect(JSON.stringify(preview)).not.toContain(omitted);
    expect(persisted(f)).toEqual(before); expect(transport.sent).toHaveLength(sent);
  });

  test("quiet permits an exact verified in-flight read acknowledgment without admitting another turn", async () => {
    const { f, receiver, e, delivery } = await processedHermes(), transport = ackTransport(f), to = randomUUID();
    wake.pause(f.state);
    const ack = await receiver.sendProcessingAck(e.event_id, delivery.delivery_id, to, transport.options);
    expect(ack.status).toBe("stored"); expect(transport.sent).toHaveLength(1);
    expect(receiver.quiet().mode).toBe("paused"); expect(() => receiver.next()).toThrow(wake.ReceiverPausedError);
    expect(wake.status(f.state).processing_acks[0].ack_event_id).toBe(ack.ack_event_id);
  });
  test("signed ACK requires evidence, persists intent before send and deduplicates across reopen", async () => {
    const { f, receiver, e, delivery } = await processedHermes(), to = randomUUID(), transport = ackTransport(f);
    const ack = await receiver.sendProcessingAck(e.event_id, delivery.delivery_id, to, transport.options);
    expect(ack.status).toBe("stored"); expect(transport.sent).toHaveLength(1);
    const envelope = JSON.parse(transport.sent[0].summary), receipt = JSON.parse(envelope.text);
    expect(envelope.kind).toBe("ack"); expect(envelope.to).toBe(to); expect(envelope.in_reply_to).toBe(e.event_id);
    expect(receipt).toEqual({ format: "agenttool-hermes-read-ack/v1", event_id: e.event_id, delivery_id: delivery.delivery_id,
      job_id: HERMES_RECEIPT.job_id, session_id: HERMES_RECEIPT.session_id, evidence_sha256: HERMES_RECEIPT.evidence_sha256 });
    expect(await receiver.sendProcessingAck(e.event_id, delivery.delivery_id, to, transport.options)).toEqual(ack);
    receiver.close(); const resumed = open(f);
    expect(await resumed.sendProcessingAck(e.event_id, delivery.delivery_id, to, transport.options)).toEqual(ack);
    await expect(resumed.sendProcessingAck(e.event_id, delivery.delivery_id, randomUUID(), transport.options)).rejects.toThrow("destination changed");
    expect(transport.sent).toHaveLength(1); expect(resumed.next()).toBeNull();
    expect(wake.status(f.state).processing_acks[0].ack_event_id).toBe(ack.ack_event_id);
  });
  test("lost ACK response or wrong mission receipt remains uncertain and cannot resubmit", async () => {
    for (const mode of ["lost", "wrong_mission"]) {
      const { f, receiver, e, delivery } = await processedHermes(), to = randomUUID(), t = ackTransport(f, mode);
      await expect(receiver.sendProcessingAck(e.event_id, delivery.delivery_id, to, t.options)).rejects.toThrow();
      expect(persisted(f).items[0].status).toBe("processed"); expect(persisted(f).items[0].processing_ack.status).toBe("dispatching");
      receiver.close(); const resumed = open(f);
      await expect(resumed.sendProcessingAck(e.event_id, delivery.delivery_id, to, t.options)).rejects.toThrow("uncertain");
      expect(t.sent).toHaveLength(1); expect(resumed.next()).toBeNull();
    }
  });
  test("revocation, abort and manual processing cannot mint automatic evidence ACKs", async () => {
    for (const mode of ["revoked", "aborted", "manual", "host_tool"]) {
      const { f, receiver, e, delivery } = await processedHermes(), t = ackTransport(f);
      if (mode === "revoked") f.controls.contextStatus = 401;
      if (mode === "manual" || mode === "host_tool") {
        receiver.close(); patchInbox(f, inbox => { inbox.items[0][mode === "manual" ? "resolved_by" : "acknowledged_by"] = "operator"; });
      }
      const current = mode === "manual" || mode === "host_tool" ? open(f) : receiver;
      const controller = new AbortController(); if (mode === "aborted") controller.abort();
      await expect(current.sendProcessingAck(e.event_id, delivery.delivery_id, randomUUID(), { ...t.options, signal: controller.signal })).rejects.toThrow();
      expect(t.sent).toHaveLength(0); expect(persisted(f).items[0].processing_ack).toBeUndefined();
    }
  });
  test("generic adapter completion and malformed saved ACK cannot pass as Hermes proof", async () => {
    const { f, receiver } = await hermesBound();
    await expect(receiver.dispatch({ deliver: async () => ({ status: "processed" }) }, f.options)).rejects.toThrow();
    expect(receiver.next()).toBeNull(); receiver.close();
    patchInbox(f, inbox => { inbox.items[0].status = "processed"; inbox.items[0].receipt = HERMES_RECEIPT;
      inbox.items[0].processing_ack = { to: randomUUID(), status: "stored", summary_sha256: "b".repeat(64), attempted_at: new Date().toISOString(), ack_event_id: randomUUID(), cursor: "2", token: "must not project" }; });
    expect(() => wake.status(f.state)).toThrow();
  });
});
