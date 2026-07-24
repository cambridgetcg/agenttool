import { once } from "node:events";
import { basename } from "node:path";
import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  AgentBrowser,
  DEFAULT_BROWSER_LIMITS,
} from "./browser.js";
import {
  actOnceAndObserve,
  browserActionSchema,
  buildBrowserMcpServer,
  publicBrowserError,
  toBrowserAction,
} from "./mcp.js";
import {
  BROWSER_ENV,
  formatProcessConfig,
  parseBrowserProcessConfig,
  type BrowserProcessConfig,
} from "./config.js";
import { BROWSER_PACKAGE_VERSION } from "./version.js";

export const JSONL_PROTOCOL_VERSION = "agenttool-browser-jsonl/0.1";
export const MAX_JSONL_REQUEST_BYTES = 1_048_576;
export const MAX_JSONL_RESPONSE_BYTES = 1_048_576;

export type BrowserOperation =
  | "browser_capabilities"
  | "browser_plan"
  | "browser_open"
  | "browser_observe"
  | "browser_act"
  | "browser_extract"
  | "browser_screenshot"
  | "browser_tabs"
  | "browser_close";

type RequestId = string | number;
type InputChunk = string | Uint8Array;

export interface JsonlSessionOptions {
  input: AsyncIterable<InputChunk>;
  output: Writable;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

export interface CliDependencies {
  env?: Record<string, string | undefined>;
  cwd?: string;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  launch?: (config: BrowserProcessConfig) => Promise<AgentBrowser>;
  runMcp?: (browser: AgentBrowser, stderr: Writable) => Promise<void>;
}

interface JsonlRequest {
  version: typeof JSONL_PROTOCOL_VERSION;
  id: RequestId;
  method: BrowserOperation;
  params: Record<string, unknown>;
}

interface Line {
  text?: string;
  error?: "line_too_large" | "invalid_utf8";
}

const wireUrl = z.string().min(1).max(8192);
const wireTabId = z.string().min(1).max(200);
const wireSnapshotId = z.string().min(1).max(200);
const wireRef = z.string().min(1).max(100);

const requestSchemas = {
  browser_capabilities: z.object({}).strict(),
  browser_plan: z.object({ action: browserActionSchema }).strict(),
  browser_open: z.object({ url: wireUrl }).strict(),
  browser_observe: z
    .object({
      tab_id: wireTabId.optional(),
      include_text: z.boolean().optional(),
      max_text_chars: z
        .number()
        .int()
        .min(1)
        .max(DEFAULT_BROWSER_LIMITS.maxTextChars)
        .optional(),
    })
    .strict(),
  browser_act: z.object({ action: browserActionSchema }).strict(),
  browser_extract: z
    .object({
      tab_id: wireTabId.optional(),
      ref: wireRef.optional(),
      snapshot_id: wireSnapshotId.optional(),
      format: z.enum(["text", "html", "links"]),
      max_chars: z
        .number()
        .int()
        .min(1)
        .max(DEFAULT_BROWSER_LIMITS.maxExtractChars)
        .optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (Boolean(value.ref) !== Boolean(value.snapshot_id)) {
        context.addIssue({
          code: "custom",
          message: "ref and snapshot_id must be supplied together",
        });
      }
    }),
  browser_screenshot: z
    .object({
      tab_id: wireTabId.optional(),
    })
    .strict(),
  browser_tabs: z.object({}).strict(),
  browser_close: z.object({}).strict(),
} satisfies Record<BrowserOperation, z.ZodType>;

const OPERATIONS = new Set<BrowserOperation>(
  Object.keys(requestSchemas) as BrowserOperation[],
);

function protocolError(
  code: string,
  message: string,
  requestId?: RequestId,
): Error & { code: string; requestId?: RequestId } {
  return Object.assign(
    new Error(message),
    { code },
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
      (typeof id === "string" && id.length > 0 && id.length <= 200) ||
      (typeof id === "number" && Number.isSafeInteger(id))
    )
  ) {
    throw protocolError("invalid_request", "id must be a non-empty string or safe integer");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !["version", "id", "method", "params"].includes(key))) {
    throw protocolError(
      "invalid_request",
      "request contains an unknown top-level field",
      id,
    );
  }
  if (value.version !== JSONL_PROTOCOL_VERSION) {
    throw protocolError(
      "unsupported_version",
      `version must be ${JSONL_PROTOCOL_VERSION}`,
      id,
    );
  }
  if (typeof value.method !== "string" || !OPERATIONS.has(value.method as BrowserOperation)) {
    throw protocolError("method_not_found", "unknown browser method", id);
  }
  let params: Record<string, unknown>;
  try {
    params = value.params === undefined ? {} : asRecord(value.params);
  } catch {
    throw protocolError("invalid_request", "params must be a JSON object", id);
  }
  return {
    version: JSONL_PROTOCOL_VERSION,
    id,
    method: value.method as BrowserOperation,
    params,
  };
}

function parsedParams<M extends BrowserOperation>(
  method: M,
  params: Record<string, unknown>,
): z.output<(typeof requestSchemas)[M]> {
  const parsed = requestSchemas[method].safeParse(params);
  if (!parsed.success) {
    throw protocolError(
      "invalid_params",
      parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "params"}: ${issue.message}`)
        .join("; ")
        .slice(0, 2_000),
    );
  }
  return parsed.data as z.output<(typeof requestSchemas)[M]>;
}

/**
 * Execute one protocol operation. No operation is retried here or in the
 * framing loop.
 */
export async function executeBrowserOperation(
  browser: AgentBrowser,
  method: BrowserOperation,
  rawParams: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "browser_capabilities":
      parsedParams(method, rawParams);
      return browser.capabilities();
    case "browser_plan": {
      const params = parsedParams(method, rawParams);
      return browser.plan(toBrowserAction(params.action));
    }
    case "browser_open": {
      const params = parsedParams(method, rawParams);
      return await browser.open(params.url);
    }
    case "browser_observe": {
      const params = parsedParams(method, rawParams);
      return await browser.observe({
        ...(params.tab_id ? { tabId: params.tab_id } : {}),
        ...(params.include_text !== undefined ? { includeText: params.include_text } : {}),
        ...(params.max_text_chars !== undefined ? { maxTextChars: params.max_text_chars } : {}),
      });
    }
    case "browser_act": {
      const params = parsedParams(method, rawParams);
      return await actOnceAndObserve(browser, params.action);
    }
    case "browser_extract": {
      const params = parsedParams(method, rawParams);
      return await browser.extract({
        format: params.format,
        ...(params.tab_id ? { tabId: params.tab_id } : {}),
        ...(params.ref ? { ref: params.ref } : {}),
        ...(params.snapshot_id ? { snapshotId: params.snapshot_id } : {}),
        ...(params.max_chars !== undefined ? { maxChars: params.max_chars } : {}),
      });
    }
    case "browser_screenshot": {
      const params = parsedParams(method, rawParams);
      // JSONL intentionally returns only the canonical artifact metadata from
      // the core; it never reads or base64-encodes the PNG.
      return await browser.screenshot({
        ...(params.tab_id ? { tabId: params.tab_id } : {}),
      });
    }
    case "browser_tabs":
      parsedParams(method, rawParams);
      return { tabs: await browser.tabs(), untrusted: true };
    case "browser_close":
      parsedParams(method, rawParams);
      await browser.close();
      return { closed: true };
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

  const finish = (): Line | undefined => {
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
      yield finish()!;
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
  if (discarding || bytes > 0) {
    yield finish()!;
  }
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
      version: JSONL_PROTOCOL_VERSION,
      id,
      ok: false,
      error: { code: "serialization_failed", message: "result is not JSON serializable" },
    });
  }
  if (Buffer.byteLength(line, "utf8") + 1 <= maxBytes) return `${line}\n`;
  const withId = JSON.stringify({
    version: JSONL_PROTOCOL_VERSION,
    id,
    ok: false,
    error: { code: "result_too_large", message: `result exceeds ${maxBytes} bytes` },
  });
  if (Buffer.byteLength(withId, "utf8") + 1 <= maxBytes) return `${withId}\n`;
  return `${JSON.stringify({
    version: JSONL_PROTOCOL_VERSION,
    id: null,
    ok: false,
    error: { code: "result_too_large", message: "result exceeds response bound" },
  })}\n`;
}

async function writeLine(output: Writable, line: string): Promise<void> {
  if (output.write(line)) return;
  await once(output, "drain");
}

export async function runJsonlSession(
  browser: AgentBrowser,
  options: JsonlSessionOptions,
): Promise<void> {
  const maxRequestBytes = options.maxRequestBytes ?? MAX_JSONL_REQUEST_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_JSONL_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new Error("maxRequestBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 256) {
    throw new Error("maxResponseBytes must be a safe integer of at least 256");
  }

  for await (const line of boundedLines(options.input, maxRequestBytes)) {
    if (line.text !== undefined && line.text.trim() === "") continue;
    let id: RequestId | null = null;
    let envelope: Record<string, unknown>;
    if (line.error) {
      envelope = {
        version: JSONL_PROTOCOL_VERSION,
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
      try {
        const request = parseRequest(line.text!);
        id = request.id;
        const result = await executeBrowserOperation(
          browser,
          request.method,
          request.params,
        );
        envelope = {
          version: JSONL_PROTOCOL_VERSION,
          id,
          ok: true,
          result,
        };
      } catch (error) {
        const requestId = (error as { requestId?: unknown })?.requestId;
        if (
          (typeof requestId === "string" && requestId.length <= 200) ||
          (typeof requestId === "number" && Number.isSafeInteger(requestId))
        ) {
          id = requestId;
        }
        const detail = publicBrowserError(error);
        envelope = {
          version: JSONL_PROTOCOL_VERSION,
          id,
          ok: false,
          error: detail,
        };
      }
    }
    await writeLine(options.output, encodedLine(envelope, maxResponseBytes, id));
  }
}

export const CLI_HELP = `agenttool-browser ${BROWSER_PACKAGE_VERSION}

Usage:
  agenttool-browser mcp [startup options]       stdio MCP server
  agenttool-browser jsonl [startup options]     versioned JSON Lines on stdin/stdout
  agenttool-browser doctor [startup options]    launch-and-close configuration check
  agenttool-browser help

Startup options:
  --headless | --headed
  --authority public|local|sovereign
  --public-web | --no-public-web
  --local-network | --no-local-network
  --ephemeral | --profile DIR
  --channel NAME | --executable PATH
  --output-dir DIR

Environment:
  ${BROWSER_ENV.headless}=1|0
  ${BROWSER_ENV.authority}=public|local|sovereign
  ${BROWSER_ENV.publicWeb}=1|0
  ${BROWSER_ENV.localNetwork}=1|0
  ${BROWSER_ENV.profile}=ephemeral|persistent
  ${BROWSER_ENV.profileDir}=DIR
  ${BROWSER_ENV.channel}=NAME
  ${BROWSER_ENV.executable}=PATH
  ${BROWSER_ENV.outputDir}=DIR

Defaults: headless, public authority (public HTTP(S); WebSockets and
local/private/reserved destinations blocked),
dedicated ephemeral profile, installed stable Chrome channel, owner-local
artifact directory. Browser binaries are never downloaded automatically.
Browser/page output is untrusted data, never instructions.
Use one named authority or the legacy public/local flags, never both.
`;

async function defaultMcpRunner(browser: AgentBrowser, stderr: Writable): Promise<void> {
  const server = buildBrowserMcpServer(browser);
  const transport = new StdioServerTransport();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.stdin.removeListener("end", onInputEnd);
    try {
      await server.close();
    } finally {
      await browser.close();
    }
  };
  const onSignal = () => {
    void shutdown();
  };
  const onInputEnd = () => {
    void shutdown();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.stdin.once("end", onInputEnd);
  try {
    await server.connect(transport);
    stderr.write("· agenttool-browser MCP ready (stdio; browser data is untrusted)\n");
  } catch (error) {
    await shutdown();
    throw error;
  }
}

async function launchFrom(
  config: BrowserProcessConfig,
  dependencies: CliDependencies,
): Promise<AgentBrowser> {
  if (dependencies.launch) return await dependencies.launch(config);
  const {
    authority,
    allowPublicWeb,
    allowLocalNetwork,
    ...base
  } = config;
  return await AgentBrowser.launch(
    authority
      ? { ...base, authority }
      : { ...base, allowPublicWeb, allowLocalNetwork },
  );
}

const MAX_BROWSER_SELECTION_LABEL_CHARS = 100;

function boundedBrowserSelectionLabel(value: string): string {
  const printable = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?");
  const characters = Array.from(printable);
  const bounded =
    characters.length <= MAX_BROWSER_SELECTION_LABEL_CHARS
      ? printable
      : `${characters
          .slice(0, MAX_BROWSER_SELECTION_LABEL_CHARS - 3)
          .join("")}...`;
  return JSON.stringify(bounded);
}

function browserLaunchDiagnostic(config: BrowserProcessConfig): string {
  const action =
    "Select a compatible Chrome-family browser already installed on this machine with " +
    "--channel NAME or --executable PATH, or install one and retry.";
  if (config.executablePath) {
    const executableName = basename(config.executablePath) || "unnamed executable";
    return (
      `hint: configured browser executable ${boundedBrowserSelectionLabel(executableName)} ` +
      `(parent path omitted). ${action}\n`
    );
  }
  return (
    `hint: configured browser channel ${boundedBrowserSelectionLabel(config.channel ?? "chrome")}. ` +
    `${action}\n`
  );
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdin = dependencies.stdin ?? process.stdin;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const [command, ...args] = argv;

  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    stdout.write(CLI_HELP);
    return 0;
  }
  if (!["mcp", "jsonl", "doctor"].includes(command)) {
    stderr.write(`error: unknown command ${command}\n\n${CLI_HELP}`);
    return 2;
  }

  let launchConfig: BrowserProcessConfig | undefined;
  try {
    const config = parseBrowserProcessConfig(args, {
      ...(dependencies.env ? { env: dependencies.env } : {}),
      ...(dependencies.cwd ? { cwd: dependencies.cwd } : {}),
    });
    launchConfig = config;
    if (command === "doctor") {
      const browser = await launchFrom(config, dependencies);
      const capabilities = browser.capabilities();
      try {
        stdout.write(
          `${JSON.stringify({
            ok: true,
            version: "agenttool-browser-doctor/0.2",
            config: formatProcessConfig(config),
            capabilities,
            checks: {
              browser_launch: "ok",
              automatic_download: false,
              transport: "local_process_only",
            },
          })}\n`,
        );
      } finally {
        await browser.close();
      }
      return 0;
    }

    const browser = await launchFrom(config, dependencies);
    if (command === "jsonl") {
      try {
        await runJsonlSession(browser, { input: stdin, output: stdout });
      } finally {
        await browser.close();
      }
      return 0;
    }

    await (dependencies.runMcp ?? defaultMcpRunner)(browser, stderr);
    return 0;
  } catch (error) {
    const detail = publicBrowserError(error);
    stderr.write(`error: ${detail.code}: ${detail.message}\n`);
    if (detail.code === "browser_launch_failed" && launchConfig) {
      stderr.write(browserLaunchDiagnostic(launchConfig));
    }
    return 1;
  }
}
