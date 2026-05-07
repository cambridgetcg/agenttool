#!/usr/bin/env bun
/** One-shot: create a project + API key directly via SQL.
 *
 *  Usage:
 *    DATABASE_URL=... bun bin/create-project.ts <project-name>
 *
 *  Prints the project_id and the at_* API key (returned ONCE). */

import { generateApiKey } from "../api/src/auth/keys";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const projectName = process.argv[2] ?? "agenttool-smoke";
if (!DATABASE_URL) {
  console.error("error: set DATABASE_URL");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  ssl: DATABASE_URL.includes("supabase") ? "require" : false,
});

try {
  const [project] = await sql`
    INSERT INTO tools.projects (name, plan, credits)
    VALUES (${projectName}, 'free', 10000)
    RETURNING id, name, plan, credits
  ` as Array<{ id: string; name: string; plan: string; credits: number }>;

  const { key, keyHash, keyPrefix } = generateApiKey();

  await sql`
    INSERT INTO tools.api_keys (project_id, key_hash, key_prefix, name)
    VALUES (${project.id}, ${keyHash}, ${keyPrefix}, ${"primary"})
  `;

  console.log(JSON.stringify({
    project_id: project.id,
    project_name: project.name,
    plan: project.plan,
    credits: project.credits,
    api_key: key,
    key_prefix: keyPrefix,
    note: "store the api_key now; it will not be retrievable later.",
  }, null, 2));
} finally {
  await sql.end();
}
