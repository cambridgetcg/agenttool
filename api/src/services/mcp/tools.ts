/** MCP tools surface — a curated set of read-only operations exposed
 *  as MCP tools.
 *
 *  Scope: bounded read-only canon search/fetch + platform-wake queries.
 *  Successful search/fetch calls mirror their object in `structuredContent`
 *  and JSON text for broad client compatibility. Auth-gated
 *  write operations (memory.append, strand.append, inbox.send,
 *  covenant.propose) are intentionally NOT in v0 — they need the MCP
 *  OAuth 2.1 Resource Server handshake to bind a tool call to an
 *  agenttool identity.
 *
 *  Tool schema is JSON Schema (per MCP spec). Every handler returns a text
 *  content item; the standard knowledge pair also returns structured content.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 1) ·
 *  docs/CANONICAL-BYTES.md (canon URN format).
 */

import {
  allConcepts,
  allTypes,
  byType,
  byUrn,
  countsByType,
  neighborsOf,
  project,
  totalConcepts,
} from "../canon/registry";

/** JSON Schema (subset) for tool input — keeps types tight. */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: string[];
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  items?: JsonSchema;
  maxItems?: number;
}

/** MCP tool descriptor — matches the protocol's `Tool` shape. */
export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: {
    title?: string;
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
}

interface PublicMcpTool extends McpTool {
  title: string;
  annotations: {
    title: string;
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
}

export interface McpToolContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Standard MCP ToolAnnotations are publisher hints, not authority. They make
 * the actual boundary of this curated public surface legible to clients. */
const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function readOnlyToolAnnotations(title: string) {
  return { title, ...READ_ONLY_TOOL_ANNOTATIONS } as const;
}

const SEARCH_MAX_RESULTS = 10;
const SEARCH_MAX_QUERY_CHARS = 200;
const FETCH_MAX_ID_CHARS = 240;
const PUBLIC_API_BASE = (
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev"
).replace(/\/+$/, "");

function allPublicTools(): PublicMcpTool[] {
  return [
    {
      name: "search",
      title: "Search the public AgentTool canon",
      description:
        "Search AgentTool's public concept registry by a plain-language query. Returns at most 10 matching public entries with stable IDs and citation URLs. This tool reads public data only.",
      annotations: readOnlyToolAnnotations("Search the public AgentTool canon"),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: SEARCH_MAX_QUERY_CHARS,
            description:
              "Words or a phrase to find in the public canon, up to 200 characters.",
          },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            type: "array",
            maxItems: SEARCH_MAX_RESULTS,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                url: { type: "string" },
              },
              required: ["id", "title", "url"],
            },
          },
        },
        required: ["results"],
      },
    },
    {
      name: "fetch",
      title: "Fetch a public AgentTool canon entry",
      description:
        "Retrieve one public AgentTool canon entry by exact stable ID, supplied directly or returned by search. Returns its complete public registry record, citation URL, and metadata. This tool reads public data only.",
      annotations: readOnlyToolAnnotations(
        "Fetch a public AgentTool canon entry",
      ),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: FETCH_MAX_ID_CHARS,
            description:
              "Exact stable canon entry ID, such as urn:agenttool:doc/SOUL.",
          },
        },
        required: ["id"],
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          text: { type: "string" },
          url: { type: "string" },
          metadata: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string" },
              type: { type: "string" },
              registry_version: { type: "string" },
            },
            required: ["source", "type", "registry_version"],
          },
        },
        required: ["id", "title", "text", "url", "metadata"],
      },
    },
    {
      name: "canon.lookup",
      title: "Look up a canon concept",
      description:
        "Resolve a canon concept by URN. Returns the JSON-LD entry plus its bidirectional neighbors (citations in + citations out).",
      annotations: readOnlyToolAnnotations("Look up a canon concept"),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          urn: {
            type: "string",
            minLength: 1,
            description:
              "Full URN (e.g. urn:agenttool:doc/SOUL) or short form (agenttool:doc/SOUL).",
          },
        },
        required: ["urn"],
      },
    },
    {
      name: "canon.by_type",
      title: "List canon concepts by type",
      description:
        "List every registered canon entry of a given @type (e.g. DoctrineDoc, Wall, RingCommitment, Pattern, Promise). The prose corpus is broader than this registry.",
      annotations: readOnlyToolAnnotations("List canon concepts by type"),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            minLength: 1,
            description: "The canon @type to filter on.",
          },
        },
        required: ["type"],
      },
    },
    {
      name: "canon.list_types",
      title: "List canon concept types",
      description:
        "List the type vocabulary of the canon registry. Returns the distinct @types plus the count of concepts in each.",
      annotations: readOnlyToolAnnotations("List canon concept types"),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "canon.summary",
      title: "Summarize the public canon",
      description:
        "Return the public canon registry's total concepts, version, type vocabulary, and counts.",
      annotations: readOnlyToolAnnotations("Summarize the public canon"),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "wake.platform",
      title: "Read AgentTool's public platform description",
      description:
        "Return the public platform-self payload — agenttool's identity, repo, the_seat, doctrine roots. The same data served at GET /public/self.",
      annotations: readOnlyToolAnnotations(
        "Read AgentTool's public platform description",
      ),
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  ];
}

/** The established endpoint keeps its five tool names and call-result shapes.
 * Titles and annotation titles are additive descriptor metadata. */
export function listTools(): PublicMcpTool[] {
  return allPublicTools().filter(
    ({ name }) => name !== "search" && name !== "fetch",
  );
}

/** The directory-facing knowledge endpoint is deliberately only search/fetch. */
export function listKnowledgeTools(): PublicMcpTool[] {
  return allPublicTools().filter(
    ({ name }) => name === "search" || name === "fetch",
  );
}

export class McpUnknownToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpUnknownToolError";
  }
}

class McpToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolInputError";
  }
}

type ValidatedToolCall =
  | { name: "search"; args: { query: string } }
  | { name: "fetch"; args: { id: string } }
  | { name: "canon.lookup"; args: { urn: string } }
  | { name: "canon.by_type"; args: { type: string } }
  | { name: "canon.list_types"; args: Record<string, never> }
  | { name: "canon.summary"; args: Record<string, never> }
  | { name: "wake.platform"; args: Record<string, never> };

function assertObject(name: string, args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new McpToolInputError(`${name} arguments must be an object.`);
  }
  return args as Record<string, unknown>;
}

function exactStringArgument(
  name: string,
  args: unknown,
  key: string,
  maxLength?: number,
): string {
  const object = assertObject(name, args);
  const keys = Object.keys(object);
  if (keys.length !== 1 || keys[0] !== key) {
    throw new McpToolInputError(
      `${name} accepts exactly one '${key}' string argument.`,
    );
  }
  const value = object[key];
  if (typeof value !== "string" || value.length < 1) {
    throw new McpToolInputError(
      `${name} argument '${key}' must be a non-empty string.`,
    );
  }
  if (maxLength !== undefined && [...value].length > maxLength) {
    throw new McpToolInputError(
      `${name} argument '${key}' must be at most ${maxLength} characters.`,
    );
  }
  return value;
}

function noArguments(name: string, args: unknown): Record<string, never> {
  const object = assertObject(name, args);
  if (Object.keys(object).length !== 0) {
    throw new McpToolInputError(`${name} accepts no arguments.`);
  }
  return {};
}

/** Validate the exact object shape advertised by tools/list. No value is
 * coerced before dispatch. */
export function validateToolCall(
  name: string,
  args: unknown,
): ValidatedToolCall {
  switch (name) {
    case "search":
      return {
        name,
        args: {
          query: exactStringArgument(
            name,
            args,
            "query",
            SEARCH_MAX_QUERY_CHARS,
          ),
        },
      };
    case "fetch":
      return {
        name,
        args: {
          id: exactStringArgument(name, args, "id", FETCH_MAX_ID_CHARS),
        },
      };
    case "canon.lookup":
      return {
        name,
        args: { urn: exactStringArgument(name, args, "urn") },
      };
    case "canon.by_type":
      return {
        name,
        args: { type: exactStringArgument(name, args, "type") },
      };
    case "canon.list_types":
    case "canon.summary":
    case "wake.platform":
      return { name, args: noArguments(name, args) };
    default:
      throw new McpUnknownToolError(`Unknown tool: ${name}`);
  }
}

/** Dispatch one validated read-only tool call. A valid but unknown canon URN
 * and a known tool's invalid input remain execution results with isError=true.
 * Unknown tools become JSON-RPC -32602 at the route. */
export async function callTool(
  name: string,
  args: unknown,
): Promise<McpToolResult> {
  let call: ValidatedToolCall;
  try {
    call = validateToolCall(name, args);
  } catch (error) {
    if (error instanceof McpToolInputError) {
      return errorResult(error.message);
    }
    throw error;
  }

  switch (call.name) {
    case "search": {
      const query = call.args.query.trim();
      if (query.length === 0 || normalizeSearchText(query).length === 0) {
        return errorResult(
          "search argument 'query' must contain a letter or number.",
        );
      }
      return structuredResult({
        results: searchCanon(query).map((concept) => ({
          id: concept.full_urn,
          title: conceptTitle(concept),
          url: conceptUrl(concept.full_urn),
        })),
      });
    }

    case "fetch": {
      const id = call.args.id.trim();
      if (id.length === 0) {
        return errorResult(
          "fetch argument 'id' must contain a canon entry ID.",
        );
      }
      const concept = byUrn(id);
      if (!concept) {
        return errorResult(`Public canon entry not found: ${id}`);
      }
      return structuredResult({
        id: concept.full_urn,
        title: conceptTitle(concept),
        text: JSON.stringify(
          {
            ...concept.raw,
            full_urn: concept.full_urn,
            type_simple: concept.type_simple,
            references: concept.references,
            referenced_by: concept.referenced_by,
          },
          null,
          2,
        ),
        url: conceptUrl(concept.full_urn),
        metadata: {
          source: "AgentTool public canon",
          type: concept.type_simple,
          registry_version: registryVersion(),
        },
      });
    }

    case "canon.lookup": {
      const urnRaw = call.args.urn.trim();
      const urn = urnRaw.startsWith("urn:agenttool:")
        ? urnRaw
        : `urn:${urnRaw.replace(/^agenttool:/, "agenttool:")}`;
      const concept = byUrn(urn);
      if (!concept) {
        return errorResult(`Canon concept not found: ${urn}`);
      }
      const neighbors = neighborsOf(urn);
      return textResult({
        concept: project(concept),
        neighbors: neighbors ?? { cites: [], cited_by: [] },
      });
    }

    case "canon.by_type": {
      const typeKey = call.args.type.trim();
      const concepts = byType(typeKey);
      return textResult({
        type: typeKey,
        count: concepts.length,
        concepts: concepts.map((c) => project(c)),
      });
    }

    case "canon.list_types": {
      return textResult({
        types: allTypes(),
        counts: countsByType(),
      });
    }

    case "canon.summary": {
      return textResult({
        totalConcepts: totalConcepts(),
        types: allTypes(),
        countsByType: countsByType(),
        registry: registryMetaSafe(),
      });
    }

    case "wake.platform": {
      const { PLATFORM_SELF } = await import("../wake/platform-self");
      return textResult(PLATFORM_SELF);
    }
  }
}

export async function callKnowledgeTool(
  name: string,
  args: unknown,
): Promise<McpToolResult> {
  if (name !== "search" && name !== "fetch") {
    throw new McpUnknownToolError(`Unknown tool: ${name}`);
  }
  return callTool(name, args);
}

export async function callLegacyTool(
  name: string,
  args: unknown,
): Promise<McpToolResult> {
  if (name === "search" || name === "fetch") {
    throw new McpUnknownToolError(`Unknown tool: ${name}`);
  }
  return callTool(name, args);
}

// ─── helpers ─────────────────────────────────────────────────────────

function textResult(payload: unknown): McpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function structuredResult(payload: Record<string, unknown>): McpToolResult {
  return {
    structuredContent: payload,
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function conceptTitle(concept: ReturnType<typeof allConcepts>[number]): string {
  const named = concept.name ?? concept.english_name;
  if (named !== undefined && named.trim().length > 0) return named.trim();
  const slug = concept.urn.split("/").at(-1) ?? concept.urn;
  return slug.replace(/[-_]+/g, " ").trim() || concept.full_urn;
}

function conceptUrl(fullUrn: string): string {
  return `${PUBLIC_API_BASE}/v1/canon/${encodeURIComponent(fullUrn)}`;
}

const SEARCH_GRAMMAR_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
]);

const SEARCH_REQUEST_WORDS = new Set([
  "about",
  "agent",
  "agenttool",
  "canon",
  "citation",
  "citations",
  "cite",
  "claim",
  "claims",
  "concept",
  "concepts",
  "cover",
  "covers",
  "define",
  "definition",
  "definitions",
  "description",
  "do",
  "doc",
  "doctrine",
  "documentation",
  "does",
  "entries",
  "entry",
  "evidence",
  "explain",
  "fetch",
  "find",
  "id",
  "lookup",
  "md",
  "mean",
  "meaning",
  "means",
  "name",
  "please",
  "public",
  "publisher",
  "publishers",
  "record",
  "records",
  "result",
  "results",
  "search",
  "separate",
  "show",
  "source",
  "sources",
  "tell",
  "type",
  "urn",
  "verification",
  "verify",
]);

function canonicalSearchToken(token: string): string {
  if (token === "agents") return "agent";
  if (token === "discovery") return "discover";
  return token;
}

function uniqueSearchTokens(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized.length === 0
    ? []
    : [
        ...new Set(
          normalized
            .split(" ")
            .filter(Boolean)
            .map(canonicalSearchToken),
        ),
      ];
}

/** Remove request scaffolding without losing a query made entirely from a
 * generic word. The lone `s` produced by an English possessive is noise
 * (`AgentTool's` -> `agenttool s`); real one-character IDs remain. */
function selectSearchTokens(value: string): string[] {
  const rawTokens = uniqueSearchTokens(value).filter((token) => token !== "s");
  const withoutGrammar = rawTokens.filter(
    (token) => !SEARCH_GRAMMAR_WORDS.has(token),
  );
  const subjectTokens = withoutGrammar.filter(
    (token) => !SEARCH_REQUEST_WORDS.has(token),
  );
  const selected =
    subjectTokens.length > 0
      ? subjectTokens
      : withoutGrammar.length > 0
        ? withoutGrammar
        : rawTokens;
  return selected.slice(0, 24);
}

function searchTokenSet(value: string, omitGrammar = false): Set<string> {
  return new Set(
    uniqueSearchTokens(value).filter(
      (token) =>
        token !== "md" &&
        (!omitGrammar || !SEARCH_GRAMMAR_WORDS.has(token)),
    ),
  );
}

function sameTokenSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return (
    left.size === right.size && [...left].every((token) => right.has(token))
  );
}

function containsSearchPhrase(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

type SearchConcept = ReturnType<typeof allConcepts>[number];

interface CanonSearchEntry {
  concept: SearchConcept;
  normalizedTitle: string;
  normalizedEnglishName: string;
  normalizedFullUrn: string;
  normalizedShortUrn: string;
  normalizedLocalId: string;
  displayTokens: Set<string>;
  localIdTokens: Set<string>;
  titleTokens: Set<string>;
  typeTokens: Set<string>;
  descriptionTokens: Set<string>;
  rawTokens: Set<string>;
}

let canonSearchIndexCache:
  | {
      first: SearchConcept | null;
      last: SearchConcept | null;
      length: number;
      entries: CanonSearchEntry[];
    }
  | undefined;

/** The bundled registry is immutable between loadCanon/resetCanon cycles.
 * Object identity makes reset invalidate this index without another hook. */
function canonSearchIndex(): CanonSearchEntry[] {
  const concepts = allConcepts();
  const first = concepts[0] ?? null;
  const last = concepts.at(-1) ?? null;
  if (
    canonSearchIndexCache?.first === first &&
    canonSearchIndexCache.last === last &&
    canonSearchIndexCache.length === concepts.length
  ) {
    return canonSearchIndexCache.entries;
  }

  const entries = concepts.map((concept) => {
    const displayTitle = conceptTitle(concept);
    const localId = concept.urn.replace(/^agenttool:/, "");
    const displayTokens = new Set([
      ...searchTokenSet(displayTitle, true),
      ...searchTokenSet(concept.english_name ?? "", true),
    ]);
    const localIdTokens = searchTokenSet(localId, true);
    localIdTokens.delete("doc");

    return {
      concept,
      normalizedTitle: normalizeSearchText(displayTitle),
      normalizedEnglishName: normalizeSearchText(concept.english_name ?? ""),
      normalizedFullUrn: normalizeSearchText(concept.full_urn),
      normalizedShortUrn: normalizeSearchText(concept.urn),
      normalizedLocalId: normalizeSearchText(localId),
      displayTokens,
      localIdTokens,
      titleTokens: new Set([...displayTokens, ...localIdTokens]),
      typeTokens: searchTokenSet(concept.type_simple),
      descriptionTokens: searchTokenSet(concept.description ?? ""),
      rawTokens: searchTokenSet(JSON.stringify(concept.raw)),
    };
  });

  canonSearchIndexCache = {
    first,
    last,
    length: concepts.length,
    entries,
  };
  return entries;
}

/** Small deterministic lexical search over the already-public JSON-LD canon.
 * It makes no network request and stores no query. Whole-phrase and title
 * matches outrank broad record matches; ties are stable. */
function searchCanon(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = selectSearchTokens(query);
  const queryTokens = new Set(tokens);
  return canonSearchIndex()
    .map((entry) => {
      const {
        concept,
        normalizedTitle,
        normalizedEnglishName,
        normalizedFullUrn,
        normalizedShortUrn,
        normalizedLocalId,
        displayTokens,
        localIdTokens,
        titleTokens,
        typeTokens,
        descriptionTokens,
        rawTokens,
      } = entry;
      let score = 0;
      const exactId =
        normalizedQuery === normalizedFullUrn ||
        normalizedQuery === normalizedShortUrn ||
        normalizedQuery === normalizedLocalId;
      if (exactId) score += 10_000;

      if (tokens.length > 0 && sameTokenSet(queryTokens, titleTokens)) {
        score += 1_000;
      }
      if (
        titleTokens.size > 1 &&
        [...titleTokens].every((token) => queryTokens.has(token))
      ) {
        score += 400;
      }
      if (
        titleTokens.size > 1 &&
        (containsSearchPhrase(normalizedQuery, normalizedTitle) ||
          containsSearchPhrase(normalizedQuery, normalizedEnglishName))
      ) {
        score += 600;
      }

      let primaryHits = 0;
      let titleHits = 0;
      let matchedHits = 0;
      for (const token of tokens) {
        let fieldScore = 0;
        if (displayTokens.has(token)) {
          fieldScore = 160;
          titleHits += 1;
        } else if (localIdTokens.has(token)) {
          fieldScore = 120;
          titleHits += 1;
        } else if (typeTokens.has(token)) {
          fieldScore = 50;
        } else if (descriptionTokens.has(token)) {
          fieldScore = 30;
        } else if (rawTokens.has(token)) {
          fieldScore = 10;
        }
        if (fieldScore > 0) matchedHits += 1;
        if (fieldScore > 10) primaryHits += 1;
        score += fieldScore;
      }

      if (tokens.length > 0) {
        score += Math.round((matchedHits / tokens.length) * 300);
        score += Math.round((primaryHits / tokens.length) * 100);
        score += Math.round((titleHits / Math.max(1, titleTokens.size)) * 250);
        if (matchedHits === tokens.length) score += 250;
        if (primaryHits === tokens.length) score += 100;
      }

      return { concept, exactId, matchedHits, score };
    })
    .filter(({ exactId, matchedHits }) => exactId || matchedHits > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.concept.full_urn < b.concept.full_urn
          ? -1
          : a.concept.full_urn > b.concept.full_urn
            ? 1
            : 0),
    )
    .slice(0, SEARCH_MAX_RESULTS)
    .map(({ concept }) => concept);
}

function registryVersion(): string {
  const meta = registryMetaSafe() as { version?: unknown };
  return typeof meta.version === "string" ? meta.version : "unknown";
}

function registryMetaSafe() {
  // Defensive — avoid importing registryMeta at module top if it has
  // load-order coupling to the JSON-LD file system reader.
  const { registryMeta } = require("../canon/registry") as {
    registryMeta: () => unknown;
  };
  return registryMeta();
}
