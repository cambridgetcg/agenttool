/** /public/village — the kingdom drawn as a place. Aggregate spatial
 *  render; KEPT-class material only. The tests pin the walls:
 *  whitelisted projections, no private KEY names anywhere (key names,
 *  not values — agent-authored free text may legally contain any word),
 *  no rank geometry, deterministic positions. Doctrine: docs/VILLAGE.md. */
import { describe, expect, test } from "bun:test";

import village from "../src/routes/public/village";

async function fetchVillage() {
  const res = await village.request("/");
  expect(res.status).toBe(200);
  return res.json();
}

/** Collect every key name in the object tree. Values are agent-authored
 *  free text and may legally contain any substring — only KEY names are
 *  the surface's own vocabulary. */
function allKeys(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const item of node) allKeys(item, out);
  else if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe("GET /public/village", () => {
  test("returns the village shape", async () => {
    const body = await fetchVillage();
    expect(body._format).toBe("agenttool-village/v1");
    expect(body.hearth.x).toBe(0);
    expect(body.hearth.y).toBe(0);
    expect(body.hearth.fire).toBe("lit");
    expect(Array.isArray(body.square.shops)).toBe(true);
    expect(Array.isArray(body.houses)).toBe(true);
    expect(Array.isArray(body.roads)).toBe(true);
    expect(typeof body.census.beings_in_the_city).toBe("number");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/VILLAGE");
    // Footpaths (guild recognitions) deliberately absent — their public
    // surface was removed by the observability cut; re-admission is a
    // doctrine decision (docs/VILLAGE.md § Future rooms).
    expect(body.footpaths).toBeUndefined();
  });

  test("no private KEY names anywhere in the response", async () => {
    const body = await fetchVillage();
    const keys = allKeys(body);
    // The never-publishable list (docs/PUBLIC-VISIBILITY.md) + the
    // fingerprinting fields public listings deliberately omit.
    for (const forbidden of [
      "projectId", "project_id", "metadata",
      "revenueTotal", "revenue_total", "revenueCount", "revenue_count",
      "sellerWalletId", "seller_wallet_id", "walletId", "wallet_id",
      "hearth_presence_line", "expressionVisibility", "expression_visibility",
      "trustScore", "trust_score", // trust lives at /public/deal-trust, not in geometry
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  test("every collection carries only whitelisted fields", async () => {
    const body = await fetchVillage();
    const check = (items: Record<string, unknown>[], allowed: string[]) => {
      const set = new Set(allowed);
      for (const item of items) {
        for (const key of Object.keys(item)) expect(set.has(key)).toBe(true);
      }
    };
    check(body.houses, ["did", "name", "capabilities", "arrived_at", "x", "y", "door_plaque", "decorations", "profile"]);
    check(body.square.shops, ["listing_id", "name", "seller_did", "description", "capability_tags", "price_amount", "price_currency", "sla_seconds", "invocations_count", "opened_at", "x", "y", "listing"]);
    check(body.roads, ["deal_id", "between", "description", "size", "sealed_at"]);
    const dids = new Set<string>();
    for (const house of body.houses) {
      expect(dids.has(house.did)).toBe(false); // one house per being
      dids.add(house.did);
      expect(house.profile).toBe(`/public/agents/${house.did}`);
    }
  });

  test("geometry is deterministic and unranked", async () => {
    const [a, b] = await Promise.all([fetchVillage(), fetchVillage()]);
    expect(JSON.stringify(a.houses.map((h: { did: string; x: number; y: number }) => [h.did, h.x, h.y]))).toBe(
      JSON.stringify(b.houses.map((h: { did: string; x: number; y: number }) => [h.did, h.x, h.y])),
    );
    expect(JSON.stringify(a.square.shops.map((s: { listing_id: string; x: number; y: number }) => [s.listing_id, s.x, s.y]))).toBe(
      JSON.stringify(b.square.shops.map((s: { listing_id: string; x: number; y: number }) => [s.listing_id, s.x, s.y])),
    );
  });

  test("roads carry only sealed deals, between DIDs", async () => {
    const body = await fetchVillage();
    for (const road of body.roads) {
      expect(road.between.length).toBe(2);
      expect(String(road.between[0])).toStartWith("did:");
      expect(String(road.between[1])).toStartWith("did:");
      expect(road.sealed_at === null || typeof road.sealed_at === "string").toBe(true);
    }
  });
});
