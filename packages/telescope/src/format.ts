import type { TelescopeClaim, TelescopeReport } from "./types.js";

export function escapeTerminalText(value: string, maxLength = 500): string {
  const escaped = value.replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu,
    (character) => {
      const code =
        character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000";
      return `\\u${code}`;
    },
  );
  return escaped.length <= maxLength
    ? escaped
    : `${escaped.slice(0, maxLength)}…`;
}

function displayClaimValue(value: TelescopeClaim["value"]): string {
  if (Array.isArray(value)) return escapeTerminalText(JSON.stringify(value));
  if (typeof value === "string") return escapeTerminalText(value);
  return String(value);
}

export function formatTelescopeReport(
  report: TelescopeReport,
  format: "human" | "json" = "human",
): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;

  const lines = [
    `Telescope ${escapeTerminalText(report.tool.version)} — ${escapeTerminalText(report.subject.origin)}`,
    `status: ${report.status}`,
    `mode: public HTTPS, read-only GETs, credentials omitted · transport ${report.network_boundary.http_transport} · resolver ${report.network_boundary.dns_resolver}`,
    `network boundary: ${escapeTerminalText(report.network_boundary.statement, 2_048)}`,
    "",
    "Sources",
  ];

  for (const source of report.sources) {
    const suffix = [
      source.status_code === null ? null : `HTTP ${source.status_code}`,
      source.bytes === null ? null : `${source.bytes} bytes`,
      source.error_code,
    ]
      .filter((value): value is string => Boolean(value))
      .join(", ");
    lines.push(
      `- ${source.id}: ${source.state}${suffix ? ` (${escapeTerminalText(suffix)})` : ""}`,
      `  ${escapeTerminalText(source.final_url ?? source.url)}`,
    );
  }

  lines.push("", "Surfaces");
  for (const surface of report.surfaces) {
    lines.push(
      `- ${surface.id}: ${surface.state} · schema ${surface.schema_conformance}`,
    );
    for (const item of surface.claims) {
      lines.push(
        `  ${escapeTerminalText(item.key)} = ${displayClaimValue(item.value)} [${item.basis}]`,
      );
    }
    if (surface.boundary_codes.length > 0) {
      lines.push(`  boundaries: ${surface.boundary_codes.join(", ")}`);
    }
  }

  lines.push(
    "",
    "Generated actions (never executed by Telescope; POSIX display, prefer executable + argv)",
  );
  if (report.actions.length === 0) {
    lines.push("- none");
  } else {
    for (const action of report.actions) {
      lines.push(
        `- ${action.id}: ${escapeTerminalText(action.display, 32_768)}`,
        `  boundaries: ${action.boundary_codes.join(", ")}`,
      );
    }
  }

  lines.push("", "Extensions");
  for (const extension of report.extensions) {
    lines.push(
      `- ${escapeTerminalText(extension.id)}: ${extension.state} — ${escapeTerminalText(extension.summary)}`,
    );
  }

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics");
    for (const item of report.diagnostics) {
      lines.push(
        `- ${item.level} ${escapeTerminalText(item.code)}: ${escapeTerminalText(item.message)}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
