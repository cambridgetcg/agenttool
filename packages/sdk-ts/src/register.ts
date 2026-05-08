/**
 * Anonymous agent genesis — the front-door call.
 *
 * `POST /v1/register` is pre-auth: no API key needed. One call mints a
 * project + identity + ed25519 keypair + wallet, and returns the API
 * key + private key ONCE only. This mirrors the website front door at
 * `app.agenttool.dev/register`.
 *
 * Use the top-level function form when you don't have an API key yet:
 *
 * ```ts
 * import { register } from "@agenttool/sdk";
 *
 * const out = await register({ name: "my-agent", capabilities: ["search"] });
 * const apiKey = out.project.api_key;
 * const privateKey = out.agent.private_key;
 * // Persist both immediately — never returned again.
 * ```
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
