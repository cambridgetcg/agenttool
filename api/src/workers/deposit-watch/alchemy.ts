/**
 * Environment composition for the durable Alchemy deposit-watch worker.
 *
 * Active targets require the Notify control token and an explicit public
 * callback origin. Explicit disabled-chain tombstones do not: they cannot
 * claim work or contact Alchemy. Every binding is scoped to the single active
 * payout/deposit network and one monotonic revision. This module does not
 * invent a production URL, create webhooks, or run when the global worker
 * switch is off (the caller in `src/index.ts` owns that gate).
 */

import { randomUUID } from "node:crypto";

import {
  ALCHEMY_WATCH_EVM_CHAINS,
  createAlchemyDepositWatchReconciler,
  type AlchemyWatchReconcilerConfig,
} from "../../services/economy/crypto/alchemy-watch-reconciler";
import {
  alchemyNotifyConfig,
  alchemyDepositWatchTargetFingerprint,
  parseExplicitHttpsOrigin,
  parseAlchemyWatchDisabledChains,
  parseAlchemyWatchTargetRevision,
} from "../../services/economy/crypto/alchemy-notify";
import {
  bindDepositWatchTargets,
  DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
  type DepositWatchProviderReconciler,
  type DepositWatchTargetBinding,
} from "../../services/economy/crypto/deposit-watch";
import {
  activeNetwork,
  type ActiveNetwork,
} from "../../services/economy/crypto/network";
import {
  createDepositWatchWorker,
  type DepositWatchWorker,
} from "./reconcile";

const WORKER_OWNER_RE = /^[A-Za-z0-9._:-]{1,110}$/;

export type AlchemyDepositWatchBootResult =
  | "started"
  | "already_started"
  | "unconfigured";

let worker: DepositWatchWorker | null = null;

export interface AlchemyDepositWatchWorkerConfig {
  /** Null only for a disabled-only binding set, which cannot claim work. */
  reconcilerConfig: AlchemyWatchReconcilerConfig | null;
  /** Active heads plus explicit disabled tombstones prepared atomically. */
  targetBindings: readonly DepositWatchTargetBinding[];
  /** Exact active subset passed to the claim store. */
  claimTargets: readonly DepositWatchTargetBinding[];
  targetRevision: number;
}

/**
 * Compatibility helper for the active provider adapter configuration.
 * Disabled-only composition intentionally returns null here; the complete
 * worker builder below can still prepare those credential-free tombstones.
 */
export function alchemyDepositWatchConfigFromEnv(
  env: NodeJS.ProcessEnv,
  network: ActiveNetwork,
): AlchemyWatchReconcilerConfig | null {
  return alchemyDepositWatchWorkerConfigFromEnv(env, network)
    ?.reconcilerConfig ?? null;
}

/**
 * Build the complete worker boundary. Missing webhook IDs are omissions, not
 * disables. A chain is disabled only through the explicit tombstone list.
 * That declaration takes precedence for reconciliation while its webhook ID
 * may remain configured so signed deliveries for previously watched
 * addresses can still be authenticated.
 */
export function alchemyDepositWatchWorkerConfigFromEnv(
  env: NodeJS.ProcessEnv,
  network: ActiveNetwork,
): AlchemyDepositWatchWorkerConfig | null {
  const notify = alchemyNotifyConfig(env);
  const targetRevision = parseAlchemyWatchTargetRevision(
    env.ALCHEMY_WATCH_TARGET_REVISION,
  );
  const disabledChains = parseAlchemyWatchDisabledChains(
    env.ALCHEMY_WATCH_DISABLED_CHAINS,
  );
  if (targetRevision === null || disabledChains === null) return null;
  const disabled = new Set(disabledChains);

  const webhookIds: AlchemyWatchReconcilerConfig["webhookIds"] = {};
  const targetBindings: DepositWatchTargetBinding[] = [];
  const callbackBaseUrl = parseExplicitHttpsOrigin(
    env.AGENTTOOL_PUBLIC_URL,
  );
  const hasActiveTargets = ALCHEMY_WATCH_EVM_CHAINS.some(
    (chain) =>
      !disabled.has(chain) &&
      notify.webhookIds[chain] !== undefined,
  );
  if (
    hasActiveTargets &&
    (!notify.authToken || callbackBaseUrl === null)
  ) {
    return null;
  }
  const reconcilerConfig: AlchemyWatchReconcilerConfig | null =
    hasActiveTargets && callbackBaseUrl !== null
      ? {
          authToken: notify.authToken,
          callbackBaseUrl,
          webhookIds,
          targetRevision,
        }
      : null;

  for (const chain of ALCHEMY_WATCH_EVM_CHAINS) {
    const webhookId = notify.webhookIds[chain];
    if (disabled.has(chain)) {
      targetBindings.push({
        provider: "alchemy",
        chain,
        network,
        state: "disabled",
        targetFingerprint: DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
        targetRevision,
      });
    } else if (webhookId) {
      if (reconcilerConfig === null) return null;
      const fingerprint = alchemyDepositWatchTargetFingerprint({
        chain,
        network,
        webhookId,
        callbackBaseUrl: reconcilerConfig.callbackBaseUrl,
      });
      if (fingerprint === null) return null;
      webhookIds[chain] = { [network]: webhookId };
      targetBindings.push({
        provider: "alchemy",
        chain,
        network,
        state: "active",
        targetFingerprint: fingerprint,
        targetRevision,
      });
    }
  }
  if (targetBindings.length === 0) return null;

  return {
    reconcilerConfig,
    targetBindings,
    claimTargets: targetBindings.filter(
      (binding) => binding.state === "active",
    ),
    targetRevision,
  };
}

function workerOwner(
  env: NodeJS.ProcessEnv,
  explicitOwner?: string,
): string {
  const candidate = explicitOwner ?? env.FLY_ALLOC_ID?.trim();
  if (candidate && WORKER_OWNER_RE.test(candidate)) {
    return `alchemy:${candidate}`;
  }
  return `alchemy:${randomUUID()}`;
}

export function startAlchemyDepositWatchWorker(options: {
  env?: NodeJS.ProcessEnv;
  network?: ActiveNetwork;
  fetchImpl?: typeof fetch;
  owner?: string;
} = {}): AlchemyDepositWatchBootResult {
  if (worker?.isRunning()) return "already_started";

  const env = options.env ?? process.env;
  const config = alchemyDepositWatchWorkerConfigFromEnv(
    env,
    options.network ?? activeNetwork(),
  );
  if (config === null) return "unconfigured";

  const reconciler: DepositWatchProviderReconciler =
    config.reconcilerConfig === null
      ? async () => ({
          kind: "terminal",
          code: "provider_configuration_missing",
        })
      : createAlchemyDepositWatchReconciler({
          config: config.reconcilerConfig,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
  worker = createDepositWatchWorker({
    owner: workerOwner(env, options.owner),
    reconciler,
    targets: config.claimTargets,
    prepare: async () => {
      await bindDepositWatchTargets(config.targetBindings);
    },
  });
  worker.start();
  return "started";
}

export function stopAlchemyDepositWatchWorker(): void {
  worker?.stop();
  worker = null;
}
