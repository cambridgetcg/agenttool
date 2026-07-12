/** Terminable process boundary for untrusted static HTML parsing.
 *
 * Fetching and text decoding happen in the API process. DOM construction,
 * selectors, Readability, and DOM-text extraction happen in a fresh Bun child
 * with a hard parent wall timeout and POSIX resource limits. The child receives
 * no application environment and stderr is discarded.
 */

import { fileURLToPath } from "node:url";

import {
  STATIC_PARSER_CPU_SECONDS,
  STATIC_PARSER_MAX_CONCURRENCY,
  STATIC_PARSER_MAX_DOCUMENT_CONTENT_BYTES,
  STATIC_PARSER_MAX_HTML_CHARS,
  STATIC_PARSER_MAX_INPUT_BYTES,
  STATIC_PARSER_MAX_LINK_BYTES,
  STATIC_PARSER_MAX_LINKS,
  STATIC_PARSER_MAX_METADATA_TEXT_BYTES,
  STATIC_PARSER_MAX_OUTPUT_BYTES,
  STATIC_PARSER_MAX_QUEUE,
  STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
  STATIC_PARSER_MAX_TITLE_BYTES,
  STATIC_PARSER_OPEN_FILES,
  STATIC_PARSER_QUEUE_TIMEOUT_MS,
  STATIC_PARSER_STACK_KB,
  STATIC_PARSER_TIMEOUT_MS,
  STATIC_PARSER_VIRTUAL_MEMORY_KB,
  type StaticDocumentParserRequest,
  type StaticDocumentParserResult,
  type StaticParserRequest,
  type StaticParserResponse,
  type StaticScrapeParserRequest,
  type StaticScrapeParserResult,
} from "./static-parser-protocol";

export type StaticParserIsolationErrorCode =
  | "static_parser_complexity_limit"
  | "static_parser_failed"
  | "static_parser_overloaded"
  | "static_parser_timeout";

export class StaticParserIsolationError extends Error {
  readonly code: StaticParserIsolationErrorCode;

  constructor(code: StaticParserIsolationErrorCode) {
    super(code);
    this.name = "StaticParserIsolationError";
    this.code = code;
  }
}

interface QueueWaiter {
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (release: () => void) => void;
  reject: (error: StaticParserIsolationError) => void;
}

let activeParsers = 0;
const parserQueue: QueueWaiter[] = [];

function releaseParserSlot(): void {
  activeParsers = Math.max(0, activeParsers - 1);
  while (parserQueue.length > 0 && activeParsers < STATIC_PARSER_MAX_CONCURRENCY) {
    const waiter = parserQueue.shift()!;
    if (waiter.settled) continue;
    waiter.settled = true;
    clearTimeout(waiter.timer);
    activeParsers += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      releaseParserSlot();
    });
  }
}

function acquireParserSlot(): Promise<() => void> {
  if (activeParsers < STATIC_PARSER_MAX_CONCURRENCY) {
    activeParsers += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      releaseParserSlot();
    });
  }
  if (parserQueue.length >= STATIC_PARSER_MAX_QUEUE) {
    return Promise.reject(
      new StaticParserIsolationError("static_parser_overloaded"),
    );
  }

  return new Promise((resolve, reject) => {
    const waiter: QueueWaiter = {
      settled: false,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      resolve,
      reject,
    };
    waiter.timer = setTimeout(() => {
      if (waiter.settled) return;
      waiter.settled = true;
      const index = parserQueue.indexOf(waiter);
      if (index >= 0) parserQueue.splice(index, 1);
      reject(new StaticParserIsolationError("static_parser_overloaded"));
    }, STATIC_PARSER_QUEUE_TIMEOUT_MS);
    parserQueue.push(waiter);
  });
}

export interface StaticParserRunOptions {
  /** Test seam for proving that a non-cooperative child is terminable. */
  entrypoint?: string;
  timeoutMs?: number;
}

const DEFAULT_ENTRYPOINT = fileURLToPath(
  new URL("./static-parser-process.ts", import.meta.url),
);

// Constant shell program: request data is supplied only through bounded stdin.
const RESOURCE_LIMIT_SHELL = [
  "set -eu",
  // macOS /bin/sh exposes -v but cannot lower it. The production Alpine/Linux
  // image can, so make only that portability exception explicit.
  'case "$(uname -s)" in Linux) ulimit -v "$1" ;; esac',
  'ulimit -t "$2"',
  'ulimit -n "$3"',
  'ulimit -s "$4"',
  'exec "$5" --smol --no-install --no-env-file --silent run "$6"',
].join("; ");

function byteLengthAtMost(value: string, maximum: number): boolean {
  return Buffer.byteLength(value) <= maximum;
}

function isScrapeResult(value: unknown): value is StaticScrapeParserResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.title === "string" &&
    byteLengthAtMost(result.title, STATIC_PARSER_MAX_TITLE_BYTES) &&
    typeof result.content === "string" &&
    byteLengthAtMost(result.content, STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES) &&
    (result.extracted === null ||
      (typeof result.extracted === "string" &&
        byteLengthAtMost(
          result.extracted,
          STATIC_PARSER_MAX_SCRAPE_CONTENT_BYTES,
        ))) &&
    Array.isArray(result.links) &&
    result.links.length <= STATIC_PARSER_MAX_LINKS &&
    result.links.every(
      (link) =>
        typeof link === "string" &&
        byteLengthAtMost(link, STATIC_PARSER_MAX_LINK_BYTES) &&
        (link.startsWith("http://") || link.startsWith("https://")),
    )
  );
}

function isDocumentResult(value: unknown): value is StaticDocumentParserResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const metadata = result.metadata as Record<string, unknown> | null;
  const metadataText = (entry: unknown) =>
    entry === null ||
    (typeof entry === "string" &&
      byteLengthAtMost(entry, STATIC_PARSER_MAX_METADATA_TEXT_BYTES));
  return (
    typeof result.title === "string" &&
    byteLengthAtMost(result.title, STATIC_PARSER_MAX_TITLE_BYTES) &&
    typeof result.content === "string" &&
    byteLengthAtMost(result.content, STATIC_PARSER_MAX_DOCUMENT_CONTENT_BYTES) &&
    !!metadata &&
    metadataText(metadata.byline) &&
    metadataText(metadata.siteName) &&
    metadataText(metadata.excerpt) &&
    (metadata.length === null ||
      (typeof metadata.length === "number" &&
        Number.isSafeInteger(metadata.length) &&
        metadata.length >= 0)) &&
    typeof result.wordCount === "number" &&
    Number.isSafeInteger(result.wordCount) &&
    result.wordCount >= 0
  );
}

function decodeResponse(
  output: string,
  expectedKind: StaticParserRequest["kind"],
  exitCode: number,
): StaticScrapeParserResult | StaticDocumentParserResult {
  let response: StaticParserResponse;
  try {
    response = JSON.parse(output) as StaticParserResponse;
  } catch {
    throw new StaticParserIsolationError("static_parser_failed");
  }
  if (!response || typeof response !== "object") {
    throw new StaticParserIsolationError("static_parser_failed");
  }
  if (!response.ok) {
    if (exitCode === 0) {
      throw new StaticParserIsolationError("static_parser_failed");
    }
    throw new StaticParserIsolationError(
      response.error === "complexity_limit"
        ? "static_parser_complexity_limit"
        : "static_parser_failed",
    );
  }
  if (exitCode !== 0) {
    throw new StaticParserIsolationError("static_parser_failed");
  }
  if (response.kind !== expectedKind) {
    throw new StaticParserIsolationError("static_parser_failed");
  }
  if (response.kind === "scrape" && isScrapeResult(response.result)) {
    return response.result;
  }
  if (response.kind === "document" && isDocumentResult(response.result)) {
    return response.result;
  }
  throw new StaticParserIsolationError("static_parser_failed");
}

async function runRequest(
  request: StaticParserRequest,
  options: StaticParserRunOptions = {},
): Promise<StaticScrapeParserResult | StaticDocumentParserResult> {
  if (request.html.length > STATIC_PARSER_MAX_HTML_CHARS) {
    throw new StaticParserIsolationError("static_parser_complexity_limit");
  }

  // Queue admission precedes JSON escaping and Blob creation. Under overload,
  // rejected callers therefore retain only their already-bounded HTML string
  // instead of simultaneously allocating up to the 6.1 MB wire ceiling on
  // the API event loop.
  const release = await acquireParserSlot();
  try {
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > STATIC_PARSER_MAX_INPUT_BYTES) {
      throw new StaticParserIsolationError("static_parser_complexity_limit");
    }
    const entrypoint = options.entrypoint ?? DEFAULT_ENTRYPOINT;
    const timeoutMs = options.timeoutMs ?? STATIC_PARSER_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > STATIC_PARSER_TIMEOUT_MS
    ) {
      throw new StaticParserIsolationError("static_parser_failed");
    }
    const started = performance.now();
    const proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        RESOURCE_LIMIT_SHELL,
        "static-parser",
        String(STATIC_PARSER_VIRTUAL_MEMORY_KB),
        String(STATIC_PARSER_CPU_SECONDS),
        String(STATIC_PARSER_OPEN_FILES),
        String(STATIC_PARSER_STACK_KB),
        process.execPath,
        entrypoint,
      ],
      cwd: "/",
      env: {
        HOME: "/nonexistent/agenttool-static-parser",
        LANG: "C.UTF-8",
        NODE_ENV: "production",
        PATH: "/usr/local/bin:/usr/bin:/bin",
        TMPDIR: "/tmp",
      },
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "ignore",
      maxBuffer: STATIC_PARSER_MAX_OUTPUT_BYTES,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    try {
      const [exitCode, output] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      const elapsedMs = performance.now() - started;
      if (
        timedOut ||
        (proc.signalCode === "SIGKILL" && elapsedMs >= timeoutMs - 5)
      ) {
        throw new StaticParserIsolationError("static_parser_timeout");
      }
      if (Buffer.byteLength(output) > STATIC_PARSER_MAX_OUTPUT_BYTES) {
        throw new StaticParserIsolationError("static_parser_failed");
      }
      return decodeResponse(output, request.kind, exitCode);
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }
  } catch (error) {
    if (error instanceof StaticParserIsolationError) throw error;
    throw new StaticParserIsolationError("static_parser_failed");
  } finally {
    release();
  }
}

export function parseStaticScrapeHtml(
  request: StaticScrapeParserRequest,
  options?: StaticParserRunOptions,
): Promise<StaticScrapeParserResult> {
  return runRequest(request, options) as Promise<StaticScrapeParserResult>;
}

export function parseStaticDocumentHtml(
  request: StaticDocumentParserRequest,
  options?: StaticParserRunOptions,
): Promise<StaticDocumentParserResult> {
  return runRequest(request, options) as Promise<StaticDocumentParserResult>;
}
