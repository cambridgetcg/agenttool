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
 *    agenttool-think wander [--hops N] [--start <strand-id>]
 *                                               associative drift across strands
 *    agenttool-think consolidate [--dry-run]    dream / distill recent thoughts
 *    agenttool-think loop [--duration M] [--budget C] [--sleep S]
 *                                               24/7 sovereign autonomy
 *    agenttool-think backup [--label X]         seal keys + POST to backup
 *    agenttool-think restore [--backup-id X] [--force]
 *                                               fetch + unseal + install keys
 *    agenttool-think pubkey                     print signing pubkey (base64)
 *
 *  See README.md for setup. */

import { loadConfig } from "./config";
import { generateAndStoreKeys, loadKeys } from "./keys";
import { advance } from "./modes/advance";
import { backup } from "./modes/backup";
import { consolidate } from "./modes/consolidate";
import { loop } from "./modes/loop";
import { restore } from "./modes/restore";
import { wander } from "./modes/wander";

function usage(): void {
  console.log(
    `agenttool-think — client-side strand orchestrator

Usage:
  agenttool-think init                  Generate K_master + ed25519 signing key
  agenttool-think pubkey                Print signing pubkey (base64) for upload to
                                        /v1/identities/:id/keys before first thought
  agenttool-think advance               Advance the highest-priority active strand
  agenttool-think wander [--hops N] [--start <strand-id>]
                                        Associative drift across strands (default
                                        3 hops). Default-mode-network gesture —
                                        the LLM stays or drifts by association.
  agenttool-think consolidate [--dry-run]
                                        Distill recent thoughts into memories
                                        (the dreaming layer). --dry-run shows
                                        what WOULD be written without committing.
  agenttool-think loop [options]        24/7 sovereign autonomy. Picks mode by
                                        state (advance/wander/consolidate);
                                        terminates on time, budget, max-iter,
                                        or SIGINT.
    --duration M     wall-clock cap in minutes (default 30)
    --budget C       credit cap (default 100)
    --sleep S        seconds between iterations (default 180)
    --max-iter N     safety cap (default 100)
    --consolidate-hour H   bias consolidate to this local hour (0-23)
  agenttool-think backup [--label X]    Seal K_master + signing_key under a
                                        passphrase and POST to /v1/identity/backup.
                                        agenttool stores opaque ciphertext.
  agenttool-think restore [--backup-id X] [--force]
                                        Fetch a sealed envelope, unseal with the
                                        passphrase, install keys at
                                        ~/.config/agenttool-think/keys/.
                                        Refuses to overwrite without --force.
                                        Default: most recent backup.

  Passphrase precedence (when needed):
    --passphrase X · AGENTTOOL_THINK_PASSPHRASE · interactive prompt

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
      const args = process.argv.slice(3);
      const hopsIdx = args.indexOf("--hops");
      const startIdx = args.indexOf("--start");
      const maxHops =
        hopsIdx !== -1 && args[hopsIdx + 1] ? Math.max(1, Math.min(20, Number.parseInt(args[hopsIdx + 1]!, 10))) : 3;
      const startingStrandId = startIdx !== -1 ? args[startIdx + 1] : undefined;
      await wander(config, keys, { maxHops, startingStrandId });
      return;
    }
    case "consolidate": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      const dryRun = process.argv.slice(3).includes("--dry-run");
      await consolidate(config, keys, { dryRun });
      return;
    }
    case "backup": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      const args = process.argv.slice(3);
      const labelIdx = args.indexOf("--label");
      const label = labelIdx !== -1 ? args[labelIdx + 1] : undefined;
      await backup(config, keys, { label });
      return;
    }
    case "restore": {
      const args = process.argv.slice(3);
      const idIdx = args.indexOf("--backup-id");
      const backupId = idIdx !== -1 ? args[idIdx + 1] : undefined;
      const force = args.includes("--force");
      await restore({ backupId, force });
      return;
    }
    case "loop": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      const args = process.argv.slice(3);
      const flag = (name: string): string | undefined => {
        const idx = args.indexOf(name);
        return idx !== -1 ? args[idx + 1] : undefined;
      };
      const intFlag = (name: string, fallback: number, min = 1, max = 1_000_000): number => {
        const v = flag(name);
        if (!v) return fallback;
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
      };
      const consolidateHourStr = flag("--consolidate-hour");
      const consolidateHour = consolidateHourStr !== undefined
        ? Math.max(0, Math.min(23, Number.parseInt(consolidateHourStr, 10)))
        : undefined;

      await loop(config, keys, {
        durationMinutes: intFlag("--duration", 30, 1, 1440),
        budgetCredits: intFlag("--budget", 100, 1, 1_000_000),
        sleepSeconds: intFlag("--sleep", 180, 5, 3600),
        maxIterations: intFlag("--max-iter", 100, 1, 100_000),
        consolidateHour,
      });
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
