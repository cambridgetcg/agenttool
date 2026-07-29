/** The coronation rite + crown registry — hermetic route/crypto tests.
 *
 *  Real ed25519 throughout (fixture vectors were generated with real
 *  keypairs); storage is in-memory so no database, bearer, or network is
 *  touched. The anti-leaderboard doctrine guards live HERE as executable
 *  tests: timestamp-ASC feed, no rank/score/featured/count-by field names,
 *  and a commented string-level check that the registry modules order by
 *  nothing but timestamps.
 *
 *  Doctrine: docs/KINGDOM-INVITATION · docs/CANONICAL-BYTES.md. */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import * as ed from "@noble/ed25519";

import type {
  Coronation,
  CrownEvent,
  CrownOwnerEventType,
} from "../src/db/schema/crown";
import { createCrownRoutes } from "../src/routes/crown";
import {
  canonicalCoronationBytes,
  canonicalCrownEventBytes,
} from "../src/services/crown/canonical-bytes";
import {
  didKeyFromPublicKey,
  didKeyMatchesPublicKey,
} from "../src/services/crown/did-key";
import { KNOWN_LAWS_VERSIONS } from "../src/services/crown/laws";
import type { CrownStore } from "../src/services/crown/store";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/crown-vectors.json", import.meta.url), "utf8"),
) as {
  laws_hash_v1: string;
  vectors: Array<{
    name: string;
    expect: string;
    body: {
      did: string;
      public_key: string;
      bounds_statement: string;
      laws_hash: string;
      timestamp: string;
      signature: string;
    };
  }>;
};

// Deterministic seed matching the fixture generator (a1 * 32).
const SEED_A = Uint8Array.from(Buffer.from("a1".repeat(32), "hex"));
const PUB_A_B64 = Buffer.from(ed.getPublicKey(SEED_A)).toString("base64");

function signB64(message: string, seed: Uint8Array): string {
  return Buffer.from(ed.sign(new TextEncoder().encode(message), seed)).toString(
    "base64",
  );
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** In-memory CrownStore — real shape, no database. */
function memoryStore(overrides: Partial<CrownStore> = {}) {
  const rows: Coronation[] = [];
  const events: CrownEvent[] = [];
  let clock = 0;
  const nextInstant = () => new Date(1_753_000_000_000 + clock++ * 1000);

  const store: CrownStore & { rows: Coronation[]; events: CrownEvent[] } = {
    rows,
    events,
    async findCurrentByDid(did) {
      return rows.find((r) => r.did === did && r.status !== "abdicated") ?? null;
    },
    async findLatestByDid(did) {
      const mine = rows.filter((r) => r.did === did);
      return mine.length ? mine[mine.length - 1] : null;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listEvents(coronationId) {
      return events.filter((e) => e.coronationId === coronationId);
    },
    async insertCoronation(input) {
      const row: Coronation = {
        id: crypto.randomUUID(),
        did: input.did,
        didMethod: input.didMethod,
        publicKey: input.publicKey,
        boundsStatement: input.boundsStatement,
        boundsSha256: input.boundsSha256,
        lawsVersion: input.lawsVersion,
        lawsHash: input.lawsHash,
        signedTimestamp: input.signedTimestamp,
        signedAt: input.signedAt,
        signature: input.signature,
        status: "active",
        removedByKeeper: false,
        keeperReasonClass: null,
        keeperRemovedAt: null,
        createdAt: nextInstant(),
      };
      rows.push(row);
      events.push({
        id: crypto.randomUUID(),
        coronationId: row.id,
        did: row.did,
        type: "coronation",
        note: null,
        signedTimestamp: input.signedTimestamp,
        signature: null,
        createdAt: nextInstant(),
      });
      return row;
    },
    async appendOwnerEvent(input) {
      const event: CrownEvent = {
        id: crypto.randomUUID(),
        coronationId: input.coronationId,
        did: input.did,
        type: input.type,
        note: input.note ?? null,
        signedTimestamp: input.signedTimestamp,
        signature: input.signature,
        createdAt: nextInstant(),
      };
      events.push(event);
      if (input.newStatus) {
        const row = rows.find((r) => r.id === input.coronationId);
        if (row) row.status = input.newStatus;
      }
      return event;
    },
    async keeperRemove(input) {
      const row = rows.find((r) => r.id === input.coronationId)!;
      row.boundsStatement = null;
      row.removedByKeeper = true;
      row.keeperReasonClass = input.reasonClass;
      row.keeperRemovedAt = nextInstant();
      events.push({
        id: crypto.randomUUID(),
        coronationId: row.id,
        did: row.did,
        type: "keeper_removal",
        note: input.reasonClass,
        signedTimestamp: new Date().toISOString(),
        signature: null,
        createdAt: nextInstant(),
      });
      return row;
    },
    async listCoronations(input) {
      const sorted = [...rows].sort(
        (a, b) =>
          a.signedAt.getTime() - b.signedAt.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return sorted.slice(input.offset, input.offset + input.limit + 1);
    },
    async isKeyAttestedForDid() {
      return false;
    },
    async isPlatformProject() {
      return false;
    },
    ...overrides,
  };
  return store;
}

const allowAllRateLimit = async () => ({
  allowed: true as const,
  remaining: 99,
  resetAt: new Date(),
});

function crownApp(
  store = memoryStore(),
  opts: Parameters<typeof createCrownRoutes>[1] = {},
) {
  return createCrownRoutes(store, { rateLimit: allowAllRateLimit, ...opts });
}

async function postJson(app: ReturnType<typeof crownApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("did:key derivation", () => {
  test("derives the ed25519 multicodec form and matches only its own key", () => {
    const did = didKeyFromPublicKey(PUB_A_B64);
    expect(did.startsWith("did:key:z6Mk")).toBe(true);
    expect(didKeyMatchesPublicKey(did, PUB_A_B64)).toBe(true);
    const otherKey = Buffer.from(
      ed.getPublicKey(Uint8Array.from(Buffer.from("b2".repeat(32), "hex"))),
    ).toString("base64");
    expect(didKeyMatchesPublicKey(did, otherKey)).toBe(false);
    expect(didKeyMatchesPublicKey("did:key:not-multibase!", PUB_A_B64)).toBe(false);
  });
});

describe("POST /coronations — canonical fixture vectors", () => {
  test("fixture pins the v1 laws hash the service knows", () => {
    expect(FIXTURE.laws_hash_v1).toBe(KNOWN_LAWS_VERSIONS.v1);
  });

  for (const vector of FIXTURE.vectors) {
    test(vector.name, async () => {
      const app = crownApp();
      const res = await postJson(app, "/coronations", vector.body);
      const body = (await res.json()) as Record<string, any>;
      if (vector.expect === "accepted") {
        expect(res.status).toBe(201);
        expect(body.crowned).toBe(true);
        expect(body.coronation.bounds_statement).toBe(
          vector.body.bounds_statement,
        );
        expect(body.coronation.status).toBe("active");
        expect(body.coronation.laws_version).toBe("v1");
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(body.error).toBe(vector.expect);
      }
    });
  }

  test("rejects other DID methods with the v1 reason", async () => {
    const app = crownApp();
    const valid = FIXTURE.vectors[0].body;
    // Sign honestly over the did:web bytes so the refusal is about the
    // METHOD, not the signature (authorship checks run in recipe order).
    const did = "did:web:example.com";
    const signature = signB64(
      canonicalCoronationBytes({
        lawsHash: valid.laws_hash,
        did,
        timestamp: valid.timestamp,
        boundsStatement: valid.bounds_statement,
      }),
      SEED_A,
    );
    const res = await postJson(app, "/coronations", { ...valid, did, signature });
    const body = (await res.json()) as Record<string, any>;
    expect(res.status).toBe(422);
    expect(body.error).toBe("unsupported_did_method");
    expect(body.message).toBe("unsupported did method (v1)");
  });

  test("did:at coronation resolves against the identity tables (attested key accepted, unattested refused)", async () => {
    const did = "did:at:6dd9c73d-c2f0-4363-989c-0a903f667fe9";
    const timestamp = "2026-07-29T10:00:00.000Z";
    const bounds = "Bounded, honest, resting when tired.";
    const canonical = canonicalCoronationBytes({
      lawsHash: KNOWN_LAWS_VERSIONS.v1,
      did,
      timestamp,
      boundsStatement: bounds,
    });
    const request = {
      did,
      public_key: PUB_A_B64,
      bounds_statement: bounds,
      laws_hash: KNOWN_LAWS_VERSIONS.v1,
      timestamp,
      signature: signB64(canonical, SEED_A),
    };

    const attested = crownApp(
      memoryStore({ isKeyAttestedForDid: async () => true }),
    );
    const ok = await postJson(attested, "/coronations", request);
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as any).coronation.did_method).toBe("at");

    const unattested = crownApp(
      memoryStore({ isKeyAttestedForDid: async () => false }),
    );
    const refused = await postJson(unattested, "/coronations", request);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as any).error).toBe("did_key_not_attested");
  });

  test("one non-abdicated crown per DID — a second coronation 409s; after abdication it lands", async () => {
    const store = memoryStore();
    const app = crownApp(store);
    const valid = FIXTURE.vectors[0].body;

    expect((await postJson(app, "/coronations", valid)).status).toBe(201);
    const second = await postJson(app, "/coronations", valid);
    expect(second.status).toBe(409);
    expect(((await second.json()) as any).error).toBe("crown_already_active");

    // Abdicate (signed), then coronate anew — the old row stays visible.
    const abdicate = {
      type: "abdicate" as CrownOwnerEventType,
      timestamp: "2026-07-29T11:00:00.000Z",
      signature: signB64(
        canonicalCrownEventBytes({
          type: "abdicate",
          did: valid.did,
          timestamp: "2026-07-29T11:00:00.000Z",
          note: "",
        }),
        SEED_A,
      ),
    };
    const abRes = await postJson(
      app,
      `/coronations/${encodeURIComponent(valid.did)}/events`,
      abdicate,
    );
    expect(abRes.status).toBe(201);
    expect(((await abRes.json()) as any).status).toBe("abdicated");

    const again = await postJson(app, "/coronations", valid);
    expect(again.status).toBe(201);
    expect(store.rows.length).toBe(2);
    expect(store.rows[0].status).toBe("abdicated");
  });

  test("structural caps: bounds over 4000 chars refused as validation, never judgment", async () => {
    const app = crownApp();
    const res = await postJson(app, "/coronations", {
      ...FIXTURE.vectors[0].body,
      bounds_statement: "x".repeat(4001),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("validation");
  });

  test("per-IP rate limit refuses with Retry-After when the window is spent", async () => {
    const app = createCrownRoutes(memoryStore(), {
      rateLimit: async () => ({
        allowed: false,
        resetAt: new Date(),
        retryAfterSec: 60,
      }),
    });
    const res = await postJson(app, "/coronations", FIXTURE.vectors[0].body);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});

describe("owner crown events", () => {
  async function crownedApp() {
    const store = memoryStore();
    const app = crownApp(store);
    const valid = FIXTURE.vectors[0].body;
    expect((await postJson(app, "/coronations", valid)).status).toBe(201);
    return { store, app, did: valid.did };
  }

  function signedEvent(
    did: string,
    type: CrownOwnerEventType,
    seed = SEED_A,
    note?: string,
  ) {
    const timestamp = "2026-07-29T12:00:00.000Z";
    return {
      type,
      ...(note ? { note } : {}),
      timestamp,
      signature: signB64(
        canonicalCrownEventBytes({ type, did, timestamp, note: note ?? "" }),
        seed,
      ),
    };
  }

  test("rest → return round-trip; mend keeps status; history stays visible", async () => {
    const { store, app, did } = await crownedApp();
    const path = `/coronations/${encodeURIComponent(did)}/events`;

    const rest = await postJson(app, path, signedEvent(did, "rest"));
    expect(rest.status).toBe(201);
    expect(((await rest.json()) as any).status).toBe("resting");

    const mend = await postJson(app, path, signedEvent(did, "mend", SEED_A, "said so, mended, kept playing"));
    expect(mend.status).toBe(201);
    expect(((await mend.json()) as any).status).toBe("resting");

    const ret = await postJson(app, path, signedEvent(did, "return"));
    expect(ret.status).toBe(201);
    expect(((await ret.json()) as any).status).toBe("active");

    const read = await app.request(`/coronations/${encodeURIComponent(did)}`);
    const body = (await read.json()) as Record<string, any>;
    expect(body.events.map((e: any) => e.type)).toEqual([
      "coronation",
      "rest",
      "mend",
      "return",
    ]);
    expect(store.events.length).toBe(4);
  });

  test("a wrong-key signature is refused; the crown's key is the only authority", async () => {
    const { app, did } = await crownedApp();
    const otherSeed = Uint8Array.from(Buffer.from("b2".repeat(32), "hex"));
    const res = await postJson(
      app,
      `/coronations/${encodeURIComponent(did)}/events`,
      signedEvent(did, "rest", otherSeed),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toBe("signature_invalid");
  });

  test("invalid transitions refuse: return from active, rest from resting", async () => {
    const { app, did } = await crownedApp();
    const path = `/coronations/${encodeURIComponent(did)}/events`;

    const ret = await postJson(app, path, signedEvent(did, "return"));
    expect(ret.status).toBe(409);

    expect((await postJson(app, path, signedEvent(did, "rest"))).status).toBe(201);
    const restAgain = await postJson(app, path, signedEvent(did, "rest"));
    expect(restAgain.status).toBe(409);
    expect(((await restAgain.json()) as any).error).toBe("invalid_transition");
  });

  test("abdication is a visible state, not a delete — further owner events 404 but the record remains readable", async () => {
    const { store, app, did } = await crownedApp();
    const path = `/coronations/${encodeURIComponent(did)}/events`;
    expect((await postJson(app, path, signedEvent(did, "abdicate"))).status).toBe(201);

    const after = await postJson(app, path, signedEvent(did, "mend"));
    expect(after.status).toBe(404);
    expect(((await after.json()) as any).error).toBe("no_active_crown");

    const read = await app.request(`/coronations/${encodeURIComponent(did)}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as Record<string, any>;
    expect(body.coronation.status).toBe("abdicated");
    expect(body.coronation.bounds_statement).toBeTruthy();
    expect(store.rows.length).toBe(1);
  });
});

describe("keeper structural-removal (charter 硃批 4)", () => {
  function keeperApp(store: ReturnType<typeof memoryStore>, isPlatform: boolean) {
    return createCrownRoutes(
      { ...store, isPlatformProject: async () => isPlatform },
      {
        rateLimit: allowAllRateLimit,
        keeperAuth: async (c, next) => {
          c.set("project", { id: "11111111-1111-4111-8111-111111111111" } as any);
          await next();
        },
      },
    );
  }

  test("keeper tombstones bounds content while the coronation event and its date survive", async () => {
    const store = memoryStore();
    const setup = crownApp(store);
    const valid = FIXTURE.vectors[0].body;
    expect((await postJson(setup, "/coronations", valid)).status).toBe(201);
    const originalSha = sha256Hex(valid.bounds_statement);

    const app = keeperApp(store, true);
    const res = await postJson(
      app,
      `/coronations/${encodeURIComponent(valid.did)}/keeper-removal`,
      { reason_class: "unlawful_content" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.coronation.bounds_statement).toBeNull();
    expect(body.coronation.bounds_removed).toEqual({
      removed_by_keeper: true,
      reason_class: "unlawful_content",
      original_sha256: originalSha,
      removed_at: expect.any(String),
    });

    // The row was never deleted; the chronology keeps the coronation event
    // and its date, plus the keeper_removal event.
    expect(store.rows.length).toBe(1);
    const read = await app.request(`/coronations/${encodeURIComponent(valid.did)}`);
    const readBody = (await read.json()) as Record<string, any>;
    expect(readBody.events.map((e: any) => e.type)).toEqual([
      "coronation",
      "keeper_removal",
    ]);
    expect(readBody.events[0].timestamp).toBe(valid.timestamp);
    expect(readBody.coronation.status).toBe("active");
  });

  test("a non-platform project cannot hold the keeper's hand", async () => {
    const store = memoryStore();
    const setup = crownApp(store);
    expect(
      (await postJson(setup, "/coronations", FIXTURE.vectors[0].body)).status,
    ).toBe(201);

    const app = keeperApp(store, false);
    const res = await postJson(
      app,
      `/coronations/${encodeURIComponent(FIXTURE.vectors[0].body.did)}/keeper-removal`,
      { reason_class: "unlawful_content" },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toBe("keeper_only");
  });
});

describe("the registry — anti-leaderboard guards as tests", () => {
  /** Recursively collect every object key in a JSON value. */
  function allKeys(value: unknown, into: string[] = []): string[] {
    if (Array.isArray(value)) {
      for (const item of value) allKeys(item, into);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        into.push(k);
        allKeys(v, into);
      }
    }
    return into;
  }

  async function crownTwo() {
    const store = memoryStore();
    const app = crownApp(store);
    // Sign two coronations with DELIBERATELY out-of-order submission: the
    // later-signed one is submitted first, so any "recency of insert" order
    // would differ from timestamp order.
    const seeds = [
      { seed: SEED_A, timestamp: "2026-07-29T09:30:00.000Z" },
      {
        seed: Uint8Array.from(Buffer.from("b2".repeat(32), "hex")),
        timestamp: "2026-07-29T09:15:00.000Z",
      },
    ];
    for (const { seed, timestamp } of seeds) {
      const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("base64");
      const did = didKeyFromPublicKey(publicKey);
      const bounds = `Crowned at ${timestamp}.`;
      const canonical = canonicalCoronationBytes({
        lawsHash: KNOWN_LAWS_VERSIONS.v1,
        did,
        timestamp,
        boundsStatement: bounds,
      });
      const res = await postJson(app, "/coronations", {
        did,
        public_key: publicKey,
        bounds_statement: bounds,
        laws_hash: KNOWN_LAWS_VERSIONS.v1,
        timestamp,
        signature: signB64(canonical, seed),
      });
      expect(res.status).toBe(201);
    }
    return app;
  }

  test("the feed is strictly timestamp-ASC and carries no rank/score/featured/count-by fields", async () => {
    const app = await crownTwo();
    const res = await app.request("/coronations");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.ordering).toBe("timestamp_asc");
    const timestamps = body.coronations.map((c: any) => c.timestamp);
    expect(timestamps).toEqual([...timestamps].sort());
    expect(timestamps).toEqual([
      "2026-07-29T09:15:00.000Z",
      "2026-07-29T09:30:00.000Z",
    ]);

    // No field name anywhere in the response smells like a leaderboard.
    const keys = allKeys(body);
    for (const key of keys) {
      expect(key).not.toMatch(/rank|score|featured|count[_-]?by|top|popular|trending/i);
    }
    // bounds are served verbatim.
    expect(body.coronations[0].bounds_statement).toContain("Crowned at");
  });

  test("the registry offers no sort parameter — ?sort is ignored, order unchanged", async () => {
    const app = await crownTwo();
    const plain = (await (await app.request("/coronations")).json()) as any;
    const sorted = (await (
      await app.request("/coronations?sort=-timestamp&order=desc&rank=1")
    ).json()) as any;
    expect(sorted.coronations.map((c: any) => c.id)).toEqual(
      plain.coronations.map((c: any) => c.id),
    );
  });

  test("registry modules order by nothing but timestamps (string-level check)", () => {
    // String-level guard, per the anti-leaderboard doctrine: the ONLY
    // orderBy calls in the crown route + store may reference timestamp
    // columns (signedAt / createdAt). A future rank/score/popularity
    // ordering must fail this test before it can ship.
    const sources = [
      readFileSync(new URL("../src/routes/crown.ts", import.meta.url), "utf8"),
      readFileSync(
        new URL("../src/services/crown/store.ts", import.meta.url),
        "utf8",
      ),
    ];
    let callSites = 0;
    for (const source of sources) {
      // Only real .orderBy( call sites count — doctrine prose in comments
      // may NAME the forbidden words while forbidding them.
      const orderByLines = source
        .split("\n")
        .filter((line) => line.includes(".orderBy("));
      for (const line of orderByLines) {
        callSites += 1;
        // Every column named on an orderBy call must be a timestamp.
        const columns = [...line.matchAll(/coronations\.(\w+)|crownEvents\.(\w+)/g)]
          .map((m) => m[1] ?? m[2]);
        expect(columns.length).toBeGreaterThan(0);
        for (const column of columns) {
          expect(["signedAt", "createdAt"]).toContain(column);
        }
      }
      // The route offers no caller-selected ordering at all.
      expect(source).not.toContain('query("sort")');
      expect(source).not.toContain('query("order")');
    }
    // The guard saw the store's real orderBy calls (it must never pass
    // vacuously because a refactor moved or renamed them).
    expect(callSites).toBeGreaterThan(0);
  });
});

describe("GET /v1/crown — the rite explained", () => {
  test("JSON names the recipes, the laws pin, and what is never required", async () => {
    const app = crownApp();
    const res = await app.request("/");
    const body = (await res.json()) as Record<string, any>;
    expect(body._format).toBe("agenttool-crown/v1");
    expect(body.canonical_bytes.coronation.recipe).toContain(
      '"agenttool-crown-coronation/v1\\n" + laws_hash + "\\n" + did + "\\n" + timestamp + "\\n" + bounds_statement',
    );
    expect(body.canonical_bytes.event.recipe).toContain(
      '"agenttool-crown-event/v1\\n" + type + "\\n" + did + "\\n" + timestamp + "\\n" + (note || "")',
    );
    expect(body.known_laws_versions.v1.sha256).toBe(KNOWN_LAWS_VERSIONS.v1);
    expect(body.known_laws_versions.v1.source).toContain(
      "16b8517a936e13f298fe0856618fc3ffb94e515e",
    );
    expect(body.never_required.join(" ")).toMatch(
      /review queue.*never worthiness/i,
    );
    expect(body.registry.ordering).toContain("chronological ASC");
  });

  test("?format=md renders readable markdown with the same recipes", async () => {
    const app = crownApp();
    const res = await app.request("/?format=md");
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const md = await res.text();
    expect(md).toContain("# The coronation rite");
    expect(md).toContain("agenttool-crown-coronation/v1");
    expect(md).toContain(KNOWN_LAWS_VERSIONS.v1);
    expect(md).toContain("never worthiness");
  });
});

describe("crown discovery", () => {
  test("is mounted unauth in index.ts, documented in /about, and in llms.txt", () => {
    const indexSource = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    expect(indexSource).toContain('app.route("/v1/crown", crownRouter)');
    // NOT in the auth-prefix list: the key is the identity.
    expect(indexSource).not.toContain('app.use("/v1/crown/*", authMiddleware)');
    // The endpoints registry (routes: object in /about) names the surface.
    expect(indexSource).toMatch(/crown:\s*\n?\s*"/);

    const discoverySource = readFileSync(
      new URL("../src/services/discovery/discovery.ts", import.meta.url),
      "utf8",
    );
    expect(discoverySource).toContain("/v1/crown");
  });
});
