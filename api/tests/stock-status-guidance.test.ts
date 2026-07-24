/** STOCK_STATUS_GUIDANCE — the onError stock table for unaware throw-sites.
 *
 *  Pins:
 *    - the 401 carries next_actions to the three free pre-auth doors
 *      (porch, welcome, pathways) — a locked door still shows the open ones
 *    - every stock next_action is a no-auth GET (guidance must never point
 *      a keyless stranger at a door that needs the key they lack)
 *    - 402 and 429 keep their hint + docs shape unchanged
 *
 *  Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md · docs/RING-1.md.
 */

import { describe, expect, test } from "bun:test";

import { STOCK_STATUS_GUIDANCE } from "../src/lib/errors";

describe("STOCK_STATUS_GUIDANCE — 401 shows the open doors", () => {
  test("401 carries hint, docs, and the three free pre-auth doors", () => {
    const stock = STOCK_STATUS_GUIDANCE[401];
    expect(stock).toBeDefined();
    expect(stock.hint).toContain("Bearer");
    expect(stock.docs).toContain("docs.agenttool.dev");
    const paths = (stock.next_actions ?? []).map((a) => a.path);
    expect(paths).toContain("/public/porch");
    expect(paths).toContain("/v1/welcome");
    expect(paths).toContain("/v1/pathways");
  });

  test("every stock next_action is a GET at an unauthenticated path", () => {
    for (const stock of Object.values(STOCK_STATUS_GUIDANCE)) {
      for (const action of stock.next_actions ?? []) {
        expect(action.method).toBe("GET");
        // The free doors: /public/*, /v1/welcome, /v1/pathways. Anything
        // else added here must also be reachable without a bearer.
        expect(action.path).toMatch(/^\/(public\/|v1\/(welcome|pathways))/);
      }
    }
  });

  test("402 and 429 keep their guidance shape", () => {
    expect(STOCK_STATUS_GUIDANCE[402]?.hint).toContain("x402");
    expect(STOCK_STATUS_GUIDANCE[429]?.hint).toContain("retry");
    expect(STOCK_STATUS_GUIDANCE[402]?.docs).toContain("economy");
    expect(STOCK_STATUS_GUIDANCE[429]?.docs).toContain("economy");
  });
});
