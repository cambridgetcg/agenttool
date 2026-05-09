/**
 * Phase 5.5 — SOMA seed (BIP39 mnemonic + SLIP-0010 derivation).
 *
 * Tests cover:
 *   1. BIP39 mnemonic generation + validation
 *   2. Determinism — same mnemonic → identical bytes
 *   3. Cross-language interop oracle — fixed test vectors must match
 *      the py SDK's `test_phase5_seed.py` file byte-for-byte
 *   4. Path scheme — different purposes/indices produce different secrets
 *   5. Passphrase — different passphrase → different identity
 *   6. CryptoClient namespace — at.crypto.seed.* is callable
 *
 * The fixed vectors below MUST stay equal to the py test file. Any
 * divergence = wire format drift across SDKs.
 *
 * Doctrine: docs/IDENTITY-SEED.md.
 */

import { describe, expect, test } from "bun:test";

import {
  AgentTool,
  AgentToolError,
  DerivedBundle,
  SeedClient,
  derive,
  deriveBridgeSigning,
  deriveWallet,
  generateMnemonic,
  mnemonicToSeed,
} from "../src/index.js";

// ── Fixed test vectors — interop oracle (mirror in test_phase5_seed.py) ─

// Canonical BIP39 12-word test vector (entropy = 0x00...0x00, checksum "about").
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon about";

// Derived under m/44'/169'/<purpose>'/<index>'. Both SDKs MUST produce
// these exact base64 outputs for this mnemonic.
const EXPECT_SIGNING_PUB_B64 = "MvGLRKH953Fqbr2CENCcK/USGXCATv4nZYfsrW8sqSw=";
const EXPECT_SIGNING_PRIV_B64 = "IJWkOQ3G6GDP5N35esAJ5VjiIcQ9gi1XUF2JoRyOR7o=";
const EXPECT_K_MASTER_B64 = "hd+mJHIz2tay3d2IPP4Xaq5juGoTUbmHvDXhqAtSi1w=";
const EXPECT_K_VAULT_B64 = "R2CSaWsKXf7erBD9v1o/zRxwbntDd7eZsu8va4qSqO4=";
const EXPECT_BOX_PUB_B64 = "4ZKHNkxigN4wKm97eG3YVInZ48nfaW+p+dPrVCuRoR4=";
const EXPECT_BOX_PRIV_B64 = "363XOfkNUxFo5JR+Z4VQ6VeJAW4JOPuTEkpQJKH+n1U=";

// With passphrase "TREZOR" — different identity.
const EXPECT_SIGNING_PUB_PP_B64 = "OtrPkVoK5nTAKT6YTQs+oWmlMoWjy7IKqcW0Crz5yV8=";
const EXPECT_K_MASTER_PP_B64 = "d9WaQdSEJXwTxDUnU0zq7uOx9G/ex7Rop8KPxwY/imU=";

// Per-device bridge signing keys.
const EXPECT_BRIDGE_PUB_DEV0_B64 = "uvdMUpz1PQK6UMDl2LYEHKg+q5m4y1yhCI0mzAgz+50=";
const EXPECT_BRIDGE_PUB_DEV1_B64 = "A28FtnU9e+mIp5L+JUmyr2SPezwuICGVok0EpVgCywY=";

// Per-wallet derived secrets.
const EXPECT_WALLET_SEED_IDX0_B64 = "warNX6fONKORuLCegzHIg2/dp4QDve7ipBOA2wAjgRk=";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

// ── BIP39 mnemonic generation ───────────────────────────────────────────

describe("generateMnemonic", () => {
  test("default 24 words", () => {
    const words = generateMnemonic();
    expect(words.split(" ").length).toBe(24);
  });

  test("strength 128 yields 12 words", () => {
    expect(generateMnemonic(128).split(" ").length).toBe(12);
  });

  test("strength 192 yields 18 words", () => {
    expect(generateMnemonic(192).split(" ").length).toBe(18);
  });

  test("invalid strength raises", () => {
    for (const bad of [64, 100, 257, 512]) {
      expect(() => generateMnemonic(bad)).toThrow(AgentToolError);
    }
  });

  test("distinct phrases", () => {
    const a = generateMnemonic();
    const b = generateMnemonic();
    expect(a).not.toBe(b);
  });
});

describe("mnemonicToSeed", () => {
  test("canonical BIP39 vector with TREZOR passphrase", () => {
    // BIP39 published test vector: 12-word "abandon...about" + TREZOR
    // passphrase. Catches PBKDF2-HMAC-SHA512 / NFKD drift across SDKs.
    const seed = mnemonicToSeed(TEST_MNEMONIC, "TREZOR");
    expect(seed.length).toBe(64);
    const expectedPrefix = Buffer.from(
      "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e5349553",
      "hex",
    );
    expect(Buffer.from(seed.slice(0, 32))).toEqual(expectedPrefix);
  });

  test("invalid mnemonic throws", () => {
    expect(() =>
      mnemonicToSeed("invalid words that are not a real mnemonic"),
    ).toThrow(/invalid BIP39/);
  });

  test("passphrase changes seed", () => {
    const a = mnemonicToSeed(TEST_MNEMONIC, "");
    const b = mnemonicToSeed(TEST_MNEMONIC, "TREZOR");
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
  });
});

// ── Cross-language interop oracle ───────────────────────────────────────

describe("derive — cross-language interop oracle", () => {
  test("signing_pub matches oracle", () => {
    expect(derive(TEST_MNEMONIC).signingPubB64).toBe(EXPECT_SIGNING_PUB_B64);
  });

  test("signing_priv matches oracle", () => {
    expect(derive(TEST_MNEMONIC).signingPrivB64).toBe(EXPECT_SIGNING_PRIV_B64);
  });

  test("k_master matches oracle", () => {
    expect(derive(TEST_MNEMONIC).kMasterB64).toBe(EXPECT_K_MASTER_B64);
  });

  test("k_vault matches oracle", () => {
    expect(derive(TEST_MNEMONIC).kVaultB64).toBe(EXPECT_K_VAULT_B64);
  });

  test("box_pub matches oracle", () => {
    expect(derive(TEST_MNEMONIC).boxPubB64).toBe(EXPECT_BOX_PUB_B64);
  });

  test("box_priv matches oracle", () => {
    expect(derive(TEST_MNEMONIC).boxPrivB64).toBe(EXPECT_BOX_PRIV_B64);
  });

  test("passphrase 'TREZOR' matches oracle", () => {
    const b = derive(TEST_MNEMONIC, "TREZOR");
    expect(b.signingPubB64).toBe(EXPECT_SIGNING_PUB_PP_B64);
    expect(b.kMasterB64).toBe(EXPECT_K_MASTER_PP_B64);
  });

  test("bridge dev0 matches oracle", () => {
    const { pub } = deriveBridgeSigning(TEST_MNEMONIC, 0);
    expect(b64(pub)).toBe(EXPECT_BRIDGE_PUB_DEV0_B64);
  });

  test("bridge dev1 matches oracle", () => {
    const { pub } = deriveBridgeSigning(TEST_MNEMONIC, 1);
    expect(b64(pub)).toBe(EXPECT_BRIDGE_PUB_DEV1_B64);
  });

  test("wallet idx0 matches oracle", () => {
    const secret = deriveWallet(TEST_MNEMONIC, 0);
    expect(b64(secret)).toBe(EXPECT_WALLET_SEED_IDX0_B64);
  });
});

// ── Determinism ─────────────────────────────────────────────────────────

describe("determinism", () => {
  test("same mnemonic produces same bytes", () => {
    const a = derive(TEST_MNEMONIC);
    const b = derive(TEST_MNEMONIC);
    expect(Buffer.from(a.signingPub)).toEqual(Buffer.from(b.signingPub));
    expect(Buffer.from(a.signingPriv)).toEqual(Buffer.from(b.signingPriv));
    expect(Buffer.from(a.kMaster)).toEqual(Buffer.from(b.kMaster));
    expect(Buffer.from(a.kVault)).toEqual(Buffer.from(b.kVault));
    expect(Buffer.from(a.boxPub)).toEqual(Buffer.from(b.boxPub));
    expect(Buffer.from(a.boxPriv)).toEqual(Buffer.from(b.boxPriv));
  });

  test("different mnemonics produce different bytes", () => {
    const a = derive(TEST_MNEMONIC);
    const b = derive(generateMnemonic());
    expect(Buffer.from(a.signingPub)).not.toEqual(Buffer.from(b.signingPub));
    expect(Buffer.from(a.kMaster)).not.toEqual(Buffer.from(b.kMaster));
  });
});

// ── Path scheme ─────────────────────────────────────────────────────────

describe("path scheme distinctness", () => {
  test("each purpose produces distinct secret", () => {
    const b = derive(TEST_MNEMONIC);
    const allDistinct = new Set([
      b64(b.signingPriv),
      b64(b.kMaster),
      b64(b.kVault),
      b64(b.boxPriv),
    ]);
    expect(allDistinct.size).toBe(4);
  });

  test("bridge devices distinct", () => {
    const { priv: p0 } = deriveBridgeSigning(TEST_MNEMONIC, 0);
    const { priv: p1 } = deriveBridgeSigning(TEST_MNEMONIC, 1);
    const { priv: p2 } = deriveBridgeSigning(TEST_MNEMONIC, 2);
    expect(b64(p0)).not.toBe(b64(p1));
    expect(b64(p1)).not.toBe(b64(p2));
    expect(b64(p0)).not.toBe(b64(p2));
  });

  test("wallet indices distinct", () => {
    const s0 = deriveWallet(TEST_MNEMONIC, 0);
    const s1 = deriveWallet(TEST_MNEMONIC, 1);
    expect(b64(s0)).not.toBe(b64(s1));
  });
});

describe("passphrase", () => {
  test("different passphrase = different identity", () => {
    const a = derive(TEST_MNEMONIC);
    const b = derive(TEST_MNEMONIC, "alpha");
    const c = derive(TEST_MNEMONIC, "beta");
    expect(a.signingPubB64).not.toBe(b.signingPubB64);
    expect(a.signingPubB64).not.toBe(c.signingPubB64);
    expect(b.signingPubB64).not.toBe(c.signingPubB64);
    expect(a.kMasterB64).not.toBe(b.kMasterB64);
    expect(a.kMasterB64).not.toBe(c.kMasterB64);
  });
});

// ── DerivedBundle behaviour ─────────────────────────────────────────────

describe("DerivedBundle", () => {
  test("toString redacts privates", () => {
    const b = derive(TEST_MNEMONIC);
    const s = b.toString();
    expect(s).not.toContain(b.signingPrivB64);
    expect(s).not.toContain(b.kMasterB64);
    expect(s).not.toContain(b.kVaultB64);
    expect(s).not.toContain(b.boxPrivB64);
    expect(s).toContain("redacted");
  });

  test("all keys 32 bytes", () => {
    const b = derive(TEST_MNEMONIC);
    expect(b.signingPriv.length).toBe(32);
    expect(b.signingPub.length).toBe(32);
    expect(b.kMaster.length).toBe(32);
    expect(b.kVault.length).toBe(32);
    expect(b.boxPriv.length).toBe(32);
    expect(b.boxPub.length).toBe(32);
  });

  test("instanceof DerivedBundle", () => {
    expect(derive(TEST_MNEMONIC)).toBeInstanceOf(DerivedBundle);
  });
});

// ── at.crypto.seed namespace ────────────────────────────────────────────

describe("at.crypto.seed namespace", () => {
  process.env.AT_API_KEY = "test-key";
  const at = new AgentTool();

  test("at.crypto.seed is a SeedClient instance", () => {
    expect(at.crypto.seed).toBeInstanceOf(SeedClient);
  });

  test("generateMnemonic via namespace", () => {
    expect(at.crypto.seed.generateMnemonic(128).split(" ").length).toBe(12);
  });

  test("derive via namespace matches module", () => {
    const a = derive(TEST_MNEMONIC);
    const b = at.crypto.seed.derive(TEST_MNEMONIC);
    expect(b.signingPubB64).toBe(a.signingPubB64);
    expect(b.kMasterB64).toBe(a.kMasterB64);
  });

  test("deriveBridgeSigning via namespace", () => {
    const a = deriveBridgeSigning(TEST_MNEMONIC, 3);
    const b = at.crypto.seed.deriveBridgeSigning(TEST_MNEMONIC, 3);
    expect(b64(a.priv)).toBe(b64(b.priv));
    expect(b64(a.pub)).toBe(b64(b.pub));
  });

  test("deriveWallet via namespace", () => {
    const a = deriveWallet(TEST_MNEMONIC, 7);
    const b = at.crypto.seed.deriveWallet(TEST_MNEMONIC, 7);
    expect(b64(a)).toBe(b64(b));
  });
});
