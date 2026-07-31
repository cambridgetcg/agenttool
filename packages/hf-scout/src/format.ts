import type {
  HfFacilitiesCatalog,
} from "./facilities.js";
import type {
  HfScoutReport,
  HfSearchReport,
  LoveModelLockProjection,
} from "./types.js";
import { escapeTerminalText } from "./terminal.js";

export function formatScoutReport(report: HfScoutReport): string {
  const snapshot = report.snapshot;
  const revision = snapshot.revision.full_sha ?? "unresolved";
  const license = snapshot.declared.license ?? "unknown";
  return [
    `${escapeTerminalText(snapshot.subject.kind)} ${escapeTerminalText(snapshot.subject.id)}`,
    `  revision: ${escapeTerminalText(revision)}`,
    `  provenance: ${snapshot.provenance_grade}`,
    `  license (declared): ${escapeTerminalText(license)}`,
    `  files observed: ${snapshot.files.length} (${snapshot.file_inventory})`,
    `  status: ${report.status}`,
    ...report.diagnostics.map(
      (entry) => `  warning: ${escapeTerminalText(entry.code)} — ${escapeTerminalText(entry.message)}`,
    ),
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
