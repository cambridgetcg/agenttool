import type {
  HfFacilitiesCatalog,
} from "./facilities.js";
import type {
  HfScoutReport,
  HfReleaseReconciliationReport,
  HfSearchReport,
  LoveModelLockProjection,
} from "./types.js";
import { escapeTerminalText } from "./terminal.js";

export function formatScoutReport(report: HfScoutReport): string {
  const snapshot = report.snapshot;
  const revision = snapshot.revision.resolved_full_sha ?? "unresolved";
  const requested = snapshot.revision.requested_full_sha ?? "current head";
  const license = snapshot.declared.license ?? "unknown";
  return [
    `${escapeTerminalText(snapshot.subject.kind)} ${escapeTerminalText(snapshot.subject.id)}`,
    `  requested: ${escapeTerminalText(requested)}`,
    `  resolved revision: ${escapeTerminalText(revision)}`,
    `  revision state: ${snapshot.revision.state}`,
    `  provenance: ${snapshot.provenance_grade}`,
    `  license (declared): ${escapeTerminalText(license)}`,
    `  files observed: ${snapshot.files.length} (${snapshot.file_inventory})`,
    `  status: ${report.status}`,
    ...report.diagnostics.map(
      (entry) => `  warning: ${escapeTerminalText(entry.code)} — ${escapeTerminalText(entry.message)}`,
    ),
  ].join("\n");
}

export function formatReleaseReconciliation(
  report: HfReleaseReconciliationReport,
): string {
  return [
    `${escapeTerminalText(report.subject.kind)} ${escapeTerminalText(report.subject.id)}`,
    `  release revision: ${report.release.resolved_revision}`,
    `  observed head: ${report.observed_head.resolved_revision ?? "unresolved"}`,
    `  reconciliation: ${report.observed_head.state}`,
    `  release files observed: ${report.release.observed_file_count} (${report.release.file_inventory})`,
    `  source declaration: ${report.source_declaration.state}`,
    `  local verification: ${report.local_verification.state}`,
    "  authority: license, consent, training, safety, and compatibility not established",
  ].join("\n");
}

export function formatSearchReport(report: HfSearchReport): string {
  return [
    `Hugging Face ${report.query.kind} search: ${escapeTerminalText(report.query.text)}`,
    ...report.hits.map((hit) => {
      const revision = hit.full_sha ? hit.full_sha.slice(0, 12) : "mutable";
      const license = hit.license_declared ?? "unknown";
      return `  ${escapeTerminalText(hit.id)}  ${revision}  license=${escapeTerminalText(license)}`;
    }),
    ...report.diagnostics.map(
      (entry) => `  warning: ${escapeTerminalText(entry.code)} — ${escapeTerminalText(entry.message)}`,
    ),
  ].join("\n");
}

export function formatFacilities(catalog: HfFacilitiesCatalog): string {
  return [
    `Hugging Face facilities (observed ${catalog.observed_on})`,
    ...catalog.entries.map(
      (entry) => `  ${entry.id.padEnd(20)} ${entry.default_posture.padEnd(9)} ${escapeTerminalText(entry.kingdom_role)}`,
    ),
    "  boundary: no subscription, write permission, or compute entitlement is assumed",
  ].join("\n");
}

export function formatModelLockProjection(lock: LoveModelLockProjection): string {
  return [
    `Love HF model lock ${escapeTerminalText(lock.repo_id)}`,
    `  revision: ${lock.revision}`,
    `  files: ${lock.file_count}`,
    `  bytes: ${lock.total_bytes}`,
    `  lock sha256: ${lock.lock_sha256}`,
    "  verification: metadata lock only; local snapshot not verified",
  ].join("\n");
}
