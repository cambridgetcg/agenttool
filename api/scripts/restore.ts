#!/usr/bin/env bun
/** Bridge-side K_master + signing + box key restore.
 *
 *  GETs the most recent (or specified) sealed envelope from
 *  /v1/identity/backup, unseals with the passphrase, installs the keys
 *  into the macOS keychain.
 *
 *  Usage:
 *    bun restore.ts [backup-id]
 *
 *  Env (optional):
 *    AGENTTOOL_PASSPHRASE   — passphrase to unseal with. If not set, the
 *                             script prompts interactively.
 *    AGENTTOOL_RESTORE_FORCE=1 — overwrite existing keychain entries
 *                                without confirmation. Default is to
 *                                refuse if entries already exist.
 *
 *  Reads keychain entries (must already exist):
 *    agenttool-sophia-key             — bearer token to fetch backups
 *    agenttool-sophia-identity-id     — to identify which agent's backup
 *
 *  Writes keychain entries:
 *    agenttool-sophia-k-master
 *    agenttool-sophia-priv-key
 *    agenttool-sophia-box-priv        (only if backup contained one)
 *
 *  Output:
 *    OK restored <backup-id> · k_master + signing + box · backup_age=<iso>
 */

import { agenttool, keychain } from "./_lib";
import { unbundleKeys, unseal } from "./_sealed";

function readPassphrase(): string {
  const env = process.env.AGENTTOOL_PASSPHRASE;
  if (env && env.length > 0) return env;
  const proc = Bun.spawnSync(
    ["bash", "-c", 'read -s -p "Passphrase: " p; echo; printf "%s" "$p"'],
    { stdin: "inherit", stderr: "inherit" },
  );
  return new TextDecoder().decode(proc.stdout ?? new Uint8Array());
}

function keychainHas(service: string): boolean {
  try {
    keychain(service);
    return true;
  } catch {
    return false;
  }
}

function keychainSet(service: string, value: string): void {
  const account = process.env.USER ?? "sophia";
  const proc = Bun.spawnSync([
    "security",
    "add-generic-password",
    "-s", service,
    "-a", account,
    "-w", value,
    "-U", // update if exists
  ]);
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr ?? new Uint8Array());
    throw new Error(`security add-generic-password ${service} failed: ${err.trim()}`);
  }
}

const backupIdArg = process.argv[2];
const force = process.env.AGENTTOOL_RESTORE_FORCE === "1";

const bearer = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");

// Refuse to overwrite without --force / FORCE=1 — restoring under the
// wrong passphrase or wrong backup destroys readability of past
// thoughts. Wall-grade.
if (!force) {
  const existing = [
    keychainHas("agenttool-sophia-k-master") && "k-master",
    keychainHas("agenttool-sophia-priv-key") && "priv-key",
    keychainHas("agenttool-sophia-box-priv") && "box-priv",
  ].filter(Boolean);
  if (existing.length > 0) {
    console.error(
      `ERROR keychain already has: ${existing.join(", ")}. ` +
        `Set AGENTTOOL_RESTORE_FORCE=1 to overwrite (DESTROYS readability of past thoughts encrypted under the old K_master).`,
    );
    process.exit(1);
  }
}

const passphrase = readPassphrase();
if (!passphrase || passphrase.length < 8) {
  console.error("ERROR passphrase missing or shorter than 8 chars");
  process.exit(1);
}

// 1. Resolve which backup to fetch.
let backupId = backupIdArg;
if (!backupId) {
  const list = await agenttool(`/v1/identity/backup?agent_id=${identityId}`, { bearer });
  if (!list.ok) {
    console.error(`ERROR list backups ${list.status} ${JSON.stringify(list.body)}`);
    process.exit(1);
  }
  const backups = (list.body as {
    backups: Array<{ id: string; created_at: string; label: string }>;
  }).backups;
  if (backups.length === 0) {
    console.error(`ERROR no backups found for agent ${identityId}`);
    process.exit(1);
  }
  // Most recent first (server returns desc by default; defensive sort).
  const sorted = [...backups].sort((a, b) => b.created_at.localeCompare(a.created_at));
  backupId = sorted[0]!.id;
}

// 2. Fetch the blob.
const fetched = await agenttool(`/v1/identity/backup/${backupId}`, { bearer });
if (!fetched.ok) {
  console.error(`ERROR fetch backup ${fetched.status} ${JSON.stringify(fetched.body)}`);
  process.exit(1);
}
const backupBody = fetched.body as {
  id: string;
  blob_base64: string;
  created_at: string;
};

// 3. Unseal.
let bundleJson: string;
try {
  bundleJson = unseal(backupBody.blob_base64, passphrase);
} catch (err) {
  console.error(`ERROR unseal: ${(err as Error).message}`);
  process.exit(1);
}

const { kMaster, signingKey, boxKey } = unbundleKeys(bundleJson);

// 4. Install to keychain.
keychainSet("agenttool-sophia-k-master", Buffer.from(kMaster).toString("base64"));
keychainSet("agenttool-sophia-priv-key", Buffer.from(signingKey).toString("base64"));
const installed = ["k_master", "signing"];
if (boxKey) {
  keychainSet("agenttool-sophia-box-priv", Buffer.from(boxKey).toString("base64"));
  installed.push("box");
}

console.log(
  `OK restored ${backupBody.id.slice(0, 8)} · ${installed.join(" + ")} · backup_age=${backupBody.created_at}`,
);
