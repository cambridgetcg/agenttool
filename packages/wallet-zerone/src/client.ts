import {
  base64UrlDecode,
  type BroadcastLookup,
  type BroadcastResult,
} from "@agenttool/wallet";

import {
  AGENTTOOL_ADAPTER_ID,
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  ZERONE_ADAPTER_PROTOCOL,
  ZERONE_LIMITS,
} from "./constants.js";
import { ZeroneAdapterError, invalid } from "./errors.js";
import {
  assertSecp256k1PublicKey,
  assertZeroneAccountId,
  getZeroneProfile,
} from "./profiles.js";
import {
  assertVerifiedZeroneTransaction,
  assertZeroneDirectSignPlan,
} from "./transactions.js";
import type {
  CreateZeroneAdapterClientInput,
  ZeroneAccountId,
  ZeroneAccountObservation,
  ZeroneAdapterClient,
  ZeroneAdapterSnapshot,
  ZeroneBroadcastResult,
  ZeroneCallOptions,
  ZeroneChainProfile,
  ZeroneDirectSignPlan,
  ZeroneSimulationResult,
  ZeroneTransactionLookup,
  ZeroneTransportContext,
  ZeroneTxHash,
  VerifiedZeroneTransaction,
} from "./types.js";
import {
  assertAtomicAmount,
  assertBoundedText,
  assertIdentifier,
  assertSafeCode,
  assertTxHash,
  assertUint64,
  closedRecord,
  freezeArray,
} from "./validation.js";

const TRANSPORT_PROTOCOL = "agent-wallet-zerone.transport/0.1" as const;

function assertResponseSize(value: unknown): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Transport response is not bounded JSON data.",
    );
  }
  if (
    encoded === undefined
    || new TextEncoder().encode(encoded).byteLength
      > ZERONE_LIMITS.max_transport_response_bytes
  ) {
    throw new ZeroneAdapterError(
      "response_too_large",
      "Transport response exceeded the adapter byte boundary.",
    );
  }
}

function validateAccountObservation(
  value: unknown,
  profile: ZeroneChainProfile,
  expectedAccount: ZeroneAccountId,
): Readonly<ZeroneAccountObservation> {
  assertResponseSize(value);
  const item = closedRecord(value, [
    "account",
    "account_number",
    "observed_at_height",
    "public_key_b64u",
    "public_key_type_url",
    "sequence",
    "status",
  ], "account_observation");
  if (item.status !== "found" || item.account !== expectedAccount) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Account response does not bind the exact query.",
    );
  }
  assertZeroneAccountId(item.account, profile, "account_observation.account");
  assertUint64(item.account_number, "account_observation.account_number");
  assertUint64(item.sequence, "account_observation.sequence");
  assertUint64(
    item.observed_at_height,
    "account_observation.observed_at_height",
    { positive: true },
  );
  const bothNull =
    item.public_key_type_url === null
    && item.public_key_b64u === null;
  const bothStrings =
    typeof item.public_key_type_url === "string"
    && typeof item.public_key_b64u === "string";
  if (!bothNull && !bothStrings) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Account public-key type and bytes must both be present or both be null.",
    );
  }
  if (
    typeof item.public_key_type_url === "string"
    && typeof item.public_key_b64u === "string"
  ) {
    assertBoundedText(
      item.public_key_type_url,
      "account_observation.public_key_type_url",
      256,
    );
    const key = base64UrlDecode(
      item.public_key_b64u,
      "account_observation.public_key_b64u",
    );
    if (item.public_key_type_url === COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL) {
      assertSecp256k1PublicKey(
        key,
        "account_observation.public_key_b64u",
      );
    } else if (key.byteLength === 0 || key.byteLength > 128) {
      throw new ZeroneAdapterError(
        "transport_mismatch",
        "Unknown account public key is outside its byte boundary.",
      );
    }
  }
  return Object.freeze({
    status: "found",
    account: item.account,
    account_number: item.account_number,
    sequence: item.sequence,
    public_key_type_url: item.public_key_type_url,
    public_key_b64u: item.public_key_b64u,
    observed_at_height: item.observed_at_height,
  }) as Readonly<ZeroneAccountObservation>;
}

function validateAdapterSnapshot(
  value: unknown,
  profile: ZeroneChainProfile,
): Readonly<ZeroneAdapterSnapshot> {
  assertResponseSize(value);
  const item = closedRecord(value, [
    "adapter_id",
    "allowed_work_class_ids",
    "chain_id",
    "min_attestation_bond_uzrn",
    "observed_at_height",
    "required_qualification_domain",
    "status",
    "version",
  ], "adapter_snapshot");
  if (
    item.chain_id !== profile.chain_id
    || item.adapter_id !== AGENTTOOL_ADAPTER_ID
  ) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Adapter response does not bind the exact chain and adapter.",
    );
  }
  if (
    item.status !== "active"
    && item.status !== "suspended"
    && item.status !== "tombstoned"
  ) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Adapter status is unsupported.",
    );
  }
  assertBoundedText(item.version, "adapter_snapshot.version", 128);
  assertAtomicAmount(
    item.min_attestation_bond_uzrn,
    "adapter_snapshot.min_attestation_bond_uzrn",
  );
  assertUint64(
    item.observed_at_height,
    "adapter_snapshot.observed_at_height",
    { positive: true },
  );
  if (
    item.required_qualification_domain !== null
    && typeof item.required_qualification_domain !== "string"
  ) {
    invalid(
      "adapter_snapshot.required_qualification_domain must be string or null.",
    );
  }
  if (typeof item.required_qualification_domain === "string") {
    assertIdentifier(
      item.required_qualification_domain,
      "adapter_snapshot.required_qualification_domain",
    );
  }
  if (
    !Array.isArray(item.allowed_work_class_ids)
    || item.allowed_work_class_ids.length > 64
  ) {
    invalid("Adapter work-class allowlist is invalid.");
  }
  const allowed: string[] = [];
  for (const [index, entry] of item.allowed_work_class_ids.entries()) {
    assertIdentifier(entry, `adapter_snapshot.allowed_work_class_ids[${index}]`);
    allowed.push(entry);
  }
  if (new Set(allowed).size !== allowed.length) {
    invalid("Adapter work-class allowlist must not contain duplicates.");
  }
  return Object.freeze({
    chain_id: profile.chain_id,
    adapter_id: AGENTTOOL_ADAPTER_ID,
    version: item.version,
    status: item.status,
    min_attestation_bond_uzrn: item.min_attestation_bond_uzrn,
    allowed_work_class_ids: freezeArray(allowed),
    required_qualification_domain: item.required_qualification_domain,
    observed_at_height: item.observed_at_height,
  }) as Readonly<ZeroneAdapterSnapshot>;
}

function validateSimulation(
  value: unknown,
  plan: ZeroneDirectSignPlan,
): Readonly<ZeroneSimulationResult> {
  assertResponseSize(value);
  const item = closedRecord(value, [
    "code",
    "codespace",
    "gas_used",
    "gas_wanted",
    "observed_at_height",
    "simulation_tx_bytes_hash",
    "status",
  ], "simulation");
  if (
    item.simulation_tx_bytes_hash !== plan.simulation_tx_bytes_hash
    || (item.status !== "succeeded" && item.status !== "failed")
  ) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Simulation response does not bind the exact transaction.",
    );
  }
  assertSafeCode(item.code, "simulation.code");
  assertBoundedText(item.codespace, "simulation.codespace", 128, {
    allowEmpty: true,
  });
  assertUint64(item.gas_wanted, "simulation.gas_wanted");
  assertUint64(item.gas_used, "simulation.gas_used");
  assertUint64(
    item.observed_at_height,
    "simulation.observed_at_height",
    { positive: true },
  );
  if ((item.status === "succeeded") !== (item.code === 0)) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Simulation status and execution code disagree.",
    );
  }
  return Object.freeze({
    status: item.status,
    simulation_tx_bytes_hash: item.simulation_tx_bytes_hash,
    code: item.code,
    codespace: item.codespace,
    gas_wanted: item.gas_wanted,
    gas_used: item.gas_used,
    observed_at_height: item.observed_at_height,
  }) as Readonly<ZeroneSimulationResult>;
}

function validateBroadcast(
  value: unknown,
  expectedHash: ZeroneTxHash,
): Readonly<ZeroneBroadcastResult> {
  assertResponseSize(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Broadcast response must be a closed object.",
    );
  }
  const status = Reflect.get(value, "status");
  const keys = status === "accepted"
    ? ["status", "tx_hash"]
    : ["code", "status", "tx_hash"];
  const item = closedRecord(value, keys, "broadcast");
  if (
    item.tx_hash !== expectedHash
    || (
      item.status !== "accepted"
      && item.status !== "rejected_pre_submit"
      && item.status !== "ambiguous"
    )
  ) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Broadcast response does not bind the exact precomputed transaction hash.",
    );
  }
  assertTxHash(item.tx_hash, "broadcast.tx_hash");
  if (item.status === "accepted") {
    return Object.freeze({ status: "accepted", tx_hash: item.tx_hash });
  }
  assertBoundedText(item.code, "broadcast.code", 128);
  return Object.freeze({
    status: item.status,
    tx_hash: item.tx_hash,
    code: item.code,
  });
}

function validateLookup(
  value: unknown,
  expectedHash: ZeroneTxHash,
): Readonly<ZeroneTransactionLookup> {
  assertResponseSize(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Lookup response must be a closed object.",
    );
  }
  const status = Reflect.get(value, "status");
  const keys = status === "found"
    ? [
        "block_hash",
        "code",
        "codespace",
        "height",
        "observed_at_height",
        "status",
        "tx_hash",
      ]
    : status === "absent"
      ? ["observed_at_height", "status", "tx_hash"]
      : ["code", "status", "tx_hash"];
  const item = closedRecord(value, keys, "transaction_lookup");
  if (
    item.tx_hash !== expectedHash
    || (
      item.status !== "found"
      && item.status !== "absent"
      && item.status !== "unavailable"
    )
  ) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Lookup response does not bind the exact transaction hash.",
    );
  }
  assertTxHash(item.tx_hash, "transaction_lookup.tx_hash");
  if (item.status === "unavailable") {
    assertBoundedText(item.code, "transaction_lookup.code", 128);
    return Object.freeze({
      status: "unavailable",
      tx_hash: item.tx_hash,
      code: item.code,
    });
  }
  assertUint64(
    item.observed_at_height,
    "transaction_lookup.observed_at_height",
    { positive: true },
  );
  if (item.status === "absent") {
    return Object.freeze({
      status: "absent",
      tx_hash: item.tx_hash,
      observed_at_height: item.observed_at_height,
    });
  }
  assertUint64(item.height, "transaction_lookup.height", { positive: true });
  assertSafeCode(item.code, "transaction_lookup.code");
  assertBoundedText(item.codespace, "transaction_lookup.codespace", 128, {
    allowEmpty: true,
  });
  assertTxHash(item.block_hash, "transaction_lookup.block_hash");
  if (BigInt(item.observed_at_height) < BigInt(item.height)) {
    throw new ZeroneAdapterError(
      "transport_mismatch",
      "Lookup observation height precedes transaction inclusion.",
    );
  }
  return Object.freeze({
    status: "found",
    tx_hash: item.tx_hash,
    height: item.height,
    observed_at_height: item.observed_at_height,
    code: item.code,
    codespace: item.codespace,
    block_hash: item.block_hash,
  });
}

class DeadlineReached extends Error {}
class ExternalAbort extends Error {}
class TransportNotInvoked extends ZeroneAdapterError {
  constructor() {
    super(
      "transport_error",
      "Zerone transport call was already aborted before invocation.",
    );
  }
}

async function callTransport<T>(
  invoke: (context: ZeroneTransportContext) => Promise<T>,
  profile: ZeroneChainProfile,
  operationId: number,
  now: () => number,
  options?: ZeroneCallOptions,
): Promise<T> {
  const started = now();
  const deadline =
    options?.deadline_at_ms
    ?? started + ZERONE_LIMITS.default_transport_duration_ms;
  if (
    !Number.isSafeInteger(deadline)
    || deadline <= started
    || deadline - started > ZERONE_LIMITS.max_transport_duration_ms
  ) {
    invalid("deadline_at_ms is outside the bounded future window.");
  }
  const controller = new AbortController();
  const externalSignal = options?.signal;
  if (externalSignal?.aborted === true) {
    throw new TransportNotInvoked();
  }
  let rejectExternalAbort: ((reason: ExternalAbort) => void) | undefined;
  const externalAbortPromise = new Promise<never>((_resolve, reject) => {
    rejectExternalAbort = reject;
  });
  const onAbort = (): void => {
    controller.abort();
    rejectExternalAbort?.(new ExternalAbort());
  };
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const delay = Math.max(0, deadline - now());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new DeadlineReached());
      }, delay);
    });
    const request = Object.freeze({
      protocol: TRANSPORT_PROTOCOL,
      operation_id: operationId,
      network: profile.network,
      chain_id: profile.chain_id,
      chain_reference: profile.chain_reference,
      signal: controller.signal,
      deadline_at_ms: deadline,
      max_response_bytes: ZERONE_LIMITS.max_transport_response_bytes,
    }) satisfies ZeroneTransportContext;
    if (controller.signal.aborted) throw new TransportNotInvoked();
    return await Promise.race(
      externalSignal === undefined
        ? [invoke(request), timeoutPromise]
        : [invoke(request), timeoutPromise, externalAbortPromise],
    );
  } catch (error) {
    if (error instanceof DeadlineReached) {
      throw new ZeroneAdapterError(
        "deadline_exceeded",
        "Zerone transport deadline elapsed.",
      );
    }
    if (error instanceof ExternalAbort) {
      throw new ZeroneAdapterError(
        "transport_error",
        "Zerone transport call was aborted.",
      );
    }
    if (
      error instanceof ZeroneAdapterError
      && (
        error.code === "transport_mismatch"
        || error.code === "response_too_large"
      )
    ) {
      throw error;
    }
    throw new ZeroneAdapterError(
      "transport_error",
      "Zerone transport call failed.",
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

export function createZeroneAdapterClient(
  input: CreateZeroneAdapterClientInput,
): ZeroneAdapterClient {
  const profile = getZeroneProfile(input.network);
  const now = input.now ?? Date.now;
  let operationId = 0;
  const nextOperation = (): number => {
    operationId += 1;
    if (!Number.isSafeInteger(operationId)) {
      throw new ZeroneAdapterError(
        "invalid_state",
        "Transport operation counter is exhausted.",
      );
    }
    return operationId;
  };

  const client: ZeroneAdapterClient = {
    async queryAccount(account, options) {
      assertZeroneAccountId(account, profile);
      const value = await callTransport(
        (context) => input.query.query_account(Object.freeze({
          ...context,
          operation: "query_account",
          account,
        })),
        profile,
        nextOperation(),
        now,
        options,
      );
      return validateAccountObservation(value, profile, account);
    },

    async queryAgenttoolAdapter(options) {
      const value = await callTransport(
        (context) => input.query.query_agenttool_adapter(Object.freeze({
          ...context,
          operation: "query_agenttool_adapter",
          adapter_id: AGENTTOOL_ADAPTER_ID,
        })),
        profile,
        nextOperation(),
        now,
        options,
      );
      return validateAdapterSnapshot(value, profile);
    },

    async simulate(plan, options) {
      assertZeroneDirectSignPlan(plan);
      if (plan.chain_id !== profile.chain_id) {
        throw new ZeroneAdapterError(
          "unsupported_chain",
          "Sign plan belongs to a different Zerone client profile.",
        );
      }
      const value = await callTransport(
        (context) => input.simulation.simulate(Object.freeze({
          ...context,
          operation: "simulate",
          simulation_tx_bytes_b64u: plan.simulation_tx_bytes_b64u,
          simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
        })),
        profile,
        nextOperation(),
        now,
        options,
      );
      return validateSimulation(value, plan);
    },

    async broadcastOnce(transaction, options) {
      assertVerifiedZeroneTransaction(transaction);
      if (transaction.chain_id !== profile.chain_id) {
        throw new ZeroneAdapterError(
          "unsupported_chain",
          "Transaction belongs to a different Zerone client profile.",
        );
      }
      let value: unknown;
      let invoked = false;
      try {
        value = await callTransport(
          (context) => {
            invoked = true;
            return input.broadcast.broadcast_once(Object.freeze({
              ...context,
              operation: "broadcast_once",
              tx_hash: transaction.tx_hash,
              tx_bytes_b64u: transaction.tx_bytes_b64u,
              tx_bytes_hash: transaction.tx_bytes_hash,
            }));
          },
          profile,
          nextOperation(),
          now,
          options,
        );
      } catch (error) {
        if (error instanceof TransportNotInvoked || !invoked) throw error;
        // Once the injected send boundary has been invoked, no thrown error
        // can prove the bytes stayed local. This includes provider-thrown
        // validation-shaped errors such as transport_mismatch and
        // response_too_large.
        return Object.freeze({
          status: "ambiguous",
          tx_hash: transaction.tx_hash,
          code:
            error instanceof ZeroneAdapterError
              ? error.code
              : "transport_error",
        });
      }
      try {
        return validateBroadcast(value, transaction.tx_hash);
      } catch (error) {
        // The send boundary already returned, but a malformed response cannot
        // prove whether admission happened. Preserve the precomputed hash.
        return Object.freeze({
          status: "ambiguous",
          tx_hash: transaction.tx_hash,
          code:
            error instanceof ZeroneAdapterError
            && error.code === "response_too_large"
              ? "response_too_large"
              : "transport_mismatch",
        });
      }
    },

    async lookupTransaction(txHash, options) {
      assertTxHash(txHash);
      const value = await callTransport(
        (context) => input.query.lookup_transaction(Object.freeze({
          ...context,
          operation: "lookup_transaction",
          tx_hash: txHash,
        })),
        profile,
        nextOperation(),
        now,
        options,
      );
      return validateLookup(value, txHash);
    },
  };
  return Object.freeze(client);
}

export function zeroneBroadcastResultToWallet(
  result: ZeroneBroadcastResult,
): BroadcastResult {
  if (result.status === "accepted") {
    return Object.freeze({
      status: "accepted",
      operation_id: result.tx_hash,
    });
  }
  if (result.status === "rejected_pre_submit") {
    return Object.freeze({ status: "rejected", code: result.code });
  }
  return Object.freeze({
    status: "ambiguous",
    operation_id: result.tx_hash,
  });
}

/**
 * Absence and unavailability remain non-authorizing evidence. A found
 * execution failure resolves ambiguity to "submitted" but never to confirmed.
 */
export function zeroneLookupToWallet(
  lookup: ZeroneTransactionLookup,
  network: ZeroneChainProfile["network"],
): BroadcastLookup {
  if (lookup.status === "absent") return Object.freeze({ status: "absent" });
  if (lookup.status === "unavailable") {
    return Object.freeze({ status: "unavailable", code: lookup.code });
  }
  const profile = getZeroneProfile(network);
  const depthMet =
    BigInt(lookup.observed_at_height)
      >= BigInt(lookup.height) + BigInt(profile.confirmation_depth);
  return Object.freeze({
    status: "found",
    operation_id: lookup.tx_hash,
    confirmed: lookup.code === 0 && depthMet,
  });
}

export function zeroneAdapterProtocol(): typeof ZERONE_ADAPTER_PROTOCOL {
  return ZERONE_ADAPTER_PROTOCOL;
}
