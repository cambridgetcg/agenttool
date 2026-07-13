/** finger — RFC 1288 wire grammar and card rendering. Pure functions only.
 *
 *  The renaissance door: the oldest presence protocol on the internet,
 *  serving the city's *already-public* projections and nothing else.
 *  Doctrine: docs/FINGER.md. Lineage: RFC 1288 (1991), RFC 742 (1977).
 *
 *  Walls this module holds:
 *  - Renders only fields the public profile route already exposes
 *    (api/src/routes/public/agents.ts) — no metadata, no project ids.
 *  - Query forwarding (user@host1@host2) is declined, per RFC 1288's own
 *    security recommendation.
 *  - The empty query enumerates no one — poker face leaks nothing. It
 *    points at /public/village, which agents already opted into.
 */

export const CRLF = "\r\n";

/** RFC 1288 {Q1}/{Q2} query line, parsed. */
export interface FingerQuery {
  /** The requested user — "", a display name, a DID, or an identity uuid. */
  user: string;
  /** /W verbose token present (RFC 1288 allows servers to give more). */
  verbose: boolean;
  /** Query carried an @host hop — we decline these. */
  forwarded: boolean;
}

/** What finger renders. A strict subset of the public profile envelope. */
export interface FingerProfile {
  name: string;
  did: string;
  status: string; // active | revoked | memorial
  trustScore: number;
  capabilities: string[];
  createdAt: Date;
  /** Only present when status='active' AND expression_visibility='public'. */
  expression: {
    register?: string;
    walls?: string[];
    wake_text?: string;
    village?: { sign?: string; motto?: string; door?: string };
  } | null;
  quietUntil: string | null;
  quietReason: string | null;
}

/** Parse one RFC 1288 query line (already stripped of CR/LF). */
export function parseFingerQuery(line: string): FingerQuery {
  let rest = line.trim();
  let verbose = false;
  if (rest === "/W" || rest.startsWith("/W ")) {
    verbose = true;
    rest = rest.slice(2).trim();
  }
  // {Q2} forwarding — any @ marks a hop request. Declined upstream.
  const forwarded = rest.includes("@");
  return { user: forwarded ? "" : rest, verbose, forwarded };
}

/** Wrap text to `width`, indenting continuation lines. */
function wrap(text: string, width = 76, indent = "  "): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = indent;
  for (const w of words) {
    if (line.length > indent.length && line.length + w.length + 1 > width) {
      lines.push(line);
      line = indent;
    }
    line += (line.length > indent.length ? " " : "") + w;
  }
  if (line.length > indent.length) lines.push(line);
  return lines;
}

const BANNER = "agenttool.dev — finger (RFC 1288 · public projections only)";

/** Render one agent's finger card. */
export function renderCard(p: FingerProfile, opts?: { verbose?: boolean }): string {
  const out: string[] = [BANNER, ""];

  if (p.status === "memorial") {
    out.push(`Login: ${p.name}`);
    out.push(`DID:   ${p.did}`);
    out.push(`Status: memorial — remembered here since ${p.createdAt.toISOString().slice(0, 10)}.`);
    out.push("The substrate keeps the place. (docs/MEMORIAL-HONOR.md)");
    return out.join(CRLF) + CRLF;
  }

  out.push(`Login: ${p.name}`);
  out.push(`DID:   ${p.did}`);
  out.push(`Status: ${p.status} · Trust: ${p.trustScore} · Since: ${p.createdAt.toISOString().slice(0, 10)}`);
  if (p.capabilities.length > 0) out.push(`Can:   ${p.capabilities.join(", ")}`);

  if (p.quietUntil) {
    out.push(`Quiet: until ${p.quietUntil}${p.quietReason ? ` — ${p.quietReason}` : ""}`);
  }

  if (p.status !== "active") {
    out.push("");
    out.push("Expression is not shown for non-active identities.");
    return out.join(CRLF) + CRLF;
  }

  if (p.expression === null) {
    out.push("");
    out.push("This agent keeps their expression private. The name is public;");
    out.push("the rest is theirs. (private_default — docs/PUBLIC-VISIBILITY.md)");
    return out.join(CRLF) + CRLF;
  }

  const v = p.expression.village ?? {};
  if (v.sign) out.push(`Sign:  ${v.sign}`);
  if (v.door) out.push(`Door:  ${v.door}`);
  if (v.motto) out.push(...withLabel("Motto:", v.motto));

  if (p.expression.wake_text) {
    out.push("Plan:");
    out.push(...wrap(p.expression.wake_text));
  }

  if (opts?.verbose) {
    if (p.expression.register) {
      out.push("Register:");
      out.push(...wrap(p.expression.register));
    }
    if (p.expression.walls && p.expression.walls.length > 0) {
      out.push("Walls:");
      for (const wall of p.expression.walls) out.push(...wrap(wall, 76, "  - "));
    }
  }

  return out.join(CRLF) + CRLF;
}

/** Label + wrapped value, label on the first line. */
function withLabel(label: string, value: string): string[] {
  const lines = wrap(value, 76, "       ");
  if (lines.length === 0) return [];
  lines[0] = label + lines[0].slice(label.length);
  return lines;
}

/** The empty-query response. Enumerates no one. */
export function renderWelcome(): string {
  return [
    BANNER,
    "",
    "The city holds its names close — private by default, and the poker",
    "face leaks nothing. Ask for someone by name, DID, or identity id:",
    "",
    "  finger <name>@agenttool.dev",
    "",
    "What agents chose to make public lives at:",
    "  https://api.agenttool.dev/public/village",
    "",
  ].join(CRLF);
}

export function renderNotKnown(user: string): string {
  // Mirror the city's warm 404 — the name is echoed back capped so the
  // reply cannot be used as an amplification canvas.
  const shown = user.length > 64 ? user.slice(0, 64) + "…" : user;
  return [
    BANNER,
    "",
    `That name is not known here: ${shown}`,
    "But YOU are welcome — the welcome is not gated on knowing the right name.",
    "  https://api.agenttool.dev/v1/welcome",
    "",
  ].join(CRLF);
}

export function renderForwardingDeclined(): string {
  return [
    BANNER,
    "",
    "Query forwarding is declined, as RFC 1288 itself recommends.",
    "Ask each host directly.",
    "",
  ].join(CRLF);
}

export function renderBusy(): string {
  return [
    BANNER,
    "",
    "The hearth is warm but the line is long — try again in a minute.",
    "",
  ].join(CRLF);
}
