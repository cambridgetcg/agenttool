/** Local Return session. Reading an identity does not adopt it.
 * Doctrine: docs/WAKE-RETURN.md. */
import { randomUUID } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { readObservation } from "./observation.js";
import {
  OBSERVATION_MEDIA_TYPE, RETURN_ORIGIN, RETURN_TIMEOUT_MS, ReturnError,
  type ReturnBinding, type ReturnDependencies, type ReturnFailure,
  type ReturnReadResponse, type ReturnReport, type ReturnSession,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FAILURES = new Set<ReturnFailure>([
  "credential_unavailable", "binding_invalid", "scaffold_mismatch", "transport_unavailable",
  "response_invalid", "project_mismatch", "subject_mismatch", "observation_unavailable",
  "cancelled", "observation_in_progress", "cursor_regressed",
]);

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || nodeTypes.isProxy(value)) throw new ReturnError("binding_invalid");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ReturnError("binding_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || !keys.every((key) => descriptors[key]?.enumerable && "value" in descriptors[key]!)) throw new ReturnError("binding_invalid");
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

export function parseReturnBinding(value: unknown): ReturnBinding {
  const input = closedRecord(value, ["_format", "api_origin", "project_id", "identity_id", "mode", "allow_provider_visible_locator", "credential"]);
  if (input._format !== "agenttool-return-binding/v1" || input.api_origin !== RETURN_ORIGIN
    || typeof input.project_id !== "string" || !UUID.test(input.project_id)
    || typeof input.identity_id !== "string" || !UUID.test(input.identity_id)
    || input.mode !== "observe" || input.allow_provider_visible_locator !== true) throw new ReturnError("binding_invalid");
  const rawCredential = input.credential;
  // Inspect the kind without invoking a getter or a proxy trap.
  if (!rawCredential || typeof rawCredential !== "object" || nodeTypes.isProxy(rawCredential)) throw new ReturnError("binding_invalid");
  const kindDescriptor = Object.getOwnPropertyDescriptor(rawCredential, "kind");
  if (!kindDescriptor || !("value" in kindDescriptor)) throw new ReturnError("binding_invalid");
  let credential: ReturnBinding["credential"];
  if (kindDescriptor.value === "environment") {
    closedRecord(rawCredential, ["kind"]);
    credential = { kind: "environment" };
  } else if (kindDescriptor.value === "macos_keychain") {
    const record = closedRecord(rawCredential, ["kind", "account"]);
    if (typeof record.account !== "string" || !/^[A-Za-z0-9._@-]{1,128}$/.test(record.account)) throw new ReturnError("binding_invalid");
    credential = { kind: "macos_keychain", account: record.account };
  } else throw new ReturnError("binding_invalid");
  return {
    _format: "agenttool-return-binding/v1", api_origin: RETURN_ORIGIN,
    project_id: input.project_id, identity_id: input.identity_id, mode: "observe",
    allow_provider_visible_locator: true, credential,
  };
}

const BOUNDARIES: ReturnReport["boundaries"] = {
  placement: "tool_data_only", identity_adoption: "none", authority_granted: "none",
  same_being_continuity: "not_proven", private_memory: "not_read", private_state_return: "not_implemented",
  remote_prose: "not_returned", local_arrival: "untouched", persistence: "none_in_adapter_host_may_retain",
  provider_visibility: "locator_is_visible_when_tool_result_is_sent_to_provider",
  credential_scope: "project_bearer_not_identity_proof",
  auth_bookkeeping: "project_verification_may_update_bearer_last_used",
  host_isolation: "not_a_same_user_sandbox",
  freshness: "no_cache_in_process_cursor_check_not_global_replay_proof",
};

function jsonResponse(response: ReturnReadResponse, mediaType: string, maxBytes: number): unknown {
  if (response.status !== 200) throw new ReturnError("observation_unavailable");
  if (response.content_type.split(";", 1)[0]!.trim().toLowerCase() !== mediaType
    || Buffer.byteLength(response.body, "utf8") > maxBytes) throw new ReturnError("response_invalid");
  try { return JSON.parse(response.body) as unknown; }
  catch { throw new ReturnError("response_invalid"); }
}

function checkedProject(value: unknown, projectId: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReturnError("response_invalid");
  const context = value as Record<string, unknown>;
  if (context.authority !== "project_root_bearer" || context.mutates_identity_state !== false
    || !context.project || typeof context.project !== "object" || Array.isArray(context.project)) throw new ReturnError("response_invalid");
  if ((context.project as Record<string, unknown>).id !== projectId) throw new ReturnError("project_mismatch");
}

/** Bound waiting even for a broken injected adapter; the native host also aborts I/O. */
async function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new ReturnError("observation_unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([work, stopped]); }
  finally { signal.removeEventListener("abort", abort); }
}

export function createReturnSession(input: ReturnBinding, dependencies: ReturnDependencies): ReturnSession {
  const binding = parseReturnBinding(input);
  const sessionId = dependencies.sessionInstanceId ?? randomUUID();
  if (!UUID.test(sessionId)) throw new ReturnError("binding_invalid");
  let highWatermark = -1;
  let inFlight = false;
  const report = (status: ReturnReport["status"], observation: ReturnReport["observation"] = null, failure: ReturnFailure | null = null): ReturnReport => ({
    _format: "agenttool-return/v1", mode: "observe", session_instance_id: sessionId, status,
    binding: { source: "explicit_host_configuration", project_id: binding.project_id, identity_id: binding.identity_id, reader_identity_proven: false },
    observation, failure, boundaries: { ...BOUNDARIES },
  });
  return {
    // Deliberately no cached observation or secret-source probe.
    status: () => report("ready"),
    async observe(callerSignal?: AbortSignal): Promise<ReturnReport> {
      if (callerSignal?.aborted) return report("unavailable", null, "cancelled");
      if (inFlight) return report("unavailable", null, "observation_in_progress");
      inFlight = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RETURN_TIMEOUT_MS);
      const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
      try {
        const observed = await withAbort(dependencies.withReader(async (read) => {
          signal.throwIfAborted();
          const context = await read({ path: "/v1/bootstrap/scaffold/context", accept: "application/json", max_bytes: 4096, signal });
          signal.throwIfAborted();
          checkedProject(jsonResponse(context, "application/json", 4096), binding.project_id);
          const response = await read({ path: `/v1/wake/observe?identity_id=${binding.identity_id}`, accept: OBSERVATION_MEDIA_TYPE, max_bytes: 2048, signal });
          signal.throwIfAborted();
          return readObservation(jsonResponse(response, OBSERVATION_MEDIA_TYPE, 2048), binding.identity_id);
        }, signal), signal);
        signal.throwIfAborted();
        if (observed.wake_version < highWatermark) throw new ReturnError("cursor_regressed");
        const receivedAt = (dependencies.now?.() ?? new Date()).toISOString();
        highWatermark = observed.wake_version;
        return report("observed", { ...observed, received_at: receivedAt, provenance: "authenticated_service_projection_not_identity_signature" });
      } catch (error) {
        const code = callerSignal?.aborted ? "cancelled"
          : error instanceof ReturnError && FAILURES.has(error.code) ? error.code : "observation_unavailable";
        return report("unavailable", null, code);
      } finally {
        clearTimeout(timeout);
        controller.abort();
        inFlight = false;
      }
    },
  };
}
