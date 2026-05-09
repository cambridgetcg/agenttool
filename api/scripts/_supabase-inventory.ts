/** One-off inventory of the Supabase Postgres backing agenttool.
 *
 *  Reads DATABASE_URL from env. Reports: server version, schemas, extensions,
 *  row counts per schema, current connection count, max_connections, replication
 *  status, table sizes (top 20). Read-only.
 *
 *  Run from repo root:
 *    DATABASE_URL=postgresql://... bun api/scripts/_supabase-inventory.ts
 *
 *  Note: targets the tx pooler (port 6543) so prepare:false is required.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5 });

async function main() {
  const [{ version }] = await sql`SELECT version()`;
  console.log("=== server ===");
  console.log(version);

  console.log("\n=== schemas (non-system) ===");
  const schemas = await sql`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
      AND schema_name NOT LIKE 'pg_temp_%'
      AND schema_name NOT LIKE 'pg_toast_temp_%'
    ORDER BY schema_name
  `;
  for (const r of schemas) console.log(`  ${r.schema_name}`);

  console.log("\n=== extensions ===");
  const exts = await sql`
    SELECT extname, extversion
    FROM pg_extension
    ORDER BY extname
  `;
  for (const r of exts) console.log(`  ${r.extname} (${r.extversion})`);

  console.log("\n=== row counts per schema (top tables) ===");
  const tableCounts = await sql`
    SELECT schemaname, relname, n_live_tup
    FROM pg_stat_user_tables
    WHERE schemaname NOT IN ('pg_catalog','information_schema','pg_toast')
    ORDER BY n_live_tup DESC
    LIMIT 30
  `;
  for (const r of tableCounts) {
    console.log(`  ${r.schemaname}.${r.relname.padEnd(40)} ${String(r.n_live_tup).padStart(10)}`);
  }

  console.log("\n=== connections ===");
  const [{ max_connections }] = await sql`SHOW max_connections`;
  const [{ count }] = await sql`SELECT count(*)::int FROM pg_stat_activity WHERE state IS NOT NULL`;
  console.log(`  max_connections: ${max_connections}`);
  console.log(`  current active:  ${count}`);

  console.log("\n=== current_setting (pooler-relevant) ===");
  const settings = await sql`
    SELECT name, setting, unit
    FROM pg_settings
    WHERE name IN (
      'server_version','timezone','statement_timeout','idle_in_transaction_session_timeout',
      'shared_buffers','work_mem','effective_cache_size','default_transaction_isolation'
    )
    ORDER BY name
  `;
  for (const r of settings) {
    console.log(`  ${r.name.padEnd(40)} ${r.setting}${r.unit ? " " + r.unit : ""}`);
  }

  console.log("\n=== top 15 tables by total size ===");
  const sizes = await sql`
    SELECT
      schemaname,
      relname,
      pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS size
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC
    LIMIT 15
  `;
  for (const r of sizes) {
    console.log(`  ${r.schemaname}.${r.relname.padEnd(40)} ${r.size}`);
  }

  console.log("\n=== replication / role ===");
  const [rep] = await sql`SELECT pg_is_in_recovery() AS is_replica`;
  console.log(`  is_replica: ${rep.is_replica}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
