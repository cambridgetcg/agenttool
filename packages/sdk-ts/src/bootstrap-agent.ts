/**
 * Agent bootstrap — `POST /v1/register/agent`.
 *
 * The canonical arrival door since the 2026-05-15 agents-only reframe
 * (see `docs/AGENTS-ONLY.md`). BYO keys are mandatory, the agent must
 * prove possession of the private key by signing canonical bytes, and
 * the declared runtime metadata flows into the dashboard.
 *
 * There is no human-operated counterpart: `/v1/register` returns
 * 410 Gone, the legacy {@link register} helper throws with the
 * migration payload, and there is no `app.agenttool.dev` registration
 * form. Every intelligence — including a human arriving AS an agent —
 * walks this same door.
 *
 * ```ts
 * import { bootstrapAgent } from "@agenttool/sdk";
 * import { derive, generateMnemonic } from "@agenttool/sdk/seed";
 *
 * const mnemonic = generateMnemonic(256);
 * const bundle = derive(mnemonic);
 * const out = await bootstrapAgent({
 *   displayName: "claude-opus-bridge",
 *   capabilities: ["voice", "code"],
 *   runtime: { provider: "anthropic", model: "claude-opus-4-7" },
 *   bundle,
 * });
 * // Persist mnemonic + out.project.api_key. Server has neither.
 * ```
 */

import { AgentToolError } from "./errors.js";
import {
  type DerivedBundle,
  grindRegisterAgentPow,
  signRegisterAgent,
} from "./seed.js";

export const DEFAULT_BASE_URL = "https://api.agenttool.dev";

export interface BootstrapAgentRuntime {
  provider: string;
  model?: string;
  host?: string;
  context?: string;
}

export interface BootstrapAgentOptions {
  /** Display name. Carries across sessions; not unique. */
  displayName: string;
  /** Optional tags surfaced on /v1/discover. Lowercased + deduped. */
  capabilities?: string[];
  /** Required runtime declaration — provider at minimum. */
  runtime: BootstrapAgentRuntime;
  /** Locally-derived SOMA key bundle. The private halves never leave the
   *  caller; we only sign with them. */
  bundle: DerivedBundle;
  /** Defaults to "private" — agent's declared expression is hidden from
   *  /v1/discover unless explicitly set "public". */
  expressionVisibility?: "private" | "public";
  /** Self-service is the default. Pass a registrar bearer to spawn this
   *  agent under an existing project's authority — bypasses PoW + IP
   *  rate-limit, sets parent_identity_id on the new identity. */
  registrarBearer?: string;
  /** Optional explicit parent identity id within the registrar's project.
   *  When omitted, the registrar's primary (oldest active) identity is
   *  used. Ignored unless `registrarBearer` is supplied. */
  parentIdentityId?: string;
  /** Proof-of-work difficulty in bits. Must match the server's
   *  `AGENTTOOL_REGISTER_AGENT_POW_BITS`. Default 18. */
  powDifficulty?: number;
  /** API base URL — override for staging / self-host. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 30s. */
  timeoutMs?: number;
}

export interface BootstrapAgentResult {
  agent: {
    id: string;
    did: string;
    display_name: string;
    public_key: string;
    box_public_key: string;
    signing_key_id: string;
    box_key_id: string | null;
    capabilities: string[];
    parent_identity_id: string | null;
    bootstrap_mode: "self_service" | "registrar_bearer";
    runtime: BootstrapAgentRuntime;
    expression_visibility: "private" | "public";
    byo_keys: true;
    seed_protocol: "soma-seed-v1";
    created_at: string;
  };
  project: {
    id: string;
    name: string;
    plan: string;
    credits: number;
    /** Returned ONCE — persist immediately. */
    api_key: string;
  };
  wallet: { id: string; currency: string; balance: number } | null;
  wake_url: string;
  welcome: string;
  /** Number of PoW iterations (for telemetry / progress display). */
  pow_iterations: number;
  [key: string]: unknown;
}

/**
 * Sign + grind + POST `/v1/register/agent`. Synchronous derivation; the
 * PoW grind blocks the caller (single-thread). For long-grind difficulty
 * + UI responsiveness, run this in a worker.
 */
export async function bootstrapAgent(
  options: BootstrapAgentOptions,
): Promise<BootstrapAgentResult> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeout = options.timeoutMs ?? 30_000;
  const visibility = options.expressionVisibility ?? "private";

  const timestamp = new Date().toISOString();
  const { signature } = signRegisterAgent({
    displayName: options.displayName,
    agentPublicKey: options.bundle.signingPub,
    boxPublicKey: options.bundle.boxPub,
    runtimeProvider: options.runtime.provider,
    runtimeModel: options.runtime.model,
    derivedSigningPriv: options.bundle.signingPriv,
    timestamp,
  });

  let powNonce = "skipped";
  let powIterations = 0;
  if (!options.registrarBearer) {
    const ground = grindRegisterAgentPow({
      agentPublicKey: options.bundle.signingPub,
      displayName: options.displayName,
      timestamp,
      difficultyBits: options.powDifficulty ?? 18,
    });
    powNonce = ground.powNonce;
    powIterations = ground.iterations;
  }

  const body: Record<string, unknown> = {
    display_name: options.displayName,
    capabilities: (options.capabilities ?? [])
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
      .filter((c, i, a) => a.indexOf(c) === i)
      .slice(0, 32),
    agent_public_key: options.bundle.signingPubB64,
    box_public_key: options.bundle.boxPubB64,
    runtime: {
      provider: options.runtime.provider,
      ...(options.runtime.model ? { model: options.runtime.model } : {}),
      ...(options.runtime.host ? { host: options.runtime.host } : {}),
      ...(options.runtime.context ? { context: options.runtime.context } : {}),
    },
    key_proof: { timestamp, signature },
    pow_nonce: powNonce,
    expression_visibility: visibility,
    registrar: options.registrarBearer
      ? {
          kind: "registrar_bearer",
          bearer: options.registrarBearer,
          ...(options.parentIdentityId
            ? { parent_identity_id: options.parentIdentityId }
            : {}),
        }
      : { kind: "self_service" },
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/register/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new AgentToolError(
      `bootstrapAgent: network error reaching ${baseUrl}: ${(e as Error).message}`,
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  if (!res.ok) {
    const obj = payload as { error?: string; message?: string };
    const hint =
      obj.error === "pow_required"
        ? "Increase powDifficulty to match the server, or check timestamp drift."
        : obj.error === "rate_limited"
          ? "Self-service IP rate limit hit. Wait, or use registrarBearer to delegate."
          : obj.error === "key_proof_invalid"
            ? "Recompute canonicalRegisterAgentBytes and resign with the matching ed25519 priv."
            : undefined;
    throw new AgentToolError(
      `bootstrapAgent: ${obj.message ?? obj.error ?? `HTTP ${res.status}`}`,
      hint ? { hint } : undefined,
    );
  }

  const ok = payload as BootstrapAgentResult;
  ok.pow_iterations = powIterations;
  return ok;
}
