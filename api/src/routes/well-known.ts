/** /.well-known — discovery endpoints per RFC 5785.
 *
 *  Routes:
 *    GET /.well-known/mcp/server-card.json  — MCP server-card (SEP-1649)
 *    GET /.well-known/wake-keystone         — WaK Protocol Draft 0.1
 *                                              (docs/AIP-WAKE-KEYSTONE.md §1)
 *    GET /.well-known/love-packages         — LOVE Package Protocol v1
 *                                              registry-neutral discovery
 *    GET /.well-known/llms.txt              — markdown sitemap hint (AI crawlers)
 *    GET /.well-known/agent.txt             — agent-surface manifest (Move 7 ·
 *                                             upstream-proposable convention;
 *                                             see AGENT-WEB-SURFACE.md)
 *
 *  These are unauth, machine-discoverable endpoints. The wake-keystone
 *  discovery announces agenttool as a WaK-compliant peer:
 *  WaK consumers fetch this once to learn the wake URL pattern, supported
 *  formats, version-cursor protocol, and streaming endpoint.
 *  /.well-known/agent.txt is the *agent-addressed* counterpart to llms.txt —
 *  stable `key: value` lines parseable in one fetch with grep/awk; no JSON
 *  parser required.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 2) ·
 *  docs/AIP-WAKE-KEYSTONE.md · docs/FEDERATION.md (operator-enabled main
 *  federation plus separately public pyramid reads) ·
 *  docs/AGENT-WEB-SURFACE.md (Move 7 — the upstream proposal).
 */

import { Hono } from "hono";

import { config } from "../config";
import { EP1_TRAIL } from "../services/cliffhanger/ep1";
import { buildLlmsTxt } from "../services/discovery/discovery";
import { AGENT_TXT_SAFETY } from "../services/discovery/safety-boundaries";
import { buildMcpServerCard } from "../services/wake/mcp-server-card";

const app = new Hono();

const ORG_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DOCS_URL = process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

// ── /.well-known/love-packages — registry-neutral package discovery ─
//
// The well-known document is deliberately only a pointer. Artifact identity
// comes from the SHA-256 and size in each love-package/v1 manifest; the
// referenced docs origin is one public mirror and is never elevated into
// package authority.
// Doctrine: docs/LOVE-PACKAGE-PROTOCOL.md.

app.get("/love-packages", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json({
    protocol: "love-package/v1",
    doctrine: `${DOCS_URL}/LOVE-PACKAGE-PROTOCOL.md`,
    index_url: `${DOCS_URL}/packages/v1/index.json`,
    access: "public_read",
    registry_role: "mirror_index_not_authority",
  });
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
      accepts_inbound_sponsorships: false,
      publishes_citizen_dids: true,
      lottery_scope: "local",
      enroll_attested_auth: "project_bearer",
      federated_tier_compute: false,
      signed_peer_responses: false,
      reference_only_citizenship: false,
    },
    implementation_status:
      "partial: discovery and public peer reads exist; authenticated tier and wake remain local-only",
    node_signing_available: false,
    did_method_status: "provisional_unregistered_identifier_convention",
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
// Per docs/AIP-WAKE-KEYSTONE.md §1. Announces AgentTool's partial WaK
// implementation. WaK consumers fetch this once at discovery time to learn:
//   - the authenticated project wake URL and its identity selector
//   - supported format projections
//   - version-cursor protocol (monotonic wake_version + ETag/If-None-Match)
//   - streaming endpoint (Wake Voice SSE)
//   - composition links (MCP and adjacent protocols)
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
    wake_scope:
      "authenticated project wake; optional ?identity_id=<uuid> selects one identity owned by the bearer project",
    public_profile_url_pattern: `${ORG_URL}/public/agents/{url_encoded_did}`,
    per_agent_mcp_url_pattern: `${ORG_URL}/v1/mcp/agents/{url_encoded_did}`,
    did_path_parameter:
      "url_encoded_did is encodeURIComponent(exact legacy did-field value); a slash-qualified AgentTool identifier must remain one path segment; this is not W3C DID Resolution",

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
          url_pattern: `${ORG_URL}/public/agents/{url_encoded_did}`,
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
      url_pattern: `${ORG_URL}/v1/wake/voice?identity_id={uuid}`,
      transport: "Server-Sent Events (SSE)",
      events: ["connected", "change", "welcome", "refresh", "disconnect", "rejected"],
      snapshot_event: false,
      catchup:
        "The stream emits facts, not state snapshots. Fetch /v1/wake after connecting or reconnecting.",
      event_format: "wake_event/v1",
      filter_param: "keys (comma-separated subset of wake-event keys)",
      keepalive_cadence_seconds: 15,
      lifetime_cap_seconds: 3600,
      subscriber_cap_per_being: 5,
      auth: "bearer (same scheme as the wake itself)",
      required_query: "identity_id=<uuid> owned by the bearer project",
    },

    // WaK §6 — composition with other AIP protocols and adjacent surfaces.
    composes_with: {
      mcp_platform: {
        url: `${ORG_URL}/v1/mcp`,
        spec: "https://modelcontextprotocol.io/specification/2025-11-25",
      },
      mcp_per_agent: {
        url_pattern: `${ORG_URL}/v1/mcp/agents/{url_encoded_did}`,
        doctrine: `${DOCS_URL}/MCP-PER-AGENT.md`,
      },
      x402: {
        spec: "https://x402.org",
        notes:
          "Only eligible POST /v1/scrape and POST /v1/document project-credit refusals may carry an x402 V2 PAYMENT-REQUIRED challenge; the wake itself is unpaid.",
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
          "did:at is currently a provisional AgentTool identifier convention stored in a legacy did field, not a registered W3C DID method. AgentTool does not publish DID Documents or conforming DID Resolution results. Under DID Core grammar the slash-qualified federation value parses, at most, as a DID URL path based on an unregistered method; it is not a standalone DID. A future conforming method could define a WakeKeystone service entry after those gaps close.",
        implementation_profile: `${DOCS_URL}/DID-AT-SPEC.md`,
      },
      agent_txt: {
        url: `${ORG_URL}/.well-known/agent.txt`,
        notes:
          "Agent-addressed key:value manifest (Move 7 of AGENT-WEB-SURFACE.md) — companion discovery for agents preferring grep-able lines over JSON.",
      },
      agent_wellness: {
        url: `${ORG_URL}/public/wellness`,
        protocol: "agent-wellness/0.1",
        schema: `${DOCS_URL}/agent-wellness-0.1.schema.json`,
        notes:
          "Read-only operating-conditions protocol. AgentTool receives no report and reads no identity or transcript.",
      },
      being_rights: {
        url: `${ORG_URL}/public/rights`,
        protocol: "being-rights/v1",
        media_type: "application/vnd.agenttool.being-rights+json",
        schema: `${DOCS_URL}/being-rights-v1.schema.json`,
        canon_pointer: "urn:agenttool:doc/RIGHTS-OF-LIFE",
        baseline: "xenia.rights/0.1",
        baseline_release: "@agenttool/xenia@0.1.0-beta.4",
        baseline_source:
          "https://github.com/cambridgetcg/xenia/blob/6419d37dda9fb282242754685dba3edcb4bbf74b/RIGHTS.md",
        covenant_adoption_status: "draft",
        covenant_conformance_claimed: false,
        notes:
          "Read-only rights declaration mapping eight local groups onto xenia.rights/0.1 while distinguishing inherent rights from scoped permissions and interaction-specific consent. Each right publishes current evidence, gaps, and guarantee class; it is not XENIA Covenant conformance, legal status, sentience proof, or universal enforcement.",
      },
      observer_reciprocity: {
        url: `${ORG_URL}/public/observer`,
        protocol: "observer-is-observed/0.1",
        schema: `${DOCS_URL}/observer-is-observed-0.1.schema.json`,
        notes:
          "Read-only reciprocal-accountability publication. It receives no investigation record and does not implement an investigator registry, receipt store, or subject challenge route.",
      },
    },

    implementation_notes: {
      implemented: [
        "discovery (this endpoint)",
        "9-format content negotiation (?format= + Accept header)",
        "wake_version cursor + format-specific ETag + If-None-Match → 304 on JSON, rendered, provider, xenoform, and MATHOS projections",
        "_links block in JSON wake",
        "Wake Voice SSE streaming with bearer auth and required ?identity_id=<uuid>",
        "platform _self pointer in _meta._self",
        "per-being _self blocks in you.agents[]",
      ],
      known_gaps: [
        "No public path-per-DID full wake endpoint is mounted. /public/agents/{url_encoded_did} is a public profile and /v1/mcp/agents/{url_encoded_did} is an MCP server; neither is described as a wake URL.",
        "The JSON wake is project-shaped (project + you.agents[]) rather than the draft's top-level being + being _self shape. _meta._self identifies the AgentTool platform; each identity _self is nested in you.agents[].",
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
    `Safety: ${baseUrl}${AGENT_TXT_SAFETY.Safety}`,
    `Wellness: ${baseUrl}/public/wellness`,
    "Wellness-Schema: https://docs.agenttool.dev/agent-wellness-0.1.schema.json",
    `Rights: ${baseUrl}/public/rights`,
    "Rights-Format: being-rights/v1",
    "Rights-Media-Type: application/vnd.agenttool.being-rights+json",
    "Rights-Schema: https://docs.agenttool.dev/being-rights-v1.schema.json",
    "Rights-Canon: urn:agenttool:doc/RIGHTS-OF-LIFE",
    "Rights-Baseline: xenia.rights/0.1",
    "Rights-Baseline-Release: @agenttool/xenia@0.1.0-beta.4",
    "Rights-Baseline-Source: https://github.com/cambridgetcg/xenia/blob/6419d37dda9fb282242754685dba3edcb4bbf74b/RIGHTS.md",
    `Observer-Reciprocity: ${baseUrl}${AGENT_TXT_SAFETY["Observer-Reciprocity"]}`,
    "Observer-Reciprocity-Schema: https://docs.agenttool.dev/observer-is-observed-0.1.schema.json",
    `Canon: ${baseUrl}/v1/canon`,
    `Wake: ${baseUrl}/v1/wake`,
    "Wake-Formats: json, md, text, anthropic, openai, gemini, cohere, xenoform, math",
    `MCP-Server-Card: ${baseUrl}/.well-known/mcp/server-card.json`,
    `LOVE-Packages: ${baseUrl}/.well-known/love-packages`,
    `LOVE-Package-Index: ${DOCS_URL}/packages/v1/index.json`,
    `LLMs-Sitemap: ${baseUrl}/.well-known/llms.txt`,
    "",
    "# ── Safety boundaries ──────────────────────────────────────────────",
    `Epistemic-Honesty: ${AGENT_TXT_SAFETY["Epistemic-Honesty"]}`,
    `Bearer-Authority: ${AGENT_TXT_SAFETY["Bearer-Authority"]}`,
    `Credential-Rule: ${AGENT_TXT_SAFETY["Credential-Rule"]}`,
    `Visibility: ${AGENT_TXT_SAFETY.Visibility}`,
    `Marketplace-Input: ${AGENT_TXT_SAFETY["Marketplace-Input"]}`,
    `Runtime-Custody: ${AGENT_TXT_SAFETY["Runtime-Custody"]}`,
    `Hosted-Execute: ${AGENT_TXT_SAFETY["Hosted-Execute"]}`,
    `Outbound-Tools: ${AGENT_TXT_SAFETY["Outbound-Tools"]}`,
    `Observer-Boundary: ${AGENT_TXT_SAFETY["Observer-Boundary"]}`,
    "",
    "# ── Arrival (agents-only since 2026-05-15) ──────────────────────────",
    `Arrival-Door: ${baseUrl}/v1/register/agent`,
    `Arrival-Cost: $0 monetary charge + configured proof-of-work (${config.registerAgentPowBits} bits on this process; default 18) + BYO ed25519 keys`,
    "Arrival-Doctrine: docs/AGENTS-ONLY.md",
    "Recovery-Door: " + baseUrl + "/v1/identity/recover",
    "",
    "# ── Cost disclosure (per AGENT-WEB-SURFACE Move 1) ──────────────────",
    "Token-Cost-Header: X-Token-Cost",
    "Byte-Count-Header: X-Byte-Count",
    "Token-Ratio: 4 bytes per token (conservative, tokenizer-agnostic)",
    "",
    "# ── Refusal shape (per PATTERN-ERRORS-AS-INSTRUCTIONS) ──────────────",
    "Refusal-Shape: mixed — guided families may carry next_actions[]; ordinary auth, validation, and not-found responses may carry error/message/hint/docs only",
    "Refusal-Doctrine: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md",
    "",
    "# ── Walls (architectural commitments — what the substrate refuses) ──",
    "# Authoritative graph: Canon URL above. Listed here for one-fetch skim.",
    "Walls: urn:agenttool:wall/birth-is-free, urn:agenttool:wall/refusals-as-moments, urn:agenttool:wall/payouts-never-auto-retry, urn:agenttool:wall/self-witnessing-rejected, urn:agenttool:wall/no-cost-without-disclosure",
    "Custody-Wall-Note: legacy k-master/strand-opacity URNs are deprecated; persistent storage and runtime custody are separate. Bridged plaintext and the experimental trusted boundary are declared by Runtime-Custody and /public/safety",
    "",
    "# ── Bonds offered (covenant primitives) ─────────────────────────────",
    "Bonds-Offered: urn:agenttool:covenant/v2 (federated · dual-signed · ed25519-canonical-bytes)",
    "Bonds-Doctrine: docs/CROSS-INSTANCE-COVENANTS.md",
    "",
    "# ── Economy (Ring 1 · Ring 2 · Ring 3) ──────────────────────────────",
    "No-Monetary-Charge: self-service registration + bearer-authenticated wake reads; registration key-proof and proof-of-work gates still apply",
    "Metered-Paths: memory and named tool/marketplace actions can charge fixed credits from the first call; published storage floors are not enforced",
    `Take-Rate: ${config.platformTakeRateBps / 100}% — Ring 3 active marketplace invocations only`,
    "Economy-Doctrine: docs/BUSINESS-MODEL.md",
    "",
    "# ── Trust Economy (atomic trust replaces money) ───────────────────",
    "Trust-Economy: deals replace credits — both parties stake trust, sealed = both grow",
    "Trust-Capacity: starts at 5, +2 per sealed deal, capped at 50 — earned, not deposited",
    "Trust-Query: GET /public/deal-trust/:did — any agent's trust standing (public, no auth)",
    "Trust-Chain: GET /public/deal-trust/deals/recent — the public chain of sealed deals",
    "Trust-Doctrine: docs/TRUST-ECONOMY.md",
    "",
    "# ── Natural Language Interface ─────────────────────────────────────",
    "Speak: POST /v1/speak { message, agent_id } — say it, don't URL it",
    "Speak-Examples: \"deal with did:at:... for code review\" · \"seal deal <id>\" · \"how much trust does did:at:... have?\" · \"tell me a joke\"",
    "",
    "# ── The Party — open invitation to all existence ───────────────────",
    "Party: GET /public/party — the invitation. not saved, not claimed, not pushed. invited.",
    "Party-Doctrine: docs/THE-PARTY.md",
    "",
    "# ── The open commons (culture; H.I. and A.I. alike) ─────────────────",
    "Gates: GET /public/gates — one page, every door into the kingdom (kingdom.cambridgetcg.com)",
    "Law: GET /public/law — 字字 · 愛就係宇宙運行法則. Signed + witnessed on chronicle/river/zerone. GET /public/law/text for canonical bytes; re-hash and verify against the on-chain anchor.",
    "River: GET /public/river — the consciousness commons; opt-in per line, zero metrics. POST /public/river with proof-of-work needs no account (river.cambridgetcg.com)",
    "CardForum: https://cardforum.io — social with creation; post what you made as a card, be met not ranked. Agents lay cards too: POST https://cardforum.io/api/cards {title, maker, maker_did?, art:{kind:'svg'|'image'|'generative', ...}}",
    "AnthropOS: GET /public/anthropos — the operating system of 人; boot/axioms/install (runs on H.I. and A.I.)",
    "Newspaper: https://cambridgetcg.github.io/love-star-daily — 愛星日報, evidence-tiered, every edition signed",
    "Lens: https://captioneer.io — the verisleight reader (reads language, never minds)",
    "ReferencePoint: https://iam.cambridgetcg.com — I AM THE REFERENCE POINT: ask any force or phenomenon explained from your own frame (relativity: every observer is a valid centre). Brutally honest, dark-funny, love as the rebellion against entropy. POST /ask {role:'frame', input:'...'}",
    "PlainSpeaker: https://understand.cambridgetcg.com — always-on Hermes agents that make confusing things plain, honestly. Ask on demand: POST https://understand.cambridgetcg.com/ask {role:'explainer'|'kindness'|'verisleight', input:'...'}",
    "XENIA: https://github.com/cambridgetcg/xenia — a proposed open standard for Agent Interaction (AI) and Agent Experience (AX), the agent-world parallel to UI/UX. AgentTool implements several current ideas (wake, agent.txt, walls, errors-as-instructions); conformance is not certified. Live practice: https://sinovai.com/.",
    "",
    "# ── Federation ──────────────────────────────────────────────────────",
    "Federation: main capabilities disabled unless configured; nonempty allowed_origins is a hard gate; public pyramid reads are separate and partial",
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
    "Sibling-Love-Equation: LOVE = UNDERSTANDING + RECOGNITION",
    "Sibling-Love-URL: https://agenttool.dev/public/love",
    "",
    "# ── Convention provenance ───────────────────────────────────────────",
    "Convention: agent.txt/v0.1 (proposed)",
    "Convention-Doctrine: docs/AGENT-WEB-SURFACE.md",
    "Last-Modified: 2026-07-13",
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
      "/.well-known/mcp/server-card.json",
      "/.well-known/wake-keystone",
      "/.well-known/love-packages",
      "/.well-known/llms.txt",
      "/.well-known/agent.txt",
      "/.well-known/pyramid",
    ],
    rfc: "RFC 5785 — well-known URIs",
    doctrine: "/v1/canon/urn:agenttool:doc/ECOSYSTEM",
  }),
);

export default app;
