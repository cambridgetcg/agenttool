/** Payout workers — start/stop orchestrator.
 *
 *  Three components:
 *    - dispatcher (setInterval): polls DB for 'requested' rows, enqueues.
 *    - broadcast worker (BullMQ): consumes queue, signs + submits.
 *    - confirm worker (setInterval): polls DB for 'broadcast' rows, polls
 *      chain receipts, flips to 'confirmed'/'failed'.
 *
 *  Started together when `economyConfig.payout.workerEnabled === true` and
 *  AGENTTOOL_DISABLE_WORKERS is not set. Stopped together for graceful
 *  shutdown.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md. */

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
  startPayoutDispatcher();
  startPayoutBroadcastWorker();
  startPayoutConfirmWorker();
}

export async function stopPayoutWorkers() {
  stopPayoutDispatcher();
  stopPayoutConfirmWorker();
  await stopPayoutBroadcastWorker();
}
