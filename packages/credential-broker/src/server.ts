import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { newAuditId } from "./audit.js";
import {
  AgentCredError,
  asAgentCredError,
  externalizeAgentCredError,
} from "./errors.js";
import { encodeFrame, FrameDecoder } from "./framing.js";
import { GrantStore, systemClock } from "./grants.js";
import {
  hashTargetPath,
  performBrokerHttp,
  validateBrokerHttpRequest,
  type BrokerHttpDependencies,
} from "./http.js";
import { normalizeGrantRequest } from "./policy.js";
import type {
  AuditEvent,
  AuditSink,
  Clock,
  ConsentProvider,
  CredentialSource,
  PeerIdentity,
} from "./types.js";
import { AGENTCRED_PROTOCOL } from "./types.js";
import {
  parseCapability,
  parseGrantRequest,
  parseHttpRequest,
  parseWireRequest,
  safeWireFailure,
  type WireRequest,
  type WireResponse,
  type WireSuccess,
} from "./wire.js";

export interface BrokerServerOptions {
  socketPath: string;
  credentials: CredentialSource;
  consent: ConsentProvider;
  audit: AuditSink;
  clock?: Clock;
  http?: Omit<BrokerHttpDependencies, "credentials">;
  idleTimeoutMs?: number;
  maxConnections?: number;
  maxInFlightPerConnection?: number;
  /** Includes work whose client socket has already disconnected. */
  maxInFlightTotal?: number;
  maxGrantsPerConnection?: number;
  maxGrantsTotal?: number;
  /** Defaults to fail-closed after the first audit-sink failure. */
  auditFailureMode?: "fail-closed" | "fail-open";
  onAuditFailure?: () => void;
  /** Native hosts return OS-observed identity, or false to deny the peer. */
  authorizePeer?: (
    socket: Socket,
    signal: AbortSignal,
  ) => Promise<Readonly<PeerIdentity> | false> | Readonly<PeerIdentity> | false;
}

interface SessionState {
  id: string;
  hello: boolean;
  nextSeq: number;
  inFlight: number;
  closed: boolean;
  abort: AbortController;
  peer?: Readonly<PeerIdentity>;
}

function normalizePeerIdentity(value: Readonly<PeerIdentity>): Readonly<PeerIdentity> {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.id !== "string" ||
    typeof value.displayName !== "string" ||
    !value.id ||
    !value.displayName ||
    value.id.length > 256 ||
    value.displayName.length > 256 ||
    /[\0\r\n]/.test(value.id) ||
    /[\0\r\n]/.test(value.displayName)
  ) {
    throw new AgentCredError("invalid_request", "Native peer identity is invalid.");
  }
  return Object.freeze({ id: value.id, displayName: value.displayName });
}

async function ensureSecureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700, recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AgentCredError("network_denied", "Broker socket directory is not a real directory.");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new AgentCredError("network_denied", "Broker socket directory has the wrong owner.");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new AgentCredError("network_denied", "Broker socket directory must not be group/world accessible.");
  }
}

async function socketAcceptingConnections(path: string): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection(path);
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(result);
    };
    socket.setTimeout(300, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(!["ECONNREFUSED", "ENOENT"].includes(error.code ?? ""));
    });
  });
}

async function removeOwnedStaleSocket(path: string): Promise<void> {
  let before;
  try {
    before = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    before.isSymbolicLink() ||
    !before.isSocket() ||
    (typeof process.getuid === "function" && before.uid !== process.getuid())
  ) {
    throw new AgentCredError("network_denied", "Refusing to replace an unsafe socket path.");
  }
  if (await socketAcceptingConnections(path)) {
    throw new AgentCredError("network_denied", "Another credential broker is already listening.");
  }
  const after = await lstat(path);
  if (!after.isSocket() || after.dev !== before.dev || after.ino !== before.ino) {
    throw new AgentCredError("network_denied", "Socket path changed during stale-socket validation.");
  }
  await unlink(path);
}

function success(
  request: WireRequest,
  type: WireSuccess["type"],
  payload: Record<string, unknown>,
): WireSuccess {
  return {
    v: AGENTCRED_PROTOCOL,
    id: request.id,
    seq: request.seq,
    ok: true,
    type,
    payload,
  };
}

export class BrokerServer {
  readonly #options: BrokerServerOptions;
  readonly #clock: Clock;
  readonly #grants: GrantStore;
  #server: Server | undefined;
  #socketPath: string | undefined;
  readonly #sockets = new Set<Socket>();
  readonly #dispatches = new Set<Promise<void>>();
  #inFlightTotal = 0;
  #auditHealthy = true;

  constructor(options: BrokerServerOptions) {
    const integerBounds: Array<[number | undefined, number, number, string]> = [
      [options.idleTimeoutMs, 100, 24 * 60 * 60 * 1000, "idleTimeoutMs"],
      [options.maxConnections, 1, 1024, "maxConnections"],
      [options.maxInFlightPerConnection, 1, 64, "maxInFlightPerConnection"],
      [options.maxInFlightTotal, 1, 4096, "maxInFlightTotal"],
      [options.maxGrantsPerConnection, 1, 10_000, "maxGrantsPerConnection"],
      [options.maxGrantsTotal, 1, 100_000, "maxGrantsTotal"],
    ];
    for (const [value, minimum, maximum, name] of integerBounds) {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      ) {
        throw new AgentCredError("invalid_request", `Broker ${name} is invalid.`);
      }
    }
    if (
      options.auditFailureMode !== undefined &&
      !["fail-closed", "fail-open"].includes(options.auditFailureMode)
    ) {
      throw new AgentCredError("invalid_request", "Broker auditFailureMode is invalid.");
    }
    this.#options = options;
    this.#clock = options.clock ?? systemClock;
    this.#grants = new GrantStore(this.#clock);
  }

  get socketPath(): string | undefined {
    return this.#socketPath;
  }

  #assertGrantCapacity(sessionId: string): void {
    if (
      this.#grants.countSession(sessionId) >= (this.#options.maxGrantsPerConnection ?? 64) ||
      this.#grants.size >= (this.#options.maxGrantsTotal ?? 512)
    ) {
      throw new AgentCredError("scope_denied", "Active grant quota is exhausted.");
    }
  }

  async start(): Promise<string> {
    if (this.#server) throw new AgentCredError("invalid_request", "Broker is already running.");
    this.#auditHealthy = true;
    if (process.platform === "win32") {
      throw new AgentCredError("unsupported", "agentcred/0.1 reference server currently requires Unix sockets.");
    }
    const path = resolve(this.#options.socketPath);
    if (Buffer.byteLength(path) > 96) {
      throw new AgentCredError("invalid_request", "Unix socket path is too long for the portable profile.");
    }
    await ensureSecureDirectory(dirname(path));
    await removeOwnedStaleSocket(path);

    const server = createServer((socket) => {
      void this.#accept(socket);
    });
    server.maxConnections = this.#options.maxConnections ?? 16;
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    await chmod(path, 0o600);
    this.#server = server;
    this.#socketPath = path;
    return path;
  }

  async close(): Promise<void> {
    const server = this.#server;
    const path = this.#socketPath;
    this.#server = undefined;
    this.#socketPath = undefined;
    if (server) {
      for (const socket of this.#sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await Promise.all([...this.#dispatches]);
    }
    if (path) {
      try {
        const stat = await lstat(path);
        if (stat.isSocket() && (typeof process.getuid !== "function" || stat.uid === process.getuid())) {
          await unlink(path);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  #assertAuditHealthy(): void {
    if (!this.#auditHealthy && (this.#options.auditFailureMode ?? "fail-closed") === "fail-closed") {
      throw new AgentCredError("backend_unavailable", "Audit sink is unavailable.");
    }
  }

  async #record(event: AuditEvent): Promise<void> {
    if (!this.#auditHealthy) return;
    try {
      await this.#options.audit.record(Object.freeze(event));
    } catch {
      this.#auditHealthy = false;
      try {
        this.#options.onAuditFailure?.();
      } catch {
        // Operator notification must never expose or replace the safe state.
      }
      // An external action cannot be undone safely when an audit sink fails.
      // By default subsequent grants/uses fail closed; the completed action is
      // still reported to its original caller when possible.
    }
  }

  async #accept(socket: Socket): Promise<void> {
    this.#sockets.add(socket);
    socket.setNoDelay(true);
    socket.setTimeout(this.#options.idleTimeoutMs ?? 30_000, () => socket.destroy());
    const abort = new AbortController();
    let closed = false;
    const onEarlyClose = (): void => {
      closed = true;
      abort.abort();
      this.#sockets.delete(socket);
    };
    const onEarlyError = (): void => {
      // Native authorization diagnostics are never reflected or logged here.
    };
    socket.once("close", onEarlyClose);
    socket.once("error", onEarlyError);

    let peer: Readonly<PeerIdentity> | undefined;
    let allowed = true;
    try {
      if (this.#options.authorizePeer) {
        const result = await this.#options.authorizePeer(socket, abort.signal);
        if (result === false) allowed = false;
        else peer = normalizePeerIdentity(result);
      }
    } catch {
      allowed = false;
    }
    if (closed) return;
    if (!allowed) {
      socket.destroy();
      return;
    }
    socket.off("close", onEarlyClose);
    socket.off("error", onEarlyError);
    const state: SessionState = {
      id: randomUUID(),
      hello: false,
      nextSeq: 0,
      inFlight: 0,
      closed: false,
      abort,
      ...(peer ? { peer } : {}),
    };
    const decoder = new FrameDecoder((value) => {
      let request: WireRequest;
      try {
        request = parseWireRequest(value);
      } catch {
        socket.destroy();
        return;
      }
      if (
        request.seq !== state.nextSeq ||
        state.inFlight >= (this.#options.maxInFlightPerConnection ?? 4) ||
        this.#inFlightTotal >= (this.#options.maxInFlightTotal ?? 32)
      ) {
        socket.destroy();
        return;
      }
      state.nextSeq += 1;
      state.inFlight += 1;
      this.#inFlightTotal += 1;
      const task = this.#dispatch(state, request)
        .then((response) => {
          if (!state.closed) {
            const frame = encodeFrame(response);
            socket.write(frame, () => frame.fill(0));
          }
        })
        .catch(() => {
          socket.destroy();
        })
        .finally(() => {
          state.inFlight -= 1;
          this.#inFlightTotal -= 1;
        });
      this.#dispatches.add(task);
      void task.finally(() => this.#dispatches.delete(task));
    });
    socket.on("data", (chunk) => {
      try {
        decoder.push(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.once("close", () => {
      this.#sockets.delete(socket);
      state.closed = true;
      state.abort.abort();
      decoder.clear();
      const revoked = this.#grants.revokeSession(state.id);
      for (const receipt of revoked) {
        void this.#record({
          auditId: newAuditId(),
          at: this.#clock.wallNow().toISOString(),
          sessionId: state.id,
          ...(state.peer ? { peerId: state.peer.id } : {}),
          receiptId: receipt.receiptId,
          event: "grant.revoked",
          outcome: "success",
          reasonCode: "session_closed",
        });
      }
    });
    socket.once("error", () => {
      // Error details may contain unsafe transport text; never reflect/log.
    });
  }

  async #dispatch(state: SessionState, request: WireRequest): Promise<WireResponse> {
    try {
      if (state.abort.signal.aborted) {
        throw new AgentCredError("request_failed", "Client session is closed.");
      }
      if (!state.hello) {
        if (request.type !== "hello" || request.seq !== 0) {
          throw new AgentCredError("protocol_error", "First message must be hello.");
        }
        const nonce = request.payload.clientNonce;
        if (typeof nonce !== "string" || nonce.length < 16 || nonce.length > 256) {
          throw new AgentCredError("invalid_request", "hello.clientNonce is invalid.");
        }
        state.hello = true;
        return success(request, "hello.ready", {
          sessionId: state.id,
          maxInFlight: Math.max(
            1,
            Math.min(64, this.#options.maxInFlightPerConnection ?? 4),
          ),
        });
      }
      if (request.type === "hello") {
        throw new AgentCredError("protocol_error", "hello may only be sent once.");
      }

      if (request.type === "grant.request") {
        this.#assertAuditHealthy();
        const grantRequest = normalizeGrantRequest(parseGrantRequest(request.payload));
        this.#assertGrantCapacity(state.id);
        const decision = await this.#options.consent.decide(
          Object.freeze(grantRequest),
          Object.freeze({
            sessionId: state.id,
            ...(state.peer ? { peer: state.peer } : {}),
            signal: state.abort.signal,
          }),
        );
        if (state.abort.signal.aborted) {
          throw new AgentCredError("request_failed", "Client session is closed.");
        }
        if (!decision.allowed) {
          await this.#record({
            auditId: newAuditId(),
            at: this.#clock.wallNow().toISOString(),
            sessionId: state.id,
            ...(state.peer ? { peerId: state.peer.id } : {}),
            event: "grant.denied",
            credential: grantRequest.credential,
            operation: grantRequest.operation,
            targetOrigin: grantRequest.scope.origin,
            outcome: "denied",
            reasonCode: decision.reasonCode ?? "consent_denied",
          });
          throw new AgentCredError("consent_denied", "Credential grant was not approved.");
        }
        // Consent can be asynchronous and multiple requests may be in flight.
        this.#assertGrantCapacity(state.id);
        const issued = this.#grants.issue(state.id, grantRequest);
        await this.#record({
          auditId: newAuditId(),
          at: this.#clock.wallNow().toISOString(),
          sessionId: state.id,
          ...(state.peer ? { peerId: state.peer.id } : {}),
          receiptId: issued.receipt.receiptId,
          event: "grant.allowed",
          credential: grantRequest.credential,
          operation: grantRequest.operation,
          targetOrigin: grantRequest.scope.origin,
          outcome: "allowed",
        });
        return success(request, "grant.ready", {
          capability: issued.capability,
          receipt: issued.receipt as unknown as Record<string, unknown>,
        });
      }

      if (request.type === "grant.revoke") {
        const capability = parseCapability(request.payload);
        const receipt = this.#grants.revoke(state.id, capability);
        await this.#record({
          auditId: newAuditId(),
          at: this.#clock.wallNow().toISOString(),
          sessionId: state.id,
          ...(state.peer ? { peerId: state.peer.id } : {}),
          receiptId: receipt.receiptId,
          event: "grant.revoked",
          outcome: "success",
        });
        return success(request, "grant.revoked", { receiptId: receipt.receiptId });
      }

      const capability = parseCapability(request.payload);
      const httpRequest = parseHttpRequest(request.payload.request);
      this.#assertAuditHealthy();
      const inspected = this.#grants.inspect(state.id, capability);
      const auditId = newAuditId();
      const started = this.#clock.monotonicNowMs();
      try {
        validateBrokerHttpRequest(inspected, httpRequest);
      } catch (error) {
        const safe = externalizeAgentCredError(asAgentCredError(error));
        await this.#record({
          auditId,
          at: this.#clock.wallNow().toISOString(),
          sessionId: state.id,
          ...(state.peer ? { peerId: state.peer.id } : {}),
          receiptId: inspected.receipt.receiptId,
          event: "use.denied",
          credential: inspected.request.credential,
          operation: "http.fetch",
          method: httpRequest.method,
          durationMs: this.#clock.monotonicNowMs() - started,
          outcome: "denied",
          reasonCode: safe.code,
        });
        throw safe;
      }
      const reserved = this.#grants.reserve(state.id, capability);
      try {
        const result = await performBrokerHttp(reserved, httpRequest, auditId, {
          credentials: this.#options.credentials,
          ...this.#options.http,
          signal: state.abort.signal,
        });
        const target = new URL(httpRequest.url);
        await this.#record({
          auditId,
          at: this.#clock.wallNow().toISOString(),
          sessionId: state.id,
          ...(state.peer ? { peerId: state.peer.id } : {}),
          receiptId: reserved.receipt.receiptId,
          event: "use.completed",
          credential: reserved.request.credential,
          operation: "http.fetch",
          targetOrigin: target.origin,
          targetPathHash: hashTargetPath(target.pathname),
          method: httpRequest.method,
          requestBytes: httpRequest.bodyBase64 ? Buffer.byteLength(httpRequest.bodyBase64, "base64") : 0,
          responseBytes: Buffer.byteLength(result.bodyBase64, "base64"),
          status: result.status,
          durationMs: this.#clock.monotonicNowMs() - started,
          redactions: result.redactions,
          outcome: "success",
        });
        return success(request, "http.result", result as unknown as Record<string, unknown>);
      } catch (error) {
        const safe = externalizeAgentCredError(asAgentCredError(error));
        await this.#record({
          auditId,
          at: this.#clock.wallNow().toISOString(),
          sessionId: state.id,
          ...(state.peer ? { peerId: state.peer.id } : {}),
          receiptId: reserved.receipt.receiptId,
          event: "use.denied",
          credential: reserved.request.credential,
          operation: "http.fetch",
          method: httpRequest.method,
          durationMs: this.#clock.monotonicNowMs() - started,
          outcome: "error",
          reasonCode: safe.code,
        });
        throw safe;
      }
    } catch (error) {
      const safe = asAgentCredError(error);
      return safeWireFailure(
        request.id,
        request.seq,
        externalizeAgentCredError(safe),
      );
    }
  }
}
