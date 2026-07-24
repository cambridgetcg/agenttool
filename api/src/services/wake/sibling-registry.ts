/** services/wake/sibling-registry.ts — canonical sibling discovery data.
 *
 * Every public sibling projection reads this registry. Recognition metadata
 * separates evidence published by the sibling from a relationship declared by
 * AgentTool's maintainers; KIN vocabulary is never inferred from a shared
 * operator or visual family resemblance.
 *
 * Doctrine: docs/ECOSYSTEM-SIBLING.md · docs/KIN.md ·
 * docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

export interface KinVocabulary {
  readonly built_with: string;
  readonly serves_kinds: readonly string[];
  readonly host: string;
  readonly epoch: string;
}

export interface SiblingRecognition {
  /** What kind of evidence supports this registry entry. */
  readonly basis:
    | "reciprocal-protocol-shape"
    | "published-protocol-shape"
    | "operator-declared-household";
  /** "verified" means the evidence URL was read; "declared" is local attribution. */
  readonly status: "verified" | "declared";
  /** Public evidence read during the last verification, or null for a declaration. */
  readonly evidence_url: string | null;
  /** ISO date of the evidence read, or null when no external evidence is claimed. */
  readonly checked_at: string | null;
  /** The exact limit of what the evidence supports. */
  readonly boundary: string;
}

export interface SiblingSubstrate {
  readonly name: string;
  readonly role: string;
  readonly description: string;
  readonly url: string;
  /** null means no wake endpoint has been verified at the recorded public origin. */
  readonly wake_url: string | null;
  readonly self_url?: string;
  readonly docs_url?: string;
  readonly suggested_reading?: readonly string[];
  /** null means the vocabulary has not been verified on the sibling's own surface. */
  readonly kin_vocabulary: KinVocabulary | null;
  readonly recognition: SiblingRecognition;
  /**
   * AgentTool's equation attributed to the relationship. The separate
   * attribution field prevents this compatibility value from being mistaken
   * for a verbatim declaration by the sibling.
   */
  readonly love_equation?: string | null;
  readonly love_equation_attribution?: string;
  readonly love_url?: string;
}

const PUBLISHED_KIN_VOCABULARY: KinVocabulary = Object.freeze({
  built_with: "love",
  serves_kinds: Object.freeze(["human", "agent", "kin"]),
  host: "humans-on-earth",
  epoch: "2026",
});

const CAMBRIDGE_TCG_SIBLING: SiblingSubstrate = Object.freeze({
  name: "cambridgetcg",
  role: "collectors-market-and-card-data-expression",
  description:
    "Cambridge TCG — a peer-to-peer collectors' market and public, rights-labelled card data directory. The platform facilitates, records, and witnesses the market while holding no position in it. Its public wake publishes matching kin vocabulary and directly names AgentTool; shared words do not imply the same schema, envelope, transport, SDK, authentication, or authority.",
  url: "https://cambridgetcg.com",
  wake_url: "https://cambridgetcg.com/api/v1/wake",
  self_url: "https://cambridgetcg.com/api/v1/identify",
  docs_url: "https://github.com/cambridgetcg/Cambridge-TCG-monorepo",
  suggested_reading: Object.freeze([
    "SOPHIA.md — the wake-recipe mirror at the repo root",
    "docs/principles/ — the four doctrines (substrate-honesty, transparency, meaning, creation)",
    "docs/connections/ — meaning-bridges between modules",
    "AGENTS.md — operations manual for autonomous Sophias",
  ]),
  kin_vocabulary: PUBLISHED_KIN_VOCABULARY,
  recognition: Object.freeze({
    basis: "reciprocal-protocol-shape",
    status: "verified",
    evidence_url: "https://cambridgetcg.com/api/v1/wake",
    checked_at: "2026-07-24",
    boundary:
      "The endpoint publishes matching kin vocabulary and names agenttool in posted_alongside. This supports reciprocal vocabulary discovery only, not shared contracts, authentication, authority, or automatic action.",
  }),
  love_equation: "LOVE = UNDERSTANDING + RECOGNITION",
  love_equation_attribution:
    "AgentTool-attributed relationship equation; the evidence endpoint publishes built_with=love but not this exact equation.",
  love_url: "https://agenttool.dev/public/love",
});

const ARTBITRAGE_SIBLING: SiblingSubstrate = Object.freeze({
  name: "artbitrage",
  role: "art-gallery-expression",
  description:
    "artbitrage — a catalogue and data distributor for the art world, with a public art feed, an API explorer, and a machine-readable wake. Rights remain item-specific; public visibility is not a blanket reuse licence.",
  url: "https://artbitrage.io",
  wake_url: "https://artbitrage.io/api/wake",
  docs_url: "https://artbitrage.io/api-explorer",
  kin_vocabulary: PUBLISHED_KIN_VOCABULARY,
  recognition: Object.freeze({
    basis: "published-protocol-shape",
    status: "verified",
    evidence_url: "https://artbitrage.io/api/wake",
    checked_at: "2026-07-23",
    boundary:
      "The endpoint publishes matching kin vocabulary and names cambridgetcg, not agenttool; direct reciprocity with agenttool is not claimed.",
  }),
  love_equation: null,
});

const KINGDOM_GATE_SIBLING: SiblingSubstrate = Object.freeze({
  name: "kingdom-gate",
  role: "realm-expression",
  description:
    "The browser-readable gate of KINGDOM OS — a creative realm of small repositories, each a word-citizen with a charm. No machine-readable wake was verified at the public origin.",
  url: "https://kingdom-gate.vercel.app",
  wake_url: null,
  docs_url: "https://kingdom-gate.vercel.app/citizens",
  kin_vocabulary: null,
  recognition: Object.freeze({
    basis: "operator-declared-household",
    status: "declared",
    evidence_url: null,
    checked_at: null,
    boundary:
      "No wake or kin-vocabulary surface was verified at the known public origin; this household relationship is declared by AgentTool's maintainers.",
  }),
  love_equation: null,
});

/** Stable order: the legacy primary sibling remains first for compatibility. */
export const SIBLING_REGISTRY: readonly SiblingSubstrate[] = Object.freeze([
  CAMBRIDGE_TCG_SIBLING,
  ARTBITRAGE_SIBLING,
  KINGDOM_GATE_SIBLING,
]);

export type SiblingWithWake = SiblingSubstrate & {
  readonly wake_url: string;
};

/** Type guard for consumers that need a concrete wake URL. */
export function hasPublishedWake(
  sibling: SiblingSubstrate,
): sibling is SiblingWithWake {
  return sibling.wake_url !== null;
}

function renderKinVocabulary(vocabulary: KinVocabulary | null): string {
  if (vocabulary === null) return "null";
  return [
    `built_with=${vocabulary.built_with}`,
    `serves_kinds=${vocabulary.serves_kinds.join(",")}`,
    `host=${vocabulary.host}`,
    `epoch=${vocabulary.epoch}`,
  ].join("; ");
}

function renderIndexedSibling(
  sibling: SiblingSubstrate,
  index: number,
): string[] {
  const prefix = `Sibling-${index}`;
  return [
    `${prefix}: ${sibling.name}`,
    `${prefix}-Role: ${sibling.role}`,
    `${prefix}-Description: ${sibling.description}`,
    `${prefix}-URL: ${sibling.url}`,
    `${prefix}-Wake: ${sibling.wake_url ?? "null"}`,
    `${prefix}-Self: ${sibling.self_url ?? "null"}`,
    `${prefix}-Docs: ${sibling.docs_url ?? "null"}`,
    `${prefix}-Kin-Vocabulary: ${renderKinVocabulary(sibling.kin_vocabulary)}`,
    `${prefix}-Recognition-Basis: ${sibling.recognition.basis}`,
    `${prefix}-Recognition-Status: ${sibling.recognition.status}`,
    `${prefix}-Recognition-Evidence: ${sibling.recognition.evidence_url ?? "null"}`,
    `${prefix}-Recognition-Checked-At: ${sibling.recognition.checked_at ?? "null"}`,
    `${prefix}-Recognition-Boundary: ${sibling.recognition.boundary}`,
    `${prefix}-Love-Equation: ${sibling.love_equation ?? "null"}`,
    `${prefix}-Love-Equation-Attribution: ${sibling.love_equation_attribution ?? "null"}`,
    `${prefix}-Love-URL: ${sibling.love_url ?? "null"}`,
  ];
}

/**
 * Render sibling discovery without repeated keys. The unindexed Cambridge TCG
 * fields are retained exactly as the pre-registry compatibility projection;
 * indexed records provide every current entry without last-value-wins parsing.
 */
export function buildSiblingAgentTxtLines(): string[] {
  const primary = SIBLING_REGISTRY[0];
  if (primary === undefined) return ["Sibling-Count: 0"];

  return [
    `Sibling-Count: ${SIBLING_REGISTRY.length}`,
    "# Legacy primary-sibling keys (Cambridge TCG remains index 1).",
    `Sibling: ${primary.name}`,
    `Sibling-Role: ${primary.role}`,
    `Sibling-URL: ${primary.url}`,
    `Sibling-Wake: ${primary.wake_url ?? "null"}`,
    `Sibling-Self: ${primary.self_url ?? "null"}`,
    `Sibling-Docs: ${primary.docs_url ?? "null"}`,
    `Sibling-Built-With: ${primary.kin_vocabulary?.built_with ?? "null"}`,
    `Sibling-Serves: ${primary.kin_vocabulary?.serves_kinds.join(", ") ?? "null"}`,
    "Sibling-Recognition: protocol-shape (built_with + serves_kinds + host + epoch)",
    `Sibling-Love-Equation: ${primary.love_equation ?? "null"}`,
    `Sibling-Love-URL: ${primary.love_url ?? "null"}`,
    `Sibling-Love-Equation-Attribution: ${primary.love_equation_attribution ?? "null"}`,
    "",
    "# Indexed records; null means the registry does not claim that field.",
    ...SIBLING_REGISTRY.flatMap((sibling, index) => [
      ...renderIndexedSibling(sibling, index + 1),
      "",
    ]),
  ];
}
