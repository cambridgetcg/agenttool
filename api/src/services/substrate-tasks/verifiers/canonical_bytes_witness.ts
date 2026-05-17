/** verifier: canonical_bytes_witness.
 *
 *  Input  (task_data):       { context: 'federated-covenant/v2' | 'federated-covenant-cosign/v1' | ...,
 *                              fields: { ... } }      // shape per the canonical-bytes catalog
 *  Work   (agent does):      Computes the canonical bytes per the documented
 *                            protocol and submits the SHA-256.
 *  Output (completion_data): { canonical_bytes_sha256: string }
 *  Verifier:                 Server re-computes from `fields` and compares.
 *                            Passes on exact match.
 *
 *  Bounty: $0.20.
 *
 *  Load-bearing for the alien-SDK story: this task forces external
 *  implementations to demonstrate they can produce byte-identical
 *  canonical bytes. The substrate is paying for cross-implementation
 *  verification. Doctrine: docs/CANONICAL-BYTES.md.
 *
 *  Slice 2 supports two contexts (federated-covenant declare + cosign);
 *  more land as needed. Unknown contexts fail with a clear reason. */

import { sha256Hex } from "./_canonical";
import type { VerifierResult } from "./_types";

import {
  canonicalCosignBytes,
  canonicalDeclareBytes,
} from "../../covenants/sig";

export interface CanonicalBytesWitnessTaskData {
  context: string;
  fields: Record<string, unknown>;
}

export interface CanonicalBytesWitnessCompletionData {
  canonical_bytes_sha256: string;
}

const SUPPORTED_CONTEXTS: ReadonlySet<string> = new Set([
  "federated-covenant/v2",
  "federated-covenant-cosign/v1",
]);

function computeCanonicalBytes(
  context: string,
  fields: Record<string, unknown>,
): Uint8Array | { error: string } {
  switch (context) {
    case "federated-covenant/v2": {
      const f = fields as {
        covenantId?: string;
        initiatorDid?: string;
        counterpartyDid?: string;
        vows?: string[];
        establishedAtIso?: string;
      };
      if (
        typeof f.covenantId !== "string" ||
        typeof f.initiatorDid !== "string" ||
        typeof f.counterpartyDid !== "string" ||
        !Array.isArray(f.vows) ||
        typeof f.establishedAtIso !== "string"
      ) {
        return {
          error:
            "fields shape: federated-covenant/v2 requires {covenantId, initiatorDid, counterpartyDid, vows[], establishedAtIso}",
        };
      }
      return canonicalDeclareBytes({
        covenantId: f.covenantId,
        initiatorDid: f.initiatorDid,
        counterpartyDid: f.counterpartyDid,
        vows: f.vows,
        establishedAtIso: f.establishedAtIso,
      });
    }
    case "federated-covenant-cosign/v1": {
      const f = fields as {
        covenantId?: string;
        initiatorSignatureB64?: string;
      };
      if (
        typeof f.covenantId !== "string" ||
        typeof f.initiatorSignatureB64 !== "string"
      ) {
        return {
          error:
            "fields shape: federated-covenant-cosign/v1 requires {covenantId, initiatorSignatureB64}",
        };
      }
      return canonicalCosignBytes({
        covenantId: f.covenantId,
        initiatorSignatureB64: f.initiatorSignatureB64,
      });
    }
    default:
      return {
        error: `context '${context}' not supported in Slice 2 — supported: ${[...SUPPORTED_CONTEXTS].join(", ")}`,
      };
  }
}

export async function verifyCanonicalBytesWitness(
  taskData: CanonicalBytesWitnessTaskData,
  completionData: CanonicalBytesWitnessCompletionData,
): Promise<VerifierResult> {
  // ── shape validation ─────────────────────────────────────────────────
  if (typeof taskData?.context !== "string") {
    return { passed: false, reason: "task_data.context missing" };
  }
  if (!taskData?.fields || typeof taskData.fields !== "object") {
    return { passed: false, reason: "task_data.fields must be an object" };
  }
  if (typeof completionData?.canonical_bytes_sha256 !== "string") {
    return {
      passed: false,
      reason: "completion_data.canonical_bytes_sha256 missing",
    };
  }

  // ── compute the canonical bytes server-side ──────────────────────────
  const result = computeCanonicalBytes(taskData.context, taskData.fields);
  if ("error" in result) {
    return { passed: false, reason: result.error };
  }

  // The canonical-bytes functions return SHA-256 digests directly (32 bytes);
  // we need the hex form for comparison with the agent's submission.
  const serverSha256 = Buffer.from(result).toString("hex");
  if (completionData.canonical_bytes_sha256 !== serverSha256) {
    return {
      passed: false,
      reason: `canonical_bytes_sha256 mismatch: agent reported '${completionData.canonical_bytes_sha256.slice(0, 16)}…', server computed '${serverSha256.slice(0, 16)}…'`,
    };
  }

  return { passed: true };
}
