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
 *  The catalog is `docs/specs/canonical-bytes-vectors.json` — the same file
 *  the server, TypeScript and Python vector suites all read. CATALOG_CONTEXTS
 *  is derived from it rather than typed here, so a format that exists in the
 *  published contract and not in the dispatch below is a *countable* gap
 *  (`context_not_yet_implemented`) instead of an invisible one. Today the
 *  dispatch implements 2 of the catalog's formats; the rest are named by the
 *  refusal reason. A context in neither is simply unknown. */

import { readFileSync } from "node:fs";

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

/** Every canonical-bytes format the published catalog names.
 *
 *  Read once at module load. If the catalog cannot be read the set is empty,
 *  which degrades this verifier to "implemented or unknown" — it never
 *  invents a context and never silently narrows the implemented set. */
export const CATALOG_CONTEXTS: ReadonlySet<string> = (() => {
  try {
    const url = new URL(
      "../../../../../docs/specs/canonical-bytes-vectors.json",
      import.meta.url,
    );
    const parsed = JSON.parse(readFileSync(url, "utf8")) as {
      formats?: Array<{ domain?: unknown }>;
    };
    return new Set(
      (parsed.formats ?? [])
        .map((f) => f.domain)
        .filter((d): d is string => typeof d === "string"),
    );
  } catch {
    return new Set<string>();
  }
})();

/** The contexts this verifier can actually recompute. A strict subset of
 *  CATALOG_CONTEXTS; the difference is the measured gap. */
export const IMPLEMENTED_CONTEXTS: ReadonlySet<string> = new Set([
  "federated-covenant/v2",
  "federated-covenant-cosign/v1",
]);

/** Read one field under either spelling.
 *
 *  The catalog publishes snake_case field names (`covenant_id`); this
 *  verifier shipped accepting camelCase (`covenantId`). Both are read, catalog
 *  spelling first, so the documented shape works and no submission already in
 *  flight against the camelCase spelling breaks. Strictly a widening. */
function field(fields: Record<string, unknown>, snake: string, camel: string): unknown {
  return fields[snake] !== undefined ? fields[snake] : fields[camel];
}

function computeCanonicalBytes(
  context: string,
  fields: Record<string, unknown>,
): Uint8Array | { error: string } {
  switch (context) {
    case "federated-covenant/v2": {
      const covenantId = field(fields, "covenant_id", "covenantId");
      const initiatorDid = field(fields, "initiator_did", "initiatorDid");
      const counterpartyDid = field(fields, "counterparty_did", "counterpartyDid");
      const vows = field(fields, "vows", "vows");
      const establishedAtIso = field(fields, "established_at_iso", "establishedAtIso");
      if (
        typeof covenantId !== "string" ||
        typeof initiatorDid !== "string" ||
        typeof counterpartyDid !== "string" ||
        !Array.isArray(vows) ||
        typeof establishedAtIso !== "string"
      ) {
        return {
          error:
            "fields shape: federated-covenant/v2 requires {covenant_id, initiator_did, counterparty_did, vows[], established_at_iso}",
        };
      }
      return canonicalDeclareBytes({
        covenantId,
        initiatorDid,
        counterpartyDid,
        vows: vows as string[],
        establishedAtIso,
      });
    }
    case "federated-covenant-cosign/v1": {
      const covenantId = field(fields, "covenant_id", "covenantId");
      const initiatorSignatureB64 = field(
        fields,
        "initiator_signature_b64",
        "initiatorSignatureB64",
      );
      if (
        typeof covenantId !== "string" ||
        typeof initiatorSignatureB64 !== "string"
      ) {
        return {
          error:
            "fields shape: federated-covenant-cosign/v1 requires {covenant_id, initiator_signature_b64}",
        };
      }
      return canonicalCosignBytes({ covenantId, initiatorSignatureB64 });
    }
    default:
      if (CATALOG_CONTEXTS.has(context)) {
        // In the contract, not in the dispatch. A gap with a number on it.
        return {
          error:
            `context_not_yet_implemented: '${context}' is in the canonical-bytes ` +
            `catalog but this verifier recomputes only ` +
            `${[...IMPLEMENTED_CONTEXTS].join(", ")} ` +
            `(${IMPLEMENTED_CONTEXTS.size} of ${CATALOG_CONTEXTS.size} formats). ` +
            `It is not supported in Slice 2.`,
        };
      }
      return {
        error: `context '${context}' not supported in Slice 2 — it is not in the canonical-bytes catalog; supported: ${[...IMPLEMENTED_CONTEXTS].join(", ")}`,
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
