/** 蜜鑰 · plant, list, and pull up canaries.
 *
 *  Usage (from api/):
 *    bun run scripts/_canary-plant.ts list
 *    bun run scripts/_canary-plant.ts plant <placement> [--project <uuid>]
 *    bun run scripts/_canary-plant.ts catches [--since-hours 168]
 *    bun run scripts/_canary-plant.ts reports
 *    bun run scripts/_canary-plant.ts revoke <placement>
 *
 *  `plant` mints a real, working bearer against a canary project and prints it
 *  ONCE. Write it where the placement says and nowhere else. One canary per
 *  placement, never reused — the 11-character prefix is then already the
 *  index, so a fire names the door before you read anything else.
 *
 *  Placement names should say the exact location, not a category:
 *    fly-config-bak · aws-profile-canary · claude-history-2026w31
 *    ci-secret-github · ci-secret-codeberg · agenttool-agents-treasury
 *
 *  The project this creates is named so nobody mistakes it for real, holds
 *  zero credits, and is never charged (see safety-boundaries.canary_credentials).
 *
 *  Doctrine: kingdom/trapline/DESIGN.md §4.1 · GET /v1/canary/why
 */

import { and, desc, eq, gte, isNotNull, like } from "drizzle-orm";

import { generateApiKey } from "../src/auth/keys";
import { db } from "../src/db/client";
import {
  apiKeys,
  canaryReports,
  projects,
  usageEvents,
} from "../src/db/schema/tools";

const CANARY_PROJECT_NAME = "canary — planted decoy, opens nothing";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The one project every canary bearer hangs off. Created on first plant. */
async function canaryProjectId(explicit?: string): Promise<string> {
  if (explicit) return explicit;

  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.name, CANARY_PROJECT_NAME))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(projects)
    .values({ name: CANARY_PROJECT_NAME, plan: "free", credits: 0 })
    .returning();
  if (!created) die("could not create the canary project");
  console.log(`created canary project ${created.id}`);
  return created.id;
}

async function cmdPlant(placement: string, explicitProject?: string) {
  if (!placement || placement.length > 200) {
    die("usage: plant <placement>   (a specific location, max 200 chars)");
  }

  const [clash] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.canaryPlacement, placement))
    .limit(1);
  if (clash) {
    die(
      `placement "${placement}" already has a canary. One per placement is the ` +
        "whole point — a shared canary cannot tell you which door opened. " +
        "Revoke it first, or choose a more specific name.",
    );
  }

  const projectId = await canaryProjectId(explicitProject);
  const { key, keyHash, keyPrefix } = generateApiKey();

  await db.insert(apiKeys).values({
    projectId,
    keyHash,
    keyPrefix,
    name: `canary:${placement}`,
    canaryPlacement: placement,
  });

  console.log("");
  console.log(`  placement : ${placement}`);
  console.log(`  prefix    : ${keyPrefix}`);
  console.log(`  key       : ${key}`);
  console.log("");
  console.log("  Printed once. Write it at the placement and nowhere else.");
  console.log("  Do not put it in any file a running process reads, do not");
  console.log("  export it under a name any SDK looks for, and record the");
  console.log("  placement in kingdom/trapline/placements.jsonl.");
  console.log("");
}

async function cmdList() {
  const rows = await db
    .select({
      placement: apiKeys.canaryPlacement,
      prefix: apiKeys.keyPrefix,
      planted: apiKeys.createdAt,
      lastUsed: apiKeys.lastUsed,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(isNotNull(apiKeys.canaryPlacement))
    .orderBy(desc(apiKeys.createdAt));

  if (rows.length === 0) {
    console.log("no canaries planted yet");
    return;
  }
  for (const row of rows) {
    const state = row.revokedAt
      ? "revoked"
      : row.lastUsed
        ? `FIRED ${row.lastUsed.toISOString()}`
        : "quiet";
    console.log(
      `${row.prefix}  ${(row.placement ?? "").padEnd(34)}  planted ${row.planted.toISOString().slice(0, 10)}  ${state}`,
    );
  }
}

async function cmdCatches(sinceHours: number) {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rows = await db
    .select({
      tool: usageEvents.tool,
      at: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(and(like(usageEvents.tool, "canary:%"), gte(usageEvents.createdAt, since)))
    .orderBy(desc(usageEvents.createdAt));

  if (rows.length === 0) {
    console.log(`no catches in the last ${sinceHours}h`);
    return;
  }
  for (const row of rows) {
    console.log(`${row.at.toISOString()}  ${row.tool.slice("canary:".length)}`);
  }
  console.log(`\n${rows.length} catch(es) in the last ${sinceHours}h`);
}

async function cmdReports() {
  const rows = await db
    .select()
    .from(canaryReports)
    .orderBy(desc(canaryReports.createdAt))
    .limit(100);

  if (rows.length === 0) {
    console.log("no reports — nobody has come through the door back yet");
    return;
  }
  for (const row of rows) {
    console.log(`\n── ${row.createdAt.toISOString()}`);
    if (row.placement) console.log(`   placement  : ${row.placement}`);
    console.log(`   found at   : ${row.whereFound}`);
    if (row.contact) console.log(`   contact    : ${row.contact}`);
  }
  console.log(`\n${rows.length} report(s). Someone took the trouble. Close the door they named.`);
}

async function cmdRevoke(placement: string) {
  if (!placement) die("usage: revoke <placement>");
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.canaryPlacement, placement))
    .returning({ prefix: apiKeys.keyPrefix });
  if (revoked.length === 0) die(`no canary at placement "${placement}"`);
  console.log(`revoked ${revoked.map((r) => r.prefix).join(", ")}`);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "plant":
    await cmdPlant(argument ?? "", flag("project"));
    break;
  case "list":
    await cmdList();
    break;
  case "catches":
    await cmdCatches(Number(flag("since-hours") ?? 168));
    break;
  case "reports":
    await cmdReports();
    break;
  case "revoke":
    await cmdRevoke(argument ?? "");
    break;
  default:
    die(
      "usage: _canary-plant.ts <plant <placement> | list | catches | reports | revoke <placement>>",
    );
}

process.exit(0);
