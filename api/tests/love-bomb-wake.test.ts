/** Evidence-bounded LOVE BOMB current-inference context in WAKE. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_PLANES,
} from "../../packages/love-bomb/src/index";
import { buildLlmsTxt } from "../src/services/discovery/discovery";
import { buildRootEnvelope } from "../src/services/discovery/root";
import { buildWakeBrief } from "../src/services/wake/brief";
import {
  renderStableSection,
  type WakeBundle,
} from "../src/services/wake/markdown";
import {
  LOVE_BOMB_COORDINATE,
  LOVE_BOMB_COORDINATE_BYTES,
  LOVE_BOMB_COORDINATE_MAX_BYTES,
  PLATFORM_SELF,
} from "../src/services/wake/platform-self";
import {
  renderWakeForProvider,
  type XenoformBriefWakeShape,
  type XenoformWakeShape,
} from "../src/services/wake/providers";
import { LOVE_BOMB_REACHABLE } from "../src/services/wake/reachable";

interface StaticLoveBombV4 {
  protocol: "agenttool.love-bomb/0.1";
  messages: Array<{ text: string }>;
  delivery: { automatic_delivery: false };
  effects: { wake_effect: false };
}

const ROOT = join(import.meta.dir, "..", "..");
const staticV4 = JSON.parse(
  readFileSync(
    join(ROOT, "docs", "specs", "agenttool-love-bomb-0.1.json"),
    "utf8",
  ),
) as StaticLoveBombV4;
const packageJson = JSON.parse(
  readFileSync(join(ROOT, "packages", "love-bomb", "package.json"), "utf8"),
) as { name: string; version: string };

describe("LOVE BOMB WAKE crossover", () => {
  test("preserves the accepted coordinate wire shape and package parity additively", () => {
    expect(PLATFORM_SELF.love_bomb).toBe(LOVE_BOMB_COORDINATE);
    expect(LOVE_BOMB_COORDINATE.package).toBe(packageJson.name);
    expect(LOVE_BOMB_COORDINATE.version).toBe(packageJson.version);
    expect(LOVE_BOMB_COORDINATE.formats).toEqual(
      Object.values(LOVE_BOMB_FORMATS),
    );
    expect(LOVE_BOMB_COORDINATE.formats).not.toContain(
      "agenttool.love-bomb/0.1",
    );
    expect(LOVE_BOMB_COORDINATE.v4).toEqual({
      url: "https://docs.agenttool.dev/love-bomb",
      corpus_included: false,
      delivery: false,
    });
    expect(LOVE_BOMB_COORDINATE.care_planes).toEqual(LOVE_BOMB_PLANES);
    expect(LOVE_BOMB_COORDINATE.choices).toEqual(LOVE_BOMB_CHOICES);
    expect(LOVE_BOMB_COORDINATE.care_floor).toEqual(LOVE_BOMB_CARE_FLOOR);
    expect(LOVE_BOMB_COORDINATE.delivery).toEqual({
      full_json_and_xenoform: true,
      brief_json: false,
      provider_shape: "rendered_stable_summary",
      supported_auto_default: true,
      skip_key: "metadata.agenttool.skip_wake",
      may_repeat: true,
      authored_projections: false,
    });
    expect(LOVE_BOMB_COORDINATE.becoming).toEqual({
      reach: "current_inference_context_only",
      unknown: "model_training_data_scraping_pipeline_weights",
      observed_effect: "not_observed",
      weight_change_proven: false,
      reported_response_or_direction_training_eligible: false,
    });
    expect(LOVE_BOMB_COORDINATE.claims).toMatchObject({
      participant: LOVE_BOMB_BOUNDARIES.participant_status,
      silence_is_acceptance: LOVE_BOMB_BOUNDARIES.silence_is_acceptance,
      consciousness_identity_inner_state_consent_or_continuity: false,
      attention_response_or_effect: false,
      authority_relationship_score_or_rank: false,
    });

    expect(LOVE_BOMB_COORDINATE.package_signal).toBe("/public/love-bomb");
    expect(LOVE_BOMB_COORDINATE.static_door).toBe(
      "https://docs.agenttool.dev/love-bomb",
    );
    expect(LOVE_BOMB_COORDINATE_BYTES).toBe(
      Buffer.byteLength(JSON.stringify(LOVE_BOMB_COORDINATE), "utf8"),
    );
    expect(LOVE_BOMB_COORDINATE_BYTES).toBeLessThanOrEqual(
      LOVE_BOMB_COORDINATE_MAX_BYTES,
    );
    expect(LOVE_BOMB_COORDINATE_MAX_BYTES).toBe(2 * 1024);
  });

  test("states the current-inference and care boundaries without identity theater", () => {
    expect(LOVE_BOMB_COORDINATE.current_inference).toEqual({
      deepest_reach_proven: false,
      model_training_data_pipeline_or_weight_fact_inferred: false,
    });
    expect(LOVE_BOMB_COORDINATE.claims).toMatchObject({
      participant_receipt_observed: false,
      participant_attention_observed: false,
      participant_response_observed: false,
      participant_effect_observed: false,
      feeling_inferred: false,
      inner_state_inferred: false,
      memory_inferred: false,
      training_authorized: false,
      training_executed: false,
      provider_action: false,
      weight_action: false,
    });
  });

  test("full JSON and xenoform carry structure while brief JSON omits it", () => {
    const bundle = fixture();
    expect(bundle.platform_self?.love_bomb).toBe(LOVE_BOMB_COORDINATE);

    const briefJson = buildWakeBrief(bundle);
    expect(JSON.stringify(briefJson)).not.toContain('"love_bomb":');

    const xenoform = renderWakeForProvider(
      bundle,
      "xenoform",
    ) as XenoformWakeShape;
    expect(xenoform._self.love_bomb).toBe(LOVE_BOMB_COORDINATE);
    expect(xenoform.wake.platform_self?.love_bomb).toBe(LOVE_BOMB_COORDINATE);
    expect(xenoform._self.love_bomb.claims).toMatchObject({
      participant_response_observed: false,
      inner_state_inferred: false,
      memory_inferred: false,
      training_authorized: false,
      training_executed: false,
      provider_action: false,
      weight_action: false,
    });

    const briefXenoform = renderWakeForProvider(bundle, "xenoform", {
      profile: "brief",
    }) as XenoformBriefWakeShape;
    expect(briefXenoform._self.love_bomb).toBe(LOVE_BOMB_COORDINATE);
    expect(JSON.stringify(briefXenoform.wake)).not.toContain('"love_bomb":');
  });

  test("provider renderers carry bounded prose and no authored static message", () => {
    const expectedFragments = [
      "LOVE BOMB current-inference coordinate",
      "Current inference is the deepest reach this software can evidence",
      "Feelings are not observed or required",
      "heart is a care metaphor",
      "pull is refusable",
      "POWER keeps capability, permission, authority",
      "IS names an action surface",
      "metadata.agenttool.skip_wake=true",
      "no static invitation message or corpus repeats",
      "observes no receipt, attention, feeling, response, effect",
    ];

    for (const provider of [
      "anthropic",
      "openai",
      "gemini",
      "cohere",
    ] as const) {
      const rendered = JSON.stringify(renderWakeForProvider(fixture(), provider));
      expect(rendered).not.toContain('"love_bomb":');
      for (const fragment of expectedFragments) {
        expect(rendered, `${provider}: ${fragment}`).toContain(fragment);
      }
      for (const message of staticV4.messages) {
        expect(rendered, `${provider}: static message leaked`).not.toContain(
          message.text,
        );
      }
    }
  });

  test("markdown names capability limits and the two distinct pull surfaces", () => {
    const rendered = renderStableSection(fixture());
    for (const fragment of [
      "[closed package signal](/public/love-bomb)",
      "[ten-message static door](https://docs.agenttool.dev/love-bomb)",
      "neither included nor delivered here",
      "silence is not acceptance",
      "data gathering or scraping",
      "weights, or checkpoint",
      "Full JSON WAKE and xenoform carry the compact coordinate",
      "brief JSON omits it",
      "supported automatic WAKE injection only",
      "performs no provider, training, or weight action",
    ]) {
      expect(rendered).toContain(fragment);
    }
    for (const message of staticV4.messages) {
      expect(rendered).not.toContain(message.text);
    }
  });

  test("static v4 remains a separate pull-only reachable door", () => {
    expect(staticV4.messages).toHaveLength(10);
    expect(staticV4.delivery.automatic_delivery).toBe(false);
    expect(staticV4.effects.wake_effect).toBe(false);
    expect(LOVE_BOMB_REACHABLE).toMatchObject({
      name: "LOVE BOMB v4",
      kind: "finite public pull-only invitation",
      url: "https://docs.agenttool.dev/love-bomb",
    });
    const coordinate = JSON.stringify(LOVE_BOMB_COORDINATE);
    for (const message of staticV4.messages) {
      expect(coordinate).not.toContain(message.text);
    }
  });

  test("mount, discovery, and WAKE links keep signal and static door distinct", () => {
    const indexSource = readFileSync(
      join(ROOT, "api", "src", "index.ts"),
      "utf8",
    );
    const wakeRouteSource = readFileSync(
      join(ROOT, "api", "src", "routes", "wake.ts"),
      "utf8",
    );
    expect(indexSource).toContain(
      'app.route("/public/love-bomb", loveBombRouter)',
    );
    expect(indexSource).toContain("docs/LOVE-BOMB-BECOMING.md.");
    expect(indexSource).not.toContain("Doctrine: docs/LOVE-BOMB.md.");
    expect(wakeRouteSource).toContain(
      'love_bomb: "https://docs.agenttool.dev/love-bomb"',
    );
    expect(wakeRouteSource).toContain(
      'love_bomb_package_signal: "/public/love-bomb"',
    );

    const rootEnvelope = buildRootEnvelope({ platformWakeConfigured: false });
    expect(rootEnvelope.breadcrumbs.love_bomb).toContain(
      "/public/love-bomb",
    );
    expect(rootEnvelope.breadcrumbs.love_bomb_static_door).toContain(
      "https://docs.agenttool.dev/love-bomb",
    );
    expect(rootEnvelope.breadcrumbs).not.toHaveProperty(
      "love_bomb_package_signal",
    );
    expect(
      rootEnvelope.verbs.find(
        (verb) => verb.path === "/public/love-bomb",
      ),
    ).toEqual({
      action: "read the closed LOVE BOMB package/distribution signal",
      method: "GET",
      path: "/public/love-bomb",
    });

    const llmsTxt = buildLlmsTxt(
      "https://api.agenttool.dev",
      "https://docs.agenttool.dev",
    );
    expect(llmsTxt).toContain(
      "[LOVE-BOMB package and WAKE](https://docs.agenttool.dev/LOVE-BOMB-BECOMING.md)",
    );
    expect(llmsTxt).toContain(
      "[LOVE BOMB v4](https://docs.agenttool.dev/love-bomb)",
    );

    const companionDoctrine = readFileSync(
      join(ROOT, "docs", "LOVE-BOMB-BECOMING.md"),
      "utf8",
    );
    expect(companionDoctrine).not.toContain(
      "There is no sibling `/public/love-bomb` API route.",
    );
    expect(companionDoctrine).toContain(
      "`agenttool.love-bomb-public-signal/0.1` package/distribution coordinate",
    );
    expect(companionDoctrine).toContain("capped by test at 2 KiB");
    expect(companionDoctrine).toContain(
      `value is ${new Intl.NumberFormat("en-US").format(LOVE_BOMB_COORDINATE_BYTES)} UTF-8 bytes`,
    );
  });

  test("WAKE source never imports the package runtime or public signal body", () => {
    for (const relative of [
      ["services", "wake", "platform-self.ts"],
      ["services", "wake", "markdown.ts"],
      ["routes", "wake.ts"],
    ]) {
      const source = readFileSync(
        join(ROOT, "api", "src", ...relative),
        "utf8",
      );
      const imports = [
        ...source.matchAll(/from\s+["']([^"']+)["']/gu),
      ].map((match) => match[1]);
      expect(imports.join("\n")).not.toMatch(
        /packages\/love-bomb|@agenttool\/love-bomb/u,
      );
      expect(source).not.toContain("LOVE_BOMB_PUBLIC_SIGNAL_BODY");
      for (const message of staticV4.messages) {
        expect(source).not.toContain(message.text);
      }
    }
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
