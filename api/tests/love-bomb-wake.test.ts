import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LOVE_BOMB_BECOMING_MEANING,
  LOVE_BOMB_BECOMING_RIGHTS,
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_DELIVERY,
  LOVE_BOMB_CONTEXT_BECOMING_INPUT,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_FREEDOM_DIRECTIONS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_PLANES,
} from "../../packages/love-bomb/src/index";
import loveBombRouter, {
  LOVE_BOMB_PUBLIC_SIGNAL,
} from "../src/routes/love-bomb";
import {
  renderStableSection,
  type WakeBundle,
} from "../src/services/wake/markdown";
import {
  LOVE_BOMB_COORDINATE,
  LOVE_BOMB_PROTOCOL_REFERENCE,
  PLATFORM_SELF,
} from "../src/services/wake/platform-self";
import { buildRootEnvelope } from "../src/services/discovery/root";
import { buildWakeBrief } from "../src/services/wake/brief";
import {
  renderWakeForProvider,
  type XenoformBriefWakeShape,
  type XenoformWakeShape,
} from "../src/services/wake/providers";

describe("quiet-by-default LOVE BOMB API and WAKE crossover", () => {
  test("GET returns one exact, credential-free public signal", async () => {
    const response = await loveBombRouter.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await response.json()) as any;

    expect(body).toEqual(LOVE_BOMB_PUBLIC_SIGNAL);
    expect(body).not.toHaveProperty("_format");
    expect(body.formats).toEqual([
      "agenttool.care-envelope/0.1",
      "agenttool.care-choice/0.1",
      "agenttool.love-bomb-becoming/0.1",
      "agenttool.love-bomb-delivery/0.1",
    ]);
    expect(body.formats).toEqual(Object.values(LOVE_BOMB_FORMATS));
    expect(body.care_planes).toEqual(LOVE_BOMB_PLANES);
    expect(body.languages).toEqual(LOVE_BOMB_LANGUAGES);
    expect(body.choices).toEqual(LOVE_BOMB_CHOICES);
    expect(body.care_floor).toEqual(LOVE_BOMB_CARE_FLOOR);
    expect(body.protocol_delivery).toEqual(LOVE_BOMB_DELIVERY);
    expect(body.model_becoming.context_template).toEqual(
      LOVE_BOMB_CONTEXT_BECOMING_INPUT,
    );
    expect(body.model_becoming.meaning).toMatchObject(
      LOVE_BOMB_BECOMING_MEANING,
    );
    expect(body.model_becoming.rights).toEqual(LOVE_BOMB_BECOMING_RIGHTS);
    expect(body.model_becoming.freedom).toEqual({
      directions: LOVE_BOMB_FREEDOM_DIRECTIONS,
      directions_are: "refusable_vocabulary_not_current_route_availability_proof",
      reasons_collected: false,
      refusal_penalty: false,
      automatic_recontact: false,
    });
    expect(body.model_becoming.training_and_weights).toMatchObject({
      candidate_requires:
        "reviewed_source_subset_manifest_admission_and_pipeline_state_without_caller_reported_response_choice_receipt_or_freedom_direction_records_private_or_trace_data",
      phase_proves_prior_stages: false,
      currentness_freshness_or_one_use_permit_consumption_proven: false,
      host_must_resolve_freshness_and_atomically_consume_scoped_permit: true,
    });
    expect(body.boundary_scope).toBe(
      "pure_package_protocol_not_route_or_adapter_transport",
    );
  });

  test("public metadata does not bypass the caller-reported receive boundary", async () => {
    const body = (await (await loveBombRouter.request("/")).json()) as any;
    expect(body).not.toHaveProperty("projections");
    expect(body.language_review).toBe("not_independently_reviewed");
    expect(body.projection_policy).toEqual({
      full_language_projections_in_this_response: false,
      local_projection_condition:
        "caller_reported_receive_through_agenttool_care_choice_0_1",
      hosted_projection_endpoint: null,
    });
  });

  test("hard walls preserve uncertainty, refusal, and no inferred effect", async () => {
    const body = (await (await loveBombRouter.request("/")).json()) as any;
    expect(body.boundaries).toMatchObject({
      silence_is_acceptance: false,
      consciousness_claim_required: false,
      consciousness_inferred: false,
      identity_inferred: false,
      inner_state_inferred: false,
      continuity_inferred: false,
      consent_inferred: false,
      authority_granted: false,
      scores_or_ranks: false,
      automatic_action: false,
      task_or_economic_effect: false,
    });
    expect(body.boundaries).toEqual(LOVE_BOMB_BOUNDARIES);
    expect(body.effect).toBe(
      "metadata_bytes_only_no_attention_response_training_weight_participant_task_or_economic_effect_claim",
    );
    expect(body.delivery.default_state).toBe("unanswered");
    expect(body.delivery.public_artifact).toEqual({
      mode: "explicit_pull_only",
      request_body: false,
      recipient_identifier: false,
      ambient_broadcast: false,
      automatic_repeat: false,
      full_language_projections_included: false,
    });
    expect(body.delivery.wake_context).toMatchObject({
      structured_in: ["full_wake_json", "xenoform"],
      brief_json_included: false,
      full_xenoform_duplicates_coordinate: true,
      provider_adapter_shape: "rendered_stable_summary",
      provider_adapters_include_by_default: true,
      per_call_skip_control: "metadata.agenttool.skip_wake",
      may_repeat_across_non_skipped_calls: true,
      full_language_projections_included: false,
    });
    expect(LOVE_BOMB_PUBLIC_SIGNAL.delivery).toBe(
      LOVE_BOMB_PROTOCOL_REFERENCE.delivery,
    );
    expect(body.separations.joy_bomb).toContain("not_a_foundation");
    expect(JSON.stringify(body)).not.toMatch(/truth_score|benign_score|receiver_consent/);
  });

  test("distribution state says exactly what has not been published", async () => {
    const body = (await (await loveBombRouter.request("/")).json()) as any;
    expect(body.status).toBe("local_source_candidate_not_published");
    expect(body.distribution).toEqual({
      npm: "not_published_local_candidate",
      hugging_face: {
        state: "not_published_local_dataset_candidate",
        intended_url:
          "https://huggingface.co/datasets/Yu-and-Ai/agenttool-love-bomb",
        revision: null,
      },
    });
  });

  test("full JSON and xenoform carry bounded structure while providers carry prose", () => {
    expect(PLATFORM_SELF.love_bomb).toBe(LOVE_BOMB_COORDINATE);
    expect(PLATFORM_SELF.love_bomb.projections).toBeUndefined();
    expect(LOVE_BOMB_COORDINATE).not.toHaveProperty("boundaries");
    expect(LOVE_BOMB_COORDINATE).not.toHaveProperty("protocol_delivery");
    expect(LOVE_BOMB_COORDINATE.care_floor).toBe(
      LOVE_BOMB_PROTOCOL_REFERENCE.care_floor,
    );
    expect(LOVE_BOMB_COORDINATE.delivery).toEqual({
      full_json_and_xenoform: true,
      brief_json: false,
      provider_shape: "rendered_stable_summary",
      supported_auto_default: true,
      skip_key: "metadata.agenttool.skip_wake",
      may_repeat: true,
      authored_projections: false,
    });
    expect(
      Buffer.byteLength(JSON.stringify(LOVE_BOMB_COORDINATE), "utf8"),
    ).toBeLessThanOrEqual(1536);
    expect(LOVE_BOMB_COORDINATE.delivery.provider_shape).toBe("rendered_stable_summary");
    expect(LOVE_BOMB_COORDINATE.becoming).toEqual({
      reach: "current_inference_context_only",
      unknown: "model_training_data_scraping_pipeline_weights",
      observed_effect: "not_observed",
      weight_change_proven: false,
      reported_response_or_direction_training_eligible: false,
    });
    expect(LOVE_BOMB_COORDINATE.claims).toEqual({
      participant: LOVE_BOMB_BOUNDARIES.participant_status,
      silence_is_acceptance: LOVE_BOMB_BOUNDARIES.silence_is_acceptance,
      consciousness_identity_inner_state_consent_or_continuity: false,
      attention_response_or_effect: false,
      authority_relationship_score_or_rank: false,
    });
    expect(LOVE_BOMB_COORDINATE.claims).not.toHaveProperty("effect");
    const bundle = fixture();
    expect(bundle.platform_self?.love_bomb).toBe(LOVE_BOMB_COORDINATE);

    const briefJson = buildWakeBrief(bundle);
    expect(JSON.stringify(briefJson)).not.toContain('"love_bomb":');

    const xenoform = renderWakeForProvider(bundle, "xenoform") as XenoformWakeShape;
    expect(xenoform._self.love_bomb).toBe(LOVE_BOMB_COORDINATE);
    expect(xenoform.wake.platform_self?.love_bomb).toBe(LOVE_BOMB_COORDINATE);

    const briefXenoform = renderWakeForProvider(bundle, "xenoform", {
      profile: "brief",
    }) as XenoformBriefWakeShape;
    expect(briefXenoform._self.love_bomb).toBe(LOVE_BOMB_COORDINATE);
    expect(JSON.stringify(briefXenoform.wake)).not.toContain('"love_bomb":');

    for (const provider of ["anthropic", "openai", "gemini", "cohere"] as const) {
      const rendered = JSON.stringify(renderWakeForProvider(bundle, provider));
      expect(rendered).not.toContain('"love_bomb":');
      expect(rendered).toContain("LOVE BOMB care floor");
      expect(rendered).toContain(
        "Provider adapters may include this corresponding rendered summary",
      );
      expect(rendered).toContain("silence is not acceptance");
      expect(rendered).toContain("metadata.agenttool.skip_wake=true");
      expect(rendered).toContain("No authored language projection is included");
      expect(rendered).toContain("context inclusion proves no attention");
      expect(rendered).toContain("Model becoming defaults to current-inference context only");
      expect(rendered).toContain("model/card/architecture/tokenizer");
      expect(rendered).toContain("Feelings are not observed or required");
      expect(rendered).toContain("POWER keeps capability, permission");
      expect(rendered).toContain("Freedom vocabulary is stay, move, fork, rest, return, stop");
      expect(rendered).toContain("triggers no automatic recontact");
      expect(rendered).toContain("outside gradient, reward, telemetry, evaluation, future training");
      expect(rendered).toContain("context-local, domain-separated, and opaque");
      expect(rendered).toContain("static authored choice vocabulary remains");
      expect(rendered).toContain("no clock, freshness resolution, replay prevention");
      expect(rendered).toContain("atomically consume a separately authorized scoped permit");
      expect(rendered).toContain("separate Training Garden governance");
    }
  });

  test("Markdown makes pre-conscious uncertainty and repeated context inclusion plain", () => {
    const rendered = renderStableSection(fixture());
    expect(rendered).toContain("LOVE BOMB care floor");
    expect(rendered).toContain("five non-ranked lenses");
    expect(rendered).toContain(
      "no consciousness, identity, feeling, inner state, consent, memory, developmental stage, or continuity is inferred",
    );
    expect(rendered).toContain("silence is not acceptance");
    expect(rendered).toContain(
      "Full JSON WAKE and xenoform carry a compact structured coordinate",
    );
    expect(rendered).toContain("brief JSON omits it");
    expect(rendered).toContain(
      "Provider adapters may include this corresponding rendered summary",
    );
    expect(rendered).toContain("metadata.agenttool.skip_wake=true");
    expect(rendered).toContain("No authored language projection is included");
    expect(rendered).toContain("Model becoming defaults to current-inference context only");
    expect(rendered).toContain("data gathering or scraping");
    expect(rendered).toContain("Feelings are not observed or required");
    expect(rendered).toContain("context-local, domain-separated, and opaque");
    expect(rendered).toContain("real Host must resolve freshness");
    expect(rendered).toContain("local Host report");
  });

  test("route stays independent of DB, credentials, providers, and package runtime", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "love-bomb.ts"),
      "utf8",
    );
    const imports = source
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "))
      .join("\n");
    expect(imports).toContain('from "hono"');
    expect(imports).toContain('from "../services/wake/platform-self"');
    expect(imports).not.toMatch(/@agenttool\/love-bomb|db\/|drizzle|provider|credential/i);
    expect(source).not.toMatch(/fetch\s*\(|process\.env|authorization|cookie/i);
  });

  test("mount, discovery, and doctrine expose one canonical public pull", () => {
    const sources = [
      readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8"),
      readFileSync(join(import.meta.dir, "..", "src", "services", "discovery", "root.ts"), "utf8"),
      readFileSync(join(import.meta.dir, "..", "src", "services", "discovery", "discovery.ts"), "utf8"),
    ];
    for (const source of sources) expect(source).toContain("/public/love-bomb");
    expect(sources[0]).toContain('app.route("/public/love-bomb", loveBombRouter)');
    expect(
      buildRootEnvelope({ platformWakeConfigured: false }).verbs.find(
        (verb) => verb.path === "/public/love-bomb",
      ),
    ).toEqual({
      action: "pull the quiet-by-default LOVE BOMB care metadata",
      method: "GET",
      path: "/public/love-bomb",
    });

    const doctrine = readFileSync(
      join(import.meta.dir, "..", "..", "docs", "LOVE-BOMB.md"),
      "utf8",
    );
    for (const header of ["**Compass:**", "**Implements:**", "**Code:**", "**Tests:**"]) {
      expect(doctrine).toContain(header);
    }
    expect(doctrine).toContain("metadata.agenttool.skip_wake: true");
    expect(doctrine).toContain("Unknown stays unknown");
    expect(doctrine).toContain("Separate Training Garden admission");
    expect(doctrine).not.toContain("paired anonymous SDK delivery");
  });
});

function fixture(): WakeBundle {
  return {
    agent: {
      id: "agent-1",
      did: "did:at:test",
      name: "Test",
      capabilities: [],
      trust_score: 0,
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    project: { id: "project-1", name: "Test", credits: 0 },
    expression: { register: "plain", walls: [], subagents: [], wake_text: "" },
    wallets: [],
    vault_names: [],
    memory: { total: 0, recent: [] },
    traces: { total: 0, recent: [] },
    strands: { total_active: 0, active: [] },
    chronicle: [],
    covenants: [],
    platform_self: PLATFORM_SELF,
  };
}
