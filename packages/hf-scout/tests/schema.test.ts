import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  bindHfResearchLead,
  createKingdomHfSidecar,
  getCuratedHfResearchCatalog,
  inspectHfRepository,
  projectLoveModelLock,
  reconcileHfRelease,
  searchHfRepositories,
  type HubReader,
} from "../src/index.js";

const ROOT = join(import.meta.dir, "..");
const REVISION = "a".repeat(40);

async function schemas() {
  const report = JSON.parse(
    await readFile(join(ROOT, "schema", "agenttool-hf-scout-report-v0.2.schema.json"), "utf8"),
  ) as object;
  const search = JSON.parse(
    await readFile(join(ROOT, "schema", "agenttool-hf-scout-search-v0.2.schema.json"), "utf8"),
  ) as object;
  const sidecar = JSON.parse(
    await readFile(join(ROOT, "schema", "kingdom-hf-sidecar-v0.2.schema.json"), "utf8"),
  ) as object;
  const reconciliation = JSON.parse(
    await readFile(join(ROOT, "schema", "agenttool-hf-release-reconciliation-v0.2.schema.json"), "utf8"),
  ) as object;
  const researchCatalog = JSON.parse(
    await readFile(join(ROOT, "schema", "agenttool-hf-research-catalog-v0.1.schema.json"), "utf8"),
  ) as object;
  const researchBinding = JSON.parse(
    await readFile(join(ROOT, "schema", "agenttool-hf-research-binding-v0.1.schema.json"), "utf8"),
  ) as object;
  const historical = await Promise.all([
    "agenttool-hf-scout-report-v0.1.schema.json",
    "agenttool-hf-scout-search-v0.1.schema.json",
    "kingdom-hf-sidecar-v0.1.schema.json",
  ].map(async (name) => JSON.parse(
    await readFile(join(ROOT, "schema", name), "utf8"),
  ) as object));
  return {
    report,
    search,
    sidecar,
    reconciliation,
    researchCatalog,
    researchBinding,
    historical,
  };
}

function fixtureReader(): HubReader {
  return {
    async inspect() {
      return {
        id: "org/model",
        sha: REVISION,
        tags: ["license:mit"],
        siblings: [{ rfilename: "config.json", blobId: "c".repeat(40), size: 2 }],
      };
    },
    async search() {
      return [];
    },
  };
}

describe("JSON Schemas", () => {
  test("validate generated reports and reject extension fields", async () => {
    const documents = await schemas();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(documents.report);
    const validate = ajv.getSchema("urn:agenttool:hf-scout:report:v0.2")!;
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model", revision: REVISION },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...report, trusted: true })).toBe(false);
    expect(validate({
      ...report,
      snapshot: {
        ...report.snapshot,
        boundary_codes: ["trusted"],
      },
    })).toBe(false);
    expect(validate({
      ...report,
      snapshot: {
        ...report.snapshot,
        files: [{
          path: "config.json",
          size: Number.MAX_SAFE_INTEGER + 1,
          sha256: null,
          git_blob_sha1: null,
          xet_hash: null,
          basis: "provider_metadata",
          verified_locally: false,
        }],
      },
    })).toBe(false);
    expect(validate({
      ...report,
      snapshot: {
        ...report.snapshot,
        revision: {
          requested_full_sha: null,
          resolved_full_sha: REVISION,
          state: "exact_revision_match",
        },
      },
    })).toBe(false);
    expect(validate({
      ...report,
      transport: {
        ...report.transport,
        kind: "public_hub_api",
      },
    })).toBe(false);
    expect(validate({
      ...report,
      snapshot: {
        ...report.snapshot,
        observation: {
          transport: "public_hub_api",
          repository_association: "provider_response",
          reference: "requested_exact_revision",
        },
        provenance_grade: "provider_observed_exact_revision_metadata",
        boundary_codes: report.snapshot.boundary_codes
          .filter((code) => code !== "caller_owned_reader"),
      },
    })).toBe(false);
  });

  test("compiles the preserved v0.1 schemas as historical contracts", async () => {
    const documents = await schemas();
    for (const schema of documents.historical) {
      const ajv = new Ajv2020({ strict: true, allErrors: true });
      addFormats(ajv);
      expect(() => ajv.compile(schema)).not.toThrow();
    }
  });

  test("validates a sidecar as a standalone exported schema", async () => {
    const documents = await schemas();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(documents.sidecar);
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    const lock = projectLoveModelLock({
      schema: "love.huggingface-model-lock/v1",
      repo_type: "model",
      repo_id: "org/model",
      revision: REVISION,
      hub_url: "https://huggingface.co/org/model",
      last_modified: "2026-01-01T00:00:00.000Z",
      license: "mit",
      base_model: ["org/base-a", "org/base-b"],
      task: "text-generation",
      library: "transformers",
      files: [{
        path: "config.json",
        size: 2,
        sha256: "b".repeat(64),
        git_blob_sha1: "c".repeat(40),
      }],
    });
    const sidecar = createKingdomHfSidecar({
      generated_at: "2026-07-30T12:00:00.000Z",
      reports: [report],
      model_locks: [lock],
    });
    expect(validate(sidecar), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({
      ...sidecar,
      model_locks: [{
        ...sidecar.model_locks[0],
        declared: {
          ...sidecar.model_locks[0]!.declared,
          base_model: ["org/base/extra"],
        },
      }],
    })).toBe(false);
  });

  test("validates generated search reports and rejects extension fields", async () => {
    const documents = await schemas();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(documents.search);
    const report = await searchHfRepositories(
      { kind: "model", query: "org", limit: 2 },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...report, trusted: true })).toBe(false);
  });

  test("validates an exact release/current-head reconciliation", async () => {
    const documents = await schemas();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(documents.reconciliation);
    const report = await reconcileHfRelease(
      {
        kind: "model",
        id: "org/model",
        release_revision: REVISION,
        source_declaration: {
          basis: "caller_declaration",
          source_revision: REVISION,
          source_manifest_sha256: null,
        },
      },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...report, trusted: true })).toBe(false);
    expect(validate({
      ...report,
      observed_head: {
        ...report.observed_head,
        requested_reference: "requested_exact_revision",
      },
    })).toBe(false);
  });

  test("validates the curated research catalog and an exact report binding", async () => {
    const documents = await schemas();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validateCatalog = ajv.compile(documents.researchCatalog);
    const validateBinding = ajv.compile(documents.researchBinding);
    const catalog = getCuratedHfResearchCatalog();
    expect(validateCatalog(catalog), JSON.stringify(validateCatalog.errors)).toBe(true);
    expect(validateCatalog({
      ...catalog,
      boundary: {
        ...catalog.boundary,
        gated_terms_accepted: true,
      },
    })).toBe(false);

    const cloneCatalog = () => JSON.parse(
      JSON.stringify(catalog),
    ) as ReturnType<typeof getCuratedHfResearchCatalog>;
    const unsafeGated = cloneCatalog();
    const gatedLead = unsafeGated.leads.find((entry) => entry.key === "wildguardmix")!;
    gatedLead.research.boundaries = gatedLead.research.boundaries
      .filter((code) => code !== "gated_terms_required");
    expect(validateCatalog(unsafeGated)).toBe(false);

    const unsafeLicense = cloneCatalog();
    const unlicensedLead = unsafeLicense.leads
      .find((entry) => entry.key === "datadecide_ppl_results")!;
    unlicensedLead.research.forbidden_uses = unlicensedLead.research.forbidden_uses
      .filter((code) => code !== "license_clearance_inference");
    expect(validateCatalog(unsafeLicense)).toBe(false);

    const unsafeExecutable = cloneCatalog();
    const executableLead = unsafeExecutable.leads
      .find((entry) => entry.key === "openthoughts_agent_rl_5k")!;
    executableLead.research.boundaries = executableLead.research.boundaries
      .filter((code) => code !== "executable_payload_never_execute");
    expect(validateCatalog(unsafeExecutable)).toBe(false);

    for (const key of [
      "datadecide_data_recipes",
      "gemma_scope_2b_pt_res",
      "openthoughts_agent_rl_5k",
    ]) {
      const unsafePayload = cloneCatalog();
      unsafePayload.leads.find((entry) => entry.key === key)!.research.payload = "tabular_text";
      expect(validateCatalog(unsafePayload)).toBe(false);
    }

    const unsafeBulk = cloneCatalog();
    const bulkLead = unsafeBulk.leads.find((entry) => entry.key === "agenttrove")!;
    bulkLead.research.forbidden_uses = bulkLead.research.forbidden_uses
      .filter((code) => code !== "bulk_download_without_review");
    expect(validateCatalog(unsafeBulk)).toBe(false);

    const unsafeEmbeddedCalls = cloneCatalog();
    const embeddedLead = unsafeEmbeddedCalls.leads
      .find((entry) => entry.key === "agenttrove")!;
    embeddedLead.research.forbidden_uses = embeddedLead.research.forbidden_uses
      .filter((code) => code !== "live_tool_execution");
    expect(validateCatalog(unsafeEmbeddedCalls)).toBe(false);

    const lead = catalog.leads[0]!;
    const reader: HubReader = {
      async inspect() {
        return {
          id: lead.match.id,
          sha: lead.match.revision,
          private: false,
          gated: false,
          tags: ["license:odc-by"],
          siblings: [],
        };
      },
      async search() {
        return [];
      },
    };
    const report = await inspectHfRepository(
      { kind: lead.match.kind, id: lead.match.id, revision: lead.match.revision },
      { reader, observed_at: "2026-07-31T12:00:00.000Z" },
    );
    const binding = bindHfResearchLead(report, lead);
    expect(validateBinding(binding), JSON.stringify(validateBinding.errors)).toBe(true);
    expect(validateBinding({
      ...binding,
      observation: {
        ...binding.observation,
        provenance_grade: "provider_observed_commit_metadata",
      },
    })).toBe(false);
  });
});
