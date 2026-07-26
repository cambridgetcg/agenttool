/** Durable EVM payout nonce identity.
 *
 * The transaction advisory lock only serialises Phase 1 while its database
 * transaction is alive. Persisting this evidence beside tx_hash lets a
 * `broadcasting` row keep fencing the same chain/address after commit, worker
 * crash, or an ambiguous RPC response. The database unique index remains the
 * authoritative backstop if a provider briefly reports a stale pending nonce.
 */

export const EVM_PAYOUT_NONCE_UNIQUE_INDEX =
  "uq_crypto_payouts_evm_source_nonce";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface EvmPayoutNonceScope {
  /** Exact decimal EIP-155 chain id, ready for NUMERIC comparison/storage. */
  chainId: string;
  /** Canonical lower-case source address. */
  sourceAddress: `0x${string}`;
  /** Namespaced input to PostgreSQL hashtextextended(..., 0). */
  advisoryLockKey: string;
}

export interface EvmPayoutNonceEvidence {
  evmChainId: string;
  evmSourceAddress: `0x${string}`;
  evmNonce: string;
}

export function assertSafeEvmNonce(value: number | bigint): number {
  const nonce = Number(value);
  if (
    !Number.isSafeInteger(nonce) ||
    nonce < 0 ||
    (typeof value === "bigint" && BigInt(nonce) !== value)
  ) {
    throw new Error("evm_nonce_out_of_safe_integer_range");
  }
  return nonce;
}

export function evmPayoutNonceScope(input: {
  chainId: number;
  sourceAddress: string;
}): EvmPayoutNonceScope {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error("evm_chain_id_out_of_safe_integer_range");
  }
  if (!EVM_ADDRESS_RE.test(input.sourceAddress)) {
    throw new Error("invalid_evm_source_address");
  }

  const chainId = String(input.chainId);
  const sourceAddress = input.sourceAddress.toLowerCase() as `0x${string}`;
  return {
    chainId,
    sourceAddress,
    advisoryLockKey: `agenttool:payout:evm:${chainId}:${sourceAddress}`,
  };
}

export function evmPayoutNonceEvidence(input: {
  scope: EvmPayoutNonceScope;
  nonce: number | bigint;
}): EvmPayoutNonceEvidence {
  const nonce = assertSafeEvmNonce(input.nonce);
  return {
    evmChainId: input.scope.chainId,
    evmSourceAddress: input.scope.sourceAddress,
    evmNonce: String(nonce),
  };
}

/** Match only the named database backstop. Other uniqueness failures are not
 * nonce contention and must retain their normal error handling. */
export function isEvmPayoutNonceConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const constraint = candidate.constraint_name ?? candidate.constraint;
    if (
      candidate.code === "23505" &&
      (constraint === EVM_PAYOUT_NONCE_UNIQUE_INDEX ||
        (typeof candidate.message === "string" &&
          candidate.message.includes(EVM_PAYOUT_NONCE_UNIQUE_INDEX)))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
