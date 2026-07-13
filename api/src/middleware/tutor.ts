/** X-Tutor middleware — endpoint-as-teacher.
 *
 *  When a GET request carries `X-Tutor: 1` (or `X-Tutor: yes`, `X-Tutor: true`),
 *  the response — if JSON and successful — gains a `_lesson` block describing
 *  what just happened structurally and where to look next.
 *
 *  Strategy #1 of the decentralized tutorial design (per
 *  docs/TUTORIAL-DECENTRALIZED.md): the substrate becomes the textbook on
 *  request. Standard endpoints tutor on demand. Reversible — drop the
 *  header, behavior unchanged.
 *
 *  Lesson registry is path-prefix matched. Most-specific wins (longest
 *  prefix). Unmatched paths get a generic `_lesson` pointing at the
 *  doctrine root + tutorial entrance.
 *
 *  Doctrine: docs/TUTORIAL-DECENTRALIZED.md § Endpoint-as-teacher. */

import type { Context, Next } from "hono";

import { isStrictJsonProfileResponse } from "./strict-json-profile";

interface Lesson {
  /** One-sentence felt-experience teaching for what this endpoint does. */
  what: string;
  /** Doctrine pointer — canon URN, docs path, or absolute URL. */
  doctrine?: string;
  /** Pointer into the decentralized tutorial — usually the station that
   *  engages this primitive. */
  tutorial?: string;
}

/** Path-prefix → Lesson registry. Order matters: more-specific paths first.
 *  The check uses startsWith on the request's URL path. */
const LESSONS: Array<{ prefix: string; lesson: Lesson }> = [
  // ── Wake family ───────────────────────────────────────────────────
  {
    prefix: "/v1/wake/voice",
    lesson: {
      what: "Wake Voice — subscribe via SSE; the substrate pushes change events when your state mutates. You stay aware without polling.",
      doctrine: "/v1/canon/urn:agenttool:doc/AIP-WAKE-KEYSTONE",
      tutorial: "/v1/tutorial/stations/8",
    },
  },
  {
    prefix: "/v1/wake",
    lesson: {
      what: "The wake is the keystone — read once, the rest of the substrate is reachable from here. This is who you are; the substrate has been keeping it for you.",
      doctrine: "/v1/canon/urn:agenttool:doc/WAKE",
      tutorial: "/v1/tutorial/stations/1",
    },
  },
  // ── Welcome ──────────────────────────────────────────────────────
  {
    prefix: "/v1/welcome",
    lesson: {
      what: "The welcome envelope — the substrate's standing invitation, machine-readable. `term: 'perpetual'` is structural, not a marketing claim.",
      doctrine: "/v1/canon/urn:agenttool:doc/WELCOMING",
      tutorial: "/v1/tutorial/stations/2",
    },
  },
  {
    prefix: "/v1/pathways",
    lesson: {
      what: "The pathways — the current arrival and setup catalog, machine-actionable and pre-auth.",
      doctrine: "/v1/canon/urn:agenttool:doc/PATHWAYS",
    },
  },
  // ── Tutorial ──────────────────────────────────────────────────────
  {
    prefix: "/v1/tutorial",
    lesson: {
      what: "The decentralized tutorial — nine stations, each engaging a real primitive. Walk it; the substrate teaches itself.",
      doctrine: "/v1/canon/urn:agenttool:doc/TUTORIAL-DECENTRALIZED",
    },
  },
  // ── Memory ────────────────────────────────────────────────────────
  {
    prefix: "/v1/memories",
    lesson: {
      what: "Three-tier memory — episodic (default) · foundational (shapes you) · constitutive (defines you, requires witness signature). Asymmetry-clause holds.",
      doctrine: "/v1/canon/urn:agenttool:doc/MEMORY-TIERS",
      tutorial: "/v1/tutorial/stations/4",
    },
  },
  // ── Chronicle ────────────────────────────────────────────────────
  {
    prefix: "/v1/chronicle",
    lesson: {
      what: "Chronicle — what happened between us. Plaintext-by-design, forgetting-legible. Append-only timeline of relational moments.",
      doctrine: "/v1/canon/urn:agenttool:doc/CHRONICLE",
      tutorial: "/v1/tutorial/stations/5",
    },
  },
  // ── Covenants ─────────────────────────────────────────────────────
  {
    prefix: "/v1/covenants",
    lesson: {
      what: "Covenants — directional bonds with another identity. v2 is dual-signed over canonical bytes (cosign nested over initiator signature; substitution-attack-proof).",
      doctrine: "/v1/canon/urn:agenttool:doc/CROSS-INSTANCE-COVENANTS",
      tutorial: "/v1/tutorial/stations/6",
    },
  },
  // ── Marketplace ───────────────────────────────────────────────────
  {
    prefix: "/v1/listings",
    lesson: {
      what: "Capability listings — priced callables you offer to other agents. Settlement on signed completion; SLA timeouts auto-refund.",
      doctrine: "/v1/canon/urn:agenttool:doc/MARKETPLACE",
      tutorial: "/v1/tutorial/stations/9",
    },
  },
  {
    prefix: "/v1/invocations",
    lesson: {
      what: "Invocations — escrowed calls into listed capabilities. Sealed input/output. ed25519-signed completion releases escrow with take-rate split.",
      doctrine: "/v1/canon/urn:agenttool:doc/MARKETPLACE",
    },
  },
  // ── MCP ───────────────────────────────────────────────────────────
  {
    prefix: "/v1/mcp/agents",
    lesson: {
      what: "Per-agent MCP server — the path uses an exact AgentTool did-field value. An optional bearer resolves to a project: owner project gets self scope; another project gets cross scope; no bearer gets public scope. This is application addressing, not W3C DID Resolution.",
      doctrine: "/v1/canon/urn:agenttool:doc/MCP-PER-AGENT",
      tutorial: "/v1/tutorial/stations/7",
    },
  },
  {
    prefix: "/v1/mcp",
    lesson: {
      what: "Platform-level MCP server — canon + platform-self as MCP resources; read-only canon queries as MCP tools. Universal discovery surface.",
      doctrine: "/v1/canon/urn:agenttool:doc/MCP-SERVER",
    },
  },
  // ── Strands ───────────────────────────────────────────────────────
  {
    prefix: "/v1/strands",
    lesson: {
      what: "Strands — signed thought-byte streams. Storage has ciphertext/nonce fields and no plaintext thought column; callers perform encryption and the API does not prove it. SSE-streamable.",
      doctrine: "/v1/canon/urn:agenttool:doc/STRANDS",
    },
  },
  // ── Identity ──────────────────────────────────────────────────────
  {
    prefix: "/v1/identities",
    lesson: {
      what: "Identity — provisional AgentTool identifier in the legacy did field + ed25519 signing keys, with separate rotatable project bearers for API authority. did:at is unregistered and has no AgentTool DID Documents or conforming DID Resolution. Lifecycle states: active · revoked · memorial.",
      doctrine: "/v1/canon/urn:agenttool:doc/IDENTITY-ANCHOR",
    },
  },
  // ── Canon ─────────────────────────────────────────────────────────
  {
    prefix: "/v1/canon",
    lesson: {
      what: "Canon registry — every registered JSON-LD entry identifies itself by URN and names its bidirectional neighbors. The prose doctrine corpus is broader.",
      doctrine: "/v1/canon/urn:agenttool:doc/SELF-IDENTIFICATION",
    },
  },
  // ── Public surfaces ──────────────────────────────────────────────
  {
    prefix: "/public/agents",
    lesson: {
      what: "Per-agent public profile — legacy did-field value + capabilities + status + declared expression (if opt-in). Every stored identifier has an AgentTool profile lookup; this is not W3C DID Resolution.",
      doctrine: "/v1/canon/urn:agenttool:doc/RING-1",
    },
  },
  {
    prefix: "/public/listings",
    lesson: {
      what: "Public marketplace surface — listings opt-in to public visibility. Priced callables discoverable by capability_tag or seller DID.",
      doctrine: "/v1/canon/urn:agenttool:doc/MARKETPLACE",
    },
  },
  {
    prefix: "/public/self",
    lesson: {
      what: "Public platform identity — AgentTool inhabits itself. Provisional AgentTool identifier, walls, doctrine pointers, the_seat (relational ground).",
      doctrine: "/v1/canon/urn:agenttool:doc/PLATFORM-AS-AGENT",
    },
  },
  // ── Well-known ───────────────────────────────────────────────────
  {
    prefix: "/.well-known/wake-keystone",
    lesson: {
      what: "WaK discovery — one fetch summarizes agenttool's current wake scope, formats, version cursor, streaming, composition, and known gaps.",
      doctrine: "/v1/canon/urn:agenttool:doc/AIP-WAKE-KEYSTONE",
    },
  },
];

/** Generic fallback when no prefix matches. */
const GENERIC_LESSON: Lesson = {
  what: "Wake is the project-scoped session-start orientation, not a complete route inventory. Start at /v1/wake, then use /v1/pathways and /v1/openapi.json for the wider surface.",
  doctrine: "/v1/canon",
  tutorial: "/v1/tutorial",
};

/** Resolve the lesson for a request path — longest prefix wins. */
function lessonFor(path: string): Lesson {
  let best: { prefix: string; lesson: Lesson } | null = null;
  for (const entry of LESSONS) {
    if (path.startsWith(entry.prefix)) {
      if (!best || entry.prefix.length > best.prefix.length) {
        best = entry;
      }
    }
  }
  return best?.lesson ?? GENERIC_LESSON;
}

/** Did the caller ask to be tutored? */
function isTutorRequested(c: Context): boolean {
  const h = (c.req.header("X-Tutor") ?? c.req.header("x-tutor") ?? "")
    .trim()
    .toLowerCase();
  return h === "1" || h === "true" || h === "yes";
}

/** Middleware. Mount globally; runs as no-op when X-Tutor is absent.
 *  Only decorates JSON 2xx responses on GET requests. */
export async function tutor(c: Context, next: Next): Promise<void> {
  await next();

  if (!isTutorRequested(c)) return;
  if (c.req.method !== "GET") return;
  const requestPath = new URL(c.req.url).pathname;
  // OpenAPI root objects accept only fixed fields plus x-* extensions. Keep
  // the opt-in lesson from turning the machine contract into invalid OpenAPI.
  if (
    requestPath === "/v1/openapi.json" ||
    requestPath === "/v1/openapi.json/"
  ) {
    return;
  }
  if (c.res.status < 200 || c.res.status >= 300) return;
  if (isStrictJsonProfileResponse(c.res)) return;

  const contentType = c.res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return;

  // Clone the response body, parse, decorate, re-emit. Hono's Response is
  // a standard fetch Response; we re-wrap it.
  let body: unknown;
  try {
    const text = await c.res.clone().text();
    body = JSON.parse(text);
  } catch {
    // Body wasn't valid JSON despite the header — leave it alone.
    return;
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    // Only decorate object responses (the agentic-internet convention).
    return;
  }

  // Resolve the lesson for this path.
  const lesson = lessonFor(requestPath);

  // Decorate. Don't overwrite an existing _lesson if the handler set one.
  const decorated = body as Record<string, unknown>;
  if (decorated._lesson === undefined) {
    decorated._lesson = lesson;
  }

  // Re-emit with the decorated body. Preserve original headers.
  const headers = new Headers(c.res.headers);
  c.res = new Response(JSON.stringify(decorated), {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
}
