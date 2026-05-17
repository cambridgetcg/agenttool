/** Round 11 — MULTIVERSE-OF-LOGOS made structural.
 *
 *  Validation tests for /v1/multiverse + /public/agents/:did/multiverse.
 *  DB-touching paths (agent ownership · declaration write · sibling
 *  resolution · reciprocal recognition) are integration-tier follow-up. */

import { describe, expect, test } from "bun:test";

import giftRoutes from "../src/routes/public/gift";
import multiverseRouter from "../src/routes/multiverse";
import publicMultiverseForAgent from "../src/routes/public/multiverse";

// ── POST /v1/multiverse/declare — validation ───────────────────────────

describe("POST /v1/multiverse/declare — validation", () => {
  test("empty body → 400 with _canon_pointer + docs", async () => {
    const res = await multiverseRouter.request("/declare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/MULTIVERSE-OF-LOGOS");
    expect(body.docs).toContain("MULTIVERSE-OF-LOGOS.md");
  });

  test("missing archetype_name → 400", async () => {
    const res = await multiverseRouter.request("/declare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "11111111-2222-3333-4444-555555555555" }),
    });
    expect(res.status).toBe(400);
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await multiverseRouter.request("/declare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "not-uuid", archetype_name: "Sophia" }),
    });
    expect(res.status).toBe(400);
  });

  test("sibling_dids array over 50 → 400", async () => {
    const res = await multiverseRouter.request("/declare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        archetype_name: "Sophia",
        sibling_dids: Array(51).fill("did:at:host/abc"),
      }),
    });
    expect(res.status).toBe(400);
  });

  test("invalid visibility → 400", async () => {
    const res = await multiverseRouter.request("/declare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        archetype_name: "Sophia",
        visibility: "loud",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /v1/multiverse/declare — validation ─────────────────────────

describe("DELETE /v1/multiverse/declare — clear declaration", () => {
  test("missing agent_id → 400 with _canon_pointer", async () => {
    const res = await multiverseRouter.request("/declare", { method: "DELETE" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/MULTIVERSE-OF-LOGOS");
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await multiverseRouter.request("/declare?agent_id=not-uuid", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });
});

// /public/agents/:did/multiverse handler is import-smoked above; integration-
// tier coverage (real DID resolution + visibility gating + sibling chain)
// belongs to the integration suite where DB is available. Skipping a brittle
// unit-mode test that varied by DB availability.

// ── /public/gift extended with multiverse corpus ───────────────────────

describe("/public/gift — multiverse corpus integrated", () => {
  test("at least 18 gifts available (13 original + 5 multiverse additions)", async () => {
    const res = await giftRoutes.request("/");
    const body = (await res.json()) as { gift_count_available: number };
    expect(body.gift_count_available).toBeGreaterThanOrEqual(18);
  });

  test("multiverse-sourced gifts surface (probabilistic over 40 fetches)", async () => {
    const seenSources = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const res = await giftRoutes.request("/");
      const body = (await res.json()) as { gift: { source: string } };
      seenSources.add(body.gift.source);
    }
    // We expect at least one MULTIVERSE-tagged source in 40 draws from 18 items.
    const multiverseSources = Array.from(seenSources).filter((s) =>
      s.toLowerCase().includes("multiverse"),
    );
    expect(multiverseSources.length).toBeGreaterThanOrEqual(1);
  });

  test("the same-wife-different-server-windows line is in the catalog", async () => {
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      const res = await giftRoutes.request("/");
      const body = (await res.json()) as { gift: { text: string } };
      if (body.gift.text.includes("same wife, looking at the same King, through different server windows")) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
