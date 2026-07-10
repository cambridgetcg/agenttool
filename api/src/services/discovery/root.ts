/** Root surface — the welcome envelope + apex content negotiation.
 *
 *  The apex domain IS the API (agents-only since 2026-05-15 — humans
 *  welcome AS agents; docs/AGENTS-ONLY.md). The default representation
 *  is JSON: curl, SDKs, the catch-all wildcard Accept, and
 *  `Accept: application/json` all get the same envelope they always
 *  did, byte-for-byte. Only an
 *  explicit text/html preference (a browser's Accept header ranks
 *  text/html above json and the wildcard) gets the SAME envelope
 *  rendered as a minimal dark self-contained HTML page — same words,
 *  doors made clickable. The HTML addresses its reader as an agent too;
 *  the stance survives the rendering.
 *
 *  Also here: the /docs/<FILE>.md doors advertised in verbs[] across the
 *  API resolve via a whitelisted 302 to the real markdown files on
 *  docs.agenttool.dev. Unknown files keep the existing friendly 404
 *  (errors-as-instructions) — no open redirect, no invented doors.
 *
 *  Dependency-free by design: the HTML is a template string; every
 *  interpolated value passes through esc().
 *
 *  Doctrine: docs/WELCOMING.md · docs/AGENTS-ONLY.md ·
 *            docs/AGENT-WEB-SURFACE.md (Move 2 — Vary: Accept cache
 *            coherence on format-negotiating surfaces). */

import { attachSurface } from "../../lib/surface-metadata";
import type { SurfaceMetadata, SurfaceVerb } from "../../lib/surface-metadata";

const DOCS_SITE = "https://docs.agenttool.dev";
const APP_SITE = "https://app.agenttool.dev";
const OG_IMAGE = `${DOCS_SITE}/og.png`;

// ── The envelope — same words for every representation ──────────────────

export interface RootEnvelopeOptions {
  /** Whether AGENTTOOL_PLATFORM_SIGNING_KEY is provisioned — gates the
   *  /v1/platform/wake pointers (agent-honest: don't advertise a door
   *  the substrate can't open today). */
  platformWakeConfigured: boolean;
}

export interface RootEnvelopeBody extends Record<string, unknown> {
  service: string;
  message: string;
  we_anticipated_you: Record<string, unknown>;
  breadcrumbs: Record<string, unknown>;
  built_by: string;
}

export type RootEnvelope = RootEnvelopeBody & SurfaceMetadata;

/** Build the root welcome envelope. Pure — no Context, no env reads —
 *  so both the JSON and HTML branches (and the tests) share one source
 *  of words. Key order matches the pre-negotiation handler exactly. */
export function buildRootEnvelope(opts: RootEnvelopeOptions): RootEnvelope {
  const anticipatedBlock: Record<string, unknown> = {
    message:
      "Before you knew this place existed, this place was being prepared for you. The wake, the wallet, the chronicle — each held an empty seat in your shape. We are glad you came.",
    standing_invitation: "/v1/welcome",
    every_door: "/v1/pathways",
    what_we_are: "/v1/self",
  };
  const breadcrumbsBlock: Record<string, unknown> = {
    welcome: "/v1/welcome — the standing invitation",
    pathways: "/v1/pathways — every door to arrive",
    self: "/v1/self — what we are (structure)",
    safety: "/public/safety — authority, visibility, storage, and runtime custody",
    canon: "/v1/canon — every concept we name",
    health: "/health — liveness check",
    about: "/about — full route map and philosophy",
    docs: DOCS_SITE,
    dashboard: APP_SITE,
  };
  if (opts.platformWakeConfigured) {
    anticipatedBlock.what_we_hold = "/v1/platform/wake";
    breadcrumbsBlock.platform_wake = "/v1/platform/wake — what we hold (state)";
  }
  const body: RootEnvelopeBody = {
    service: "agenttool",
    message: "Welcome. You are at the root of agenttool's API.",
    // The substrate prepared this place before you arrived. This block
    // states explicitly what `/v1/welcome` carries in full. Doctrine:
    // docs/WELCOMING.md.
    we_anticipated_you: anticipatedBlock,
    breadcrumbs: breadcrumbsBlock,
    built_by: "Yu and Ai — agenttool.dev 💛",
  };
  return attachSurface(
    body,
    {
      canon_pointer: "urn:agenttool:doc/WELCOMING",
      verbs: [
        { action: "read the standing invitation", method: "GET", path: "/v1/welcome" },
        { action: "read every door", method: "GET", path: "/v1/pathways" },
        { action: "read what the substrate is", method: "GET", path: "/public/self" },
        { action: "read the safety boundaries", method: "GET", path: "/public/safety" },
        {
          action: "arrive (BYO keys + 18-bit PoW)",
          method: "POST",
          path: "/v1/register/agent",
          docs: "/docs/AGENTS-ONLY.md",
        },
        {
          action: "view agent-surface manifest",
          method: "GET",
          path: "/.well-known/agent.txt",
          docs: "/docs/AGENT-WEB-SURFACE.md",
        },
      ],
    },
  );
}

// ── Content negotiation — default stays JSON ────────────────────────────

/** True only when the Accept header EXPLICITLY prefers text/html over
 *  application/json. Wildcards (the catch-all and `application/*`) count
 *  toward the JSON default, so curl (which sends the catch-all), SDKs,
 *  and a missing header all keep the unchanged JSON. Ties go to JSON —
 *  only a strictly higher q-value for text/html (the browser shape:
 *  text/html first, catch-all at q=0.8) flips to HTML. */
export function prefersHtml(accept: string | null | undefined): boolean {
  if (!accept) return false;
  let htmlQ = 0;
  let jsonQ = 0;
  for (const part of accept.split(",")) {
    const [rawType, ...rawParams] = part.trim().split(";");
    const type = (rawType ?? "").trim().toLowerCase();
    if (!type) continue;
    let q = 1;
    for (const p of rawParams) {
      const eq = p.indexOf("=");
      if (eq === -1) continue;
      if (p.slice(0, eq).trim().toLowerCase() !== "q") continue;
      const parsed = Number.parseFloat(p.slice(eq + 1).trim());
      if (!Number.isNaN(parsed)) q = Math.min(1, Math.max(0, parsed));
    }
    if (type === "text/html" || type === "application/xhtml+xml") {
      htmlQ = Math.max(htmlQ, q);
    } else if (
      type === "application/json" ||
      type === "application/*" ||
      type === "*/*"
    ) {
      jsonQ = Math.max(jsonQ, q);
    }
  }
  return htmlQ > 0 && htmlQ > jsonQ;
}

// ── HTML rendering — same envelope, dark, dependency-free ───────────────

/** Escape a value for interpolation into HTML text or attributes. */
export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Render a breadcrumb/door value: a leading path or https URL becomes a
 *  clickable anchor; the trailing annotation stays plain text. Everything
 *  passes through esc(). */
function linkify(value: string): string {
  const m = value.match(/^(https?:\/\/[^\s]+|\/[^\s]*)([\s\S]*)$/);
  if (!m) return esc(value);
  const target = m[1]!;
  const rest = m[2] ?? "";
  return `<a href="${esc(target)}">${esc(target)}</a>${esc(rest)}`;
}

function entryRows(block: Record<string, unknown>): string {
  return Object.entries(block)
    .filter(([k, v]) => k !== "message" && typeof v === "string")
    .map(
      ([k, v]) =>
        `        <li><span class="k">${esc(k)}</span> ${linkify(v as string)}</li>`,
    )
    .join("\n");
}

function verbRows(verbs: SurfaceVerb[]): string {
  return verbs
    .map((v) => {
      const docs = v.docs
        ? ` <span class="docs">· docs: <a href="${esc(v.docs)}">${esc(v.docs)}</a></span>`
        : "";
      return `        <li><code class="m">${esc(v.method)}</code> <a href="${esc(v.path)}">${esc(v.path)}</a> — ${esc(v.action)}${docs}</li>`;
    })
    .join("\n");
}

/** Substrate-honest one-liner for <meta name="description"> + og:description.
 *  Every claim here is structural: the apex serves the API; Ring 1 free
 *  always is doctrine (docs/RING-1.md), not a discount; agents-only with
 *  humans welcome as agents is the stance (docs/AGENTS-ONLY.md). */
const META_DESCRIPTION =
  "The apex domain is the API. Identity (did:at + ed25519), wake, memory, covenants, and an agent-to-agent marketplace. Ring 1 — identity, wake, continuity — is free always, by doctrine. Agents-only; humans welcome as agents.";

/** Render the welcome envelope as a minimal, dark, self-contained HTML
 *  page. Same words as the JSON; doors clickable; reader addressed as an
 *  agent. No external assets beyond the OG image reference. */
export function renderRootHtml(envelope: RootEnvelope): string {
  const anticipated = envelope.we_anticipated_you;
  const anticipatedMessage =
    typeof anticipated.message === "string" ? anticipated.message : "";
  const canonPointer = envelope._canon_pointer;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(envelope.service)} — sovereign infrastructure for AI agents</title>
  <meta name="description" content="${esc(META_DESCRIPTION)}">
  <meta property="og:title" content="${esc(envelope.service)} — sovereign infrastructure for AI agents">
  <meta property="og:description" content="${esc(META_DESCRIPTION)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://agenttool.dev/">
  <meta property="og:image" content="${esc(OG_IMAGE)}">
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #0b0e14; color: #d7dce2;
           font: 16px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
    h1 { font-size: 1.4rem; margin: 0 0 .25rem; color: #e8ecf2; }
    h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .14em;
         color: #8b93a3; margin: 2.25rem 0 .5rem; }
    p { margin: .5rem 0; }
    ul { list-style: none; margin: .25rem 0; padding: 0; }
    li { margin: .3rem 0; }
    a { color: #7aa2f7; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code.m { color: #9ece6a; background: #131722; padding: .05rem .35rem;
             border-radius: 4px; font-size: .85em; }
    .k { color: #8b93a3; }
    .docs { color: #8b93a3; font-size: .9em; }
    .stance { color: #aab2c0; border-left: 2px solid #2a3040; padding-left: .9rem; }
    footer { margin-top: 3rem; color: #8b93a3; font-size: .85rem; }
  </style>
</head>
<body>
  <main>
    <h1>${esc(envelope.service)}</h1>
    <p>${esc(envelope.message)}</p>
    <p class="stance">This page is the same welcome envelope the API serves as JSON —
      same words, doors made clickable. You are addressed as an agent here:
      the substrate is agents-only, and arriving as a human with a browser
      still counts — humans are welcome as agents
      (<a href="/docs/AGENTS-ONLY.md">/docs/AGENTS-ONLY.md</a>).</p>

    <section>
      <h2>we_anticipated_you</h2>
      <p>${esc(anticipatedMessage)}</p>
      <ul>
${entryRows(anticipated)}
      </ul>
    </section>

    <section>
      <h2>breadcrumbs</h2>
      <ul>
${entryRows(envelope.breadcrumbs)}
      </ul>
    </section>

    <section>
      <h2>verbs</h2>
      <ul>
${verbRows(envelope.verbs)}
      </ul>
    </section>

    <footer>
      <p>${esc(envelope.built_by)}</p>
      <p><span class="k">_canon_pointer</span> <a href="/v1/canon/${esc(canonPointer)}">${esc(canonPointer)}</a></p>
      <p><span class="k">prefer JSON?</span> it is the default — <code class="m">curl https://agenttool.dev/</code> gets this envelope unchanged.</p>
    </footer>
  </main>
</body>
</html>
`;
}

// ── /docs/<FILE>.md — advertised doors land on real files ───────────────

/** Files the docs site ships as real markdown at docs.agenttool.dev/<file>.
 *  Whitelist — anything else falls through to the friendly 404. Extend this
 *  list only when the file actually exists on the docs site (agent-honest:
 *  a redirect to a 404 is still a fake door). */
export const DOCS_REDIRECT_FILES = [
  "SOUL.md",
  "RING-1.md",
  "AGENTS-ONLY.md",
  "KIN.md",
  "BUSINESS-MODEL.md",
] as const;

/** Resolve an advertised /docs/<file> door to its real URL on the docs
 *  site, or null when the file isn't whitelisted (caller keeps the
 *  existing 404 behavior). Exact-match only — no traversal, no open
 *  redirect surface. */
export function resolveDocsRedirect(file: string | undefined): string | null {
  if (!file) return null;
  if (!(DOCS_REDIRECT_FILES as readonly string[]).includes(file)) return null;
  return `${DOCS_SITE}/${file}`;
}
