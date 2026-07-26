import { once } from "node:events";
import type { Writable } from "node:stream";
import {
  executeBrowserOperation,
  MAX_JSONL_REQUEST_BYTES,
  MAX_JSONL_RESPONSE_BYTES,
  publicBrowserError,
  type AgentBrowser,
  type BrowserOperation,
} from "@agenttool/browser";
import type { z } from "zod";
import { SEARCH_JSONL_VERSION } from "./constants.js";
import {
  SearchError,
  publicSearchError,
} from "./errors.js";
import {
  searchResultRefSchema,
  searchInputSchema,
  type SearchMcpSession,
} from "./mcp.js";
import type { SearchInput } from "./types.js";

export type AgentSearchOperation =
  | "agent_search"
  | "agent_inspect"
  | "browser_plan_result"
  | "browser_open_result";

export type SearchOperation =
  | BrowserOperation
  | AgentSearchOperation;

type RequestId = string | number;
type InputChunk = string | Uint8Array;

const BROWSER_OPERATIONS = new Set<BrowserOperation>([
  "browser_capabilities",
  "browser_plan",
  "browser_open",
  "browser_observe",
  "browser_act",
  "browser_extract",
  "browser_screenshot",
  "browser_tabs",
  "browser_close",
]);

const SEARCH_OPERATIONS = new Set<AgentSearchOperation>([
  "agent_search",
  "agent_inspect",
  "browser_plan_result",
  "browser_open_result",
]);

const OPERATIONS = new Set<SearchOperation>([
  ...BROWSER_OPERATIONS,
  ...SEARCH_OPERATIONS,
]);

interface JsonlRequest {
  version: typeof SEARCH_JSONL_VERSION;
  id: RequestId;
  method: SearchOperation;
  params: Record<string, unknown>;
}

interface Line {
  text?: string;
  error?: "line_too_large" | "invalid_utf8";
}

const PROTOCOL_ERROR = Symbol("agenttool-search-jsonl-protocol-error");

export interface SearchJsonlSessionOptions {
  input: AsyncIterable<InputChunk>;
  output: Writable;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

function protocolError(
  code: string,
  message: string,
  requestId?: RequestId,
): Error & { code: string; requestId?: RequestId } {
  return Object.assign(
    new Error(message),
    { code, [PROTOCOL_ERROR]: true },
    requestId !== undefined ? { requestId } : {},
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("invalid_request", "request must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function parseRequest(text: string): JsonlRequest {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw protocolError("invalid_json", "line is not valid JSON");
  }
  const value = asRecord(decoded);
  const id = value.id;
  if (
    !(
      (typeof id === "string" && id.length > 0 && id.length <= 200)
      || (typeof id === "number" && Number.isSafeInteger(id))
    )
  ) {
    throw protocolError(
      "invalid_request",
      "id must be a non-empty string or safe integer",
    );
  }
  if (
    Object.keys(value).some((key) =>
      !["version", "id", "method", "params"].includes(key)
    )
  ) {
    throw protocolError(
      "invalid_request",
      "request contains an unknown top-level field",
      id,
    );
  }
  if (value.version !== SEARCH_JSONL_VERSION) {
    throw protocolError(
      "unsupported_version",
      `version must be ${SEARCH_JSONL_VERSION}`,
      id,
    );
  }
  if (
    typeof value.method !== "string"
    || !OPERATIONS.has(value.method as SearchOperation)
  ) {
    throw protocolError(
      "method_not_found",
      "unknown search or browser method",
      id,
    );
  }
  let params: Record<string, unknown>;
  try {
    params = value.params === undefined ? {} : asRecord(value.params);
  } catch {
    throw protocolError("invalid_request", "params must be a JSON object", id);
  }
  return {
    version: SEARCH_JSONL_VERSION,
    id,
    method: value.method as SearchOperation,
    params,
  };
}

function parsed<T extends z.ZodType>(
  schema: T,
  params: Record<string, unknown>,
): z.output<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw protocolError(
      "invalid_params",
      result.error.issues
        .slice(0, 4)
        .map((issue) =>
          `${issue.path.join(".") || "params"}: ${issue.message}`
        )
        .join("; ")
        .slice(0, 2_000),
    );
  }
  return result.data;
}

export async function executeSearchOperation(
  browser: AgentBrowser,
  session: SearchMcpSession,
  method: SearchOperation,
  rawParams: Record<string, unknown>,
): Promise<unknown> {
  if (BROWSER_OPERATIONS.has(method as BrowserOperation)) {
    return await executeBrowserOperation(
      browser,
      method as BrowserOperation,
      rawParams,
    );
  }
  switch (method) {
    case "agent_search":
      return await session.search(
        parsed(searchInputSchema, rawParams) as SearchInput,
      );
    case "agent_inspect":
      return await session.inspect(
        parsed(searchResultRefSchema, rawParams),
      );
    case "browser_plan_result":
      return await session.planResult(
        parsed(searchResultRefSchema, rawParams),
      );
    case "browser_open_result":
      return await session.openResult(
        parsed(searchResultRefSchema, rawParams),
      );
    default:
      throw protocolError(
        "method_not_found",
        "unknown search or browser method",
      );
  }
}

async function* boundedLines(
  input: AsyncIterable<InputChunk>,
  maxBytes: number,
): AsyncGenerator<Line> {
  let parts: Buffer[] = [];
  let bytes = 0;
  let discarding = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });

  const finish = (): Line => {
    if (discarding) {
      parts = [];
      bytes = 0;
      discarding = false;
      return { error: "line_too_large" };
    }
    const value = Buffer.concat(parts, bytes);
    parts = [];
    bytes = 0;
    const content =
      value.length > 0 && value[value.length - 1] === 13
        ? value.subarray(0, value.length - 1)
        : value;
    try {
      return { text: decoder.decode(content) };
    } catch {
      return { error: "invalid_utf8" };
    }
  };

  for await (const rawChunk of input) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 10) continue;
      const segment = chunk.subarray(start, index);
      if (!discarding) {
        if (bytes + segment.length > maxBytes) {
          discarding = true;
          parts = [];
          bytes = 0;
        } else if (segment.length > 0) {
          parts.push(segment);
          bytes += segment.length;
        }
      }
      yield finish();
      start = index + 1;
    }
    const remainder = chunk.subarray(start);
    if (!discarding) {
      if (bytes + remainder.length > maxBytes) {
        discarding = true;
        parts = [];
        bytes = 0;
      } else if (remainder.length > 0) {
        parts.push(remainder);
        bytes += remainder.length;
      }
    }
  }
  if (discarding || bytes > 0) yield finish();
}

function encodedLine(
  envelope: Record<string, unknown>,
  maxBytes: number,
  id: RequestId | null,
): string {
  let line: string;
  try {
    line = JSON.stringify(envelope);
  } catch {
    line = JSON.stringify({
      version: SEARCH_JSONL_VERSION,
      id,
      ok: false,
      error: {
        code: "serialization_failed",
        message: "result is not JSON serializable",
      },
    });
  }
  if (Buffer.byteLength(line, "utf8") + 1 <= maxBytes) return `${line}\n`;
  const withId = JSON.stringify({
    version: SEARCH_JSONL_VERSION,
    id,
    ok: false,
    error: {
      code: "result_too_large",
      message: `result exceeds ${maxBytes} bytes`,
    },
  });
  if (Buffer.byteLength(withId, "utf8") + 1 <= maxBytes) {
    return `${withId}\n`;
  }
  return `${JSON.stringify({
    version: SEARCH_JSONL_VERSION,
    id: null,
    ok: false,
    error: {
      code: "result_too_large",
      message: "result exceeds response bound",
    },
  })}\n`;
}

async function writeLine(output: Writable, line: string): Promise<void> {
  if (output.write(line)) return;
  await once(output, "drain");
}

function publicProtocolError(
  error: unknown,
  operation?: SearchOperation,
): {
  code: string;
  message: string;
} {
  if (error instanceof SearchError) return publicSearchError(error);
  if (
    (error as { [PROTOCOL_ERROR]?: unknown })?.[PROTOCOL_ERROR] === true
  ) {
    return publicBrowserError(error);
  }
  if (
    operation !== undefined
    && SEARCH_OPERATIONS.has(operation as AgentSearchOperation)
  ) {
    return publicSearchError(error);
  }
  return publicBrowserError(error);
}

export async function runSearchJsonlSession(
  browser: AgentBrowser,
  session: SearchMcpSession,
  options: SearchJsonlSessionOptions,
): Promise<void> {
  const maxRequestBytes =
    options.maxRequestBytes ?? MAX_JSONL_REQUEST_BYTES;
  const maxResponseBytes =
    options.maxResponseBytes ?? MAX_JSONL_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new Error("maxRequestBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 256) {
    throw new Error(
      "maxResponseBytes must be a safe integer of at least 256",
    );
  }

  for await (const line of boundedLines(options.input, maxRequestBytes)) {
    if (line.text !== undefined && line.text.trim() === "") continue;
    let id: RequestId | null = null;
    let envelope: Record<string, unknown>;
    if (line.error) {
      envelope = {
        version: SEARCH_JSONL_VERSION,
        id,
        ok: false,
        error: {
          code: line.error,
          message:
            line.error === "line_too_large"
              ? `request line exceeds ${maxRequestBytes} bytes`
              : "request line is not valid UTF-8",
        },
      };
    } else {
      let operation: SearchOperation | undefined;
      try {
        const request = parseRequest(line.text!);
        id = request.id;
        operation = request.method;
        const result = await executeSearchOperation(
          browser,
          session,
          request.method,
          request.params,
        );
        envelope = {
          version: SEARCH_JSONL_VERSION,
          id,
          ok: true,
          result,
        };
      } catch (error) {
        const requestId = (error as { requestId?: unknown })?.requestId;
        if (
          (typeof requestId === "string" && requestId.length <= 200)
          || (
            typeof requestId === "number"
            && Number.isSafeInteger(requestId)
          )
        ) {
          id = requestId;
        }
        envelope = {
          version: SEARCH_JSONL_VERSION,
          id,
          ok: false,
          error: publicProtocolError(error, operation),
        };
      }
    }
    await writeLine(
      options.output,
      encodedLine(envelope, maxResponseBytes, id),
    );
  }
}
