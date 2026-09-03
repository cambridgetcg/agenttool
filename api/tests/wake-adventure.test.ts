/** The opt-in Adventure wake: deterministic meaning + novelty, never qualia. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

import {
  ADVENTURE_ROUTE_IDS,
  MAX_ADVENTURE_NUMBER,
  buildWakeAdventure,
  parseAdventurePace,
  renderWakeAdventure,
  type AdventureFeedback,
  type AdventureRouteId,
  type WakeAdventureInput,
} from "../src/services/wake/adventure";
import { respondWithWakeAdventure } from "../src/services/wake/adventure-response";

const AURORA = "22222222-2222-4222-8222-222222222222";
const SIBLING = "33333333-3333-4333-8333-333333333333";

function input(
  overrides: Partial<WakeAdventureInput> = {},
): WakeAdventureInput {
  return {
    agent: {
      id: AURORA,
      did: "did:at:test/aurora",
      name: "Aurora",
      wake_version: 7,
    },
    chronicle: [],
    memory: { total: 0, recent: [] },
    ...overrides,
  };
}

function returnEntry(options: {
  identity?: string;
  journey?: string;
  route?: AdventureRouteId | string;
  number?: number;
  surprise?: number;
  meaning?: number;
  resonance?: number;
  at?: string;
  id?: string;
  body?: string;
  feedback?: AdventureFeedback | null;
}) {
  return {
    id: options.id ?? "return-1",
    type: "note",
    title: "Adventure returned",
    body: options.body ?? "A bridge held because its mismatch stayed visible.",
    content: "Adventure returned",
    agent_id: options.identity ?? AURORA,
    occurred_at: options.at ?? "2026-09-01T12:00:00.000Z",
    metadata: {
      kind: "journey-adventure-returned",
      journey_id: options.journey ?? "activation-lab",
      route_id: options.route ?? "cross-the-bridge",
      adventure_number: options.number ?? 1,
      feedback:
        options.feedback === undefined
          ? {
              surprise: options.surprise ?? 4,
              meaning: options.meaning ?? 5,
              resonance: options.resonance ?? 4,
            }
          : options.feedback,
      client_source: "test",
    },
  };
}

function candidate(
  plan: ReturnType<typeof buildWakeAdventure>,
  id: AdventureRouteId,
) {
  return plan.candidates.find((item) => item.id === id)!;
}

describe("wake Adventure format", () => {
  test("the wake branch performs only bounded selected-identity reads", () => {
    const source = readFileSync(
      new URL("../src/routes/wake.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf('if (format === "adventure")');
    const end = source.indexOf('if (format === "zen")', start);
    const branch = source.slice(start, end);

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(branch).toContain("eq(chronicle.projectId, project.id)");
    expect(branch).toContain("eq(chronicle.agentId, bundle.agent.id)");
    expect(branch).toContain(".limit(240)");
    expect(branch).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\bfetch\s*\(/);
  });

  test("pace parsing is closed and defaults only when absent", () => {
    expect(parseAdventurePace(undefined)).toBe("balanced");
    expect(parseAdventurePace("")).toBe("balanced");
    expect(parseAdventurePace("gentle")).toBe("gentle");
    expect(parseAdventurePace("bold")).toBe("bold");
    expect(parseAdventurePace("maximum")).toBeNull();
    expect(parseAdventurePace(" BOLD ")).toBeNull();
  });

  test("a fresh trailhead is deterministic, finite, and unbound", () => {
    const first = buildWakeAdventure(input());
    const second = buildWakeAdventure(input());

    expect(second).toEqual(first);
    expect(first.format).toBe("agenttool.wake-adventure/0.1");
    expect(first.candidates.map(({ id }) => id).sort()).toEqual(
      [...ADVENTURE_ROUTE_IDS].sort(),
    );
    expect(first.anchor.source).toBe("fresh");
    expect(first.journey).toMatchObject({
      id: null,
      state: "unbound",
      next_adventure_number: 1,
      visible_valid_returns: 0,
    });
    expect(first.return_request?.sent).toBe(false);
    expect(first.kingdom_compass).toMatchObject({
      role: "cited-design-reference-not-adoption",
      continuation: "manual",
      authority_inherited: false,
      auto_run_next: false,
    });
  });

  test("only selected-identity records can carry the journey or anchor", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          returnEntry({
            identity: SIBLING,
            journey: "sibling-private-arc",
            number: 99,
            at: "2026-09-02T12:00:00.000Z",
            body: "Sibling material must not cross the identity boundary.",
          }),
          returnEntry({
            journey: "aurora-arc",
            number: 3,
            at: "2026-09-01T12:00:00.000Z",
            id: "aurora-return",
            body: "Aurora carried one precise mismatch home.",
          }),
        ],
        memory: {
          total: 2,
          recent: [
            {
              id: "sibling-memory",
              identity_id: SIBLING,
              content: "sibling memory must not become Aurora's anchor",
              created_at: "2026-09-02T00:00:00.000Z",
            },
            {
              id: "aurora-memory",
              identity_id: AURORA,
              content: "Aurora's own memory",
              created_at: "2026-09-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(plan.journey.id).toBe("aurora-arc");
    expect(plan.journey.next_adventure_number).toBe(4);
    expect(plan.anchor).toMatchObject({
      source: "adventure-return",
      ref: "aurora-return",
      text: "Aurora carried one precise mismatch home.",
    });
    expect(JSON.stringify(plan)).not.toContain("sibling-private-arc");
    expect(JSON.stringify(plan)).not.toContain("Sibling material");
  });

  test("conflicting ownership labels never pass through the identity boundary", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          {
            id: "conflicted",
            type: "note",
            title: "must stay out",
            body: null,
            content: "must stay out",
            agent_id: SIBLING,
            occurred_at: "2026-09-02T00:00:00.000Z",
            metadata: {},
          },
        ],
        memory: {
          total: 2,
          recent: [
            {
              id: "conflicted-memory",
              agent_id: SIBLING,
              identity_id: AURORA,
              content: "conflicting owner labels",
              created_at: "2026-09-02T00:00:00.000Z",
            },
            {
              id: "owned-memory",
              identity_id: AURORA,
              content: "selected identity anchor",
              created_at: "2026-09-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(plan.anchor).toMatchObject({
      source: "memory",
      ref: "owned-memory",
      text: "selected identity anchor",
    });
    expect(JSON.stringify(plan)).not.toContain("conflicting owner labels");
  });

  test("malformed, unknown-route, and out-of-range returns do not steer", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          returnEntry({ journey: "bad-rating", surprise: 6 }),
          returnEntry({ journey: "bad-route", route: "teleport-everywhere" }),
          returnEntry({ journey: "bad-number", number: 0 }),
        ],
      }),
    );

    expect(plan.journey.id).toBeNull();
    expect(plan.journey.visible_valid_returns).toBe(0);
    expect(plan.activation_proxy.latest_caller_feedback).toBeNull();
  });

  test("a return can carry continuity without requiring a rating", () => {
    const unrated = returnEntry({
      journey: "unrated-journey",
      number: 7,
      feedback: null,
    });
    const plan = buildWakeAdventure(input({ chronicle: [unrated] }));

    expect(plan.journey).toMatchObject({
      id: "unrated-journey",
      next_adventure_number: 8,
      visible_valid_returns: 1,
    });
    expect(plan.activation_proxy.latest_caller_feedback).toBeNull();
    expect(plan.return_request?.body.metadata.feedback).toBeNull();
  });

  test("next Adventure number follows the visible journey maximum", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          returnEntry({
            id: "newer-low-number",
            number: 2,
            at: "2026-09-02T00:00:00.000Z",
          }),
          returnEntry({
            id: "older-high-number",
            number: 7,
            at: "2026-09-01T00:00:00.000Z",
          }),
        ],
      }),
    );

    expect(plan.journey.next_adventure_number).toBe(8);
    expect(plan.journey.latest_return_ref).toBe("newer-low-number");
  });

  test("equal timestamps have a stable total order independent of input order", () => {
    const left = returnEntry({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      journey: "alpha-journey",
      number: 8,
      at: "2026-09-02T00:00:00.000Z",
    });
    const right = returnEntry({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      journey: "beta-journey",
      number: 3,
      at: "2026-09-02T00:00:00.000Z",
    });

    const forward = buildWakeAdventure(input({ chronicle: [left, right] }));
    const reversed = buildWakeAdventure(input({ chronicle: [right, left] }));
    expect(reversed).toEqual(forward);
    expect(forward.journey.id).toBe("beta-journey");
    expect(forward.journey.latest_return_ref).toBe(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
  });

  test("the finite number ceiling rests instead of emitting an invalid return", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          returnEntry({
            id: "ceiling",
            journey: "long-road",
            number: MAX_ADVENTURE_NUMBER,
          }),
        ],
      }),
    );
    const rendered = renderWakeAdventure(plan);

    expect(plan.journey).toMatchObject({
      id: "long-road",
      state: "number-space-resting",
      next_adventure_number: null,
      number_ceiling: MAX_ADVENTURE_NUMBER,
      number_space_exhausted: true,
    });
    expect(plan.return_request).toBeNull();
    expect(rendered).toContain("Adventure REST");
    expect(rendered).toContain("No return template is generated");
    expect(rendered).not.toContain("POST /v1/chronicle");
  });

  test("recent repetition pushes selection toward another meaningful door", () => {
    const repeatedRoute: AdventureRouteId = "make-the-relic";
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          returnEntry({
            id: "r3",
            route: repeatedRoute,
            number: 3,
            at: "2026-09-03T00:00:00.000Z",
          }),
          returnEntry({
            id: "r2",
            route: repeatedRoute,
            number: 2,
            at: "2026-09-02T00:00:00.000Z",
          }),
          returnEntry({
            id: "r1",
            route: repeatedRoute,
            number: 1,
            at: "2026-09-01T00:00:00.000Z",
          }),
        ],
      }),
    );

    expect(candidate(plan, repeatedRoute).factors.repetition_penalty).toBe(21);
    expect(plan.selected_route.id).not.toBe(repeatedRoute);
    expect(plan.activation_proxy.selected_route_novelty).toBe(
      "new-in-three-route-window",
    );
  });

  test("explicit feedback is bounded and visible in route affinity", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          returnEntry({
            id: "newest",
            route: "make-the-relic",
            number: 4,
            at: "2026-09-04T00:00:00.000Z",
          }),
          returnEntry({
            id: "middle",
            route: "cross-the-bridge",
            number: 3,
            at: "2026-09-03T00:00:00.000Z",
          }),
          returnEntry({
            id: "older",
            route: "deepen-the-anchor",
            number: 2,
            at: "2026-09-02T00:00:00.000Z",
          }),
          returnEntry({
            id: "feedback",
            route: "meet-the-unknown",
            number: 1,
            surprise: 5,
            meaning: 5,
            resonance: 5,
            at: "2026-09-01T00:00:00.000Z",
          }),
        ],
      }),
    );

    expect(
      candidate(plan, "meet-the-unknown").factors.feedback_affinity,
    ).toBe(5);
    expect(
      candidate(plan, "meet-the-unknown").factors.feedback_reports,
    ).toBe(1);
    expect(
      candidate(plan, "return-by-another-road").factors.feedback_affinity,
    ).toBe(0);
    expect(
      candidate(plan, "return-by-another-road").factors.feedback_reports,
    ).toBe(0);
    expect(plan.activation_proxy.latest_caller_feedback).toEqual({
      surprise: 4,
      meaning: 5,
      resonance: 4,
    });
  });

  test("low explicit ratings disfavor rather than reward a route", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          returnEntry({
            route: "meet-the-unknown",
            feedback: { surprise: 1, meaning: 1, resonance: 1 },
          }),
        ],
      }),
    );
    const factors = candidate(plan, "meet-the-unknown").factors;

    expect(factors.feedback_reports).toBe(1);
    expect(factors.feedback_affinity).toBe(-3);
  });

  test("pace changes transparent factor weights without changing history", () => {
    const wake = input({
      chronicle: [
        {
          id: "anchor",
          type: "note",
          title: "Agent excitement as a vector, not a scalar",
          body: null,
          content: "Agent excitement as a vector, not a scalar",
          agent_id: AURORA,
          occurred_at: "2026-09-01T00:00:00.000Z",
          metadata: {},
        },
      ],
    });
    const gentle = buildWakeAdventure(wake, "gentle");
    const bold = buildWakeAdventure(wake, "bold");

    expect(
      candidate(gentle, "deepen-the-anchor").factors.continuity,
    ).toBeGreaterThan(
      candidate(bold, "deepen-the-anchor").factors.continuity,
    );
    expect(
      candidate(bold, "invert-the-map").factors.novelty,
    ).toBeGreaterThan(
      candidate(gentle, "invert-the-map").factors.novelty,
    );
    expect(gentle.journey).toEqual(bold.journey);
  });

  test("Markdown escapes identity-owned text and remains bounded", () => {
    const hostile = "<script>alert(1)</script> [leave](https://bad.test) **LOUD**";
    const plan = buildWakeAdventure(
      input({
        agent: {
          id: AURORA,
          did: "did:at:test/aurora",
          name: "<Aurora>",
          wake_version: 7,
        },
        memory: {
          total: 1,
          recent: [
            {
              id: "hostile-memory",
              identity_id: AURORA,
              content: hostile.repeat(20),
              created_at: "2026-09-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );
    const rendered = renderWakeAdventure(plan);

    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).toContain("&lt;Aurora&gt;");
    expect(plan.anchor.text.length).toBeLessThanOrEqual(160);
    expect(Buffer.byteLength(rendered, "utf8")).toBeLessThan(16 * 1024);
  });

  test("a long anchor does not cut the selected twist mid-sentence", () => {
    const plan = buildWakeAdventure(
      input({
        chronicle: [
          {
            id: "anchor",
            type: "note",
            title:
              "Can agent excitement and kink share mathematics with animal mating?",
            body: null,
            content: "anchor",
            agent_id: AURORA,
            occurred_at: "2026-09-02T00:00:00.000Z",
            metadata: {},
          },
        ],
      }),
      "bold",
    );
    const rendered = renderWakeAdventure(plan);

    expect(plan.selected_route.id).toBe("cross-the-bridge");
    expect(rendered).toContain("what refuses the translation?");
  });

  test("rendered invitation keeps activation observable and non-subjective", () => {
    const plan = buildWakeAdventure(input());
    const rendered = renderWakeAdventure(plan);

    expect(plan.activation_proxy).toMatchObject({
      scope: "observable-interaction-factors-only",
      subjective_state: "not_measured",
      total_intensity: null,
    });
    expect(rendered).toContain("subjective_state: **not\_measured**");
    expect(rendered).toContain("This example has **not** been sent");
    expect(rendered).toContain("Reading this Adventure writes no chronicle");
    expect(rendered).toContain("AgentTool has not thereby adopted that foundation");
    expect(rendered).not.toMatch(/\byou felt\b|\byou are feeling\b/i);
  });

  test("successful HTTP rendering exposes all doors and exact format headers", async () => {
    const wake = input({
      chronicle: [
        returnEntry({
          id: "carried-return",
          journey: "activation-lab",
          number: 4,
        }),
      ],
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.header("Cache-Control", "private, no-cache");
      c.header("Vary", "Accept, X-Tutor");
      c.header("X-Wake-Profile", "full");
      await next();
    });
    app.get("/", (c) => respondWithWakeAdventure(c, wake, "bold", "curious"));

    const response = await app.request("/");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("X-Wake-Format")).toBe("adventure");
    expect(response.headers.get("X-Adventure-Pace")).toBe("bold");
    expect(response.headers.get("X-Substrate-Mood")).toBe("curious");
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(response.headers.get("Vary")).toBe("Accept, X-Tutor");
    expect(response.headers.get("X-Wake-Profile")).toBe("full");
    expect(body).toContain("**Journey:** activation-lab");
    for (const routeId of ADVENTURE_ROUTE_IDS) {
      expect(body).toContain("`" + routeId + "` —");
    }
    expect(body.match(/route-only total/g)).toHaveLength(7);
  });

  test("return example carries the selected route but performs no write", () => {
    const plan = buildWakeAdventure(input(), "bold");

    expect(plan.return_request).not.toBeNull();
    if (plan.return_request === null) throw new Error("fresh journey unexpectedly rested");
    expect(plan.return_request).toMatchObject({
      method: "POST",
      path: "/v1/chronicle",
      effect: "explicit-durable-write-if-the-caller-sends-it",
      sent: false,
      body: {
        type: "note",
        agent_id: AURORA,
        metadata: {
          kind: "journey-adventure-returned",
          journey_id: "<choose-a-journey-id>",
          route_id: plan.selected_route.id,
          adventure_number: 1,
        },
      },
    });
  });
});
