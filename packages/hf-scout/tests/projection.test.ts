import { describe, expect, test } from "bun:test";

import {
  createKingdomHfSidecar,
  inspectHfRepository,
  projectAgentDataTextRequest,
  projectLoveModelLock,
  sha256Hex,
  type HubReader,
} from "../src/index.js";

const REVISION = "a".repeat(40);
const LOCK = {
  schema: "love.huggingface-model-lock/v1",
  repo_type: "model",
  repo_id: "org/model",
  revision: REVISION,
  hub_url: "https://huggingface.co/org/model",
  last_modified: "2026-01-01T00:00:00.000Z",
  license: "mit",
  base_model: "org/base",
  task: "text-generation",
  library: "transformers",
  files: [
    {
      path: "config.json",
      size: 2,
      sha256: "b".repeat(64),
      git_blob_sha1: "c".repeat(40),
    },
  ],
};

function fixtureReader(): HubReader {
  return {
    async inspect() {
      return {
        id: "org/model",
        sha: REVISION,
        tags: ["license:mit"],
        siblings: [
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
  };
}

describe("Love model lock projection", () => {
  test("matches the Python lock canonical digest without claiming snapshot verification", () => {
    const projection = projectLoveModelLock(LOCK);
    expect(projection.lock_sha256).toBe(
      "62bf12aab42e9c9a7bb08ecf95e282f9ed212c4b5a780f09f8d4e6d0647bea8b",
    );
    expect(projection).toMatchObject({
      repo_id: "org/model",
      revision: REVISION,
      file_count: 1,
      total_bytes: 2,
      verification: "metadata_lock_only",
      snapshot_verified: false,
    });
  });

  test("rejects hidden extra fields and mutable revisions", () => {
    expect(() => projectLoveModelLock({ ...LOCK, token: "not-accepted" }))
      .toThrow("object contains unsupported fields");
    expect(() => projectLoveModelLock({ ...LOCK, revision: "main" }))
      .toThrow("full commit SHA");
  });

  test("uses Python-compatible code-point order instead of host locale order", () => {
    const files = [
      "\ue000.json",
      "\u{10000}.json",
    ].map((path, index) => ({
      path,
      size: index,
      sha256: String(index + 1).repeat(64),
      git_blob_sha1: String(index + 4).repeat(40),
    }));
    expect(projectLoveModelLock({ ...LOCK, files }).lock_sha256).toBe(
      "ab69a6ff4ca5d32b7b7e05a8a9819d45d16b06247198df66dbb14c00785cdf5c",
    );
    expect(() => projectLoveModelLock({ ...LOCK, files: [...files].reverse() }))
      .toThrow("must be sorted");
  });

  test("accepts creator-shaped nullable metadata and optional Git blob commitments", () => {
    const projection = projectLoveModelLock({
      ...LOCK,
      last_modified: null,
      base_model: null,
      task: null,
      library: null,
      files: [{
        path: "config.json",
        size: 2,
        sha256: "b".repeat(64),
      }],
    });
    expect(projection.declared).toEqual({
      license: "mit",
      base_model: null,
      task: null,
      library: null,
    });
  });

  test("preserves creator-shaped base-model lists", () => {
    const projection = projectLoveModelLock({
      ...LOCK,
      base_model: ["org/base-a", "org/base-b"],
    });
    expect(projection.declared.base_model).toEqual([
      "org/base-a",
      "org/base-b",
    ]);
  });
});

describe("KINGDOM and Agent Data projections", () => {
  test("keeps observation time outside stable artifact bytes", async () => {
    const first = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    const second = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: fixtureReader(), observed_at: "2026-07-30T13:00:00.000Z" },
    );
    const firstRequest = projectAgentDataTextRequest(first);
    const secondRequest = projectAgentDataTextRequest(second);
    const snapshotSha256 = sha256Hex(firstRequest.input.text);
    const version = `${REVISION}:sha256:${snapshotSha256}`;

    expect(firstRequest.input.text).toBe(secondRequest.input.text);
    expect(firstRequest.input.observed_at).not.toBe(secondRequest.input.observed_at);
    expect(firstRequest).toMatchObject({
      collection_id: "kingdom-hf-scout",
      collector_id: "text",
      input: {
        source_uri: `https://huggingface.co/org/model/tree/${REVISION}`,
        external_id: `hf:model:org/model@${version}`,
        key: "hf:model:org/model",
        version,
        metadata: {
          snapshot_sha256: snapshotSha256,
          taint: "remote_untrusted",
        },
      },
    });
  });

  test("binds Agent Data identity to exact snapshot bytes at one revision", async () => {
    const first = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    const changedReader: HubReader = {
      ...fixtureReader(),
      async inspect() {
        return {
          id: "org/model",
          sha: REVISION,
          private: true,
          tags: ["license:mit", "changed-setting"],
          siblings: [],
        };
      },
    };
    const changed = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: changedReader, observed_at: "2026-07-30T13:00:00.000Z" },
    );
    const firstRequest = projectAgentDataTextRequest(first);
    const changedRequest = projectAgentDataTextRequest(changed);

    expect(firstRequest.input.text).not.toBe(changedRequest.input.text);
    expect(firstRequest.input.external_id).not.toBe(changedRequest.input.external_id);
    expect(firstRequest.input.version).not.toBe(changedRequest.input.version);
    expect(changedRequest.input.metadata.snapshot_sha256)
      .toBe(sha256Hex(changedRequest.input.text));
  });

  test("builds a sorted closed sidecar and rejects duplicates", async () => {
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    const lock = projectLoveModelLock(LOCK);
    const sidecar = createKingdomHfSidecar({
      generated_at: "2026-07-30T12:00:00.000Z",
      reports: [report],
      model_locks: [lock],
    });
    expect(sidecar.boundary).toEqual({
      publisher_metadata: "unverified",
      source_transport_effects: "carried_in_artifact_observation",
      projector_hub_files_downloaded: false,
      projector_model_code_executed: false,
      projector_remote_compute_invoked: false,
      projector_hub_write_performed: false,
    });
    expect(Object.isFrozen(sidecar)).toBe(true);
    expect(() => createKingdomHfSidecar({
      generated_at: "2026-07-30T12:00:00.000Z",
      reports: [report, report],
    })).toThrow("duplicate logical identities");
    expect(() => createKingdomHfSidecar({
      generated_at: "2026-07-30T12:00:00.000Z",
      reports: Array.from({ length: 1_001 }, () => report),
    })).toThrow("at most 1000 artifacts");
  });

  test("refuses durable projection without an immutable commit", async () => {
    const mutableReader: HubReader = {
      ...fixtureReader(),
      async inspect() {
        return {
          id: "org/model",
          tags: ["license:mit"],
          siblings: [],
        };
      },
    };
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: mutableReader, observed_at: "2026-07-30T12:00:00.000Z" },
    );
    expect(() => projectAgentDataTextRequest(report)).toThrow("full immutable commit SHA");
  });

  test("revalidates runtime inputs instead of trusting TypeScript casts", async () => {
    const report = await inspectHfRepository(
      { kind: "model", id: "org/model" },
      { reader: fixtureReader(), observed_at: "2026-07-30T12:00:00.000Z" },
    );
    const forgedUrl = {
      ...report,
      snapshot: {
        ...report.snapshot,
        subject: {
          ...report.snapshot.subject,
          url: "https://huggingface.co/other/model",
        },
      },
    };
    expect(() => projectAgentDataTextRequest(forgedUrl)).toThrow("unsupported fields");

    const extraField = {
      ...report,
      snapshot: {
        ...report.snapshot,
        hidden: "not allowed",
      },
    };
    expect(() => createKingdomHfSidecar({
      generated_at: "2026-07-30T12:00:00.000Z",
      reports: [extraField],
    })).toThrow("unsupported fields");

    const falseBoundary = {
      ...report,
      snapshot: {
        ...report.snapshot,
        boundary_codes: ["trusted"],
      },
    };
    expect(() => createKingdomHfSidecar({
      generated_at: "2026-07-30T12:00:00.000Z",
      reports: [falseBoundary],
    })).toThrow("boundary code is invalid");
    expect(() => projectAgentDataTextRequest(falseBoundary))
      .toThrow("boundary code is invalid");

    const upgradedObservation = {
      ...report,
      snapshot: {
        ...report.snapshot,
        observation: {
          transport: "public_hub_api" as const,
          repository_association: "provider_response" as const,
        },
        provenance_grade: "provider_observed_commit_metadata" as const,
      },
    };
    expect(() => createKingdomHfSidecar({
      generated_at: "2026-07-30T12:00:00.000Z",
      reports: [upgradedObservation],
    })).toThrow("report and snapshot transports do not match");
    expect(() => projectAgentDataTextRequest(upgradedObservation))
      .toThrow("report and snapshot transports do not match");
  });
});
