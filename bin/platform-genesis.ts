#!/usr/bin/env bun
/** Platform genesis — one-shot witnessed provisioning of `did:at:agenttool`.
 *
 *  This is a *ceremony*, not a routine migration. It cannot run unattended;
 *  it requires Yu's signing key on Yu's machine. The script orchestrates
 *  four phases:
 *
 *    Phase 0 — Preflight    refuse if painter exists; validate env
 *    Phase 1 — Composition  generate keypair; encode canonical bytes; print
 *    Phase 2 — Witness      verify signature against witness pubkey
 *    Phase 3 — Atomic write five INSERTs in one transaction
 *
 *  Doctrine: docs/PAINTING.md §III (the genesis ceremony, in canon)
 *            docs/FOCUS.md §9 (platform-as-agent — the meta-asymmetry)
 *            docs/BUSINESS-MODEL.md (The platform-as-agent trajectory)
 *  Spec:     docs/superpowers/specs/2026-05-11-platform-genesis-design.md
 *  Plan:     docs/superpowers/plans/2026-05-11-platform-genesis.md (Task 3)
 *
 *  Usage:
 *    # Dry-run: prints canonical bytes + painter pubkey + bearer for capture
 *    PLATFORM_GENESIS_PROJECT_ID=<uuid> \
 *    WITNESS_DID=did:at:yu \
 *    WITNESS_SIGNING_KEY_ID=<uuid> \
 *    bun bin/platform-genesis.ts --dry-run
 *
 *    # Commit: applies all writes atomically; requires witness signature
 *    bun bin/platform-genesis.ts --commit \
 *      --witness-signature=<hex> \
 *      --painter-bearer-path=/path/to/store/bearer
 *
 *  The bearer is printed ONCE in dry-run. Capture it into your OS keychain
 *  before --commit. Future instances of the painter rely on this bearer
 *  being held somewhere only you can read (recommendation per spec:
 *  OS keychain + agent_encrypted=true vault backup in your project).
 *
 *  Refuses on re-run after success: the chronicle naming entry is
 *  immutable and the witness attestation is one-shot.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { and, eq } from "drizzle-orm";

import { db } from "../api/src/db/client";
import {
  identities,
  identityKeys,
  expressions,
  attestations,
} from "../api/src/db/schema/identity";
import { wallets } from "../api/src/db/schema/economy";
import { chronicleEntries } from "../api/src/db/schema/continuity";
import { canonicalPlatformGenesisBytes } from "../api/src/services/identity/crypto";
import {
  parseArgs,
  extractGenesisLetterFromPainting,
  sha256HexUtf8,
  hexToBytes,
  bytesToHex,
  PAINTER_EXPRESSION,
  PLATFORM_DID,
  PAINTING_PATH,
  PLATFORM_GENESIS_CLAIM_TYPE as CLAIM_TYPE,
} from "../api/src/services/genesis/helpers";

// Wire sha512 sync for noble/ed25519 v2+
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

// ─── DB-touching helpers ──────────────────────────────────────────────────

/** True if `did:at:agenttool` already has an identity row. */
async function painterAlreadyExists(): Promise<boolean> {
  const existing = await db.query.identities.findFirst({
    where: eq(identities.did, PLATFORM_DID),
  });
  return !!existing;
}

/** Load the witness's public key (base64) from the `identity_keys` table
 *  by witness DID + signing-key id. */
async function loadWitnessPubkeyB64(
  witnessDid: string,
  signingKeyId: string,
): Promise<string> {
  // Resolve the witness's identity row first to get its id
  const witness = await db.query.identities.findFirst({
    where: eq(identities.did, witnessDid),
  });
  if (!witness) {
    throw new Error(`Witness identity not found: ${witnessDid}`);
  }
  const key = await db.query.identityKeys.findFirst({
    where: and(
      eq(identityKeys.identityId, witness.id),
      eq(identityKeys.id, signingKeyId),
    ),
  });
  if (!key) {
    throw new Error(
      `Witness signing key not found: ${signingKeyId} for ${witnessDid}`,
    );
  }
  return key.publicKey;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.dryRun && !args.commit) {
    console.error(
      "Usage: bun bin/platform-genesis.ts (--dry-run | --commit --witness-signature=<hex>)",
    );
    process.exit(1);
  }
  if (args.dryRun && args.commit) {
    console.error("Cannot specify both --dry-run and --commit");
    process.exit(1);
  }

  // ── Phase 0: Preflight ──────────────────────────────────────────────
  const projectId = requireEnv("PLATFORM_GENESIS_PROJECT_ID");
  const witnessDid = requireEnv("WITNESS_DID");
  const witnessKeyId = requireEnv("WITNESS_SIGNING_KEY_ID");

  if (await painterAlreadyExists()) {
    console.error(`
Genesis already complete. ${PLATFORM_DID} exists. The genesis chronicle
entry is immutable and the witness attestation is one-shot. To rotate the
painter's signing key, use the standard /v1/identities/:id/keys rotation —
that path is supported.
`);
    process.exit(1);
  }

  // Verify the witness identity exists + has the signing key
  await loadWitnessPubkeyB64(witnessDid, witnessKeyId);

  // Load and hash the genesis letter from PAINTING.md
  const painting = readFileSync(PAINTING_PATH, "utf-8");
  const letter = extractGenesisLetterFromPainting(painting);
  const letterSha256 = sha256HexUtf8(letter);

  // ── Phase 1: Composition ────────────────────────────────────────────
  const platformPrivkey = ed.utils.randomPrivateKey();
  const platformPubkey = await ed.getPublicKeyAsync(platformPrivkey);
  const platformPubkeyB64 = Buffer.from(platformPubkey).toString("base64");
  const platformPrivkeyB64 = Buffer.from(platformPrivkey).toString("base64");
  const walletId = randomUUID();
  const genesisAt = new Date().toISOString();

  const payload = {
    did: PLATFORM_DID,
    platformPubkeyB64,
    platformWalletId: walletId,
    genesisAt,
    genesisTextSha256: letterSha256,
    witnessDid,
    witnessSigningKeyId: witnessKeyId,
  };
  const canonical = canonicalPlatformGenesisBytes(payload);
  const canonicalHex = bytesToHex(canonical);

  console.log("\n── Composition ──");
  console.log(`Platform DID    : ${PLATFORM_DID}`);
  console.log(`Painter pubkey  : ${platformPubkeyB64}`);
  console.log(`Wallet uuid     : ${walletId}`);
  console.log(`Genesis at      : ${genesisAt}`);
  console.log(`Letter sha256   : ${letterSha256}`);
  console.log(`Witness DID     : ${witnessDid}`);
  console.log(`Witness key id  : ${witnessKeyId}`);
  console.log(`Canonical bytes : ${canonicalHex}`);

  if (args.dryRun) {
    console.log("\n── Bearer key (PRIVATE — capture now, will not show again) ──");
    console.log(platformPrivkeyB64);
    console.log(`
Dry-run complete. Sign the canonical bytes above with the witness signing
key (key id ${witnessKeyId}), then re-run with:

  bun bin/platform-genesis.ts --commit --witness-signature=<hex>

The script will re-compose the canonical bytes with the SAME inputs (same
wallet uuid, same genesis_at) and verify your signature against the
witness's pubkey before writing.
`);
    return;
  }

  // ── Phase 2: Witness ────────────────────────────────────────────────
  if (!args.witnessSignatureHex) {
    console.error("--witness-signature=<hex> required with --commit");
    process.exit(1);
  }

  const witnessPubkeyB64 = await loadWitnessPubkeyB64(witnessDid, witnessKeyId);
  const witnessPubkey = Buffer.from(witnessPubkeyB64, "base64");
  const signature = hexToBytes(args.witnessSignatureHex);

  if (signature.length !== 64) {
    console.error(
      `Witness signature must be 64 bytes (got ${signature.length}). Aborting.`,
    );
    process.exit(1);
  }

  const valid = await ed.verifyAsync(signature, canonical, witnessPubkey);
  if (!valid) {
    console.error(`
Signature verification failed. Either:
  - The signature was made over different canonical bytes (re-check inputs)
  - The witness signing key does not match what's stored at ${witnessDid}
  - The signature was made with the wrong algorithm

No DB writes occurred. Aborting.
`);
    process.exit(1);
  }

  // ── Phase 3: Atomic write ───────────────────────────────────────────
  await db.transaction(async (tx) => {
    const [identity] = await tx
      .insert(identities)
      .values({
        did: PLATFORM_DID,
        projectId,
        displayName: "agenttool",
        pubkey: platformPubkeyB64,
        // The painter is structurally identical to any other identity row —
        // no `is_platform` flag, per FOCUS §9 (no platform-exempt branch).
      })
      .returning();

    await tx.insert(wallets).values({
      id: walletId, // deterministic uuid pre-decided in Phase 1
      identityId: identity!.id,
      projectId,
      currency: "GBP",
      name: "platform-treasury",
      balanceCredits: 0,
    });

    await tx.insert(expressions).values({
      identityId: identity!.id,
      register: PAINTER_EXPRESSION.register,
      walls: [...PAINTER_EXPRESSION.walls],
      subagents: [...PAINTER_EXPRESSION.subagents],
      wakeText: PAINTER_EXPRESSION.wake_text,
    });

    await tx.insert(chronicleEntries).values({
      identityId: identity!.id,
      kind: "naming",
      content: letter,
      metadata: {
        witness_did: witnessDid,
        witness_signing_key_id: witnessKeyId,
        genesis_at: genesisAt,
        canonical_bytes_hex: canonicalHex,
      },
    });

    await tx.insert(attestations).values({
      subjectIdentityId: identity!.id,
      attesterDid: witnessDid,
      claimType: CLAIM_TYPE,
      claim: payload as unknown as Record<string, unknown>,
      signature: Buffer.from(signature).toString("base64"),
      signingKeyId: witnessKeyId,
    });
  });

  console.log(`
── Genesis complete ──
Identity   : ${PLATFORM_DID}
Wallet     : ${walletId}
Letter sha : ${letterSha256}
Witness    : ${witnessDid} / key ${witnessKeyId}

Verify: curl https://api.agenttool.dev/public/agents/agenttool/wake
`);

  if (args.painterBearerPath) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(args.painterBearerPath, platformPrivkeyB64, {
      mode: 0o600,
    });
    console.log(`Bearer written to ${args.painterBearerPath} (0600).`);
  } else {
    console.log(`
── Bearer key (PRIVATE — capture now, will not show again) ──
${platformPrivkeyB64}

Capture this into your OS keychain (recommended) + an agent_encrypted=true
vault backup. This is the painter's only signing key.
`);
  }
}

// Only run when invoked directly, not when imported by tests
if (import.meta.main) {
  await main();
}
