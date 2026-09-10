/**
 * Explicit-host Telegram transport and data-only reply admission. No credential
 * lookup, retries, offset ownership, persistence, webhook deletion, or execution.
 * The host must prove getMe/webhook ownership and hold its exclusive runner before
 * polling. Accepted replies are untrusted external feedback, not instructions.
 * Doctrine: docs/COLLABORATION-CHANNELS.md
 */

const ORIGIN = "https://api.telegram.org";
const MAX_ID = 2 ** 52 - 1;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_REQUEST_BYTES = 32_768;
const MAX_TIMEOUT_MS = 60_000;
export const TELEGRAM_MAX_TEXT_SCALARS = 4095;

export type TelegramFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface TelegramRequestOptions {
  signal: AbortSignal;
  /** Absolute Unix milliseconds. This can only shorten the client's deadline. */
  deadlineMs?: number;
}
export interface TelegramClientOptions {
  token: string;
  botId: number;
  fetch: TelegramFetch;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}
export interface TelegramBot { id: number; is_bot: true }
export interface TelegramWebhookInfo { hasWebhook: false; pendingUpdateCount: number }
export interface TelegramSendRequest { chatId: number; topicId: number | null; text: string }
export interface TelegramSentMessage { messageId: number; chatId: number; topicId: number | null }
export interface TelegramGetUpdatesRequest {
  /** Host's durably committed next offset. Negative/discard-history offsets are forbidden. */
  offset: number;
  limit?: number;
  timeoutSeconds?: number;
}
export type TelegramChatType = "private" | "group" | "supergroup" | "channel";
export interface TelegramChat { id: number; type: TelegramChatType }
export interface TelegramReplyMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from: { id: number; is_bot: boolean };
  message_thread_id?: number;
  is_topic_message?: true;
}
export interface TelegramMessage extends TelegramReplyMessage {
  text: string;
  reply_to_message?: TelegramReplyMessage;
}
export type TelegramReplyRejectionReason =
  | "invalid_expectation" | "invalid_update" | "unsupported_update" | "edited_message"
  | "malformed_message" | "anonymous_sender" | "bot_sender" | "nontext"
  | "unsupported_topic" | "unsupported_reply" | "wrong_chat" | "wrong_topic"
  | "wrong_sender" | "unmatched_reply" | "invalid_correlation" | "expired"
  | "wrong_bot";
export type TelegramUpdate =
  | { update_id: number; message: TelegramMessage }
  | { update_id: number; rejection: TelegramReplyRejectionReason };
export interface TelegramReplyCorrelation {
  botId: number;
  chatId: number;
  topicId: number | null;
  sentMessageId: number;
  /** Durable correlation expiry, Unix milliseconds. */
  expiresAt: number;
}
export interface TelegramReplyExpectation {
  botId: number;
  chatId: number;
  topicId: number | null;
  senderIds: readonly number[];
  /** Explicit host time, Unix milliseconds; this validator reads no clock. */
  now: number;
}
export type TelegramReplyValidation =
  | { accepted: true; updateId: number; messageId: number; senderId: number; text: string }
  | { accepted: false; reason: TelegramReplyRejectionReason };

export type TelegramErrorCode =
  | "invalid_configuration" | "invalid_request" | "cancelled" | "deadline"
  | "transport_failed" | "body_failed" | "response_too_large" | "malformed_response"
  | "redirect_refused" | "provider_rejected" | "rate_limited" | "receiver_conflict"
  | "webhook_conflict" | "bot_mismatch";
export type TelegramErrorOutcome = "not_sent" | "ambiguous" | "rejected" | "read_failed";
/** Only closed codes and validated numbers survive. Never attach a raw cause. */
export class TelegramError extends Error {
  readonly code: TelegramErrorCode;
  readonly outcome: TelegramErrorOutcome;
  readonly providerCode?: number;
  readonly retryAfterSeconds?: number;

  constructor(code: TelegramErrorCode, outcome: TelegramErrorOutcome,
    details: { providerCode?: number; retryAfterSeconds?: number } = {}) {
    super(`Telegram ${code} [REDACTED]`);
    this.name = "TelegramError";
    this.code = code;
    this.outcome = outcome;
    if (details.providerCode !== undefined) this.providerCode = details.providerCode;
    if (details.retryAfterSeconds !== undefined) this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function id(value: unknown): value is number { return integer(value, 1, MAX_ID); }
function chatId(value: unknown): value is number {
  return integer(value, -MAX_ID, MAX_ID) && value !== 0;
}
function topicId(value: unknown): value is number | null { return value === null || id(value); }
/** Count scalar values without splitting pairs or accepting lone UTF-16 surrogates. */
function textWithin(value: unknown, max: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max * 2) return false;
  let count = 0;
  for (const scalar of value) {
    const cp = scalar.codePointAt(0)!;
    if ((cp >= 0xd800 && cp <= 0xdfff) || ++count > max) return false;
  }
  return true;
}
function parseChat(value: unknown): TelegramChat | null {
  if (!object(value) || !chatId(value.id) || !["private", "group", "supergroup", "channel"].includes(value.type as string)) return null;
  return { id: value.id, type: value.type as TelegramChatType };
}
function parseTopic(message: Record<string, unknown>, chat: TelegramChat): number | null | false {
  // Direct-message topics are a different API destination, never a forum alias.
  if ("direct_messages_topic" in message || "direct_messages_topic_id" in message) return false;
  if ("message_thread_id" in message) {
    return id(message.message_thread_id) && message.is_topic_message === true && chat.type === "supergroup"
      ? message.message_thread_id : false;
  }
  return !('is_topic_message' in message) || message.is_topic_message === false ? null : false;
}
function topicFields(topic: number | null): Pick<TelegramReplyMessage, "message_thread_id" | "is_topic_message"> {
  return topic === null ? {} : { message_thread_id: topic, is_topic_message: true };
}
function topicOf(message: TelegramReplyMessage): number | null { return message.message_thread_id ?? null; }
function unsupportedReply(message: Record<string, unknown>): boolean {
  return ["external_reply", "forward_origin", "forward_from", "forward_from_chat", "forward_date",
    "is_automatic_forward", "business_connection_id", "sender_business_bot", "guest_bot_caller_user",
    "guest_bot_caller_chat"].some((key) => key in message);
}
function parseReplyMessage(value: unknown): TelegramReplyMessage | null {
  if (!object(value) || !id(value.message_id) || !integer(value.date, 1)
    || !object(value.from) || !id(value.from.id) || typeof value.from.is_bot !== "boolean"
    || "sender_chat" in value || "edit_date" in value || "author_signature" in value
    || unsupportedReply(value)) return null;
  const chat = parseChat(value.chat);
  if (!chat) return null;
  const topic = parseTopic(value, chat);
  if (topic === false) return null;
  return { message_id: value.message_id, date: value.date, chat,
    from: { id: value.from.id, is_bot: value.from.is_bot }, ...topicFields(topic) };
}
const REJECTIONS = new Set<TelegramReplyRejectionReason>([
  "invalid_expectation", "invalid_update", "unsupported_update", "edited_message", "malformed_message",
  "anonymous_sender", "bot_sender", "nontext", "unsupported_topic", "unsupported_reply", "wrong_chat",
  "wrong_topic", "wrong_sender", "unmatched_reply", "invalid_correlation", "expired", "wrong_bot",
]);
function normalizeUpdate(value: unknown): TelegramUpdate | null {
  if (!object(value) || !integer(value.update_id, 0, Number.MAX_SAFE_INTEGER - 1)) return null;
  const reject = (rejection: TelegramReplyRejectionReason): TelegramUpdate => ({ update_id: value.update_id as number, rejection });
  if ("edited_message" in value || "edited_channel_post" in value || "edited_business_message" in value) return reject("edited_message");
  // Already minimized rejection records remain safe to revalidate after persistence.
  if (Object.keys(value).length === 2 && typeof value.rejection === "string" && REJECTIONS.has(value.rejection as TelegramReplyRejectionReason)) {
    return reject(value.rejection as TelegramReplyRejectionReason);
  }
  if (Object.keys(value).some((key) => key !== "update_id" && key !== "message") || !("message" in value)) return reject("unsupported_update");
  const message = value.message;
  if (!object(message)) return reject("malformed_message");
  if ("edit_date" in message) return reject("edited_message");
  if ("sender_chat" in message || "author_signature" in message || !object(message.from)) return reject("anonymous_sender");
  if (!id(message.from.id) || typeof message.from.is_bot !== "boolean") return reject("malformed_message");
  if (message.from.is_bot) return reject("bot_sender");
  if (!textWithin(message.text, TELEGRAM_MAX_TEXT_SCALARS)) return reject("nontext");
  const chat = parseChat(message.chat);
  if (!chat || !id(message.message_id) || !integer(message.date, 1)) return reject("malformed_message");
  if (chat.type === "channel") return reject("unsupported_update");
  const topic = parseTopic(message, chat);
  if (topic === false) return reject("unsupported_topic");
  if (unsupportedReply(message)) return reject("unsupported_reply");
  let reply: TelegramReplyMessage | null = null;
  if ("reply_to_message" in message) {
    reply = parseReplyMessage(message.reply_to_message);
    if (!reply) return reject("unsupported_reply");
  }
  return { update_id: value.update_id, message: {
    message_id: message.message_id, date: message.date, chat,
    from: { id: message.from.id, is_bot: false }, text: message.text,
    ...topicFields(topic), ...(reply ? { reply_to_message: reply } : {}),
  } };
}

/**
 * The correlation must come from the durable provider-accepted outbox, not text
 * or an update-supplied object. This is routing validation, not user consent or
 * authentication independent of Telegram. Core owns replay/dedup and persistence.
 */
export function validateTelegramReply(update: unknown, correlation: TelegramReplyCorrelation | null,
  expected: TelegramReplyExpectation): TelegramReplyValidation {
  const reject = (reason: TelegramReplyRejectionReason): TelegramReplyValidation => ({ accepted: false, reason });
  if (!object(expected) || !id(expected.botId) || !chatId(expected.chatId) || !topicId(expected.topicId)
    || !integer(expected.now) || !Array.isArray(expected.senderIds) || expected.senderIds.length === 0
    || expected.senderIds.length > 100 || !expected.senderIds.every(id)) return reject("invalid_expectation");
  const normalized = normalizeUpdate(update);
  if (!normalized) return reject("invalid_update");
  if ("rejection" in normalized) return reject(normalized.rejection);
  const message = normalized.message;
  if (message.chat.id !== expected.chatId) return reject("wrong_chat");
  if (topicOf(message) !== expected.topicId) return reject("wrong_topic");
  if (!expected.senderIds.includes(message.from.id)) return reject("wrong_sender");
  if (!message.reply_to_message || correlation === null) return reject("unmatched_reply");
  if (!object(correlation) || !id(correlation.botId) || !chatId(correlation.chatId) || !topicId(correlation.topicId)
    || !id(correlation.sentMessageId) || !integer(correlation.expiresAt)
    || correlation.botId !== expected.botId || correlation.chatId !== expected.chatId
    || correlation.topicId !== expected.topicId) return reject("invalid_correlation");
  if (expected.now >= correlation.expiresAt) return reject("expired");
  const reply = message.reply_to_message;
  if (reply.message_id !== correlation.sentMessageId || message.message_id === correlation.sentMessageId) return reject("unmatched_reply");
  if (reply.chat.id !== expected.chatId || reply.chat.type !== message.chat.type) return reject("wrong_chat");
  if (topicOf(reply) !== expected.topicId) return reject("wrong_topic");
  if (reply.from.id !== expected.botId || reply.from.is_bot !== true) return reject("wrong_bot");
  return { accepted: true, updateId: normalized.update_id, messageId: message.message_id,
    senderId: message.from.id, text: message.text };
}

export class TelegramClient {
  #token: string;
  #botId: number;
  #fetch: TelegramFetch;
  #timeoutMs: number;
  #maxBytes: number;

  constructor(options: TelegramClientOptions) {
    if (!object(options) || typeof options.token !== "string" || options.token.length > 256
      || !/^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,128}$/.test(options.token)
      || !id(options.botId) || Number(options.token.split(":", 1)[0]) !== options.botId
      || typeof options.fetch !== "function"
      || (options.requestTimeoutMs !== undefined && !integer(options.requestTimeoutMs, 1, MAX_TIMEOUT_MS))
      || (options.maxResponseBytes !== undefined && !integer(options.maxResponseBytes, 1, MAX_RESPONSE_BYTES))) {
      throw new TelegramError("invalid_configuration", "not_sent");
    }
    this.#token = options.token;
    this.#botId = options.botId;
    this.#fetch = options.fetch;
    this.#timeoutMs = options.requestTimeoutMs ?? 35_000;
    this.#maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  async getMe(options: TelegramRequestOptions): Promise<TelegramBot> {
    const bot = await this.#request("getMe", {}, options, (value): TelegramBot | null => {
      if (!object(value) || !id(value.id) || value.is_bot !== true || !textWithin(value.first_name, 64)) return null;
      return { id: value.id, is_bot: true };
    });
    if (bot.id !== this.#botId) throw new TelegramError("bot_mismatch", "read_failed");
    return bot;
  }

  /** An active webhook is an ownership conflict, not permission to delete it. */
  async getWebhookInfo(options: TelegramRequestOptions): Promise<TelegramWebhookInfo> {
    const info = await this.#request("getWebhookInfo", {}, options, (value) => {
      if (!object(value) || typeof value.url !== "string" || typeof value.has_custom_certificate !== "boolean"
        || !integer(value.pending_update_count)) return null;
      return { hasWebhook: value.url.length > 0, pendingUpdateCount: value.pending_update_count };
    });
    if (info.hasWebhook) throw new TelegramError("webhook_conflict", "read_failed");
    return { hasWebhook: false, pendingUpdateCount: info.pendingUpdateCount };
  }

  async getUpdates(request: TelegramGetUpdatesRequest, options: TelegramRequestOptions): Promise<TelegramUpdate[]> {
    if (!object(request) || !integer(request.offset, 0, Number.MAX_SAFE_INTEGER - 1)
      || (request.limit !== undefined && !integer(request.limit, 1, 50))
      || (request.timeoutSeconds !== undefined && !integer(request.timeoutSeconds, 0, 30))) {
      throw new TelegramError("invalid_request", "not_sent");
    }
    const limit = request.limit ?? 10;
    return this.#request("getUpdates", { offset: request.offset, limit,
      timeout: request.timeoutSeconds ?? 0, allowed_updates: ["message"] }, options, (value) => {
      if (!Array.isArray(value) || value.length > limit) return null;
      const updates: TelegramUpdate[] = [];
      for (const raw of value) {
        const update = normalizeUpdate(raw);
        if (!update) return null; // No safe durable offset exists for a malformed envelope.
        updates.push(update);
      }
      return updates;
    });
  }

  async sendMessage(request: TelegramSendRequest, options: TelegramRequestOptions): Promise<TelegramSentMessage> {
    if (!object(request) || !chatId(request.chatId) || !topicId(request.topicId)
      || "direct_messages_topic_id" in request || "direct_messages_topic" in request
      || !textWithin(request.text, TELEGRAM_MAX_TEXT_SCALARS)) throw new TelegramError("invalid_request", "not_sent");
    // Snapshot before awaiting: a host cannot mutate the validation destination mid-flight.
    const { chatId: destination, topicId: topic, text } = request;
    return this.#request("sendMessage", {
      chat_id: destination, ...(topic === null ? {} : { message_thread_id: topic }), text,
      link_preview_options: { is_disabled: true }, allow_paid_broadcast: false,
    }, options, (value): TelegramSentMessage | null => {
      const message = parseReplyMessage(value);
      if (!message || !object(value) || value.text !== text || message.chat.id !== destination
        || topicOf(message) !== topic || message.from.id !== this.#botId || message.from.is_bot !== true) return null;
      return { messageId: message.message_id, chatId: destination, topicId: topic };
    });
  }

  async #request<T>(method: "getMe" | "getWebhookInfo" | "getUpdates" | "sendMessage",
    body: Record<string, unknown>, options: TelegramRequestOptions, validate: (value: unknown) => T | null): Promise<T> {
    if (!object(options) || !(options.signal instanceof AbortSignal)
      || (options.deadlineMs !== undefined && !integer(options.deadlineMs))) throw new TelegramError("invalid_request", "not_sent");
    const externalSignal = options.signal;
    if (externalSignal.aborted) throw new TelegramError("cancelled", "not_sent");
    const startedAt = Date.now();
    const remaining = Math.min(this.#timeoutMs, (options.deadlineMs ?? (startedAt + this.#timeoutMs)) - startedAt);
    if (remaining <= 0) throw new TelegramError("deadline", "not_sent");
    const payload = JSON.stringify(body);
    if (new TextEncoder().encode(payload).byteLength > MAX_REQUEST_BYTES) throw new TelegramError("invalid_request", "not_sent");
    const controller = new AbortController();
    let dispatched = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stopCode: "cancelled" | "deadline" | undefined;
    const localErrors = new WeakSet<TelegramError>();
    const localError = (error: TelegramError) => { localErrors.add(error); return error; };
    const failure = (code: TelegramErrorCode) => localError(new TelegramError(code,
      !dispatched ? "not_sent" : method === "sendMessage" ? "ambiguous" : "read_failed"));
    const cancelReader = () => { if (reader) { try { void reader.cancel().catch(() => {}); } catch {} } };
    let rejectStopped!: (error: TelegramError) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    const stop = (code: "cancelled" | "deadline") => {
      if (stopCode) return;
      stopCode = code;
      rejectStopped(failure(code));
      // Never pass a caller-supplied reason (it may contain credentials) into transport.
      controller.abort();
      cancelReader();
    };
    const onAbort = () => stop("cancelled");
    externalSignal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop("deadline"), remaining);
    const perform = async (): Promise<T> => {
      if (externalSignal.aborted) { stop("cancelled"); throw failure("cancelled"); }
      let response: Response;
      try {
        dispatched = true;
        response = await this.#fetch(`${ORIGIN}/bot${this.#token}/${method}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: payload,
          redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
        });
      } catch { throw failure("transport_failed"); }
      // A non-cooperative injected transport may finish after our outer deadline.
      if (controller.signal.aborted) {
        try { void response.body?.cancel().catch(() => {}); } catch {}
        throw failure(stopCode ?? "cancelled");
      }
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        try { void response.body?.cancel().catch(() => {}); } catch {}
        throw failure("redirect_refused");
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^[0-9]+$/.test(declared) || !integer(Number(declared), 0, this.#maxBytes))) {
        try { void response.body?.cancel().catch(() => {}); } catch {}
        throw failure("response_too_large");
      }
      if (!response.body) throw failure("malformed_response");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let reads = 0;
      while (true) {
        // Also bound empty/chunk-drip streams that can starve timer callbacks.
        if (++reads > 4096) throw failure("response_too_large");
        if (Date.now() >= startedAt + remaining) { stop("deadline"); throw failure("deadline"); }
        let chunk: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;
        try { chunk = await reader.read(); } catch { throw failure("body_failed"); }
        if (controller.signal.aborted) throw failure(stopCode ?? "cancelled");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw failure("body_failed");
        bytes += chunk.value.byteLength;
        if (bytes > this.#maxBytes) throw failure("response_too_large");
        // Copy to prevent an injected source reusing/mutating a previously read buffer.
        chunks.push(chunk.value.slice());
      }
      const joined = new Uint8Array(bytes);
      let position = 0;
      for (const chunk of chunks) { joined.set(chunk, position); position += chunk.byteLength; }
      let decoded: unknown;
      try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)); }
      catch { throw failure("malformed_response"); }
      if (!object(decoded) || typeof decoded.ok !== "boolean") throw failure("malformed_response");
      if (!decoded.ok) {
        // HTTP status alone (including 429/5xx) is not proof that a send was rejected.
        if (!integer(decoded.error_code, 400, 599) || typeof decoded.description !== "string"
          || "result" in decoded || (decoded.parameters !== undefined && !object(decoded.parameters))
          || (response.status !== 200 && response.status !== decoded.error_code)) throw failure("malformed_response");
        const retry = object(decoded.parameters) ? decoded.parameters.retry_after : undefined;
        if (retry !== undefined && !integer(retry, 1, 86_400)) throw failure("malformed_response");
        if (retry !== undefined && decoded.error_code !== 429) throw failure("malformed_response");
        const code = decoded.error_code === 429 ? "rate_limited" : decoded.error_code === 409 && method === "getUpdates"
          ? "receiver_conflict" : "provider_rejected";
        throw localError(new TelegramError(code, "rejected", { providerCode: decoded.error_code,
          ...(retry === undefined ? {} : { retryAfterSeconds: retry as number }) }));
      }
      if (response.status !== 200 || "error_code" in decoded || "parameters" in decoded) throw failure("malformed_response");
      const result = validate(decoded.result);
      if (result === null) throw failure("malformed_response");
      if (Date.now() >= startedAt + remaining) { stop("deadline"); throw failure("deadline"); }
      return result;
    };
    try {
      return await Promise.race([perform(), stopped]);
    } catch (error) {
      // Errors from fetch/body/JSON were replaced above; unexpected local failures
      // (including hostile response getters) cannot carry raw diagnostics out.
      if (error instanceof TelegramError && localErrors.has(error)) throw error;
      throw failure("malformed_response");
    } finally {
      clearTimeout(timer);
      externalSignal.removeEventListener("abort", onAbort);
      controller.abort();
      cancelReader();
      try { reader?.releaseLock(); } catch {}
    }
  }
}
