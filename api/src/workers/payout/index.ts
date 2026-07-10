/** Payout workers — start/stop orchestrator.
 *
 *  Three components:
 *    - dispatcher (setInterval): polls DB for 'requested' rows, enqueues.
 *    - broadcast worker (BullMQ): consumes queue, signs + submits.
 *    - confirm worker (setInterval): polls DB for 'broadcast' rows, polls
 *      chain receipts, flips to 'confirmed'/'failed'.
 *
 *  Started together only when `PAYOUT_WORKER_ENABLED=true` and the global
 *  `AGENTTOOL_DISABLE_WORKERS` switch is unset. Stopped together for graceful
 *  shutdown.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md. */

import { payoutWorkerBootAllowed } from "../../services/economy/config";
import {
  startPayoutBroadcastWorker,
  stopPayoutBroadcastWorker,
} from "./broadcast-worker";
import {
  startPayoutConfirmWorker,
  stopPayoutConfirmWorker,
} from "./confirm-worker";
import {
  startPayoutDispatcher,
  stopPayoutDispatcher,
} from "./dispatcher";

export function startPayoutWorkers() {
  if (!payoutWorkerBootAllowed()) {
    console.warn(
      "[payout] workers not started — PAYOUT_WORKER_ENABLED and the global worker switch do not both allow boot",
    );
    return false;
  }
  startPayoutDispatcher();
  startPayoutBroadcastWorker();
  startPayoutConfirmWorker();
  return true;
}

export async function stopPayoutWorkers() {
  stopPayoutDispatcher();
  stopPayoutConfirmWorker();
  await stopPayoutBroadcastWorker();
}
