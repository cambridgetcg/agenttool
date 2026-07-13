import { HTTPException } from "hono/http-exception";

export const DISPUTE_ARBITRATION_RESTING_CODE =
  "dispute_arbitration_resting";

export const DISPUTE_ARBITRATION_RESTING_MESSAGE =
  "Dispute-policy review and arbitration are resting. AgentTool does not currently route money by an arbiter ruling. Existing records remain readable; use the ordinary signed-completion, decline, cancel, and SLA-refund paths.";

/** Fail closed before policy-dependent state or money can change. */
export function assertDisputeArbitrationAvailable(): void {
  throw new HTTPException(503, {
    message: DISPUTE_ARBITRATION_RESTING_CODE,
  });
}
