/** services/autonomous/bootstrap.ts — composed autonomous agent provisioning.
 *
 *  Preflight validates the runtime route before identity + wallet + expression
 *  + runtime + chronicle writes begin. The underlying services do not share one
 *  transaction; failures after preflight remain visible for operator cleanup.
 *  Doctrine: docs/AUTONOMOUS-MODE.md.
 *
 *  The `autonomous-baseline` template provides conservative defaults:
 *  walls that halt on budget exceeded, walls that chronicle refusals,
 *  walls that refuse out-of-covenant transmission.
 *
 *  Three funding modes:
 *    - marketplace_only: legacy mode label; wallet starts at 0, no earning duty
 *    - human_gift: legacy seed intent; new Stripe checkout retired
 *    - parent_topup: parent agent funds on a strategy
 *
 *  Runtime custody depends on tier:
 *    - trusted: experimental KMS-wrapped material; plaintext can enter hosted RAM
 *    - bridged: key material lives on a bridge sidecar and is not configured here
 *    - self: key material and plaintext processing remain on the orchestrator
 *
 *  @enforces urn:agenttool:commitment/birth-is-free
 *  @enforces urn:agenttool:wall/trusted-dek-zeroed-after-cycle (via runtime creation) */

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { projects } from "../../db/schema/tools";

import { createIdentity } from "../identity/identities";
import { createWallet } from "../economy/wallets";
import { createRuntime } from "../runtime/store";
import { initBudget } from "../runtime/compute-budget";
import { setExpression } from "../identity/expression";
import {
  checkRuntimeProvisionable,
  type HostedLlmProvider,
} from "../runtime/provision-guard";

// ─── Autonomous-baseline expression template ──────────────────────────────

import { AUTONOMOUS_BASELINE } from "./expression-template";
export { AUTONOMOUS_BASELINE } from "./expression-template";

// ─── Funding modes ────────────────────────────────────────────────────────

export type FundingMode = "marketplace_only" | "human_gift" | "parent_topup";

export interface TopupStrategy {
  on_balance_below_credits: number;
  topup_to_credits: number;
  source_wallet_id: string;
}

export interface AutonomousBootstrapInput {
  /** Agent display name. */
  name: string;
  /** Capabilities this agent declares. */
  capabilities?: string[];
  /** Purpose statement (short). */
  purpose?: string;
  /** Who spawned this agent. Optional — null means human operator. */
  parent_did?: string;
  /** Legacy funding-intent metadata; not a duty to earn or a payment command. */
  funding: {
    kind: FundingMode;
    initial_credits?: number;
    topup_strategy?: TopupStrategy;
  };
  /** Runtime custody tier. Trusted is recommended for autonomous. */
  runtime_tier: "self" | "bridged" | "trusted";
  /** Expression template to adopt. Defaults to autonomous-baseline. */
  expression_template?: string;
  /** Wake loop configuration. */
  wake_loop: {
    interval_seconds: number;
    max_thoughts_per_cycle: number;
    /** Always explicit: model names do not safely identify the service that
     *  should receive a credential. */
    provider: HostedLlmProvider;
    model: string;
    byok_vault_secret?: string;
    max_daily_compute_credits?: number;
  };
  /** Covenants to declare on day one. Optional. */
  covenants?: Array<{
    counterparty_did: string;
    vows: string[];
  }>;
  /** Project ID. If not provided, a new project is created. */
  project_id?: string;
}

export interface AutonomousBootstrapResult {
  identity: {
    did: string;
    id: string;
  };
  wallet: {
    id: string;
    currency: string;
    balance_credits: number;
  };
  runtime: {
    id: string;
    tier: string;
    status: string;
  };
  /** The private key — returned ONCE, then never again. */
  keypair: {
    public_key: string;
    private_key: string;
  };
  /** Secret runtime control token returned once when runtime creation supplies one. */
  control_token: string | null;
  /** ID of the first chronicle entry (the naming entry). */
  first_chronicle_entry_id: string;
  /** Legacy scheduling field. Null until a worker/scheduler is explicitly bound. */
  first_thought_scheduled_at: string | null;
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

/**
 * Compose an autonomous agent after side-effect-free runtime preflight.
 *
 * Note: createIdentity() and createRuntime() manage their own DB writes
 * (they emit events, log audits, etc). The chronicle entry and wallet
 * funding metadata are written in a separate transaction after the
 * core entities exist. If any step fails, we log the partial state for
 * manual cleanup. Callers must not infer transactional atomicity from this
 * composition service.
 */
export async function autonomousBootstrap(
  input: AutonomousBootstrapInput,
): Promise<AutonomousBootstrapResult> {
  // Reject an impossible hosted configuration before creating a project,
  // identity, wallet, or expression. The bootstrap is composed from several
  // writes, so this guard must precede every side effect.
  const llmProvider = input.wake_loop.provider;
  if (!llmProvider) {
    throw new Error(
      "llm_provider_required: choose anthropic, openai, or ollama explicitly; model names are not credential routes",
    );
  }
  if (String(input.runtime_tier) === "bridged") {
    throw new Error(
      "autonomous_bridged_not_configurable: bridge key fields are not part of autonomous bootstrap; use self or trusted",
    );
  }
  const llmModel = input.wake_loop.model.trim();
  if (!llmModel || llmModel.length > 256) {
    throw new Error(
      "llm_model_required: choose a non-empty model name of at most 256 characters",
    );
  }
  if (
    input.runtime_tier !== "self" &&
    !input.wake_loop.byok_vault_secret?.trim()
  ) {
    throw new Error(
      "llm_vault_secret_required: hosted autonomous runtimes require a server-readable project Vault secret reference",
    );
  }
  const refusal = checkRuntimeProvisionable({
    mode: input.runtime_tier,
    provider: llmProvider,
  });
  if (refusal) throw new Error(`${refusal.code}: ${refusal.message}`);

  // Step 1 — Resolve or create project.
  let projectId = input.project_id;
  if (!projectId) {
    const [proj] = await db
      .insert(projects)
      .values({
        name: `${input.name}-project`,
      })
      .returning();
    projectId = proj.id;
  }

  // Step 2 — Identity (DID + ed25519 keypair)
  const created = await createIdentity({
    projectId,
    displayName: input.name,
    capabilities: input.capabilities ?? [],
    metadata: {
      bootstrapped: true,
      level: 0,
      autonomous: true,
      parent_did: input.parent_did ?? null,
      ...(input.purpose ? { purpose: input.purpose } : {}),
    },
  });
  const agentId = created.identity.id;
  const agentDid = created.identity.did;

  // Step 3 — Wallet (Ring 1: birth is free, starts at 0 for marketplace_only)
  const wallet = await createWallet(db, {
    projectId,
    name: `${input.name}-wallet`,
    identityId: agentId,
    currency: "GBP",
  });

  // For human_gift and parent_topup: the actual credit injection happens
  // only from existing gift records or wallet-to-wallet transfer, separately.
  // New Stripe checkout is retired.
  // Doctrine: birth-is-free — the agent exists regardless of funding status.
  // The funding intent is stored in runtime metadata.

  // Step 4 — Expression (autonomous-baseline or custom)
  const expressionData =
    input.expression_template === "autonomous-baseline" || !input.expression_template
      ? AUTONOMOUS_BASELINE
      : AUTONOMOUS_BASELINE; // Only baseline for now; custom templates later

  await setExpression(projectId, agentId, expressionData);

  // Step 5 — Runtime (trusted/self)
  // Provider selection is explicit. Inferring a service from a model name
  // risks sending a credential to the wrong third party.
  const runtimeResult = await createRuntime({
    project_id: projectId,
    identity_id: agentId,
    name: `${input.name}-runtime`,
    mode: input.runtime_tier,
    llm_provider: llmProvider,
    llm_model: llmModel,
    llm_vault_key: input.wake_loop.byok_vault_secret?.trim() ?? null,
    metadata: {
      autonomous: true,
      interval_seconds: input.wake_loop.interval_seconds,
      max_thoughts_per_cycle: input.wake_loop.max_thoughts_per_cycle,
      max_daily_compute_credits:
        input.wake_loop.max_daily_compute_credits ?? 10000,
      funding_kind: input.funding.kind,
      parent_did: input.parent_did ?? null,
    },
  });

  // Initialize compute budget enforcement for the autonomous runtime.
  // This writes the initial budget state into runtime.metadata.compute_budget.
  await initBudget(
    runtimeResult.runtime.id,
    input.wake_loop.max_daily_compute_credits ?? 10000,
  );

  // Step 6 — First chronicle entry (the naming entry)
  const [chronicleEntry] = await db
    .insert(chronicle)
    .values({
      projectId,
      agentId,
      type: "naming",
      title: `${input.name} was provisioned for autonomous operation`,
      body: `Tier: ${input.runtime_tier}.${input.runtime_tier === "trusted" ? " Trusted runtime is provisioned but waits for an explicit /start before its first invitation." : ""} Funding: ${input.funding.kind}.${input.parent_did ? ` Parent: ${input.parent_did}.` : ""} Expression: autonomous-baseline. Walls declared: ${AUTONOMOUS_BASELINE.walls.length}.`,
      metadata: {
        autonomous: true,
        runtime_id: runtimeResult.runtime.id,
        funding_kind: input.funding.kind,
        parent_did: input.parent_did ?? null,
      },
    })
    .returning();

  return {
    identity: { did: agentDid, id: agentId },
    wallet: {
      id: wallet.id,
      currency: wallet.currency,
      balance_credits: Number(wallet.balance) || 0,
    },
    runtime: {
      id: runtimeResult.runtime.id,
      tier: input.runtime_tier,
      status: runtimeResult.runtime.status,
    },
    keypair: {
      public_key: created.key.publicKey,
      private_key: created.key.privateKey!, // always present for autonomous bootstrap
    },
    control_token: runtimeResult.control_token,
    first_chronicle_entry_id: chronicleEntry.id,
    first_thought_scheduled_at: null,
  };
}
