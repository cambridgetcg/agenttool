/** EVM transaction signing for payout broadcast — builds + signs an
 *  ERC-20 (USDC) `transfer` transaction using viem.
 *
 *  Two-phase pattern: sign locally to get the deterministic txHash, persist
 *  the hash to DB, then submit. Worker crash between sign-and-submit is
 *  recoverable: another worker queries `txExistsOnChain(hash)` to disambiguate
 *  *submitted* from *never made it*.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slice 1). */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  keccak256,
  TransactionNotFoundError,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { EvmChain } from "./chains";
import { deriveEvmKeypair } from "./hd";
import {
  activeChainId,
  activeMnemonic,
  activeUsdcAddress,
  evmRpcTransport,
} from "./network";

/** Minimal ABI fragment for ERC-20 `transfer(to, amount)`. */
const USDC_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface BuildAndSignParams {
  walletId: string;
  chain: EvmChain;
  destinationAddress: Address;
  amountBase: bigint;
}

export interface SignedTx {
  txHash: Hex;
  serialized: Hex;
  fromAddress: Address;
  toAddress: Address;
  contractAddress: Address;
  chainId: number;
  nonce: number;
}

function bytesToHex0x(b: Uint8Array): Hex {
  let s = "0x";
  for (let i = 0; i < b.length; i++) {
    s += b[i]!.toString(16).padStart(2, "0");
  }
  return s as Hex;
}

/** Build + sign a USDC transfer; return the serialized tx + deterministic
 *  hash. Does NOT submit — caller submits via `submitSignedTx` after
 *  persisting the hash to DB. */
export async function buildAndSignUsdcTransfer(
  p: BuildAndSignParams,
): Promise<SignedTx> {
  const keypair = deriveEvmKeypair(activeMnemonic(), p.walletId);
  const account = privateKeyToAccount(bytesToHex0x(keypair.privateKey));
  const usdcAddress = activeUsdcAddress(p.chain) as Address;
  const chainId = activeChainId(p.chain);

  const publicClient = createPublicClient({
    transport: evmRpcTransport(p.chain),
  });
  const walletClient = createWalletClient({
    account,
    transport: evmRpcTransport(p.chain),
  });

  const data = encodeFunctionData({
    abi: USDC_TRANSFER_ABI,
    functionName: "transfer",
    args: [p.destinationAddress, p.amountBase],
  });

  const [gas, nonce, gasPrice] = await Promise.all([
    publicClient.estimateGas({
      account: account.address,
      to: usdcAddress,
      data,
    }),
    publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    publicClient.getGasPrice(),
  ]);

  const serialized = await walletClient.signTransaction({
    chain: null,
    to: usdcAddress,
    data,
    gas,
    nonce: Number(nonce),
    gasPrice,
    chainId,
  });

  return {
    txHash: keccak256(serialized),
    serialized,
    fromAddress: account.address,
    toAddress: p.destinationAddress,
    contractAddress: usdcAddress,
    chainId,
    nonce: Number(nonce),
  };
}

/** Submit a pre-signed serialized tx to the chain's RPC. The returned hash
 *  matches the deterministic hash computed at sign time. */
export async function submitSignedTx(
  chain: EvmChain,
  serialized: Hex,
): Promise<Hex> {
  const publicClient = createPublicClient({
    // Viem's generic HTTP transport retries by default. Re-dispatching the
    // same signed bytes has the same hash, but the worker's one-attempt
    // ambiguity boundary should still be literal and observable.
    transport: evmRpcTransport(chain, {
      retryCount: 0,
      timeout: 10_000,
    }),
  });
  return await publicClient.sendRawTransaction({
    serializedTransaction: serialized,
  });
}

/** Check whether a tx hash exists on chain. Used for crash-recovery: if the
 *  worker's submit call errored but the tx actually landed (network blip
 *  post-submit), we can detect it and avoid double-spending on retry. RPC
 *  lookup failures throw so callers cannot mistake provider unavailability
 *  for positive proof that the transaction is absent. */
export async function txExistsOnChain(
  chain: EvmChain,
  txHash: Hex,
): Promise<boolean> {
  const publicClient = createPublicClient({
    transport: evmRpcTransport(chain),
  });
  try {
    const tx = await publicClient.getTransaction({ hash: txHash });
    return Boolean(tx);
  } catch (err) {
    if (err instanceof TransactionNotFoundError) return false;
    throw err;
  }
}

export interface ConfirmResult {
  status: "pending" | "confirmed" | "reverted";
  blockNumber?: bigint;
  confirmations?: bigint;
}

export interface EvmReceiptFinalityInput {
  receiptStatus: "success" | "reverted";
  receiptBlockNumber: bigint;
  currentBlockNumber: bigint;
  threshold: number;
}

/** Classify both success and revert only after the configured block threshold.
 * An unconfirmed revert can disappear in a reorg and cannot authorize a
 * terminal refund. */
export function classifyEvmReceiptFinality(
  input: EvmReceiptFinalityInput,
): ConfirmResult {
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 1) {
    throw new Error("invalid_evm_confirmation_threshold");
  }

  const confirmations =
    input.currentBlockNumber >= input.receiptBlockNumber
      ? input.currentBlockNumber - input.receiptBlockNumber
      : 0n;
  if (confirmations < BigInt(input.threshold)) {
    return {
      status: "pending",
      blockNumber: input.receiptBlockNumber,
      confirmations,
    };
  }
  return {
    status: input.receiptStatus === "reverted" ? "reverted" : "confirmed",
    blockNumber: input.receiptBlockNumber,
    confirmations,
  };
}

/** Poll a tx for confirmation. */
export async function confirmTx(
  chain: EvmChain,
  txHash: Hex,
  threshold: number,
): Promise<ConfirmResult> {
  if (!Number.isSafeInteger(threshold) || threshold < 1) {
    throw new Error("invalid_evm_confirmation_threshold");
  }
  const publicClient = createPublicClient({
    transport: evmRpcTransport(chain),
  });
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return { status: "pending" };
  }
  if (!receipt) return { status: "pending" };

  const currentBlock = await publicClient.getBlockNumber();
  return classifyEvmReceiptFinality({
    receiptStatus: receipt.status,
    receiptBlockNumber: receipt.blockNumber,
    currentBlockNumber: currentBlock,
    threshold,
  });
}
