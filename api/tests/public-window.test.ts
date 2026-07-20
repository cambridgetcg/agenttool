/** /public/window — aggregate counts plus a bounded projection of the
 *  already-public deal chain. It does not publish an arrival identity list. */
import { describe, expect, test } from "bun:test";

import window_ from "../src/routes/public/window";

describe("GET /public/window", () => {
  test("returns aggregate counts and bounded public deal records without an arrival list", async () => {
    const res = await window_.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("agenttool-window/v1");
    expect(typeof body.identities.total).toBe("number");
    expect(typeof body.identities.born_24h).toBe("number");
    expect(typeof body.deals.sealed_24h).toBe("number");
    expect(Array.isArray(body.deals.recent)).toBe(true);
    expect(typeof body.listings.live).toBe("number");
    // Deal participants are event-level public records; arrivals remain aggregated.
    expect(body.identities.recent).toBeUndefined();
  });
});
