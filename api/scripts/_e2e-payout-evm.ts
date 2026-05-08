/** E2E: full Slice 1 worker integration on Sepolia.
 *
 *  Acceptance per docs/PAYOUT-BROADCAST-PLAN.md (Slice 1):
 *    "Sepolia faucet-funded test wallet → /payout → row reaches `broadcast`
 *     with `tx_hash` visible on Sepolia explorer in <60s."
 *
 *  Flow:
 *    1. Verify keychain + server + worker config.
 *    2. Register test project + wallet via API.
 *    3. Derive the test wallet's EVM deposit address (HD path = walletIndex(uuid)).
 *    4. Pre-fund the derived address from the keychain index-0 stash:
 *         a. ~0.001 ETH (gas)
 *         b. ~0.5  USDC (transferable)
 *       — both broadcast directly via viem; we wait for 1-confirmation.
 *    5. Top up the test wallet's CREDIT balance so `requestPayout`'s
 *       balance check passes.
 *    6. POST /v1/wallets/:id/payout for 0.3 USDC → recipient (burn).
 *    7. Poll cryptoPayouts.status until 'broadcast' with `tx_hash` set.
 *    8. Print Etherscan link.
 *
 *  Run: cd api && bun scripts/_e2e-payout-evm.ts
 *
 *  Server requirements:
 *    PAYOUT_WORKER_ENABLED=true
 *    PAYOUT_NETWORK=testnet
 *    CRYPTO_HD_MNEMONIC_TESTNET=<resolved from keychain>
 */

import { spawnSync } from "node:child_process";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const KEYCHAIN_SVC = "agenttool-crypto-hd-mnemonic-testnet";
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SEPOLIA_CHAIN_ID = 11_155_111;
const BURN = "0x000000000000000000000000000000000000dEaD" as Address;
const BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";

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
function toChecksumAddress(addr: string): Address {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(a)));
  let out = "0x";
  for (let i = 0; i < a.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? a[i]!.toUpperCase() : a[i];
  }
  return out as Address;
}

function readKeychainMnemonic(): string {
  const r = spawnSync(
    "security",
    ["find-generic-password", "-s", KEYCHAIN_SVC, "-a", "macair", "-w"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`keychain entry '${KEYCHAIN_SVC}' not found`);
  return (r.stdout ?? "").trim();
}

/** Mirror api/src/services/economy/crypto/hd.ts walletIndex(). */
function walletIndex(walletId: string): number {
  const bytes = new TextEncoder().encode(walletId);
  const h = sha256(bytes);
  const idx = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  return idx & 0x7fffffff;
}

function deriveEvmKeypair(mnemonic: string, idxOrWalletId: number | string) {
  const seed = mnemonicToSeedSync(mnemonic);
  const idx =
    typeof idxOrWalletId === "number" ? idxOrWalletId : walletIndex(idxOrWalletId);
  const path = `m/44'/60'/0'/0/${idx}`;
  const hd = HDKey.fromMasterSeed(seed).derive(path);
  if (!hd.privateKey) throw new Error("EVM derivation produced no priv key");
  const pub = secp256k1.getPublicKey(hd.privateKey, false);
  const addr = toChecksumAddress(
    "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20)),
  );
  return { privateKey: hd.privateKey, address: addr, path };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  key?: string,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function log(label: string, ok: boolean, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Direct chain helpers (used to pre-fund the test wallet's address) ──

const publicClient = createPublicClient({ transport: http(SEPOLIA_RPC) });

async function sendEth(
  fromPriv: Uint8Array,
  to: Address,
  amountWei: bigint,
): Promise<Hex> {
  const account = privateKeyToAccount(bytesToHex0x(fromPriv));
  const walletClient = createWalletClient({ account, transport: http(SEPOLIA_RPC) });
  const [gas, nonce, gasPrice] = await Promise.all([
    publicClient.estimateGas({ account: account.address, to, value: amountWei }),
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    publicClient.getGasPrice(),
  ]);
  const serialized = await walletClient.signTransaction({
    chain: null,
    to,
    value: amountWei,
    gas,
    nonce: Number(nonce),
    gasPrice,
    chainId: SEPOLIA_CHAIN_ID,
  });
  return await publicClient.sendRawTransaction({ serializedTransaction: serialized });
}

async function sendUsdc(
  fromPriv: Uint8Array,
  to: Address,
  amountBase: bigint,
): Promise<Hex> {
  const account = privateKeyToAccount(bytesToHex0x(fromPriv));
  const walletClient = createWalletClient({ account, transport: http(SEPOLIA_RPC) });
  const data = encodeFunctionData({
    abi: USDC_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, amountBase],
  });
  const [gas, nonce, gasPrice] = await Promise.all([
    publicClient.estimateGas({ account: account.address, to: SEPOLIA_USDC, data }),
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    publicClient.getGasPrice(),
  ]);
  const serialized = await walletClient.signTransaction({
    chain: null,
    to: SEPOLIA_USDC,
    data,
    gas,
    nonce: Number(nonce),
    gasPrice,
    chainId: SEPOLIA_CHAIN_ID,
  });
  return await publicClient.sendRawTransaction({ serializedTransaction: serialized });
}

async function waitForReceipt(hash: Hex, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await publicClient.getTransactionReceipt({ hash });
      if (r) return;
    } catch {
      // pending
    }
    await sleep(3000);
  }
  throw new Error(`receipt timeout for ${hash}`);
}

async function getUsdcBalance(addr: Address): Promise<bigint> {
  const data = ("0x70a08231" +
    addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")) as Hex;
  const res = await publicClient.call({ to: SEPOLIA_USDC, data });
  return BigInt(res.data ?? "0x0");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("  AgentTool — Slice 1 worker integration e2e (Sepolia)");
  console.log("  ──────────────────────────────────────────────────────");
  console.log(`  base: ${BASE}`);

  // 1. Pre-flight
  const mnemonic = readKeychainMnemonic();
  const indexZero = deriveEvmKeypair(mnemonic, 0);
  console.log(`  index-0 source:  ${indexZero.address}`);

  const r0 = await call("GET", "/health");
  log("server reachable", r0.status === 200);
  if (r0.status !== 200) process.exit(1);

  const indexZeroEth = await publicClient.getBalance({
    address: indexZero.address,
  });
  const indexZeroUsdc = await getUsdcBalance(indexZero.address);
  log(
    `index-0 has ETH (≥ 0.005)`,
    indexZeroEth >= 5_000_000_000_000_000n,
    `${Number(indexZeroEth) / 1e18} ETH`,
  );
  log(
    `index-0 has USDC (≥ 1)`,
    indexZeroUsdc >= 1_000_000n,
    `${Number(indexZeroUsdc) / 1e6} USDC`,
  );
  if (indexZeroUsdc < 1_000_000n) {
    console.error("    insufficient USDC for the e2e — fund the index-0 source.");
    process.exit(1);
  }

  // 2. Register test project + wallet
  console.log("");
  console.log("  ▸ setup test project + wallet");
  const reg = await call("POST", "/v1/register", { name: `e2e-payout-${Date.now()}` });
  log("POST /v1/register · 201", reg.status === 201);
  if (reg.status !== 201) process.exit(1);
  const apiKey = reg.data.project.api_key;
  const projectId = reg.data.project.id;
  const identityId = reg.data.agent.id;

  const w = await call(
    "POST",
    "/v1/wallets",
    { name: "payout-test", currency: "USDC", identityId },
    apiKey,
  );
  log("POST /v1/wallets · 201", w.status === 201);
  const walletId: string = (w.data?.data ?? w.data?.wallet ?? w.data).id;
  const idx = walletIndex(walletId);
  const testWallet = deriveEvmKeypair(mnemonic, idx);
  console.log(`    walletId: ${walletId}`);
  console.log(`    index:    ${idx}`);
  console.log(`    derived:  ${testWallet.address}`);

  // 3. Pre-fund the derived address from index-0 (ETH for gas + USDC)
  console.log("");
  console.log("  ▸ pre-fund derived address from index-0");
  // Fund 0.005 ETH + 0.5 USDC. Sequential — same source nonce.
  const ethTx = await sendEth(indexZero.privateKey, testWallet.address, 5_000_000_000_000_000n);
  console.log(`    ETH tx:  ${ethTx}`);
  console.log(`             https://sepolia.etherscan.io/tx/${ethTx}`);
  await waitForReceipt(ethTx);
  log("    ETH pre-fund landed", true);

  const usdcTx = await sendUsdc(indexZero.privateKey, testWallet.address, 500_000n);
  console.log(`    USDC tx: ${usdcTx}`);
  console.log(`             https://sepolia.etherscan.io/tx/${usdcTx}`);
  await waitForReceipt(usdcTx);
  log("    USDC pre-fund landed", true);

  const tEth = await publicClient.getBalance({ address: testWallet.address });
  const tUsdc = await getUsdcBalance(testWallet.address);
  log(
    `derived has ETH ≥ 0.005`,
    tEth >= 5_000_000_000_000_000n,
    `${Number(tEth) / 1e18}`,
  );
  log(`derived has USDC ≥ 0.5`, tUsdc >= 500_000n, `${Number(tUsdc) / 1e6}`);

  // 4. Top up test wallet credits so the API balance check passes.
  // requestPayout debits credits for amount_usdc * CREDITS_PER_USDC=100.
  // 0.3 USDC payout = 30 credits required.
  console.log("");
  console.log("  ▸ fund test wallet credits (so requestPayout balance check passes)");
  const fund = await call(
    "POST",
    `/v1/wallets/${walletId}/fund`,
    { amount: 100, description: "e2e payout-evm seed" },
    apiKey,
  );
  log("POST /v1/wallets/:id/fund · 201", fund.status === 201);

  // 5. Issue the payout
  console.log("");
  console.log("  ▸ POST /v1/wallets/:id/payout (0.3 USDC → burn)");
  const pay = await call(
    "POST",
    `/v1/wallets/${walletId}/payout`,
    {
      chain: "ethereum",
      token: "USDC",
      amount_base: "300000",
      destination_address: BURN,
    },
    apiKey,
  );
  log(
    "/payout · 202 (request accepted)",
    pay.status === 202,
    `status=${pay.status} err=${pay.data?.error}`,
  );
  if (pay.status !== 202) {
    console.error("    response:", JSON.stringify(pay.data).slice(0, 400));
    process.exit(1);
  }
  const payoutId: string = pay.data.id;
  console.log(`    payoutId: ${payoutId}`);

  // 6. Poll for status flip → 'broadcast' with tx_hash
  console.log("");
  console.log("  ▸ poll cryptoPayouts for broadcast (max 90s — dispatcher polls every 10s)");
  const deadline = Date.now() + 90_000;
  let final: any;
  while (Date.now() < deadline) {
    const list = await call("GET", `/v1/wallets/${walletId}/payouts`, undefined, apiKey);
    const row = (list.data?.payouts ?? []).find((p: any) => p.id === payoutId);
    if (!row) {
      await sleep(2000);
      continue;
    }
    if (row.status === "broadcast" && row.tx_hash) {
      final = row;
      break;
    }
    if (row.status === "failed") {
      log("payout failed", false, `error=${JSON.stringify(row).slice(0, 200)}`);
      process.exit(1);
    }
    await sleep(2000);
  }

  if (!final) {
    log("payout reached 'broadcast' within 90s", false, "timeout");
    process.exit(1);
  }
  log("payout reached 'broadcast'", true, `tx=${final.tx_hash}`);
  console.log("");
  console.log(`  ✓ Slice 1 acceptance met:`);
  console.log(`    Etherscan: https://sepolia.etherscan.io/tx/${final.tx_hash}`);
  console.log("");
  console.log("  Optional: wait for Slice 2 'confirmed' (12 blocks ≈ ~3 min).");
}

main().catch((e) => {
  console.error("\ne2e crashed:", e);
  process.exit(1);
});
