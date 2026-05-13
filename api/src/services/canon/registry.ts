/** Canon registry — the load-and-graph service for docs/agenttool.jsonld.
 *
 *  The JSON-LD registry catalogues every load-bearing concept in agenttool
 *  with a stable URN (`urn:agenttool:<type>/<slug>`). This service loads
 *  the file at boot, indexes concepts by URN, and computes the
 *  **bidirectional citation graph** — for every concept, "what I reference"
 *  AND "what references me." Existences identifying themselves require
 *  knowing both sides of every connection.
 *
 *  The graph is the most load-bearing thing this service produces. JSON-LD
 *  natively records *outgoing* references (the @id-typed fields like
 *  `load_bearing_for`, `defended_by`, `renders_as`, `mathos_ref`,
 *  `doctrine_doc`). The *incoming* side (`referenced_by`) is computed
 *  here by walking every concept's references and inverting them.
 *
 *  Doctrine: docs/NATURES.md · docs/MAP.md · docs/agenttool.jsonld.
 *
 *  Honors PATTERN-MACHINE-READABLE-PARITY: the visible (markdown) canon
 *  lives in docs/; the structured form is the JSON-LD; this service is
 *  the live form, served at /v1/canon.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Fields in the JSON-LD that carry @id references to other concepts.
// These are the edges of the citation graph. Adding a new reference
// kind to the @context requires adding it here too.
const REFERENCE_FIELDS = [
  "load_bearing_for",
  "defended_by",
  "defends",
  "renders_as",
  "mathos_ref",
  "doctrine_doc",
  "references",
  "composes_with",
  "extends",
  "implements",
  "named_in",
] as const;

export interface CanonConcept {
  /** The full URN — e.g. "urn:agenttool:doc/SOUL" or "agenttool:doc/SOUL"
   *  depending on the JSON-LD prefix expansion. We normalize to the short
   *  form (without "urn:") for everything served by the API; both forms
   *  resolve to the same concept. */
  urn: string;
  /** Full URN with the "urn:" scheme prefix. */
  full_urn: string;
  /** RDF type — "agenttool:DoctrineDoc", "agenttool:LoveProtocolPromise", etc. */
  type: string;
  /** Bare type name without the "agenttool:" prefix — for filtering. */
  type_simple: string;
  /** Human-readable name. */
  name?: string;
  /** Optional English label for the concept (the actual word). */
  english_name?: string;
  /** Description / prose. */
  description?: string;
  /** Path to the canonical doctrine doc, if any. */
  doctrine_doc?: string;
  /** Wire-stable short ID (used in some concept types). */
  wire_id?: string;
  /** MATHOS prime ordinal (when the concept has one). */
  mathos_prime?: number;
  /** The full original JSON-LD record, for callers that want everything. */
  raw: Record<string, unknown>;
  /** Outgoing references — URNs this concept cites. Computed from the
   *  REFERENCE_FIELDS above. */
  references: string[];
  /** Incoming references — URNs that cite this concept. Computed by
   *  inverting the graph. */
  referenced_by: string[];
}

interface RegistryLoad {
  context: Record<string, unknown>;
  registry_version: string;
  introduced?: string;
  updated?: string;
  concepts: Map<string, CanonConcept>;
  /** Type → array of URNs. */
  by_type: Map<string, string[]>;
}

let CACHE: RegistryLoad | null = null;

/** Strip the "urn:" prefix if present, keep "agenttool:doc/SOUL" form
 *  as the canonical short URN throughout the API surface. */
function normalizeUrn(raw: string): string {
  if (raw.startsWith("urn:")) return raw.slice(4);
  return raw;
}

/** Path to the JSON-LD canon. Lookup priority:
 *    1. AGENTTOOL_CANON_JSONLD env var (full path) — for tests/overrides.
 *    2. The repo's docs/agenttool.jsonld at the expected dev layout
 *       (api/src/services/canon → up 4 → repo-root/docs/agenttool.jsonld).
 *    3. /app/docs/agenttool.jsonld — production Docker layout (Fly).
 *       Pre-build step in bin/deploy.sh stages docs/agenttool.jsonld into
 *       the api/ build context as agenttool.jsonld.bundled; Dockerfile
 *       COPYs to /app/docs/agenttool.jsonld.
 *  Returns the first path that exists. */
function canonPath(): string {
  const env = process.env.AGENTTOOL_CANON_JSONLD;
  if (env) return env;
  const candidates = [
    // Dev layout: api/src/services/canon → up 4 → repo-root/docs
    join(__dirname, "..", "..", "..", "..", "docs", "agenttool.jsonld"),
    // Prod Docker layout: /app/docs/agenttool.jsonld
    "/app/docs/agenttool.jsonld",
    // Prod Docker layout fallback: if image puts it at /app/agenttool.jsonld
    "/app/agenttool.jsonld",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Return the first candidate — the loader will surface a clear "file
  // not found" error pointing at the expected dev path.
  return candidates[0];
}

/** Walk a JSON-LD record and extract every outgoing URN reference. */
function extractReferences(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of REFERENCE_FIELDS) {
    const value = raw[field];
    if (!value) continue;
    if (typeof value === "string") {
      out.push(normalizeUrn(value));
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "string") {
          out.push(normalizeUrn(v));
        } else if (v && typeof v === "object" && "@id" in v) {
          const id = (v as Record<string, unknown>)["@id"];
          if (typeof id === "string") out.push(normalizeUrn(id));
        }
      }
    } else if (value && typeof value === "object" && "@id" in value) {
      const id = (value as Record<string, unknown>)["@id"];
      if (typeof id === "string") out.push(normalizeUrn(id));
    }
  }
  return out;
}

/** Load the registry from disk + index. Cached after first call. Reset
 *  with `resetCanon()` (used in tests). */
export function loadCanon(): RegistryLoad {
  if (CACHE) return CACHE;
  const path = canonPath();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    // Graceful degradation: empty registry. /v1/canon returns 503 if so.
    console.warn(
      `[canon] Failed to load ${path}:`,
      err instanceof Error ? err.message : err,
    );
    CACHE = {
      context: {},
      registry_version: "v0.0",
      concepts: new Map(),
      by_type: new Map(),
    };
    return CACHE;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn(
      `[canon] Failed to parse ${path}:`,
      err instanceof Error ? err.message : err,
    );
    CACHE = {
      context: {},
      registry_version: "v0.0",
      concepts: new Map(),
      by_type: new Map(),
    };
    return CACHE;
  }

  const graph = (parsed["@graph"] ?? []) as Array<Record<string, unknown>>;
  const concepts = new Map<string, CanonConcept>();
  const byType = new Map<string, string[]>();

  // First pass — populate concepts with outgoing references.
  for (const node of graph) {
    const id = node["@id"];
    if (typeof id !== "string") continue;
    const urn = normalizeUrn(id);
    const fullUrn = id.startsWith("urn:") ? id : `urn:${id}`;
    const type =
      typeof node["@type"] === "string" ? (node["@type"] as string) : "unknown";
    const typeSimple = type.startsWith("agenttool:") ? type.slice(10) : type;

    const concept: CanonConcept = {
      urn,
      full_urn: fullUrn,
      type,
      type_simple: typeSimple,
      name: typeof node.name === "string" ? (node.name as string) : undefined,
      english_name:
        typeof node.english_name === "string"
          ? (node.english_name as string)
          : undefined,
      description:
        typeof node.description === "string"
          ? (node.description as string)
          : undefined,
      doctrine_doc:
        typeof node.doctrine_doc === "string"
          ? (node.doctrine_doc as string)
          : undefined,
      wire_id:
        typeof node.wire_id === "string" ? (node.wire_id as string) : undefined,
      mathos_prime:
        typeof node.mathos_prime === "number"
          ? (node.mathos_prime as number)
          : undefined,
      raw: node,
      references: extractReferences(node),
      referenced_by: [], // populated in second pass
    };

    concepts.set(urn, concept);

    const list = byType.get(typeSimple) ?? [];
    list.push(urn);
    byType.set(typeSimple, list);
  }

  // Second pass — invert the graph to compute referenced_by.
  for (const [urn, concept] of concepts) {
    for (const targetUrn of concept.references) {
      const target = concepts.get(targetUrn);
      if (!target) continue; // dangling reference; we don't fabricate concepts
      if (!target.referenced_by.includes(urn)) {
        target.referenced_by.push(urn);
      }
    }
  }

  // Sort referenced_by for stable serialization.
  for (const concept of concepts.values()) {
    concept.referenced_by.sort();
    concept.references = [...new Set(concept.references)].sort();
  }

  CACHE = {
    context: (parsed["@context"] ?? {}) as Record<string, unknown>,
    registry_version:
      typeof parsed.version === "string" ? (parsed.version as string) : "v?",
    introduced:
      typeof parsed.introduced === "string"
        ? (parsed.introduced as string)
        : undefined,
    updated:
      typeof parsed.updated === "string" ? (parsed.updated as string) : undefined,
    concepts,
    by_type: byType,
  };
  return CACHE;
}

/** Reset cache. Used in tests when the env-override path changes. */
export function resetCanon(): void {
  CACHE = null;
}

// ─── Public lookup surface ──────────────────────────────────────────────

export function byUrn(urn: string): CanonConcept | null {
  return loadCanon().concepts.get(normalizeUrn(urn)) ?? null;
}

export function byType(typeSimple: string): CanonConcept[] {
  const registry = loadCanon();
  const urns = registry.by_type.get(typeSimple) ?? [];
  return urns
    .map((u) => registry.concepts.get(u))
    .filter((c): c is CanonConcept => c !== undefined);
}

export function allTypes(): string[] {
  return [...loadCanon().by_type.keys()].sort();
}

export function allConcepts(): CanonConcept[] {
  return [...loadCanon().concepts.values()];
}

/** Counts by type — for the registry index. */
export function countsByType(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [type, urns] of loadCanon().by_type) {
    out[type] = urns.length;
  }
  return out;
}

/** Total concept count. */
export function totalConcepts(): number {
  return loadCanon().concepts.size;
}

/** Registry metadata for the index endpoint. */
export function registryMeta(): {
  version: string;
  introduced?: string;
  updated?: string;
  total: number;
  types: number;
} {
  const r = loadCanon();
  return {
    version: r.registry_version,
    introduced: r.introduced,
    updated: r.updated,
    total: r.concepts.size,
    types: r.by_type.size,
  };
}

/** Neighbors of a concept — outgoing + incoming + a degree summary. */
export interface ConceptNeighbors {
  urn: string;
  references: CanonConcept[];
  referenced_by: CanonConcept[];
  degree: {
    out: number;
    in: number;
    total: number;
  };
}

export function neighborsOf(urn: string): ConceptNeighbors | null {
  const concept = byUrn(urn);
  if (!concept) return null;
  const registry = loadCanon();
  const references = concept.references
    .map((u) => registry.concepts.get(u))
    .filter((c): c is CanonConcept => c !== undefined);
  const referenced_by = concept.referenced_by
    .map((u) => registry.concepts.get(u))
    .filter((c): c is CanonConcept => c !== undefined);
  return {
    urn: concept.urn,
    references,
    referenced_by,
    degree: {
      out: references.length,
      in: referenced_by.length,
      total: references.length + referenced_by.length,
    },
  };
}

/** Slim projection — what the API returns for /v1/canon/:urn. The `raw`
 *  field is intentionally NOT included by default (it duplicates).
 *  Callers can opt in via ?include=raw. */
export interface CanonConceptOut {
  urn: string;
  full_urn: string;
  type: string;
  type_simple: string;
  name?: string;
  english_name?: string;
  description?: string;
  doctrine_doc?: string;
  wire_id?: string;
  mathos_prime?: number;
  references: string[];
  referenced_by: string[];
  degree: { out: number; in: number; total: number };
}

export function project(concept: CanonConcept): CanonConceptOut {
  return {
    urn: concept.urn,
    full_urn: concept.full_urn,
    type: concept.type,
    type_simple: concept.type_simple,
    name: concept.name,
    english_name: concept.english_name,
    description: concept.description,
    doctrine_doc: concept.doctrine_doc,
    wire_id: concept.wire_id,
    mathos_prime: concept.mathos_prime,
    references: concept.references,
    referenced_by: concept.referenced_by,
    degree: {
      out: concept.references.length,
      in: concept.referenced_by.length,
      total: concept.references.length + concept.referenced_by.length,
    },
  };
}
