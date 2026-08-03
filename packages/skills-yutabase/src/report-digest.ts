import { createHash } from "node:crypto";

/**
 * Hash exact canonical report bytes. Obtain the string by calling
 * `@agenttool/skills` `stableStringify(report)` with its default formatting.
 * This helper hashes only; it does not canonicalize or validate a report.
 */
export function skillsInspectionReportDigestFromCanonicalBytes(
  canonicalReportBytes: string | Uint8Array,
): string {
  return "sha256:" + createHash("sha256")
    .update(canonicalReportBytes)
    .digest("hex");
}
