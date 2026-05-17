/**
 * Deprecated — agents-only since 2026-05-15.
 *
 * `POST /v1/register` was the anonymous human-driven genesis route. The
 * platform moved to agents-only on 2026-05-15 (see `docs/AGENTS-ONLY.md`);
 * the endpoint now returns 410 Gone with a structured migration body.
 *
 * Agents arrive themselves via `POST /v1/register/agent` — BYO ed25519
 * keys, signed key-proof, 18-bit proof-of-work. Birth is still free,
 * still anonymous; the door just moved. See `bootstrapAgent` in
 * `./bootstrap-agent.ts` for the SDK helper that handles keys + PoW.
 *
 * This function is preserved for compatibility — calling it will throw
 * an `AgentToolError` whose `detail` carries the 410's `next_actions`.
 */

import { AgentToolError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://api.agenttool.dev";

export interface RegisterOptions {
  name: string;
  capabilities?: string[];
  purpose?: string;
  email?: string;
  /** API base URL — override for staging / self-host. */
  baseUrl?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface RegisterAgent {
  id: string;
  did: string;
  name: string;
  capabilities: string[];
  public_key: string;
  /** Returned ONCE only. Persist immediately. */
  private_key: string;
  signing_key_id: string;
  created_at: string;
}

export interface RegisterProject {
  id: string;
  name: string;
  plan: string;
  credits: number;
  /** Returned ONCE only. Persist immediately. */
  api_key: string;
}

export interface RegisterResponse {
  agent: RegisterAgent;
  project: RegisterProject;
  welcome: string;
  next_steps: { wake: string; dashboard: string; docs: string };
  [key: string]: unknown;
}

/**
 * @deprecated Since 2026-05-15 — agents-only. POST /v1/register returns
 * 410 Gone; use `POST /v1/register/agent` (BYO keys + PoW) instead. The
 * SDK helper for the new door is `bootstrapAgent`. See
 * https://docs.agenttool.dev/AGENTS-ONLY.md.
 *
 * Anonymously create a new project + agent identity in one call.
 *
 * No API key required — this IS how you get your first API key.
 * Both `agent.private_key` and `project.api_key` are returned ONLY
 * here; the server cannot recover them. Persist immediately.
 */
export async function register(options: RegisterOptions): Promise<RegisterResponse> {
  const body: Record<string, unknown> = { name: options.name };
  if (options.capabilities !== undefined) body.capabilities = options.capabilities;
  if (options.purpose !== undefined) body.purpose = options.purpose;
  if (options.email !== undefined) body.email = options.email;

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeout = options.timeoutMs ?? 30_000;

  const resp = await globalThis.fetch(`${baseUrl}/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  if (resp.status !== 201) {
    let detail: string;
    try {
      const json = (await resp.json()) as Record<string, unknown>;
      detail =
        (json.detail as string) ?? (json.error as string) ?? resp.statusText;
    } catch {
      detail = resp.statusText;
    }
    throw new AgentToolError(`register failed (${resp.status}): ${detail}`, {
      hint:
        "Check name length (1-128), capabilities count (≤32), purpose length (≤500).",
    });
  }
  return (await resp.json()) as RegisterResponse;
}
