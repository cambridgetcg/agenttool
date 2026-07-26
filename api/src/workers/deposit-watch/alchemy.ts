/**
 * Environment composition for the durable Alchemy deposit-watch worker.
 *
 * The worker starts only when both the Notify control token and an explicit
 * public callback origin are configured. It scopes the existing per-chain
 * webhook IDs to the single active payout/deposit network; it does not invent
 * a production URL, create webhooks, or run when the global worker switch is
 * off (the caller in `src/index.ts` owns that gate).
 */

import { randomUUID } from "node:crypto";

import {
  ALCHEMY_WATCH_EVM_CHAINS,
  createAlchemyDepositWatchReconciler,
  type AlchemyWatchReconcilerConfig,
} from "../../services/economy/crypto/alchemy-watch-reconciler";
import {
  alchemyNotifyConfig,
} from "../../services/economy/crypto/alchemy-notify";
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

function explicitHttpsOrigin(value: string | undefined): string | null {
  if (!value || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname !== "/"
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Pure config builder for tests and startup diagnostics. Secret values remain
 * in memory and are never returned through a route, log, or error message.
 */
export function alchemyDepositWatchConfigFromEnv(
  env: NodeJS.ProcessEnv,
  network: ActiveNetwork,
): AlchemyWatchReconcilerConfig | null {
  const notify = alchemyNotifyConfig(env);
  const callbackBaseUrl = explicitHttpsOrigin(
    env.AGENTTOOL_PUBLIC_URL,
  );
  if (!notify.authToken || callbackBaseUrl === null) return null;

  const webhookIds: AlchemyWatchReconcilerConfig["webhookIds"] = {};
  for (const chain of ALCHEMY_WATCH_EVM_CHAINS) {
    const webhookId = notify.webhookIds[chain];
    if (webhookId) webhookIds[chain] = { [network]: webhookId };
  }

  return {
    authToken: notify.authToken,
    callbackBaseUrl,
    webhookIds,
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
  const config = alchemyDepositWatchConfigFromEnv(
    env,
    options.network ?? activeNetwork(),
  );
  if (config === null) return "unconfigured";

  const reconciler = createAlchemyDepositWatchReconciler({
    config,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  worker = createDepositWatchWorker({
    owner: workerOwner(env, options.owner),
    reconciler,
  });
  worker.start();
  return "started";
}

export function stopAlchemyDepositWatchWorker(): void {
  worker?.stop();
  worker = null;
}
