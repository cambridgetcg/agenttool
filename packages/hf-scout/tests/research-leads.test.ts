import { describe, expect, test } from "bun:test";

import {
  bindHfResearchLead,
  getCuratedHfResearchCatalog,
  hfResearchPaperUrls,
  inspectHfRepository,
  pinnedHfResearchLeadUrl,
  selectHfResearchLeads,
  validateHfResearchCatalog,
  validateHfResearchLead,
  type HfResearchLead,
  type HfScoutReport,
  type HubReader,
} from "../src/index.js";

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";

async function reportFor(
  lead: HfResearchLead,
  options: { observed_at?: string; private?: boolean } = {},
): Promise<HfScoutReport> {
  const reader: HubReader = {
    async inspect() {
      return {
        id: lead.match.id,
        sha: lead.match.revision,
        private: options.private ?? false,
        gated: lead.match.declared.gated,
        tags: lead.match.declared.license === null
          ? []
          : [`license:${lead.match.declared.license}`],
        siblings: [],
      };
    },
    async search() {
      return [];
    },
  };
  return inspectHfRepository(
    { kind: lead.match.kind, id: lead.match.id, revision: lead.match.revision },
    { reader, observed_at: options.observed_at ?? OBSERVED_AT },
  );
}

describe("phase-aware HF research leads", () => {
  test("keeps a frozen pinned catalog without volatile popularity or account state", () => {
    const catalog = getCuratedHfResearchCatalog();
    expect(catalog.curated_on).toBe("2026-08-29");
    expect(catalog.leads).toHaveLength(16);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.leads[0])).toBe(true);
    expect(catalog.leads.filter((lead) => lead.key.startsWith("datadecide_")))
      .toHaveLength(3);
    const recipes = catalog.leads.find((lead) => lead.key === "datadecide_data_recipes")!;
    expect(recipes.research.payload).toBe("tokenized_corpus");
    expect(recipes.research.boundaries).toContain("binary_download_separate_approval");
    expect(recipes.research.boundaries).toContain("bulk_payload_separate_approval");
    expect(catalog.leads.find((lead) => lead.key === "datadecide_ppl_results")?.match.declared.license)
      .toBeNull();
    expect(catalog.leads.find((lead) => lead.key === "wildguardmix")?.research.boundaries)
      .toContain("gated_terms_required");
    expect(catalog.leads.find((lead) => lead.key === "openthoughts_agent_rl_5k")?.research.forbidden_uses)
      .toContain("live_tool_execution");
    const xeniaWordIs = catalog.leads.find((lead) => lead.key === "xenia_word_is")!;
    expect(xeniaWordIs).toMatchObject({
      match: {
        kind: "dataset",
        id: "Yu-and-Ai/xenia-word-is",
        revision: "64e3c4be051b2780409ab25578ea0c8bf926a72a",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["failure_mode_matrix"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: [],
        phase: "agent_trace_sft",
        payload: "conversation_text",
        priority: 16,
        primary: "agenttool_fixture",
        secondary: ["kingdom_registry", "yutabase_provenance"],
        mode: "offline_parser_fixture",
        boundaries: [
          "benchmark_excluded_from_training",
          "synthetic_or_simulated_not_truth",
          "upstream_terms_separate",
        ],
        bounded_uses: ["offline_parser_fixture", "provenance_graph"],
        forbidden_uses: [
          "benchmark_tuning",
          "license_clearance_inference",
          "retrieval_index_ingestion",
          "sole_evaluator_training",
          "training_corpus_ingestion",
          "truth_or_intent_authority",
        ],
      },
    });
    expect(xeniaWordIs.research.forbidden_uses).toContain("training_corpus_ingestion");
    expect(JSON.stringify(catalog)).not.toMatch(/downloads|likes|trending|updated_at|access_token/u);
  });

  test("selects ecosystem routes and derives only exact primary URLs", () => {
    const leads = selectHfResearchLeads({ phase: "pretraining_data_selection" });
    expect(leads.map((lead) => lead.key)).toEqual([
      "datadecide_eval_results",
      "datadecide_data_recipes",
      "datadecide_ppl_results",
    ]);
    const helpSteer = getCuratedHfResearchCatalog().leads
      .find((lead) => lead.key === "helpsteer2")!;
    expect(pinnedHfResearchLeadUrl(helpSteer)).toBe(
      `https://huggingface.co/datasets/nvidia/HelpSteer2/tree/${helpSteer.match.revision}`,
    );
    expect(hfResearchPaperUrls(helpSteer)).toEqual([
      "https://arxiv.org/abs/2406.08673",
      "https://arxiv.org/abs/2410.01257",
    ]);
  });

  test("binds the exact Xenia WORD IS dataset lead without granting training authority", async () => {
    const lead = getCuratedHfResearchCatalog().leads
      .find((entry) => entry.key === "xenia_word_is")!;
    expect(pinnedHfResearchLeadUrl(lead)).toBe(
      "https://huggingface.co/datasets/Yu-and-Ai/xenia-word-is/tree/64e3c4be051b2780409ab25578ea0c8bf926a72a",
    );

    const binding = bindHfResearchLead(await reportFor(lead), lead);
    expect(binding).toMatchObject({
      lead_key: "xenia_word_is",
      artifact: {
        kind: "dataset",
        id: "Yu-and-Ai/xenia-word-is",
        revision: "64e3c4be051b2780409ab25578ea0c8bf926a72a",
      },
      matched_declared: {
        license: "apache-2.0",
        gated: false,
        private: false,
      },
      boundary: {
        legal_clearance: "not_assessed",
        gate_acceptance: "not_assessed",
        raw_rows_read: false,
        repository_files_downloaded: false,
        model_code_executed: false,
        remote_compute_invoked: false,
        hub_write_performed: false,
      },
    });
  });

  test("binds exact immutable report bytes without upgrading caller-owned provenance", async () => {
    const lead = getCuratedHfResearchCatalog().leads[0]!;
    const first = await reportFor(lead);
    const second = await reportFor(lead, { observed_at: "2026-07-31T13:00:00.000Z" });
    const firstBinding = bindHfResearchLead(first, lead);
    const secondBinding = bindHfResearchLead(second, lead);

    expect(firstBinding.snapshot_sha256).toBe(secondBinding.snapshot_sha256);
    expect(firstBinding.definition_sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(firstBinding.observation).toEqual({
      transport: "injected",
      repository_association: "caller_owned",
      provenance_grade: "caller_supplied_commit_metadata",
    });
    expect(firstBinding.boundary).toMatchObject({
      publisher_metadata: "matched_unverified_assertion",
      legal_clearance: "not_assessed",
      gate_acceptance: "not_assessed",
      raw_rows_read: false,
      repository_files_downloaded: false,
      model_code_executed: false,
      remote_compute_invoked: false,
      hub_write_performed: false,
    });
  });

  test("rejects revision, license, gate, and privacy mismatches", async () => {
    const lead = getCuratedHfResearchCatalog().leads[0]!;
    const report = await reportFor(lead);
    const wrongRevision = structuredClone(lead);
    wrongRevision.match.revision = "f".repeat(40);
    expect(() => bindHfResearchLead(report, wrongRevision)).toThrow("revision does not match");

    const wrongLicense = structuredClone(lead);
    wrongLicense.match.declared.license = "apache-2.0";
    expect(() => bindHfResearchLead(report, wrongLicense)).toThrow("license declaration does not match");

    const wrongGate = structuredClone(lead);
    wrongGate.match.declared.gated = "auto";
    wrongGate.research.boundaries = [
      ...wrongGate.research.boundaries,
      "gated_terms_required",
    ].sort();
    wrongGate.research.forbidden_uses = [
      ...wrongGate.research.forbidden_uses,
      "gate_acceptance_by_scout",
    ].sort();
    expect(() => bindHfResearchLead(report, wrongGate)).toThrow("gate declaration does not match");

    const privateReport = await reportFor(lead, { private: true });
    expect(() => bindHfResearchLead(privateReport, lead)).toThrow("not explicitly non-private");
  });

  test("preserves a companion repository's unknown-license boundary", async () => {
    const lead = getCuratedHfResearchCatalog().leads
      .find((entry) => entry.key === "datadecide_ppl_results")!;
    const report = await reportFor(lead);
    expect(report.snapshot.boundary_codes).toContain("license_unknown");
    expect(bindHfResearchLead(report, lead).matched_declared.license).toBeNull();

    const laundered = structuredClone(lead);
    laundered.match.declared.license = "odc-by";
    expect(() => bindHfResearchLead(report, laundered)).toThrow("license declaration does not match");
  });

  test("closes record vocabularies and catalog identities at runtime", () => {
    const lead = getCuratedHfResearchCatalog().leads[0]!;
    expect(() => validateHfResearchLead({ ...lead, trusted: true }))
      .toThrow("unsupported fields");

    const unsorted = structuredClone(lead);
    unsorted.research.bounded_uses = [...unsorted.research.bounded_uses].reverse();
    expect(() => validateHfResearchLead(unsorted)).toThrow("sorted and unique");

    const unknown = structuredClone(lead) as HfResearchLead & {
      research: HfResearchLead["research"] & { mode: string };
    };
    unknown.research.mode = "agentic_magic";
    expect(() => validateHfResearchLead(unknown)).toThrow("integration mode is invalid");

    const catalog = JSON.parse(
      JSON.stringify(getCuratedHfResearchCatalog()),
    ) as ReturnType<typeof getCuratedHfResearchCatalog>;
    catalog.leads[1]!.key = catalog.leads[0]!.key;
    expect(() => validateHfResearchCatalog(catalog)).toThrow("duplicate keys");
  });

  test("requires safety controls implied by gate, license, and payload classes", () => {
    const byKey = (key: string) => structuredClone(
      getCuratedHfResearchCatalog().leads.find((entry) => entry.key === key)!,
    );

    const gated = byKey("wildguardmix");
    gated.research.boundaries = gated.research.boundaries
      .filter((code) => code !== "gated_terms_required");
    expect(() => validateHfResearchLead(gated)).toThrow("gated artifact");

    const unlicensed = byKey("datadecide_ppl_results");
    unlicensed.research.forbidden_uses = unlicensed.research.forbidden_uses
      .filter((code) => code !== "license_clearance_inference");
    expect(() => validateHfResearchLead(unlicensed)).toThrow("without a declared license");

    const binary = byKey("gemma_scope_2b_pt_res");
    binary.research.boundaries = binary.research.boundaries
      .filter((code) => code !== "binary_parser_review");
    expect(() => validateHfResearchLead(binary)).toThrow("binary-parameter artifact");

    const executable = byKey("openthoughts_agent_rl_5k");
    executable.research.boundaries = executable.research.boundaries
      .filter((code) => code !== "executable_payload_never_execute");
    expect(() => validateHfResearchLead(executable)).toThrow("executable-task artifact");

    const bulk = byKey("agenttrove");
    bulk.research.forbidden_uses = bulk.research.forbidden_uses
      .filter((code) => code !== "bulk_download_without_review");
    expect(() => validateHfResearchLead(bulk)).toThrow("bulk-payload artifact");

    const embeddedCalls = byKey("agenttrove");
    embeddedCalls.research.forbidden_uses = embeddedCalls.research.forbidden_uses
      .filter((code) => code !== "live_tool_execution");
    expect(() => validateHfResearchLead(embeddedCalls)).toThrow("embedded-call artifact");
  });

  test("prevents publisher features from downgrading binary payload classes", () => {
    for (const key of [
      "datadecide_data_recipes",
      "gemma_scope_2b_pt_res",
      "openthoughts_agent_rl_5k",
    ]) {
      const lead = structuredClone(
        getCuratedHfResearchCatalog().leads.find((entry) => entry.key === key)!,
      );
      lead.research.payload = "tabular_text";
      expect(() => validateHfResearchLead(lead)).toThrow("requires payload");
    }
  });

  test("binds only the exact curated definition behind a lead key", async () => {
    const lead = getCuratedHfResearchCatalog().leads[0]!;
    const report = await reportFor(lead);

    const rewritten = structuredClone(lead);
    rewritten.research.mode = "metadata_only";
    expect(() => validateHfResearchLead(rewritten)).not.toThrow();
    expect(() => bindHfResearchLead(report, rewritten)).toThrow(
      "does not match its curated definition",
    );

    const renamed = structuredClone(lead);
    renamed.key = "unregistered_research_lead";
    expect(() => bindHfResearchLead(report, renamed)).toThrow(
      "not present in the curated catalog",
    );
  });
});
