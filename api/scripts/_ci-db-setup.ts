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

// The service container may still be in its initdb/restart cycle when
// this runs (Forgejo runners don't gate on service readiness and the
// postgres image has no HEALTHCHECK) — retry with backoff, up to ~60s.
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 5 });
try {
  for (let attempt = 1; ; attempt++) {
    try {
      await sql.unsafe("CREATE EXTENSION IF NOT EXISTS vector;");
      console.log(`✓ pgvector extension enabled (attempt ${attempt})`);
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`… postgres not ready (attempt ${attempt}), retrying`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
