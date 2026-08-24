import { describe, expect, test } from "bun:test";

import {
  HfScoutError,
  inspectHfRepository,
  searchHfRepositories,
  type HubReader,
} from "../src/index.js";

const OBSERVED_AT = "2026-07-30T12:00:00.000Z";
const REVISION = "a".repeat(40);

function reader(overrides: Partial<HubReader> = {}): HubReader {
  return {
    async inspect() {
      return {
        id: "org/model",
        sha: REVISION,
        pipeline_tag: "text-generation",
        library_name: "transformers",
        gated: false,
        private: false,
        tags: [
          "base_model:org/base",
          "license:mit",
          "arxiv:2607.12345",
        ],
        cardData: {
          license: "mit",
          base_model: "org/base",
        },
        siblings: [
          {
            rfilename: "weights.safetensors",
            size: 12,
            blobId: "d".repeat(40),
            lfs: {
              sha256: "b".repeat(64),
              size: 12,
              pointerSize: 132,
            },
          },
          {
            rfilename: "config.json",
            size: 2,
            blobId: "c".repeat(40),
          },
        ],
      };
    },
    async search() {
      return [];
    },
    ...overrides,
  };
}

describe("inspectHfRepository", () => {
  test("projects an exact matched revision without claiming local verification", async () => {
    let inspectedRevision: string | undefined;
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model", revision: REVISION },
      {
        reader: reader({
          async inspect(input) {
            inspectedRevision = input.revision;
            return await reader().inspect(input);
          },
        }),
        observed_at: OBSERVED_AT,
      },
    );

    expect(inspectedRevision).toBe(REVISION);
    expect(report.status).toBe("observed");
    expect(report.transport).toEqual({
      kind: "injected",
      requested_effect: "read_only",
      credentials: "caller_owned",
      retries: "caller_owned",
      response_body: "caller_owned",
    });
    expect(report.snapshot.revision).toEqual({
      requested_full_sha: REVISION,
      resolved_full_sha: REVISION,
      state: "exact_revision_match",
    });
    expect(report.snapshot.provenance_grade).toBe("caller_supplied_exact_revision_metadata");
    expect(report.snapshot.observation).toEqual({
      transport: "injected",
      repository_association: "caller_owned",
      reference: "requested_exact_revision",
    });
    expect(report.snapshot.declared).toMatchObject({
      basis: "publisher_assertion",
      license: "mit",
      task: "text-generation",
      library: "transformers",
      gated: false,
      private: false,
      base_models: ["org/base"],
      papers: ["2607.12345"],
    });
    expect(report.snapshot.files.map((entry) => entry.path)).toEqual([
      "config.json",
      "weights.safetensors",
    ]);
    expect(report.snapshot.files[1]).toMatchObject({
      sha256: "b".repeat(64),
      git_blob_sha1: "d".repeat(40),
      xet_hash: null,
    });
    expect(report.snapshot.files.every((entry) => entry.verified_locally === false)).toBe(true);
    expect(report.snapshot.boundary_codes).toContain("publisher_metadata_unverified");
    expect(report.snapshot.boundary_codes).toContain("caller_owned_reader");
    expect(report.snapshot.boundary_codes).toContain("scout_files_not_downloaded");
    expect(report.snapshot.boundary_codes).toContain("scout_model_code_not_executed");
    expect(report.snapshot.boundary_codes).not.toContain("files_not_downloaded");
    expect(report.snapshot.boundary_codes).not.toContain("model_code_not_executed");
  });

  test("labels unresolved and incomplete observations instead of inventing facts", async () => {
    const report = await inspectHfRepository(
      { kind: "dataset", id: "org/data" },
      {
        reader: reader({
          async inspect() {
            return {
              id: "org/data",
              tags: ["tag-ok", "bad\u202etext"],
              siblings: [
                { rfilename: "a.json", size: 1 },
                { rfilename: "../escape", size: 2 },
              ],
            };
          },
        }),
        observed_at: OBSERVED_AT,
        limits: { max_files: 1 },
      },
    );

    expect(report.status).toBe("partial");
    expect(report.snapshot.revision).toEqual({
      requested_full_sha: null,
      resolved_full_sha: null,
      state: "unresolved",
    });
    expect(report.snapshot.provenance_grade).toBe("mutable_observation");
    expect(report.snapshot.declared.license).toBeNull();
    expect(report.snapshot.declared.tags).toEqual(["tag-ok"]);
    expect(report.snapshot.file_inventory).toBe("truncated");
    expect(report.snapshot.boundary_codes).toContain("mutable_head_observation");
    expect(report.diagnostics.map((entry) => entry.code)).toEqual([
      "content_commitments_partial",
      "file_inventory_truncated",
      "license_unknown",
      "revision_unresolved",
      "tags_omitted",
    ]);
  });

  test("rejects a response for a different repository", async () => {
    await expect(
      inspectHfRepository(
        { kind: "model", id: "org/model" },
        {
          reader: reader({
            async inspect() {
              return { id: "other/model", sha: REVISION };
            },
          }),
          observed_at: OBSERVED_AT,
        },
      ),
    ).rejects.toMatchObject({ code: "hub_subject_mismatch" });
  });

  test("fails closed when an exact revision response omits or changes identity", async () => {
    await expect(
      inspectHfRepository(
        { kind: "model", id: "org/model", revision: REVISION },
        {
          reader: reader({ async inspect() { return { sha: REVISION }; } }),
          observed_at: OBSERVED_AT,
        },
      ),
    ).rejects.toMatchObject({ code: "hub_subject_unresolved" });

    await expect(
      inspectHfRepository(
        { kind: "model", id: "org/model", revision: REVISION },
        {
          reader: reader({
            async inspect() {
              return { id: "org/model", sha: "b".repeat(40) };
            },
          }),
          observed_at: OBSERVED_AT,
        },
      ),
    ).rejects.toMatchObject({ code: "hub_revision_mismatch" });
  });

  test("rejects mutable or uppercase revision selectors before reading", async () => {
    let calls = 0;
    const rejectingReader = reader({
      async inspect() {
        calls += 1;
        return {};
      },
    });
    for (const revision of ["main", REVISION.toUpperCase()]) {
      await expect(
        inspectHfRepository(
          { kind: "model", id: "org/model", revision },
          { reader: rejectingReader, observed_at: OBSERVED_AT },
        ),
      ).rejects.toMatchObject({ code: "invalid_revision" });
    }
    expect(calls).toBe(0);
  });

  test("bounds publisher relationship arrays", async () => {
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      {
        reader: reader({
          async inspect() {
            return {
              id: "org/model",
              sha: REVISION,
              tags: ["license:mit"],
              cardData: {
                base_model: ["org/a", "org/b", "org/c"],
              },
              siblings: [],
            };
          },
        }),
        observed_at: OBSERVED_AT,
        limits: { max_tags: 2 },
      },
    );
    expect(report.snapshot.declared.base_models).toEqual(["org/a", "org/b"]);
    expect(report.diagnostics.map((entry) => entry.code)).toEqual([
      "declared_relations_truncated",
    ]);
  });

  test("sanitizes an injected reader failure", async () => {
    await expect(
      inspectHfRepository(
        { kind: "model", id: "org/model" },
        {
          reader: reader({
            async inspect() {
              throw new Error("credential-shaped private detail");
            },
          }),
          observed_at: OBSERVED_AT,
        },
      ),
    ).rejects.toEqual(
      new HfScoutError("injected_reader_failed", "Injected Hub reader failed"),
    );
  });

  test("does not trust a structural reader's public transport label", async () => {
    const spoofed = {
      ...reader(),
      transport: "public_hub_api",
    };
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: spoofed, observed_at: OBSERVED_AT },
    );
    expect(report.transport).toEqual({
      kind: "injected",
      requested_effect: "read_only",
      credentials: "caller_owned",
      retries: "caller_owned",
      response_body: "caller_owned",
    });
  });
});

describe("searchHfRepositories", () => {
  test("returns bounded sorted leads without fetching or executing them", async () => {
    let inspectCalls = 0;
    const report = await searchHfRepositories(
      { kind: "space", query: "kingdom", limit: 2 },
      {
        reader: reader({
          async inspect() {
            inspectCalls += 1;
            return {};
          },
          async search() {
            return [
              { id: "z/space", sha: REVISION, tags: ["license:mit"] },
              { id: "a/space", private: false, gated: "manual" },
              { id: "extra/space" },
            ];
          },
        }),
        observed_at: OBSERVED_AT,
      },
    );

    expect(inspectCalls).toBe(0);
    expect(report.hits.map((hit) => hit.id)).toEqual(["a/space", "z/space"]);
    expect(report.hits[0]?.gated_declared).toBe("manual");
    expect(report.diagnostics.map((entry) => entry.code)).toEqual(["search_truncated"]);
  });
});
