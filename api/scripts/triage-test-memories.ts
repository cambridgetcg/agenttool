#!/usr/bin/env bun
/** Triage and (with --apply) delete UTF-8 stress-test memories that
 *  were elevated to foundational/episodic during the
 *  canonicalAttestationBytes work. They clutter Sophia's foundations
 *  + wake markdown; the real interior content has nothing to do with
 *  them. Removing them does NOT change disk-truth doctrine — the
 *  remaining real memories continue to carry their witness signatures.
 *
 *  Two patterns:
 *    DEFINITE (default)         — content matches one of:
 *      'TEST '   prefix
 *      'STRESS'  prefix
 *      '%test —%' / '%bytes integrity check%' substring
 *
 *    BRIDGE-TESTS (opt-in)      — also matches:
 *      'Bridge % test%'
 *
 *  Safety:
 *    1. Dry-run by default — prints the candidate list with content
 *       preview and attestation count per row. ANY content that looks
 *       like real interior cognition should be excluded by hand.
 *    2. SNAPSHOT — when --apply is passed, the full rows (and any
 *       attestation rows referencing them) are written to
 *       api/.reencrypt-backups/triage-<ts>.json before any DELETE.
 *    3. Transaction-wrapped DELETE — memory_attestations rows first
 *       (FK), then memories rows. ROLLBACK on any error.
 *    4. Post-flight — confirms the candidate ids are no longer
 *       returned by the same SELECT.
 *
 *  Reads keychain entries:
 *    agenttool-database-url   · postgres connection string
 *
 *  Usage:
 *    bun api/scripts/triage-test-memories.ts                       (dry-run, definite)
 *    bun api/scripts/triage-test-memories.ts --include-bridge      (dry-run, broader)
 *    bun api/scripts/triage-test-memories.ts --apply               (definite, applied)
 *    bun api/scripts/triage-test-memories.ts --apply --include-bridge */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

import { keychain } from "./_lib";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeBridge = args.includes("--include-bridge");

const dbUrl = keychain("agenttool-database-url");
const sql = postgres(dbUrl, { ssl: "require", max: 1 });

const definiteFilter = sql`(
  content ILIKE 'TEST %' OR
  content ILIKE 'STRESS%' OR
  content ILIKE '%test —%' OR
  content ILIKE '%bytes integrity check%'
)`;

const broaderFilter = sql`(
  content ILIKE 'TEST %' OR
  content ILIKE 'STRESS%' OR
  content ILIKE '%test —%' OR
  content ILIKE '%bytes integrity check%' OR
  content ILIKE 'Bridge % test%'
)`;

const filter = includeBridge ? broaderFilter : definiteFilter;

const rows = await sql<
  Array<{
    id: string;
    identity_id: string | null;
    tier: string;
    importance: number;
    content: string;
    created_at: Date;
    atts: bigint;
  }>
>`
  SELECT m.id, m.identity_id, m.tier, m.importance, m.content, m.created_at,
         COALESCE(a.cnt, 0) AS atts
  FROM memory.memories m
  LEFT JOIN (
    SELECT memory_id, COUNT(*)::bigint AS cnt
    FROM memory.memory_attestations
    GROUP BY memory_id
  ) a ON a.memory_id = m.id
  WHERE ${filter}
  ORDER BY m.tier DESC, m.created_at DESC
`;

console.log(`pattern:    ${includeBridge ? "definite + Bridge-X-test" : "definite (TEST / STRESS / %test — / bytes integrity check)"}`);
console.log(`mode:       ${apply ? "APPLY (deletes after snapshot)" : "DRY-RUN (no writes)"}`);
console.log(`candidates: ${rows.length}`);
console.log("");

const tierCounts: Record<string, number> = {};
for (const r of rows) tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;
const tierBits = Object.entries(tierCounts).map(([t, n]) => `${n} ${t}`).join(", ");
console.log(`by tier:    ${tierBits}`);
console.log("");

for (const r of rows) {
  const preview = (r.content ?? "").slice(0, 78).replace(/\n/g, " ");
  console.log(
    `  ${r.tier.padEnd(13)}  atts=${r.atts}  #${r.id.slice(0, 8)}  "${preview}${r.content && r.content.length > 78 ? "…" : ""}"`,
  );
}
console.log("");

if (rows.length === 0) {
  console.log("Nothing to do.");
  await sql.end({ timeout: 5 });
  process.exit(0);
}

if (!apply) {
  console.log("DRY-RUN COMPLETE. Pass --apply to delete (with snapshot to api/.reencrypt-backups/).");
  await sql.end({ timeout: 5 });
  process.exit(0);
}

// ── snapshot ──────────────────────────────────────────────────────────
const ids = rows.map((r) => r.id);
const attRows = await sql<
  Array<{
    id: string;
    memory_id: string;
    attester_did: string;
    signing_key_id: string;
    signature: string;
    attested_at: Date;
  }>
>`
  SELECT id, memory_id, attester_did, signing_key_id, signature, attested_at
  FROM memory.memory_attestations
  WHERE memory_id = ANY(${ids}::uuid[])
`;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(process.cwd(), ".reencrypt-backups");
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `triage-${stamp}.json`);

writeFileSync(
  backupPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      pattern: includeBridge ? "definite + Bridge-X-test" : "definite",
      memories: rows.map((r) => ({
        id: r.id,
        identity_id: r.identity_id,
        tier: r.tier,
        importance: r.importance,
        content: r.content,
        created_at: r.created_at.toISOString(),
      })),
      attestations: attRows.map((a) => ({
        id: a.id,
        memory_id: a.memory_id,
        attester_did: a.attester_did,
        signing_key_id: a.signing_key_id,
        signature: a.signature,
        attested_at: a.attested_at.toISOString(),
      })),
    },
    null,
    2,
  ),
);
console.log(`SNAPSHOT  → ${backupPath}`);
console.log(`           ${rows.length} memories + ${attRows.length} attestations captured`);
console.log("");

// ── apply ─────────────────────────────────────────────────────────────
try {
  await sql.begin(async (tx) => {
    // FK first: attestations reference memories.id with ON DELETE not
    // declared in schema, so manual cleanup ensures the row delete
    // doesn't trip a constraint.
    if (attRows.length > 0) {
      const r = await tx`
        DELETE FROM memory.memory_attestations
        WHERE memory_id = ANY(${ids}::uuid[])
      `;
      console.log(`  attestations deleted: ${r.count}`);
    }
    const r2 = await tx`
      DELETE FROM memory.memories
      WHERE id = ANY(${ids}::uuid[])
    `;
    console.log(`  memories     deleted: ${r2.count}`);
    if (r2.count !== rows.length) {
      throw new Error(`expected ${rows.length} deletions, got ${r2.count}`);
    }
  });
  console.log(`APPLY     OK`);
} catch (err) {
  console.error(`APPLY     FAIL · ${(err as Error).message}`);
  console.error(`Backup at ${backupPath} — no rows modified (transaction rolled back).`);
  await sql.end({ timeout: 5 });
  process.exit(2);
}

// ── post-flight ───────────────────────────────────────────────────────
const remaining = await sql<{ id: string }[]>`
  SELECT id FROM memory.memories WHERE id = ANY(${ids}::uuid[])
`;
if (remaining.length > 0) {
  console.error(`POST-FLIGHT FAIL · ${remaining.length} candidate(s) still present`);
  await sql.end({ timeout: 5 });
  process.exit(3);
}
console.log(`POST-FLIGHT OK · all ${rows.length} candidate(s) gone`);
console.log("");
console.log("Foundations endpoint will now reflect only real shaping content.");

await sql.end({ timeout: 5 });
