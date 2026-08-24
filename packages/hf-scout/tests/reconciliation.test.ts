import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  reconcileHfRelease,
  sha256Hex,
  type HubInspectInput,
  type HubReader,
  type ReconcileHfReleaseInput,
} from "../src/index.js";

const OBSERVED_AT = "2026-08-24T12:00:00.000Z";
const RELEASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function reader(calls: HubInspectInput[]): HubReader {
  return {
    async inspect(input) {
      calls.push(input);
      return {
        id: "org/model",
        sha: input.revision ?? HEAD,
        private: false,
        gated: false,
        tags: ["license:apache-2.0"],
        siblings: [{ rfilename: "config.json", blobId: "c".repeat(40), size: 2 }],
      };
    },
    async search() {
      return [];
    },
  };
}

const FILES = [{
  path: "config.json",
  size: 2,
  sha256: null,
  git_blob_sha1: "c".repeat(40),
  xet_hash: null,
  basis: "provider_metadata" as const,
  verified_locally: false as const,
}];
const FILE_MANIFEST_SHA256 = sha256Hex(canonicalJson(FILES));

describe("release reconciliation", () => {
  test("observes an exact release and mutable head as two bounded reader operations", async () => {
    const calls: HubInspectInput[] = [];
    const report = await reconcileHfRelease(
      {
        kind: "model",
        id: "org/model",
        release_revision: RELEASE,
      },
      { reader: reader(calls), observed_at: OBSERVED_AT },
    );

    expect(calls).toHaveLength(2);
    expect(calls.map(({ kind, id, revision }) => ({ kind, id, revision }))).toEqual([
      { kind: "model", id: "org/model", revision: RELEASE },
      { kind: "model", id: "org/model", revision: undefined },
    ]);
    expect(report).toMatchObject({
      schema: "agenttool-hf-release-reconciliation/v0.2",
      tool: { name: "@agenttool/hf-scout", version: "0.2.0-dev.0" },
      operation: "reconcile_release",
      subject: { provider: "huggingface", kind: "model", id: "org/model" },
      release: {
        requested_revision: RELEASE,
        resolved_revision: RELEASE,
        state: "exact_requested_revision_observed",
        observation: { reference: "requested_exact_revision" },
        observed_file_manifest_sha256: FILE_MANIFEST_SHA256,
        observed_file_count: 1,
        observed_total_bytes: 2,
      },
      observed_head: {
        requested_reference: "current_head",
        resolved_revision: HEAD,
        state: "differs_from_release",
        observation: { reference: "current_head" },
      },
      source_declaration: { state: "not_provided" },
      local_verification: { state: "not_provided" },
    });
    expect(report.boundary).toEqual({
      publisher_claims: "unverified",
      source_declaration: "caller_supplied_or_absent",
      local_verification: "caller_reported_or_absent",
      license_truth: "not_established",
      consent: "not_established",
      training_authority: "not_established",
      safety: "not_established",
      compatibility: "not_established",
      hub_files_downloaded: false,
      model_code_executed: false,
      remote_compute_invoked: false,
      hub_write_performed: false,
    });
    expect(Object.isFrozen(report)).toBe(true);
  });

  test("labels source declarations and local evidence without upgrading authority", async () => {
    const report = await reconcileHfRelease(
      {
        kind: "model",
        id: "org/model",
        release_revision: RELEASE,
        source_declaration: {
          basis: "caller_declaration",
          source_revision: RELEASE,
          source_manifest_sha256: FILE_MANIFEST_SHA256,
        },
        local_verification: {
          basis: "caller_supplied_local_verification",
          release_revision: RELEASE,
          file_manifest_sha256: FILE_MANIFEST_SHA256,
          verified_file_count: 1,
          verified_total_bytes: 2,
        },
      },
      { reader: reader([]), observed_at: OBSERVED_AT },
    );

    expect(report.source_declaration).toEqual({
      state: "caller_supplied",
      basis: "caller_declaration",
      source_revision: RELEASE,
      source_manifest_sha256: FILE_MANIFEST_SHA256,
      manifest_comparison: "matches_provider_observation",
    });
    expect(report.local_verification).toEqual({
      state: "caller_reported",
      basis: "caller_supplied_local_verification",
      release_revision: RELEASE,
      file_manifest_sha256: FILE_MANIFEST_SHA256,
      verified_file_count: 1,
      verified_total_bytes: 2,
      manifest_comparison: "matches_provider_observation",
    });
  });

  test("rejects paper reconciliation and mismatched local revision before projection", async () => {
    const calls: HubInspectInput[] = [];
    await expect(reconcileHfRelease(
      {
        kind: "paper",
        id: "2608.12345",
        release_revision: RELEASE,
      } as unknown as ReconcileHfReleaseInput,
      { reader: reader(calls), observed_at: OBSERVED_AT },
    )).rejects.toMatchObject({ code: "unsupported_reconciliation_kind" });
    expect(calls).toHaveLength(0);

    await expect(reconcileHfRelease(
      {
        kind: "model",
        id: "org/model",
        release_revision: RELEASE,
        local_verification: {
          basis: "caller_supplied_local_verification",
          release_revision: HEAD,
          file_manifest_sha256: FILE_MANIFEST_SHA256,
          verified_file_count: 1,
          verified_total_bytes: 2,
        },
      },
      { reader: reader([]), observed_at: OBSERVED_AT },
    )).rejects.toMatchObject({ code: "local_verification_revision_mismatch" });
  });
});
