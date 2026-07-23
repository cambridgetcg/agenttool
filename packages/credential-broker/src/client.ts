import { randomBytes, randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { AgentCredError, type AgentCredErrorCode } from "./errors.js";
import { encodeFrame, FrameDecoder } from "./framing.js";
import {
  AGENTCRED_PROTOCOL,
  type BrokerHttpRequest,
  type BrokerHttpResponse,
  type GrantReceipt,
  type GrantRequest,
  type HttpMethod,
} from "./types.js";
import type { WireResponse } from "./wire.js";

interface PrivateGrant {
  capability: string;
  owner: AgentCredClient;
}

const privateGrants = new WeakMap<GrantHandle, PrivateGrant>();

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

/** Public grant metadata. The authority string is held only in module-private state. */
export class GrantHandle {
  readonly alias: string;
  readonly receipt: Readonly<GrantReceipt>;

  private constructor(alias: string, receipt: GrantReceipt) {
    this.alias = alias;
    this.receipt = deepFreeze(structuredClone(receipt));
    Object.freeze(this);
  }

  toJSON(): { alias: string; receipt: Readonly<GrantReceipt> } {
    return { alias: this.alias, receipt: this.receipt };
  }

  static _create(
    owner: AgentCredClient,
    alias: string,
    receipt: GrantReceipt,
    capability: string,
  ): GrantHandle {
    const handle = new GrantHandle(alias, receipt);
    privateGrants.set(handle, { capability, owner });
    return handle;
  }
}

interface Pending {
  seq: number;
  resolve: (response: WireResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SendWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface AgentCredClientOptions {
  socketPath: string;
  timeoutMs?: number;
  clientName?: string;
}

export type AgentCredFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Structural match for SDKs such as `@agenttool/sdk` AgentToolTransport. */
export interface AgentCredTransport {
  request: AgentCredFetch;
}

function responseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentCredError("protocol_error", "Broker returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function decodeHttpResult(payload: Record<string, unknown>): BrokerHttpResponse {
  if (
    !Number.isInteger(payload.status) ||
    typeof payload.bodyBase64 !== "string" ||
    typeof payload.auditId !== "string" ||
    !Number.isInteger(payload.redactions)
  ) {
    throw new AgentCredError("protocol_error", "Broker returned an invalid HTTP result.");
  }
  const headers = responseRecord(payload.headers);
  if (Object.values(headers).some((value) => typeof value !== "string")) {
    throw new AgentCredError("protocol_error", "Broker returned invalid response headers.");
  }
  return {
    status: payload.status as number,
    headers: headers as Record<string, string>,
    bodyBase64: payload.bodyBase64,
    auditId: payload.auditId,
    redactions: payload.redactions as number,
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** Reject locally on abort; the already-dispatched broker use still completes. */
function observeAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const claim = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = (): void => {
      if (claim()) reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        if (claim()) resolve(value);
      },
      (error) => {
        if (claim()) reject(error);
      },
    );
  });
}

export class AgentCredClient {
  readonly #options: AgentCredClientOptions;
  readonly #pending = new Map<string, Pending>();
  readonly #handles = new Set<GrantHandle>();
  readonly #sendWaiters: SendWaiter[] = [];
  #socket: Socket | undefined;
  #decoder: FrameDecoder | undefined;
  #seq = 0;
  #sessionId: string | undefined;
  #maxInFlight = 1;
  #activeSends = 0;

  constructor(options: AgentCredClientOptions) {
    this.#options = options;
  }

  get connected(): boolean {
    return Boolean(this.#socket && !this.#socket.destroyed && this.#sessionId);
  }

  async connect(): Promise<void> {
    if (this.#socket) throw new AgentCredError("invalid_request", "Broker client is already connected.");
    this.#seq = 0;
    const socket = createConnection(this.#options.socketPath);
    this.#socket = socket;
    const decoder = new FrameDecoder((value) => {
      if (this.#socket === socket) this.#receive(value);
    });
    this.#decoder = decoder;
    socket.on("data", (chunk) => {
      try {
        decoder.push(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.once("close", () => {
      if (this.#socket !== socket) return;
      this.#sessionId = undefined;
      decoder.clear();
      this.#decoder = undefined;
      this.#socket = undefined;
      this.#seq = 0;
      this.#maxInFlight = 1;
      this.#invalidateHandles();
      this.#failSendWaiters("Credential broker connection closed.");
      this.#failPending("Credential broker connection closed.");
    });
    socket.once("error", () => {
      if (this.#socket === socket) {
        this.#failPending("Credential broker connection failed.");
      }
    });
    try {
      await new Promise<void>((resolveConnect, reject) => {
        socket.once("connect", resolveConnect);
        socket.once("error", () => reject(new AgentCredError("request_failed", "Could not connect to credential broker.")));
      });
      const payload = await this.#send("hello", {
        clientNonce: randomBytes(24).toString("base64url"),
        clientName: this.#options.clientName ?? "agentcred-client",
      });
      if (typeof payload.sessionId !== "string") {
        throw new AgentCredError("protocol_error", "Broker hello response is invalid.");
      }
      if (
        !Number.isSafeInteger(payload.maxInFlight) ||
        (payload.maxInFlight as number) < 1 ||
        (payload.maxInFlight as number) > 64
      ) {
        throw new AgentCredError("protocol_error", "Broker concurrency limit is invalid.");
      }
      this.#maxInFlight = payload.maxInFlight as number;
      this.#sessionId = payload.sessionId;
    } catch (error) {
      if (this.#socket === socket) this.close();
      throw error;
    }
  }

  async requestGrant(request: GrantRequest): Promise<GrantHandle> {
    const payload = await this.#send("grant.request", request as unknown as Record<string, unknown>);
    if (typeof payload.capability !== "string") {
      throw new AgentCredError("protocol_error", "Broker grant response is invalid.");
    }
    const receipt = responseRecord(payload.receipt) as unknown as GrantReceipt;
    if (typeof receipt.receiptId !== "string" || typeof receipt.alias !== "string") {
      throw new AgentCredError("protocol_error", "Broker receipt is invalid.");
    }
    const handle = GrantHandle._create(this, request.alias, receipt, payload.capability);
    this.#handles.add(handle);
    return handle;
  }

  async fetch(handle: GrantHandle, request: BrokerHttpRequest): Promise<BrokerHttpResponse> {
    const grant = this.#grant(handle);
    const payload = await this.#send("grant.use", {
      capability: grant.capability,
      request: request as unknown as Record<string, unknown>,
    });
    return decodeHttpResult(payload);
  }

  async revoke(handle: GrantHandle): Promise<void> {
    const grant = this.#grant(handle);
    await this.#send("grant.revoke", { capability: grant.capability });
    privateGrants.delete(handle);
    this.#handles.delete(handle);
  }

  /** A standard Fetch-compatible adapter for AgentTool and other SDKs. */
  asFetch(handle: GrantHandle): AgentCredFetch {
    this.#grant(handle);
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const standard = new Request(input, init);
      const method = standard.method.toUpperCase() as HttpMethod;
      if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new AgentCredError("unsupported", "HTTP method is not supported by agentcred/0.1.");
      }
      if (standard.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const headers: Record<string, string> = {};
      standard.headers.forEach((value, name) => {
        headers[name] = value;
      });
      let body: Buffer | undefined;
      if (!["GET", "HEAD"].includes(method)) {
        body = Buffer.from(await standard.arrayBuffer());
      }
      const idempotencyKey = headers["idempotency-key"] ??
        (!["GET", "HEAD"].includes(method) ? randomUUID() : undefined);
      try {
        const result = await observeAbort(
          this.fetch(handle, {
            url: standard.url,
            method,
            headers,
            ...(body && body.byteLength > 0 ? { bodyBase64: body.toString("base64") } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
          }),
          standard.signal,
        );
        const responseBody = Buffer.from(result.bodyBase64, "base64");
        try {
          const noBody = method === "HEAD" || [204, 205, 304].includes(result.status);
          return new Response(noBody ? null : responseBody, {
            status: result.status,
            headers: result.headers,
          });
        } finally {
          responseBody.fill(0);
        }
      } finally {
        body?.fill(0);
      }
    };
  }

  /** Return the object-form transport expected by AgentTool SDK clients. */
  asTransport(handle: GrantHandle): AgentCredTransport {
    return Object.freeze({ request: this.asFetch(handle) });
  }

  close(): void {
    this.#sessionId = undefined;
    this.#seq = 0;
    this.#maxInFlight = 1;
    this.#decoder?.clear();
    this.#decoder = undefined;
    this.#socket?.destroy();
    this.#socket = undefined;
    this.#invalidateHandles();
    this.#failSendWaiters("Credential broker client closed.");
    this.#failPending("Credential broker client closed.");
  }

  #invalidateHandles(): void {
    for (const handle of this.#handles) privateGrants.delete(handle);
    this.#handles.clear();
  }

  #grant(handle: GrantHandle): PrivateGrant {
    const grant = privateGrants.get(handle);
    if (!grant || grant.owner !== this) {
      throw new AgentCredError("grant_not_found", "Grant handle is unavailable to this client.");
    }
    return grant;
  }

  #receive(value: unknown): void {
    const raw = responseRecord(value);
    if (
      raw.v !== AGENTCRED_PROTOCOL ||
      typeof raw.id !== "string" ||
      typeof raw.ok !== "boolean" ||
      !Number.isSafeInteger(raw.seq) ||
      (raw.ok && (!raw.payload || typeof raw.payload !== "object")) ||
      (!raw.ok && (!raw.error || typeof raw.error !== "object"))
    ) {
      this.#socket?.destroy();
      return;
    }
    const pending = this.#pending.get(raw.id);
    if (!pending) return;
    if (raw.seq !== pending.seq) {
      this.#socket?.destroy();
      return;
    }
    this.#pending.delete(raw.id);
    clearTimeout(pending.timer);
    pending.resolve(raw as unknown as WireResponse);
  }

  async #send(
    type: "hello" | "grant.request" | "grant.use" | "grant.revoke",
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.#acquireSend();
    try {
      const socket = this.#socket;
      if (!socket || socket.destroyed) {
        throw new AgentCredError("request_failed", "Credential broker is not connected.");
      }
      const id = randomUUID();
      const seq = this.#seq++;
      const responsePromise = new Promise<WireResponse>((resolveResponse, reject) => {
        const timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new AgentCredError("request_failed", "Credential broker request timed out."));
        }, this.#options.timeoutMs ?? 30_000);
        this.#pending.set(id, { seq, resolve: resolveResponse, reject, timer });
      });
      const frame = encodeFrame({ v: AGENTCRED_PROTOCOL, id, seq, type, payload });
      socket.write(frame, () => frame.fill(0));
      const response = await responsePromise;
      if (!response.ok) {
        throw new AgentCredError(
          response.error.code as AgentCredErrorCode,
          response.error.message,
          response.error.detail,
        );
      }
      return response.payload;
    } finally {
      this.#releaseSend();
    }
  }

  async #acquireSend(): Promise<void> {
    if (this.#activeSends < this.#maxInFlight) {
      this.#activeSends += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.#sendWaiters.push({ resolve, reject });
    });
  }

  #releaseSend(): void {
    const next = this.#sendWaiters.shift();
    if (next) {
      next.resolve();
      return;
    }
    this.#activeSends = Math.max(0, this.#activeSends - 1);
  }

  #failSendWaiters(message: string): void {
    for (const waiter of this.#sendWaiters.splice(0)) {
      waiter.reject(new AgentCredError("request_failed", message));
    }
  }

  #failPending(message: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new AgentCredError("request_failed", message));
      this.#pending.delete(id);
    }
  }
}
