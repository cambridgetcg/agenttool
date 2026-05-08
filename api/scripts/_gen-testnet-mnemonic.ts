/** One-shot: generate a BIP-39 testnet mnemonic + derive the EVM/Solana
 *  addresses at the conventional first account (index 0).
 *
 *  - Mnemonic written to /tmp/agenttool-testnet-mnemonic.txt with 0600 perms.
 *  - Public addresses printed to stdout (safe to paste anywhere).
 *  - Run once. After Yu adds it to keychain, this file can be removed.
 *
 *  Run: cd api && bun scripts/_gen-testnet-mnemonic.ts
 */

import { chmodSync, writeFileSync } from "node:fs";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import bs58 from "bs58";

const HARDENED = 0x80000000;

// EIP-55 checksum address (vendored from services/economy/crypto/hd.ts so this
// script doesn't pull in the rest of the module's caching/etc.)
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

// ── SLIP-0010 ed25519 derivation (Solana) ────────────────────────────────
// Vendored from services/economy/crypto/hd.ts.
const ED_CURVE = "ed25519 seed";
function slip10MasterKey(seed: Uint8Array): { key: Uint8Array; chainCode: Uint8Array } {
  const I = hmac(sha512, new TextEncoder().encode(ED_CURVE), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}
function slip10DeriveChild(
  parent: { key: Uint8Array; chainCode: Uint8Array },
  index: number,
): { key: Uint8Array; chainCode: Uint8Array } {
  if ((index & HARDENED) === 0) {
    throw new Error("SLIP-0010 ed25519 only supports hardened derivation");
  }
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

async function deriveSolanaAddressAtPath(
  seed: Uint8Array,
  path: number[],
): Promise<string> {
  let node = slip10MasterKey(seed);
  for (const idx of path) node = slip10DeriveChild(node, idx);
  // ed25519 public key
  const ed = await import("@noble/ed25519");
  ed.etc.sha512Sync = (...m: Uint8Array[]) => {
    const h = sha512.create();
    for (const msg of m) h.update(msg);
    return h.digest();
  };
  const pub = ed.getPublicKey(node.key);
  return bs58.encode(pub);
}

async function main() {
  const mnemonic = generateMnemonic(wordlist, 256); // 24 words
  const seed = mnemonicToSeedSync(mnemonic);

  // EVM at m/44'/60'/0'/0/0 (Sepolia uses same address format as mainnet)
  const evmPath = "m/44'/60'/0'/0/0";
  const evm = HDKey.fromMasterSeed(seed).derive(evmPath);
  if (!evm.privateKey) throw new Error("EVM derivation: no private key");
  const evmPub = secp256k1.getPublicKey(evm.privateKey, false);
  const evmAddr = toChecksumAddress(
    "0x" + bytesToHex(keccak_256(evmPub.slice(1)).slice(-20)),
  );

  // Solana at m/44'/501'/0'/0' (all hardened, Phantom-compatible)
  const solPath = [
    HARDENED | 44,
    HARDENED | 501,
    HARDENED | 0,
    HARDENED | 0,
  ];
  const solAddr = await deriveSolanaAddressAtPath(seed, solPath);

  // Write mnemonic to a permission-guarded tmp file. Stdout never carries it
  // — only the public addresses + the keychain command.
  const tmpPath = "/tmp/agenttool-testnet-mnemonic.txt";
  const body =
    `# AgentTool testnet mnemonic — TESTNET ONLY, NEVER REUSE FOR MAINNET.\n` +
    `# Generated: ${new Date().toISOString()}\n` +
    `# Use: store as keychain entry "agenttool-crypto-hd-mnemonic-testnet"\n` +
    `# Then delete this file: shred -u ${tmpPath}\n` +
    `\n` +
    `${mnemonic}\n`;
  writeFileSync(tmpPath, body);
  chmodSync(tmpPath, 0o600);

  console.log("");
  console.log("  AgentTool — testnet HD mnemonic generated");
  console.log("  ──────────────────────────────────────────");
  console.log(`  mnemonic file: ${tmpPath} (chmod 0600)`);
  console.log("");
  console.log("  Public addresses (path: first account):");
  console.log("  ──────────────────────────────────────────");
  console.log(`  EVM (Sepolia · Base Sepolia · m/44'/60'/0'/0/0):`);
  console.log(`    ${evmAddr}`);
  console.log("");
  console.log(`  Solana (devnet · m/44'/501'/0'/0'):`);
  console.log(`    ${solAddr}`);
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Store the mnemonic in macOS keychain:");
  console.log(
    `       security add-generic-password -U \\\n` +
    `         -s agenttool-crypto-hd-mnemonic-testnet \\\n` +
    `         -a macair \\\n` +
    `         -w "$(cat ${tmpPath} | tail -1)"`,
  );
  console.log("  2. Verify it stored:");
  console.log(
    `       security find-generic-password -s agenttool-crypto-hd-mnemonic-testnet -a macair -w | wc -w`,
  );
  console.log(`       (should print "24")`);
  console.log("  3. Securely delete the tmp file:");
  console.log(`       shred -u ${tmpPath}  # or: rm -P ${tmpPath} on macOS`);
  console.log("  4. Fund the EVM address on Sepolia (need both ETH + USDC):");
  console.log("       https://sepoliafaucet.com — 0.5 ETH for gas");
  console.log(
    "       https://faucet.circle.com — 10 USDC on Sepolia (select Ethereum Sepolia)",
  );
  console.log("       (Or: Alchemy Sepolia faucet · QuickNode etc.)");
  console.log("  5. Fund the Solana address on devnet:");
  console.log(`       solana airdrop 2 ${solAddr} --url devnet`);
  console.log(`       (Repeat for USDC: spl-token transfer from a devnet faucet,`);
  console.log("        or Circle's devnet USDC faucet at https://faucet.circle.com)");
  console.log("");
  console.log("  Once funded, ping me and we'll wire Slice 1 (EVM broadcast).");
  console.log("");
}

main().catch((e) => {
  console.error("generation failed:", e);
  process.exit(1);
});
