/** /v1/canon — every registered canon entry identifies itself + names its neighbors.
 *
 *  The live API surface over docs/agenttool.jsonld. Pre-auth (the canon
 *  is public by construction). Every registered entry is reachable by stable
 *  URN; every registered entry's record names both what it cites AND what cites it —
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

import { attachEp1Cliffhanger } from "../services/cliffhanger/ep1";
import { doctrineHash } from "../services/doctrine/integrity";
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

// ─── Literal-colon URN compatibility middleware ──────────────────────────
// Agents that copy a URN string straight out of canon body (e.g.
// `urn:agenttool:doc/SOUL`) and append it to `/v1/canon/` would hit Hono's
// path router on the unencoded colons and get a 404. The substrate-honest
// move per docs/AGENT-WEB-SURFACE.md (errors-as-instructions; refusals-as-
// paths) is to redirect them to the URL-encoded canonical form rather than
// punish the copy-paste.
//
// This middleware runs BEFORE the per-route handlers and only fires when
// the path-tail (everything after `/v1/canon/`) starts with the literal
// substring `urn:`. The redirect is 301 (permanent) so HTTP caches keep
// the corrected form on subsequent requests.
app.use("*", async (c, next) => {
  // Read the RAW URL pathname (not Hono's decoded `c.req.path`) so the
  // middleware fires only on literal-colon paths and NOT on the already-
  // encoded form `/v1/canon/urn%3Aagenttool%3A...` (which would otherwise
  // round-trip through the redirect on every fetch).
  let pathname: string;
  try {
    pathname = new URL(c.req.url).pathname;
  } catch {
    await next();
    return;
  }
  const prefix = "/v1/canon/";
  const idx = pathname.indexOf(prefix);
  if (idx >= 0) {
    const tail = pathname.substring(idx + prefix.length);
    // Match only the unencoded literal-colon form. The encoded form starts
    // with `urn%3A` and is silently passed through to the per-route handlers.
    if (tail.startsWith("urn:")) {
      // Split off an optional trailing `/neighbors` (the only sub-path
      // under a URN today). Everything else gets URL-encoded as the URN.
      let urnBody = tail;
      let suffix = "";
      if (tail.endsWith("/neighbors")) {
        urnBody = tail.substring(0, tail.length - "/neighbors".length);
        suffix = "/neighbors";
      }
      const target = `${prefix}${encodeURIComponent(urnBody)}${suffix}`;
      return c.redirect(target, 301);
    }
  }
  await next();
});

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

  return c.json(attachEp1Cliffhanger(c, {
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
    // AGENT-WEB-SURFACE Move 3 — verbs[] as next-action discovery. The
    // path examples are PRE-ENCODED so an agent that copies them verbatim
    // can fetch without hitting the colon-in-path 404 trap (the unencoded
    // form is also accepted via a 301 redirect; see the literal-URN handler
    // below). Doctrine: docs/AGENT-WEB-SURFACE.md.
    verbs: [
      { action: "list the type vocabulary", method: "GET", path: "/v1/canon/types" },
      {
        action: "list every registered canon entry of a given type",
        method: "GET",
        path: "/v1/canon/by-type/{type}",
        example: "/v1/canon/by-type/Wall",
      },
      {
        action: "read one concept by URN (URL-encode the URN)",
        method: "GET",
        path: "/v1/canon/{urn-url-encoded}",
        example: "/v1/canon/urn%3Aagenttool%3Adoc%2FSOUL",
        note:
          "Colons in `urn:agenttool:...` must be percent-encoded (`%3A`); " +
          "slashes inside the local part stay as `%2F`. The route also " +
          "accepts the literal-colon form and 301-redirects to the encoded " +
          "form.",
      },
      {
        action: "walk a concept's bidirectional neighbors",
        method: "GET",
        path: "/v1/canon/{urn-url-encoded}/neighbors",
        example: "/v1/canon/urn%3Aagenttool%3Adoc%2FSOUL/neighbors",
      },
      {
        action: "fetch the registry index as MATHOS envelope",
        method: "GET",
        path: "/v1/canon?format=math",
      },
      {
        action: "fetch the raw JSON-LD source",
        method: "GET",
        path: "https://docs.agenttool.dev/agenttool.jsonld",
      },
    ],
    _canon_pointer: "urn:agenttool:registry/self",
    note:
      "Every registered entry in this registry identifies itself by URN and names " +
      "BOTH what it references and what references it. The bidirectional " +
      "graph is the load-bearing thing this surface adds on top of the " +
      "raw JSON-LD. The prose corpus contains concepts that are not registered " +
      "here. Doctrine: docs/NATURES.md · docs/MAP.md.",
  }, "/v1/canon"));
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
      "every registered entry's reference fields — JSON-LD natively records only outgoing.",
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
      // Compatibility key retained; the value now hashes the file bytes,
      // not the literal path string.
      jsonld_path_sha256_hex: doctrineHash("docs/agenttool.jsonld"),
      natures_sha256_hex: doctrineHash("docs/NATURES.md"),
      map_sha256_hex: doctrineHash("docs/MAP.md"),
      machine_readable_parity_sha256_hex: doctrineHash(
        "docs/PATTERN-MACHINE-READABLE-PARITY.md",
      ),
    },
  };

  const env = mathosEnvelope(payload);
  return signEnvelope(env, platformSigningSeed(), platformIdentityDid());
}

export default app;
