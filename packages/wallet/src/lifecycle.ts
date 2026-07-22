import { WalletProtocolError } from "./errors.js";
import { assertBoundedString, assertTimestamp } from "./identifiers.js";
import { assertSignedPayloadMatchesRequest } from "./provider.js";
import type {
  BroadcastLookup,
  BroadcastResult,
  OperationState,
  OperationStatus,
  SigningLookup,
  SigningRequest,
} from "./types.js";

const TRANSITIONS: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = Object.freeze({
  reserved: ["signing", "rejected_pre_submit"],
  signing: ["signed", "signing_unknown", "rejected_pre_submit"],
  signing_unknown: [],
  signed: ["submitting", "rejected_pre_submit"],
  submitting: ["submitted", "submission_unknown", "rejected_pre_submit"],
  submission_unknown: [],
  submitted: ["confirmed", "reorged"],
  confirmed: ["reorged"],
  rejected_pre_submit: [],
  reorged: ["submitted", "confirmed"],
});

function applyTransition(
  current: OperationState,
  next: OperationStatus,
  at: string,
  operationId: string | null = current.operation_id,
  evidenceResolution = false,
): Readonly<OperationState> {
  assertTimestamp(current.updated_at, "operation.updated_at");
  assertTimestamp(at, "operation.transition_at");
  if (Date.parse(at) < Date.parse(current.updated_at)) {
    throw new WalletProtocolError("INVALID_STATE_TRANSITION", "Operation time cannot move backwards.");
  }
  const allowedByEvidence = evidenceResolution && (
    (current.status === "signing_unknown" && next === "signed")
    || (current.status === "submission_unknown" && next === "submitted")
  );
  if (!TRANSITIONS[current.status].includes(next) && !allowedByEvidence) {
    throw new WalletProtocolError(
      "INVALID_STATE_TRANSITION",
      `Operation cannot transition ${current.status} -> ${next}.`,
    );
  }
  if (operationId !== null) assertBoundedString(operationId, "operation.operation_id", 512);
  if (current.operation_id !== null && operationId !== current.operation_id) {
    throw new WalletProtocolError("INVALID_STATE_TRANSITION", "operation_id is immutable once known.");
  }
  return Object.freeze({ status: next, updated_at: at, operation_id: operationId });
}

export function transitionOperation(
  current: OperationState,
  next: OperationStatus,
  at: string,
  operationId: string | null = current.operation_id,
): Readonly<OperationState> {
  return applyTransition(current, next, at, operationId);
}

export function mayInvokeSigner(state: OperationState): boolean {
  return state.status === "reserved";
}

export function mayBroadcast(state: OperationState): boolean {
  return state.status === "signed";
}

export function applyBroadcastResult(
  submitting: OperationState,
  result: BroadcastResult,
  at: string,
): Readonly<OperationState> {
  if (submitting.status !== "submitting") {
    throw new WalletProtocolError("INVALID_STATE_TRANSITION", "Broadcast result requires submitting state.");
  }
  if (result.status === "accepted") {
    return transitionOperation(submitting, "submitted", at, result.operation_id);
  }
  if (result.status === "rejected") {
    return transitionOperation(submitting, "rejected_pre_submit", at);
  }
  return transitionOperation(submitting, "submission_unknown", at, result.operation_id);
}

/** Lookup failure or absence never authorizes an automatic retry or refund. */
export function reconcileSubmissionUnknown(
  state: OperationState,
  lookup: BroadcastLookup,
  at: string,
): Readonly<OperationState> {
  if (state.status !== "submission_unknown") {
    throw new WalletProtocolError("INVALID_STATE_TRANSITION", "Reconciliation requires submission_unknown.");
  }
  if (lookup.status !== "found") return state;
  const submitted = applyTransition(state, "submitted", at, lookup.operation_id, true);
  return lookup.confirmed ? transitionOperation(submitted, "confirmed", at) : submitted;
}

/** Only a recovered payload that still binds the exact request resolves signer uncertainty. */
export function reconcileSigningUnknown(
  state: OperationState,
  request: SigningRequest,
  lookup: SigningLookup,
  at: string,
): Readonly<OperationState> {
  if (state.status !== "signing_unknown") {
    throw new WalletProtocolError("INVALID_STATE_TRANSITION", "Reconciliation requires signing_unknown.");
  }
  if (lookup.status !== "found") return state;
  assertSignedPayloadMatchesRequest(request, lookup.payload);
  return applyTransition(state, "signed", at, state.operation_id, true);
}
