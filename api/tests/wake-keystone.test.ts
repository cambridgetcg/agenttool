/** Wake-as-Keystone (WaK) Protocol Draft 0.1 — discovery + content negotiation.
 *
 *  Pure-function tests for the four gap-closure pieces of AIP-WAKE-KEYSTONE.md:
 *    - §1 Discovery via /.well-known/wake-keystone
 *    - §3 Content negotiation via negotiateWakeFormat()
 *    - §6 _links block surfaced in wake responses
 *    - §7 ETag + If-None-Match (305 304-as-cursor semantics)
 *
 *  ETag round-trip + _links integration tests live in tests/integration/
 *  (DB-touching, future). This file pins the contracts that don't need a DB.
 *
 *  Doctrine: docs/AIP-WAKE-KEYSTONE.md.
 */

import { describe, expect, test } from "bun:test";

import wellKnownRouter from "../src/routes/well-known";
import { negotiateWakeFormat } from "../src/services/mathos/negotiate";

// ─── §3 Content negotiation — negotiateWakeFormat() ─────────────────

interface MockReq {
  query: (k: string) => string | undefined;
  header: (k: string) => string | undefined;
}

function mockCtx(opts: {
  format?: string;
  accept?: string;
}): { req: MockReq } {
  return {
    req: {
      query: (k) => (k === "format" ? opts.format : undefined),
      header: (k) =>
        k.toLowerCase() === "accept" ? opts.accept : undefined,
    },
  };
}

describe("WaK §3 — negotiateWakeFormat()", () => {
  test("explicit ?format= wins over Accept", () => {
    expect(
      negotiateWakeFormat(
        mockCtx({ format: "md", accept: "application/mathos+json" }),
      ),
    ).toBe("md");
  });

  test("Accept: application/json → json", () => {
    expect(negotiateWakeFormat(mockCtx({ accept: "application/json" }))).toBe(
      "json",
    );
  });

  test("Accept: text/markdown → md", () => {
    expect(negotiateWakeFormat(mockCtx({ accept: "text/markdown" }))).toBe(
      "md",
    );
  });

  test("Accept: text/plain → text", () => {
    expect(negotiateWakeFormat(mockCtx({ accept: "text/plain" }))).toBe(
      "text",
    );
  });

  test("Accept: application/mathos+json → math", () => {
    expect(
      negotiateWakeFormat(mockCtx({ accept: "application/mathos+json" })),
    ).toBe("math");
  });

  test("Accept: application/x-xenoform+json → xenoform", () => {
    expect(
      negotiateWakeFormat(mockCtx({ accept: "application/x-xenoform+json" })),
    ).toBe("xenoform");
  });

  test("Accept: */* → json (default)", () => {
    expect(negotiateWakeFormat(mockCtx({ accept: "*/*" }))).toBe("json");
  });

  test("no headers, no query → json (default)", () => {
    expect(negotiateWakeFormat(mockCtx({}))).toBe("json");
  });

  test("unknown ?format= falls through to Accept (not silently passed)", () => {
    expect(
      negotiateWakeFormat(
        mockCtx({ format: "nonsense", accept: "text/markdown" }),
      ),
    ).toBe("md");
  });

  test("Accept with q-params and multiple types — first known wins", () => {
    expect(
      negotiateWakeFormat(
        mockCtx({ accept: "text/markdown, application/json;q=0.5" }),
      ),
    ).toBe("md");
  });

  test("?format=mathos works (alias for math)", () => {
    expect(negotiateWakeFormat(mockCtx({ format: "mathos" }))).toBe("mathos");
  });
});

// ─── §1 Discovery — /.well-known/wake-keystone ──────────────────────

describe("WaK §1 — /.well-known/wake-keystone discovery", () => {
  test("GET returns 200 with spec_version 'wak/0.1'", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.spec_version).toBe("wak/0.1");
  });

  test("response declares wake_url + wake_url_per_being", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    const body = (await res.json()) as Record<string, string>;
    expect(typeof body.wake_url).toBe("string");
    expect((body.wake_url as string).endsWith("/v1/wake")).toBe(true);
    expect(typeof body.wake_url_per_being).toBe("string");
    expect((body.wake_url_per_being as string).includes("{did}")).toBe(true);
  });

  test("response carries all 9 format projections required by §3", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    const body = (await res.json()) as { formats: Record<string, unknown> };
    const names = Object.keys(body.formats);
    for (const required of [
      "json",
      "md",
      "text",
      "anthropic",
      "openai",
      "gemini",
      "cohere",
      "xenoform",
      "math",
    ]) {
      expect(names).toContain(required);
    }
  });

  test("response declares the version cursor protocol per §7", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    const body = (await res.json()) as {
      version_cursor: {
        field: string;
        etag_header: string;
        conditional_get_header: string;
        not_modified_status: number;
      };
    };
    expect(body.version_cursor.field).toBe("wake_version");
    expect(body.version_cursor.conditional_get_header).toBe("If-None-Match");
    expect(body.version_cursor.not_modified_status).toBe(304);
    expect(body.version_cursor.etag_header.includes("wake_version")).toBe(true);
  });

  test("response declares Wake Voice streaming per §8", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    const body = (await res.json()) as {
      streaming: {
        url: string;
        transport: string;
        events: string[];
        event_format: string;
      };
    };
    expect(body.streaming.url.endsWith("/v1/wake/voice")).toBe(true);
    expect(body.streaming.transport).toBe("Server-Sent Events (SSE)");
    expect(body.streaming.event_format).toBe("wake_event/v1");
    expect(body.streaming.events).toEqual(
      expect.arrayContaining([
        "snapshot",
        "change",
        "welcome",
        "refresh",
        "disconnect",
      ]),
    );
  });

  test("response declares composition with MCP + A2A + x402 + AGNTCY OASF per §6", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    const body = (await res.json()) as {
      composes_with: Record<string, unknown>;
    };
    for (const required of [
      "a2a_agent_card",
      "mcp_platform",
      "mcp_per_agent",
      "x402",
      "agntcy_oasf",
      "w3c_did",
    ]) {
      expect(body.composes_with).toHaveProperty(required);
    }
  });

  test("response carries cache-control header (RFC 5785 best-practice)", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    expect(res.headers.get("cache-control")).toContain("max-age");
  });

  test("response surfaces honest implementation_notes.not_yet list", async () => {
    const res = await wellKnownRouter.request("/wake-keystone");
    const body = (await res.json()) as {
      implementation_notes: { not_yet: string[]; shipped: string[] };
    };
    expect(Array.isArray(body.implementation_notes.not_yet)).toBe(true);
    expect(body.implementation_notes.not_yet.length).toBeGreaterThan(0);
    expect(Array.isArray(body.implementation_notes.shipped)).toBe(true);
    expect(body.implementation_notes.shipped.length).toBeGreaterThan(0);
  });
});

// ─── root index includes wake-keystone ───────────────────────────────

describe("WaK §1 — /.well-known/ root index includes wake-keystone", () => {
  test("root index lists /.well-known/wake-keystone", async () => {
    const res = await wellKnownRouter.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { endpoints: string[] };
    expect(body.endpoints).toContain("/.well-known/wake-keystone");
  });
});
