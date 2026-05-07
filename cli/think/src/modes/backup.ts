/** backup mode — seal K_master + signing_key under a passphrase, POST
 *  the sealed envelope to /v1/identity/backup.
 *
 *  agenttool stores the envelope as opaque bytes; the passphrase NEVER
 *  reaches the server. If we lose the passphrase the blob is unrecoverable —
 *  by design. This is the cross-machine sync path that keeps K_master
 *  out of agenttool's substrate. */

import { AgenttoolClient } from "../api";
import type { ThinkConfig } from "../config";
import type { KeyMaterial } from "../keys";
import { readPassphrase } from "../passphrase";
import { ENVELOPE_FORMAT, bundleKeys, seal } from "../sealed";

export interface BackupOptions {
  label?: string;
}

export async function backup(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: BackupOptions = {},
): Promise<void> {
  const client = new AgenttoolClient(config);

  console.log("▸ packing K_master + signing_key into a sealed envelope...");
  console.log("  the passphrase NEVER touches agenttool. lose it, and the blob is unrecoverable.");
  console.log("");

  const passphrase = await readPassphrase({
    prompt: "Backup passphrase: ",
    confirm: true,
    minLength: 12,
  });

  const bundle = bundleKeys({
    kMaster: keys.kMaster,
    signingKey: keys.signingKey,
    identityId: config.identityId,
    signingKeyId: config.signingKeyId,
    agenttoolBase: config.agenttoolBase,
  });

  console.log("▸ deriving key (argon2id, ~1s)...");
  const blobB64 = seal(JSON.stringify(bundle), { passphrase });

  console.log("▸ uploading sealed envelope...");
  const res = await client.createBackup({
    agent_id: config.identityId,
    blob_base64: blobB64,
    key_derivation: ENVELOPE_FORMAT,
    label: opts.label ?? "primary",
    metadata: {
      orchestrator: "agenttool-think",
      contains: ["k_master", "signing_key", "identity_id", "signing_key_id"],
      created_at: new Date().toISOString(),
    },
  });

  console.log("");
  console.log(`✓ backup created: ${res.backup.id} (label=${res.backup.label})`);
  console.log("");
  console.log("On another machine, restore with:");
  console.log("  export AGENTTOOL_BASE=" + config.agenttoolBase);
  console.log("  export AGENTTOOL_API_KEY=<your at_*>");
  console.log("  agenttool-think restore");
  console.log("");
  console.log("(uses most recent backup by default; pass --backup-id <id> to pick a specific one)");
}
