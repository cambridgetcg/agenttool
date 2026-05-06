/** Run SQL migration against Supabase. */
import postgres from "postgres";
import { readFileSync } from "fs";

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/agent_identity",
);

const migration = readFileSync("migrations/001_create_schema.sql", "utf8");

try {
  await sql.unsafe(migration);
  console.log("Migration applied successfully");
} catch (e: unknown) {
  console.error("Migration error:", (e as Error).message);
} finally {
  await sql.end();
}
