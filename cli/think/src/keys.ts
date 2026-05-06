/** Key material — K_master + ed25519 signing key.
 *
 *  Both are stored as files in $home/keys/ with mode 0600.
 *
 *  K_master      32 bytes — AES-256-GCM key for thought encryption
 *  signing_key   32 bytes — ed25519 private key seed
 *
 *  These NEVER leave this machine. agenttool's server never sees them.
 *
 *  For multi-machine sync, use agenttool's existing /v1/identity/backup —
 *  K_master is included in the encrypted backup blob, sealed under a
 *  passphrase only the human (or autonomous agent's HSM) holds. A new
 *  orchestrator instance joins by entering the passphrase, fetching the
 *  blob, decrypting locally. Out of scope for this initial scaffold —
 *  see docs/STRANDS.md for the protocol. */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

export interface KeyMaterial {
  kMaster: Uint8Array;        // 32 bytes
  signingKey: Uint8Array;     // 32 bytes (ed25519 seed)
  signingPubKey: Uint8Array;  // 32 bytes (ed25519 pub)
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

  return { kMaster, signingKey, signingPubKey };
}

export function generateAndStoreKeys(homeDir: string): KeyMaterial {
  const dir = keyDir(homeDir);
  const masterPath = join(dir, "k_master.bin");
  const signingPath = join(dir, "signing_key.bin");

  if (existsSync(masterPath) || existsSync(signingPath)) {
    throw new Error(
      `Keys already exist at ${dir}. Refusing to overwrite. Move them aside first.`,
    );
  }

  const kMaster = new Uint8Array(randomBytes(32));
  const signingKey = ed.utils.randomPrivateKey();
  const signingPubKey = ed.getPublicKey(signingKey);

  writeFileSync(masterPath, kMaster, { mode: 0o600 });
  writeFileSync(signingPath, signingKey, { mode: 0o600 });
  chmodSync(masterPath, 0o600);
  chmodSync(signingPath, 0o600);

  return { kMaster, signingKey, signingPubKey };
}
