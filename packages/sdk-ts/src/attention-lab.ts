/** FOMOengine 嘅獨立 public client；只傳 caller 明確選取嘅契約欄位。 */
import { Agent as DirectAgent, request as directRequest } from "undici/index.js";
import { AgentToolError } from "./errors.js";
import { BoundedJsonParser, hasUnpairedSurrogate } from "./_bounded-json.js";
import {
  validateAttentionInput,
  validateAttentionResult,
  type AttentionLabBriefInput,
  type AttentionLabBriefResult,
  type AttentionLabCatalogueResult,
  type AttentionLabComparisonInput,
  type AttentionLabComparisonResult,
} from "./_attention-lab-contract.js";

export type * from "./_attention-lab-contract.js";
export const ATTENTION_LAB_SCHEMA_VERSION = 1 as const;
export const ATTENTION_LAB_BASE_URL = "https://fomoengine.io";
export const ATTENTION_LAB_PATH = "/api/v1/attention-lab";
export const ATTENTION_LAB_MAX_REQUEST_BYTES = 64 * 1024;
export const ATTENTION_LAB_MAX_RESPONSE_BYTES = 512 * 1024;

export interface AttentionLabOptions {
  /** 獨立 HTTPS origin；唔繼承 AgentTool 嘅 baseUrl。 */
  baseUrl?: string;
  /** 整個 operation 嘅 deadline（秒）；預設及上限都係 10。 */
  timeout?: number;
  /** UTF-8 request bytes 上限；只可收窄預設 64 KiB。 */
  maxRequestBytes?: number;
  /** 實際 response stream bytes 上限；只可收窄預設 512 KiB。 */
  maxResponseBytes?: number;
  /** 只供明確本地測試，容許 localhost / 127.0.0.1 / [::1] HTTP。 */
  allowLoopbackHttp?: boolean;
}

interface Options {
  baseUrl: string;
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}
type Operation = "catalogue" | "briefs" | "comparisons";
const JSON_BOUNDS = { maxDepth: 32, maxStringCodePoints: 256 * 1024 };
const MESSAGES = {
  invalid_options: "Attention Lab 設定唔符合獨立 public origin 同資源上限。",
  invalid_request: "Attention Lab input 唔符合契約。",
  request_too_large: "Attention Lab request 超過 byte 上限。",
  unreachable: "暫時連唔到 Attention Lab。",
  timeout: "Attention Lab operation 已超時。",
  redirect_refused: "Attention Lab 唔會跟隨 HTTP redirect。",
  http_error: "Attention Lab endpoint 冇回傳 HTTP 200。",
  rate_limited: "Attention Lab 暫時限速；SDK 唔會自動重試。",
  unsupported_media_type: "Attention Lab response 必須係 UTF-8 application/json。",
  response_too_large: "Attention Lab response 超過 byte 上限。",
  invalid_response: "Attention Lab response 唔符合有界 JSON 契約。",
  unsupported_schema_version: "Attention Lab response 嘅 schemaVersion 暫未支援。",
} as const;
type ErrorKind = keyof typeof MESSAGES;

function failure(kind: ErrorKind, status?: number): AgentToolError {
  return new AgentToolError(MESSAGES[kind], {
    code: `attention_lab_${kind}`,
    status,
    hint: "核對明確 input、public origin 同契約；只喺 caller 決定後先再呼叫。",
    docs: "https://fomoengine.io/methodology",
  });
}

function optionsOf(options: AttentionLabOptions): Options {
  if (typeof options !== "object" || options === null || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype
    || Reflect.ownKeys(options).some((key) => typeof key !== "string"
      || !["baseUrl", "timeout", "maxRequestBytes", "maxResponseBytes", "allowLoopbackHttp"].includes(key)
      || !("value" in Object.getOwnPropertyDescriptor(options, key)!))) {
    throw failure("invalid_options");
  }
  const baseUrl = options.baseUrl === undefined ? ATTENTION_LAB_BASE_URL : options.baseUrl;
  if (typeof baseUrl !== "string" || hasUnpairedSurrogate(baseUrl)
    || !/^https?:\/\/[^/?#\\\s]+\/?$/u.test(baseUrl) || baseUrl.includes("@")) {
    throw failure("invalid_options");
  }
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw failure("invalid_options"); }
  const loopback = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?$/u.test(baseUrl);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
    || (parsed.protocol !== "https:" && !(options.allowLoopbackHttp === true && loopback))
    || (options.allowLoopbackHttp !== undefined && typeof options.allowLoopbackHttp !== "boolean")) {
    throw failure("invalid_options");
  }
  const timeout = options.timeout === undefined ? 10 : options.timeout;
  const maxRequestBytes = options.maxRequestBytes === undefined ? ATTENTION_LAB_MAX_REQUEST_BYTES : options.maxRequestBytes;
  const maxResponseBytes = options.maxResponseBytes === undefined ? ATTENTION_LAB_MAX_RESPONSE_BYTES : options.maxResponseBytes;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > 10
    || !Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > ATTENTION_LAB_MAX_REQUEST_BYTES
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > ATTENTION_LAB_MAX_RESPONSE_BYTES) {
    throw failure("invalid_options");
  }
  return { baseUrl: parsed.origin, timeoutMs: Math.ceil(timeout * 1000), maxRequestBytes, maxResponseBytes };
}

/** 唔用 caller getters / toJSON；byte budget 喺組裝期間已生效。 */
function encodeInput(input: unknown, maxBytes: number): string {
  const chunks: string[] = [];
  let bytes = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const append = (text: string) => {
    bytes += new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) throw failure("request_too_large");
    chunks.push(text);
  };
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > maxBytes || depth > JSON_BOUNDS.maxDepth) throw failure("invalid_request");
    if (typeof value === "string") {
      if (value.length > maxBytes) throw failure("request_too_large");
      if (hasUnpairedSurrogate(value)) throw failure("invalid_request");
      append(JSON.stringify(value));
    } else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value))) {
      append(JSON.stringify(value));
    } else if (typeof value === "object" && value !== null) {
      if (seen.has(value)) throw failure("invalid_request");
      seen.add(value);
      const isArray = Array.isArray(value);
      const proto = Object.getPrototypeOf(value);
      if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw failure("invalid_request");
      const keys = Reflect.ownKeys(value);
      if (isArray && keys.length !== (value as unknown[]).length + 1) throw failure("invalid_request");
      append(isArray ? "[" : "{");
      let index = 0;
      for (const key of keys) {
        if (isArray && key === "length") continue;
        if (typeof key !== "string" || hasUnpairedSurrogate(key)) throw failure("invalid_request");
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!("value" in descriptor) || !descriptor.enumerable || (isArray && key !== String(index))) throw failure("invalid_request");
        if (index++ > 0) append(",");
        if (!isArray) { append(JSON.stringify(key)); append(":"); }
        visit(descriptor.value, depth + 1);
      }
      append(isArray ? "]" : "}");
      seen.delete(value);
    } else {
      throw failure("invalid_request");
    }
  };
  try { visit(input, 1); } catch (error) {
    if (error instanceof AgentToolError) throw error;
    throw failure("invalid_request");
  }
  return chunks.join("");
}

/** 所有 public operations 都係一次 direct request，唔經 authenticated HttpConfig。 */
export class AttentionLabClient {
  private readonly options: Options;

  constructor(options: AttentionLabOptions = {}) {
    try { this.options = optionsOf(options); } catch { throw failure("invalid_options"); }
  }

  async catalogue(): Promise<AttentionLabCatalogueResult> {
    return this.perform("catalogue") as Promise<AttentionLabCatalogueResult>;
  }

  async buildBrief(input: AttentionLabBriefInput): Promise<AttentionLabBriefResult> {
    return this.perform("briefs", input) as Promise<AttentionLabBriefResult>;
  }

  async compare(input: AttentionLabComparisonInput): Promise<AttentionLabComparisonResult> {
    return this.perform("comparisons", input) as Promise<AttentionLabComparisonResult>;
  }

  private async perform(operation: Operation, input?: unknown): Promise<unknown> {
    const deadline = performance.now() + this.options.timeoutMs;
    const controller = new AbortController();
    let dispatcher: DirectAgent | undefined;
    let response: Awaited<ReturnType<typeof directRequest>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkTime = () => {
      if (performance.now() >= deadline || controller.signal.aborted) throw failure("timeout");
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(failure("timeout"));
        controller.abort();
      }, this.options.timeoutMs);
    });
    const work = async (): Promise<unknown> => {
      let body: string | undefined;
      if (operation !== "catalogue") {
        body = encodeInput(input, this.options.maxRequestBytes);
        try { validateAttentionInput(operation, JSON.parse(body)); } catch { throw failure("invalid_request"); }
      }
      checkTime();
      // 明確 package dispatcher，唔讀 Bun 嘅 ambient proxy 或 global fetch。
      dispatcher = new DirectAgent({ connections: 1, pipelining: 0 });
      try {
        const request = new Request(`${this.options.baseUrl}${ATTENTION_LAB_PATH}/${operation}`, {
          method: operation === "catalogue" ? "GET" : "POST",
          headers: body === undefined
            ? { Accept: "application/json", "Accept-Encoding": "identity" }
            : { Accept: "application/json", "Accept-Encoding": "identity", "Content-Type": "application/json" },
          body,
          cache: "no-store",
          credentials: "omit",
          redirect: "manual",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        // 用同一份 public Request 嘅明確 headers；directRequest 冇 ambient cookie jar，
        // 冇 redirect interceptor，所以 3xx 直接交畀下方拒絕；唔加 Referer。
        // 同 LOVE reader 一樣避開 Bun 嘅 fetch stream shim。
        const headers: Record<string, string> = {};
        request.headers.forEach((value, name) => { headers[name] = value; });
        response = await directRequest(request.url, {
          method: operation === "catalogue" ? "GET" : "POST",
          headers,
          body,
          signal: controller.signal,
          dispatcher,
        });
      } catch {
        checkTime();
        throw failure("unreachable");
      }
      checkTime();
      const status = response.statusCode;
      const header = (name: string): string | null => {
        const value = response!.headers[name];
        return Array.isArray(value) ? value.join(", ") : value ?? null;
      };
      if (status >= 300 && status < 400) throw failure("redirect_refused", status);
      if (status !== 200) throw failure(status === 429 ? "rate_limited" : "http_error", status);
      if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/iu.test(header("content-type")?.trim() ?? "")) {
        throw failure("unsupported_media_type", status);
      }
      const encoding = header("content-encoding");
      if (encoding !== null && encoding.trim().toLowerCase() !== "identity") throw failure("invalid_response", status);
      const declared = header("content-length");
      if (declared !== null) {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || !Number.isSafeInteger(Number(declared))) throw failure("invalid_response", status);
        if (Number(declared) > this.options.maxResponseBytes) throw failure("response_too_large", status);
      }
      if (!response.body) throw failure("invalid_response", status);
      const chunks: Uint8Array[] = [];
      let size = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      while (true) {
        const { done, value } = await iterator.next();
        checkTime();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw failure("invalid_response", status);
        size += value.byteLength;
        if (size > this.options.maxResponseBytes) throw failure("response_too_large", status);
        chunks.push(value);
      }
      if (declared !== null && Number(declared) !== size) throw failure("invalid_response", status);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let envelope: unknown;
      try {
        if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error();
        // 每個 JSON value node 至少佔一個 UTF-8 byte；由 byte ceiling 推導，
        // 唔會用另一個任意 node quota 拒絕仍然符合 512 KiB 契約嘅 dense catalogue。
        envelope = new BoundedJsonParser(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
          ...JSON_BOUNDS, maxNodes: this.options.maxResponseBytes,
        }).parse();
      } catch { throw failure("invalid_response", status); }
      if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)
        || Object.keys(envelope).length !== 2 || !("success" in envelope) || envelope.success !== true || !("data" in envelope)) {
        throw failure("invalid_response", status);
      }
      const data = envelope.data;
      if (typeof data === "object" && data !== null && "schemaVersion" in data && data.schemaVersion !== 1) {
        throw failure("unsupported_schema_version", status);
      }
      try { validateAttentionResult(operation, data); } catch { throw failure("invalid_response", status); }
      checkTime();
      return data;
    };
    try {
      return await Promise.race([work(), timeout]);
    } catch (error) {
      if (error instanceof AgentToolError) throw error;
      checkTime();
      throw failure(response ? "invalid_response" : "unreachable", response?.statusCode);
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Cleanup 唔可以延長 whole-operation deadline，亦唔反映底層 diagnostics。
      try { response?.body.on("error", () => undefined); response?.body.destroy(); } catch { /* 保留原 error。 */ }
      try { void dispatcher?.destroy().catch(() => undefined); } catch { /* 保留原 error。 */ }
    }
  }
}
