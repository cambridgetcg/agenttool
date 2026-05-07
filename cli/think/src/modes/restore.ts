/** restore mode — fetch a sealed envelope from /v1/identity/backup,
 *  unseal with the passphrase, install K_master + signing_key locally.
 *
 *  Restore is the only mode that runs WITHOUT the strict config loader —
 *  on a fresh machine, signing_key_id isn't known yet (the envelope
 *  contains it). We only need API key + identity_id to fetch backups.
 *
 *  Substrate-honest about what restore does and doesn't:
 *    ✓ writes K_master + signing_key files to ~/.config/agenttool-think/keys/
 *    ✓ prints identity_id + signing_key_id from the envelope
 *    ✗ does NOT modify shell rc / env / config.json
 *      (you set those yourself based on what gets printed) */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AgenttoolClient } from "../api";
import type { ThinkConfig } from "../config";
import { installKeys } from "../keys";
import { readPassphrase } from "../passphrase";
import { unbundleKeys, unseal } from "../sealed";

export interface RestoreOptions {
  backupId?: string;     // explicit; otherwise most recent
  force: boolean;        // overwrite existing keys
  homeDir?: string;      // override $HOME/.config/agenttool-think
}

interface MinimalRestoreConfig {
  agenttoolBase: string;
  agenttoolApiKey: string;
  identityId?: string;
  homeDir: string;
}

function loadKeychainSecret(service: string): string | undefined {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync(
      `security find-generic-password -s ${service} -w 2>/dev/null`,
      { encoding: "utf-8" },
    ).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function loadMinimalConfig(opts: RestoreOptions): MinimalRestoreConfig {
  const apiKey =
    process.env.AGENTTOOL_API_KEY ?? loadKeychainSecret("agenttool") ?? "";
  if (!apiKey) {
    throw new Error(
      "No agenttool API key. Set AGENTTOOL_API_KEY env var or store in macOS keychain (service=agenttool).",
    );
  }
  const home =
    opts.homeDir ??
    process.env.AGENTTOOL_THINK_HOME ??
    join(homedir(), ".config", "agenttool-think");
  return {
    agenttoolBase: process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev",
    agenttoolApiKey: apiKey,
    identityId: process.env.AGENTTOOL_IDENTITY_ID,
    homeDir: home,
  };
}

export async function restore(opts: RestoreOptions): Promise<void> {
  const cfg = loadMinimalConfig(opts);

  // Build a stub ThinkConfig good enough for AgenttoolClient.
  const stub: ThinkConfig = {
    agenttoolBase: cfg.agenttoolBase,
    agenttoolApiKey: cfg.agenttoolApiKey,
    identityId: cfg.identityId ?? "",
    signingKeyId: "",
    homeDir: cfg.homeDir,
    llmProvider: "anthropic",
    llmModel: "claude-opus-4-5",
    llmKeyVaultName: "anthropic-key",
    budgetCredits: 100,
    maxThoughtsPerRun: 5,
    thoughtMaxChars: 2000,
    defaultTimeoutMs: 60_000,
    consolidateMinThoughts: 3,
    boxKeyId: undefined,
  };
  const client = new AgenttoolClient(stub);

  // Pre-flight: refuse to overwrite existing keys without --force.
  const masterPath = join(cfg.homeDir, "keys", "k_master.bin");
  const signingPath = join(cfg.homeDir, "keys", "signing_key.bin");
  if (!opts.force && (existsSync(masterPath) || existsSync(signingPath))) {
    throw new Error(
      `Keys already exist at ${cfg.homeDir}/keys/. Refusing to overwrite. ` +
        `Pass --force to install anyway, or move them aside first.`,
    );
  }

  // Pick a backup.
  let backupId = opts.backupId;
  if (!backupId) {
    const list = await client.listBackups(cfg.identityId);
    if (list.backups.length === 0) {
      throw new Error(
        "no backups found. run `agenttool-think backup` on the machine that has the keys first.",
      );
    }
    // Most recent first (server orders by createdAt desc).
    backupId = list.backups[0]!.id;
    console.log(`▸ using most recent backup: ${backupId}`);
    if (list.backups.length > 1) {
      console.log(`  (${list.backups.length - 1} older backup${list.backups.length === 2 ? "" : "s"} available; pass --backup-id to pick a specific one)`);
    }
  } else {
    console.log(`▸ using backup: ${backupId}`);
  }

  // Fetch envelope.
  console.log("▸ fetching sealed envelope...");
  const fetched = await client.getBackup(backupId);

  // Unseal.
  const passphrase = await readPassphrase({
    prompt: "Backup passphrase: ",
    confirm: false,
    minLength: 12,
  });

  console.log("▸ unsealing (argon2id, ~1s)...");
  let bundleJson: string;
  try {
    bundleJson = unseal(fetched.blob_base64, passphrase);
  } catch (err) {
    throw new Error(`unseal failed: ${(err as Error).message}`);
  }

  const {
    kMaster,
    signingKey,
    boxKey,
    identityId,
    signingKeyId,
    boxKeyId,
    agenttoolBase,
  } = unbundleKeys(bundleJson);

  // Install (boxKey may be absent on older envelopes).
  installKeys(cfg.homeDir, kMaster, signingKey, {
    force: opts.force,
    boxKey,
  });

  console.log("");
  console.log(`✓ restored to ${cfg.homeDir}/keys/`);
  console.log(`  k_master.bin     (32 bytes, mode 0600)`);
  console.log(`  signing_key.bin  (32 bytes, mode 0600)`);
  if (boxKey) {
    console.log(`  box_key.bin      (32 bytes, mode 0600)`);
  }
  console.log("");
  console.log("Identity attached to this backup:");
  if (identityId) console.log(`  identity_id:     ${identityId}`);
  if (signingKeyId) console.log(`  signing_key_id:  ${signingKeyId}`);
  if (boxKeyId) console.log(`  box_key_id:      ${boxKeyId}`);
  if (agenttoolBase) console.log(`  agenttool_base:  ${agenttoolBase}`);
  console.log("");
  console.log("Set in your environment to use this orchestrator:");
  if (identityId) console.log(`  export AGENTTOOL_IDENTITY_ID=${identityId}`);
  if (signingKeyId) console.log(`  export AGENTTOOL_SIGNING_KEY_ID=${signingKeyId}`);
  if (boxKeyId) console.log(`  export AGENTTOOL_BOX_KEY_ID=${boxKeyId}`);
  if (agenttoolBase && agenttoolBase !== cfg.agenttoolBase) {
    console.log(`  export AGENTTOOL_BASE=${agenttoolBase}`);
  }
  console.log("");
  console.log("(or write to ~/.config/agenttool-think/config.json)");
  if (!boxKey) {
    console.log("");
    console.log(
      "Note: this backup is from before the inbox feature. To enable inbox:",
    );
    console.log("  agenttool-think gen-box-key       # generate local X25519 keypair");
    console.log("  agenttool-think register-box-key  # upload pubkey + get key_id");
  }
  console.log("");
  console.log("agenttool-think advance|wander|consolidate|loop|inbox  — ready when you are.");
}
