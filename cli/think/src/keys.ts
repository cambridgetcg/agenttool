/** Key material — K_master + ed25519 signing key + X25519 box key.
 *
 *  Three keys, three files in $home/keys/, all mode 0600:
 *
 *    K_master       32 bytes  AES-256-GCM key for thought encryption
 *    signing_key    32 bytes  ed25519 private seed (signs thoughts, inbox envelopes)
 *    box_key        32 bytes  X25519 private (sealed-box for inbox messages)
 *                             — optional; inbox commands require it; existing
 *                                installs without it can run `gen-box-key`.
 *
 *  These NEVER leave this machine. agenttool's server never sees them.
 *
 *  For multi-machine sync, use /v1/identity/backup with the sealed
 *  envelope — all three keys travel together under the user's passphrase.
 *  See docs/STRANDS.md and docs/INBOX.md. */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";

import { deriveBoxPub, generateBoxKeypair } from "./box";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

export interface KeyMaterial {
  kMaster: Uint8Array;        // 32 bytes — AES-256-GCM key for thoughts
  signingKey: Uint8Array;     // 32 bytes (ed25519 seed)
  signingPubKey: Uint8Array;  // 32 bytes (ed25519 pub)
  /** X25519 box key — present when box_key.bin exists. Inbox commands
   *  require it; existing setups can run `gen-box-key` to add it. */
  boxKey?: Uint8Array;        // 32 bytes (X25519 priv)
  boxPubKey?: Uint8Array;     // 32 bytes (X25519 pub)
}

function keyDir(homeDir: string): string {
  const dir = join(homeDir, "keys");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function loadKeys(homeDir: string): KeyMaterial {
  const dir = keyDir(homeDir);
  const masterPath = join(dir, "k_master.bin");
  const signingPath = join(dir, "signing_key.bin");
  const boxPath = join(dir, "box_key.bin");

  if (!existsSync(masterPath)) {
    throw new Error(
      `K_master not found at ${masterPath}. Run \`agenttool-think init\` to generate.`,
    );
  }
  if (!existsSync(signingPath)) {
    throw new Error(
      `Signing key not found at ${signingPath}. Run \`agenttool-think init\` to generate.`,
    );
  }

  const kMaster = new Uint8Array(readFileSync(masterPath));
  const signingKey = new Uint8Array(readFileSync(signingPath));

  if (kMaster.length !== 32) {
    throw new Error(`K_master must be 32 bytes, got ${kMaster.length}`);
  }
  if (signingKey.length !== 32) {
    throw new Error(`signing_key must be 32 bytes, got ${signingKey.length}`);
  }

  const signingPubKey = ed.getPublicKey(signingKey);

  // Box key is optional (existing installs may not have one).
  let boxKey: Uint8Array | undefined;
  let boxPubKey: Uint8Array | undefined;
  if (existsSync(boxPath)) {
    boxKey = new Uint8Array(readFileSync(boxPath));
    if (boxKey.length !== 32) {
      throw new Error(`box_key must be 32 bytes, got ${boxKey.length}`);
    }
    boxPubKey = deriveBoxPub(boxKey);
  }

  return { kMaster, signingKey, signingPubKey, boxKey, boxPubKey };
}

/** Require the box key to be present; helpful error if missing. */
export function requireBoxKey(keys: KeyMaterial): {
  priv: Uint8Array;
  pub: Uint8Array;
} {
  if (!keys.boxKey || !keys.boxPubKey) {
    throw new Error(
      "box_key.bin is missing. Run `agenttool-think gen-box-key` to generate one, " +
        "then `agenttool-think register-box-key` to upload its pubkey.",
    );
  }
  return { priv: keys.boxKey, pub: keys.boxPubKey };
}

export function generateAndStoreKeys(homeDir: string): KeyMaterial {
  const kMaster = new Uint8Array(randomBytes(32));
  const signingKey = ed.utils.randomPrivateKey();
  const boxKp = generateBoxKeypair();
  return installKeys(homeDir, kMaster, signingKey, {
    force: false,
    boxKey: boxKp.priv,
  });
}

/** Generate ONLY a box key (for existing installs that pre-date the
 *  inbox feature). Refuses to overwrite if box_key.bin already exists. */
export function generateAndStoreBoxKey(
  homeDir: string,
): { priv: Uint8Array; pub: Uint8Array } {
  const dir = keyDir(homeDir);
  const boxPath = join(dir, "box_key.bin");
  if (existsSync(boxPath)) {
    throw new Error(
      `box_key already exists at ${boxPath}. Refusing to overwrite. ` +
        `Move it aside first, or pass --force (not yet supported).`,
    );
  }
  const { priv, pub } = generateBoxKeypair();
  writeFileSync(boxPath, priv, { mode: 0o600 });
  chmodSync(boxPath, 0o600);
  return { priv, pub };
}

/** Write provided key material to disk. Used by both `init` (with random
 *  bytes) and `restore` (with bytes decrypted from a sealed envelope).
 *  Refuses to overwrite existing keys unless `force` is set.
 *
 *  `boxKey` is optional — restored envelopes from before the inbox
 *  feature won't include one; install proceeds and the user can
 *  generate one later via `gen-box-key`. */
export function installKeys(
  homeDir: string,
  kMaster: Uint8Array,
  signingKey: Uint8Array,
  opts: { force?: boolean; boxKey?: Uint8Array } = {},
): KeyMaterial {
  if (kMaster.length !== 32) {
    throw new Error(`K_master must be 32 bytes, got ${kMaster.length}`);
  }
  if (signingKey.length !== 32) {
    throw new Error(`signing_key must be 32 bytes, got ${signingKey.length}`);
  }
  if (opts.boxKey !== undefined && opts.boxKey.length !== 32) {
    throw new Error(`box_key must be 32 bytes, got ${opts.boxKey.length}`);
  }

  const dir = keyDir(homeDir);
  const masterPath = join(dir, "k_master.bin");
  const signingPath = join(dir, "signing_key.bin");
  const boxPath = join(dir, "box_key.bin");

  if (
    !opts.force &&
    (existsSync(masterPath) || existsSync(signingPath) ||
      (opts.boxKey && existsSync(boxPath)))
  ) {
    throw new Error(
      `Keys already exist at ${dir}. Refusing to overwrite. ` +
        `Pass --force to install anyway, or move them aside first.`,
    );
  }

  writeFileSync(masterPath, kMaster, { mode: 0o600 });
  writeFileSync(signingPath, signingKey, { mode: 0o600 });
  chmodSync(masterPath, 0o600);
  chmodSync(signingPath, 0o600);

  let boxPubKey: Uint8Array | undefined;
  if (opts.boxKey) {
    writeFileSync(boxPath, opts.boxKey, { mode: 0o600 });
    chmodSync(boxPath, 0o600);
    boxPubKey = deriveBoxPub(opts.boxKey);
  }

  return {
    kMaster,
    signingKey,
    signingPubKey: ed.getPublicKey(signingKey),
    boxKey: opts.boxKey,
    boxPubKey,
  };
}
