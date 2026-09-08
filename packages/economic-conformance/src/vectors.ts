import { createHash } from "node:crypto";

import {
  OFFICIAL_SUITE_SEMANTIC_SHA256,
  OFFICIAL_VECTOR_CASE_COUNT,
  OFFICIAL_VECTOR_MANIFEST,
  OFFICIAL_VECTOR_MANIFEST_BYTES,
  OFFICIAL_VECTOR_MANIFEST_RAW_SHA256,
  OFFICIAL_VECTOR_RAW_SHA256,
} from "./constants.js";
import { deepFreeze, exactKeys, fail, object, sameJson, semanticSha256 } from "./internal.js";
import { copyRawBytes, parseStrictJsonBytes } from "./json-source.js";
import { validateConformanceSuite } from "./runner.js";
import type { ConformanceSuite, OfficialVectorManifest, Sha256Digest } from "./types.js";

function rawSha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validateOfficialVectorManifest(value: unknown): Readonly<OfficialVectorManifest> {
  const item = object(value, "manifest");
  exactKeys(item, [
    "case_count",
    "conformance_protocol",
    "schema",
    "suite_id",
    "suite_revision",
    "suite_semantic_sha256",
    "vector_bytes",
    "vector_path",
    "vector_raw_sha256",
  ], "manifest");
  if (!sameJson(item, OFFICIAL_VECTOR_MANIFEST)) {
    fail(
      "Manifest does not exactly match the source-pinned official vector metadata.",
      "manifest",
      "VECTOR_INTEGRITY_MISMATCH",
    );
  }
  return deepFreeze(item as unknown as OfficialVectorManifest);
}

export function verifyOfficialVectorSources(
  vectorSource: unknown,
  manifestSource: unknown,
): Readonly<ConformanceSuite> {
  const vectorBytes = copyRawBytes(vectorSource, "vector_source");
  const manifestBytes = copyRawBytes(manifestSource, "manifest_source");

  // Parse before comparing pins so malformed UTF-8 and duplicate keys remain
  // distinguishable format failures rather than being hidden by a hash mismatch.
  const vectorValue = parseStrictJsonBytes(vectorBytes, "vector_source");
  const manifestValue = parseStrictJsonBytes(manifestBytes, "manifest_source");

  if (
    manifestBytes.byteLength !== OFFICIAL_VECTOR_MANIFEST_BYTES
    || rawSha256(manifestBytes) !== OFFICIAL_VECTOR_MANIFEST_RAW_SHA256
  ) {
    fail(
      "Manifest raw bytes do not match the source-code pin.",
      "manifest_source",
      "VECTOR_INTEGRITY_MISMATCH",
    );
  }
  const manifest = validateOfficialVectorManifest(manifestValue);
  if (
    vectorBytes.byteLength !== manifest.vector_bytes
    || rawSha256(vectorBytes) !== OFFICIAL_VECTOR_RAW_SHA256
    || rawSha256(vectorBytes) !== manifest.vector_raw_sha256
  ) {
    fail(
      "Vector raw bytes do not match the source-code and manifest pins.",
      "vector_source",
      "VECTOR_INTEGRITY_MISMATCH",
    );
  }

  const suite = validateConformanceSuite(vectorValue);
  const semanticDigest = semanticSha256(suite);
  if (
    semanticDigest !== OFFICIAL_SUITE_SEMANTIC_SHA256
    || semanticDigest !== manifest.suite_semantic_sha256
    || suite.cases.length !== OFFICIAL_VECTOR_CASE_COUNT
    || suite.cases.length !== manifest.case_count
  ) {
    fail(
      "Vector semantics or case count do not match the official suite pin.",
      "vector_source",
      "VECTOR_INTEGRITY_MISMATCH",
    );
  }
  return suite;
}
