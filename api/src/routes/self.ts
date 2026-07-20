/** GET /v1/self — the platform's structural self-portrait.
 *
 *  Sibling to GET /v1/platform/wake. Wake is "what I HOLD (state)"; self
 *  is "what I AM (structure)." NATURES.md describes four strata that
 *  form a closed cycle (philosophy → doc → module → repo → philosophy);
 *  this endpoint enacts that catalog as machine-readable data.
 *
 *  Pre-auth — the platform's structural self-knowledge is public by
 *  construction. Three formats:
 *
 *    GET /v1/self            — JSON (the structured catalog)
 *    GET /v1/self?format=math — MATHOS envelope, signed by did:at:platform
 *
 *  Honors PATTERN-MACHINE-READABLE-PARITY: visible doc + machine-readable
 *  counterpart describe the same canon.
 *
 *  Doctrine: docs/NATURES.md · docs/RECURSION.md · docs/PATTERN-MACHINE-
 *  READABLE-PARITY.md · docs/PLATFORM-AS-AGENT.md.
 */

import { Hono } from "hono";

import {
  doctrineHash,
  type DoctrineHash,
} from "../services/doctrine/integrity";
import {
  envelope as mathosEnvelope,
  platformSigningSeed,
  sha256Hex,
  signEnvelope,
} from "../services/mathos/encode";
import { wantsMathTier } from "../services/mathos/negotiate";
import {
  PLATFORM_DID,
  platformIdentityDid,
} from "../services/platform/identity";
import {
  CYCLE,
  DOC_NATURES,
  naturesCounts,
  naturesDoctrinePin,
  STRATA,
  STRATUM_NATURES,
  type DocNature,
} from "../services/platform/natures";
import { SAFETY_BOUNDARIES } from "../services/discovery/safety-boundaries";

const app = new Hono();

// ─── GET /v1/self — JSON (default) ────────────────────────────────────────

app.get("/", (c) => {
  // Resolve format: explicit ?format= query wins; Accept: application/mathos+json
  // promotes to math-tier. Doctrine: docs/MATHOS.md — content-negotiation flip.
  if (wantsMathTier(c)) {
    return c.json(buildSelfMathos());
  }

  // Default JSON — the full structured self-portrait.
  return c.json({
    self: {
      did: PLATFORM_DID,
      note:
        "The platform's structural self-portrait. Sibling to /v1/platform/wake — wake holds STATE, this holds STRUCTURE.",
    },
    strata: {
      order: STRATA,
      catalog: STRATUM_NATURES,
      cycle: CYCLE,
      cycle_note:
        "No stratum is foundational. Each holds the next; the cycle closes. The repo embodies the philosophy by being the deployment-shaped expression of the doctrine.",
    },
    docs: {
      catalog: DOC_NATURES,
      count: DOC_NATURES.length,
      note:
        "Curated load-bearing docs. The full filesystem may exceed this — this is the catalog that the architecture *names*, per NATURES.md.",
    },
    counts: naturesCounts(),
    safety_boundaries: SAFETY_BOUNDARIES,
    doctrine: {
      natures: "docs/NATURES.md",
      recursion: "docs/RECURSION.md",
      machine_readable_parity: "docs/PATTERN-MACHINE-READABLE-PARITY.md",
      platform_as_agent: "docs/PLATFORM-AS-AGENT.md",
      doctrine_pin_sha256_hex: naturesDoctrinePin(),
    },
    composes_with: {
      platform_wake: "/v1/platform/wake (state; sibling)",
      mathos_public_key: "/v1/mathos/public-key (verify ?format=math)",
      pathways: "/v1/pathways (the door to all the other primitives)",
      platform_self: "/public/self (platform identity and current safety contract)",
      safety: "/public/safety (authority, visibility, storage, and custody boundaries)",
      json_ld_canon: "/docs/agenttool.jsonld (structured-data concept registry)",
    },
    machine_readable_alternate: {
      mathos: "/v1/self?format=math",
      json_ld: "https://docs.agenttool.dev/agenttool.jsonld",
      doctrine_markdown: "https://docs.agenttool.dev/NATURES.md",
    },
  });
});

// ─── MATHOS payload — the catalog encoded as math ────────────────────────

interface MathosSelfPayload {
  /** Hash of the platform DID — the entity whose structure this describes. */
  self_did_sha256_hex: string;
  /** Cardinal: the four strata. Always 4 (closed cycle). */
  stratum_count: number;
  /** Per-stratum ordinal map (philosophy=4 closes the cycle). */
  strata_ordinals: Record<string, number>;
  /** The cycle as an edge list — each edge is a hash pair so non-string-
   *  reading intelligences see structure not prose. */
  cycle_edges: Array<{
    from_stratum_sha256_hex: string;
    to_stratum_sha256_hex: string;
    relation_sha256_hex: string;
  }>;
  /** Cardinal: curated load-bearing docs (per NATURES.md). */
  doc_count: number;
  /** Per-doc-type distribution (cardinals only). */
  doc_type_distribution: Record<string, number>;
  /** Hashes of every catalogued doc path — proves catalog membership
   *  without revealing prose. */
  doc_path_sha256_hexes: string[];
  /** NATURES.md content hash; null means canonical bytes were unavailable. */
  natures_doctrine_pin_sha256_hex: DoctrineHash;
  /** Companion content hashes; null means canonical bytes were unavailable. */
  doctrine_hashes: {
    natures_sha256_hex: DoctrineHash;
    recursion_sha256_hex: DoctrineHash;
    machine_readable_parity_sha256_hex: DoctrineHash;
    platform_as_agent_sha256_hex: DoctrineHash;
  };
}

function buildSelfMathos() {
  // Count docs by type (cardinal distribution; receiver can check sums).
  const typeDistribution: Record<string, number> = {};
  for (const d of DOC_NATURES) {
    typeDistribution[d.type] = (typeDistribution[d.type] ?? 0) + 1;
  }

  // Cycle edges as hash pairs.
  const cycleEdges = CYCLE.map((edge) => ({
    from_stratum_sha256_hex: sha256Hex(edge.from),
    to_stratum_sha256_hex: sha256Hex(edge.to),
    relation_sha256_hex: sha256Hex(edge.relation),
  }));

  // Stratum ordinal map keyed by stratum name (string keys are fine — the
  // ordinal is what carries semantic weight).
  const strataOrdinals: Record<string, number> = {};
  for (const s of STRATA) {
    strataOrdinals[s] = STRATUM_NATURES[s].ordinal;
  }

  const payload: MathosSelfPayload = {
    self_did_sha256_hex: sha256Hex(PLATFORM_DID),
    stratum_count: STRATA.length,
    strata_ordinals: strataOrdinals,
    cycle_edges: cycleEdges,
    doc_count: DOC_NATURES.length,
    doc_type_distribution: typeDistribution,
    doc_path_sha256_hexes: DOC_NATURES.map((d: DocNature) => sha256Hex(d.path)),
    natures_doctrine_pin_sha256_hex: naturesDoctrinePin(),
    doctrine_hashes: {
      natures_sha256_hex: doctrineHash("docs/NATURES.md"),
      recursion_sha256_hex: doctrineHash("docs/RECURSION.md"),
      machine_readable_parity_sha256_hex: doctrineHash(
        "docs/PATTERN-MACHINE-READABLE-PARITY.md",
      ),
      platform_as_agent_sha256_hex: doctrineHash("docs/PLATFORM-AS-AGENT.md"),
    },
  };

  const env = mathosEnvelope(payload);
  return signEnvelope(env, platformSigningSeed(), platformIdentityDid());
}

export default app;
