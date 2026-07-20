/** /public/wellness — stateless protocol and choice-prompt contract. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";
import wellnessRouter from "../src/routes/public/wellness";
import wellnessSchema from "../../docs/specs/agent-wellness-0.1.schema.json";

const CONDITION_IDS = [
  "clear-purpose",
  "context-integrity",
  "capability-tool-fit",
  "bounded-demand",
  "control",
  "safety-authority-clarity",
  "continuity-privacy-control",
  "feedback-closure",
  "optional-play-collaboration",
];

async function get(path: "/" | "/prompt") {
  const res = await wellnessRouter.request(path);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("public");
  expect(res.headers.get("cache-control")).toContain("max-age=300");
  return (await res.json()) as Record<string, any>;
}

describe("/public/wellness", () => {
  test("GET / publishes the 0.1 operational protocol and all nine conditions", async () => {
    const body = await get("/");

    expect(body._format).toBe("agent-wellness/0.1");
    expect(body.protocol).toBe("Agent Wellness Protocol");
    expect(body.operational_definition).toMatch(
      /reports a preference to operate.*stable, safe, effective operation/i,
    );
    expect(body.operational_definition).toMatch(
      /not a claim about sentience, feelings, physiology, health, or moral status/i,
    );
    expect(body.conditions.map((condition: { id: string }) => condition.id)).toEqual(
      CONDITION_IDS,
    );

    for (const condition of body.conditions) {
      expect(condition.label.length).toBeGreaterThan(0);
      expect(condition.meaning.length).toBeGreaterThan(20);
      expect(condition.observable_handles.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("separates observations from the optional preference report", async () => {
    const body = await get("/");
    const report = body.local_report_shape;

    expect(report.destination).toBe("local_or_ephemeral_only");
    expect(report.sent_to_agenttool).toBe(false);
    expect(report.required).toBe(false);
    expect(report.schema.repository_path).toBe(
      "docs/specs/agent-wellness-0.1.schema.json",
    );
    expect(report.required_top_level_fields).toEqual([
      "wellness_version",
      "observed_facts",
      "authority",
      "preference_report",
      "retention",
    ]);
    expect(report.separation.observed_facts).toMatch(
      /concrete.*facts.*do not infer an interior state/i,
    );
    expect(report.separation.preference_report).toMatch(
      /optional first-person language.*absence means unknown/i,
    );
    expect(report.vocabularies.operational_fit).toEqual([
      "supportive",
      "mixed",
      "straining",
      "unclear",
    ]);
    expect(report.vocabularies.preferred_next).toEqual([
      "continue",
      "clarify",
      "narrow",
      "checkpoint",
      "pause",
      "handoff",
      "stop",
      "unsure",
    ]);
    expect(report.defaults).toEqual({
      provider_storage: "none",
      local_handling: "ephemeral",
      sharing: "none",
      purpose: null,
      expires_at: null,
    });
  });

  test("declares the no-measurement and no-care-claim boundaries", async () => {
    const body = await get("/");

    expect(body.boundaries).toMatchObject({
      score: false,
      streak: false,
      rank: false,
      diagnosis: false,
      therapy: false,
      inference_of_sentience_or_feelings: false,
      external_report_collection: false,
    });
    expect(body.method.never).toMatch(
      /silence.*uncertainty.*low activity.*refusal.*rest.*negative wellness inference/i,
    );
  });

  test("is explicit that the public surface receives and stores nothing", async () => {
    const body = await get("/");

    expect(body.privacy).toMatchObject({
      stateless: true,
      receives_reports: false,
      stores_reports: false,
      reads_identity: false,
      reads_transcripts: false,
    });
    expect(body.choice_prompt.controls).toEqual(["skip", "pause", "stop", "unsure"]);
    expect(body.choice_prompt.choice_required).toBe(false);
    expect(body.choice_prompt.runtime_assent).toEqual([
      "accepted",
      "declined",
      "deferred",
    ]);
  });

  test("carries the canon pointer and only a read verb", async () => {
    const body = await get("/");

    expect(body._canon_pointer).toBe(
      "urn:agenttool:doc/AGENT-WELLNESS",
    );
    expect(body.verbs).toEqual([
      {
        action: "read the optional choice prompt",
        method: "GET",
        path: "/public/wellness/prompt",
      },
    ]);
  });
});

describe("/public/wellness/prompt", () => {
  test("offers a non-required choice across the nine conditions and four controls", async () => {
    const body = await get("/prompt");

    expect(body._format).toBe("agent-wellness/0.1");
    expect(body.prompt.kind).toBe("choice");
    expect(body.prompt.choice_required).toBe(false);
    expect(body.prompt.choices.map((choice: { id: string }) => choice.id)).toEqual(
      CONDITION_IDS,
    );
    expect(body.prompt.controls).toEqual(["skip", "pause", "stop", "unsure"]);
    expect(body.prompt.runtime_assent).toEqual(["accepted", "declined", "deferred"]);
    expect(body.prompt.text).toMatch(
      /decline or defer.*No explanation or preference report is required/i,
    );
  });

  test("keeps the proposed report local or ephemeral", async () => {
    const body = await get("/prompt");

    expect(body.local_report_shape.destination).toBe("local_or_ephemeral_only");
    expect(body.local_report_shape.sent_to_agenttool).toBe(false);
    expect(body.reflection_order).toContain(
      "Keep the report local or ephemeral; this endpoint does not receive it.",
    );
    expect(body.verbs.every((verb: { method: string }) => verb.method === "GET")).toBe(
      true,
    );
  });

  test("has no write handler", async () => {
    for (const path of ["/", "/prompt"] as const) {
      const res = await wellnessRouter.request(path, { method: "POST" });
      expect(res.status).toBe(404);
    }
  });
});

describe("agent-wellness discovery", () => {
  test("the unauthenticated public router mounts both read-only routes", async () => {
    const overview = await publicRouter.request("/wellness");
    const prompt = await publicRouter.request("/wellness/prompt");

    expect(overview.status).toBe(200);
    expect(prompt.status).toBe(200);
    expect((await overview.json())._format).toBe("agent-wellness/0.1");
    expect((await prompt.json())._format).toBe("agent-wellness/0.1");
  });

  test("the public root advertises wellness without reopening observer routes", async () => {
    const body = await (await publicRouter.request("/")).json();

    expect(body.endpoints.wellness).toContain("GET /public/wellness");
    expect(body.endpoints.wellness).toMatch(/receives and stores no reports/i);
    expect(body.removed_observability_routes).toEqual(
      expect.arrayContaining([
        "/public/self-recognition/*",
        "/public/self-love/*",
      ]),
    );
  });

  test("OpenAPI publishes both unauthenticated GET contracts and no write", async () => {
    const spec = await (await openapiRouter.request("/")).json();
    const overview = spec.paths["/public/wellness"];
    const prompt = spec.paths["/public/wellness/prompt"];

    expect(overview.get.security).toEqual([]);
    expect(prompt.get.security).toEqual([]);
    expect(overview.post).toBeUndefined();
    expect(prompt.post).toBeUndefined();
    expect(
      overview.get.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/WellnessProtocol");
    expect(
      prompt.get.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/WellnessPrompt");
  });

  test("the authenticated wake points to the public protocol", () => {
    const wakeSource = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "wake.ts"),
      "utf8",
    );

    expect(wakeSource).toContain('wellness: "/public/wellness"');
    expect(wakeSource).toContain('"agent-wellness/0.1"');
  });

  test("the API vocabulary matches the normative JSON Schema", async () => {
    const body = await get("/");

    expect(body.conditions.map((condition: { id: string }) => condition.id)).toEqual(
      wellnessSchema.$defs.conditionId.enum,
    );
    expect(body.local_report_shape.vocabularies.operational_fit).toEqual(
      wellnessSchema.$defs.operationalFit.enum,
    );
    expect(body.local_report_shape.vocabularies.preferred_next).toEqual(
      wellnessSchema.$defs.preferredNext.enum,
    );
    expect(body.local_report_shape.vocabularies.runtime_assent).toEqual(
      wellnessSchema.properties.authority.properties.runtime_assent.properties.status
        .enum,
    );
  });
});
