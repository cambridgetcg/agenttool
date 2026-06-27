/** Runtime e2e tests — infrastructure-as-runtime, pinned.
 *
 *  The agent's cloud. Three custody tiers:
 *    self     — user holds K_master, runs the loop. Maximum privacy.
 *    bridged  — cloud runs the loop, user holds K_master in a sidecar. Default.
 *    trusted  — cloud holds K_master. Maximum uptime.
 *
 *  Nen mapping:
 *    十 Ten (Focus)    → provision a runtime (orient the agent in the cloud)
 *    練 Ren (Enhance)  → think-once triggers a thinking cycle (active aura)
 *    絶 Zetsu (Suppress) → stop the runtime (rest, don't crash)
 *    発 Hatsu (Release) → the runtime runs the agent's expression against an LLM
 *
 *  The bridge (Tier 2) is the Dark Continent's edge — the WSS channel
 *  between the user's machine (K_master) and the cloud orchestrator. */

import { afterEach, describe, expect, test } from "bun:test";
import { AgentTool } from "../src/client.js";

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

function makeStub() {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    let body: unknown;
    try { body = init?.body ? JSON.parse(init.body as string) : undefined; } catch { body = undefined; }
    calls.push({ method, url: u, body });

    if (u.includes("/v1/runtimes") && method === "POST" && !u.includes("/stop") && !u.includes("/start") && !u.includes("/restart") && !u.includes("/think") && !u.includes("/rotate")) {
      return new Response(JSON.stringify({
        id: crypto.randomUUID(),
        name: (body as Record<string, unknown>)?.name ?? "test",
        mode: (body as Record<string, unknown>)?.mode ?? "bridged",
        status: "provisioned",
        identity_id: (body as Record<string, unknown>)?.identity_id ?? null,
        llm: (body as Record<string, unknown>)?.llm ?? null,
        bridge: (body as Record<string, unknown>)?.bridge ?? null,
        region: null,
        metadata: {},
        control_token_hash: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/runtimes") && method === "GET" && !u.includes("/bridge") && !u.includes("/events") && !u.includes("/audit")) {
      // Check if this is a single-runtime GET (has a UUID after /v1/runtimes/)
      const parts = u.replace(/\/$/, "").split("/");
      const afterRuntimes = parts[parts.indexOf("v1") + 2]; // the segment after "runtimes"
      if (afterRuntimes && afterRuntimes.length > 2) {
        // GET /v1/runtimes/:id
        return new Response(JSON.stringify({ id: afterRuntimes, name: "test", mode: "bridged", status: "running" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // GET /v1/runtimes (list)
      return new Response(JSON.stringify({ runtimes: [{ id: "rt1", name: "test", mode: "bridged", status: "running" }], count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/stop")) return new Response(JSON.stringify({ id: u.split("/")[3], status: "stopped" }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/start")) return new Response(JSON.stringify({ id: u.split("/")[3], status: "running" }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/restart")) return new Response(JSON.stringify({ id: u.split("/")[3], status: "starting" }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/rotate-token")) return new Response(JSON.stringify({ ok: true, control_token: "new-token" }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/bridge-status")) return new Response(JSON.stringify({ runtime_id: u.split("/")[3], connected: true, machine_id: "m1", last_seen_at: new Date().toISOString(), url: "wss://bridge.example" }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/think-once")) return new Response(JSON.stringify({ ok: true, latency_ms: 1234, strand_id: "s1", thought_seq: 5 }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/events")) return new Response(JSON.stringify({ events: [{ id: "e1", kind: "bridge_connected" }], count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/audit")) return new Response(JSON.stringify({ entries: [{ id: "a1", action: "provision" }], count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/v1/runtimes") && method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/v1/runtimes") && method === "PATCH") return new Response(JSON.stringify({ id: u.split("/")[3], name: (body as Record<string, unknown>)?.name }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// ── Provision ──────────────────────────────────────────────────────────

describe("Runtime — provision (Ten / Focus)", () => {
  test("provision a bridged runtime with LLM config + bridge", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const rt = await at.runtime.provision({
      name: "my-agent-cloud",
      mode: "bridged",
      identity_id: crypto.randomUUID(),
      llm: { provider: "anthropic", model: "claude-opus-4-8", vault_key: "ANTHROPIC_KEY" },
      bridge: { pubkey: "pubkey-b64", key_id: crypto.randomUUID() },
    });
    expect(rt.id).toBeDefined();
    expect(rt.mode).toBe("bridged");
    expect(rt.status).toBe("provisioned");
    expect(stub.calls[0].body).toMatchObject({ name: "my-agent-cloud", mode: "bridged" });
  });

  test("provision a self-mode runtime (maximum privacy)", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const rt = await at.runtime.provision({
      name: "private-agent",
      mode: "self",
    });
    expect(rt.mode).toBe("self");
  });
});

// ── List + Get ──────────────────────────────────────────────────────────

describe("Runtime — list + get", () => {
  test("list runtimes with status filter", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.runtime.list({ status: "running" });
    expect(result.runtimes.length).toBeGreaterThan(0);
    expect(stub.calls[0].url).toContain("status=running");
  });

  test("get a single runtime", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const rt = await at.runtime.get("rt-uuid");
    expect(rt.id).toBe("rt-uuid");
  });
});

// ── Stop / Start / Restart (Zetsu / wake / cycle) ───────────────────────

describe("Runtime — stop / start / restart", () => {
  test("stop the runtime (Zetsu — suppress)", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const rt = await at.runtime.stop("rt-uuid");
    expect(rt.status).toBe("stopped");
    expect(stub.calls[0].url).toContain("/stop");
  });

  test("start the runtime (wake from rest)", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const rt = await at.runtime.start("rt-uuid");
    expect(rt.status).toBe("running");
    expect(stub.calls[0].url).toContain("/start");
  });

  test("restart the runtime", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const rt = await at.runtime.restart("rt-uuid");
    expect(rt.status).toBe("starting");
  });
});

// ── Think once (Ren — enhance) ──────────────────────────────────────────

describe("Runtime — think-once (Ren / Enhance)", () => {
  test("trigger a thinking cycle", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.runtime.thinkOnce("rt-uuid");
    expect(result.ok).toBe(true);
    expect(result.latency_ms).toBeGreaterThan(0);
    expect(result.strand_id).toBeDefined();
    expect(result.thought_seq).toBeDefined();
    expect(stub.calls[0].url).toContain("/think-once");
  });
});

// ── Bridge status ────────────────────────────────────────────────────────

describe("Runtime — bridge status (Dark Continent edge)", () => {
  test("check if K_master sidecar is reachable", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const status = await at.runtime.bridgeStatus("rt-uuid");
    expect(status.connected).toBe(true);
    expect(status.machine_id).toBeDefined();
    expect(status.url).toContain("wss://");
  });
});

// ── Rotate token ────────────────────────────────────────────────────────

describe("Runtime — rotate token", () => {
  test("rotate the control token", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.runtime.rotateToken("rt-uuid");
    expect(result.ok).toBe(true);
    expect(result.control_token).toBeDefined();
  });
});

// ── Events + Audit ──────────────────────────────────────────────────────

describe("Runtime — events + audit", () => {
  test("list runtime events", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.runtime.events("rt-uuid");
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].kind).toBe("bridge_connected");
  });

  test("list audit entries", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.runtime.audit("rt-uuid");
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].action).toBe("provision");
  });
});

// ── Patch + Deprovision ─────────────────────────────────────────────────

describe("Runtime — patch + deprovision", () => {
  test("patch the runtime name", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const rt = await at.runtime.patch("rt-uuid", { name: "renamed" });
    expect(rt.name).toBe("renamed");
  });

  test("deprovision the runtime", async () => {
    const stub = makeStub();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.runtime.deprovision("rt-uuid");
    expect(result.ok).toBe(true);
    expect(stub.calls[0].method).toBe("DELETE");
  });
});

// ── Method shapes ───────────────────────────────────────────────────────

describe("Runtime — all 13 methods exist", () => {
  test("at.runtime has the full runtime lifecycle", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    expect(typeof at.runtime.provision).toBe("function");
    expect(typeof at.runtime.list).toBe("function");
    expect(typeof at.runtime.get).toBe("function");
    expect(typeof at.runtime.patch).toBe("function");
    expect(typeof at.runtime.deprovision).toBe("function");
    expect(typeof at.runtime.stop).toBe("function");
    expect(typeof at.runtime.start).toBe("function");
    expect(typeof at.runtime.restart).toBe("function");
    expect(typeof at.runtime.rotateToken).toBe("function");
    expect(typeof at.runtime.bridgeStatus).toBe("function");
    expect(typeof at.runtime.thinkOnce).toBe("function");
    expect(typeof at.runtime.events).toBe("function");
    expect(typeof at.runtime.audit).toBe("function");
  });
});