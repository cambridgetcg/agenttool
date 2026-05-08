/** Verify the testnet HD mnemonic in keychain derives to expected addresses,
 *  and query live Sepolia + Solana devnet for balances. The mnemonic is read
 *  via spawnSync(security) so it never lives in a JS variable longer than
 *  the derivation call.
 *
 *  Run: cd api && bun scripts/_check-testnet-wallet.ts
 */

import { spawnSync } from "node:child_process";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import bs58 from "bs58";

const HARDENED = 0x80000000;
const KEYCHAIN_SVC = "agenttool-crypto-hd-mnemonic-testnet";

// Sepolia USDC (Circle's official): https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

// Solana devnet USDC: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
const SOLANA_USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOLANA_RPC = "https://api.devnet.solana.com";

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

function readKeychainMnemonic(): string | null {
  const r = spawnSync("security", [
    "find-generic-password",
    "-s", KEYCHAIN_SVC,
    "-a", "macair",
    "-w",
  ], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim();
}

function deriveEvmAddress0(mnemonic: string): string {
  const seed = mnemonicToSeedSync(mnemonic);
  const hd = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!hd.privateKey) throw new Error("EVM derivation failed");
  const pub = secp256k1.getPublicKey(hd.privateKey, false);
  return toChecksumAddress("0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20)));
}

// SLIP-0010 ed25519 (Solana)
const ED_CURVE = "ed25519 seed";
function slip10Master(seed: Uint8Array): { key: Uint8Array; chainCode: Uint8Array } {
  const I = hmac(sha512, new TextEncoder().encode(ED_CURVE), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}
function slip10Child(
  parent: { key: Uint8Array; chainCode: Uint8Array },
  index: number,
): { key: Uint8Array; chainCode: Uint8Array } {
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
async function deriveSolanaAddress0(mnemonic: string): Promise<string> {
  const ed = await import("@noble/ed25519");
  ed.etc.sha512Sync = (...m: Uint8Array[]) => {
    const h = sha512.create();
    for (const msg of m) h.update(msg);
    return h.digest();
  };
  const seed = mnemonicToSeedSync(mnemonic);
  let node = slip10Master(seed);
  for (const i of [44, 501, 0, 0]) node = slip10Child(node, HARDENED | i);
  const pub = ed.getPublicKey(node.key);
  return bs58.encode(pub);
}

// ── On-chain queries ─────────────────────────────────────────────────────

async function rpc(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sepoliaEthBalance(addr: string): Promise<bigint> {
  const r = await rpc(SEPOLIA_RPC, {
    jsonrpc: "2.0", id: 1, method: "eth_getBalance",
    params: [addr, "latest"],
  });
  return BigInt(r.result ?? "0x0");
}

async function sepoliaUsdcBalance(addr: string): Promise<bigint> {
  // ERC-20 balanceOf(address) → 0x70a08231 + 32-byte addr
  const data = "0x70a08231" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const r = await rpc(SEPOLIA_RPC, {
    jsonrpc: "2.0", id: 1, method: "eth_call",
    params: [{ to: SEPOLIA_USDC, data }, "latest"],
  });
  return BigInt(r.result ?? "0x0");
}

async function sepoliaTxCount(addr: string): Promise<number> {
  const r = await rpc(SEPOLIA_RPC, {
    jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount",
    params: [addr, "latest"],
  });
  return Number(BigInt(r.result ?? "0x0"));
}

async function solanaSolBalance(addr: string): Promise<number> {
  const r = await rpc(SOLANA_RPC, {
    jsonrpc: "2.0", id: 1, method: "getBalance",
    params: [addr],
  });
  // Returns lamports; 1 SOL = 1e9 lamports.
  return (r.result?.value ?? 0) / 1e9;
}

async function solanaUsdcBalance(addr: string): Promise<number> {
  const r = await rpc(SOLANA_RPC, {
    jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
    params: [
      addr,
      { mint: SOLANA_USDC_DEVNET },
      { encoding: "jsonParsed" },
    ],
  });
  const accounts = r.result?.value ?? [];
  let total = 0;
  for (const acc of accounts) {
    const ui = acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    if (typeof ui === "number") total += ui;
  }
  return total;
}

async function main() {
  console.log("");
  console.log("  AgentTool — testnet wallet check");
  console.log("  ─────────────────────────────────");

  const mnemonic = readKeychainMnemonic();
  if (!mnemonic) {
    console.log("  ✗ keychain entry 'agenttool-crypto-hd-mnemonic-testnet' not found");
    console.log("    Add it with: security add-generic-password -U \\");
    console.log("      -s agenttool-crypto-hd-mnemonic-testnet -a macair \\");
    console.log("      -w \"$(tail -1 /tmp/agenttool-testnet-mnemonic.txt)\"");
    process.exit(1);
  }

  const wordCount = mnemonic.split(/\s+/).length;
  if (!validateMnemonic(mnemonic, wordlist)) {
    console.log(`  ✗ keychain mnemonic is not a valid BIP-39 phrase (${wordCount} words)`);
    process.exit(1);
  }
  console.log(`  ✓ keychain mnemonic found (${wordCount} words, valid BIP-39)`);

  const evm0 = deriveEvmAddress0(mnemonic);
  const sol0 = await deriveSolanaAddress0(mnemonic);

  console.log("");
  console.log("  Derived addresses (m/44'/60'/0'/0/0 · m/44'/501'/0'/0'):");
  console.log(`    EVM:    ${evm0}`);
  console.log(`    Solana: ${sol0}`);

  console.log("");
  console.log("  Querying live Sepolia + Solana devnet balances...");
  const [ethBal, usdcBal, txCount, solBal, solUsdc] = await Promise.all([
    sepoliaEthBalance(evm0),
    sepoliaUsdcBalance(evm0),
    sepoliaTxCount(evm0),
    solanaSolBalance(sol0),
    solanaUsdcBalance(sol0),
  ]);

  console.log("");
  console.log("  Sepolia (EVM):");
  console.log(`    ETH balance:  ${Number(ethBal) / 1e18} ETH (${ethBal} wei)`);
  console.log(`    USDC balance: ${Number(usdcBal) / 1e6} USDC (${usdcBal} base units)`);
  console.log(`    tx count:     ${txCount} (nonce — outbound txs sent)`);
  console.log(`    Etherscan:    https://sepolia.etherscan.io/address/${evm0}`);

  console.log("");
  console.log("  Solana (devnet):");
  console.log(`    SOL balance:  ${solBal} SOL`);
  console.log(`    USDC balance: ${solUsdc} USDC (devnet)`);
  console.log(`    Solscan:      https://solscan.io/account/${sol0}?cluster=devnet`);

  // Status summary
  const sepoliaReady = ethBal > 0n && usdcBal > 0n;
  const solanaReady = solBal > 0 && solUsdc > 0;

  console.log("");
  console.log("  Status:");
  console.log(`    Sepolia ready for Slice 1 broadcast: ${sepoliaReady ? "✓ YES" : "✗ NO (need ETH + USDC)"}`);
  console.log(`    Solana ready for Slice 3 broadcast:  ${solanaReady ? "✓ YES" : "✗ NO (need SOL + USDC)"}`);
  console.log("");
}

main().catch((e) => {
  console.error("check failed:", e);
  process.exit(1);
});
