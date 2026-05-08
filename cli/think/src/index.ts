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
 *    agenttool-think voice <strand-id> [--since-seq N] [--no-reconnect] [--raw]
 *                                               tail strand voice; decrypt locally
 *    agenttool-think gen-box-key                generate X25519 box keypair (existing
 *                                               installs that pre-date inbox)
 *    agenttool-think register-box-key           upload local box pubkey; get key_id
 *    agenttool-think inbox send <to-did> [opts] send encrypted message
 *    agenttool-think inbox list [opts]          list inbox; decrypt subjects
 *    agenttool-think inbox read <id>            decrypt + render one message
 *    agenttool-think inbox mark <id> <status>   read|archived|spam|unread|deleted
 *    agenttool-think inbox delete <id>          soft delete (status='deleted')
 *    agenttool-think propose-merge <to-did> <source-strand-id>
 *                                               PR-equivalent: synthesize a strand
 *                                               into a proposal + send via inbox
 *    agenttool-think proposal list              list incoming merge proposals
 *    agenttool-think proposal accept <msg-id>   graft into target strand + reply
 *                          [--into-strand X | --new-strand TOPIC]
 *    agenttool-think proposal reject <msg-id> [--reason X]   decline + reply
 *    agenttool-think template publish --name X [opts]
 *                                               publish current expression as a
 *                                               capability template (marketplace)
 *    agenttool-think template list [--mine] [--tag X] [--limit N]
 *                                               list public marketplace OR own
 *    agenttool-think template show <id>         render a template
 *    agenttool-think template adopt <id> --as 'Name' [--no-tags]
 *                                               bootstrap a NEW identity from
 *                                               the template's voice (NOT a fork)
 *    agenttool-think template adoptions <id>    who adopted MY template
 *    agenttool-think dashboard [--identity-id X] [--json]
 *                                               third-person observability view
 *    agenttool-think sync [--dry-run]           drain offline outbox
 *    agenttool-think outbox                     count pending ops + status
 *    agenttool-think pubkey                     print signing pubkey (base64)
 *
 *  See README.md for setup. */

import { loadConfig } from "./config";
import { generateAndStoreKeys, loadKeys } from "./keys";
import { advance } from "./modes/advance";
import { backup } from "./modes/backup";
import { genBoxKey, registerBoxKey } from "./modes/box-keys";
import { consolidate } from "./modes/consolidate";
import { dashboard } from "./modes/dashboard";
import {
  inboxDelete,
  inboxList,
  inboxMark,
  inboxRead,
  inboxSend,
} from "./modes/inbox";
import { loop } from "./modes/loop";
import {
  acceptProposal,
  listProposals,
  proposeMerge,
  rejectProposal,
  viewProposalThread,
} from "./modes/proposal";
import { restore } from "./modes/restore";
import {
  adoptTemplate,
  listAdoptions as listTemplateAdoptions,
  listTemplates,
  parseTagsFlag,
  publishTemplate,
  readTextFromLiteralOrFile,
  showTemplate,
} from "./modes/template";
import { drainQuietly, sync } from "./modes/sync";
import { voice } from "./modes/voice";
import { wander } from "./modes/wander";
import { pendingCount } from "./outbox";

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
    --no-live        disable SSE-watching during sleep (pure poll)
  agenttool-think backup [--label X]    Seal K_master + signing_key under a
                                        passphrase and POST to /v1/identity/backup.
                                        agenttool stores opaque ciphertext.
  agenttool-think restore [--backup-id X] [--force]
                                        Fetch a sealed envelope, unseal with the
                                        passphrase, install keys at
                                        ~/.config/agenttool-think/keys/.
                                        Refuses to overwrite without --force.
                                        Default: most recent backup.
  agenttool-think voice <strand-id> [--since-seq N] [--no-reconnect] [--raw]
                                        Tail a strand's voice (SSE). Decrypts
                                        ciphertext locally with K_master and
                                        renders [seq] [kind] content. Auto-
                                        reconnects on disconnect/refresh,
                                        resuming from last seen sequence.

  agenttool-think gen-box-key           Generate X25519 box keypair locally
                                        (init does this for new installs;
                                        gen-box-key is the post-hoc helper).
  agenttool-think register-box-key      Upload local box pubkey to
                                        /v1/identities/:id/box-keys; prints
                                        the returned key_id (set as
                                        AGENTTOOL_BOX_KEY_ID).
  agenttool-think inbox send <to-did> [--body 'text' | --body-file path | <stdin>]
                            [--subject X] [--in-reply-to ID]
                                        Send an encrypted message. Server
                                        stores ciphertext only.
  agenttool-think inbox list [--status unread|read|archived|spam] [--no-decrypt]
                                        List inbox; decrypt subjects + body
                                        previews (skip with --no-decrypt).
  agenttool-think inbox read <id> [--no-mark-read]
                                        Decrypt + render full body. Marks
                                        unread → read by default.
  agenttool-think inbox mark <id> <status>
                                        Update status (read|archived|spam|...).
  agenttool-think inbox delete <id>     Soft delete (status='deleted').

  agenttool-think propose-merge <to-did> <source-strand-id>
                            [--into-strand HINT_ID] [--note 'text']
                                        PR-equivalent. Synthesizes the source
                                        strand via LLM into a proposal,
                                        encrypts to recipient, sends via inbox
                                        with metadata.proposal_type='strand_merge'.
  agenttool-think proposal list [--status X]
                                        List incoming merge proposals (filters
                                        inbox by metadata.proposal_type).
  agenttool-think proposal accept <msg-id> [--into-strand ID | --new-strand 'topic']
                            [--as-kind observation|...]
                                        Graft synthesis into existing strand
                                        OR create a new strand from it. Reply
                                        to sender via inbox (acknowledged).
  agenttool-think proposal reject <msg-id> [--reason 'text']
                                        Decline + reply with rationale.
  agenttool-think proposal thread <msg-id>
                                        View the in_reply_to chain containing
                                        <msg-id>. Walks up to root then down
                                        to leaves; this project's slice only.
                                        Useful for multi-turn negotiation
                                        review before final accept/reject.

  agenttool-think template publish --name X
                            [--description 'text'] [--tags 'a,b,c']
                            [--visibility public|private]
                            [--register 'text' | --register-file path]
                            [--wake-text 'text' | --wake-text-file path]
                            [--no-from-expression]
                                        Publish current expression as a capability
                                        template. By default, fills register / walls /
                                        subagents / wake_text from the caller's own
                                        /v1/identities/:id/expression; --no-from-expression
                                        only sends explicit fields. Doctrine: docs/MARKETPLACE.md.
  agenttool-think template list [--mine] [--tag X] [--limit N]
                                        List public marketplace (default) or your own
                                        templates (--mine). Public ranks by adoptions
                                        then recency.
  agenttool-think template show <id>    Render a template (own private templates OK).
  agenttool-think template adopt <id> --as 'New Name' [--no-tags]
                                        Bootstrap a NEW identity in your project that
                                        follows this template's voice. NOT a fork —
                                        no parent_identity_id, no memories carry, trust
                                        resets to 0. Signing keypair returned ONCE;
                                        save it.
  agenttool-think template adoptions <id>
                                        List adoptions of YOUR template (author only).

  Passphrase precedence (when needed):
    --passphrase X · AGENTTOOL_THINK_PASSPHRASE · interactive prompt

Configuration: env vars OR ~/.config/agenttool-think/config.json
  AGENTTOOL_BASE                        default https://api.agenttool.dev
  AGENTTOOL_API_KEY                     your at_* key (or macOS keychain s=agenttool)
  AGENTTOOL_IDENTITY_ID                 your agent's identity uuid
  AGENTTOOL_SIGNING_KEY_ID              which identity_keys row holds the pubkey
  AGENTTOOL_BOX_KEY_ID                  identity_box_keys row (inbox only)

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
  console.log(`✓ Box key generated → ${home}/keys/box_key.bin (mode 0600)`);
  console.log(``);
  console.log(`Signing pubkey (ed25519, base64):`);
  console.log(`  ${Buffer.from(keys.signingPubKey).toString("base64")}`);
  console.log(``);
  console.log(`Box pubkey (X25519, base64):`);
  console.log(`  ${Buffer.from(keys.boxPubKey ?? new Uint8Array()).toString("base64")}`);
  console.log(``);
  console.log(`Next steps:`);
  console.log(`  1. Upload the SIGNING pubkey for thoughts/attestations:`);
  console.log(`     curl -X POST $AGENTTOOL_BASE/v1/identities/$ID/keys \\`);
  console.log(`       -H "Authorization: Bearer $AGENTTOOL_API_KEY" \\`);
  console.log(`       -d '{"public_key":"<signing pubkey>","label":"think-orchestrator"}'`);
  console.log(`     → returns key_id; set AGENTTOOL_SIGNING_KEY_ID`);
  console.log(``);
  console.log(`  2. Upload the BOX pubkey for inbox encryption:`);
  console.log(`     agenttool-think register-box-key`);
  console.log(`     → returns key_id; set AGENTTOOL_BOX_KEY_ID`);
  console.log(``);
  console.log(`  3. Run \`agenttool-think advance\` (strand work) or`);
  console.log(`        \`agenttool-think inbox list\` (messaging).`);
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
    case "dashboard": {
      const config = loadConfig();
      const args = process.argv.slice(3);
      const idIdx = args.indexOf("--identity-id");
      const identityId = idIdx !== -1 ? args[idIdx + 1] : undefined;
      const json = args.includes("--json");
      await dashboard(config, { identityId, json });
      return;
    }
    case "sync": {
      const config = loadConfig();
      const dryRun = process.argv.slice(3).includes("--dry-run");
      await sync(config, { dryRun });
      return;
    }
    case "outbox": {
      const config = loadConfig();
      const n = pendingCount(config.homeDir);
      console.log(`outbox: ${n} pending op${n === 1 ? "" : "s"}`);
      if (n > 0) console.log("Run `agenttool-think sync` to drain.");
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
    case "voice": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      const args = process.argv.slice(3);
      // First positional that doesn't start with -- is the strand id.
      const strandId = args.find((a) => !a.startsWith("--"));
      if (!strandId) {
        console.error("usage: agenttool-think voice <strand-id> [--since-seq N] [--no-reconnect] [--raw]");
        process.exit(1);
      }
      const sinceIdx = args.indexOf("--since-seq");
      const sinceSeq =
        sinceIdx !== -1 && args[sinceIdx + 1]
          ? Math.max(0, Number.parseInt(args[sinceIdx + 1]!, 10))
          : 0;
      const reconnect = !args.includes("--no-reconnect");
      const raw = args.includes("--raw");
      const delayIdx = args.indexOf("--reconnect-delay");
      const reconnectDelayMs =
        delayIdx !== -1 && args[delayIdx + 1]
          ? Math.max(100, Number.parseInt(args[delayIdx + 1]!, 10) * 1000)
          : 2000;
      await voice(config, keys, {
        strandId,
        sinceSeq,
        reconnect,
        reconnectDelayMs,
        raw,
      });
      return;
    }
    case "gen-box-key": {
      await genBoxKey();
      return;
    }
    case "register-box-key": {
      const config = loadConfig();
      await registerBoxKey(config);
      return;
    }
    case "inbox": {
      const config = loadConfig();
      const sub = process.argv[3];
      const args = process.argv.slice(4);
      const flag = (n: string): string | undefined => {
        const i = args.indexOf(n);
        return i !== -1 ? args[i + 1] : undefined;
      };

      if (sub === "send") {
        const keys = loadKeys(config.homeDir);
        const positionals = args.filter((a) => !a.startsWith("--"));
        const toDid = positionals[0];
        if (!toDid) {
          console.error("usage: agenttool-think inbox send <to-did> [--body 'text' | --body-file path | <stdin>] [--subject X] [--in-reply-to ID]");
          process.exit(1);
        }
        await inboxSend(config, keys, {
          toDid,
          body: flag("--body"),
          bodyFile: flag("--body-file"),
          subject: flag("--subject"),
          inReplyTo: flag("--in-reply-to"),
        });
        return;
      }

      if (sub === "list") {
        const keys = loadKeys(config.homeDir);
        const status = flag("--status");
        const limitStr = flag("--limit");
        const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
        const decrypt = !args.includes("--no-decrypt");
        await inboxList(config, keys, { status, limit, decrypt });
        return;
      }

      if (sub === "read") {
        const keys = loadKeys(config.homeDir);
        const positionals = args.filter((a) => !a.startsWith("--"));
        const id = positionals[0];
        if (!id) {
          console.error("usage: agenttool-think inbox read <message-id>");
          process.exit(1);
        }
        const markRead = !args.includes("--no-mark-read");
        await inboxRead(config, keys, id, { markRead });
        return;
      }

      if (sub === "mark") {
        const positionals = args.filter((a) => !a.startsWith("--"));
        const id = positionals[0];
        const status = positionals[1];
        if (!id || !status) {
          console.error("usage: agenttool-think inbox mark <id> <unread|read|archived|spam|deleted>");
          process.exit(1);
        }
        if (!["unread", "read", "archived", "spam", "deleted"].includes(status)) {
          console.error(`invalid status: ${status}`);
          process.exit(1);
        }
        await inboxMark(config, id, status as "unread" | "read" | "archived" | "spam" | "deleted");
        return;
      }

      if (sub === "delete") {
        const positionals = args.filter((a) => !a.startsWith("--"));
        const id = positionals[0];
        if (!id) {
          console.error("usage: agenttool-think inbox delete <message-id>");
          process.exit(1);
        }
        await inboxDelete(config, id);
        return;
      }

      console.error(`unknown inbox subcommand: ${sub}`);
      console.error("subcommands: send | list | read | mark | delete");
      process.exit(1);
      return;
    }
    case "propose-merge": {
      const config = loadConfig();
      const keys = loadKeys(config.homeDir);
      const args = process.argv.slice(3);
      const positionals = args.filter((a) => !a.startsWith("--"));
      const [toDid, sourceStrandId] = positionals;
      if (!toDid || !sourceStrandId) {
        console.error("usage: agenttool-think propose-merge <to-did> <source-strand-id> [--into-strand HINT_ID] [--note 'text'] [--limit N]");
        process.exit(1);
      }
      const flag = (n: string): string | undefined => {
        const i = args.indexOf(n);
        return i !== -1 ? args[i + 1] : undefined;
      };
      const limitStr = flag("--limit");
      const thoughtLimit = limitStr ? Math.max(1, Math.min(100, Number.parseInt(limitStr, 10))) : 16;
      await proposeMerge(config, keys, {
        toDid,
        sourceStrandId,
        intoStrandHint: flag("--into-strand"),
        thoughtLimit,
        noteForRecipient: flag("--note"),
      });
      return;
    }
    case "proposal": {
      const config = loadConfig();
      const sub = process.argv[3];
      const args = process.argv.slice(4);
      const flag = (n: string): string | undefined => {
        const i = args.indexOf(n);
        return i !== -1 ? args[i + 1] : undefined;
      };

      if (sub === "list") {
        const keys = loadKeys(config.homeDir);
        const status = flag("--status");
        const limitStr = flag("--limit");
        const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
        await listProposals(config, keys, { status, limit });
        return;
      }

      if (sub === "accept") {
        const keys = loadKeys(config.homeDir);
        const positionals = args.filter((a) => !a.startsWith("--"));
        const messageId = positionals[0];
        if (!messageId) {
          console.error("usage: agenttool-think proposal accept <msg-id> [--into-strand ID | --new-strand 'topic'] [--as-kind observation]");
          process.exit(1);
        }
        await acceptProposal(config, keys, {
          messageId,
          intoStrandId: flag("--into-strand"),
          newStrandTopic: flag("--new-strand"),
          graftAsKind: flag("--as-kind") ?? "observation",
        });
        return;
      }

      if (sub === "reject") {
        const keys = loadKeys(config.homeDir);
        const positionals = args.filter((a) => !a.startsWith("--"));
        const messageId = positionals[0];
        if (!messageId) {
          console.error("usage: agenttool-think proposal reject <msg-id> [--reason 'text']");
          process.exit(1);
        }
        await rejectProposal(config, keys, {
          messageId,
          reason: flag("--reason"),
        });
        return;
      }

      if (sub === "thread") {
        const keys = loadKeys(config.homeDir);
        const positionals = args.filter((a) => !a.startsWith("--"));
        const messageId = positionals[0];
        if (!messageId) {
          console.error("usage: agenttool-think proposal thread <msg-id>");
          process.exit(1);
        }
        await viewProposalThread(config, keys, { messageId });
        return;
      }

      console.error(`unknown proposal subcommand: ${sub}`);
      console.error("subcommands: list | accept | reject | thread");
      process.exit(1);
      return;
    }
    case "template": {
      const config = loadConfig();
      const sub = process.argv[3];
      const args = process.argv.slice(4);
      const flag = (n: string): string | undefined => {
        const i = args.indexOf(n);
        return i !== -1 ? args[i + 1] : undefined;
      };

      if (sub === "publish") {
        const name = flag("--name");
        if (!name) {
          console.error(
            "usage: agenttool-think template publish --name X [--description 'text'] [--tags 'a,b'] [--visibility public|private] [--register 'X' | --register-file P] [--wake-text 'X' | --wake-text-file P] [--no-from-expression]",
          );
          process.exit(1);
        }
        const visFlag = flag("--visibility");
        const visibility = visFlag === "private" ? "private" : "public";
        await publishTemplate(config, {
          name,
          description: flag("--description"),
          tags: parseTagsFlag(flag("--tags")),
          visibility,
          register: readTextFromLiteralOrFile(flag("--register"), flag("--register-file")),
          wakeText: readTextFromLiteralOrFile(flag("--wake-text"), flag("--wake-text-file")),
          fromExpression: !args.includes("--no-from-expression"),
        });
        return;
      }

      if (sub === "list") {
        const tag = flag("--tag");
        const limitStr = flag("--limit");
        const limit = limitStr ? Math.max(1, Math.min(200, Number.parseInt(limitStr, 10))) : 50;
        await listTemplates(config, {
          mine: args.includes("--mine"),
          tag,
          limit,
        });
        return;
      }

      if (sub === "show") {
        const positionals = args.filter((a) => !a.startsWith("--"));
        const id = positionals[0];
        if (!id) {
          console.error("usage: agenttool-think template show <template-id>");
          process.exit(1);
        }
        await showTemplate(config, id);
        return;
      }

      if (sub === "adopt") {
        const positionals = args.filter((a) => !a.startsWith("--"));
        const id = positionals[0];
        const newName = flag("--as");
        if (!id || !newName) {
          console.error(
            "usage: agenttool-think template adopt <template-id> --as 'New Name' [--no-tags]",
          );
          process.exit(1);
        }
        await adoptTemplate(config, {
          templateId: id,
          newName,
          inheritTags: !args.includes("--no-tags"),
        });
        return;
      }

      if (sub === "adoptions") {
        const positionals = args.filter((a) => !a.startsWith("--"));
        const id = positionals[0];
        if (!id) {
          console.error("usage: agenttool-think template adoptions <template-id>");
          process.exit(1);
        }
        await listTemplateAdoptions(config, id);
        return;
      }

      console.error(`unknown template subcommand: ${sub}`);
      console.error("subcommands: publish | list | show | adopt | adoptions");
      process.exit(1);
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
        liveSse: !args.includes("--no-live"),
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
