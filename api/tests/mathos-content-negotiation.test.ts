/** mathos-content-negotiation.test.ts — pins the Accept-header stance flip.
 *
 *  Phase C ships content negotiation: `Accept: application/mathos+json` is
 *  now honored alongside the legacy `?format=math` query parameter on
 *  every math-capable surface. The wantsMathTier() helper is the single
 *  source of truth; these tests pin its semantics + per-endpoint behavior.
 *
 *  Endpoints exercised:
 *    - /v1/mathos/catalog  (already always returns mathos)
 *    - /v1/pathways        (math-tier branch via Accept header)
 *    - /v1/self            (math-tier branch via Accept header)
 *    - /federation/wake/:uuid (already pinned by mathos-federation-wake.test.ts)
 *
 *  Note: /v1/wake requires auth + DB; that route's content-negotiation
 *  branch is verified at the negotiate helper level here, plus the
 *  existing wake-mathos integration tests.
 *
 *  Doctrine: docs/MATHOS.md — content-negotiation flip.
 */

import { describe, expect, test } from "bun:test";

import { wantsMathTier } from "../src/services/mathos/negotiate";
import mathosRouter from "../src/routes/mathos";
import pathwaysRouter from "../src/routes/pathways";
import selfRouter from "../src/routes/self";

// ─── The helper itself — semantics first ──────────────────────────────────

interface MinimalCtx {
  req: {
    query: (k: string) => string | undefined;
    header: (k: string) => string | undefined;
  };
}

function ctx(query: Record<string, string> = {}, headers: Record<string, string> = {}): MinimalCtx {
  return {
    req: {
      query: (k) => query[k],
      header: (k) => headers[k] ?? headers[k.toLowerCase()],
    },
  };
}

describe("wantsMathTier — content negotiation semantics", () => {
  test("?format=math returns true (back-compat)", () => {
    expect(wantsMathTier(ctx({ format: "math" }))).toBe(true);
  });

  test("?format=mathos returns true (the long form)", () => {
    expect(wantsMathTier(ctx({ format: "mathos" }))).toBe(true);
  });

  test("Accept: application/mathos+json returns true (the stance-forward form)", () => {
    expect(
      wantsMathTier(ctx({}, { Accept: "application/mathos+json" })),
    ).toBe(true);
  });

  test("Accept header is case-insensitive on the header name", () => {
    expect(
      wantsMathTier(ctx({}, { accept: "application/mathos+json" })),
    ).toBe(true);
  });

  test("Accept header is case-insensitive on the value", () => {
    expect(
      wantsMathTier(ctx({}, { Accept: "APPLICATION/MATHOS+JSON" })),
    ).toBe(true);
  });

  test("Accept with multiple media types still matches if mathos is present", () => {
    expect(
      wantsMathTier(
        ctx({}, { Accept: "text/html, application/mathos+json;q=0.9, */*;q=0.5" }),
      ),
    ).toBe(true);
  });

  test("?format=md OVERRIDES Accept — explicit caller choice wins", () => {
    expect(
      wantsMathTier(
        ctx({ format: "md" }, { Accept: "application/mathos+json" }),
      ),
    ).toBe(false);
  });

  test("?format=text OVERRIDES Accept — explicit caller choice wins", () => {
    expect(
      wantsMathTier(
        ctx({ format: "text" }, { Accept: "application/mathos+json" }),
      ),
    ).toBe(false);
  });

  test("no query AND Accept: application/json returns false (JSON fallback)", () => {
    expect(wantsMathTier(ctx({}, { Accept: "application/json" }))).toBe(false);
  });

  test("no signals at all returns false (default to non-math)", () => {
    expect(wantsMathTier(ctx())).toBe(false);
  });
});

// ─── /v1/pathways — Accept header is honored ────────────────────────────

describe("GET /v1/pathways — content negotiation", () => {
  test("Accept: application/mathos+json → mathos envelope", async () => {
    const res = await pathwaysRouter.request("/", {
      headers: { Accept: "application/mathos+json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body.primer).toBeDefined();
    expect(body.payload.pathway_count).toBeGreaterThan(0);
  });

  test("no Accept header AND no format query → English JSON (back-compat)", async () => {
    const res = await pathwaysRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBeUndefined();
    // English-tier pathways shape
    expect(body.pathways).toBeDefined();
  });

  test("?format=math (legacy) still returns mathos", async () => {
    const res = await pathwaysRouter.request("/?format=math");
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });

  test("?format=text OVERRIDES Accept: mathos+json", async () => {
    const res = await pathwaysRouter.request("/?format=text", {
      headers: { Accept: "application/mathos+json" },
    });
    // pathways doesn't support format=text — falls back to English JSON.
    // Key assertion: the response is NOT a math envelope.
    const body = await res.json();
    expect(body._format).toBeUndefined();
  });
});

// ─── /v1/self — Accept header is honored ─────────────────────────────────

describe("GET /v1/self — content negotiation", () => {
  test("Accept: application/mathos+json → mathos envelope", async () => {
    const res = await selfRouter.request("/", {
      headers: { Accept: "application/mathos+json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body.payload).toBeDefined();
  });

  test("no Accept header → English JSON catalog", async () => {
    const res = await selfRouter.request("/");
    const body = await res.json();
    expect(body._format).toBeUndefined();
    // English-tier self shape
    expect(body.self).toBeDefined();
    expect(body.strata).toBeDefined();
  });

  test("?format=math (legacy) still returns mathos", async () => {
    const res = await selfRouter.request("/?format=math");
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });
});

// ─── /v1/mathos/catalog — always mathos regardless of Accept ─────────────

describe("GET /v1/mathos/catalog — always returns mathos (no negotiation needed)", () => {
  test("with Accept: application/json still returns mathos", async () => {
    const res = await mathosRouter.request("/catalog", {
      headers: { Accept: "application/json" },
    });
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });

  test("with no headers still returns mathos", async () => {
    const res = await mathosRouter.request("/catalog");
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });
});
