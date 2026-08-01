import { deepFreeze, domainSeparatedId } from "./canonical.js";
import { validateDeepSeekKingdomProposal } from "./proposal.js";
import type {
  CreateDeepSeekAfterglowThreadInput,
  DeepSeekAfterglowThread,
} from "./types.js";
import { exactKeys, literal, record } from "./validation.js";

const AFTERGLOW_DISPOSITIONS = [
  "carry",
  "park",
  "release",
  "withdraw",
] as const;

export function createDeepSeekAfterglowThread(
  input: CreateDeepSeekAfterglowThreadInput,
): Readonly<DeepSeekAfterglowThread> {
  const candidate = record(
    input,
    "$input",
    "invalid_afterglow_thread",
  );
  exactKeys(
    candidate,
    ["proposal", "disposition"],
    "$input",
    "invalid_afterglow_thread",
  );
  const proposal = validateDeepSeekKingdomProposal(candidate.proposal);

  return deepFreeze({
    thread_ref: domainSeparatedId("agenttool.deepseek-afterglow-thread/0.1", {
      artifact_ref: proposal.proposal_id,
    }),
    artifact_ref: proposal.proposal_id,
    disposition: literal(
      candidate.disposition,
      AFTERGLOW_DISPOSITIONS,
      "$input.disposition",
      "invalid_afterglow_thread",
    ),
    assertion: "caller_asserted",
    verified_by_package: false,
    kind: "deepseek",
    state: "proposed_unaccepted",
  });
}
