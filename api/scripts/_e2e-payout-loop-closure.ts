/** Slice 4 send-and-watch — broadcasts 0.1 USDC from the keychain index-0
 *  source to a target address on Sepolia, then polls the prod wallet's
 *  balance until it credits (proving Alchemy webhook → ingest → credit
 *  end-to-end). */

import { spawnSync } from "node:child_process";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import {
  createPublicClient, createWalletClient, encodeFunctionData, http,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

function kc(name: string): string {
  const r = spawnSync("security", ["find-generic-password", "-s", name, "-a", "macair", "-w"], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}
function payoutApiKey(): string {
  const fromEnv = process.env.AT_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const r = spawnSync("keep", ["tell", "agenttool-payout-loop-api-key"], {
    encoding: "utf8",
  });
  const fromKeychain = (r.stdout ?? "").trim();
  if (r.status !== 0 || !fromKeychain) {
    throw new Error(
      "Set AT_API_KEY or store agenttool-payout-loop-api-key with keep",
    );
  }
  return fromKeychain;
}
function bytesToHex0x(b: Uint8Array): Hex {
  let s = "0x"; for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s as Hex;
}
function bytesToHex(b: Uint8Array): string {
  let s = ""; for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}
function toChecksum(addr: string): Address {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const h = bytesToHex(keccak_256(new TextEncoder().encode(a)));
  let out = "0x";
  for (let i = 0; i < a.length; i++) out += parseInt(h[i]!, 16) >= 8 ? a[i]!.toUpperCase() : a[i];
  return out as Address;
}

const RECIPIENT = "0x44D24243c54Fb28670aa7D275E20E9b395F2c1c5" as Address;
const WALLET_ID = "89fdab97-29d3-4b90-b198-3c534ff6eb2c";
const API_KEY = payoutApiKey();
const PROD = "https://api.agenttool.dev";
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SEPOLIA_CHAIN_ID = 11_155_111;
const AMOUNT_USDC = 0.1;
const AMOUNT_BASE = BigInt(Math.round(AMOUNT_USDC * 1_000_000));

const ABI = [{
  type: "function", name: "transfer", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;

async function main() {
  const mnemonic = kc("agenttool-crypto-hd-mnemonic-testnet");
  const hd = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/60'/0'/0/0");
  if (!hd.privateKey) throw new Error("no priv");
  const account = privateKeyToAccount(bytesToHex0x(hd.privateKey));
  console.log(`source:    ${account.address}`);
  console.log(`recipient: ${RECIPIENT}`);
  console.log(`amount:    ${AMOUNT_USDC} USDC (${AMOUNT_BASE} base)`);

  const pub = createPublicClient({ transport: http(SEPOLIA_RPC) });
  const wallet = createWalletClient({ account, transport: http(SEPOLIA_RPC) });

  // Snapshot wallet balance pre-send
  const balPre = await fetch(`${PROD}/v1/wallets/${WALLET_ID}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  }).then((r) => r.json());
  const balanceBefore = balPre?.data?.balance ?? balPre?.wallet?.balance ?? balPre?.balance ?? 0;
  console.log(`prod wallet balance before: ${balanceBefore} credits`);

  const data = encodeFunctionData({ abi: ABI, functionName: "transfer", args: [RECIPIENT, AMOUNT_BASE] });
  const [gas, nonce, gasPrice] = await Promise.all([
    pub.estimateGas({ account: account.address, to: SEPOLIA_USDC, data }),
    pub.getTransactionCount({ address: account.address, blockTag: "pending" }),
    pub.getGasPrice(),
  ]);

  const serialized = await wallet.signTransaction({
    chain: null, to: SEPOLIA_USDC, data, gas, nonce: Number(nonce), gasPrice, chainId: SEPOLIA_CHAIN_ID,
  });
  const txHash = await pub.sendRawTransaction({ serializedTransaction: serialized });
  console.log("");
  console.log(`tx submitted: ${txHash}`);
  console.log(`Etherscan:    https://sepolia.etherscan.io/tx/${txHash}`);

  console.log("");
  console.log("waiting for tx receipt (~12s/block)...");
  await pub.waitForTransactionReceipt({ hash: txHash });
  console.log("✓ tx confirmed on chain");

  console.log("");
  console.log("polling prod wallet balance for credit (max 5min — Alchemy fires after finality)...");
  const expectedDelta = Math.ceil(AMOUNT_USDC * 100); // CREDITS_PER_USDC = 100
  const expectedBalance = balanceBefore + expectedDelta;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const r = await fetch(`${PROD}/v1/wallets/${WALLET_ID}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    }).then((r) => r.json());
    const cur = r?.data?.balance ?? r?.wallet?.balance ?? r?.balance ?? 0;
    if (cur >= expectedBalance) {
      console.log(`✓ wallet credited: ${balanceBefore} → ${cur} (+${cur - balanceBefore})`);
      console.log("");
      console.log("✓ Slice 4 acceptance: webhook → ingest → credit loop closed on testnet");
      return;
    }
    process.stdout.write(`  current: ${cur} (target ≥ ${expectedBalance}) ...\r`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("\n✗ timeout — wallet did not credit within 5min");
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
