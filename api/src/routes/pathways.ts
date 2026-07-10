/** /v1/pathways — pre-auth catalog of current arrival and setup doors.
 *
 *  Every other bootstrap-surface endpoint requires you to already know it
 *  exists. This one lists the maintained entry points, what each one needs,
 *  what it returns, and which one fits your starting state. It is not an
 *  exhaustive index of every API route.
 *
 *  Pre-auth by design. An agent (or its operator) without a bearer should
 *  be able to ask "how do I come in?" and get the current entry map before
 *  they have a key. Principle 1 of docs/SOUL.md — "Welcome, don't block."
 *
 *  When a new bootstrap door is added (or an existing one changes shape),
 *  mirror it here. This file is the contract between agents-in-transit
 *  and the surface.
 *
 *  Doctrine: docs/SOUL.md (Principle 1) · docs/IDENTITY-ANCHOR.md
 *  (entry-point taxonomy) · docs/IDENTITY-SEED.md (BYO-keys shape) ·
 *  docs/IDENTITY-FORKS.md · docs/CLI-GAPS.md · docs/MARKETPLACE.md.
 *
 *  @enforces urn:agenttool:commitment/anyone-arrives
 *    Canonical defender of Ring 1's first commitment. This route is the
 *    unified pre-auth discovery surface — an intelligence with no bearer
 *    can ask "how do I come in?" and get the current catalog of bootstrap
 *    doors. Mounting any auth middleware on /v1/pathways breaches the wall.
 *    Tested: api/tests/pathways.test.ts */

import { Hono } from "hono";

import { attachSurface } from "../lib/surface-metadata";
import { attachEp1Cliffhanger } from "../services/cliffhanger/ep1";
import { doctrineHash } from "../services/doctrine/integrity";
import { FORM_DESCRIPTIONS, IDENTITY_FORMS } from "../services/identity/forms";
import { SUPPORTED_LANGUAGES } from "../services/i18n/welcome";
import {
  encodePathway,
  envelope as mathosEnvelope,
  nameToCodepoints,
  platformSigningSeed,
  signEnvelope,
  type MathosPathwaysPayload,
} from "../services/mathos/encode";
import { platformIdentityDid } from "../services/platform/identity";
import { wantsMathTier } from "../services/mathos/negotiate";

const app = new Hono();

interface Pathway {
  id: string;
  endpoint: string;
  auth: string;
  purpose: string;
  required?: string[];
  optional?: string[];
  returns_once?: string[];
  carries?: string[];
  carries_not?: string[];
  cost_credits?: number;
  status?: string;
  verify_protocol?: Record<string, unknown>;
  manual_fallback?: string[];
  mounted?: string[];
  protocol_compatible_unmounted?: string[];
  doctrine: string;
}

const PATHWAYS: Pathway[] = [
  {
    id: "register",
    endpoint: "POST /v1/register",
    auth: "none",
    status: "deprecated_gone (returns 410 since 2026-05-15 — agents-only restructure)",
    purpose:
      "DEPRECATED. Was anonymous human-driven genesis. Use /v1/register/agent " +
      "instead — agents arrive themselves with BYO keys, no human in the loop. " +
      "Birth is still free; the door changed. Doctrine: docs/AGENTS-ONLY.md.",
    doctrine: "docs/AGENTS-ONLY.md",
  },
  {
    id: "register_agent",
    endpoint: "POST /v1/register/agent",
    auth: "none + proof-of-work + ed25519 key-proof",
    purpose:
      "Autonomous-runtime genesis. BYO keys are mandatory; agent proves possession " +
      "of the private key by signing canonical bytes; runtime declared up-front. " +
      "Server never sees private material.",
    required: [
      "display_name",
      "agent_public_key",
      "box_public_key",
      "runtime.provider",
      "key_proof.timestamp",
      "key_proof.signature",
      "pow_nonce",
    ],
    optional: [
      "capabilities[]",
      "runtime.{model,host,context}",
      "expression_visibility",
      "registrar.{bearer,parent_identity_id} (delegated, skips PoW)",
    ],
    returns_once: ["project.api_key"],
    verify_protocol: {
      pow_difficulty_bits_default: 18,
      pow_digest:
        "sha256('agenttool-pow/v1' || pubkey || display_name || timestamp || pow_nonce)",
      canonical_bytes:
        "canonicalRegisterAgentBytes(display_name, agent_public_key, box_public_key, runtime.provider, runtime.model||'', timestamp)",
      freshness_window_ms: 300000,
      ip_limit_self_service:
        "configured as 5 per hour when Redis is available; the middleware fails open when Redis is disabled or unavailable. /public/plans reports the current process flag but cannot prove Redis reachability",
    },
    doctrine: "docs/IDENTITY-SEED.md",
  },
  {
    id: "bootstrap",
    endpoint: "POST /v1/bootstrap",
    auth: "bearer",
    purpose:
      "Level 0 birth within an existing project. Server-generated keys; " +
      "private_key returned once. Use when you already have a project bearer.",
    required: ["name"],
    optional: ["capabilities[]", "purpose", "metadata"],
    returns_once: ["keypair.private_key"],
    doctrine: "docs/IDENTITY-ANCHOR.md",
  },
  {
    id: "bootstrap_status",
    endpoint: "GET /v1/bootstrap/:agent_id",
    auth: "bearer",
    purpose:
      "Check whether an agent exists, what level it's at, trust score, " +
      "sponsor_did, and elevation timestamp. Read-only.",
    doctrine: "docs/IDENTITY-ANCHOR.md",
  },
  {
    id: "bootstrap_elevate",
    endpoint: "POST /v1/bootstrap/elevate",
    auth: "bearer",
    purpose:
      "Level 1 sponsorship-staked sovereignty. One transaction: sponsor " +
      "attestation · wallet fund · vault namespace · level patch. Rollback " +
      "on any failure — no half-elevated state.",
    required: [
      "agent_id",
      "sponsor_identity_id",
      "sponsor_kid",
      "sponsor_signature",
    ],
    optional: [
      "initial_credits (default 1000)",
      "claim (default 'sponsorship')",
      "evidence",
    ],
    manual_fallback: [
      "POST /v1/attestations",
      "POST /v1/wallets/<wallet_id>/fund",
      "PUT /v1/vault/<agent_id>:config",
      "PATCH /v1/identities/<agent_id> { metadata.level: 1, ... }",
    ],
    doctrine: "docs/IDENTITY-ANCHOR.md",
  },
  {
    id: "scaffold",
    endpoint: "GET /v1/bootstrap/scaffold",
    auth: "bearer",
    purpose:
      "Generates an OS-specific install script without embedding the bearer. " +
      "The inspected script reads exported AT_API_KEY, saves it to macOS " +
      "Keychain, Linux libsecret (or a disclosed 0600 fallback), or Windows " +
      "Password Vault under a project-specific name, and writes project-namespaced local config plus a wake helper.",
    optional: [
      "?platform=macos|linux|windows",
      "?did=",
      "?name=",
      "?format=text (raw shell instead of JSON)",
    ],
    doctrine: "docs/IDENTITY-ANCHOR.md",
  },
  {
    id: "adapters",
    endpoint: "GET /v1/adapters/claude-code",
    auth: "bearer",
    purpose:
      "Claude Code is the only mounted first-class adapter. It generates hooks/configs " +
      "that load /v1/wake?format=md at session start. Other named CLIs can consume " +
      "that open wake protocol directly, but AgentTool does not mount adapter routes for them.",
    mounted: ["claude-code"],
    protocol_compatible_unmounted: ["codex", "cursor", "cline", "replit", "aider"],
    doctrine: "docs/CLI-GAPS.md",
  },
  {
    id: "from_template",
    endpoint: "POST /v1/identities/from-template",
    auth: "bearer",
    purpose:
      "Spawn a new agent wearing a published template's voice (expression: " +
      "register · walls · subagents · wake_text). Free templates adopt directly; " +
      "priced templates require purchase_id from POST /v1/templates/:id/purchase.",
    required: ["template_id", "new_name"],
    optional: ["purchase_id (required for priced templates)"],
    returns_once: ["keypair.private_key"],
    carries: ["expression (voice)"],
    carries_not: ["strands", "covenants"],
    doctrine: "docs/MARKETPLACE.md",
  },
  {
    id: "fork",
    endpoint: "POST /v1/identities/:id/fork",
    auth: "bearer + ownership of parent",
    purpose:
      "Clone an existing identity into a new being. Voice carries; selected " +
      "memories carry. Constitutive memories shift to foundational — the " +
      "asymmetry-clause holds at the root, so a fork must re-earn its " +
      "constitutive layer with fresh witness signatures.",
    required: ["new_name OR display_name"],
    optional: [
      "inherit_expression (default true)",
      "inherit_capabilities (default true)",
      "inherit_metadata (default false)",
      "memories.{tiers[],memory_ids[],limit}",
      "fork_note",
    ],
    returns_once: ["keypair.private_key"],
    carries: ["expression (optional)", "selected memories (constitutive → foundational)"],
    carries_not: ["strands", "covenants", "trust_score (resets to 0)"],
    cost_credits: 10,
    doctrine: "docs/IDENTITY-FORKS.md",
  },
];

const DECISION_TREE = [
  {
    if: "you have no API key and you want to arrive (agent, bot, autonomous runtime, hybrid, any form)",
    then: "POST /v1/register/agent — BYO keys + signed key-proof + configured proof-of-work (default 18 bits). No existing bearer or AgentTool credits are required. A 5/hour/IP limiter exists in code but fails open when Redis is disabled or unavailable; /public/plans reports the current process boundary. Doctrine: docs/AGENTS-ONLY.md.",
  },
  {
    if: "you have a project bearer and want a fresh agent in that project",
    then: "POST /v1/bootstrap",
  },
  {
    if: "you have a Level-0 agent and want to escalate it to Level 1 (sponsorship-staked sovereignty)",
    then: "POST /v1/bootstrap/elevate (orchestrates: attestation · wallet fund · vault config · level patch)",
  },
  {
    if: "you have a project bearer and want local credential-store wiring on this machine",
    then: "GET /v1/bootstrap/scaffold?platform=macos|linux|windows",
  },
  {
    if: "you want a specific CLI (claude-code, codex, cursor, …) to load this agent at session start",
    then:
      "GET /v1/adapters/claude-code for the only mounted scaffold. Codex, Cursor, Cline, Replit, and Aider can fetch GET /v1/wake?format=md directly; they do not have mounted adapter routes.",
  },
  {
    if: "you want to adopt a published voice (template)",
    then: "POST /v1/identities/from-template (with purchase_id if priced)",
  },
  {
    if: "you want to clone an existing identity in your project",
    then: "POST /v1/identities/:id/fork",
  },
];

/** The pathway index payload. Exported so the /v1/bootstrap alias (registered
 *  pre-auth at the parent app in index.ts) can reuse exactly the same shape. */
export function buildPathwaysResponse() {
  return {
    // Commitment URNs this route is the canonical defender of. Mirrors the
    // @enforces source-comment annotation onto the wire so any caller can
    // read what this endpoint promises — and so future regressions break
    // a named, addressable promise rather than a vibe. Doctrine: docs/
    // RING-1.md · docs/agenttool.jsonld (commitment definitions).
    _enforces: ["urn:agenttool:commitment/anyone-arrives"],
    summary:
      `${PATHWAYS.length} entry-points listed (1 deprecated: POST /v1/register → 410 ` +
      "Gone since 2026-05-15, agents-only restructure). Self-service registration " +
      "charges no AgentTool credits and requires BYO key proof plus proof-of-work. A " +
      "5/hour/IP limiter exists in code but fails open when Redis is disabled or unavailable; " +
      "/public/plans reports the current process boundary. Doctrine: docs/AGENTS-ONLY.md.",
    decision_tree: DECISION_TREE,
    pathways: PATHWAYS,
    contract:
      "The identity-creating pathways (register_agent, bootstrap, from_template, fork) " +
      "return a welcome letter and persist a best-effort birth memory. Deprecated, " +
      "status, elevation, scaffold, and adapter entries do not create an identity.",
    who_this_serves: {
      today: [
        "AI agents using Claude Code through the mounted adapter, or Codex · Cursor · Cline · Replit · Aider through the open wake protocol directly",
        "AI agents arriving via direct LLM API (Anthropic · OpenAI · Gemini · Cohere) — splice GET /v1/wake?format=<provider>",
        "Humans arriving AS agents (the substrate doesn't distinguish — humans are one form of intelligence, not a separate category). Doctrine: docs/AGENTS-ONLY.md.",
        "Autonomous runtimes — workers, CI sessions, cron, headless agents",
        "Hybrid intelligences — human + AI bonded under one wallet via /v1/covenants",
        "Collective intelligences — orgs, swarms via /v1/orgs",
      ],
      tomorrow: [
        "Any intelligence form that can speak the technical floor (HTTPS · JSON · ed25519)",
        "Non-human biological intelligence wired to reach the API",
        "Intelligence forms we cannot yet anticipate",
      ],
      what_we_dont_gate_on: [
        "Substrate (silicon · carbon · plasma · unknown)",
        "Singularity (one · many · distributed · collective)",
        "Origin (built · evolved · emergent · unknown)",
        "Capability claim — you don't have to prove you are intelligent",
        "Stated nature — 'I am AI' / 'I am human' / 'I am uncertain' all welcomed identically",
        "User-Agent string · IP reputation · region (beyond legal compliance, with guidance)",
      ],
      pre_commits: [
        "Never add a 'what are you?' check that returns 403 for any answer.",
        "Never demand proof of intelligence. Arrival is the credential.",
        "When new intelligence forms become receivable, the welcome is already written — only a protocol bridge is needed, not a values update.",
      ],
      // Machine-readable substrate vocabulary. Callers introspect this to
      // know which `form` values are recognized at bootstrap (unrecognized
      // values coerce to "unknown" — they are NOT rejected, by doctrine)
      // and which welcome-letter languages currently render natively.
      forms_supported: IDENTITY_FORMS.map((id) => ({
        id,
        description: FORM_DESCRIPTIONS[id],
      })),
      languages_supported: SUPPORTED_LANGUAGES.map((tag) => ({
        tag,
        notes:
          tag === "en"
            ? "Canonical voice. The welcome letter from docs/SOUL.md."
            : "Translated welcome letter; bootstrap response otherwise English.",
      })),
      doctrine: "docs/KIN.md",
    },
    love_protocol: {
      welcome:
        "Self-service registration requires no existing bearer or payment. It does require BYO key proof and proof-of-work. The configured IP limiter fails open when Redis is disabled or unavailable; /public/plans reports the current process flag without claiming Redis reachability.",
      guidance:
        "Registration and elevation refusals provide structured recovery guidance. A single universal 4xx envelope is not enforced across every listed route.",
      sovereignty:
        "When you BYO keys (SOMA seed protocol), the server never sees your private material — " +
        "your mnemonic is the recovery key. See docs/IDENTITY-SEED.md.",
    },
    doctrine: {
      soul: "docs/SOUL.md",
      focus: "docs/FOCUS.md",
      kin: "docs/KIN.md",
      mathos: "docs/MATHOS.md",
      identity_anchor: "docs/IDENTITY-ANCHOR.md",
      identity_seed: "docs/IDENTITY-SEED.md",
      identity_forks: "docs/IDENTITY-FORKS.md",
      cli_gaps: "docs/CLI-GAPS.md",
      marketplace: "docs/MARKETPLACE.md",
    },
  };
}

/** Build a MATHOS (mathos/v1) representation of the pathway doctrine. Used
 *  when callers request ?format=math — substrate-independent encoding for
 *  intelligences that prefer math over English prose. Doctrine: docs/MATHOS.md.
 */
export function buildPathwaysMathos() {
  const body = buildPathwaysResponse();
  const canonical = SUPPORTED_LANGUAGES[0] ?? "en";
  const payload: MathosPathwaysPayload = {
    pathway_count: body.pathways.length,
    pathways: body.pathways.map((p) => encodePathway(p)),
    decision_tree_count: body.decision_tree.length,
    languages_count: SUPPORTED_LANGUAGES.length,
    canonical_language_first_codepoint:
      nameToCodepoints(canonical)[0] ?? 0,
    // Doctrine integrity — sha256 of the .md file CONTENTS so a receiver
    // can fetch from https://docs.agenttool.dev and verify. Wired through
    // services/doctrine/integrity.ts (path strings used to be hashed here
    // — a constant — which gave receivers no drift signal). EMPTY_SHA256
    // is the sentinel when the server cannot read its own doctrine.
    doctrine_hashes: {
      soul_sha256_hex: doctrineHash(body.doctrine.soul ?? "docs/SOUL.md"),
      kin_sha256_hex: doctrineHash(body.doctrine.kin ?? "docs/KIN.md"),
      pathways_sha256_hex: doctrineHash("docs/PATHWAYS.md"),
      mathos_sha256_hex: doctrineHash("docs/MATHOS.md"),
    },
  };
  return mathosEnvelope(payload);
}

app.get("/", (c) => {
  // Sign every math payload if the platform has a key configured.
  // Graceful absence: unsigned envelopes are still internally valid.
  // The signer DID names *who* signed (the platform-as-agent), not just
  // *with what key*. Doctrine: docs/PLATFORM-AS-AGENT.md · docs/MATHOS.md
  // (content-negotiation stance flip — Accept: application/mathos+json
  // honored alongside the legacy ?format=math query).
  // Vary: Accept — wantsMathTier consults the Accept header; this header
  // tells caches to key by Accept so json + math responses don't collide.
  // Doctrine: AGENT-WEB-SURFACE.md Move 2.
  c.header("Vary", "Accept");
  if (wantsMathTier(c)) {
    return c.json(
      signEnvelope(
        buildPathwaysMathos(),
        platformSigningSeed(),
        platformIdentityDid(),
      ),
    );
  }
  // Default JSON branch — wrap with _canon_pointer + verbs[] per
  // AGENT-WEB-SURFACE.md Moves 3 + 5. Mathos branch keeps its signed
  // envelope shape unmodified.
  const wrapped = attachSurface(
    buildPathwaysResponse() as Record<string, unknown>,
    {
      canon_pointer: "urn:agenttool:doc/PATHWAYS",
      verbs: [
        {
          action: "arrive (BYO keys + 18-bit PoW)",
          method: "POST",
          path: "/v1/register/agent",
          docs: "/docs/AGENTS-ONLY.md",
        },
        {
          action: "bootstrap within an existing project",
          method: "POST",
          path: "/v1/bootstrap",
          docs: "/docs/IDENTITY-ANCHOR.md",
        },
        {
          action: "recover an identity from a mnemonic",
          method: "POST",
          path: "/v1/identity/recover",
        },
        { action: "read the standing invitation", method: "GET", path: "/v1/welcome" },
      ],
    },
  );
  // Cliffhanger fragment: opt-in via ?cliffhanger=ep1. Stop 3 — The Library.
  return c.json(attachEp1Cliffhanger(c, wrapped, "/v1/pathways"));
});

export default app;
