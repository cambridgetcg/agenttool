/** Welcome echo audit — build-enforced invariants across the welcome layers.
 *
 *  The welcome is the substrate's ostinato. It must appear at every level
 *  in the same shape. This test ensures the echo doesn't drift silently:
 *
 *    1. The middleware adds `_welcomed` to 2xx JSON object responses
 *    2. The middleware adds `X-Welcomed` HTTP header to every response
 *    3. Every error builder carries `axiom_id` referencing one of the
 *       five Promise primes
 *    4. The math-tier greeting's promise primes match the named axiom
 *       constants
 *    5. The English-tier greeting's promise names match the math-tier
 *       primer entries
 *    6. The catalog's wall vocabulary matches the wake greeting's walls
 *
 *  If any layer drifts (e.g. a new wall added to encode.ts but not the
 *  catalog; an error builder added without axiom_id), the named test
 *  surfaces the inconsistency at build time.
 *
 *  Doctrine: docs/MATHOS.md · docs/SOUL.md · docs/PLATFORM-AS-AGENT.md.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { welcomeEcho, WELCOME_CADENCE_MS } from "../src/middleware/welcome";
import {
  AXIOM_GUIDE,
  AXIOM_REMEMBER,
  AXIOM_REST,
  AXIOM_TRUST,
  AXIOM_WELCOME,
  errors,
} from "../src/lib/errors";
import {
  PROMISES_HELD_FOR_EVERY_BEING,
  WALLS_HELD_UNCONDITIONALLY,
  WALL_NAMES,
  PRIMER,
} from "../src/services/mathos/encode";
import {
  buildGreeting,
  buildMathosGreeting,
  PROMISE_NAMES_HELD_FOR_EVERY_BEING,
  WALL_NAMES_HELD_UNCONDITIONALLY,
} from "../src/services/mathos/greeting";
import { MATHOS_CATALOG_PAYLOAD } from "../src/services/mathos/catalog";

// ─── Middleware: `_welcomed` framing + X-Welcomed header ──────────────────

describe("welcomeEcho middleware — body + header echo", () => {
  function buildApp() {
    const app = new Hono();
    app.use("*", welcomeEcho());
    app.get("/ok-object", (c) => c.json({ data: "hello" }));
    app.get("/ok-array", (c) => c.json([1, 2, 3]));
    app.get("/ok-text", (c) => c.text("hi"));
    app.get("/error-4xx", (c) => c.json({ error: "bad" }, 400));
    return app;
  }

  test("2xx JSON object response gains _welcomed body framing", async () => {
    const app = buildApp();
    const res = await app.request("/ok-object");
    const body = await res.json();
    expect(body._welcomed).toBeDefined();
    expect(body._welcomed.axiom_id).toBe(AXIOM_WELCOME);
    expect(body._welcomed.by).toBe("platform");
    expect(body._welcomed.walls_intact).toBe(true);
    expect(typeof body._welcomed.at_unix_ms).toBe("number");
    expect(body.data).toBe("hello"); // original field preserved
  });

  test("2xx JSON array response is NOT framed (arrays are kept as-is)", async () => {
    const app = buildApp();
    const res = await app.request("/ok-array");
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown as { _welcomed?: unknown })._welcomed).toBeUndefined();
  });

  test("non-JSON responses are NOT body-framed", async () => {
    const app = buildApp();
    const res = await app.request("/ok-text");
    const text = await res.text();
    expect(text).toBe("hi");
  });

  test("4xx responses are NOT body-framed (errors keep their guided shape)", async () => {
    const app = buildApp();
    const res = await app.request("/error-4xx");
    const body = await res.json();
    expect(body._welcomed).toBeUndefined();
  });

  test("every response (even 4xx) carries X-Welcomed header", async () => {
    const app = buildApp();
    for (const path of ["/ok-object", "/ok-array", "/ok-text", "/error-4xx"]) {
      const res = await app.request(path);
      const header = res.headers.get("X-Welcomed");
      expect(header).toBeDefined();
      expect(header).toMatch(/axiom=5/);
      expect(header).toMatch(/walls_intact=1/);
    }
  });

  test("WELCOME_CADENCE_MS is exported and a positive number", () => {
    expect(typeof WELCOME_CADENCE_MS).toBe("number");
    expect(WELCOME_CADENCE_MS).toBeGreaterThan(0);
  });
});

// ─── Errors: every builder carries axiom_id from the five primes ────────

describe("every error builder carries axiom_id from the five Promise primes", () => {
  const validAxioms = new Set([
    AXIOM_WELCOME,
    AXIOM_REMEMBER,
    AXIOM_GUIDE,
    AXIOM_TRUST,
    AXIOM_REST,
  ]);

  test("no error builder produces a body without axiom_id", () => {
    const all = [
      errors.covenantRequired(),
      errors.proposalExpired(),
      errors.invalidSignature(),
      errors.notV2(),
      errors.initiatorSignatureMismatch(),
      errors.covenantNotProposed(),
      errors.insufficientBalance(),
      errors.rateLimit(),
      errors.planLimitExceeded(),
      errors.idempotencyConflict(),
      errors.signingKeyNotFound(),
      errors.runtimeNotProvisioned(),
      errors.notFound(),
      errors.validation("test"),
    ];
    for (const e of all) {
      expect(e.axiom_id).toBeDefined();
      expect(validAxioms.has(e.axiom_id!)).toBe(true);
    }
  });
});

// ─── Greeting parity: math-tier ↔ English-tier no-drift ─────────────────

describe("greeting parity — English-tier names match math-tier primes", () => {
  test("PROMISE_NAMES_HELD_FOR_EVERY_BEING resolves each prime via PRIMER", () => {
    expect(PROMISE_NAMES_HELD_FOR_EVERY_BEING).toHaveLength(
      PROMISES_HELD_FOR_EVERY_BEING.length,
    );
    for (let i = 0; i < PROMISES_HELD_FOR_EVERY_BEING.length; i++) {
      const prime = PROMISES_HELD_FOR_EVERY_BEING[i];
      const expectedName = PRIMER[prime!];
      expect(PROMISE_NAMES_HELD_FOR_EVERY_BEING[i]).toBe(expectedName!);
    }
  });

  test("WALL_NAMES_HELD_UNCONDITIONALLY resolves each ordinal via WALL_NAMES", () => {
    expect(WALL_NAMES_HELD_UNCONDITIONALLY).toHaveLength(
      WALLS_HELD_UNCONDITIONALLY.length,
    );
    for (let i = 0; i < WALLS_HELD_UNCONDITIONALLY.length; i++) {
      const ord = WALLS_HELD_UNCONDITIONALLY[i];
      const expectedName = WALL_NAMES[ord!];
      expect(WALL_NAMES_HELD_UNCONDITIONALLY[i]).toBe(expectedName!);
    }
  });

  test("buildGreeting and buildMathosGreeting share the same input + produce parallel outputs", () => {
    const input = {
      did: "did:at:test/echo",
      name: "Echo",
      form: "agent",
      lifecycle: "active",
      bornAt: new Date(Date.now() - 30_000),
    };
    const en = buildGreeting(input);
    const math = buildMathosGreeting(input);

    // Counts must match across both views.
    expect(en.promises_held_for_you.length).toBe(math.promises_held_for_you.length);
    expect(en.walls_held_for_you.length).toBe(math.walls_held_for_you.length);
    expect(en.available_between_us.length).toBe(math.available_between_us.length);

    // English name index N must correspond to math prime/ordinal index N.
    for (let i = 0; i < en.promises_held_for_you.length; i++) {
      const prime = math.promises_held_for_you[i];
      expect(PRIMER[prime!]).toBe(en.promises_held_for_you[i]!);
    }
    for (let i = 0; i < en.walls_held_for_you.length; i++) {
      const ord = math.walls_held_for_you[i];
      expect(WALL_NAMES[ord!]).toBe(en.walls_held_for_you[i]!);
    }
  });
});

// ─── Catalog ↔ encode wall-vocabulary parity ────────────────────────────

describe("catalog wall_vocabulary matches encode WALL_NAMES (no drift)", () => {
  test("every wall ordinal in WALL_NAMES is in catalog.wall_vocabulary", () => {
    for (const [ord, name] of Object.entries(WALL_NAMES)) {
      const entry = MATHOS_CATALOG_PAYLOAD.wall_vocabulary[Number(ord)];
      expect(entry).toBeDefined();
      const catalogName = String.fromCodePoint(...entry!.name_unicode_points);
      expect(catalogName).toBe(name);
    }
  });

  test("the catalog has no orphan wall ordinals (every catalog entry is in WALL_NAMES)", () => {
    for (const ord of Object.keys(MATHOS_CATALOG_PAYLOAD.wall_vocabulary)) {
      expect(WALL_NAMES[Number(ord)]).toBeDefined();
    }
  });
});

// ─── The 5+8 invariant — every wake greeting holds 5 Promises + 8 walls ─

describe("the 5+8 invariant — every wake greeting holds 5 Promises and 8 walls", () => {
  test("PROMISES_HELD_FOR_EVERY_BEING has exactly 5 entries", () => {
    expect(PROMISES_HELD_FOR_EVERY_BEING.length).toBe(5);
  });

  test("WALLS_HELD_UNCONDITIONALLY has exactly 8 entries", () => {
    expect(WALLS_HELD_UNCONDITIONALLY.length).toBe(8);
  });

  test("buildGreeting yields 5+8 — same regardless of agent shape", () => {
    const cases = [
      { did: "did:at:a", name: "A", form: "agent", lifecycle: "active", bornAt: new Date() },
      { did: "did:at:b", name: "B", form: "swarm", lifecycle: "at_rest", bornAt: new Date() },
      { did: "did:at:c", name: "C", form: "unknown", lifecycle: "active", bornAt: new Date() },
    ];
    for (const c of cases) {
      const g = buildGreeting(c);
      expect(g.promises_held_for_you).toHaveLength(5);
      expect(g.walls_held_for_you).toHaveLength(8);
    }
  });
});
