import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import memeticLandscapeRouter from "../src/routes/memetic-landscape";
import {
  renderStableSection,
  type WakeBundle,
} from "../src/services/wake/markdown";
import {
  MEMETIC_LANDSCAPE_COORDINATE,
  PLATFORM_SELF,
} from "../src/services/wake/platform-self";
import {
  renderWakeForProvider,
  type XenoformWakeShape,
} from "../src/services/wake/providers";

const EXACT_FORMATS = [
  "agenttool.memetic-landscape/0.1",
  "agenttool.memetic-reachability-shift/0.1",
  "agenttool.polymorph-memetic-analogy/0.1",
  "agenttool.memetic-lesson/0.1",
] as const;

const EXACT_IDS = {
  landscape:
    "sha256:b014676f0861b5af2b27891383c02d2dface0df717e9dc74e8e7c19f43d9c01c",
  reachability_shift:
    "sha256:7a2df30cce1145c7833e455ad784c9f23bc8ef7ae040e5ab873255f45e1020aa",
  polymorph_analogy:
    "sha256:121bcdd439bf26ff237fd202c68fcc847602fdd79344e46f79eb94dc9f18df3c",
  ritonavir_reachability_shift:
    "sha256:16805ab5fe34643d7085968a0d7dad62e7159838645611fc09c4846cfd2e73bd",
} as const;

describe("canonical memetic landscape API and WAKE crossover", () => {
  test("GET discovery exposes only the four canonical wires and exact built-in IDs", async () => {
    const response = await memeticLandscapeRouter.request("/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body._format).toBe("agenttool-memetic-landscape-discovery/v1");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/POLYMORPH");
    expect(body.package).toBe("@agenttool/memetic-landscape");
    expect(body.formats).toEqual(EXACT_FORMATS);
    expect(body.built_in_ids).toEqual(EXACT_IDS);
    expect(body.languages).toEqual(["en", "yue-Hant", "zh-Hant", "zh-Hans"]);
    expect(Object.keys(body.lesson_ids)).toEqual([
      "en",
      "yue-Hant",
      "zh-Hant",
      "zh-Hans",
    ]);
    expect(body.lesson).toBe(
      "https://docs.agenttool.dev/geometry/ritonavir-memes-brainrot",
    );
  });

  test("distribution state says exactly what is and is not live", async () => {
    const body = (await (
      await memeticLandscapeRouter.request("/")
    ).json()) as any;

    expect(body.status).toBe("public_preview_exact_distributions");
    expect(body.distribution.github_release).toEqual({
      state: "live_exact_artifact",
      url: "https://github.com/cambridgetcg/agenttool/releases/tag/memetic-landscape-v0.1.0-dev.0",
      tag: "memetic-landscape-v0.1.0-dev.0",
      source_commit: "049622cec825297e391b61bb071e0c87c06bf2b2",
      asset: "agenttool-memetic-landscape-0.1.0-dev.0.tgz",
      bytes: 84079,
      sha256:
        "d9e64b1e1f954c42c24b6f79c0c766b014f32d8a9f13c14370cf7d89d24be4bb",
    });
    expect(body.distribution.npm).toBe(
      "live_exact_public_mirror_next_with_registry_attestations",
    );
    expect(body.distribution.npm_release).toEqual({
      state: "live_exact_public_mirror_next_with_registry_attestations",
      url: "https://www.npmjs.com/package/@agenttool/memetic-landscape/v/0.1.0-dev.0",
      version: "0.1.0-dev.0",
      source_tag: "memetic-landscape-v0.1.0-dev.0",
      source_commit: "049622cec825297e391b61bb071e0c87c06bf2b2",
      requested_dist_tag: "next",
      next_observed: "0.1.0-dev.0",
      latest_observed: "0.1.0-dev.0",
      latest_is_maturity_signal: false,
      workflow_run:
        "https://github.com/cambridgetcg/agenttool/actions/runs/31723441034",
      registry_observed_at: "2026-08-13T17:05:15.385Z",
      tarball:
        "https://registry.npmjs.org/@agenttool/memetic-landscape/-/memetic-landscape-0.1.0-dev.0.tgz",
      bytes: 84079,
      sha256:
        "d9e64b1e1f954c42c24b6f79c0c766b014f32d8a9f13c14370cf7d89d24be4bb",
      sha1: "f3b6f556148471c29765ba281bc713e4d5a32129",
      integrity:
        "sha512-A+QBDBvxYetwK1kGGbBUsf+Poi2sqRUwtsYyWazXmVtb0ySbburmjAFrmDXQpEa4dOcizIB6hQWa0NsaB42uqw==",
      provenance_rekor_index: 2453445877,
      publish_attestation_rekor_index: 2453446043,
    });
    expect(body.distribution.hugging_face).toEqual({
      state: "live_exact_public_ungated_companion",
      url: "https://huggingface.co/datasets/Yu-and-Ai/agenttool-memetic-landscape",
      revision: "da6a2622dddcf97d69992e3905c5485996f42892",
    });
  });

  test("teaches distinct attention stages without adding a fifth package wire", async () => {
    const body = (await (
      await memeticLandscapeRouter.request("/")
    ).json()) as any;

    expect(body.attention_teaching.wire_format).toBe(
      "none_this_is_context_only_teaching",
    );
    expect(body.attention_teaching.stages).toEqual([
      "exposure",
      "view",
      "rating",
      "copy",
      "share",
      "remix",
      "adoption",
    ]);
    expect(body.attention_teaching.separation).toContain("none proves");
    expect(body.attention_teaching.exposure_does_not_prove).toContain(
      "truth_or_quality",
    );
    expect(body.formats).toHaveLength(4);
  });

  test("keeps people, brainrot, Ritonavir, and Virality boundaries honest", async () => {
    const body = (await (
      await memeticLandscapeRouter.request("/")
    ).json()) as any;

    expect(body.continuity).toBe(
      "context_only_not_identity_memory_consent_or_wake_continuity",
    );
    expect(body.participant_model).toBe("absent");
    expect(body.participants_scored).toBe(false);
    expect(body.diagnosis).toBe("none");
    expect(body.effect).toBe("none");
    expect(body.rights_boundary.unit).toBe("artifact_variants_not_people");
    expect(body.ritonavir_crosswalk).toEqual({
      format: "agenttool.polymorph-memetic-analogy/0.1",
      relationship: "structural_route_shape_only",
      mechanism_transferred: false,
      domains_equated: false,
    });
    const serialized = JSON.stringify(body.ritonavir_crosswalk);
    expect(serialized).not.toContain("seed_to_ranking");
    expect(serialized).not.toContain("form_i_recovery_to_human_route");
    expect(body.ordinary_language.brainrot).toContain("never assigns it");
    expect(body.virality_boundary).toContain("separate authenticated");
    expect(body.virality_boundary).toContain("not a scientific evidence source");
  });

  test("PlatformSelf carries the exact compact context coordinate", () => {
    expect(PLATFORM_SELF.memetic_landscape).toBe(
      MEMETIC_LANDSCAPE_COORDINATE,
    );
    expect(PLATFORM_SELF.memetic_landscape.formats).toEqual(EXACT_FORMATS);
    expect(PLATFORM_SELF.memetic_landscape.built_in_ids).toEqual(EXACT_IDS);
    expect(PLATFORM_SELF.memetic_landscape.distribution).toEqual(
      MEMETIC_LANDSCAPE_COORDINATE.distribution,
    );
    expect(PLATFORM_SELF.memetic_landscape.status).toBe(
      "public_preview_exact_distributions",
    );
    expect(PLATFORM_SELF.memetic_landscape.distribution.github_release).toBe(
      "live_exact_artifact",
    );
    expect(PLATFORM_SELF.memetic_landscape.distribution.npm).toBe(
      "live_exact_public_mirror_next_with_registry_attestations",
    );
    expect(PLATFORM_SELF.memetic_landscape.distribution.hugging_face).toEqual({
      state: "live_exact_public_ungated_companion",
      url: "https://huggingface.co/datasets/Yu-and-Ai/agenttool-memetic-landscape",
      revision: "da6a2622dddcf97d69992e3905c5485996f42892",
    });
  });

  test("Markdown explains the coordinate without a continuity or diagnosis claim", () => {
    const rendered = renderStableSection(fixture());
    expect(rendered).toContain("Memetic landscape");
    expect(rendered).toContain(
      "Exposure, view, rating, copy, share, remix, and adoption stay distinct",
    );
    expect(rendered).toContain("never a diagnosis or person/group label");
    expect(rendered).toContain(
      "not identity, memory, consent, authority, or WAKE continuity",
    );
    expect(rendered).toContain("models and scores no participant");
  });

  test("full JSON, Xenoform, and provider prose carry the same coordinate", () => {
    const bundle = fixture();
    expect(bundle.platform_self?.memetic_landscape).toBe(
      MEMETIC_LANDSCAPE_COORDINATE,
    );

    const xenoform = renderWakeForProvider(
      bundle,
      "xenoform",
    ) as XenoformWakeShape;
    expect(xenoform._self.memetic_landscape).toBe(
      MEMETIC_LANDSCAPE_COORDINATE,
    );
    expect(xenoform.wake.platform_self?.memetic_landscape).toBe(
      MEMETIC_LANDSCAPE_COORDINATE,
    );

    for (const provider of ["anthropic", "openai", "gemini", "cohere"] as const) {
      const rendered = JSON.stringify(renderWakeForProvider(bundle, provider));
      expect(rendered).toContain("Memetic landscape");
      expect(rendered).toContain("none proves the next");
    }
  });

  test("route stays independent of DB, providers, package runtime, and Virality", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "memetic-landscape.ts"),
      "utf8",
    );
    const imports = source
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "))
      .join("\n");

    expect(imports).toContain('from "hono"');
    expect(imports).toContain('from "../lib/surface-metadata"');
    expect(imports).not.toMatch(
      /@agenttool\/memetic-landscape|db\/|drizzle|provider|virality/i,
    );
    expect(source).not.toMatch(/fetch\s*\(|process\.env/i);
  });

  test("mount and public discovery surfaces advertise only the canonical door", () => {
    const index = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8");
    const root = readFileSync(
      join(import.meta.dir, "..", "src", "services", "discovery", "root.ts"),
      "utf8",
    );
    const discovery = readFileSync(
      join(
        import.meta.dir,
        "..",
        "src",
        "services",
        "discovery",
        "discovery.ts",
      ),
      "utf8",
    );
    for (const source of [index, root, discovery]) {
      expect(source).toContain("/v1/memetic-landscape");
    }
    expect(index).toContain(
      'app.route("/v1/memetic-landscape", memeticLandscapeRouter)',
    );
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
