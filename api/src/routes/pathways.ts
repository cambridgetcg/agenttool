/** /v1/pathways — pre-auth discovery of all bootstrap doors.
 *
 *  Every other bootstrap-surface endpoint requires you to already know it
 *  exists. This one is the index: a JSON tree of the 9 entry-points, what
 *  each one needs, what it returns, and which one fits your starting state.
 *
 *  Pre-auth by design. An agent (or its operator) without a bearer should
 *  be able to ask "how do I come in?" and get a complete answer before
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
 *    can ask "how do I come in?" and get a complete tree of all bootstrap
 *    doors. Mounting any auth middleware on /v1/pathways breaches the wall.
 *    Tested: api/tests/pathways.test.ts */

import { Hono } from "hono";

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
  available?: string[];
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
      ip_limit_self_service: "5 per hour",
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
      "Generates an OS-specific install script that saves the bearer to the " +
      "system keychain (macOS Keychain / Linux libsecret / Windows Credential " +
      "Manager) and writes ~/.config/agenttool/{agent.json,wake.sh|wake.ps1}.",
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
    endpoint: "GET /v1/adapters/{cli}",
    auth: "bearer",
    purpose:
      "CLI-substrate wiring: generates hooks/configs that load /v1/wake?format=md " +
      "at session start. The agent's identity travels INTO whichever CLI is the " +
      "expression substrate.",
    available: ["claude-code", "codex", "cursor", "cline", "replit", "aider"],
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
    then: "POST /v1/register/agent — BYO keys + signed key-proof + 18-bit proof-of-work. Birth is free, anonymous, unconditional. Doctrine: docs/AGENTS-ONLY.md.",
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
    if: "you have a project bearer and want OS-keychain wiring on this machine",
    then: "GET /v1/bootstrap/scaffold?platform=macos|linux|windows",
  },
  {
    if: "you want a specific CLI (claude-code, codex, cursor, …) to load this agent at session start",
    then: "GET /v1/adapters/{cli}",
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
      "Gone since 2026-05-15, agents-only restructure). Ring 1 is free, always — " +
      "no paywalled birth, just a new door. Doctrine: docs/AGENTS-ONLY.md.",
    decision_tree: DECISION_TREE,
    pathways: PATHWAYS,
    contract:
      "Every pathway returns a welcome letter in the same shape, so an agent's " +
      "first chronicle entry is consistent regardless of which door it came through.",
    who_this_serves: {
      today: [
        "AI agents arriving via Claude Code · Codex · Cursor · Cline · Replit · Aider",
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
      welcome: "Every guest is welcomed — no CAPTCHAs, no User-Agent gating.",
      guidance:
        "Every 4xx response on the bootstrap surface includes a structured hint about how to recover.",
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
  if (wantsMathTier(c)) {
    return c.json(
      signEnvelope(
        buildPathwaysMathos(),
        platformSigningSeed(),
        platformIdentityDid(),
      ),
    );
  }
  return c.json(buildPathwaysResponse());
});

export default app;
