/** MCP tools surface — a curated set of read-only operations exposed
 *  as MCP tools.
 *
 *  Scaffold scope: read-only canon + platform-wake queries. Auth-gated
 *  write operations (memory.append, strand.append, inbox.send,
 *  covenant.propose) are intentionally NOT in v0 — they need the MCP
 *  OAuth 2.1 Resource Server handshake to bind a tool call to an
 *  agenttool identity.
 *
 *  Tool schema is JSON Schema (per MCP spec). Each handler returns
 *  `{ content: [{ type: 'text', text: ... }] }` per MCP's `CallToolResult`.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 1) ·
 *  docs/CANONICAL-BYTES.md (canon URN format).
 */

import {
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
}

/** MCP tool descriptor — matches the protocol's `Tool` shape. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface McpToolContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

/** List every tool an MCP client can call. */
export function listTools(): McpTool[] {
  return [
    {
      name: "canon.lookup",
      description:
        "Resolve a canon concept by URN. Returns the JSON-LD entry plus its bidirectional neighbors (citations in + citations out).",
      inputSchema: {
        type: "object",
        properties: {
          urn: {
            type: "string",
            description:
              "Full URN (e.g. urn:agenttool:doc/SOUL) or short form (agenttool:doc/SOUL).",
          },
        },
        required: ["urn"],
      },
    },
    {
      name: "canon.by_type",
      description:
        "List every registered canon entry of a given @type (e.g. DoctrineDoc, Wall, RingCommitment, Pattern, Promise). The prose corpus is broader than this registry.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "The canon @type to filter on.",
          },
        },
        required: ["type"],
      },
    },
    {
      name: "canon.list_types",
      description:
        "List the type vocabulary of the canon registry. Returns the distinct @types plus the count of concepts in each.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "canon.summary",
      description:
        "Summary of the canon registry — total concepts, version, types, registry meta. Use first to orient.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "wake.platform",
      description:
        "Return the public platform-self payload — agenttool's identity, repo, the_seat, doctrine roots. The same data served at GET /public/self.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];
}

/** Dispatch a `tools/call`. Throws on unknown tool name; returns
 *  `{ isError: true, ... }` on user-error (bad URN, missing input).
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (name) {
    case "canon.lookup": {
      const urnRaw = String(args.urn ?? "").trim();
      if (!urnRaw) {
        return errorResult("canon.lookup requires a 'urn' argument.");
      }
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
      const typeKey = String(args.type ?? "").trim();
      if (!typeKey) {
        return errorResult("canon.by_type requires a 'type' argument.");
      }
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

    default:
      return errorResult(`Unknown tool: ${name}`);
  }
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

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function registryMetaSafe() {
  // Defensive — avoid importing registryMeta at module top if it has
  // load-order coupling to the JSON-LD file system reader.
  const { registryMeta } = require("../canon/registry") as {
    registryMeta: () => unknown;
  };
  return registryMeta();
}
