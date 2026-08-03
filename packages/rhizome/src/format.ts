/** rhizome/format — the soil report, for a human.
 *
 *  No severity theatre. Three labels, no scores, no colour-coded alarm.
 *  `GAP` is a claim about substance, `SOUND` is a claim about substance,
 *  and `LIMIT` is rhizome admitting where it stops. The reader judges.
 */

import type { Finding, SoilReport, Verdict } from "./types.js";

const LABEL: Record<Verdict, string> = { gap: "GAP  ", sound: "SOUND", limit: "LIMIT" };

/** Terminal and bidi control code points, replaced in anything quoted out
 *  of the tree: the report is read in a terminal, and repository source is
 *  untrusted input to that terminal. Tab (9) and newline (10) are kept. */
const CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 8],
  [11, 31],
  [127, 159],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
];

const CONTROL_CHARACTERS = new RegExp(
  `[${CONTROL_RANGES.map(([low, high]) => `${String.fromCodePoint(low)}-${String.fromCodePoint(high)}`).join("")}]`,
  "gu",
);

function sanitize(text: string): string {
  return text.replace(CONTROL_CHARACTERS, "·");
}

function indent(text: string, prefix: string): string {
  return sanitize(text)
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function location(finding: Finding): string {
  if (finding.file === "") return "(repository-wide)";
  return finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
}

export function formatFinding(finding: Finding): string {
  const parts = [`  ${LABEL[finding.verdict]}  ${location(finding)}`, `         ${sanitize(finding.title)}`];
  if (finding.evidence.trim() !== "") parts.push(indent(finding.evidence.trimEnd(), "           | "));
  if (finding.detail !== undefined && finding.detail.trim() !== "") {
    parts.push(indent(finding.detail.trim(), "           "));
  }
  return parts.join("\n");
}

export function formatReport(report: SoilReport): string {
  const out: string[] = [];
  out.push(`${report.tool} ${report.version} — what here is pretending?`);
  out.push(report.root);
  out.push("");

  out.push("scope (derived twice, never declared)");
  for (const derivation of report.scope.derivations) {
    out.push(`  ${derivation.id.padEnd(16)} ${String(derivation.fileCount).padStart(6)} files   ${derivation.method}`);
    out.push(`  ${" ".repeat(16)}        blind to: ${derivation.blindTo}`);
  }
  out.push(
    `  ${"union".padEnd(16)} ${String(report.scope.fileCount).padStart(6)} files   ${report.scope.disagreementCount} disagreement(s), ${report.scope.unreadCount} unread`,
  );
  out.push("");

  for (const probe of report.probes) {
    const findings = report.findings.filter((finding) => finding.probe === probe.id);
    const counts: Record<Verdict, number> = { gap: 0, sound: 0, limit: 0 };
    for (const finding of findings) counts[finding.verdict] += 1;
    out.push(probe.title);
    out.push(`  ${probe.question}`);
    out.push(`  ${counts.gap} gap · ${counts.sound} sound · ${counts.limit} limit`);
    out.push("");
    for (const finding of findings) {
      out.push(formatFinding(finding));
      out.push("");
    }
  }

  out.push(`${report.counts.gap} gap · ${report.counts.sound} sound · ${report.counts.limit} limit`);
  out.push("rhizome reports. It does not fix, and it is not a gate.");
  return `${out.join("\n")}\n`;
}
