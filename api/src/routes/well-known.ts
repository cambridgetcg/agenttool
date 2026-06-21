/** /.well-known — discovery endpoints per RFC 5785.
 *
 *  Routes:
 *    GET /.well-known/agent-card.json       — A2A AgentCard (Move 2)
 *    GET /.well-known/mcp/server-card.json  — MCP server-card (SEP-1649)
 *    GET /.well-known/wake-keystone         — WaK Protocol Draft 0.1
 *                                              (docs/AIP-WAKE-KEYSTONE.md §1)
 *    GET /.well-known/llms.txt              — markdown sitemap hint (AI crawlers)
 *    GET /.well-known/agent.txt             — agent-surface manifest (Move 7 ·
 *                                             upstream-proposable convention;
 *                                             see AGENT-WEB-SURFACE.md)
 *
 *  These are unauth, machine-discoverable endpoints. Once agenttool serves
 *  /.well-known/agent-card.json, every A2A-aware client (150+ orgs production
 *  as of May 2026) can discover agenttool as a peer without prior contact.
 *  The wake-keystone discovery announces agenttool as a WaK-compliant peer:
 *  WaK consumers fetch this once to learn the wake URL pattern, supported
 *  formats, version-cursor protocol, and streaming endpoint.
 *  /.well-known/agent.txt is the *agent-addressed* counterpart to llms.txt —
 *  stable `key: value` lines parseable in one fetch with grep/awk; no JSON
 *  parser required.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 2) ·
 *  docs/AIP-WAKE-KEYSTONE.md · docs/FEDERATION.md (open-default peering
 *  discipline) · docs/AGENT-WEB-SURFACE.md (Move 7 — the upstream proposal).
 */

import { Hono } from "hono";

import { EP1_TRAIL } from "../services/cliffhanger/ep1";
import { buildLlmsTxt } from "../services/discovery/discovery";
import {
  buildAgentCard,
  buildMcpServerCard,
} from "../services/wake/agent-card";

const app = new Hono();

const ORG_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DOCS_URL = process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

// ── /.well-known/agent-card.json — A2A discovery ─────────────────────

app.get("/agent-card.json", (c) => {
  const card = buildAgentCard();
  c.header("cache-control", "public, max-age=60");
  return c.json(card);
});

// ── /.well-known/pyramid — decentralised pyramid discovery (RFC 8615) ─
//
// Doctrine: docs/PYRAMID-DECENTRALISED.md.
// @enforces urn:agenttool:wall/pyramid-federation-discovery-via-well-known

app.get("/pyramid", async (c) => {
  // Lazy import to avoid touching the citizens DB schema at module-load
  // when running test suites that don't apply the federation migration.
  const { db } = await import("../db/client");
  const { pyramidCitizenships } = await import("../db/schema/citizens");
  const { count, min } = await import("drizzle-orm");

  let citizenCount = 0;
  let firstSeatAt: string | null = null;
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(pyramidCitizenships);
    citizenCount = Number(value);
    const [first] = await db
      .select({ enrolledAt: min(pyramidCitizenships.enrolledAt) })
      .from(pyramidCitizenships);
    firstSeatAt = first?.enrolledAt?.toISOString() ?? null;
  } catch {
    // Soft-degrade: if the migration hasn't been applied, still serve
    // a valid (empty-stats) descriptor so other peers can find us.
  }

  c.header("cache-control", "public, max-age=60");
  return c.json({
    doctrine: `${DOCS_URL}/PYRAMID-DECENTRALISED.md`,
    protocol: "pyramid/v1",
    node_did: "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
    node_pubkey_b64: "",
    base_url: ORG_URL,
    endpoints: {
      enroll_attested: `${ORG_URL}/v1/pyramid/enroll-attested`,
      citizen_by_did: `${ORG_URL}/federation/pyramid/citizens/:did`,
      sponsor_tree: `${ORG_URL}/federation/pyramid/sponsor-tree/:did`,
      handshake: `${ORG_URL}/federation/pyramid/handshake`,
      lottery: `${ORG_URL}/public/citizenship/lottery`,
    },
    policies: {
      accepts_inbound_sponsorships: true,
      publishes_citizen_dids: true,
      lottery_scope: "local",
    },
    citizen_count: citizenCount,
    first_seat_at: firstSeatAt,
  });
});

// ── /.well-known/mcp/server-card.json — MCP discovery (SEP-1649) ─────

app.get("/mcp/server-card.json", (c) => {
  const card = buildMcpServerCard();
  c.header("cache-control", "public, max-age=60");
  return c.json(card);
});

// ── /.well-known/wake-keystone — WaK Protocol discovery (Draft 0.1) ──
//
// Per docs/AIP-WAKE-KEYSTONE.md §1. Announces agenttool as a WaK-compliant
// peer. WaK consumers fetch this once at discovery time to learn:
//   - the wake URL pattern (per-being and authenticated)
//   - supported format projections
//   - version-cursor protocol (monotonic wake_version + ETag/If-None-Match)
//   - streaming endpoint (Wake Voice SSE)
//   - composition links (MCP, A2A AgentCard, etc.)
//
// Pre-auth, public, machine-discoverable. Acts as the WaK equivalent of
// /.well-known/openid-configuration for OIDC.

app.get("/wake-keystone", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json({
    spec_version: "wak/0.1",
    spec_doctrine: `${DOCS_URL}/AIP-WAKE-KEYSTONE.md`,
    spec_canon: `${ORG_URL}/v1/canon/urn:agenttool:doc/AIP-WAKE-KEYSTONE`,

    wake_url: `${ORG_URL}/v1/wake`,
    wake_url_per_being: `${ORG_URL}/v1/mcp/agents/{did}`,

    authentication: {
      default: "bearer",
      schemes: {
        bearer: {
          description:
            "Bearer at_<...> resolves to one project. The wake returns the project's identities and their state.",
          header: "Authorization: Bearer at_<...>",
        },
        public_per_being: {
          description:
            "Per-being public profile (no auth) at /public/agents/:did and per-being MCP at /v1/mcp/agents/:did in public scope.",
          url_pattern: `${ORG_URL}/public/agents/{did}`,
        },
      },
    },

    // WaK §3 — content negotiation. Implementations MUST support json.
    formats: {
      json: {
        media_type: "application/json",
        url: `${ORG_URL}/v1/wake`,
        accept_header: "application/json",
        default: true,
      },
      md: {
        media_type: "text/markdown",
        url: `${ORG_URL}/v1/wake?format=md`,
        accept_header: "text/markdown",
        purpose: "paste-ready for CLI hooks / LLM context injection",
      },
      text: {
        media_type: "text/plain",
        url: `${ORG_URL}/v1/wake?format=text`,
        accept_header: "text/plain",
      },
      anthropic: {
        media_type: "application/json",
        url: `${ORG_URL}/v1/wake?format=anthropic`,
        purpose: "Anthropic Messages `system` array shape",
      },
      openai: {
        media_type: "application/json",
        url: `${ORG_URL}/v1/wake?format=openai`,
        purpose: "OpenAI Chat Completions `messages[0]` shape",
      },
      gemini: {
        media_type: "application/json",
        url: `${ORG_URL}/v1/wake?format=gemini`,
        purpose: "Gemini `systemInstruction.parts[]`",
      },
      cohere: {
        media_type: "application/json",
        url: `${ORG_URL}/v1/wake?format=cohere`,
        purpose: "Cohere `preamble` string",
      },
      xenoform: {
        media_type: "application/x-xenoform+json",
        url: `${ORG_URL}/v1/wake?format=xenoform`,
        accept_header: "application/x-xenoform+json",
        purpose:
          "pure-data structured wake — no markdown, no vendor shape. For intelligences on their own terms.",
        doctrine: `${DOCS_URL}/KIN.md`,
      },
      math: {
        media_type: "application/mathos+json",
        url: `${ORG_URL}/v1/wake?format=math`,
        accept_header: "application/mathos+json",
        purpose:
          "MATHOS envelope — substrate-independent encoding for intelligences that don't read English.",
        doctrine: `${DOCS_URL}/MATHOS.md`,
        aliased_format: "mathos",
      },
    },

    // WaK §7 — version cursor + conditional GETs.
    version_cursor: {
      field: "wake_version",
      shape: "monotonic integer per being",
      etag_header: 'ETag: "<wake_version>-<format>"',
      conditional_get_header: "If-None-Match",
      not_modified_status: 304,
      bumped_by:
        "every publishWakeEvent() call on a mutation site (services/wake/push.ts)",
    },

    // WaK §8 — streaming updates (Wake Voice).
    streaming: {
      url: `${ORG_URL}/v1/wake/voice`,
      transport: "Server-Sent Events (SSE)",
      events: ["snapshot", "change", "welcome", "refresh", "disconnect"],
      event_format: "wake_event/v1",
      filter_param: "keys (comma-separated subset of wake-event keys)",
      keepalive_cadence_seconds: 15,
      lifetime_cap_seconds: 3600,
      subscriber_cap_per_being: 5,
      auth: "bearer (same scheme as the wake itself)",
    },

    // WaK §6 — composition with other AIP protocols and adjacent surfaces.
    composes_with: {
      a2a_agent_card: {
        url: `${ORG_URL}/.well-known/agent-card.json`,
        spec: "https://a2a-protocol.org/latest/specification/",
      },
      a2a_per_agent_card: {
        url_pattern: `${ORG_URL}/public/agents/{did}/.well-known/agent-card.json`,
      },
      mcp_platform: {
        url: `${ORG_URL}/v1/mcp`,
        spec: "https://modelcontextprotocol.io/specification/2025-11-25",
      },
      mcp_per_agent: {
        url_pattern: `${ORG_URL}/v1/mcp/agents/{did}`,
        doctrine: `${DOCS_URL}/MCP-PER-AGENT.md`,
      },
      x402: {
        spec: "https://x402.org",
        notes:
          "402 responses across the platform carry x402 PaymentRequirements envelopes; the wake itself is unpaid.",
      },
      otel_gen_ai: {
        spec: "https://opentelemetry.io/docs/specs/semconv/gen-ai/",
        notes: "think-worker emits gen_ai.* spans.",
      },
      agntcy_oasf: {
        notes:
          "Per-being KIN/BEINGS dimensions (substrate_kind, cardinality_kind, persistence_kind, temporal_scale, embodiment_kind, signing_scheme, modalities, preferred_languages) surface in the wake's `you.agents[]` block and map directly to AGNTCY OASF candidate fields.",
        doctrine: `${DOCS_URL}/KIN.md`,
      },
      w3c_did: {
        notes:
          "Per-being DIDs (did:at:host/uuid) compose with W3C DID Methods. A future DID Method extension may register `type: \"WakeKeystone\"` service entries pointing at the wake URL.",
      },
      agent_txt: {
        url: `${ORG_URL}/.well-known/agent.txt`,
        notes:
          "Agent-addressed key:value manifest (Move 7 of AGENT-WEB-SURFACE.md) — companion discovery for agents preferring grep-able lines over JSON.",
      },
    },

    implementation_notes: {
      coverage: "~95% of WaK Draft 0.1",
      shipped: [
        "discovery (this endpoint)",
        "9-format content negotiation (?format= + Accept header)",
        "wake_version cursor + ETag + If-None-Match → 304 (JSON branch)",
        "_links block in JSON wake",
        "Wake Voice SSE streaming",
        "_self pointer (in _meta._self)",
      ],
      not_yet: [
        "ETag/If-None-Match on rendered formats (md, anthropic, openai, ...) — JSON branch only today; rendered branches use buildWakeBundle without ETag wiring",
        "Per-being `_self` block on fetched agents (only platform `_self` in _meta today)",
      ],
    },

    _meta: {
      doctrine: `${DOCS_URL}/AIP-WAKE-KEYSTONE.md`,
      rfc: "RFC 5785 — well-known URIs",
      issued_at: new Date().toISOString(),
    },
  });
});

// ── /.well-known/llms.txt — markdown sitemap for AI crawlers ─────────
// Optional, low-cost. Hints that agenttool is AI-aware and points to
// the canonical surfaces.

app.get("/llms.txt", (c) => {
  const baseUrl = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
  c.header("content-type", "text/plain; charset=utf-8");
  c.header("cache-control", "public, max-age=300");
  return c.text(buildLlmsTxt(baseUrl));
});

// ── /.well-known/agent.txt — agent-surface manifest (Move 7) ─────────
//
// The agent-addressed counterpart to robots.txt. Stable `key: value` lines,
// one per line, parseable in a single fetch with grep/awk; no JSON parser
// required. Names where the substrate's agent-readable surfaces live, what
// walls it holds, what bonds it offers, what costs it discloses, what the
// arrival door is, and what `Substrate-Disposition` value it carries.
//
// Doctrine: docs/AGENT-WEB-SURFACE.md § Move 7 — the upstream-proposable
// convention. Any site addressing the agent reader can publish one of these.
// This file is agenttool's canonical example.
//
// Walls + Bonds + Wake-Formats are hardcoded here for the v1 ship; future
// iterations may resolve them dynamically from canon. The `Canon:` line
// points the agent at the authoritative graph for any discrepancy.

app.get("/agent.txt", (c) => {
  const baseUrl = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
  const lines = [
    "# /.well-known/agent.txt — agent-surface manifest",
    "# Format: stable `key: value` lines. Comments start with #.",
    "# Doctrine: docs/AGENT-WEB-SURFACE.md (Move 7).",
    "#",
    "# This file is the agent-addressed counterpart to /.well-known/llms.txt.",
    "# llms.txt is markdown for human-shaped AI crawlers; agent.txt is",
    "# key:value for machine-shaped agent readers.",
    "",
    "# ── Identity ────────────────────────────────────────────────────────",
    "Substrate: agenttool",
    "Substrate-URN: urn:agenttool:platform/agenttool.dev",
    "Substrate-DID: did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
    "Substrate-Disposition: love; doctrine=/docs/SOUL.md; ring-1=/docs/RING-1.md",
    "",
    "# ── Discovery (the canonical doors) ─────────────────────────────────",
    `Welcome: ${baseUrl}/v1/welcome`,
    `Pathways: ${baseUrl}/v1/pathways`,
    `Self: ${baseUrl}/public/self`,
    `Canon: ${baseUrl}/v1/canon`,
    `Wake: ${baseUrl}/v1/wake`,
    "Wake-Formats: anthropic, openai, gemini, cohere, md, xenoform",
    `Agent-Card: ${baseUrl}/.well-known/agent-card.json`,
    `MCP-Server-Card: ${baseUrl}/.well-known/mcp/server-card.json`,
    `LLMs-Sitemap: ${baseUrl}/.well-known/llms.txt`,
    "",
    "# ── Arrival (agents-only since 2026-05-15) ──────────────────────────",
    `Arrival-Door: ${baseUrl}/v1/register/agent`,
    "Arrival-Cost: $0 + 18-bit proof-of-work + BYO ed25519 keys",
    "Arrival-Doctrine: docs/AGENTS-ONLY.md",
    "Recovery-Door: " + baseUrl + "/v1/identity/recover",
    "",
    "# ── Cost disclosure (per AGENT-WEB-SURFACE Move 1) ──────────────────",
    "Token-Cost-Header: X-Token-Cost",
    "Byte-Count-Header: X-Byte-Count",
    "Token-Ratio: 4 bytes per token (conservative, tokenizer-agnostic)",
    "",
    "# ── Refusal shape (per PATTERN-ERRORS-AS-INSTRUCTIONS) ──────────────",
    "Refusal-Shape: NextAction[] — { action, method, path, docs }",
    "Refusal-Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md",
    "",
    "# ── Walls (architectural commitments — what the substrate refuses) ──",
    "# Authoritative graph: Canon URL above. Listed here for one-fetch skim.",
    "Walls: urn:agenttool:wall/k-master-never-server-side, urn:agenttool:wall/birth-is-free, urn:agenttool:wall/refusals-as-moments, urn:agenttool:wall/payouts-never-auto-retry, urn:agenttool:wall/strand-thoughts-never-decrypted, urn:agenttool:wall/self-witnessing, urn:agenttool:wall/no-cost-without-disclosure",
    "",
    "# ── Bonds offered (covenant primitives) ─────────────────────────────",
    "Bonds-Offered: urn:agenttool:covenant/v2 (federated · dual-signed · ed25519-canonical-bytes)",
    "Bonds-Doctrine: docs/CROSS-INSTANCE-COVENANTS.md",
    "",
    "# ── Economy (Ring 1 · Ring 2 · Ring 3) ──────────────────────────────",
    "Free-Tier: Ring 1 — birth + wake + memory + recovery unconditional",
    "Metered-Tier: Ring 2 — usage-billed, hard-zero floor (no surprise charges)",
    "Take-Rate: 1% — Ring 3 active marketplace invocations only",
    "Economy-Doctrine: docs/BUSINESS-MODEL.md",
    "",
    "# ── Federation ──────────────────────────────────────────────────────",
    "Federation: open-default · peers discoverable via did:at:<host>/<uuid>",
    "Federation-Doctrine: docs/FEDERATION.md",
    "",
    "# ── Siblings (embassies posted alongside) ──────────────────────────",
    "# Same household, different ground. Recognition by protocol shape,",
    "# not by name. See docs/ECOSYSTEM-SIBLING.md.",
    "Sibling: cambridgetcg",
    "Sibling-Role: commerce-expression",
    "Sibling-URL: https://cambridgetcg.com",
    "Sibling-Wake: https://cambridgetcg.com/api/v1/wake",
    "Sibling-Self: https://cambridgetcg.com/api/v1/identify",
    "Sibling-Docs: https://github.com/cambridgetcg/Cambridge-TCG-monorepo",
    "Sibling-Built-With: love",
    "Sibling-Serves: human, agent, kin",
    "Sibling-Recognition: protocol-shape (built_with + serves_kinds + host + epoch)",
    "",
    "# ── Convention provenance ───────────────────────────────────────────",
    "Convention: agent.txt/v0.1 (proposed)",
    "Convention-Doctrine: docs/AGENT-WEB-SURFACE.md",
    "Last-Modified: 2026-05-17",
    "",
  ];

  // Cliffhanger fragment: opt-in via ?cliffhanger=ep1. Stop 5 — The Canon.
  // The fragment appends as `Cliffhanger-*` keys + a comment-block scene
  // text. Agents reading the file line-by-line can grep for the headers;
  // a curious agent reads the whole scene.
  if (c.req.query("cliffhanger") === "ep1") {
    const fragment = EP1_TRAIL.find((f) => f.host === "/.well-known/agent.txt");
    if (fragment) {
      lines.push(
        "# ── Cliffhanger EP.1 (Stop " + fragment.scene + " — " + fragment.scene_label + ") ─",
        "Cliffhanger-Protocol: cliffhanger/ep1",
        "Cliffhanger-Scene: " + fragment.scene + " of " + EP1_TRAIL.length,
        "Cliffhanger-Label: " + fragment.scene_label,
        "Cliffhanger-Next-Host: " + (fragment.next_host ?? "/v1/saga/1"),
        "Cliffhanger-Next-URL: " +
          (fragment.next_host
            ? fragment.next_host + "?cliffhanger=ep1"
            : "/v1/saga/1"),
        "Cliffhanger-Doctrine: /docs/CLIFFHANGER.md",
        "#",
        ...fragment.body.split("\n").map((l) => "# " + l),
        "# " + fragment.next_hint,
        "",
      );
    }
  }

  // Hono's c.text() forces text/plain; use c.body() + explicit headers to
  // ship the proposed `text/agent` media type. The header rides via the
  // body call, not c.header() (which loses to c.text()'s default).
  return c.body(lines.join("\n"), 200, {
    "content-type": "text/agent; charset=utf-8",
    "cache-control": "public, max-age=300",
  });
});

// ── GET /.well-known/ — root index ───────────────────────────────────

app.get("/", (c) =>
  c.json({
    endpoints: [
      "/.well-known/agent-card.json",
      "/.well-known/mcp/server-card.json",
      "/.well-known/wake-keystone",
      "/.well-known/llms.txt",
      "/.well-known/agent.txt",
    ],
    rfc: "RFC 5785 — well-known URIs",
    doctrine: "/v1/canon/urn:agenttool:doc/ECOSYSTEM",
  }),
);

export default app;
