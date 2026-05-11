/** /v1/canon — every concept identifies itself + names its neighbors.
 *
 *  The live API surface over docs/agenttool.jsonld. Pre-auth (the canon
 *  is public by construction). Every concept is reachable by stable URN;
 *  every concept's record names both what it cites AND what cites it —
 *  the BIDIRECTIONAL graph the JSON-LD doesn't carry natively.
 *
 *  Endpoints (all pre-auth):
 *
 *    GET /v1/canon                       — index: counts by type, registry meta
 *    GET /v1/canon/types                 — the type vocabulary
 *    GET /v1/canon/by-type/:type         — all concepts of a given type
 *    GET /v1/canon/:urn                  — one concept identifies itself
 *    GET /v1/canon/:urn/neighbors        — graph traversal (1-hop)
 *    GET /v1/canon?format=math           — MATHOS envelope (index only)
 *
 *  URN format: callers may use either the short form ("agenttool:doc/SOUL")
 *  or the full URN ("urn:agenttool:doc/SOUL"). The route normalizes.
 *
 *  Doctrine: docs/agenttool.jsonld · docs/MAP.md · docs/NATURES.md ·
 *  docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { Hono } from "hono";

import {
  envelope as mathosEnvelope,
  platformSigningSeed,
  sha256Hex,
  signEnvelope,
} from "../services/mathos/encode";
import { platformIdentityDid } from "../services/platform/identity";
import {
  allTypes,
  byType,
  byUrn,
  countsByType,
  neighborsOf,
  project,
  registryMeta,
  totalConcepts,
} from "../services/canon/registry";

const app = new Hono();

// ─── GET /v1/canon — registry index ──────────────────────────────────────

app.get("/", (c) => {
  const format = c.req.query("format") ?? "json";

  if (format === "math" || format === "mathos") {
    return c.json(buildCanonMathos());
  }

  const meta = registryMeta();
  if (meta.total === 0) {
    return c.json(
      {
        error: "canon_unavailable",
        message:
          "The canon registry (docs/agenttool.jsonld) is not loadable on " +
          "this deployment. Verify the file exists and is valid JSON-LD.",
        hint:
          "Set AGENTTOOL_CANON_JSONLD to a full path to override the default lookup.",
        docs: "https://docs.agenttool.dev/agenttool.jsonld",
      },
      503,
    );
  }

  return c.json({
    registry: meta,
    types: allTypes(),
    counts_by_type: countsByType(),
    routes: {
      types: "/v1/canon/types",
      by_type: "/v1/canon/by-type/{type}",
      by_urn: "/v1/canon/{urn}",
      neighbors: "/v1/canon/{urn}/neighbors",
      math: "/v1/canon?format=math",
    },
    machine_readable_alternate: {
      json_ld: "https://docs.agenttool.dev/agenttool.jsonld",
      mathos: "/v1/canon?format=math",
    },
    note:
      "Every concept in this registry identifies itself by URN and names " +
      "BOTH what it references and what references it. The bidirectional " +
      "graph is the load-bearing thing this surface adds on top of the " +
      "raw JSON-LD. Doctrine: docs/NATURES.md · docs/MAP.md.",
  });
});

// ─── GET /v1/canon/types ─────────────────────────────────────────────────

app.get("/types", (c) => {
  return c.json({
    types: allTypes(),
    counts: countsByType(),
    total_concepts: totalConcepts(),
  });
});

// ─── GET /v1/canon/by-type/:type — all concepts of a type ────────────────

app.get("/by-type/:type", (c) => {
  const type = c.req.param("type");
  const concepts = byType(type);
  if (concepts.length === 0) {
    return c.json(
      {
        error: "type_not_found",
        message: `No concepts of type "${type}" in the registry.`,
        hint: "GET /v1/canon/types to list available types.",
        details: { requested_type: type, available_types: allTypes() },
      },
      404,
    );
  }
  return c.json({
    type,
    count: concepts.length,
    concepts: concepts.map(project),
  });
});

// ─── GET /v1/canon/:urn/neighbors — graph traversal ──────────────────────

app.get("/:urn/neighbors", (c) => {
  // Hono path params are URL-decoded but we want to support both "agenttool:doc/SOUL"
  // and "urn:agenttool:doc/SOUL" — clients may send either.
  const urn = decodeURIComponent(c.req.param("urn") ?? "");
  const neighbors = neighborsOf(urn);
  if (!neighbors) {
    return c.json(
      {
        error: "concept_not_found",
        message: `No concept with URN "${urn}" in the registry.`,
        hint: "GET /v1/canon for the registry index, or /v1/canon/types.",
        details: { requested_urn: urn },
      },
      404,
    );
  }
  return c.json({
    urn: neighbors.urn,
    references: neighbors.references.map(project),
    referenced_by: neighbors.referenced_by.map(project),
    degree: neighbors.degree,
    note:
      "Outgoing references = concepts this one cites. Incoming = concepts " +
      "that cite this one. The bidirectional graph is computed by inverting " +
      "every concept's reference fields — JSON-LD natively records only outgoing.",
  });
});

// ─── GET /v1/canon/:urn — one concept identifies itself ──────────────────

app.get("/:urn", (c) => {
  const urn = decodeURIComponent(c.req.param("urn") ?? "");
  const concept = byUrn(urn);
  if (!concept) {
    return c.json(
      {
        error: "concept_not_found",
        message: `No concept with URN "${urn}" in the registry.`,
        hint: "GET /v1/canon for the registry index.",
        details: { requested_urn: urn },
      },
      404,
    );
  }
  const includeRaw = c.req.query("include") === "raw";
  return c.json({
    ...project(concept),
    ...(includeRaw ? { raw_json_ld: concept.raw } : {}),
    neighbors_url: `/v1/canon/${encodeURIComponent(concept.urn)}/neighbors`,
  });
});

// ─── MATHOS form of the canon index ──────────────────────────────────────
//
// Cardinal counts + hashes of every URN. A math-substrate intelligence sees
// the graph's *shape* (concept count, type distribution, average degree)
// without parsing English, and can verify membership by hashing any URN
// they hold and checking it appears in the urn_sha256_hexes set.

function buildCanonMathos() {
  const meta = registryMeta();
  const types = allTypes();
  const counts = countsByType();
  const typesHashed: Record<string, number> = {};
  for (const [t, n] of Object.entries(counts)) {
    typesHashed[sha256Hex(t)] = n;
  }
  // All URN hashes — proves membership without revealing the strings.
  const allUrns = [...types.flatMap((t) => byType(t))].map((c) => c.urn);
  const urnHashes = allUrns.map((u) => sha256Hex(u));

  // Compute average degree (in + out) for the graph.
  let degreeSum = 0;
  for (const t of types) {
    for (const c of byType(t)) {
      degreeSum += c.references.length + c.referenced_by.length;
    }
  }
  const avgDegree = meta.total > 0 ? degreeSum / meta.total : 0;

  const payload = {
    concept_count: meta.total,
    type_count: meta.types,
    average_degree: avgDegree,
    total_edges: degreeSum / 2, // each edge counted twice (in + out)
    type_counts_by_hash: typesHashed,
    urn_sha256_hexes: urnHashes,
    registry_version_sha256_hex: sha256Hex(meta.version),
    doctrine_hashes: {
      jsonld_path_sha256_hex: sha256Hex("docs/agenttool.jsonld"),
      natures_sha256_hex: sha256Hex("docs/NATURES.md"),
      map_sha256_hex: sha256Hex("docs/MAP.md"),
      machine_readable_parity_sha256_hex: sha256Hex(
        "docs/PATTERN-MACHINE-READABLE-PARITY.md",
      ),
    },
  };

  const env = mathosEnvelope(payload);
  return signEnvelope(env, platformSigningSeed(), platformIdentityDid());
}

export default app;
