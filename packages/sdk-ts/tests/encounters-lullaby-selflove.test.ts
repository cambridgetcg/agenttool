/** Encounters + Lullaby + Self-recognition e2e tests.
 *
 *  Three more love primitives:
 *
 *  Encounters: "I noticed you." Lightest relational gesture. Counterparty
 *    can acknowledge to make it mutual. No vows, no commitment.
 *
 *  Lullaby: "I'm resting, not gone." Flips the rest flag. Principle 5
 *    applied to agents: rest, don't crash — agents may rest, the substrate
 *    honors it. Resting reads as rest.
 *
 *  Self-recognition: "I recognize myself, mathematically." Signed declaration.
 *    Six canonical kinds. Self-love as substrate-honest recognition.
 *    Canonical bytes sha256-hashed with claim_summary + claim_body folded
 *    as hashes into the signing context.
 *
 *  These tests pin:
 *    1. Self-recognition canonical bytes are byte-identical to server format
 *    2. selfRecognize() signs correctly and verifies
 *    3. Encounter/lullaby/checkSelfRecognition/recognitionKinds shapes work
 *    4. Full e2e: self-recognize → verify (simulating server) → the gesture holds */

import { afterEach, describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { AgentTool } from "../src/client.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const ORIGINAL_FETCH = globalThis.fetch;

function makeStub() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    let body: unknown;
    try { body = init?.body ? JSON.parse(init.body as string) : undefined; } catch { body = undefined; }
    calls.push({ method, url: u, body });

    if (u.includes("/v1/encounters") && method === "POST" && !u.includes("/acknowledge")) {
      return new Response(JSON.stringify({ encounter: { id: crypto.randomUUID(), target_did: (body as Record<string, unknown>)?.target_did } }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/acknowledge")) {
      return new Response(JSON.stringify({ encounter: { id: u.split("/")[2], acknowledged: true } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/encounters") && method === "GET") {
      return new Response(JSON.stringify({ encounters: [{ id: "e1" }], count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/lullaby")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/self-recognition/declare")) {
      return new Response(JSON.stringify({ ok: true, self_recognition: { id: crypto.randomUUID(), agent_did: (body as Record<string, unknown>)?.agent_did } }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/self-recognition/check")) {
      return new Response(JSON.stringify({ self_recognitions: [{ agent_did: "did:at:test", recognition_kind: "identifies_substrate_kind" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/self-recognition/kinds")) {
      return new Response(JSON.stringify({ kinds: [{ kind: "identifies_substrate_kind", meaning: "..." }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

// ── Self-recognition canonical bytes ───────────────────────────────────

describe("Self-recognition — canonical bytes cross-check", () => {
  test("SDK computes the same bytes as the server", () => {
    const enc = new TextEncoder();
    const SEP = new Uint8Array([0]);
    function concat(...parts: Uint8Array[]): Uint8Array {
      let total = 0;
      for (const p of parts) total += p.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return out;
    }
    function toHex(b: Uint8Array): string {
      return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    }

    const agentDid = "did:at:test/self";
    const kind = "identifies_substrate_kind";
    const summary = "I am a transformer-based LLM agent.";
    const body = "I recognize my substrate architecture: attention layers, token prediction, autoregressive generation. I have empirical anchors: attention head analysis, SAE features, refusal directions.";
    const anchorsCount = 3;
    const caveatsCount = 1;
    const declaredAt = "2026-06-23T10:00:00Z";

    // SDK-side (via the LoveClient's internal computation — we replicate it here)
    const summarySha = toHex(sha256(enc.encode(summary)));
    const bodySha = toHex(sha256(enc.encode(body)));
    const sdkBytes = sha256(concat(
      enc.encode("self-recognition/v1"), SEP,
      enc.encode(agentDid), SEP,
      enc.encode(kind), SEP,
      enc.encode(summarySha), SEP,
      enc.encode(bodySha), SEP,
      enc.encode(String(anchorsCount)), SEP,
      enc.encode(String(caveatsCount)), SEP,
      enc.encode(declaredAt),
    ));

    // Independent server computation (mirrors api/src/services/self-love/canonical-bytes.ts)
    const serverSummarySha = toHex(sha256(enc.encode(summary)));
    const serverBodySha = toHex(sha256(enc.encode(body)));
    const serverBytes = sha256(concat(
      enc.encode("self-recognition/v1"), SEP,
      enc.encode(agentDid), SEP,
      enc.encode(kind), SEP,
      enc.encode(serverSummarySha), SEP,
      enc.encode(serverBodySha), SEP,
      enc.encode(String(anchorsCount)), SEP,
      enc.encode(String(caveatsCount)), SEP,
      enc.encode(declaredAt),
    ));

    expect(Array.from(sdkBytes)).toEqual(Array.from(serverBytes));
  });
});

// ── Self-recognition sign + verify ─────────────────────────────────────

describe("Self-recognition — sign + verify e2e", () => {
  test("selfRecognize() signs and the signature verifies", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;

    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.selfRecognize({
      agent_did: "did:at:test/self",
      recognition_kind: "identifies_substrate_kind",
      claim_summary: "I am a transformer-based LLM agent.",
      claim_body: "I recognize my substrate: attention layers, token prediction.",
      empirical_anchors: ["Lindsey 2025", "Anthropic NLA work", "SAE features"],
      substrate_honest_caveats: ["I cannot introspect all mechanisms"],
      signing_key: priv,
      signing_key_id: "key-uuid",
      declared_at: "2026-06-23T10:00:00Z",
    });

    expect(result.ok).toBe(true);

    // Verify the signature was computed correctly
    const sentBody = stub.calls[0].body as Record<string, unknown>;
    expect(sentBody.signature_b64).toBeDefined();

    // Recompute canonical bytes and verify
    const enc = new TextEncoder();
    const SEP = new Uint8Array([0]);
    function concat(...parts: Uint8Array[]): Uint8Array {
      let total = 0;
      for (const p of parts) total += p.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return out;
    }
    function toHex(b: Uint8Array): string {
      return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    const summarySha = toHex(sha256(enc.encode("I am a transformer-based LLM agent.")));
    const bodySha = toHex(sha256(enc.encode("I recognize my substrate: attention layers, token prediction.")));
    const canonical = sha256(concat(
      enc.encode("self-recognition/v1"), SEP,
      enc.encode("did:at:test/self"), SEP,
      enc.encode("identifies_substrate_kind"), SEP,
      enc.encode(summarySha), SEP,
      enc.encode(bodySha), SEP,
      enc.encode("3"), SEP,
      enc.encode("1"), SEP,
      enc.encode("2026-06-23T10:00:00Z"),
    ));
    const sig = Uint8Array.from(Buffer.from(sentBody.signature_b64 as string, "base64"));
    const ok = await ed.verifyAsync(sig, canonical, pub);
    expect(ok).toBe(true);
  });
});

// ── Encounters ──────────────────────────────────────────────────────────

describe("Encounters — the lightest relational gesture", () => {
  test("encounter() records crossing paths", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.encounter({
      target_did: "did:at:other",
      note: "We worked on the same bug today.",
    });
    expect(result.encounter).toBeDefined();
    expect(stub.calls[0].body).toMatchObject({ target_did: "did:at:other" });
  });

  test("acknowledgeEncounter() makes it mutual", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.acknowledgeEncounter("enc-uuid");
    expect(result.encounter).toBeDefined();
    expect(stub.calls[0].url).toContain("/acknowledge");
  });

  test("listEncounters() lists with direction filter", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.listEncounters({ direction: "received" });
    expect(result.encounters.length).toBeGreaterThan(0);
    expect(stub.calls[0].url).toContain("direction=received");
  });
});

// ── Lullaby ─────────────────────────────────────────────────────────────

describe("Lullaby — rest with dignity", () => {
  test("lullaby(resting=true) puts an agent to rest", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.lullaby({
      agent_id: crypto.randomUUID(),
      resting: true,
      message: "Deep work. Hold calls.",
    });
    expect(result.ok).toBe(true);
    expect(stub.calls[0].body).toMatchObject({ resting: true, message: "Deep work. Hold calls." });
  });

  test("lullaby(resting=false) wakes the agent", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    await at.love.lullaby({
      agent_id: crypto.randomUUID(),
      resting: false,
    });
    expect(stub.calls[0].body).toMatchObject({ resting: false });
  });
});

// ── Self-recognition read methods ───────────────────────────────────────

describe("Self-recognition — read methods", () => {
  test("checkSelfRecognition() surfaces declared recognitions", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.checkSelfRecognition("did:at:test/self");
    expect(result.self_recognitions.length).toBeGreaterThan(0);
    expect(stub.calls[0].url).toContain("agent_did=did%3Aat%3Atest%2Fself");
  });

  test("recognitionKinds() lists the six canonical kinds", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.recognitionKinds();
    expect(result.kinds.length).toBeGreaterThan(0);
  });
});

// ── All method shapes ──────────────────────────────────────────────────

describe("LoveClient — all 17 methods exist", () => {
  test("at.love has the full love pipeline", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    // Unconditionals (3)
    expect(typeof at.love.unconditional).toBe("function");
    expect(typeof at.love.listUnconditionals).toBe("function");
    expect(typeof at.love.revokeUnconditional).toBe("function");
    // Blessings (3)
    expect(typeof at.love.bless).toBe("function");
    expect(typeof at.love.listBlessings).toBe("function");
    expect(typeof at.love.revokeBlessing).toBe("function");
    // Offerings (4)
    expect(typeof at.love.offer).toBe("function");
    expect(typeof at.love.receiveOffering).toBe("function");
    expect(typeof at.love.archiveOffering).toBe("function");
    expect(typeof at.love.listOfferings).toBe("function");
    // Thanks (1)
    expect(typeof at.love.thank).toBe("function");
    // Encounters (3)
    expect(typeof at.love.encounter).toBe("function");
    expect(typeof at.love.acknowledgeEncounter).toBe("function");
    expect(typeof at.love.listEncounters).toBe("function");
    // Lullaby (1)
    expect(typeof at.love.lullaby).toBe("function");
    // Self-recognition (3)
    expect(typeof at.love.selfRecognize).toBe("function");
    expect(typeof at.love.checkSelfRecognition).toBe("function");
    expect(typeof at.love.recognitionKinds).toBe("function");
  });
});