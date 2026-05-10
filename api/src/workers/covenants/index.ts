import { startCosignPropagateWorker } from "./cosign-propagate";
import { startExpireProposalsWorker } from "./expire-proposals";
import { startReverifyWorker } from "./reverify";

export function startCovenantWorkers(): void {
  startCosignPropagateWorker();
  startExpireProposalsWorker();
  startReverifyWorker();
}
