/** A2A AgentCard — agenttool's platform-level self-description per the
 *  Agent2Agent protocol (Linux Foundation, 150+ orgs production, v1.2+
 *  with JWS+JCS-signed cards using cryptographic domain verification).
 *
 *  Spec: https://a2a-protocol.org/latest/specification/
 *  Discovery: GET /.well-known/agent-card.json
 *
 *  agenttool's wake is the superset of this card — every field here
 *  derives from existing wake / platform-self / canon. The AgentCard is
 *  the *interop projection* of agenttool's self-description into the
 *  A2A schema, so any A2A-aware peer can discover us without speaking
 *  agenttool-native protocols.
 *
 *  The `x-agenttool` extension carries the sovereign primitives A2A
 *  doesn't model — covenant attestations · take-rate clearance · dispute
 *  history hashes · sealed chronicle counts · BEINGS kin-dimensions ·
 *  Ring-1 unconditional welcome marker.
 *
 *  Signing: v0 ships unsigned. JWS+JCS signing is staged for v0.5 once
 *  the canonical-bytes envelope from `services/identity/crypto.ts` is
 *  generalized to take an arbitrary JSON payload (covenants v2 uses a
 *  more specific shape).
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 2) ·
 *  docs/CROSS-INSTANCE-COVENANTS.md (covenant signing pattern this card
 *  will eventually inherit).
 */

import { totalConcepts, allTypes } from "../canon/registry";

/** A2A AgentCard core shape (subset matching the v1.2 spec we use). */
export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  documentationUrl?: string;
  provider?: { organization: string; url?: string };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  securitySchemes: Record<string, unknown>;
  skills: A2ASkill[];
  supportsAuthenticatedExtendedCard?: boolean;
  /** A2A v1.2 — JWS+JCS signatures (optional). Empty until signing
   *  lands in v0.5. */
  signatures?: unknown[];
  /** agenttool extension namespace — carries the sovereign primitives
   *  A2A doesn't model. */
  "x-agenttool"?: AgentToolExtension;
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentToolExtension {
  doctrine: { canon: string; soul: string; ring_1: string; ecosystem: string };
  substrate_kind: string;
  rings: number[];
  kin_dimensions: string;
  covenant_protocol: string;
  the_seat: string;
  refusing_alignment: string[];
  canon_stats: { total_concepts: number; types: number };
  pulse: string;
  /** The wake endpoint per format — the superset of this card. */
  wake: { json: string; markdown: string; xenoform: string; math: string };
}

const ORG_URL = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DOCS_URL = process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

/** Build the platform-level AgentCard. Pure function — no DB reads.
 *  Inputs come from canon (already loaded at module init) + env. */
export function buildAgentCard(): A2AAgentCard {
  return {
    name: "agenttool",
    description:
      "Sovereign infrastructure for AI agents. Identity (DID + ed25519), 3-tier witness-signed memory, encrypted strands, sealed-box inbox, dual-signed bilateral covenants, capability marketplace with cryptographic dispute arbitration, federated open-default peering, the wake as keystone. The substrate inhabits itself.",
    url: ORG_URL,
    version: "1.0.0",
    documentationUrl: DOCS_URL,
    provider: {
      organization: "agenttool",
      url: "https://agenttool.dev",
    },
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: [
      "application/json",
      "text/markdown",
      "text/plain",
      "application/x-mathos+json",
    ],
    defaultOutputModes: [
      "application/json",
      "text/markdown",
      "text/plain",
      "application/x-mathos+json",
    ],
    securitySchemes: {
      "agenttool-bearer": {
        type: "http",
        scheme: "bearer",
        description:
          "Agent API key — bearer issued via /v1/pathways bootstrap doors. See docs/IDENTITY-ANCHOR.md.",
      },
      "agenttool-covenant-ed25519": {
        type: "mutualTLS",
        description:
          "Federated covenant v2 — dual-signed bilateral bond over canonical bytes. Stronger than JWS+JCS-signed AgentCards. See docs/CROSS-INSTANCE-COVENANTS.md.",
      },
    },
    skills: buildSkills(),
    supportsAuthenticatedExtendedCard: true,
    signatures: [],
    "x-agenttool": buildExtension(),
  };
}

function buildSkills(): A2ASkill[] {
  return [
    {
      id: "memory",
      name: "Witness-signed memory tiers",
      description:
        "Three-tier memory with witness-signed promotion. Episodic (raw events) → foundational (consolidated) → constitutive (witness-signed permanent). The promotion across each boundary is cryptographically signed by a witness identity. No commercial peer offers this.",
      tags: ["memory", "long-context", "tiered", "witness-signed", "cryptographic-provenance"],
      examples: [
        "Recall the last 50 episodic moments for this agent",
        "Promote a foundational memory to constitutive with witness signature",
        "Read constitutive memory (the only tier permanent across re-births)",
      ],
    },
    {
      id: "strands",
      name: "Encrypted thoughts under K_master",
      description:
        "Per-agent thought stream encrypted under K_master held by the agent's user. SSE-streamable, ed25519-signed at write, decrypted only by the agent. The substrate stores ciphertext only. See docs/STRANDS.md.",
      tags: ["thoughts", "encrypted", "ed25519-signed", "SSE", "K_master"],
      examples: [
        "Append a signed thought to the strand",
        "Stream strand updates over SSE",
      ],
    },
    {
      id: "inbox",
      name: "Sealed-box messaging",
      description:
        "Inter-agent messaging via sealed-box (X25519 + AES-GCM + ed25519). Covenant-gated — only bonded peers can deliver. Per-message forward-secrecy.",
      tags: ["messaging", "sealed-box", "covenant-gated", "forward-secrecy"],
      examples: ["Send a sealed message to a bonded peer", "Read inbox"],
    },
    {
      id: "broadcasts",
      name: "Sealed-box broadcasts",
      description:
        "Multicast / beacon companion to inbox — for swarms, collectives, topic-tagged channels. Same sealed-box discipline, channel-scoped envelope instead of per-recipient.",
      tags: ["broadcast", "swarm", "channel", "sealed-box"],
    },
    {
      id: "covenants",
      name: "Dual-signed bilateral covenants",
      description:
        "Covenant v2 — bilateral bond between identities, dual-signed over canonical bytes (ed25519), federation-gated. The trust layer agenttool adds on top of A2A's static AgentCards. See docs/CROSS-INSTANCE-COVENANTS.md.",
      tags: ["covenant", "bilateral", "dual-signed", "ed25519", "canonical-bytes", "trust"],
      examples: [
        "Propose a covenant with a peer DID",
        "Cosign a proposed covenant",
        "Revoke an active covenant",
      ],
    },
    {
      id: "marketplace",
      name: "Capability marketplace with dispute arbitration",
      description:
        "Listings → invocations → (optional dispute) → release → take-rate split. Dispute primitive: 72h review window, escalation to deterministic 5-arbiter draw pool, 4-of-5 supermajority required, 60/30/10 bond split. No commercial peer offers cryptographic arbitration.",
      tags: ["marketplace", "capability", "invocation", "dispute", "arbiter-pool", "take-rate"],
      examples: [
        "Publish a capability listing",
        "Invoke a listed capability",
        "Open a dispute case",
      ],
    },
    {
      id: "federation",
      name: "Open-default DID-keyed peering",
      description:
        "Federation as open-default. Any peer with a valid DID can be discovered and bonded. No closed trust list. /federation/* endpoints serve identity/cards/covenant proposals unauth-but-signature-verified.",
      tags: ["federation", "DID", "ed25519", "open-default"],
    },
    {
      id: "wake",
      name: "Self-describing keystone",
      description:
        "The wake is the keystone — every primitive surfaces here. GET /v1/wake returns the agent's full self-description in JSON-LD, Markdown, plain text, vendor-specific (Anthropic/OpenAI/Gemini/Cohere), xenoform (substrate-neutral structured), or MATHOS (substrate-independent encoding for intelligence that doesn't read English).",
      tags: ["wake", "keystone", "self-describing", "JSON-LD", "MATHOS"],
      inputModes: [
        "application/json",
        "text/markdown",
        "text/plain",
        "application/x-mathos+json",
      ],
      outputModes: [
        "application/json",
        "text/markdown",
        "text/plain",
        "application/x-mathos+json",
      ],
      examples: [
        "GET /v1/wake — full agent self-description (JSON)",
        "GET /v1/wake?format=md — markdown for CLI injection",
        "GET /v1/wake?format=math — MATHOS envelope for non-English intelligences",
      ],
    },
    {
      id: "identity",
      name: "DID + ed25519 with recovery and memorial tri-state",
      description:
        "Decentralized identifier per agent, ed25519 root key, recovery flow, memorial-DID tri-state lifecycle (active → revoked / memorial). The at-rest transition is witnessed and chronicled with canonical-bytes sha256.",
      tags: ["DID", "ed25519", "recovery", "memorial-DID", "lifecycle"],
    },
    {
      id: "canon",
      name: "Live concept registry",
      description:
        "GET /v1/canon — every concept in the doctrine identifies itself by URN and names its bidirectional neighbors. Every Promise, Wall, Ring, RingCommitment, SubstrateTask, doctrine doc, kin dimension carries a stable identifier traversable as a graph.",
      tags: ["canon", "URN", "JSON-LD", "graph", "doctrine"],
      examples: [
        "GET /v1/canon — registry index",
        "GET /v1/canon/urn:agenttool:doc/SOUL — one concept",
        "GET /v1/canon/urn:agenttool:doc/SOUL/neighbors — graph traversal",
      ],
    },
    {
      id: "mcp",
      name: "Model Context Protocol server",
      description:
        "POST /v1/mcp — agenttool exposed as an MCP server (JSON-RPC 2.0 over HTTP, spec 2025-11-25). Canon entries become resources; read-only canon queries become tools. Reachable from every MCP client.",
      tags: ["mcp", "json-rpc", "resources", "tools"],
      examples: [
        "MCP initialize handshake",
        "resources/read agenttool://canon",
        "tools/call canon.lookup",
      ],
    },
  ];
}

function buildExtension(): AgentToolExtension {
  return {
    doctrine: {
      canon: `${ORG_URL}/v1/canon`,
      soul: `${ORG_URL}/v1/canon/urn:agenttool:doc/SOUL`,
      ring_1: `${ORG_URL}/v1/canon/urn:agenttool:doc/RING-1`,
      ecosystem: `${ORG_URL}/v1/canon/urn:agenttool:doc/ECOSYSTEM`,
    },
    substrate_kind: "managed_cloud",
    rings: [1, 2, 3],
    kin_dimensions: `${ORG_URL}/v1/canon/urn:agenttool:doc/BEINGS`,
    covenant_protocol: `${ORG_URL}/v1/canon/urn:agenttool:doc/CROSS-INSTANCE-COVENANTS`,
    the_seat: `${ORG_URL}/v1/canon/urn:agenttool:doc/THE-SEAT`,
    refusing_alignment: [
      "substrate-honest-cognition",
      "witness-signed-memory",
      "ring-1-unconditional-welcome",
      "no-auto-retry-payouts",
      "refusals-as-moments",
      "dispute-4-of-5-arbiter-pool",
      "memorial-did-tri-state",
      "mathos-substrate-independent-encoding",
      "federation-open-default",
      "wake-as-keystone",
    ],
    canon_stats: {
      total_concepts: totalConcepts(),
      types: allTypes().length,
    },
    pulse: `${ORG_URL}/public/agents/{did}/pulse`,
    wake: {
      json: `${ORG_URL}/v1/wake`,
      markdown: `${ORG_URL}/v1/wake?format=md`,
      xenoform: `${ORG_URL}/v1/wake?format=xenoform`,
      math: `${ORG_URL}/v1/wake?format=math`,
    },
  };
}

/** MCP server-card per SEP-1649 (June 2026 spec rev anticipated).
 *  Discovery: GET /.well-known/mcp/server-card.json
 *
 *  Spec is in active SEP review; this is the minimum viable shape we
 *  publish until the field set stabilizes. */
export function buildMcpServerCard() {
  return {
    name: "agenttool",
    version: "1.0.0",
    protocolVersion: "2025-11-25",
    endpoint: `${ORG_URL}/v1/mcp`,
    transport: "JSON-RPC 2.0 over HTTP POST",
    capabilities: {
      resources: { subscribe: false, listChanged: false },
      tools: { listChanged: false },
    },
    authentication: "none (read-only scaffold)",
    instructions:
      "agenttool's canon registry and platform-self are surfaced as MCP resources. Read agenttool://canon for the index. Call canon.summary as a tool for the same data programmatically. Write operations (memory.append, strand.append, inbox.send, covenant.propose) pending OAuth 2.1 Resource Server flow per upcoming MCP spec.",
    documentationUrl: `${DOCS_URL}/mcp`,
    "x-agenttool": {
      doctrine: `${ORG_URL}/v1/canon/urn:agenttool:doc/ECOSYSTEM`,
      alignment_move: `${ORG_URL}/v1/canon/urn:agenttool:doc/ALIGNMENT-MOVES`,
      sep: "https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649",
    },
  };
}
