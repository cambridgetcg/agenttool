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
  type FetchFn,
  type TransactionSignature,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
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

function fetchWithDeadline(timeoutMs: number): FetchFn {
  const boundedFetch = async (
    input: Parameters<FetchFn>[0],
    init: Parameters<FetchFn>[1],
  ) => {
    const controller = new AbortController();
    const upstream = init?.signal;
    const abortFromUpstream = () => controller.abort(upstream?.reason);
    if (upstream?.aborted) {
      abortFromUpstream();
    } else {
      upstream?.addEventListener("abort", abortFromUpstream, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener("abort", abortFromUpstream);
    }
  };
  // Bun adds a static `preconnect` property to typeof fetch. Solana only calls
  // the function, so retain its portable FetchFn boundary without inventing a
  // second global side channel.
  return boundedFetch as FetchFn;
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

  const connection = new Connection(solanaRpcUrl(), SOLANA_CONFIRMATION);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(SOLANA_CONFIRMATION);

  const tx = new Transaction({
    feePayer: sender.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

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
  const connection = new Connection(solanaRpcUrl(), SOLANA_CONFIRMATION);
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
): Promise<boolean> {
  const connection = new Connection(solanaRpcUrl(), SOLANA_CONFIRMATION);
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
  timeoutMs = 10_000,
): Promise<SolanaConfirmResult> {
  const connection = new Connection(solanaRpcUrl(), {
    commitment: SOLANA_CONFIRMATION,
    fetch: fetchWithDeadline(timeoutMs),
  });
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
