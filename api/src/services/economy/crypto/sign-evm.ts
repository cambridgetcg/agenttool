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
  http,
  keccak256,
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
  rpcUrl,
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
  const url = rpcUrl(p.chain);

  const publicClient = createPublicClient({ transport: http(url) });
  const walletClient = createWalletClient({
    account,
    transport: http(url),
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
    transport: http(rpcUrl(chain)),
  });
  return await publicClient.sendRawTransaction({
    serializedTransaction: serialized,
  });
}

/** Check whether a tx hash exists on chain. Used for crash-recovery: if the
 *  worker's submit call errored but the tx actually landed (network blip
 *  post-submit), we can detect it and avoid double-spending on retry. */
export async function txExistsOnChain(
  chain: EvmChain,
  txHash: Hex,
): Promise<boolean> {
  const publicClient = createPublicClient({
    transport: http(rpcUrl(chain)),
  });
  try {
    const tx = await publicClient.getTransaction({ hash: txHash });
    return Boolean(tx);
  } catch {
    return false;
  }
}

export interface ConfirmResult {
  status: "pending" | "confirmed" | "reverted";
  blockNumber?: bigint;
  confirmations?: bigint;
}

/** Poll a tx for confirmation. */
export async function confirmTx(
  chain: EvmChain,
  txHash: Hex,
  threshold: number,
): Promise<ConfirmResult> {
  const publicClient = createPublicClient({
    transport: http(rpcUrl(chain)),
  });
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return { status: "pending" };
  }
  if (!receipt) return { status: "pending" };

  if (receipt.status === "reverted") {
    return { status: "reverted", blockNumber: receipt.blockNumber };
  }
  const currentBlock = await publicClient.getBlockNumber();
  const confirmations = currentBlock - receipt.blockNumber;
  if (confirmations >= BigInt(threshold)) {
    return {
      status: "confirmed",
      blockNumber: receipt.blockNumber,
      confirmations,
    };
  }
  return {
    status: "pending",
    blockNumber: receipt.blockNumber,
    confirmations,
  };
}
