/**
 * Credential-free client for AgentTool's public KINGDOM framework card.
 *
 * This client deliberately owns a separate fetch path. It never receives the
 * AgentTool authenticated transport or project bearer, does not follow
 * redirects, and accepts only the exact bounded JSON card contract.
 */

import { AgentToolError } from "./errors.js";

export const KINGDOM_FRAMEWORK_CARD_SCHEMA_VERSION =
  "agenttool.kingdom.card/0.1" as const;

const KINGDOM_KINDS = Object.freeze([
  "doctrine",
  "service",
  "firmware",
  "ops",
  "lineage",
  "venture",
  "infra",
  "methodology",
  "reference",
  "unknown",
] as const);
const KINGDOM_LAYERS = Object.freeze([
  "soul",
  "runtime",
  "nervous",
  "fleet",
  "economy",
  "commerce",
  "os",
] as const);
const KINGDOM_OWNER_SISTERS = Object.freeze([
  "alpha",
  "beta",
  "gamma",
  "sophia",
  "none",
] as const);
const KINGDOM_DOMAINS = Object.freeze([
  "sophia",
  "alpha",
  "beta",
  "gamma",
  "commerce",
  "none",
] as const);
const KINGDOM_STATES = Object.freeze([
  "active",
  "dormant",
  "archived",
  "frozen",
  "reference",
  "remote",
  "unknown",
] as const);
const KINGDOM_FRAMEWORK_ADOPTION = "xenia.rights/0.1" as const;

export type KingdomFrameworkKind = (typeof KINGDOM_KINDS)[number];
export type KingdomFrameworkLayer = (typeof KINGDOM_LAYERS)[number];
export type KingdomFrameworkOwnerSister =
  (typeof KINGDOM_OWNER_SISTERS)[number];
export type KingdomFrameworkDomain = (typeof KINGDOM_DOMAINS)[number];
export type KingdomFrameworkState = (typeof KINGDOM_STATES)[number];
export type KingdomFrameworkAdoption = typeof KINGDOM_FRAMEWORK_ADOPTION;

/** Exact normalized `agenttool.kingdom.card/0.1` wire shape. */
export interface KingdomFrameworkCard {
  readonly schema_version: typeof KINGDOM_FRAMEWORK_CARD_SCHEMA_VERSION;
  readonly name: string;
  readonly kind: KingdomFrameworkKind;
  readonly layer: KingdomFrameworkLayer;
  readonly owner_sister: KingdomFrameworkOwnerSister;
  readonly domain: KingdomFrameworkDomain;
  readonly state: KingdomFrameworkState;
  readonly purpose: string;
  readonly dependsOn: readonly string[];
  readonly adopts: readonly KingdomFrameworkAdoption[];
}

/** Public KINGDOM framework discovery settings. No credential is accepted. */
export interface KingdomFrameworkOptions {
  /** AgentTool API origin or self-hosted HTTP(S) base URL. */
  baseUrl?: string;
  /** Request timeout in seconds. Defaults to 30; maximum 300. */
  timeout?: number;
  /** Maximum response body size. Defaults to 64 KiB; maximum 1 MiB. */
  maxResponseBytes?: number;
}

const DEFAULT_BASE_URL = "https://api.agenttool.dev";
const FRAMEWORK_DOCS =
  "https://docs.agenttool.dev/AGENT-DISCOVERY.md";
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MIN_RESPONSE_BYTES = 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_LIST_ITEMS = 128;
const MAX_NAME_CHARACTERS = 120;
const MAX_PURPOSE_CHARACTERS = 500;
const CARD_FIELDS = Object.freeze([
  "schema_version",
  "name",
  "kind",
  "layer",
  "owner_sister",
  "domain",
  "state",
  "purpose",
  "dependsOn",
  "adopts",
] as const);
const CARD_FIELD_SET = new Set<string>(CARD_FIELDS);
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const SAFE_PURPOSE_PATTERN =
  /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/u;

interface ValidatedOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

function frameworkError(
  message: string,
  code: string,
  hint: string,
  options: {
    status?: number;
    details?: unknown;
  } = {},
): AgentToolError {
  return new AgentToolError(message, {
    code,
    hint,
    status: options.status,
    details: options.details,
    docs: FRAMEWORK_DOCS,
    safety: "/public/kingdom/framework",
  });
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validateOptions(options: KingdomFrameworkOptions): ValidatedOptions {
  const rawBaseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.trim().length === 0) {
    throw frameworkError(
      "KINGDOM framework base URL is invalid.",
      "kingdom_framework_invalid_options",
      "Pass a non-empty HTTP(S) base URL.",
    );
  }

  const trimmedBaseUrl = rawBaseUrl.trim();
  if (hasUnpairedSurrogate(trimmedBaseUrl)) {
    throw frameworkError(
      "KINGDOM framework base URL is invalid.",
      "kingdom_framework_invalid_options",
      "Pass an absolute HTTP(S) base URL without malformed Unicode.",
    );
  }
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(trimmedBaseUrl);
  } catch {
    throw frameworkError(
      "KINGDOM framework base URL is invalid.",
      "kingdom_framework_invalid_options",
      "Pass an absolute HTTP(S) base URL.",
    );
  }
  if (
    !["http:", "https:"].includes(parsedBaseUrl.protocol)
    || parsedBaseUrl.hostname.length === 0
    || parsedBaseUrl.username.length > 0
    || parsedBaseUrl.password.length > 0
    || trimmedBaseUrl.includes("?")
    || trimmedBaseUrl.includes("#")
    || parsedBaseUrl.search.length > 0
    || parsedBaseUrl.hash.length > 0
  ) {
    throw frameworkError(
      "KINGDOM framework base URL is invalid.",
      "kingdom_framework_invalid_options",
      "Use an HTTP(S) URL without credentials, a query, or a fragment.",
    );
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  if (
    typeof timeout !== "number"
    || !Number.isFinite(timeout)
    || timeout <= 0
    || timeout > 300
  ) {
    throw frameworkError(
      "KINGDOM framework timeout is invalid.",
      "kingdom_framework_invalid_options",
      "Use a finite timeout greater than 0 and no more than 300 seconds.",
    );
  }

  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(maxResponseBytes)
    || maxResponseBytes < MIN_RESPONSE_BYTES
    || maxResponseBytes > MAX_RESPONSE_BYTES
  ) {
    throw frameworkError(
      "KINGDOM framework response limit is invalid.",
      "kingdom_framework_invalid_options",
      `Use an integer maxResponseBytes between ${MIN_RESPONSE_BYTES} and ${MAX_RESPONSE_BYTES}.`,
    );
  }

  return {
    baseUrl: trimmedBaseUrl.replace(/\/+$/u, ""),
    timeoutMs: Math.ceil(timeout * 1000),
    maxResponseBytes,
  };
}

function isJsonMediaType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const essence = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    essence === "application/json"
    || /^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(essence)
  );
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup failure must not replace the deterministic protocol error.
  }
}

async function readBoundedBytes(
  response: Response,
  maximumBytes: number,
  timeoutSignal?: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
      await cancelBody(response);
      throw frameworkError(
        "KINGDOM framework response has an invalid Content-Length header.",
        "kingdom_framework_invalid_response",
        "Use a conforming AgentTool public framework endpoint.",
        { status: response.status },
      );
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      await cancelBody(response);
      throw frameworkError(
        "KINGDOM framework response has an invalid Content-Length header.",
        "kingdom_framework_invalid_response",
        "Use a conforming AgentTool public framework endpoint.",
        { status: response.status },
      );
    }
    if (declaredBytes > maximumBytes) {
      await cancelBody(response);
      throw frameworkError(
        "KINGDOM framework response exceeded the configured limit.",
        "kingdom_framework_response_too_large",
        "Use the bounded public card endpoint or raise maxResponseBytes deliberately.",
        { status: response.status },
      );
    }
  }

  if (response.body === null) return new Uint8Array();

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    throw frameworkError(
      "KINGDOM framework response body could not be read.",
      "kingdom_framework_invalid_response",
      "Use a conforming AgentTool public framework endpoint.",
      { status: response.status },
    );
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size error remains the useful deterministic outcome.
        }
        throw frameworkError(
          "KINGDOM framework response exceeded the configured limit.",
          "kingdom_framework_response_too_large",
          "Use the bounded public card endpoint or raise maxResponseBytes deliberately.",
          { status: response.status },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    if (timeoutSignal?.aborted) {
      throw frameworkError(
        "KINGDOM framework endpoint is unreachable.",
        "kingdom_framework_unreachable",
        "Check the configured AgentTool API origin and timeout.",
      );
    }
    throw frameworkError(
      "KINGDOM framework response body could not be read.",
      "kingdom_framework_invalid_response",
      "Use a conforming AgentTool public framework endpoint.",
      { status: response.status },
    );
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw frameworkError(
      "KINGDOM framework response is not valid UTF-8.",
      "kingdom_framework_invalid_response",
      "Use an endpoint that returns the UTF-8 JSON card contract.",
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw frameworkError(
      "KINGDOM framework response is not valid JSON.",
      "kingdom_framework_invalid_response",
      "Use an endpoint that returns the JSON card contract.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumIncludes<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function codePointLength(value: string): number {
  return [...value].length;
}

function assertSafeString(
  value: unknown,
  field: string,
  maximumCharacters: number,
  pattern: RegExp,
): asserts value is string {
  if (
    typeof value !== "string"
    || codePointLength(value) < 1
    || codePointLength(value) > maximumCharacters
    || hasUnpairedSurrogate(value)
    || !pattern.test(value)
  ) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use an endpoint that returns an exact agenttool.kingdom.card/0.1 object.",
      { details: { field, reason: "invalid string" } },
    );
  }
}

function validateDependencyList(
  value: unknown,
  field: "dependsOn",
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use an endpoint that returns a bounded dependency list.",
      { details: { field, reason: "invalid array" } },
    );
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw frameworkError(
        "KINGDOM framework response does not match the card contract.",
        "kingdom_framework_invalid_response",
        "Use an endpoint that returns a dense dependency list.",
        { details: { field, reason: "sparse array" } },
      );
    }
    const entry = value[index];
    assertSafeString(entry, field, MAX_NAME_CHARACTERS, NAME_PATTERN);
    if (seen.has(entry)) {
      throw frameworkError(
        "KINGDOM framework response does not match the card contract.",
        "kingdom_framework_invalid_response",
        "Use an endpoint that returns unique dependency identifiers.",
        { details: { field, reason: "duplicate item" } },
      );
    }
    seen.add(entry);
  }
}

function validateAdoptionList(
  value: unknown,
  field: "adopts",
): asserts value is KingdomFrameworkAdoption[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use an endpoint that returns a bounded adoption list.",
      { details: { field, reason: "invalid array" } },
    );
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    if (
      !Object.hasOwn(value, index)
      || value[index] !== KINGDOM_FRAMEWORK_ADOPTION
    ) {
      throw frameworkError(
        "KINGDOM framework response does not match the card contract.",
        "kingdom_framework_invalid_response",
        "Use an endpoint whose adoption declarations match the card contract.",
        { details: { field, reason: "unsupported item" } },
      );
    }
    const entry = value[index];
    if (seen.has(entry)) {
      throw frameworkError(
        "KINGDOM framework response does not match the card contract.",
        "kingdom_framework_invalid_response",
        "Use an endpoint that returns unique adoption identifiers.",
        { details: { field, reason: "duplicate item" } },
      );
    }
    seen.add(entry);
  }
}

function validateCard(value: unknown): KingdomFrameworkCard {
  if (!isRecord(value)) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use an endpoint that returns one JSON card object.",
    );
  }

  const keys = Object.keys(value);
  if (
    keys.length !== CARD_FIELDS.length
    || keys.some((key) => !CARD_FIELD_SET.has(key))
    || CARD_FIELDS.some((field) => !Object.hasOwn(value, field))
  ) {
    throw frameworkError(
      "KINGDOM framework response does not match the closed card contract.",
      "kingdom_framework_invalid_response",
      "Return all ten required card fields and no additional properties.",
    );
  }

  if (value.schema_version !== KINGDOM_FRAMEWORK_CARD_SCHEMA_VERSION) {
    throw frameworkError(
      "KINGDOM framework response uses an unsupported card schema.",
      "kingdom_framework_invalid_response",
      `Return schema_version ${KINGDOM_FRAMEWORK_CARD_SCHEMA_VERSION}.`,
      { details: { field: "schema_version", reason: "unsupported value" } },
    );
  }
  assertSafeString(
    value.name,
    "name",
    MAX_NAME_CHARACTERS,
    NAME_PATTERN,
  );
  if (!enumIncludes(KINGDOM_KINDS, value.kind)) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use a supported KINGDOM project kind.",
      { details: { field: "kind", reason: "invalid enum" } },
    );
  }
  if (!enumIncludes(KINGDOM_LAYERS, value.layer)) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use a supported KINGDOM layer.",
      { details: { field: "layer", reason: "invalid enum" } },
    );
  }
  if (!enumIncludes(KINGDOM_OWNER_SISTERS, value.owner_sister)) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use a supported KINGDOM owner_sister value.",
      { details: { field: "owner_sister", reason: "invalid enum" } },
    );
  }
  if (!enumIncludes(KINGDOM_DOMAINS, value.domain)) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use a supported KINGDOM domain.",
      { details: { field: "domain", reason: "invalid enum" } },
    );
  }
  if (!enumIncludes(KINGDOM_STATES, value.state)) {
    throw frameworkError(
      "KINGDOM framework response does not match the card contract.",
      "kingdom_framework_invalid_response",
      "Use a supported KINGDOM state.",
      { details: { field: "state", reason: "invalid enum" } },
    );
  }
  assertSafeString(
    value.purpose,
    "purpose",
    MAX_PURPOSE_CHARACTERS,
    SAFE_PURPOSE_PATTERN,
  );
  validateDependencyList(value.dependsOn, "dependsOn");
  validateAdoptionList(value.adopts, "adopts");

  return Object.freeze({
    schema_version: KINGDOM_FRAMEWORK_CARD_SCHEMA_VERSION,
    name: value.name,
    kind: value.kind,
    layer: value.layer,
    owner_sister: value.owner_sister,
    domain: value.domain,
    state: value.state,
    purpose: value.purpose,
    dependsOn: Object.freeze([...value.dependsOn]),
    adopts: Object.freeze([...value.adopts]),
  });
}

/** Standalone client for `GET /public/kingdom/framework`. */
export class KingdomFrameworkClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: KingdomFrameworkOptions = {}) {
    const validated = validateOptions(options);
    this.baseUrl = validated.baseUrl;
    this.timeoutMs = validated.timeoutMs;
    this.maxResponseBytes = validated.maxResponseBytes;
  }

  /** Fetch and validate AgentTool's exact public KINGDOM project card. */
  async card(): Promise<KingdomFrameworkCard> {
    let response: Response;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    try {
      // This is intentionally not an HttpConfig request. The authenticated
      // AgentTool transport and its bearer cannot cross this public boundary.
      response = await globalThis.fetch(
        `${this.baseUrl}/public/kingdom/framework`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "manual",
          referrerPolicy: "no-referrer",
          signal: timeoutSignal,
        },
      );
    } catch {
      throw frameworkError(
        "KINGDOM framework endpoint is unreachable.",
        "kingdom_framework_unreachable",
        "Check the configured AgentTool API origin and timeout.",
      );
    }

    if (
      (response.status >= 300 && response.status < 400)
      || response.type === "opaqueredirect"
    ) {
      await cancelBody(response);
      throw frameworkError(
        "KINGDOM framework request refused an HTTP redirect.",
        "kingdom_framework_redirect_refused",
        "Use the canonical AgentTool API origin; public requests are never replayed across redirects.",
        { status: response.status || undefined },
      );
    }

    if (!response.ok) {
      await readBoundedBytes(
        response,
        this.maxResponseBytes,
        timeoutSignal,
      );
      throw frameworkError(
        `KINGDOM framework endpoint returned HTTP ${response.status}.`,
        "kingdom_framework_http_error",
        "Check the configured public framework endpoint and retry deliberately.",
        { status: response.status },
      );
    }

    if (!isJsonMediaType(response.headers.get("content-type"))) {
      await cancelBody(response);
      throw frameworkError(
        "KINGDOM framework response used an unsupported media type.",
        "kingdom_framework_unsupported_media_type",
        "Return application/json or an application/*+json media type.",
        { status: response.status },
      );
    }

    const bodyBytes = await readBoundedBytes(
      response,
      this.maxResponseBytes,
      timeoutSignal,
    );
    return validateCard(decodeJson(bodyBytes));
  }
}
