import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { identityFromPrivateKeys } from "@agenttool/adds";

import {
  ARCHIVE_PROTOCOL,
  deriveCatalogHealth,
  signSnapshotDescriptor,
  verifySnapshotDescriptor,
  type SignedPlacementReceipt,
  type SignedSnapshotDescriptor,
  type SignedVerificationReceipt,
  type SnapshotDescriptorCore,
} from "../src/index.js";

interface StatusVector {
  name: string;
  capture: "complete" | "incomplete";
  placements: number;
  verified_zone_ids: string[];
  failure_domain_ids?: string[];
  required_verified_zones: number;
  expected: "observed" | "verified" | "degraded" | "incomplete";
}

interface Vectors {
  protocol: string;
  signing_vector: {
    private_seed_hex: string;
    box_seed_hex: string;
    public_key_b64url: string;
    core: Omit<SnapshotDescriptorCore, "signer">;
    expected_record_id: string;
    expected_signature_b64url: string;
  };
  status_vectors: StatusVector[];
}

const vectors = JSON.parse(await readFile(
  join(import.meta.dir, "..", "vectors", "agent-repo-archive-v0.1-vectors.json"),
  "utf8",
)) as Vectors;

describe("portable Agent Repo Archive vectors", () => {
  test("pins the canonical record ID and Ed25519 signature", () => {
    expect(vectors.protocol).toBe(ARCHIVE_PROTOCOL);
    const identity = identityFromPrivateKeys(
      "urn:test:archive-signer",
      Uint8Array.from(Buffer.from(vectors.signing_vector.private_seed_hex, "hex")),
      Uint8Array.from(Buffer.from(vectors.signing_vector.box_seed_hex, "hex")),
    );
    expect(Buffer.from(identity.signingPublicKey).toString("base64url"))
      .toBe(vectors.signing_vector.public_key_b64url);
    const signed = signSnapshotDescriptor(vectors.signing_vector.core, identity);
    expect(signed.record_id).toBe(vectors.signing_vector.expected_record_id);
    expect(signed.signature.value).toBe(vectors.signing_vector.expected_signature_b64url);
    expect(verifySnapshotDescriptor(signed)).toEqual(signed);
  });

  test("pins conservative archive health calculation", () => {
    const identity = identityFromPrivateKeys(
      "urn:test:archive-signer",
      Uint8Array.from(Buffer.from(vectors.signing_vector.private_seed_hex, "hex")),
      Uint8Array.from(Buffer.from(vectors.signing_vector.box_seed_hex, "hex")),
    );
    const complete = signSnapshotDescriptor(vectors.signing_vector.core, identity);
    for (const vector of vectors.status_vectors) {
      const snapshot = structuredClone(complete);
      snapshot.completeness.status = vector.capture;
      if (vector.capture === "incomplete") {
        snapshot.completeness.workspace.untracked_files = 1;
        snapshot.completeness.reasons = ["one untracked file is excluded"];
      }
      const placements = Array.from(
        { length: vector.placements },
        (_, index) => ({
          zone: { zone_id: `zone-${String.fromCharCode(97 + index)}` },
        }) as SignedPlacementReceipt,
      );
      const verifications = vector.verified_zone_ids.map(
        (zone_id) => ({ zone_id }) as SignedVerificationReceipt,
      );
      const zones = ["zone-a", "zone-b", "zone-c"].map((zone_id, index) => ({
        zone_id,
        transport: "other" as const,
        locator: `test:zone-${index}`,
        assurance: "simulated" as const,
        delete_authority: "unknown" as const,
        failure_domain: {
          failure_domain_id: vector.failure_domain_ids?.[index] ?? `domain-${index}`,
          provider: `provider-${index}`,
          account_root: `account-${index}`,
          region: `region-${index}`,
          credential_root: `credential-${index}`,
          media: `media-${index}`,
        },
      }));
      expect(
        deriveCatalogHealth(
          snapshot as SignedSnapshotDescriptor,
          placements,
          verifications,
          zones,
          vector.required_verified_zones,
        ),
        vector.name,
      ).toBe(vector.expected);
    }
  });
});
