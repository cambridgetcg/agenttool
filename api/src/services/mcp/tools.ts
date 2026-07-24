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
  additionalProperties?: boolean;
  minLength?: number;
}

/** MCP tool descriptor — matches the protocol's `Tool` shape. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: {
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

/** List every tool an MCP client can call. */
export function listTools(): McpTool[] {
  return [
    {
      name: "canon.lookup",
      description:
        "Resolve a canon concept by URN. Returns the JSON-LD entry plus its bidirectional neighbors (citations in + citations out).",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
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
      description:
        "List every registered canon entry of a given @type (e.g. DoctrineDoc, Wall, RingCommitment, Pattern, Promise). The prose corpus is broader than this registry.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
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
      description:
        "List the type vocabulary of the canon registry. Returns the distinct @types plus the count of concepts in each.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "canon.summary",
      description:
        "Summary of the canon registry — total concepts, version, types, registry meta. Use first to orient.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "wake.platform",
      description:
        "Return the public platform-self payload — agenttool's identity, repo, the_seat, doctrine roots. The same data served at GET /public/self.",
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  ];
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
  | { name: "canon.lookup"; args: { urn: string } }
  | { name: "canon.by_type"; args: { type: string } }
  | { name: "canon.list_types"; args: Record<string, never> }
  | { name: "canon.summary"; args: Record<string, never> }
  | { name: "wake.platform"; args: Record<string, never> };

function assertObject(
  name: string,
  args: unknown,
): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new McpToolInputError(`${name} arguments must be an object.`);
  }
  return args as Record<string, unknown>;
}

function exactStringArgument(
  name: string,
  args: unknown,
  key: string,
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
