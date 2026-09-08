/** Explicit local binding, lazy credentials, and bounded fixed-origin reads.
 * Doctrine: docs/WAKE-RETURN.md. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isAbsolute } from "node:path";

import { parseReturnBinding } from "./core.js";
import {
  OBSERVATION_MEDIA_TYPE, RETURN_ORIGIN, RETURN_TIMEOUT_MS, ReturnError,
  type ReturnBinding, type ReturnDependencies, type ReturnFailure,
  type ReturnReadRequest, type ReturnReadResponse,
} from "./types.js";

const CONFIG_MAX_BYTES = 16_384;
const BEARER_MAX_BYTES = 4_096;
const CONTEXT_PATH = "/v1/bootstrap/scaffold/context";
const FAILURES = new Set<ReturnFailure>([
  "credential_unavailable", "binding_invalid", "scaffold_mismatch", "transport_unavailable",
  "response_invalid", "project_mismatch", "subject_mismatch", "observation_unavailable",
  "cancelled", "observation_in_progress", "cursor_regressed",
]);

/** Trusted host/test seams, never model-facing tool arguments. */
export interface ReturnHostSeams {
  environment?: (name: "AGENTTOOL_RETURN_BEARER") => string | undefined;
  platform?: NodeJS.Platform;
  executeKeychain?: (service: string, account: string, signal: AbortSignal) => Promise<string>;
  request?: (options: RequestOptions, response: (message: IncomingMessage) => void) => ClientRequest;
  /** Tests may shorten, but cannot extend, the production deadline. */
  timeoutMs?: number;
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ReturnError("cancelled");
}

function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new ReturnError("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    // Both handlers remain attached even if cancellation wins; late failures
    // cannot become unhandled rejections or reveal the original error.
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    }).catch(() => undefined);
    if (signal.aborted) onAbort();
  });
}

/** No discovery or ancestor walk. Ancestors and same-user writers are trusted. */
async function readSelectedJson(path: string, failure: ReturnFailure): Promise<unknown> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (typeof path !== "string" || !isAbsolute(path) || path.length > 4_096 || path.includes("\0")) {
      throw new ReturnError(failure);
    }
    // This private candidate implements POSIX file custody, not Windows ACLs.
    // Fail closed if ownership or final-component no-follow cannot be checked.
    // Nonblocking open ensures a FIFO cannot hang before the regular-file check.
    if (process.platform === "win32" || typeof process.getuid !== "function" ||
        typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW <= 0) {
      throw new ReturnError(failure);
    }
    const owner = process.getuid();
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > CONFIG_MAX_BYTES) throw new ReturnError(failure);
    if ((stat.mode & 0o077) !== 0 || stat.uid !== owner) throw new ReturnError(failure);
    const bytes = Buffer.alloc(CONFIG_MAX_BYTES + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > CONFIG_MAX_BYTES) throw new ReturnError(failure);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total)));
  } catch {
    throw new ReturnError(failure);
  } finally {
    await file?.close().catch(() => undefined);
  }
}

/** Corroboration only: never consumes key_source, name, DID, or persona fields. */
export function checkReturnScaffold(input: unknown, binding: ReturnBinding): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ReturnError("scaffold_mismatch");
  }
  const record = input as Record<string, unknown>;
  if (record.identity_id !== binding.identity_id ||
      record.wake_url !== `${RETURN_ORIGIN}/v1/wake?identity_id=${encodeURIComponent(binding.identity_id)}`) {
    throw new ReturnError("scaffold_mismatch");
  }
}

export async function loadReturnHost(
  bindingPath: string,
  scaffoldPath?: string,
): Promise<{ binding: ReturnBinding; dependencies: ReturnDependencies }> {
  const binding = parseReturnBinding(await readSelectedJson(bindingPath, "binding_invalid"));
  if (scaffoldPath !== undefined) {
    checkReturnScaffold(await readSelectedJson(scaffoldPath, "scaffold_mismatch"), binding);
  }
  return { binding, dependencies: createReturnHostDependencies(binding) };
}

function validateBearer(value: unknown): string {
  // A bearer is one nonempty printable ASCII token, never a header fragment.
  if (typeof value !== "string" || value.length > BEARER_MAX_BYTES || !/^[\x21-\x7e]+$/.test(value)) {
    throw new ReturnError("credential_unavailable");
  }
  return value;
}

/** Fixed executable, no shell, no inherited environment or captured stderr. */
export function executeReturnKeychain(
  service: string, account: string, signal: AbortSignal,
  spawnProcess: typeof spawn = spawn,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn> | undefined;
    let settled = false;
    let length = 0;
    const output: Buffer[] = [];
    const finish = (error?: ReturnError, result?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) {
        child?.kill("SIGKILL");
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        output.length = 0;
        reject(error);
      } else {
        resolve(result ?? "");
      }
    };
    const onAbort = () => finish(new ReturnError("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();
    try {
      child = spawnProcess("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
        shell: false, env: {}, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      child.on("error", () => finish(new ReturnError("credential_unavailable")));
      child.stdout?.on("error", () => finish(new ReturnError("credential_unavailable")));
      child.stderr?.on("error", () => finish(new ReturnError("credential_unavailable")));
      child.stdout?.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > BEARER_MAX_BYTES + 2) return finish(new ReturnError("credential_unavailable"));
        output.push(Buffer.from(chunk));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > BEARER_MAX_BYTES + 2) finish(new ReturnError("credential_unavailable"));
      });
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) return finish(new ReturnError("credential_unavailable"));
        try {
          const value = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(output));
          output.length = 0;
          finish(undefined, validateBearer(value.replace(/\r?\n$/, "")));
        } catch {
          finish(new ReturnError("credential_unavailable"));
        }
      });
    } catch {
      finish(new ReturnError("credential_unavailable"));
    }
  });
}

function credentialEcho(value: unknown, bearer: string): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "string" && item.includes(bearer)) return true;
    if (item !== null && typeof item === "object") {
      for (const [key, entry] of Object.entries(item)) {
        if (key.includes(bearer)) return true;
        pending.push(entry);
      }
    }
  }
  return false;
}

function readHttps(
  request: ReturnReadRequest,
  bearer: string,
  signal: AbortSignal,
  send: NonNullable<ReturnHostSeams["request"]>,
): Promise<ReturnReadResponse> {
  return new Promise((resolve, reject) => {
    let outgoing: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    let settled = false;
    const finish = (error?: ReturnError, result?: ReturnReadResponse) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      incoming?.destroy();
      outgoing?.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    const onAbort = () => finish(new ReturnError("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();
    try {
      outgoing = send({
        protocol: "https:", hostname: "api.agenttool.dev", port: 443,
        method: "GET", path: request.path, agent: false, rejectUnauthorized: true,
        maxHeaderSize: 4_096,
        headers: {
          Authorization: `Bearer ${bearer}`, Accept: request.accept,
          "Accept-Encoding": "identity", "Cache-Control": "no-store",
        },
      }, (response) => {
        incoming = response;
        // Keep an error listener even after cleanup; never surface socket prose.
        response.on("error", () => finish(new ReturnError("transport_unavailable")));
        if (settled) return response.destroy();
        const status = response.statusCode;
        if (!Number.isInteger(status) || status! < 100 || status! > 599) {
          return finish(new ReturnError("response_invalid"));
        }
        // No redirect following and no remote error body/header reflection.
        if (status !== 200) return finish(undefined, { status: status!, content_type: "", body: "" });
        const contentType = response.headers["content-type"];
        const encoding = response.headers["content-encoding"];
        const expected = request.accept;
        if (typeof contentType !== "string" || contentType.length > 128 || contentType.includes(bearer) ||
            ![expected, `${expected}; charset=utf-8`].includes(contentType.trim().toLowerCase()) ||
            (encoding !== undefined && encoding !== "identity")) {
          return finish(new ReturnError("response_invalid"));
        }
        const declared = response.headers["content-length"];
        if (declared !== undefined && (typeof declared !== "string" || !/^\d+$/.test(declared) ||
            !Number.isSafeInteger(Number(declared)) || Number(declared) > request.max_bytes)) {
          return finish(new ReturnError("response_invalid"));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          total += chunk.length;
          if (total > request.max_bytes) return finish(new ReturnError("response_invalid"));
          chunks.push(Buffer.from(chunk));
        });
        response.on("aborted", () => finish(new ReturnError("transport_unavailable")));
        response.on("close", () => {
          if (!settled) finish(new ReturnError("transport_unavailable"));
        });
        response.on("end", () => {
          if (settled) return;
          if (declared !== undefined && total !== Number(declared)) return finish(new ReturnError("response_invalid"));
          try {
            const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
            const parsed: unknown = JSON.parse(body);
            if (body.includes(bearer) || credentialEcho(parsed, bearer)) throw new ReturnError("response_invalid");
            finish(undefined, { status: 200, content_type: expected, body });
          } catch {
            finish(new ReturnError("response_invalid"));
          }
        });
      });
      outgoing.on("error", () => finish(new ReturnError("transport_unavailable")));
      if (settled) outgoing.destroy();
      else outgoing.end();
    } catch {
      finish(new ReturnError("transport_unavailable"));
    }
  });
}

export function createReturnHostDependencies(input: ReturnBinding, seams: ReturnHostSeams = {}): ReturnDependencies {
  // Copy/validate once so later caller mutation cannot change a running binding.
  const binding = parseReturnBinding(input);
  const observePath = `/v1/wake/observe?identity_id=${encodeURIComponent(binding.identity_id)}`;
  const timeoutMs = seams.timeoutMs ?? RETURN_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > RETURN_TIMEOUT_MS) throw new ReturnError("binding_invalid");
  const send = seams.request ?? httpsRequest;
  return {
    async withReader(work, signal) {
      const controller = new AbortController();
      let timedOut = false;
      let active = true;
      let bearer = "";
      let credentialReady = false;
      let reading = false;
      let next = 0;
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      if (signal.aborted) controller.abort();
      try {
        cancelled(controller.signal);
        if (binding.credential.kind === "environment") {
          bearer = validateBearer((seams.environment ?? ((name) => process.env[name]))("AGENTTOOL_RETURN_BEARER"));
        } else {
          if ((seams.platform ?? process.platform) !== "darwin") throw new ReturnError("credential_unavailable");
          const service = `agenttool:${createHash("sha256").update(binding.project_id, "utf8").digest("hex").slice(0, 16)}`;
          bearer = validateBearer(await bounded(
            (seams.executeKeychain ?? executeReturnKeychain)(service, binding.credential.account, controller.signal),
            controller.signal,
          ));
        }
        credentialReady = true;
        cancelled(controller.signal);
        return await bounded(Promise.resolve().then(() => work(async (request) => {
          cancelled(controller.signal);
          if (!active || reading || next >= 2 || request.path !== [CONTEXT_PATH, observePath][next] ||
              request.accept !== (next === 0 ? "application/json" : OBSERVATION_MEDIA_TYPE) ||
              !Number.isInteger(request.max_bytes) || request.max_bytes < 1 ||
              request.max_bytes > (next === 0 ? 4_096 : 2_048) || !(request.signal instanceof AbortSignal)) {
            throw new ReturnError("response_invalid");
          }
          if (request.signal.aborted) throw new ReturnError("cancelled");
          reading = true;
          next += 1;
          const requestAbort = () => controller.abort();
          const requestSignal = request.signal;
          const fixedRequest = { path: request.path, accept: request.accept, max_bytes: request.max_bytes, signal: requestSignal };
          requestSignal.addEventListener("abort", requestAbort, { once: true });
          try {
            return await readHttps(fixedRequest, bearer, controller.signal, send);
          } finally {
            requestSignal.removeEventListener("abort", requestAbort);
            reading = false;
          }
        })), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw new ReturnError(timedOut ? "transport_unavailable" : "cancelled");
        if (error instanceof ReturnError && FAILURES.has(error.code)) throw new ReturnError(error.code);
        // Includes environment access, executable, callback and network errors.
        throw new ReturnError(credentialReady ? "response_invalid" : "credential_unavailable");
      } finally {
        active = false;
        bearer = ""; // Lifetime narrowing, not a secure-erasure guarantee.
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        controller.abort();
      }
    },
  };
}
