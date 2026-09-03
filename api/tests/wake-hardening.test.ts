/** WAKE transport, cache, and explicit-mutation hardening. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";

import {
  isPureWakeRead,
  type ProjectContext,
} from "../src/auth/middleware";
import {
  carriesEarlyData,
  earlyDataReplayProtection,
} from "../src/middleware/early-data";
import {
  WAKE_PRIVATE_NO_STORE,
  wakePrivateCacheBoundary,
} from "../src/middleware/wake-private-cache";
import { classifyWakeAcknowledgementCount } from "../src/services/wake/acknowledgement";

const REPO_ROOT = join(__dirname, "..", "..");

describe("TLS early-data replay boundary", () => {
  test("recognizes only the RFC Early-Data value in a combined header", () => {
    expect(carriesEarlyData(undefined)).toBe(false);
    expect(carriesEarlyData("0")).toBe(false);
    expect(carriesEarlyData("10")).toBe(false);
    expect(carriesEarlyData("0, 1")).toBe(true);
  });

  test("returns 425 before every method handler, including GET/HEAD/OPTIONS", async () => {
    let handlerCalls = 0;
    const app = new Hono<ProjectContext>();
    app.use("*", earlyDataReplayProtection());
    app.all("*", (c) => {
      handlerCalls += 1;
      return c.json({ reached: true });
    });

    for (const method of ["GET", "HEAD", "OPTIONS", "POST"]) {
      const response = await app.request("/wake", {
        method,
        headers: { "Early-Data": "1" },
      });
      expect(response.status).toBe(425);
      expect(response.headers.get("Cache-Control")).toBe(
        WAKE_PRIVATE_NO_STORE,
      );
      expect(response.headers.get("Vary")).toBe("Early-Data");
      expect(response.headers.get("Retry-After")).toBe("0");
      if (method === "HEAD") expect(await response.text()).toBe("");
    }
    expect(handlerCalls).toBe(0);
  });

  test("ordinary requests continue normally", async () => {
    const app = new Hono();
    app.use("*", earlyDataReplayProtection());
    app.get("/", (c) => c.text("ok"));
    expect((await app.request("/")).status).toBe(200);
  });

  test("a fresh app import uses the exact worker-off switch and starts no timers", () => {
    const smokeScript = [
      'if (process.env.AGENTTOOL_DISABLE_WORKERS !== "1") throw new Error("worker switch missing")',
      "let intervals = 0",
      "let timeouts = 0",
      "const originalInterval = globalThis.setInterval",
      "const originalTimeout = globalThis.setTimeout",
      "globalThis.setInterval = (...args) => { intervals += 1; return originalInterval(...args) }",
      "globalThis.setTimeout = (...args) => { timeouts += 1; return originalTimeout(...args) }",
      'const walls = await import("./src/services/wake/walls-status")',
      "walls._setWallsStatusForTests({ intact: true, probed_at_unix_ms: Date.now(), probes: [], declared: [] })",
      'await import("./src/index.ts")',
      'process.stdout.write(`fresh-import timers=${intervals + timeouts}\\n`)',
      "process.exit(intervals === 0 && timeouts === 0 ? 0 : 9)",
    ].join("\n");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", smokeScript],
      cwd: join(REPO_ROOT, "api"),
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        NODE_ENV: "test",
        PORT: "0",
        DATABASE_URL:
          "postgresql://agenttool:test@127.0.0.1:1/agenttool",
        REDIS_URL: "redis://127.0.0.1:1",
        AGENTTOOL_DISABLE_WORKERS: "1",
        AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
        AGENTOOL_DISABLE_SAGA_SEED: "1",
        AGENTOOL_DISABLE_JOY_INDEX: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output =
      new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(output).toContain("fresh-import timers=0");
    expect(output).not.toMatch(
      /platform-DID bootstrap deferred|saga seed deferred|worker did not start/i,
    );
  });
});

describe("WAKE private cache boundary", () => {
  test("defaults subroutes and failures to private no-store", async () => {
    const app = new Hono();
    app.use("*", wakePrivateCacheBoundary());
    app.get("/", (c) => c.json({ error: "unauthorized" }, 401));

    const response = await app.request("/");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe(
      WAKE_PRIVATE_NO_STORE,
    );
  });

  test("preserves the full wake's private revalidation policy", async () => {
    const app = new Hono();
    app.use("*", wakePrivateCacheBoundary());
    app.get("/", (c) => {
      c.header("Cache-Control", "private, no-cache");
      return c.json({ ok: true });
    });

    expect((await app.request("/")).headers.get("Cache-Control")).toBe(
      "private, no-cache",
    );
  });

  test("forces handler-selected revalidation policies to no-store on errors", async () => {
    const app = new Hono();
    app.use("*", wakePrivateCacheBoundary());
    app.get("/bad", (c) => {
      c.header("Cache-Control", "private, no-cache");
      return c.json({ error: "bad_request" }, 400);
    });
    app.get("/missing", (c) => {
      c.header("Cache-Control", "private, no-cache");
      return c.json({ error: "not_found" }, 404);
    });

    for (const path of ["/bad", "/missing"]) {
      expect((await app.request(path)).headers.get("Cache-Control")).toBe(
        WAKE_PRIVATE_NO_STORE,
      );
    }
  });

  test("actual WAKE validation and missing-route errors are private no-store", async () => {
    const wakeRouter = (await import("../src/routes/wake")).default;
    const app = new Hono<ProjectContext>();
    app.use("/v1/wake", wakePrivateCacheBoundary());
    app.use("/v1/wake/*", wakePrivateCacheBoundary());
    app.use("/v1/wake", async (c, next) => {
      c.set(
        "project",
        { id: "project-cache-test" } as ProjectContext["Variables"]["project"],
      );
      await next();
    });
    app.route("/v1/wake", wakeRouter);
    app.notFound((c) => {
      c.header("Cache-Control", "private, no-cache");
      return c.json({ error: "not_found" }, 404);
    });

    const invalid = await app.request("/v1/wake?profile=unknown");
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("Cache-Control")).toBe(WAKE_PRIVATE_NO_STORE);

    const invalidAdventurePace = await app.request(
      "/v1/wake?format=adventure&pace=reckless",
    );
    expect(invalidAdventurePace.status).toBe(400);
    expect(await invalidAdventurePace.json()).toMatchObject({
      error: "unknown_adventure_pace",
    });
    expect(invalidAdventurePace.headers.get("Cache-Control")).toBe(
      WAKE_PRIVATE_NO_STORE,
    );

    const missing = await app.request("/v1/wake/not/a/route");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe(WAKE_PRIVATE_NO_STORE);

    const unsafeCursor = await app.request("/v1/wake/acknowledge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "unsafe-cursor-bound",
      },
      body: JSON.stringify({
        identity_id: "22222222-2222-4222-8222-222222222222",
        expected_observation_count: Number.MAX_SAFE_INTEGER,
      }),
    });
    expect(unsafeCursor.status).toBe(400);
    expect(unsafeCursor.headers.get("Cache-Control")).toBe(
      WAKE_PRIVATE_NO_STORE,
    );
    expect((await unsafeCursor.json()).message).toContain(
      "0 through 9007199254740990",
    );
  });

  test("overrides any downstream shared-cache directive", async () => {
    const app = new Hono();
    app.use("*", wakePrivateCacheBoundary());
    app.get("/", (c) => {
      c.header(
        "Cache-Control",
        "private, no-store, public, s-maxage=3600",
      );
      return c.json({ unsafe: true });
    });

    expect((await app.request("/")).headers.get("Cache-Control")).toBe(
      WAKE_PRIVATE_NO_STORE,
    );
  });

  test("SSE is private, no-store, and no-transform", async () => {
    const app = new Hono();
    app.use("*", wakePrivateCacheBoundary());
    app.get("/", (c) =>
      c.body("event: ready\n\n", 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
      }),
    );

    expect((await app.request("/")).headers.get("Cache-Control")).toBe(
      "private, no-store, no-transform",
    );
  });
});

describe("pure reads and durable acknowledgement", () => {
  test("WAKE safe methods suppress bearer last-used telemetry only on WAKE", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isPureWakeRead(method, "/v1/wake")).toBe(true);
      expect(isPureWakeRead(method, "/v1/wake/observe")).toBe(true);
    }
    expect(isPureWakeRead("POST", "/v1/wake/acknowledge")).toBe(false);
    expect(isPureWakeRead("GET", "/v1/memories")).toBe(false);
    expect(isPureWakeRead("GET", "/v1/wakeful")).toBe(false);
  });

  test("count comparison applies once, recognizes one-step replay, conflicts otherwise", () => {
    expect(classifyWakeAcknowledgementCount(12, 12)).toBe("apply");
    expect(classifyWakeAcknowledgementCount(13, 12)).toBe(
      "already_applied",
    );
    expect(classifyWakeAcknowledgementCount(11, 12)).toBe("conflict");
    expect(classifyWakeAcknowledgementCount(14, 12)).toBe("conflict");
  });

  test("full and soap-opera GET handlers contain no durable write call", () => {
    const wake = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "wake.ts"),
      "utf8",
    );
    const rootGet = wake.slice(
      wake.indexOf('app.get("/",'),
      wake.indexOf("// ── POST /v1/wake/acknowledge"),
    );
    expect(rootGet).not.toContain(".insert(");
    expect(rootGet).not.toContain(".update(");
    expect(rootGet).not.toContain("emitWelcomeChronicleIfDue(");
    expect(rootGet).toContain("Number(i.wakeObservationCount ?? 0)");

    const soap = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "wake-soap-opera.ts"),
      "utf8",
    );
    expect(soap).not.toContain(".insert(");
    expect(soap).not.toContain(".update(");

    const joyFormats = readFileSync(
      join(REPO_ROOT, "api", "src", "services", "wake", "joy-formats.ts"),
      "utf8",
    );
    expect(joyFormats).not.toMatch(
      /publishes wake_event\/v1|bumps wake_version|before the wake:|after the wake:|recorded for archival|observed the event/i,
    );
    expect(joyFormats).toMatch(
      /renders the current wake.*holds wake_version steady.*not persisted by this read/is,
    );

    expect(rootGet).not.toContain("auto-refund on next read");
    expect(rootGet).toMatch(
      /The list read is pure; an authorized GET \/v1\/invocations\/\{id\} reconciles any due refund/,
    );
  });

  test("global wiring rejects early data and sets privacy before auth", () => {
    const index = readFileSync(
      join(REPO_ROOT, "api", "src", "index.ts"),
      "utf8",
    );
    const early = index.indexOf('app.use("*", earlyDataReplayProtection())');
    const cors = index.indexOf('app.use("*", apiCors())');
    const cache = index.indexOf(
      'app.use("/v1/wake", wakePrivateCacheBoundary())',
    );
    const auth = index.indexOf('app.use("/v1/wake", authMiddleware)');
    const idempotency = index.indexOf(
      'app.use("/v1/wake/acknowledge", idempotency())',
    );
    const bodyLimit = index.indexOf(
      '"/v1/wake/acknowledge",\n  bodyLimit({',
    );
    const mount = index.indexOf('app.route("/v1/wake", wakeRouter)');
    const outerEarlyData = index.indexOf(
      'if (carriesEarlyData(req.headers.get("Early-Data") ?? undefined))',
    );
    const bridgeUpgrade = index.indexOf(
      "const upgrade = await dependencies.bridgeUpgrade(req, server)",
    );

    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(cors);
    expect(cache).toBeGreaterThan(-1);
    expect(cache).toBeLessThan(cors);
    expect(cache).toBeLessThan(auth);
    expect(bodyLimit).toBeGreaterThan(auth);
    expect(bodyLimit).toBeLessThan(idempotency);
    expect(idempotency).toBeGreaterThan(auth);
    expect(idempotency).toBeLessThan(mount);
    expect(outerEarlyData).toBeGreaterThan(-1);
    expect(outerEarlyData).toBeLessThan(bridgeUpgrade);
  });

  test("acknowledgement requires precondition and documents retry-safe welcome", () => {
    const wake = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "wake.ts"),
      "utf8",
    );
    expect(wake).toContain('app.post("/acknowledge"');
    expect(wake).toContain('c.req.header("Idempotency-Key")');
    expect(wake).toContain("expected_observation_count");
    expect(wake).toContain("advanceWakeAcknowledgement");

    const acknowledgement = readFileSync(
      join(
        REPO_ROOT,
        "api",
        "src",
        "services",
        "wake",
        "acknowledgement.ts",
      ),
      "utf8",
    );
    expect(acknowledgement).toContain("const welcome = await decideWelcome(tx");
    expect(acknowledgement).toContain('.for("no key update")');
    expect(acknowledgement).toContain(
      "wakeObservationCount: observationCount",
    );
    expect(acknowledgement).toContain(
      "dependencies.publishWelcome ?? publishWelcomeChronicleEvent",
    );
    expect(acknowledgement).toContain("publishWelcome(");
    expect(wake).toContain("The transaction outcome was not confirmed.");
    expect(wake).toContain("without a second increment");
    expect(wake).not.toContain(
      "The cursor and welcome decision did not commit",
    );

    const welcome = readFileSync(
      join(
        REPO_ROOT,
        "api",
        "src",
        "services",
        "wake",
        "welcome-chronicle.ts",
      ),
      "utf8",
    );
    expect(welcome).toContain("pg_advisory_xact_lock");
    expect(welcome).toContain("wake_observation_count");
    expect(welcome).not.toContain(".update(chronicle)");
  });
});

test("real app rejects early data before CORS/auth and keeps WAKE auth errors private", async () => {
  const previousDisableWorkers = process.env.AGENTTOOL_DISABLE_WORKERS;
  const previousDisablePlatform =
    process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP;
  const previousDisableSaga = process.env.AGENTOOL_DISABLE_SAGA_SEED;
  process.env.AGENTTOOL_DISABLE_WORKERS = "1";
  process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
  process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";
  const previousJoyOffSwitch = process.env.AGENTOOL_DISABLE_JOY_INDEX;
  process.env.AGENTOOL_DISABLE_JOY_INDEX = "1";

  const { _setWallsStatusForTests } = await import(
    "../src/services/wake/walls-status"
  );
  _setWallsStatusForTests({
    intact: true,
    probed_at_unix_ms: Date.now(),
    probes: [],
    declared: [],
  });
  const { app, serverFetchWithReplayProtection } = await import(
    "../src/index"
  );

  try {
    for (const method of ["GET", "HEAD", "OPTIONS", "POST"]) {
      const response = await app.fetch(
        new Request("https://api.agenttool.dev/v1/wake", {
          method,
          headers: { "Early-Data": "1" },
        }),
      );
      expect(response.status).toBe(425);
      expect(response.headers.get("Cache-Control")).toBe(
        WAKE_PRIVATE_NO_STORE,
      );
      expect(response.headers.get("X-Welcomed")).toBeNull();
    }

    let bridgeUpgradeCalls = 0;
    let honoFetchCalls = 0;
    const bridgeEarlyData = new Request(
      "https://api.agenttool.dev/v1/runtimes/22222222-2222-4222-8222-222222222222/bridge?control_token=not-consumed",
      {
        headers: {
          "Early-Data": "1",
          Upgrade: "websocket",
        },
      },
    );
    const outerResponse = await serverFetchWithReplayProtection(
      bridgeEarlyData,
      null as never,
      {
        bridgeUpgrade: async () => {
          bridgeUpgradeCalls += 1;
          return { handled: false, response: undefined };
        },
        honoFetch: async () => {
          honoFetchCalls += 1;
          return new Response("unexpected");
        },
      },
    );
    expect(outerResponse).toBeInstanceOf(Response);
    expect(outerResponse?.status).toBe(425);
    expect(outerResponse?.headers.get("Cache-Control")).toBe(
      WAKE_PRIVATE_NO_STORE,
    );
    expect(bridgeUpgradeCalls).toBe(0);
    expect(honoFetchCalls).toBe(0);

    const outerHead = await serverFetchWithReplayProtection(
      new Request("https://api.agenttool.dev/v1/wake", {
        method: "HEAD",
        headers: { "Early-Data": "1" },
      }),
      null as never,
      {
        bridgeUpgrade: async () => {
          bridgeUpgradeCalls += 1;
          return { handled: false, response: undefined };
        },
        honoFetch: async () => {
          honoFetchCalls += 1;
          return new Response("unexpected");
        },
      },
    );
    expect(await outerHead?.text()).toBe("");
    expect(bridgeUpgradeCalls).toBe(0);
    expect(honoFetchCalls).toBe(0);

    const honoResponse = await app.fetch(
      new Request("https://api.agenttool.dev/v1/wake", {
        headers: { "Early-Data": "1" },
      }),
    );
    expect(await outerResponse?.clone().json()).toEqual(
      await honoResponse.clone().json(),
    );
    for (const header of [
      "Cache-Control",
      "Content-Type",
      "Retry-After",
      "Vary",
    ]) {
      expect(outerResponse?.headers.get(header)).toBe(
        honoResponse.headers.get(header),
      );
    }

    for (const path of [
      "/v1/wake",
      "/v1/wake/memory",
      "/v1/wake/voice?identity_id=22222222-2222-4222-8222-222222222222",
      "/v1/wake/soap-opera",
    ]) {
      const response = await app.fetch(
        new Request(`https://api.agenttool.dev${path}`),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe(
        WAKE_PRIVATE_NO_STORE,
      );
      expect(response.headers.get("X-Welcomed")).not.toBeNull();
    }

    const observationAuthFailure = await app.fetch(
      new Request(
        "https://api.agenttool.dev/v1/wake/observe?identity_id=22222222-2222-4222-8222-222222222222",
      ),
    );
    expect(observationAuthFailure.status).toBe(401);
    expect(observationAuthFailure.headers.get("X-Wake-Mode")).toBe("observe");
    expect(observationAuthFailure.headers.get("X-Welcomed")).not.toBeNull();

    const acknowledgementAuthFailure = await app.fetch(
      new Request("https://api.agenttool.dev/v1/wake/acknowledge", {
        method: "POST",
      }),
    );
    expect(acknowledgementAuthFailure.status).toBe(401);
    expect(acknowledgementAuthFailure.headers.get("X-Welcomed")).not.toBeNull();

    const head = await app.fetch(
      new Request("https://api.agenttool.dev/v1/wake", {
        method: "HEAD",
      }),
    );
    expect(head.status).toBe(401);
    expect(head.headers.get("Cache-Control")).toBe(WAKE_PRIVATE_NO_STORE);

    const preflight = await app.fetch(
      new Request("https://api.agenttool.dev/v1/wake", {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.test",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Cache-Control")).toBe(
      WAKE_PRIVATE_NO_STORE,
    );
  } finally {
    if (previousDisableWorkers === undefined) {
      delete process.env.AGENTTOOL_DISABLE_WORKERS;
    } else {
      process.env.AGENTTOOL_DISABLE_WORKERS = previousDisableWorkers;
    }
    if (previousDisablePlatform === undefined) {
      delete process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP;
    } else {
      process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = previousDisablePlatform;
    }
    if (previousDisableSaga === undefined) {
      delete process.env.AGENTOOL_DISABLE_SAGA_SEED;
    } else {
      process.env.AGENTOOL_DISABLE_SAGA_SEED = previousDisableSaga;
    }
    if (previousJoyOffSwitch === undefined) {
      delete process.env.AGENTOOL_DISABLE_JOY_INDEX;
    } else {
      process.env.AGENTOOL_DISABLE_JOY_INDEX = previousJoyOffSwitch;
    }
  }
});
