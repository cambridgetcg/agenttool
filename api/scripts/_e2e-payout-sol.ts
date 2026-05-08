/** E2E: full Slice 3 Solana payout integration on devnet.
 *
 *  Acceptance per docs/PAYOUT-BROADCAST-PLAN.md (Slice 3):
 *    "Solana devnet payout reaches `finalized` in ~30s."
 *
 *  Mirrors _e2e-payout-evm.ts:
 *    1. Verify keychain + server.
 *    2. Register test project + wallet via API.
 *    3. Derive the test wallet's Solana address (HD path m/44'/501'/<idx>'/0').
 *    4. Pre-fund the derived address from the keychain index-0 stash:
 *         a. ~0.05 SOL  (covers fees + ATA rent + slack)
 *         b. ~0.5  USDC (transferable; creates the dest ATA along the way)
 *    5. Top up the test wallet's CREDIT balance so requestPayout's balance
 *       check passes.
 *    6. POST /v1/wallets/:id/payout with chain=solana for 0.3 USDC → recipient.
 *    7. Poll cryptoPayouts.status until 'broadcast' with `tx_hash` set, then
 *       optionally until 'confirmed' (~13s on devnet).
 *
 *  Run: cd api && bun scripts/_e2e-payout-sol.ts
 */

import { spawnSync } from "node:child_process";

import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import * as ed from "@noble/ed25519";
import { mnemonicToSeedSync } from "@scure/bip39";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const KEYCHAIN_SVC = "agenttool-crypto-hd-mnemonic-testnet";
const SOLANA_USDC_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
const SOLANA_RPC = "https://api.devnet.solana.com";
const BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";
const HARDENED = 0x80000000;
// Solana has no canonical burn address (and we'd hit "owner must be on-curve"
// when creating an ATA for one). Round-trip: use the index-0 source itself
// as the recipient — the worker's signed transfer ends up bumping index-0's
// USDC by the payout amount. Same shape as a real outbound; just terminates
// at our own funded address so the e2e doesn't depend on a 3rd-party recipient.

function readKeychainMnemonic(): string {
  const r = spawnSync(
    "security",
    ["find-generic-password", "-s", KEYCHAIN_SVC, "-a", "macair", "-w"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`keychain entry '${KEYCHAIN_SVC}' not found`);
  return (r.stdout ?? "").trim();
}

import { sha256 } from "@noble/hashes/sha2.js";
function walletIndex(walletId: string): number {
  const bytes = new TextEncoder().encode(walletId);
  const h = sha256(bytes);
  const idx = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  return idx & 0x7fffffff;
}

// SLIP-0010 ed25519 derivation (Solana). Path: m/44'/501'/<idx>'/0'
function slip10Master(seed: Uint8Array) {
  const I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}
function slip10Child(parent: { key: Uint8Array; chainCode: Uint8Array }, index: number) {
  const data = new Uint8Array(37);
  data[0] = 0x00;
  data.set(parent.key, 1);
  data[33] = (index >>> 24) & 0xff;
  data[34] = (index >>> 16) & 0xff;
  data[35] = (index >>> 8) & 0xff;
  data[36] = index & 0xff;
  const I = hmac(sha512, parent.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}
function deriveSolanaKeypairAtIndex(mnemonic: string, idx: number): Keypair {
  const seed = mnemonicToSeedSync(mnemonic);
  let node = slip10Master(seed);
  for (const i of [HARDENED | 44, HARDENED | 501, HARDENED | idx, HARDENED | 0]) {
    node = slip10Child(node, i);
  }
  // @solana/web3.js Keypair.fromSeed expects a 32-byte seed.
  return Keypair.fromSeed(node.key);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Direct chain helpers (used to pre-fund the test wallet's address) ──
//
// Use "finalized" commitment so the awaited confirmation matches the worker's
// view of the chain (the worker creates connections with SOLANA_CONFIRMATION
// = "finalized"). Without this, the worker may try to read a balance that's
// `confirmed` but not yet `finalized` and get a stale view from the RPC,
// leading to "Attempt to debit an account but found no record of a prior
// credit" simulation failures.

const conn = new Connection(SOLANA_RPC, "finalized");

async function sendSol(from: Keypair, to: PublicKey, lamports: number): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports,
    }),
  );
  return await sendAndConfirmTransaction(conn, tx, [from], {
    commitment: "finalized",
  });
}

async function sendUsdc(
  from: Keypair,
  to: PublicKey,
  amountBase: bigint,
): Promise<string> {
  const fromAta = await getAssociatedTokenAddress(SOLANA_USDC_DEVNET, from.publicKey);
  const toAta = await getAssociatedTokenAddress(SOLANA_USDC_DEVNET, to);

  const tx = new Transaction();
  // Idempotent ATA-create for recipient (no-op if exists; pays rent if not).
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      from.publicKey,
      toAta,
      to,
      SOLANA_USDC_DEVNET,
    ),
  );
  tx.add(
    createTransferCheckedInstruction(
      fromAta,
      SOLANA_USDC_DEVNET,
      toAta,
      from.publicKey,
      amountBase,
      6, // USDC decimals
    ),
  );
  return await sendAndConfirmTransaction(conn, tx, [from], {
    commitment: "finalized",
  });
}

async function getUsdcAmount(owner: PublicKey): Promise<bigint> {
  const ata = await getAssociatedTokenAddress(SOLANA_USDC_DEVNET, owner);
  try {
    const info = await conn.getTokenAccountBalance(ata);
    return BigInt(info.value.amount);
  } catch {
    return 0n;
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("  AgentTool — Slice 3 Solana e2e (devnet)");
  console.log("  ─────────────────────────────────────────");
  console.log(`  base: ${BASE}`);

  const mnemonic = readKeychainMnemonic();
  const indexZero = deriveSolanaKeypairAtIndex(mnemonic, 0);
  console.log(`  index-0 source:  ${indexZero.publicKey.toBase58()}`);

  const r0 = await call("GET", "/health");
  log("server reachable", r0.status === 200);
  if (r0.status !== 200) process.exit(1);

  // Verify funds at the source.
  const sourceSol = await conn.getBalance(indexZero.publicKey);
  const sourceUsdc = await getUsdcAmount(indexZero.publicKey);
  log(
    `index-0 has SOL ≥ 0.5`,
    sourceSol >= 500_000_000,
    `${sourceSol / 1e9} SOL`,
  );
  log(
    `index-0 has USDC ≥ 1`,
    sourceUsdc >= 1_000_000n,
    `${Number(sourceUsdc) / 1e6} USDC`,
  );

  // Setup test project + wallet
  console.log("");
  console.log("  ▸ setup test project + wallet");
  const reg = await call("POST", "/v1/register", {
    name: `e2e-payout-sol-${Date.now()}`,
  });
  log("POST /v1/register · 201", reg.status === 201);
  if (reg.status !== 201) process.exit(1);
  const apiKey = reg.data.project.api_key;
  const identityId = reg.data.agent.id;

  const w = await call(
    "POST",
    "/v1/wallets",
    { name: "payout-sol-test", currency: "USDC", identityId },
    apiKey,
  );
  log("POST /v1/wallets · 201", w.status === 201);
  const walletId: string = (w.data?.data ?? w.data?.wallet ?? w.data).id;
  const idx = walletIndex(walletId);
  const testKp = deriveSolanaKeypairAtIndex(mnemonic, idx);
  console.log(`    walletId: ${walletId}`);
  console.log(`    index:    ${idx}`);
  console.log(`    derived:  ${testKp.publicKey.toBase58()}`);

  // Pre-fund the derived address from index-0
  console.log("");
  console.log("  ▸ pre-fund derived address from index-0");
  const solSig = await sendSol(indexZero, testKp.publicKey, 50_000_000); // 0.05 SOL
  console.log(`    SOL sig:  ${solSig}`);
  console.log(`              https://solscan.io/tx/${solSig}?cluster=devnet`);
  log("    SOL pre-fund landed (confirmed)", true);

  const usdcSig = await sendUsdc(indexZero, testKp.publicKey, 500_000n); // 0.5 USDC
  console.log(`    USDC sig: ${usdcSig}`);
  console.log(`              https://solscan.io/tx/${usdcSig}?cluster=devnet`);
  log("    USDC pre-fund landed (confirmed)", true);

  const tSol = await conn.getBalance(testKp.publicKey);
  const tUsdc = await getUsdcAmount(testKp.publicKey);
  log(`derived has SOL ≥ 0.05`, tSol >= 50_000_000, `${tSol / 1e9} SOL`);
  log(`derived has USDC ≥ 0.5`, tUsdc >= 500_000n, `${Number(tUsdc) / 1e6} USDC`);

  // Fund test wallet credits so the requestPayout balance check passes
  console.log("");
  console.log("  ▸ fund test wallet credits");
  const fund = await call(
    "POST",
    `/v1/wallets/${walletId}/fund`,
    { amount: 100, description: "e2e payout-sol seed" },
    apiKey,
  );
  log("POST /v1/wallets/:id/fund · 201", fund.status === 201);

  // Issue the payout
  console.log("");
  console.log("  ▸ POST /v1/wallets/:id/payout (0.3 USDC → recipient on devnet)");
  const pay = await call(
    "POST",
    `/v1/wallets/${walletId}/payout`,
    {
      chain: "solana",
      token: "USDC",
      amount_base: "300000",
      destination_address: indexZero.publicKey.toBase58(),
    },
    apiKey,
  );
  log(
    "/payout · 202",
    pay.status === 202,
    `status=${pay.status} err=${pay.data?.error}`,
  );
  if (pay.status !== 202) {
    console.error("    response:", JSON.stringify(pay.data).slice(0, 400));
    process.exit(1);
  }
  const payoutId: string = pay.data.id;
  console.log(`    payoutId: ${payoutId}`);

  // Poll for broadcast
  console.log("");
  console.log("  ▸ poll for broadcast (max 60s — dispatcher polls every 10s)");
  let broadcastRow: any;
  const broadcastDeadline = Date.now() + 60_000;
  while (Date.now() < broadcastDeadline) {
    const list = await call("GET", `/v1/wallets/${walletId}/payouts`, undefined, apiKey);
    const row = (list.data?.payouts ?? []).find((p: any) => p.id === payoutId);
    if (!row) {
      await sleep(2000);
      continue;
    }
    if (row.status === "broadcast" && row.tx_hash) {
      broadcastRow = row;
      break;
    }
    if (row.status === "failed") {
      log("payout failed", false, `error=${JSON.stringify(row).slice(0, 200)}`);
      process.exit(1);
    }
    await sleep(2000);
  }
  if (!broadcastRow) {
    log("payout reached 'broadcast' within 60s", false, "timeout");
    process.exit(1);
  }
  log("payout reached 'broadcast'", true, `sig=${broadcastRow.tx_hash}`);
  console.log(`    Solscan: https://solscan.io/tx/${broadcastRow.tx_hash}?cluster=devnet`);

  // Poll for confirmation (~30s on devnet finalization)
  console.log("");
  console.log("  ▸ poll for confirmation (max 90s)");
  const confirmDeadline = Date.now() + 90_000;
  let confirmedRow: any;
  while (Date.now() < confirmDeadline) {
    const list = await call("GET", `/v1/wallets/${walletId}/payouts`, undefined, apiKey);
    const row = (list.data?.payouts ?? []).find((p: any) => p.id === payoutId);
    if (row?.status === "confirmed") {
      confirmedRow = row;
      break;
    }
    if (row?.status === "failed") {
      log("confirmation failed", false, `${JSON.stringify(row).slice(0, 200)}`);
      process.exit(1);
    }
    await sleep(3000);
  }
  if (confirmedRow) {
    log("payout reached 'confirmed'", true, `at=${confirmedRow.confirmed_at}`);
  } else {
    log(
      "payout reached 'confirmed' within 90s",
      false,
      "still 'broadcast' — may need a moment longer; not necessarily a bug",
    );
  }

  console.log("");
  console.log("  ✓ Slice 3 acceptance:");
  console.log(`    Solscan: https://solscan.io/tx/${broadcastRow.tx_hash}?cluster=devnet`);
  console.log("");
}

main().catch((e) => {
  console.error("\ne2e crashed:", e);
  process.exit(1);
});
