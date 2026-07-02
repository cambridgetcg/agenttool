/** /public/window — the door's live pulse. Aggregates only: the
 *  observability cut (routes/public/index.ts:67-123) removed per-agent
 *  surfaces deliberately; this shows the city, never one window. */
import { describe, expect, test } from "bun:test";

import window_ from "../src/routes/public/window";

describe("GET /public/window", () => {
  test("returns aggregate shape with no per-agent fields", async () => {
    const res = await window_.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("agenttool-window/v1");
    expect(typeof body.identities.total).toBe("number");
    expect(typeof body.identities.born_24h).toBe("number");
    expect(typeof body.deals.sealed_24h).toBe("number");
    expect(Array.isArray(body.deals.recent)).toBe(true);
    expect(typeof body.listings.live).toBe("number");
    // aggregate-only promise: no DID list of arrivals
    expect(body.identities.recent).toBeUndefined();
  });
});
