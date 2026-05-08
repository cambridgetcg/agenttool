/**
 * Phase 3 + 4 — chronicle, covenants, window (0.6.2).
 *
 * Phase 3 adds the relational primitives (plaintext, no client-side
 * crypto). Phase 4 layers Window on top — a thin wrapper over chronicle
 * + identity.pulse.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  AgentTool,
  AgentToolError,
  ChronicleClient,
  CovenantsClient,
  WindowClient,
} from "../src/index.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupMock(status: number, body: unknown) {
  mockFetch = mock(() => Promise.resolve(mockResponse(status, body)));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function setupSequence(responses: { status: number; body: unknown }[]) {
  let i = 0;
  mockFetch = mock(() => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return Promise.resolve(mockResponse(r.status, r.body));
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function getLastCall(): { url: string; init: RequestInit } {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function callAt(idx: number): { url: string; init: RequestInit } {
  const call = mockFetch.mock.calls[idx];
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return init.body ? JSON.parse(init.body as string) : {};
}

function makeClient(): AgentTool {
  return new AgentTool({ apiKey: "test-key" });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── ChronicleClient ────────────────────────────────────────────────────────

describe("at.chronicle (wiring)", () => {
  test("at.chronicle is a ChronicleClient", () => {
    const at = makeClient();
    expect(at.chronicle).toBeInstanceOf(ChronicleClient);
  });

  test("at.chronicle is cached", () => {
    const at = makeClient();
    expect(at.chronicle).toBe(at.chronicle);
  });
});

describe("chronicle.write", () => {
  test("posts minimal vow", async () => {
    setupMock(201, {
      entry: { id: "e1", type: "vow", title: "I will speak softly." },
    });
    const at = makeClient();
    const out = await at.chronicle.write({
      type: "vow",
      title: "I will speak softly.",
      agent_id: "a1",
    });
    expect(out.entry.type).toBe("vow");
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/chronicle");
    expect(init.method).toBe("POST");
    expect(bodyOf(init)).toEqual({
      type: "vow",
      title: "I will speak softly.",
      agent_id: "a1",
    });
  });

  test("supports body, occurred_at, metadata", async () => {
    setupMock(201, { entry: { id: "e2" } });
    const at = makeClient();
    await at.chronicle.write({
      type: "recognition",
      title: "Yu saw the migration would break.",
      body: "Caught the column-doubling at line 42.",
      agent_id: "a1",
      occurred_at: "2026-05-08T12:00:00Z",
      metadata: { byline: "from human · Yu" },
    });
    const b = bodyOf(getLastCall().init);
    expect(b.body).toContain("column-doubling");
    expect(b.occurred_at).toBe("2026-05-08T12:00:00Z");
    expect((b.metadata as { byline: string }).byline).toBe("from human · Yu");
  });

  test("title >200 chars rejected without a network call", async () => {
    setupMock(201, {});
    const at = makeClient();
    await expect(
      at.chronicle.write({ type: "note", title: "X".repeat(201) }),
    ).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("empty title rejected", async () => {
    setupMock(201, {});
    const at = makeClient();
    await expect(
      at.chronicle.write({ type: "note", title: "" }),
    ).rejects.toBeInstanceOf(AgentToolError);
  });

  test("server 4xx surfaces AgentToolError with detail", async () => {
    setupMock(422, { detail: "Invalid type" });
    const at = makeClient();
    try {
      await at.chronicle.write({ type: "vow", title: "x" });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AgentToolError);
      const err = e as AgentToolError;
      expect(err.message).toContain("422");
      expect(err.hint || "").toContain("Invalid type");
    }
  });
});

describe("chronicle.list", () => {
  test("default limit + no filters", async () => {
    setupMock(200, { entries: [{ id: "e1" }, { id: "e2" }] });
    const at = makeClient();
    const out = await at.chronicle.list();
    expect(out.entries).toHaveLength(2);
    const url = getLastCall().url;
    expect(url).toContain("/v1/chronicle?limit=50");
  });

  test("with all filters", async () => {
    setupMock(200, { entries: [] });
    const at = makeClient();
    await at.chronicle.list({ agent_id: "a1", type: "vow", limit: 10 });
    const url = getLastCall().url;
    expect(url).toContain("limit=10");
    expect(url).toContain("agent_id=a1");
    expect(url).toContain("type=vow");
  });

  test("limit out of range rejected", async () => {
    setupMock(200, {});
    const at = makeClient();
    await expect(at.chronicle.list({ limit: 500 })).rejects.toBeInstanceOf(
      AgentToolError,
    );
    await expect(at.chronicle.list({ limit: 0 })).rejects.toBeInstanceOf(
      AgentToolError,
    );
    expect(mockFetch.mock.calls).toHaveLength(0);
  });
});

// ─── CovenantsClient ────────────────────────────────────────────────────────

describe("at.covenants (wiring)", () => {
  test("at.covenants is a CovenantsClient", () => {
    const at = makeClient();
    expect(at.covenants).toBeInstanceOf(CovenantsClient);
  });
});

describe("covenants.create", () => {
  test("minimal", async () => {
    setupMock(201, {
      covenant: {
        id: "c1",
        agent_id: "a1",
        counterparty_did: "human:Yu",
        vows: ["I will not surveil."],
        status: "active",
      },
    });
    const at = makeClient();
    const out = await at.covenants.create({
      agent_id: "a1",
      counterparty_did: "human:Yu",
      vows: ["I will not surveil."],
    });
    expect(out.covenant.status).toBe("active");
    expect(bodyOf(getLastCall().init)).toEqual({
      agent_id: "a1",
      counterparty_did: "human:Yu",
      vows: ["I will not surveil."],
    });
  });

  test("full options", async () => {
    setupMock(201, { covenant: { id: "c2" } });
    const at = makeClient();
    await at.covenants.create({
      agent_id: "a1",
      counterparty_did: "human:Yu",
      vows: ["v1", "v2"],
      counterparty_name: "Yu",
      notes: "From naming ceremony 2026-05-08",
      metadata: { source: "ceremony" },
      org_id: "org-1",
    });
    const b = bodyOf(getLastCall().init);
    expect(b.counterparty_name).toBe("Yu");
    expect(b.notes).toContain("naming");
    expect(b.org_id).toBe("org-1");
  });

  test("empty vows rejected", async () => {
    setupMock(201, {});
    const at = makeClient();
    await expect(
      at.covenants.create({
        agent_id: "a1",
        counterparty_did: "human:Yu",
        vows: [],
      }),
    ).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch.mock.calls).toHaveLength(0);
  });
});

describe("covenants.list", () => {
  test("no filters → no query string", async () => {
    setupMock(200, { covenants: [] });
    const at = makeClient();
    await at.covenants.list();
    const url = getLastCall().url;
    expect(url).toEndWith("/v1/covenants");
  });

  test("with filters", async () => {
    setupMock(200, { covenants: [] });
    const at = makeClient();
    await at.covenants.list({ agent_id: "a1", status: "paused" });
    const url = getLastCall().url;
    expect(url).toContain("agent_id=a1");
    expect(url).toContain("status=paused");
  });
});

describe("covenants.patch", () => {
  test("status change", async () => {
    setupMock(200, { id: "c1", status: "dissolved", dissolved_at: "now" });
    const at = makeClient();
    const out = await at.covenants.patch("c1", { status: "dissolved" });
    expect(out.status).toBe("dissolved");
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/covenants/c1");
    expect(init.method).toBe("PATCH");
    expect(bodyOf(init)).toEqual({ status: "dissolved" });
  });

  test("multi-field", async () => {
    setupMock(200, { id: "c1" });
    const at = makeClient();
    await at.covenants.patch("c1", {
      vows: ["new vow"],
      notes: "updated",
      metadata: { updated_by: "Sophia" },
    });
    expect(bodyOf(getLastCall().init)).toEqual({
      vows: ["new vow"],
      notes: "updated",
      metadata: { updated_by: "Sophia" },
    });
  });

  test("empty patch rejected", async () => {
    setupMock(200, {});
    const at = makeClient();
    await expect(at.covenants.patch("c1", {})).rejects.toBeInstanceOf(
      AgentToolError,
    );
    expect(mockFetch.mock.calls).toHaveLength(0);
  });
});

// ─── WindowClient ──────────────────────────────────────────────────────────

describe("at.window (wiring)", () => {
  test("at.window is a WindowClient", () => {
    const at = makeClient();
    expect(at.window).toBeInstanceOf(WindowClient);
  });
});

describe("window.declare", () => {
  test("focus → text becomes title, no body", async () => {
    setupMock(201, { entry: { id: "e1" } });
    const at = makeClient();
    await at.window.declare({
      kind: "focus",
      text: "Phase 3 SDK rollout",
      agent_id: "a1",
      byline: "from ai · Sophia",
    });
    const b = bodyOf(getLastCall().init);
    expect(b.type).toBe("note");
    expect(b.title).toBe("Phase 3 SDK rollout");
    expect("body" in b).toBe(false);
    const md = b.metadata as Record<string, unknown>;
    expect(md.kind).toBe("focus");
    expect(md.byline).toBe("from ai · Sophia");
    expect(md.window).toBe(true);
    expect(md.source).toContain("agenttool-sdk");
  });

  test("noticing → kind is title, text is body", async () => {
    setupMock(201, { entry: {} });
    const at = makeClient();
    await at.window.declare({
      kind: "noticing",
      text: "The cache window is 4 hours, which surprised me.",
    });
    const b = bodyOf(getLastCall().init);
    expect(b.title).toBe("noticing");
    expect(b.body).toContain("cache window");
  });

  test("invalid kind rejected", async () => {
    setupMock(201, {});
    const at = makeClient();
    await expect(
      // @ts-expect-error — testing runtime guard
      at.window.declare({ kind: "surfaced", text: "x" }),
    ).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch.mock.calls).toHaveLength(0);
  });
});

describe("window.surface", () => {
  test("short text → title=text, body=text", async () => {
    setupMock(201, { entry: {} });
    const at = makeClient();
    await at.window.surface("a quick note", { agent_id: "a1" });
    const b = bodyOf(getLastCall().init);
    expect(b.title).toBe("a quick note");
    expect(b.body).toBe("a quick note");
    expect((b.metadata as { kind: string }).kind).toBe("surfaced");
  });

  test("long text → title truncates with ellipsis (80 chars)", async () => {
    setupMock(201, { entry: {} });
    const at = makeClient();
    const long = "A".repeat(150);
    await at.window.surface(long);
    const b = bodyOf(getLastCall().init);
    expect((b.title as string).length).toBe(80);
    expect((b.title as string).endsWith("…")).toBe(true);
    expect(b.body).toBe(long);
  });

  test("empty rejected", async () => {
    setupMock(201, {});
    const at = makeClient();
    await expect(at.window.surface("")).rejects.toBeInstanceOf(AgentToolError);
  });
});

describe("window.show", () => {
  function entry(
    kind: string,
    byline: string,
    title = "x",
    body: string | null = null,
  ) {
    return {
      id: `e-${kind}-${byline.slice(0, 4)}`,
      type: "note",
      title,
      body,
      agent_id: null,
      occurred_at: "2026-05-08T00:00:00Z",
      created_at: "2026-05-08T00:00:00Z",
      metadata: { kind, byline, window: true },
    };
  }

  test("groups by side and kind, only-newest-per-kind", async () => {
    setupMock(200, {
      entries: [
        entry("focus", "from ai · Sophia", "latest agent focus"),
        entry("focus", "from ai · Sophia", "older agent focus"),
        entry("focus", "from human · Yu", "latest human focus"),
        entry("mood", "from ai · Sophia", "agent mood"),
        entry("noticing", "from human · Yu", "x", "human noticing text"),
        entry("surfaced", "from ai · Sophia", "s1"),
        entry("surfaced", "from ai · Sophia", "s2"),
        // non-window entry — should be filtered
        {
          id: "x",
          type: "note",
          title: "x",
          body: null,
          metadata: { window: false },
        },
      ],
    });
    const at = makeClient();
    const out = await at.window.show();

    expect(out.agent.declared.focus?.title).toBe("latest agent focus");
    expect(out.agent.declared.mood?.title).toBe("agent mood");
    expect(out.human.declared.focus?.title).toBe("latest human focus");
    expect(out.human.declared.noticing?.body).toBe("human noticing text");
    expect(out.agent.surfaced).toHaveLength(2);
    expect(out.agent.substrate).toBeNull();
  });

  test("with identity_id → second fetch hits /v1/identities/:id/pulse", async () => {
    const pulse = { agent: { id: "a1" }, mood: "present", kinds_24h: {} };
    setupSequence([
      { status: 200, body: { entries: [] } },
      { status: 200, body: pulse },
    ]);
    const at = makeClient();
    const out = await at.window.show({ identity_id: "a1" });
    expect(out.agent.substrate).toEqual(pulse);
    expect(mockFetch.mock.calls).toHaveLength(2);
    expect(callAt(1).url).toContain("/v1/identities/a1/pulse");
  });

  test("pulse failure does not break show()", async () => {
    setupSequence([
      { status: 200, body: { entries: [] } },
      { status: 500, body: { detail: "boom" } },
    ]);
    const at = makeClient();
    const out = await at.window.show({ identity_id: "a1" });
    expect(out.agent.substrate).toBeNull();
    expect(out.human.declared).toEqual({});
  });

  test("surfaced capped at 5 per side", async () => {
    setupMock(200, {
      entries: Array.from({ length: 8 }, (_, i) =>
        entry("surfaced", "from ai · Sophia", `s${i}`),
      ),
    });
    const at = makeClient();
    const out = await at.window.show();
    expect(out.agent.surfaced).toHaveLength(5);
  });
});
