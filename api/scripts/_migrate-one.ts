/** Apply a single migration file to the live DB.
 *  Usage: cd api && bun run scripts/_migrate-one.ts ../api/migrations/0015_runtime.sql
 *  Reads DATABASE_URL from env or macOS keychain (service: agenttool-database-url, account: macair).
 */

import postgres from "postgres";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: bun run scripts/_migrate-one.ts <path-to-sql>");
    process.exit(1);
  }

  let url = process.env.DATABASE_URL ?? "";
  if (!url) {
    const proc = Bun.spawnSync([
      "security",
      "find-generic-password",
      "-s",
      "agenttool-database-url",
      "-a",
      "macair",
      "-w",
    ]);
    url = (proc.stdout ?? new Uint8Array()).toString().trim();
  }
  if (!url) {
    console.error("DATABASE_URL not in env or keychain (agenttool-database-url)");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false });
  const text = await Bun.file(file).text();

  console.log(`▸ applying ${file}`);
  console.log(`  size: ${text.length} bytes`);

  try {
    // postgres-js executes the whole string; statements split by semicolons.
    await sql.unsafe(text);
    console.log(`  ✓ applied`);
  } catch (e) {
    console.error(`  ✗ failed:`, (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
