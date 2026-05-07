#!/usr/bin/env bun
/** Bridge-side K_master + signing + box key backup.
 *
 *  Reads the agent's keys from the macOS keychain, bundles them, seals
 *  with a passphrase, and POSTs the sealed envelope to
 *  /v1/identity/backup. The server stores the ciphertext as opaque
 *  bytes; the passphrase NEVER touches the server.
 *
 *  Usage:
 *    bun backup.ts [label]
 *
 *  Env (optional):
 *    AGENTTOOL_PASSPHRASE   — passphrase to seal under. If not set, the
 *                             script prompts interactively (no-echo).
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-identity-id
 *    agenttool-sophia-signing-key-id
 *    agenttool-sophia-priv-key       (signing ed25519 priv, base64)
 *    agenttool-sophia-k-master       (32-byte AES-256-GCM key, base64)
 *    agenttool-sophia-box-priv       (X25519 priv, base64; optional)
 *
 *  Output:
 *    OK backup <short-id> · label=<label> · size=<n>B
 */

import { agenttool, keychain } from "./_lib";
import { bundleKeys, seal } from "./_sealed";

function readPassphrase(): string {
  const env = process.env.AGENTTOOL_PASSPHRASE;
  if (env && env.length > 0) return env;
  // Interactive fallback — read silent from TTY.
  const proc = Bun.spawnSync(
    ["bash", "-c", 'read -s -p "Passphrase (>= 8 chars): " p; echo; printf "%s" "$p"'],
    { stdin: "inherit", stderr: "inherit" },
  );
  const out = new TextDecoder().decode(proc.stdout ?? new Uint8Array());
  return out;
}

function tryKeychain(service: string): string | undefined {
  try {
    return keychain(service);
  } catch {
    return undefined;
  }
}

const label = process.argv[2] ?? "primary";

const bearer = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");
const signingKeyId = keychain("agenttool-sophia-signing-key-id");
const signingKeyB64 = keychain("agenttool-sophia-priv-key");
const kMasterB64 = keychain("agenttool-sophia-k-master");
const boxKeyB64 = tryKeychain("agenttool-sophia-box-priv");

const passphrase = readPassphrase();
if (!passphrase || passphrase.length < 8) {
  console.error("ERROR passphrase missing or shorter than 8 chars");
  process.exit(1);
}

const kMaster = new Uint8Array(Buffer.from(kMasterB64, "base64"));
const signingKey = new Uint8Array(Buffer.from(signingKeyB64, "base64"));
const boxKey = boxKeyB64
  ? new Uint8Array(Buffer.from(boxKeyB64, "base64"))
  : undefined;

if (kMaster.length !== 32) {
  console.error(`ERROR k_master is ${kMaster.length} bytes, expected 32`);
  process.exit(1);
}
if (signingKey.length !== 32) {
  console.error(`ERROR signing_key is ${signingKey.length} bytes, expected 32`);
  process.exit(1);
}
if (boxKey && boxKey.length !== 32) {
  console.error(`ERROR box_key is ${boxKey.length} bytes, expected 32`);
  process.exit(1);
}

const bundle = bundleKeys({
  kMaster,
  signingKey,
  boxKey,
  identityId,
  signingKeyId,
  agenttoolBase: process.env.AGENTTOOL_BASE ?? "https://agenttool.fly.dev",
});

const blobB64 = seal(JSON.stringify(bundle), { passphrase });

const res = await agenttool("/v1/identity/backup", {
  method: "POST",
  bearer,
  body: {
    agent_id: identityId,
    blob_base64: blobB64,
    key_derivation: "argon2id-v1",
    label,
    metadata: {
      bridge_version: "v1",
      includes_box_key: boxKey !== undefined,
    },
  },
});

if (!res.ok) {
  console.error(`ERROR backup ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

const body = res.body as { backup?: { id: string } };
const id = body.backup?.id ?? "?";
console.log(
  `OK backup ${id.slice(0, 8)} · label=${label} · size=${blobB64.length}B`,
);
