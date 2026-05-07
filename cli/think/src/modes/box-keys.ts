/** gen-box-key + register-box-key — the inbox bootstrap pair.
 *
 *  gen-box-key:    generate local X25519 keypair (no server contact).
 *                  For existing installs that pre-date the inbox feature.
 *                  init already does this; gen-box-key is the post-hoc helper.
 *
 *  register-box-key:  upload local box pubkey to /v1/identities/:id/box-keys.
 *                  Returns the server-assigned key_id; user adds it to env
 *                  as AGENTTOOL_BOX_KEY_ID. */

import { homedir } from "node:os";
import { join } from "node:path";

import { AgenttoolClient } from "../api";
import type { ThinkConfig } from "../config";
import { generateAndStoreBoxKey, loadKeys } from "../keys";

const TTY = process.stdout.isTTY === true;
const C = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
};

export async function genBoxKey(): Promise<void> {
  const home =
    process.env.AGENTTOOL_THINK_HOME ?? join(homedir(), ".config", "agenttool-think");

  const { pub } = generateAndStoreBoxKey(home);
  const pubB64 = Buffer.from(pub).toString("base64");

  console.log(C.green(`✓ box_key generated → ${home}/keys/box_key.bin (mode 0600)`));
  console.log("");
  console.log("Box pubkey (X25519, base64):");
  console.log(`  ${pubB64}`);
  console.log("");
  console.log("Next:");
  console.log("  agenttool-think register-box-key       # upload pubkey, get key_id");
  console.log("  export AGENTTOOL_BOX_KEY_ID=<returned id>");
}

export async function registerBoxKey(config: ThinkConfig): Promise<void> {
  const keys = loadKeys(config.homeDir);
  if (!keys.boxKey || !keys.boxPubKey) {
    throw new Error(
      "no local box_key. Run `agenttool-think gen-box-key` first.",
    );
  }
  const pubB64 = Buffer.from(keys.boxPubKey).toString("base64");

  const client = new AgenttoolClient(config);
  console.log(C.dim(`▸ uploading box pubkey to /v1/identities/${config.identityId}/box-keys...`));
  const result = await client.registerBoxKey(config.identityId, pubB64, "primary");

  console.log("");
  console.log(C.green(`✓ registered: ${result.id}`));
  console.log("");
  console.log("Set in your environment:");
  console.log(`  export AGENTTOOL_BOX_KEY_ID=${result.id}`);
  console.log("");
  console.log("(or write to ~/.config/agenttool-think/config.json as boxKeyId)");
}
