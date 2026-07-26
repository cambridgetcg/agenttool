/** Payout workers — start/stop orchestrator.
 *
 *  Three components:
 *    - dispatcher (setInterval): polls DB for 'requested' rows, enqueues.
 *    - broadcast worker (BullMQ): consumes queue, signs + submits.
 *    - confirm worker (setInterval): polls DB for 'broadcast' rows, polls
 *      chain receipts, flips to 'confirmed'/'failed'.
 *
 *  Fresh payout execution is resting. The shared gate is unconditionally
 *  false in this release, regardless of environment values; these retained
 *  stop paths exist for graceful containment and a future reviewed redesign.
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
      "[payout] workers not started — payout admission and execution are resting until cashable backing is conserved",
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
