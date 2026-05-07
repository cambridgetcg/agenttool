#!/usr/bin/env bun
/** agenttool-think — client-side strand orchestrator.
 *
 *  Runs on the agent's own substrate. Holds K_master + ed25519 signing
 *  key locally. Encrypts thoughts before they reach agenttool's server.
 *  Plaintext never touches our infrastructure.
 *
 *  Usage:
 *    agenttool-think init                       generate K_master + signing key
 *    agenttool-think advance                    advance the highest-priority strand
 *    agenttool-think wander                     associative drift (scaffold)
 *    agenttool-think consolidate [--dry-run]    dream / distill recent thoughts
 *                                               into considered memory
 *    agenttool-think pubkey                     print signing pubkey (base64)
 *
 *  See README.md for setup. */

import { loadConfig } from "./config";
import { generateAndStoreKeys, loadKeys } from "./keys";
import { advance } from "./modes/advance";
import { wander } from "./modes/wander";
import { consolidate } from "./modes/consolidate";

function usage(): void {
  console.log(
    `agenttool-think — client-side strand orchestrator

Usage:
  agenttool-think init                  Generate K_master + ed25519 signing key
  agenttool-think pubkey                Print signing pubkey (base64) for upload to
                                        /v1/identities/:id/keys before first thought
  agenttool-think advance               Advance the highest-priority active strand
  agenttool-think wander                Associative drift across strands (scaffold)
  agenttool-think consolidate [--dry-run]
                                        Distill recent thoughts into memories
                                        (the dreaming layer). --dry-run shows
                                        what WOULD be written without committing.

Configuration: env vars OR ~/.config/agenttool-think/config.json
  AGENTTOOL_BASE                        default https://api.agenttool.dev
  AGENTTOOL_API_KEY                     your at_* key (or macOS keychain s=agenttool)
  AGENTTOOL_IDENTITY_ID                 your agent's identity uuid
  AGENTTOOL_SIGNING_KEY_ID              which identity_keys row holds the pubkey

  AGENTTOOL_THINK_HOME                  default ~/.config/agenttool-think
  AGENTTOOL_THINK_LLM                   anthropic | openai
  AGENTTOOL_THINK_LLM_MODEL             e.g. claude-opus-4-5
  AGENTTOOL_THINK_LLM_KEY_VAULT_NAME    /v1/vault/<name> for the provider key

  AGENTTOOL_THINK_EMBEDDING_PROVIDER    optional: openai (1536-dim)
  AGENTTOOL_THINK_EMBEDDING_MODEL       default text-embedding-3-small
  AGENTTOOL_THINK_EMBEDDING_KEY_VAULT_NAME  /v1/vault/<name>
  AGENTTOOL_THINK_CONSOLIDATE_MIN_THOUGHTS  default 3

Doctrine: docs/STRANDS.md, docs/MEMORY-TIERS.md, docs/IDENTITY-ANCHOR.md.
`,
  );
}

async function pubkey(): Promise<void> {
  const config = loadConfig();
  const keys = loadKeys(config.homeDir);
  console.log(Buffer.from(keys.signingPubKey).toString("base64"));
}

async function init(): Promise<void> {
  const homeOverride = process.env.AGENTTOOL_THINK_HOME;
  const home = homeOverride ?? `${process.env.HOME ?? "~"}/.config/agenttool-think`;
  const keys = generateAndStoreKeys(home);
  console.log(`✓ K_master generated → ${home}/keys/k_master.bin (mode 0600)`);
  console.log(`✓ Signing key generated → ${home}/keys/signing_key.bin (mode 0600)`);
  console.log(``);
  console.log(`Signing pubkey (base64):`);
  console.log(`  ${Buffer.from(keys.signingPubKey).toString("base64")}`);
  console.log(``);
  console.log(`Next steps:`);
  console.log(`  1. Upload the pubkey to your agent's identity:`);
  console.log(`     curl -X POST $AGENTTOOL_BASE/v1/identities/$ID/keys \\`);
  console.log(`       -H "Authorization: Bearer $AGENTTOOL_API_KEY" \\`);
  console.log(`       -d '{"public_key":"<paste base64 above>","label":"think-orchestrator"}'`);
  console.log(`  2. Note the returned key id; set AGENTTOOL_SIGNING_KEY_ID to it.`);
  console.log(`  3. Run \`agenttool-think advance\` against an active strand.`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "init":
      await init();
      return;
    case "pubkey":
      await pubkey();
      return;
    case "advance": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      await advance(config, keys);
      return;
    }
    case "wander": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      await wander(config, keys);
      return;
    }
    case "consolidate": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      const dryRun = process.argv.slice(3).includes("--dry-run");
      await consolidate(config, keys, { dryRun });
      return;
    }
    case "-h":
    case "--help":
    case undefined:
      usage();
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
