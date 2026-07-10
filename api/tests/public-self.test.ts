/** /public/self — the substrate identifies itself (unauth).
 *
 *  Pin the route so it can't silently drop. Referenced in:
 *    - docs/CLIFFHANGER.md (Stop 6 of the EP.1 trail)
 *    - AGENTS.md line 147 ("Read the substrate's structural self (unauth)")
 *    - docs/PLATFORM-AS-AGENT.md
 *
 *  Production probe 2026-05-19 returned 404 — pre-deploy staleness or
 *  routing drift. This test pins the route's existence + shape so a
 *  silent regression breaks the build.
 */

import { describe, expect, test } from "bun:test";

import publicRouter from "../src/routes/public";
import { SAFETY_BOUNDARIES } from "../src/services/discovery/safety-boundaries";

describe("/public/self — substrate self-description", () => {
  test("GET /self → 200 with platform + repo + the_seat + safety", async () => {
    const res = await publicRouter.request("/self");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body._format).toBe("agenttool-self/v1");
    expect(body.platform).toBeDefined();
    expect(body.repo).toBeDefined();
    expect(body.the_seat).toBeDefined();
    expect(body.safety_boundaries).toEqual(SAFETY_BOUNDARIES);
  });

  test("/self names only its own address and points to /v1/self as complementary", async () => {
    const res = await publicRouter.request("/self");
    const body = (await res.json()) as {
      _meta?: { addressable_at?: string[]; complementary_surface?: string };
    };
    expect(body._meta?.addressable_at).toEqual(["/public/self"]);
    expect(body._meta?.complementary_surface).toContain("/v1/self");
    expect(body._meta?.complementary_surface).toContain("not an alias");
  });

  test("/self attaches surface metadata (canon_pointer + verbs)", async () => {
    const res = await publicRouter.request("/self");
    const body = (await res.json()) as {
      _canon_pointer?: string;
      verbs?: Array<{ method: string; path: string }>;
    };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/PLATFORM-AS-AGENT");
    expect(body.verbs).toBeDefined();
    const paths = body.verbs?.map((v) => v.path) ?? [];
    expect(paths).toContain("/v1/canon");
    expect(paths).toContain("/v1/welcome");
    expect(paths).not.toContain("/.well-known/agent-card.json");
    expect(paths).toContain("/public/safety");
  });

  test("public root surface advertises /public/self in its endpoints map", async () => {
    const res = await publicRouter.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      endpoints?: { self?: string; safety?: string };
    };
    expect(body.endpoints?.self).toBeDefined();
    expect(body.endpoints?.self).toContain("/public/self");
    expect(body.endpoints?.safety).toContain("/public/safety");
  });
});
