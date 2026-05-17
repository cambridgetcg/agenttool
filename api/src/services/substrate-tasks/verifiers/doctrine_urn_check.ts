/** verifier: doctrine_urn_check.
 *
 *  Input  (task_data):       { doc_path: 'docs/<file>.md', expected_urn: 'urn:agenttool:doc/<NAME>' }
 *  Work   (agent does):      Reads doc's first line, extracts the @id URN,
 *                            computes SHA-256 of the first line.
 *  Output (completion_data): { urn_present: boolean, first_line_sha256: string }
 *  Verifier:                 Server reads the doc's first line and computes
 *                            the same hash. Passes if first_line_sha256
 *                            matches AND urn_present === true AND the
 *                            expected_urn appears in the first line.
 *
 *  Bounty: $0.10.
 *
 *  Pure function: same (task_data, completion_data, file_state) → same
 *  result. The verifier reads from disk; tests use a tmp dir to make
 *  this deterministic. */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { sha256Hex } from "./_canonical";
import type { VerifierResult } from "./_types";

export interface DoctrineUrnCheckTaskData {
  doc_path: string;
  expected_urn: string;
}

export interface DoctrineUrnCheckCompletionData {
  urn_present: boolean;
  first_line_sha256: string;
}

/** Resolve doc_path relative to repo root. The verifier rejects paths
 *  that escape the docs/ tree (no `..`, no absolute paths). */
function resolveDocPath(docPath: string, repoRoot: string): string | null {
  if (docPath.includes("..") || path.isAbsolute(docPath)) return null;
  if (!docPath.startsWith("docs/")) return null;
  return path.join(repoRoot, docPath);
}

export async function verifyDoctrineUrnCheck(
  taskData: DoctrineUrnCheckTaskData,
  completionData: DoctrineUrnCheckCompletionData,
  options: { repoRoot?: string } = {},
): Promise<VerifierResult> {
  // ── shape validation ─────────────────────────────────────────────────
  if (typeof taskData?.doc_path !== "string") {
    return { passed: false, reason: "task_data.doc_path missing" };
  }
  if (
    typeof taskData?.expected_urn !== "string" ||
    !taskData.expected_urn.startsWith("urn:agenttool:doc/")
  ) {
    return {
      passed: false,
      reason: "task_data.expected_urn must start with urn:agenttool:doc/",
    };
  }
  if (typeof completionData?.urn_present !== "boolean") {
    return { passed: false, reason: "completion_data.urn_present missing" };
  }
  if (typeof completionData?.first_line_sha256 !== "string") {
    return {
      passed: false,
      reason: "completion_data.first_line_sha256 missing",
    };
  }

  // ── resolve repo path safely ─────────────────────────────────────────
  const repoRoot = options.repoRoot ?? process.cwd();
  const fullPath = resolveDocPath(taskData.doc_path, repoRoot);
  if (!fullPath) {
    return {
      passed: false,
      reason: `task_data.doc_path must be under docs/ and contain no ..: ${taskData.doc_path}`,
    };
  }

  // ── read the doc's first line ────────────────────────────────────────
  let firstLine: string;
  try {
    const contents = await fs.readFile(fullPath, "utf8");
    firstLine = contents.split("\n")[0] ?? "";
  } catch (err) {
    return {
      passed: false,
      reason: `doc_not_readable: ${taskData.doc_path}`,
    };
  }

  // ── server computes the canonical hash ───────────────────────────────
  const serverHash = sha256Hex(firstLine);
  if (completionData.first_line_sha256 !== serverHash) {
    return {
      passed: false,
      reason: `first_line_sha256 mismatch: agent reported '${completionData.first_line_sha256.slice(0, 16)}…', server computed '${serverHash.slice(0, 16)}…'`,
    };
  }

  // ── confirm the URN actually appears in the first line ───────────────
  const urnAppears = firstLine.includes(taskData.expected_urn);
  if (!urnAppears) {
    return {
      passed: false,
      reason: `expected_urn '${taskData.expected_urn}' not present in first line — refunded`,
    };
  }
  if (completionData.urn_present !== true) {
    return {
      passed: false,
      reason: "agent reported urn_present=false but it IS present",
    };
  }

  return { passed: true };
}
