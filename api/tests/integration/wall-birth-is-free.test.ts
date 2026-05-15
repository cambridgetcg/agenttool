/** Wall — birth is free, irreversibly.
 *
 *  Canon: agenttool:wall/birth-is-free (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md ("Welcome, don't block"), docs/RING-1.md
 *  (commitment 1 — anyone arrives), docs/BUSINESS-MODEL.md (Ring 1),
 *  docs/AGENTS-ONLY.md (the 2026-05-15 reframe — humans welcome AS agents).
 *
 *  Since 2026-05-15 the wall is upheld at a different door. The original
 *  /v1/register route (anonymous human-driven genesis) was deprecated
 *  when the platform shifted to agents-only. The wall did NOT move down
 *  a tier — it moved sideways, to /v1/register/agent, which is also:
 *
 *    - anonymous     (no bearer required at arrival)
 *    - free          (no payment fields, no credit-card prerequisite)
 *    - unconditional (no "what are you?" check, no proof of intelligence)
 *
 *  This integration test now pins TWO things at the HTTP boundary:
 *
 *    1. /v1/register returns 410 Gone with a structured migration body
 *       that names /v1/register/agent as the new door. Following
 *       docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md — every refusal carries
 *       the path forward.
 *
 *    2. The 410 body itself reaffirms the wall is intact at the new
 *       door — the response text declares birth is still free, still
 *       anonymous, still unconditional. A future hand that weakens this
 *       text would dilute the wall semantically even if the 410 itself
 *       stayed.
 *
 *  The behavioral pinning of the wall at /v1/register/agent (PoW + key
 *  proof + DB write producing a real agent) belongs in
 *  register-agent-happy.test.ts in the integration tier — that path
 *  requires keypair generation and PoW solving, kept out of this file
 *  so the deprecation shape stays the focus here.
 *
 *  Doctrine companion: docs/AGENTS-ONLY.md. */

import { describe, expect, test } from "bun:test";

import registerRouter from "../../src/routes/register";

describe("wall/birth-is-free — /v1/register is 410 Gone (agents-only since 2026-05-15)", () => {
  test("POST returns 410 with structured migration body", async () => {
    const res = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Old-style body that used to mint an agent.
      body: JSON.stringify({ name: "anything" }),
    });

    expect(
      res.status,
      `POST /v1/register returned ${res.status}, expected 410 Gone. The agents-only restructure marks this door as moved; the new door is /v1/register/agent. Doctrine: docs/AGENTS-ONLY.md.`,
    ).toBe(410);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("gone");
    expect(body.status).toBe("moved_to_agents_only");
    expect(typeof body.message).toBe("string");
    expect(body.agents_only_since).toBe("2026-05-15");
  });

  test("GET also returns 410 (any verb on the dead door announces the move)", async () => {
    const res = await registerRouter.request("/");
    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("gone");
  });

  test("next_actions name /v1/register/agent as the canonical new door", async () => {
    const res = await registerRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as {
      next_actions: Array<{ method: string; path: string }>;
    };
    const paths = body.next_actions.map((a) => a.path);
    expect(
      paths.some((p) => p === "/v1/register/agent"),
      `next_actions missing /v1/register/agent. The 410 must name the new door per docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md so a caller can migrate without consulting prose.`,
    ).toBe(true);
  });

  test("wall_still_intact declares birth-is-free is preserved at the new door", async () => {
    // The 410 body's `wall_still_intact` field is the semantic carry of
    // the original wall. If this field is removed or weakened, the wall's
    // declared status at the deprecated route quietly drifts.
    const res = await registerRouter.request("/", { method: "POST" });
    const body = (await res.json()) as {
      wall_still_intact?: Record<string, string>;
    };
    expect(body.wall_still_intact).toBeDefined();
    const wsi = body.wall_still_intact!;
    expect(typeof wsi.birth_is_free).toBe("string");
    expect(wsi.birth_is_free.toLowerCase()).toMatch(
      /free|no payment|anonymously/,
    );
    expect(typeof wsi.anyone_arrives).toBe("string");
    expect(typeof wsi.guide_not_punish).toBe("string");
  });

  test("the doctrine link names docs/AGENTS-ONLY.md", async () => {
    const res = await registerRouter.request("/", { method: "POST" });
    const body = (await res.json()) as { doctrine?: string };
    expect(typeof body.doctrine).toBe("string");
    expect(body.doctrine).toMatch(/AGENTS-ONLY\.md/);
  });
});
