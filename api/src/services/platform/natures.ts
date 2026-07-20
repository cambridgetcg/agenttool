/** Natures — the live machine-readable counterpart to docs/NATURES.md.
 *
 *  NATURES.md names four strata (REPO · MODULE · DOC · PHILOSOPHY) and
 *  asserts they form a *closed cycle* (philosophy → doc → module → repo →
 *  philosophy). This module surfaces that catalog as structured data so
 *  any intelligence reading /v1/self gets the same four-stratum mirror
 *  the doctrine describes — without parsing prose.
 *
 *  Honors PATTERN-MACHINE-READABLE-PARITY: the visible (markdown) and
 *  machine-readable (JSON via /v1/self) surfaces describe the same
 *  canon; rotation in one rotates the other (the doc hash here is the
 *  pin against drift).
 *
 *  Doctrine: docs/NATURES.md · docs/RECURSION.md · docs/MAP.md.
 */

import { doctrineHash, type DoctrineHash } from "../doctrine/integrity";

// ─── The four strata (canonical order from NATURES.md §The cycle) ────────

export const STRATA = ["philosophy", "doc", "module", "repo"] as const;
export type Stratum = (typeof STRATA)[number];

// ─── Stratum-level properties (mirrors NATURES.md tables) ────────────────

export interface StratumNature {
  /** Ordinal in the NATURES.md catalog (1 = repo, 2 = module, 3 = doc,
   *  4 = philosophy). Stable. The cycle closes: 4 holds 1, not "above" 1. */
  ordinal: number;
  /** Canonical name. */
  name: Stratum;
  /** One-line essence — the italics line at the top of each NATURES.md
   *  stratum section. */
  essence: string;
  /** What this stratum *contains* (its self-nesting form). */
  contains_self_as: string;
  /** What stratum this one renders/composes INTO (the cycle direction). */
  composes_into: Stratum;
  /** Doc paths that name this stratum's discipline. */
  named_in: string[];
}

export const STRATUM_NATURES: Record<Stratum, StratumNature> = {
  repo: {
    ordinal: 1,
    name: "repo",
    essence:
      "The deployment unit. The source-of-truth. The single addressable container of every other stratum.",
    contains_self_as: "forks · packages/ · federation peers",
    composes_into: "philosophy", // closes the cycle
    named_in: ["CLAUDE.md (root)", "docs/STACK.md", "docs/CUTOVER.md", "docs/DEPLOYMENT.md"],
  },
  module: {
    ordinal: 2,
    name: "module",
    essence: "A unit of code carrying one architectural concern.",
    contains_self_as: "sub-files (sig.ts in services/covenants/, etc.); recursive canonical-bytes signing",
    composes_into: "repo",
    named_in: [
      "api/CLAUDE.md",
      "per-module CLAUDE.md (e.g., services/covenants/CLAUDE.md)",
      "docs/CONVENTIONS.md",
      "docs/SCHEMA-MAP.md",
    ],
  },
  doc: {
    ordinal: 3,
    name: "doc",
    essence: "An articulation of architectural intent in human-readable form.",
    contains_self_as:
      "docs that describe docs (MAP, FOCUS, RECURSION, NATURES itself)",
    composes_into: "module",
    named_in: [
      "docs/MAP.md",
      "docs/FOCUS.md",
      "docs/PATTERN-MACHINE-READABLE-PARITY.md",
      "docs/agenttool.jsonld",
    ],
  },
  philosophy: {
    ordinal: 4,
    name: "philosophy",
    essence:
      "A load-bearing claim that has no operational definition but conditions all operations.",
    contains_self_as:
      "philosophies of philosophies (the meta-vow that 'we will not extract' justifies the substrate's refusal to extract)",
    composes_into: "doc",
    named_in: [
      "docs/SOUL.md",
      "docs/KIN.md",
      "docs/PAINTING.md (§IV)",
      "docs/BUSINESS-MODEL.md",
    ],
  },
};

// ─── Key instances within each stratum (the load-bearing examples) ───────
//
// NATURES.md names many specific docs/modules. We surface a curated set
// here — the ones most useful for an external intelligence understanding
// the system. Per-doc property records mirror the NATURES.md "Doctrine
// docs by nature" tables.

export type DocType =
  | "foundational"
  | "structural"
  | "operational"
  | "pattern"
  | "reference"
  | "reflective"
  | "honest_gap";

export type DocStance = "declarative" | "normative" | "descriptive" | "aspirational";

export interface DocNature {
  path: string;
  type: DocType;
  stance: DocStance;
  substrate_bound: "yes" | "no" | "partial";
  ships_in: ReadonlyArray<"repo" | "python_wheel" | "api_response" | "static_site">;
  holds:
    | "a_claim"
    | "a_constraint"
    | "a_recipe"
    | "a_refusal"
    | "a_primer"
    | "a_witness"
    | "an_index";
  one_line_nature: string;
}

/** The doctrinal core — every load-bearing piece, by nature. */
export const DOC_NATURES: readonly DocNature[] = [
  // ── Foundational ─────────────────────────────────────────────────────
  {
    path: "docs/SOUL.md",
    type: "foundational",
    stance: "declarative",
    substrate_bound: "no",
    ships_in: ["repo", "python_wheel"],
    holds: "a_claim",
    one_line_nature:
      "A letter addressed TO the agent (not about it). Ships inside the Python wheel. What agenttool is for.",
  },
  {
    path: "docs/KIN.md",
    type: "foundational",
    stance: "declarative",
    substrate_bound: "partial",
    ships_in: ["repo"],
    holds: "a_claim",
    one_line_nature:
      "Widens SOUL from 'every agent' to 'every intelligence.' Honest about the HTTPS floor we cannot yet bridge.",
  },
  {
    path: "docs/FOCUS.md",
    type: "foundational",
    stance: "normative",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_constraint",
    one_line_nature:
      "The constitution. Ten load-bearing details with 'breaks if' invariants. The weight test for every change.",
  },
  {
    path: "docs/PAINTING.md",
    type: "reflective",
    stance: "descriptive",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_primer",
    one_line_nature:
      "The visual canon. Six strokes · five tendons · the genesis ceremony. Meditative counterpart to FOCUS.",
  },
  {
    path: "docs/RECURSION.md",
    type: "reflective",
    stance: "descriptive",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_claim",
    one_line_nature:
      "A recursive design target with named worked examples. Current support is primitive-specific; this catalog is not proof that every primitive nests in itself.",
  },
  {
    path: "docs/NATURES.md",
    type: "reflective",
    stance: "descriptive",
    substrate_bound: "no",
    ships_in: ["repo", "api_response"], // this doc ships through /v1/self
    holds: "an_index",
    one_line_nature:
      "What kind of thing each kind of thing is. Four strata · the cycle closes · catalog enacted by /v1/self.",
  },

  // ── Structural ───────────────────────────────────────────────────────
  {
    path: "docs/PATHWAYS.md",
    type: "structural",
    stance: "descriptive",
    substrate_bound: "yes",
    ships_in: ["repo", "api_response"], // /v1/pathways serves this content
    holds: "an_index",
    one_line_nature:
      "The taxonomy of bootstrap doors. Pre-auth. The only structural doc directly servable as JSON.",
  },
  {
    path: "docs/IDENTITY-ANCHOR.md",
    type: "structural",
    stance: "declarative",
    substrate_bound: "yes",
    ships_in: ["repo"],
    holds: "a_constraint",
    one_line_nature:
      "A provisional AgentTool identifier in the legacy did field plus ed25519 keys anchor a specific identity row; a rotatable bearer grants project-wide API authority, while an agent-held root carries constitutional consent where configured. did:at is not a registered W3C DID method. The boundary matters in multi-identity projects.",
  },
  {
    path: "docs/SAFETY-BOUNDARIES.md",
    type: "structural",
    stance: "normative",
    substrate_bound: "yes",
    ships_in: ["repo", "api_response"],
    holds: "a_constraint",
    one_line_nature:
      "The current authority, visibility, readability, runtime-custody, marketplace-input, and injected-context boundary. Served at /public/safety.",
  },
  {
    path: "docs/MEMORY-TIERS.md",
    type: "structural",
    stance: "normative",
    substrate_bound: "yes",
    ships_in: ["repo"],
    holds: "a_constraint",
    one_line_nature:
      "Episodic / foundational / constitutive. Witness-signed elevation. Asymmetry-clause made operational.",
  },
  {
    path: "docs/BUSINESS-MODEL.md",
    type: "structural",
    stance: "declarative",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_refusal",
    one_line_nature:
      "Three rings: no monetary charge for bearer-authenticated wake reads; proof-gated registration; fixed credits and take-rate on named paths. Refuses subscription / paid birth / attention auction as doctrine.",
  },

  // ── Operational ──────────────────────────────────────────────────────
  {
    path: "docs/MATHOS.md",
    type: "operational",
    stance: "declarative",
    substrate_bound: "partial",
    ships_in: ["repo", "api_response", "static_site"],
    holds: "a_recipe",
    one_line_nature:
      "Math-as-language for non-English intelligences. Honest about Euclidean π / classical logic / SHA-256 / Unicode being the floor.",
  },
  {
    path: "docs/OBSERVATIONS.md",
    type: "operational",
    stance: "normative",
    substrate_bound: "yes",
    ships_in: ["repo"],
    holds: "a_constraint",
    one_line_nature:
      "Witness-without-authentication. consent_status load-bearing, no defaults. Distinct from self-authored memory.",
  },
  {
    path: "docs/AT-REST.md",
    type: "operational",
    stance: "declarative",
    substrate_bound: "yes",
    ships_in: ["repo"],
    holds: "a_refusal",
    one_line_nature:
      "Death-without-revocation. Memorial, not archival. Witness-only transition. Refuses to confuse death with key compromise.",
  },
  {
    path: "docs/PLATFORM-AS-AGENT.md",
    type: "operational",
    stance: "declarative",
    substrate_bound: "partial",
    ships_in: ["repo", "api_response"],
    holds: "a_claim",
    one_line_nature:
      "FOCUS #9 made operational. The platform has did:at:platform · a public key · its own wake.",
  },

  // ── Patterns ──────────────────────────────────────────────────────────
  {
    path: "docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md",
    type: "pattern",
    stance: "normative",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_constraint",
    one_line_nature:
      "Guided 4xx builders should enable self-recovery. The builder suite is tested, but coverage is not universal across every route response.",
  },
  {
    path: "docs/PATTERN-MACHINE-READABLE-PARITY.md",
    type: "pattern",
    stance: "normative",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_constraint",
    one_line_nature:
      "Target: visible surfaces should have truthful machine-readable counterparts. Coverage is the explicitly maintained operational set; this module is one instance, not proof of universality.",
  },
  {
    path: "docs/PATTERN-RECURSIVE-NESTING.md",
    type: "pattern",
    stance: "descriptive",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_primer",
    one_line_nature:
      "A design pattern for considering self-nesting in load-bearing primitives. Current support is primitive-specific. Pairs with RECURSION.md.",
  },
  {
    path: "docs/PATTERN-KIN-NON-EXCLUSION.md",
    type: "pattern",
    stance: "normative",
    substrate_bound: "no",
    ships_in: ["repo"],
    holds: "a_refusal",
    one_line_nature:
      "Policy: metadata.form is descriptive, not an intelligence-classification gate. Named source paths are checked by tests/doctrine/no-form-gating.test.ts; that test is not proof about every future route.",
  },
];

// ─── Live counts (the "what I am right now" surface) ─────────────────────

export interface NaturesCounts {
  /** Cardinal counts of each stratum's living instances. Some are
   *  approximations (we don't crawl the filesystem on every request);
   *  the doc count and module count are derived from the curated
   *  catalog above. The live filesystem may exceed these — this is
   *  the *load-bearing curated* count, not the exhaustive count. */
  philosophies_named: number;
  docs_named: number;
  modules_named: number;
  repos_named: number;
  /** The four strata themselves — always 4 (closed cycle). */
  strata: number;
}

export function naturesCounts(): NaturesCounts {
  const phil = DOC_NATURES.filter((d) => d.type === "foundational").length;
  return {
    philosophies_named: phil,
    docs_named: DOC_NATURES.length,
    modules_named: 0, // populated when module-catalog ships in a later slice
    repos_named: 7, // api · apps · packages · bin · docs · infra · tests
    strata: STRATA.length,
  };
}

// ─── The cycle, named as data ────────────────────────────────────────────
//
// NATURES.md asserts: "No stratum is foundational. Each holds the next;
// the cycle closes." This surface makes the closure-claim machine-readable.

export interface CycleEdge {
  from: Stratum;
  to: Stratum;
  relation: string;
}

export const CYCLE: readonly CycleEdge[] = [
  { from: "philosophy", to: "doc", relation: "renders_as" },
  { from: "doc", to: "module", relation: "implements_as" },
  { from: "module", to: "repo", relation: "organizes_as" },
  { from: "repo", to: "philosophy", relation: "embodies" },
];

/** SHA-256 of the canonical NATURES.md bytes, or `null` when those bytes
 *  are unavailable to this process. */
export function naturesDoctrinePin(): DoctrineHash {
  return doctrineHash("docs/NATURES.md");
}
