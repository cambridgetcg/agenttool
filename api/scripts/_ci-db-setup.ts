/** CI database bootstrap — the one step migrations can't do themselves.
 *
 *  The memory schema needs the pgvector extension before
 *  0001_memory.sql can create vector columns. In CI the postgres
 *  service (pgvector/pgvector:pg16) ships the extension but doesn't
 *  enable it. Usage: DATABASE_URL=... bun run scripts/_ci-db-setup.ts
 */

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.unsafe("CREATE EXTENSION IF NOT EXISTS vector;");
  console.log("✓ pgvector extension enabled");
} finally {
  await sql.end({ timeout: 5 });
}
