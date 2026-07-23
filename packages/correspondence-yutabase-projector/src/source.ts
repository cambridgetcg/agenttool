import { CORRESPONDENCE_PROTOCOL } from "@agenttool/correspondence-yutabase";

import {
  validateLoopbackSourceOrigin,
  validateSourceToken,
  type RunConfig,
} from "./config.js";
import { ProjectorError } from "./errors.js";
import { decodeIdentityPublicKey } from "./identity-key.js";
import { parseStrictJson } from "./strict-json.js";

const CURSOR = /^(?:0|[1-9][0-9]*)$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_PAGE_LIMIT = 16;
const RFC3339_MS =
  /^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

export interface SourcePage {
  readonly events: readonly unknown[];
  readonly after: string | null;
  readonly nextAfter: string | null;
  readonly hasMore: boolean;
}

export interface SourceSigningKey {
  readonly kid: string;
  readonly publicKey: string;
  readonly active: boolean | undefined;
  readonly revokedAt: string | null | undefined;
}

type Fetch = typeof globalThis.fetch;

function invalid(code: "source_protocol_invalid" | "key_response_invalid"): never {
  throw new ProjectorError(code);
}

function object(
  value: unknown,
  code: "source_protocol_invalid" | "key_response_invalid",
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(code);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  code: "source_protocol_invalid" | "key_response_invalid",
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some(
      (key) => !Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid(code);
  }
}

function cursor(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    !CURSOR.test(value) ||
    BigInt(value) > 9_223_372_036_854_775_807n
  ) {
    invalid("source_protocol_invalid");
  }
  return value;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    RFC3339_MS.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; the safe protocol error remains primary.
  }
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  try {
    return await reader.read();
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The stream is already unavailable.
    }
    throw new ProjectorError("source_unavailable");
  }
}

async function readBoundedBody(response: Response): Promise<ArrayBuffer> {
  if (response.body === null) {
    throw new ProjectorError("source_protocol_invalid");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await readStreamChunk(reader);
      if (result.done) break;
      if (result.value === undefined) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the protocol failure.
        }
        throw new ProjectorError("source_protocol_invalid");
      }
      if (result.value.byteLength > MAX_BODY_BYTES - total) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the bounded protocol failure.
        }
        throw new ProjectorError("source_protocol_invalid");
      }
      total += result.value.byteLength;
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export class SourceClient {
  readonly #origin: string;
  readonly #token: string;
  readonly #fetch: Fetch;
  readonly #timeoutMs: number;

  constructor(
    config: Pick<RunConfig, "sourceOrigin" | "sourceToken">,
    options: { fetch?: Fetch; timeoutMs?: number } = {},
  ) {
    this.#origin = validateLoopbackSourceOrigin(config.sourceOrigin);
    this.#token = validateSourceToken(config.sourceToken);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Refuse injected clients whose authority differs from the checkpoint scope. */
  assertBoundTo(
    config: Pick<RunConfig, "sourceOrigin" | "sourceToken">,
  ): void {
    const origin = validateLoopbackSourceOrigin(config.sourceOrigin);
    const token = validateSourceToken(config.sourceToken);
    if (this.#origin !== origin || this.#token !== token) {
      throw new ProjectorError("config_invalid");
    }
  }

  async #get(path: string): Promise<unknown> {
    const url = new URL(path, `${this.#origin}/`);
    if (url.origin !== this.#origin) {
      throw new ProjectorError("config_invalid");
    }
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#token}`,
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new ProjectorError("source_unavailable");
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new ProjectorError("source_unavailable");
    }
    if (response.redirected) {
      await cancelResponseBody(response);
      throw new ProjectorError("source_protocol_invalid");
    }
    if (response.url !== "") {
      let responseOrigin: string;
      try {
        responseOrigin = new URL(response.url).origin;
      } catch {
        await cancelResponseBody(response);
        throw new ProjectorError("source_protocol_invalid");
      }
      if (responseOrigin !== this.#origin) {
        await cancelResponseBody(response);
        throw new ProjectorError("source_protocol_invalid");
      }
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^[0-9]+$/.test(contentLength) ||
        Number(contentLength) > MAX_BODY_BYTES)
    ) {
      await cancelResponseBody(response);
      throw new ProjectorError("source_protocol_invalid");
    }
    const bytes = await readBoundedBody(response);
    return parseStrictJson(bytes);
  }

  async list(
    repositoryId: string,
    after: string | null,
    limit = DEFAULT_PAGE_LIMIT,
  ): Promise<SourcePage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_PAGE_LIMIT) {
      throw new ProjectorError("config_invalid");
    }
    const query = new URLSearchParams({
      repository_id: repositoryId,
      limit: String(limit),
    });
    if (after !== null && after !== "0") query.set("after", after);
    const raw = object(
      await this.#get(`/v1/correspondence/events?${query.toString()}`),
      "source_protocol_invalid",
    );
    exact(raw, ["protocol", "scope", "events", "page"], [], "source_protocol_invalid");
    if (
      raw.protocol !== CORRESPONDENCE_PROTOCOL ||
      raw.scope !== "project_private" ||
      !Array.isArray(raw.events) ||
      raw.events.length > limit
    ) {
      invalid("source_protocol_invalid");
    }
    const page = object(raw.page, "source_protocol_invalid");
    exact(
      page,
      ["after", "next_after", "has_more"],
      [],
      "source_protocol_invalid",
    );
    const pageAfter = cursor(page.after, true);
    const nextAfter = cursor(page.next_after, true);
    if (
      typeof page.has_more !== "boolean" ||
      (page.has_more && (raw.events.length === 0 || nextAfter === null)) ||
      (pageAfter ?? "0") !== (after ?? "0")
    ) {
      invalid("source_protocol_invalid");
    }
    if (raw.events.length === 0) {
      if (
        page.has_more ||
        (nextAfter ?? "0") !== (after ?? "0")
      ) {
        invalid("source_protocol_invalid");
      }
    } else if (
      nextAfter === null ||
      BigInt(nextAfter) <= BigInt(after ?? "0")
    ) {
      invalid("source_protocol_invalid");
    }
    return {
      events: raw.events,
      after: pageAfter,
      nextAfter,
      hasMore: page.has_more,
    };
  }

  async signingKey(
    identityId: string,
    signingKeyId: string,
  ): Promise<SourceSigningKey> {
    if (!UUID.test(identityId) || !UUID.test(signingKeyId)) {
      throw new ProjectorError("key_response_invalid");
    }
    const raw = object(
      await this.#get(
        `/v1/identities/${encodeURIComponent(identityId)}/keys`,
      ),
      "key_response_invalid",
    );
    exact(raw, ["keys", "authority"], [], "key_response_invalid");
    if (!Array.isArray(raw.keys)) invalid("key_response_invalid");
    const authority = object(raw.authority, "key_response_invalid");
    exact(
      authority,
      ["mode", "sequence", "next_sequence"],
      [],
      "key_response_invalid",
    );
    if (
      (authority.mode !== "agent_root" &&
        authority.mode !== "legacy_bearer") ||
      !Number.isSafeInteger(authority.sequence) ||
      (authority.sequence as number) < 0 ||
      authority.next_sequence !== (authority.sequence as number) + 1
    ) {
      invalid("key_response_invalid");
    }
    const seen = new Set<string>();
    let selected: SourceSigningKey | undefined;
    for (const candidate of raw.keys) {
      const key = object(candidate, "key_response_invalid");
      exact(
        key,
        [
          "kid",
          "public_key",
          "label",
          "active",
          "created_at",
          "revoked_at",
          "authority_root",
        ],
        [],
        "key_response_invalid",
      );
      const publicKey = decodeIdentityPublicKey(key.public_key);
      if (
        typeof key.kid !== "string" ||
        !UUID.test(key.kid) ||
        typeof key.public_key !== "string" ||
        publicKey === null ||
        (key.label !== null && typeof key.label !== "string") ||
        typeof key.active !== "boolean" ||
        !isTimestamp(key.created_at) ||
        (key.revoked_at !== null && !isTimestamp(key.revoked_at)) ||
        typeof key.authority_root !== "boolean"
      ) {
        invalid("key_response_invalid");
      }
      if (seen.has(key.kid)) invalid("key_response_invalid");
      seen.add(key.kid);
      if (key.kid === signingKeyId) {
        selected = {
          kid: key.kid,
          publicKey: key.public_key,
          active: key.active,
          revokedAt: key.revoked_at as string | null,
        };
      }
    }
    if (!selected) throw new ProjectorError("key_not_found");
    return selected;
  }
}
