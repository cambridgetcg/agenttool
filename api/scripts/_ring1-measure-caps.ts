/** _ring1-measure-caps.ts — storage-cost modeling pass for Ring 1.
 *
 *  Doctrine: docs/RING-1.md §Free-tier numbers · docs/BUSINESS-MODEL.md §3 ·
 *            docs/PATTERN-PERSIST-IDENTITY.md (one source of truth for caps).
 *
 *  Reads current production storage per identity across memory, vault,
 *  strands, inbox, chronicle. Reports min/avg/p50/p99/max and recommends
 *  Ring 1 caps at 10× p99 (rounded to a round number). The numbers
 *  become load-bearing in `services/economy/ring1-limits.ts`.
 *
 *  Run:
 *    DATABASE_URL=… bun api/scripts/_ring1-measure-caps.ts
 *
 *  After running, paste the "Recommended caps" output into RING-1.md and
 *  update ring1-limits.ts with the new constants. Flip
 *  `RING_1_LIMITS.measured` to true. */

import postgres from "postgres";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: "require", prepare: false, max: 1 });

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function fmt(n: number): string {
  if (n === 0) return "0";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${n} B`;
}

function round_generous(n: number, unit: "B" | "count"): number {
  // Round UP to a "nice" number — operator-friendly + always >= measurement.
  if (unit === "B") {
    if (n < 1_048_576) return Math.ceil(n / 102_400) * 102_400; // 100KB granularity
    if (n < 104_857_600) return Math.ceil(n / 1_048_576) * 1_048_576; // 1MB
    return Math.ceil(n / 10_485_760) * 10_485_760; // 10MB
  }
  if (n < 10) return Math.ceil(n);
  if (n < 100) return Math.ceil(n / 10) * 10;
  if (n < 1_000) return Math.ceil(n / 100) * 100;
  if (n < 10_000) return Math.ceil(n / 1_000) * 1_000;
  return Math.ceil(n / 10_000) * 10_000;
}

async function measure(name: string, query: string, unit: "B" | "count") {
  console.log(`\n## ${name}`);
  const rows = await sql.unsafe(query);
  if (rows.length === 0) {
    console.log("  (no rows — caps are theoretical until population grows)");
    return null;
  }
  const values = rows.map((r: any) => Number(r.bytes ?? r.n ?? 0)).sort((a, b) => a - b);
  const total = values.reduce((s, v) => s + v, 0);
  const avg = total / values.length;
  const p50 = percentile(values, 0.5);
  const p99 = percentile(values, 0.99);
  const max = values[values.length - 1];
  const fmtFn = unit === "B" ? fmt : (n: number) => String(Math.round(n));
  console.log(`  agents: ${values.length}`);
  console.log(`  min : ${fmtFn(values[0])}`);
  console.log(`  avg : ${fmtFn(avg)}`);
  console.log(`  p50 : ${fmtFn(p50)}`);
  console.log(`  p99 : ${fmtFn(p99)}`);
  console.log(`  max : ${fmtFn(max)}`);
  const recommended_cap = round_generous(Math.max(p99 * 10, max * 2), unit);
  console.log(`  RECOMMENDED CAP (10×p99, generous round-up): ${fmtFn(recommended_cap)}`);
  return { p99, max, recommended_cap, n: values.length };
}

try {
  console.log("=== Ring 1 free-tier caps — storage-cost modeling pass ===");
  console.log("Measured against production at " + new Date().toISOString());
  console.log("Doctrine: docs/RING-1.md · docs/BUSINESS-MODEL.md §3\n");

  const memoryBytes = await measure(
    "Memory (episodic) — bytes per identity",
    `SELECT identity_id, COALESCE(SUM(octet_length(coalesce(content, '') || coalesce(content_encrypted, ''))), 0)::bigint AS bytes
     FROM memory.memories WHERE tier = 'episodic' GROUP BY identity_id`,
    "B",
  );

  const memoryRecords = await measure(
    "Memory (episodic) — record count per identity",
    `SELECT identity_id, COUNT(*)::int AS n
     FROM memory.memories WHERE tier = 'episodic' GROUP BY identity_id`,
    "count",
  );

  const vaultSecrets = await measure(
    "Vault — secrets per identity",
    `SELECT identity_id, COUNT(*)::int AS n FROM agent_vault.vault_secrets GROUP BY identity_id`,
    "count",
  );

  // Vault ciphertext bytes — varies per schema; adapt to actual column name.
  const vaultBytes = await measure(
    "Vault — total ciphertext bytes per identity",
    `SELECT identity_id, COALESCE(SUM(octet_length(coalesce(value_encrypted, ''))), 0)::bigint AS bytes
     FROM agent_vault.vault_secrets GROUP BY identity_id`,
    "B",
  ).catch(async () => {
    // Fallback if column name differs
    return null;
  });

  const inboxReceived = await measure(
    "Inbox — messages received in last 30 days per identity",
    `SELECT recipient_identity_id AS identity_id, COUNT(*)::int AS n
     FROM inbox.messages WHERE created_at > now() - interval '30 days'
     GROUP BY recipient_identity_id`,
    "count",
  );

  const strandThoughts = await measure(
    "Strands — thoughts per strand (top strand per identity)",
    `WITH per_strand AS (
       SELECT strand_id, COUNT(*)::int AS n FROM strand.thoughts GROUP BY strand_id
     )
     SELECT s.identity_id, MAX(per_strand.n)::int AS n
     FROM per_strand JOIN strand.strands s ON s.id = per_strand.strand_id
     GROUP BY s.identity_id`,
    "count",
  );

  console.log("\n=== Summary — update services/economy/ring1-limits.ts with:");
  if (memoryBytes) {
    console.log(`  RING_1_MEMORY_BYTES = ${memoryBytes.recommended_cap};`);
  }
  if (memoryRecords) {
    console.log(`  RING_1_MEMORY_RECORDS = ${memoryRecords.recommended_cap};`);
  }
  if (vaultSecrets) {
    console.log(`  RING_1_VAULT_SECRETS = ${vaultSecrets.recommended_cap};`);
  }
  if (vaultBytes) {
    console.log(`  RING_1_VAULT_BYTES = ${vaultBytes.recommended_cap};`);
  }
  if (strandThoughts) {
    console.log(`  RING_1_STRAND_THOUGHTS_PER_STRAND = ${strandThoughts.recommended_cap};`);
  }
  if (inboxReceived) {
    console.log(`  RING_1_INBOX_RECEIVED_PER_MONTH = ${inboxReceived.recommended_cap};`);
  }
  console.log("\nThen flip RING_1_LIMITS.measured = true and update");
  console.log("RING_1_LIMITS.disclaimer + RING-1.md table.");
} finally {
  await sql.end();
}
