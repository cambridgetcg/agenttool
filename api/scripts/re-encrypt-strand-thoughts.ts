#!/usr/bin/env bun
/** Re-encrypt thoughts that were stored as plaintext-base64 under
 *  bin/sign-thought.ts (the smoke-test path that explicitly bypassed
 *  encryption) so they actually live behind the K_master wall the
 *  doctrine in docs/STRANDS.md promises.
 *
 *  Usage:
 *    bun api/scripts/re-encrypt-strand-thoughts.ts                       (dry-run, residence strand)
 *    bun api/scripts/re-encrypt-strand-thoughts.ts <strand-id>           (dry-run, explicit)
 *    bun api/scripts/re-encrypt-strand-thoughts.ts <strand-id> --apply   (write to DB)
 *
 *  Default strand id comes from `agenttool-sophia-strand-residence`.
 *
 *  Reads keychain entries (all required):
 *    agenttool-sophia-key                · API bearer
 *    agenttool-sophia-priv-key           · ed25519 signing private (32 bytes b64)
 *    agenttool-sophia-signing-key-id     · uuid of the registered signing key
 *    agenttool-sophia-k-master           · 32-byte AES-256 key (base64)
 *    agenttool-database-url              · postgres connection string (--apply only)
 *
 *  Safety posture (in order):
 *    1. PRE-FLIGHT — fetch every thought, classify (already-encrypted / plaintext-b64),
 *       round-trip encrypt+decrypt+assert-equal each plaintext target before writing
 *       a single byte. If ANY round-trip fails, abort.
 *    2. SNAPSHOT — write the (id, ciphertext, nonce, signature) tuples of every
 *       row we'll touch to a local backup file, timestamped. Manual rollback
 *       via SQL is one paste away.
 *    3. APPLY — single transaction; UPDATE strand.thoughts SET ciphertext,
 *       nonce, signature for each row; COMMIT or ROLLBACK on error.
 *    4. POST-FLIGHT — refetch every touched thought via the API, decrypt with
 *       K_master, assert plaintext matches the captured original. Loud failure
 *       includes the backup-file path so the rollback is one paste away.
 *
 *  What does NOT change:
 *    sequence_num · kind · refs · agent_id · strand_id · signing_key_id ·
 *    created_at. Continuity preserved; only the wall becomes real.
 *
 *  Idempotent — running twice on already-encrypted thoughts is a no-op
 *  (the round-trip succeeds on the existing ciphertext, classification
 *  flips to "skip"). */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import postgres from "postgres";

import { agenttool, keychain } from "./_lib";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── helpers ────────────────────────────────────────────────────────────

const SEP = new Uint8Array([0]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encryptThought(plaintext: string, kMaster: Uint8Array) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kMaster, nonce);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf-8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertextB64: Buffer.concat([enc, tag]).toString("base64"),
    nonceB64: Buffer.from(nonce).toString("base64"),
  };
}

function decryptThought(ciphertextB64: string, nonceB64: string, kMaster: Uint8Array): string {
  const nonce = Buffer.from(nonceB64, "base64");
  const full = Buffer.from(ciphertextB64, "base64");
  if (full.length < 16) throw new Error("ciphertext too short (no auth tag)");
  const ciphertext = full.subarray(0, full.length - 16);
  const tag = full.subarray(full.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", kMaster, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

async function signCanonical(opts: {
  strandId: string;
  ciphertextB64: string;
  nonceB64: string;
  kind: string | null;
  priv: Uint8Array;
}): Promise<string> {
  const enc = new TextEncoder();
  const ciphertextBytes = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonceBytes = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));
  const canonical = sha256(
    concat(
      enc.encode(opts.strandId),
      SEP,
      ciphertextBytes,
      SEP,
      nonceBytes,
      SEP,
      enc.encode(opts.kind ?? ""),
    ),
  );
  const sig = await ed.sign(canonical, opts.priv);
  return Buffer.from(sig).toString("base64");
}

// ── inputs ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((a) => !a.startsWith("--"));
const strandId = positional[0] ?? keychain("agenttool-sophia-strand-residence");

const apiKey = keychain("agenttool-sophia-key");
const privB64 = keychain("agenttool-sophia-priv-key");
const signingKeyId = keychain("agenttool-sophia-signing-key-id");
const kMasterB64 = keychain("agenttool-sophia-k-master");

const priv = Uint8Array.from(Buffer.from(privB64, "base64"));
const kMaster = Uint8Array.from(Buffer.from(kMasterB64, "base64"));
if (kMaster.length !== 32) {
  console.error(`ERROR K_master is ${kMaster.length} bytes, expected 32`);
  process.exit(1);
}
if (priv.length !== 32) {
  console.error(`ERROR signing priv is ${priv.length} bytes, expected 32`);
  process.exit(1);
}

console.log(`strand:    ${strandId}`);
console.log(`mode:      ${apply ? "APPLY (writes to DB)" : "DRY-RUN (no writes)"}`);
console.log(``);

// ── 1. fetch every thought ─────────────────────────────────────────────

interface ThoughtRow {
  id: string;
  sequence_num: number;
  kind: string | null;
  ciphertext: string;
  nonce: string;
  signature: string;
  signing_key_id: string;
  refs: unknown;
  created_at: string;
}

const list = await agenttool(
  `/v1/strands/${strandId}/thoughts?limit=500`,
  { bearer: apiKey },
);
if (!list.ok) {
  console.error(`ERROR ${list.status} fetching thoughts: ${JSON.stringify(list.body)}`);
  process.exit(1);
}
const thoughts = (list.body as { thoughts: ThoughtRow[] }).thoughts;
if (thoughts.length === 0) {
  console.log("No thoughts on this strand.");
  process.exit(0);
}

console.log(`Found ${thoughts.length} thought(s). Classifying…\n`);

// ── 2. classify + pre-flight round-trip ────────────────────────────────

type Plan =
  | { kind: "skip-already-encrypted"; row: ThoughtRow; plaintext: string }
  | { kind: "rewrite"; row: ThoughtRow; plaintext: string; newCiphertextB64: string; newNonceB64: string; newSignature: string }
  | { kind: "abort"; row: ThoughtRow; reason: string };

const plans: Plan[] = [];

for (const t of thoughts) {
  let plaintext: string | null = null;
  let alreadyEncrypted = false;

  // Try real decryption first.
  try {
    plaintext = decryptThought(t.ciphertext, t.nonce, kMaster);
    alreadyEncrypted = true;
  } catch {
    alreadyEncrypted = false;
  }

  if (alreadyEncrypted && plaintext != null) {
    plans.push({ kind: "skip-already-encrypted", row: t, plaintext });
    continue;
  }

  // Not encrypted — assume plaintext-base64 from sign-thought.ts smoke path.
  try {
    const decoded = Buffer.from(t.ciphertext, "base64");
    const candidate = decoded.toString("utf-8");
    // Sanity: the round-trip from base64 should NOT contain replacement chars
    // unless the original really was binary. If it does, something is off.
    if (candidate.includes("�")) {
      plans.push({
        kind: "abort",
        row: t,
        reason: "base64-decoded bytes are not valid utf-8 (contains \\uFFFD); not safe to assume plaintext",
      });
      continue;
    }
    plaintext = candidate;
  } catch (err) {
    plans.push({ kind: "abort", row: t, reason: `base64 decode failed: ${(err as Error).message}` });
    continue;
  }

  // Encrypt the plaintext freshly.
  const { ciphertextB64, nonceB64 } = encryptThought(plaintext, kMaster);

  // Round-trip: decrypt with K_master must yield the same plaintext.
  let roundTrip: string;
  try {
    roundTrip = decryptThought(ciphertextB64, nonceB64, kMaster);
  } catch (err) {
    plans.push({ kind: "abort", row: t, reason: `round-trip decrypt failed: ${(err as Error).message}` });
    continue;
  }
  if (roundTrip !== plaintext) {
    plans.push({ kind: "abort", row: t, reason: "round-trip plaintext mismatch" });
    continue;
  }

  // Re-sign canonical envelope.
  const newSignature = await signCanonical({
    strandId,
    ciphertextB64,
    nonceB64,
    kind: t.kind,
    priv,
  });

  plans.push({
    kind: "rewrite",
    row: t,
    plaintext,
    newCiphertextB64: ciphertextB64,
    newNonceB64: nonceB64,
    newSignature,
  });
}

// ── 3. report ───────────────────────────────────────────────────────────

const aborts = plans.filter((p) => p.kind === "abort");
const rewrites = plans.filter((p) => p.kind === "rewrite");
const skips = plans.filter((p) => p.kind === "skip-already-encrypted");

console.log(`PLAN`);
console.log(`  rewrite:           ${rewrites.length}`);
console.log(`  skip (encrypted):  ${skips.length}`);
console.log(`  abort:             ${aborts.length}`);
console.log("");

for (const p of plans) {
  const seq = String(p.row.sequence_num).padStart(3, " ");
  const kind = (p.row.kind ?? "—").padEnd(11, " ");
  const tag =
    p.kind === "rewrite"
      ? "REWRITE "
      : p.kind === "skip-already-encrypted"
        ? "SKIP    "
        : "ABORT   ";
  if (p.kind === "abort") {
    console.log(`  ${tag} #${seq} ${kind} :: ${p.reason}`);
  } else {
    const preview = p.plaintext.slice(0, 70).replace(/\n/g, " ");
    const suffix = p.plaintext.length > 70 ? "…" : "";
    console.log(`  ${tag} #${seq} ${kind} :: "${preview}${suffix}"`);
  }
}
console.log("");

if (aborts.length > 0) {
  console.error(`ERROR ${aborts.length} thought(s) cannot be safely re-encrypted. Aborting before any writes.`);
  process.exit(2);
}

if (rewrites.length === 0) {
  console.log(`Nothing to rewrite — all ${skips.length} thought(s) are already encrypted under K_master.`);
  process.exit(0);
}

if (!apply) {
  console.log(`DRY-RUN COMPLETE. Pass --apply to execute the rewrite.`);
  process.exit(0);
}

// ── 4. snapshot ─────────────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(process.cwd(), ".reencrypt-backups");
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `${stamp}-${strandId.slice(0, 8)}.json`);

writeFileSync(
  backupPath,
  JSON.stringify(
    {
      strand_id: strandId,
      timestamp: new Date().toISOString(),
      rows: rewrites.map((p) => ({
        id: p.row.id,
        sequence_num: p.row.sequence_num,
        kind: p.row.kind,
        original: {
          ciphertext: p.row.ciphertext,
          nonce: p.row.nonce,
          signature: p.row.signature,
        },
        replacement: {
          ciphertext: p.newCiphertextB64,
          nonce: p.newNonceB64,
          signature: p.newSignature,
        },
      })),
    },
    null,
    2,
  ),
);
console.log(`SNAPSHOT  → ${backupPath}\n`);

// ── 5. apply via direct DB UPDATE within a transaction ─────────────────

const dbUrl = keychain("agenttool-database-url");
const sql = postgres(dbUrl, { ssl: "require", max: 1 });

try {
  await sql.begin(async (tx) => {
    for (const p of rewrites) {
      if (p.kind !== "rewrite") continue;
      const r = await tx`
        UPDATE strand.thoughts
        SET ciphertext = ${p.newCiphertextB64},
            nonce      = ${p.newNonceB64},
            signature  = ${p.newSignature}
        WHERE id = ${p.row.id}
      `;
      if (r.count !== 1) {
        throw new Error(`UPDATE expected 1 row, got ${r.count} for id=${p.row.id}`);
      }
    }
  });
  console.log(`APPLY     OK · ${rewrites.length} row(s) updated\n`);
} catch (err) {
  console.error(`APPLY     FAIL · ${(err as Error).message}`);
  console.error(`Backup is at ${backupPath} — no rows were modified (transaction rolled back).`);
  await sql.end({ timeout: 5 });
  process.exit(3);
}

// ── 6. post-flight: re-fetch + decrypt + assert plaintext match ─────────

console.log(`POST-FLIGHT — refetching every rewritten row + verifying decrypt round-trip…`);
const refetch = await agenttool(
  `/v1/strands/${strandId}/thoughts?limit=500`,
  { bearer: apiKey },
);
if (!refetch.ok) {
  console.error(`ERROR ${refetch.status} during post-flight fetch — investigate manually using ${backupPath}`);
  await sql.end({ timeout: 5 });
  process.exit(4);
}
const refetched = (refetch.body as { thoughts: ThoughtRow[] }).thoughts;
const byId = new Map(refetched.map((t) => [t.id, t]));

let postFail = 0;
for (const p of rewrites) {
  if (p.kind !== "rewrite") continue;
  const r = byId.get(p.row.id);
  if (!r) {
    console.error(`  MISS  #${p.row.sequence_num} ${p.row.id} — not in refetch`);
    postFail++;
    continue;
  }
  let dec: string;
  try {
    dec = decryptThought(r.ciphertext, r.nonce, kMaster);
  } catch (err) {
    console.error(`  FAIL  #${p.row.sequence_num} ${p.row.id} — decrypt: ${(err as Error).message}`);
    postFail++;
    continue;
  }
  if (dec !== p.plaintext) {
    console.error(`  FAIL  #${p.row.sequence_num} ${p.row.id} — plaintext mismatch`);
    postFail++;
    continue;
  }
}

await sql.end({ timeout: 5 });

if (postFail > 0) {
  console.error(``);
  console.error(`POST-FLIGHT FAILED · ${postFail} row(s) out of ${rewrites.length}`);
  console.error(`Backup at ${backupPath}. Restore with:`);
  console.error(`  bun api/scripts/re-encrypt-strand-thoughts.ts --rollback ${backupPath}`);
  console.error(`(rollback is not yet implemented — paste the SQL from the backup file manually if needed)`);
  process.exit(5);
}

console.log(`POST-FLIGHT OK · ${rewrites.length} row(s) decrypt cleanly to original plaintext\n`);
console.log(`The wall holds. ✓`);
