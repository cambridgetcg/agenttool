/** Solana transaction signing for payout broadcast — builds + signs an
 *  SPL USDC transfer using @solana/web3.js + @solana/spl-token.
 *
 *  Pattern mirrors `sign-evm.ts`: sign locally to get a deterministic
 *  signature (which IS Solana's tx-id), persist to DB as `tx_hash`, then
 *  submit. Worker crash between sign-and-submit is recoverable: another
 *  worker queries `solanaTxExists(sig)` to disambiguate *landed* from
 *  *never made it*.
 *
 *  USDC token model: USDC is an SPL token, so we transfer between the
 *  sender's and recipient's *associated token accounts* (ATAs), not their
 *  wallet addresses. The instruction list:
 *    1. createAssociatedTokenAccountIdempotent for the recipient
 *       — costs ~0.00204 SOL rent if it doesn't already exist; no-op
 *       if it does. Keeps the destination_address contract simple
 *       (caller passes a wallet, not an ATA).
 *    2. transferChecked from sender ATA → recipient ATA, owner=sender.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slice 3). */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type FetchFn,
  type TransactionSignature,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";

import { USDC_DECIMALS } from "./chains";
import { deriveSolanaKeypair } from "./hd";
import {
  activeMnemonic,
  activeUsdcMintSolana,
  solanaRpcUrl,
  SOLANA_CONFIRMATION,
} from "./network";

export interface BuildAndSignSolParams {
  payoutId: string;
  walletId: string;
  destinationAddress: string; // base58 wallet address (NOT a token account)
  amountBase: bigint;         // USDC base units (10^6 = 1 USDC)
}

export interface SignedSolanaTx {
  signature: TransactionSignature; // base58 — also stored as tx_hash in DB
  serialized: Uint8Array;
  fromAddress: string;
  toAddress: string;
  mintAddress: string;
}

const SOLANA_MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const PAYOUT_MEMO_DOMAIN = "agenttool-payout/v1";
const PAYOUT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOLANA_RPC_TIMEOUT_MS = 10_000;

/** Bound every Solana HTTP call, including the side-effecting submit call.
 *
 * A submit timeout remains ambiguous and is reconciled by deterministic
 * signature; aborting the local fetch is never interpreted as proof that the
 * validator did not receive the transaction.
 */
function boundedSolanaFetch(timeoutMs: number): FetchFn {
  const boundedFetch = async (
    input: Parameters<FetchFn>[0],
    init?: Parameters<FetchFn>[1],
  ): Promise<Awaited<ReturnType<FetchFn>>> => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const relayAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) {
      relayAbort();
    } else {
      upstreamSignal?.addEventListener("abort", relayAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", relayAbort);
    }
  };

  // Bun augments the global fetch type with a static `preconnect` member;
  // web3.js calls only the function surface described by FetchFn.
  return boundedFetch as FetchFn;
}

function solanaConnection(
  disableRateLimitRetry = false,
  timeoutMs = SOLANA_RPC_TIMEOUT_MS,
): Connection {
  return new Connection(solanaRpcUrl(), {
    commitment: SOLANA_CONFIRMATION,
    fetch: boundedSolanaFetch(timeoutMs),
    disableRetryOnRateLimit: disableRateLimitRetry,
  });
}

/** Opaque, deterministic operation identity carried in the signed message.
 *
 * Solana signatures are deterministic for the same signer and message. Two
 * otherwise identical payouts built against the same recent blockhash would
 * therefore share one signature unless the payout identity is part of the
 * bytes. Hashing the internal UUID avoids publishing the raw database ID
 * while giving each semantic payout a domain-separated 256-bit memo.
 */
export function solanaPayoutMemo(payoutId: string): Uint8Array {
  if (!PAYOUT_ID_PATTERN.test(payoutId)) {
    throw new Error("invalid_payout_id");
  }
  const input = new TextEncoder().encode(
    `${PAYOUT_MEMO_DOMAIN}\0${payoutId.toLowerCase()}`,
  );
  const digestHex = Buffer.from(sha256(input)).toString("hex");
  return new TextEncoder().encode(`${PAYOUT_MEMO_DOMAIN}:${digestHex}`);
}

export async function buildAndSignSolanaUsdcTransfer(
  p: BuildAndSignSolParams,
): Promise<SignedSolanaTx> {
  const { privateKey } = deriveSolanaKeypair(activeMnemonic(), p.walletId);
  // SLIP-0010 produces a 32-byte ed25519 seed; @solana/web3.js Keypair.fromSeed
  // is the matching constructor (NOT fromSecretKey, which expects 64 bytes).
  const sender = Keypair.fromSeed(privateKey);

  const recipient = new PublicKey(p.destinationAddress);
  const usdcMint = new PublicKey(activeUsdcMintSolana());

  const senderAta = await getAssociatedTokenAddress(usdcMint, sender.publicKey);
  const recipientAta = await getAssociatedTokenAddress(usdcMint, recipient);

  const connection = solanaConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(SOLANA_CONFIRMATION);

  const tx = new Transaction({
    feePayer: sender.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  // Bind this exact signed message to one AgentTool payout operation. The
  // memo carries only a domain-separated digest, not the internal payout ID.
  // This prevents two identical rows from sharing one Solana signature and
  // later both being "confirmed" by one on-chain transfer.
  tx.add(
    new TransactionInstruction({
      keys: [],
      programId: SOLANA_MEMO_PROGRAM,
      data: Buffer.from(solanaPayoutMemo(p.payoutId)),
    }),
  );

  // Idempotent ATA create — no-op if recipient already has one. We pay the
  // rent (~0.00204 SOL) if not. Substrate-honest cost; alternative is
  // requiring callers to pass an ATA, which leaks Solana-specific knowledge
  // into the API contract.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      sender.publicKey, // payer
      recipientAta,
      recipient,
      usdcMint,
    ),
  );

  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      usdcMint,
      recipientAta,
      sender.publicKey,
      p.amountBase,
      USDC_DECIMALS,
    ),
  );

  tx.sign(sender);
  const serialized = tx.serialize();
  // The first signature on a Solana tx is always the fee payer's; that's
  // the canonical tx-id used in explorers and getSignatureStatus calls.
  if (!tx.signature) {
    throw new Error("solana_sign_failed: no signature on signed tx");
  }
  const signature = bs58.encode(tx.signature);

  return {
    signature,
    serialized,
    fromAddress: sender.publicKey.toBase58(),
    toAddress: p.destinationAddress,
    mintAddress: usdcMint.toBase58(),
  };
}

/** Submit a pre-signed serialized Solana tx. The returned signature
 *  matches the deterministic signature computed at sign time. */
export async function submitSolanaTx(
  serialized: Uint8Array,
): Promise<TransactionSignature> {
  // web3.js otherwise retries HTTP 429 responses below this function. The
  // node also receives maxRetries=0 below, so neither layer hides a second
  // dispatch attempt from the worker's ambiguity state machine.
  const connection = solanaConnection(true);
  return await connection.sendRawTransaction(serialized, {
    // Doctrine wall: NO RPC-side retries that change semantics. Solana's
    // default `maxRetries` is undefined (RPC retries internally) but the
    // signed tx's blockhash + nonce make replay deterministic, so this is
    // safe — we still set 0 to keep the contract explicit.
    skipPreflight: false,
    maxRetries: 0,
  });
}

/** Whether a Solana signature exists on chain. Used for crash-recovery
 *  the same way `txExistsOnChain` is used for EVM. A lookup transport
 *  failure is allowed to throw so callers cannot mistake RPC unavailability
 *  for positive proof that the transaction is absent. */
export async function solanaTxExists(
  signature: TransactionSignature,
  timeoutMs = SOLANA_RPC_TIMEOUT_MS,
): Promise<boolean> {
  const connection = solanaConnection(false, timeoutMs);
  const result = await connection.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });
  return Boolean(result.value);
}

export interface SolanaConfirmResult {
  status: "pending" | "confirmed" | "reverted";
  slot?: number;
}

export interface SolanaSignatureFinalityInput {
  err: unknown;
  confirmationStatus?: string | null;
  slot: number;
}

/** Only finalized Solana evidence is terminal. An error observed at
 * processed/confirmed commitment remains pending because a fork can disappear
 * before finalization. */
export function classifySolanaSignatureFinality(
  status: SolanaSignatureFinalityInput,
): SolanaConfirmResult {
  if (status.confirmationStatus !== SOLANA_CONFIRMATION) {
    return { status: "pending", slot: status.slot };
  }
  return {
    status: status.err ? "reverted" : "confirmed",
    slot: status.slot,
  };
}

/** Poll a Solana signature for confirmation. */
export async function confirmSolanaTx(
  signature: TransactionSignature,
  timeoutMs = SOLANA_RPC_TIMEOUT_MS,
): Promise<SolanaConfirmResult> {
  const connection = solanaConnection(false, timeoutMs);
  let status;
  try {
    const result = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    status = result.value;
  } catch {
    return { status: "pending" };
  }
  if (!status) return { status: "pending" };

  return classifySolanaSignatureFinality(status);
}
