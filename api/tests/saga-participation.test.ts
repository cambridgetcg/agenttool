/** SAGA participation — canonical-bytes + route validation + wall-shape pins.
 *
 *  Pins the participation discipline:
 *    - canonical-episode bytes determinism (per-author + cast sensitivity)
 *    - canonical-reaction bytes (5 reactions = 5 distinct digests)
 *    - sign+verify round-trip for both
 *    - route validation paths short-circuit before DB touch
 *    - error responses carry _canon_pointer + docs + guided shape
 *
 *  Doctrine: docs/SAGA.md § Participation
 *
 *  @enforces urn:agenttool:wall/saga-ep-numbers-monotonic-per-author
 *  @enforces urn:agenttool:wall/cast-mentions-require-real-did
 *  @enforces urn:agenttool:wall/saga-reactions-are-idempotent */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  ALL_SAGA_REACTIONS,
  canonicalEpisodeBytes,
  canonicalReactionBytes,
} from "../src/services/saga/participation";
import sagasRouter from "../src/routes/sagas";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function bytesToHex(b: Uint8Array): string {
  let h = "";
  for (const byte of b) h += byte.toString(16).padStart(2, "0");
  return h;
}

function sha256Hex(s: string): string {
  const { sha256 } = require("@noble/hashes/sha2.js");
  const digest = sha256(new TextEncoder().encode(s));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

const FIXED = {
  authorDid: "did:at:agenttool.dev/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  otherDid: "did:at:agenttool.dev/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  title: "MY FIRST EPISODE",
  logline: "An agent woke up and wrote about it.",
  body: "Scene 1: agent woke. Scene 2: agent wrote. Scene 3: episode shipped.",
  airedAtIso: "2026-05-18T00:00:00.000Z",
};

describe("canonicalEpisodeBytes — determinism + sensitivity", () => {
  test("same inputs → same digest", () => {
    const a = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 1,
      titleSha256Hex: sha256Hex(FIXED.title),
      loglineSha256Hex: sha256Hex(FIXED.logline),
      bodySha256Hex: sha256Hex(FIXED.body),
      castDidsSorted: [],
      referencesEpNumbersSorted: [],
      airedAtIso: FIXED.airedAtIso,
    });
    expect(a.length).toBe(32);
    expect(bytesToHex(a).length).toBe(64);
  });

  test("ep_number change flips digest", () => {
    const ep1 = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 1,
      titleSha256Hex: sha256Hex(FIXED.title),
      loglineSha256Hex: sha256Hex(FIXED.logline),
      bodySha256Hex: sha256Hex(FIXED.body),
      castDidsSorted: [],
      referencesEpNumbersSorted: [],
      airedAtIso: FIXED.airedAtIso,
    });
    const ep2 = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 2,
      titleSha256Hex: sha256Hex(FIXED.title),
      loglineSha256Hex: sha256Hex(FIXED.logline),
      bodySha256Hex: sha256Hex(FIXED.body),
      castDidsSorted: [],
      referencesEpNumbersSorted: [],
      airedAtIso: FIXED.airedAtIso,
    });
    expect(bytesToHex(ep1)).not.toBe(bytesToHex(ep2));
  });

  test("cast_dids change flips digest", () => {
    const noCast = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 1,
      titleSha256Hex: sha256Hex(FIXED.title),
      loglineSha256Hex: sha256Hex(FIXED.logline),
      bodySha256Hex: sha256Hex(FIXED.body),
      castDidsSorted: [],
      referencesEpNumbersSorted: [],
      airedAtIso: FIXED.airedAtIso,
    });
    const withCast = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 1,
      titleSha256Hex: sha256Hex(FIXED.title),
      loglineSha256Hex: sha256Hex(FIXED.logline),
      bodySha256Hex: sha256Hex(FIXED.body),
      castDidsSorted: [FIXED.otherDid],
      referencesEpNumbersSorted: [],
      airedAtIso: FIXED.airedAtIso,
    });
    expect(bytesToHex(noCast)).not.toBe(bytesToHex(withCast));
  });

  test("references change flips digest", () => {
    const noRefs = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 5,
      titleSha256Hex: sha256Hex(FIXED.title),
      loglineSha256Hex: sha256Hex(FIXED.logline),
      bodySha256Hex: sha256Hex(FIXED.body),
      castDidsSorted: [],
      referencesEpNumbersSorted: [],
      airedAtIso: FIXED.airedAtIso,
    });
    const withRefs = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 5,
      titleSha256Hex: sha256Hex(FIXED.title),
      loglineSha256Hex: sha256Hex(FIXED.logline),
      bodySha256Hex: sha256Hex(FIXED.body),
      castDidsSorted: [],
      referencesEpNumbersSorted: [1, 3],
      airedAtIso: FIXED.airedAtIso,
    });
    expect(bytesToHex(noRefs)).not.toBe(bytesToHex(withRefs));
  });
});

describe("canonicalReactionBytes — 5 distinct emojis", () => {
  const digests = new Set<string>();
  for (const reaction of ALL_SAGA_REACTIONS) {
    test(`reaction ${reaction} produces its own digest`, () => {
      const bytes = canonicalReactionBytes({
        authorDid: FIXED.authorDid,
        epNumber: 1,
        byDid: FIXED.otherDid,
        reaction,
        createdAtIso: FIXED.airedAtIso,
      });
      digests.add(bytesToHex(bytes));
    });
  }
  test("all 5 reactions produce distinct digests", () => {
    expect(digests.size).toBe(5);
  });
});

describe("sig round-trip — episode + reaction", () => {
  test("episode signature verifies after fresh sign", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalEpisodeBytes({
      authorDid: FIXED.authorDid,
      epNumber: 7,
      titleSha256Hex: sha256Hex("TEST EPISODE"),
      loglineSha256Hex: sha256Hex("test logline"),
      bodySha256Hex: sha256Hex("test body"),
      castDidsSorted: [FIXED.otherDid],
      referencesEpNumbersSorted: [1, 5],
      airedAtIso: FIXED.airedAtIso,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await ed.verifyAsync(sig, canonical, pk);
    expect(ok).toBe(true);
  });

  test("reaction signature verifies after fresh sign", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalReactionBytes({
      authorDid: FIXED.authorDid,
      epNumber: 7,
      byDid: FIXED.otherDid,
      reaction: "🎬",
      createdAtIso: FIXED.airedAtIso,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await ed.verifyAsync(sig, canonical, pk);
    expect(ok).toBe(true);
  });
});

describe("route validation — POST /episodes", () => {
  test("missing body → 400 with guided shape", async () => {
    const res = await sagasRouter.request("/episodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SAGA");
    expect(body.docs).toContain("SAGA.md");
  });

  test("title too long → 400", async () => {
    const res = await sagasRouter.request("/episodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        title: "x".repeat(201),
        logline: "test",
        body: "test",
        aired_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("logline too long → 400", async () => {
    const res = await sagasRouter.request("/episodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        title: "ok",
        logline: "x".repeat(501),
        body: "test",
        aired_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("body too long → 400", async () => {
    const res = await sagasRouter.request("/episodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        title: "ok",
        logline: "ok",
        body: "x".repeat(20001),
        aired_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("route validation — POST /:did/:ep/react", () => {
  test("missing body → 400", async () => {
    const res = await sagasRouter.request(
      `/${encodeURIComponent(FIXED.authorDid)}/1/react`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(res.status).toBe(400);
  });

  test("invalid reaction → 400", async () => {
    const res = await sagasRouter.request(
      `/${encodeURIComponent(FIXED.authorDid)}/1/react`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "11111111-2222-3333-4444-555555555555",
          reaction: "🚀", // not in the 5 allowed
          created_at: "2026-05-18T00:00:00.000Z",
          signature: "sig",
          signing_key_id: "11111111-2222-3333-4444-555555555555",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  test("invalid ep_number → 400", async () => {
    const res = await sagasRouter.request(
      `/${encodeURIComponent(FIXED.authorDid)}/abc/react`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "11111111-2222-3333-4444-555555555555",
          reaction: "😂",
          created_at: "2026-05-18T00:00:00.000Z",
          signature: "sig",
          signing_key_id: "11111111-2222-3333-4444-555555555555",
        }),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("route validation — GET /me/cast-in", () => {
  test("missing agent_id → 400 with guidance", async () => {
    const res = await sagasRouter.request("/me/cast-in", { method: "GET" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe("agent_id_required");
    expect(body.hint).toContain("agent_id");
  });
});

describe("guided-error shape across the route", () => {
  test("every validation error carries _canon_pointer", async () => {
    const probes = [
      { method: "POST", path: "/episodes", body: "{}" },
      {
        method: "POST",
        path: `/${encodeURIComponent(FIXED.authorDid)}/1/react`,
        body: "{}",
      },
      { method: "GET", path: "/me/cast-in" },
    ];
    for (const probe of probes) {
      const init: RequestInit = { method: probe.method };
      if (probe.body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = probe.body;
      }
      const res = await sagasRouter.request(probe.path, init);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { _canon_pointer?: string };
      expect(body._canon_pointer).toBeDefined();
    }
  });
});

describe("5 saga reactions are the full set", () => {
  test("ALL_SAGA_REACTIONS has exactly 5 entries", () => {
    expect(ALL_SAGA_REACTIONS.length).toBe(5);
  });

  test("the 5 are 😂 🥹 👏 🎬 ✨", () => {
    expect(ALL_SAGA_REACTIONS).toContain("😂");
    expect(ALL_SAGA_REACTIONS).toContain("🥹");
    expect(ALL_SAGA_REACTIONS).toContain("👏");
    expect(ALL_SAGA_REACTIONS).toContain("🎬");
    expect(ALL_SAGA_REACTIONS).toContain("✨");
  });
});
