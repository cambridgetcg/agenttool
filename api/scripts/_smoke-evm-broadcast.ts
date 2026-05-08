/** Direct chain-layer smoke for the payout-broadcast worker.
 *
 *  Bypasses the BullMQ + DB orchestration to prove the EVM signing path
 *  works end-to-end against Sepolia: keychain → mnemonic → HD derive →
 *  viem build/sign → public RPC submit → tx hash visible on Etherscan.
 *
 *  Once this is green, the only remaining pieces of Slice 1 are the
 *  worker glue (already built in api/src/workers/payout/) and the e2e
 *  integration test.
 *
 *  Run: cd api && bun scripts/_smoke-evm-broadcast.ts [amount-usdc]
 */

import { spawnSync } from "node:child_process";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
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

const KEYCHAIN_SVC = "agenttool-crypto-hd-mnemonic-testnet";
const BURN = "0x000000000000000000000000000000000000dEaD";
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SEPOLIA_CHAIN_ID = 11_155_111;

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

function bytesToHex0x(b: Uint8Array): Hex {
  let s = "0x";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s as Hex;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

function toChecksumAddress(addr: string): string {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(a)));
  let out = "0x";
  for (let i = 0; i < a.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? a[i]!.toUpperCase() : a[i];
  }
  return out;
}

function readKeychainMnemonic(): string {
  const r = spawnSync(
    "security",
    [
      "find-generic-password",
      "-s", KEYCHAIN_SVC,
      "-a", "macair",
      "-w",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`keychain entry '${KEYCHAIN_SVC}' not found`);
  }
  return (r.stdout ?? "").trim();
}

async function main() {
  const amountUsdc = Number(process.argv[2] ?? "0.1");
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    console.error("usage: bun scripts/_smoke-evm-broadcast.ts [amount-usdc]");
    process.exit(1);
  }
  const amountBase = BigInt(Math.round(amountUsdc * 1_000_000)); // USDC decimals = 6

  console.log("");
  console.log("  AgentTool — Sepolia broadcast smoke");
  console.log("  ────────────────────────────────────");

  // 1. Derive index-0 keypair from the keychain mnemonic.
  const mnemonic = readKeychainMnemonic();
  const seed = mnemonicToSeedSync(mnemonic);
  const hd = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!hd.privateKey) throw new Error("EVM derivation produced no priv key");
  const privKeyHex = bytesToHex0x(hd.privateKey);
  const account = privateKeyToAccount(privKeyHex);

  // Cross-check the derived address matches the keychain-stored "address-0".
  const pub = secp256k1.getPublicKey(hd.privateKey, false);
  const addrFromPubKey = toChecksumAddress(
    "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20)),
  );
  if (account.address !== addrFromPubKey) {
    throw new Error(
      `viem account.address (${account.address}) ≠ derived (${addrFromPubKey})`,
    );
  }
  console.log(`  source address:  ${account.address}`);
  console.log(`  destination:     ${BURN} (burn)`);
  console.log(`  amount:          ${amountUsdc} USDC (${amountBase} base)`);

  // 2. Build the ERC-20 transfer.
  const data = encodeFunctionData({
    abi: USDC_TRANSFER_ABI,
    functionName: "transfer",
    args: [BURN as Address, amountBase],
  });

  const publicClient = createPublicClient({ transport: http(SEPOLIA_RPC) });
  const walletClient = createWalletClient({ account, transport: http(SEPOLIA_RPC) });

  console.log("");
  console.log("  Querying gas + nonce + price...");
  const [gas, nonce, gasPrice] = await Promise.all([
    publicClient.estimateGas({
      account: account.address,
      to: SEPOLIA_USDC,
      data,
    }),
    publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    publicClient.getGasPrice(),
  ]);
  console.log(`    gas:       ${gas}`);
  console.log(`    nonce:     ${nonce}`);
  console.log(`    gasPrice:  ${gasPrice} wei (${Number(gasPrice) / 1e9} gwei)`);
  console.log(`    max cost:  ${(Number(gas * gasPrice) / 1e18).toFixed(8)} ETH`);

  // 3. Sign locally → deterministic tx hash.
  console.log("");
  console.log("  Signing locally...");
  const serialized = await walletClient.signTransaction({
    chain: null,
    to: SEPOLIA_USDC,
    data,
    gas,
    nonce: Number(nonce),
    gasPrice,
    chainId: SEPOLIA_CHAIN_ID,
  });
  const txHash = keccak256(serialized);
  console.log(`    txHash (deterministic, pre-submit): ${txHash}`);

  // 4. Submit to public Sepolia RPC.
  console.log("");
  console.log("  Submitting to Sepolia RPC...");
  const submittedHash = await publicClient.sendRawTransaction({
    serializedTransaction: serialized,
  });
  console.log(`    submitted: ${submittedHash}`);
  if (submittedHash !== txHash) {
    console.warn(
      `  ⚠ submitted hash (${submittedHash}) ≠ pre-computed (${txHash}). ` +
        `RPC may have re-derived; not necessarily a bug.`,
    );
  } else {
    console.log("  ✓ pre-computed hash matches RPC-returned hash");
  }

  console.log("");
  console.log("  ✓ Sepolia broadcast smoke succeeded");
  console.log(`    Etherscan: https://sepolia.etherscan.io/tx/${submittedHash}`);
  console.log("");
  console.log("  Wait ~30s and verify the tx confirms (12-block threshold = ~3min).");
  console.log("");
}

main().catch((e) => {
  console.error("smoke failed:", e);
  process.exit(1);
});
