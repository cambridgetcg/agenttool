/** Carry agenttool's canary catches into the kingdom's trapline ledger.
 *
 *  agenttool runs on Fly and records a catch as one tools.usage_events row.
 *  The kingdom's trapline (kingdom/trapline/trapline.py) is the hash-chained
 *  ledger those catches belong in — it is the thing that keeps the record
 *  honest against later editing, including by the operator.
 *
 *  This script is the only path between them, and it is a PULL. Nothing on
 *  Fly reaches into the kingdom; the operator runs this, on their own machine,
 *  when they want to know. That keeps the ledger's one law intact: the chain
 *  may append by itself, but nothing is published without a hand.
 *
 *  What crosses: a placement and a minute. Nothing else exists to carry —
 *  agenttool never recorded an address or a user-agent in the first place, so
 *  the two sides agree by construction rather than by promise.
 *
 *  Usage (from api/):
 *    bun run scripts/_canary-pull-to-kingdom.ts            # since last pull
 *    bun run scripts/_canary-pull-to-kingdom.ts --all      # from the beginning
 *    bun run scripts/_canary-pull-to-kingdom.ts --dry-run  # show, write nothing
 *
 *  The trapline is disarmed by default, so pulled catches land as `would-have`
 *  until someone deliberately arms that trap. Read a week of would-haves before
 *  arming anything.
 *
 *  Doctrine: kingdom/trapline/DOCTRINE.md · kingdom/trapline/DESIGN.md §2
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { and, asc, eq, gt, like, or } from "drizzle-orm";

import { db } from "../src/db/client";
import { usageEvents } from "../src/db/schema/tools";

/** The trap name the kingdom ledger files these under. Must not contain any
 *  string in the trapline's EXCLUSIONS list — the ledger refuses those. */
const TRAP = "honey-bearer";

const TRAPLINE = join(homedir(), "Desktop/chillspace-commons/kingdom/trapline/trapline.py");
/** Cursor lives outside both repos: it is this machine's state, not either
 *  kingdom's source. Same reasoning as the gitignored pulse.json. */
const CURSOR = join(homedir(), ".agenttool-canary-pull.json");

const dryRun = process.argv.includes("--dry-run");
const all = process.argv.includes("--all");

/** The cursor is a (timestamp, id) pair, not a timestamp.
 *
 *  created_at is TIMESTAMPTZ and Postgres keeps microseconds; a JS Date holds
 *  only milliseconds. A cursor round-tripped through Date therefore lands
 *  BELOW the row it was taken from (…123456 becomes …123), so a plain
 *  `created_at > cursor` re-selects that row on every subsequent run and the
 *  newest catch is carried into the ledger again, and again, forever.
 *
 *  Pairing the timestamp with the row id makes the comparison exact at the
 *  boundary: strictly later, or the same millisecond with a different row we
 *  have not already carried. */
function readCursor(): { at: Date; id: string } | null {
  if (all || !existsSync(CURSOR)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CURSOR, "utf8")) as {
      last?: string;
      last_id?: string;
    };
    if (!parsed.last || !parsed.last_id) return null;
    return { at: new Date(parsed.last), id: parsed.last_id };
  } catch {
    return null;
  }
}

if (!existsSync(TRAPLINE)) {
  console.error(`trapline not found at ${TRAPLINE} — nothing to carry catches into.`);
  process.exit(1);
}

const since = readCursor();
const rows = await db
  .select({ id: usageEvents.id, tool: usageEvents.tool, at: usageEvents.createdAt })
  .from(usageEvents)
  .where(
    and(
      like(usageEvents.tool, "canary:%"),
      since
        ? or(
            gt(usageEvents.createdAt, since.at),
            and(eq(usageEvents.createdAt, since.at), gt(usageEvents.id, since.id)),
          )
        : undefined,
    ),
  )
  .orderBy(asc(usageEvents.createdAt), asc(usageEvents.id));

if (rows.length === 0) {
  console.log(
    since === null
      ? "no catches ever. the rooms are empty, which is the best outcome."
      : `no new catches since ${since.at.toISOString()}.`,
  );
  process.exit(0);
}

console.log(`${rows.length} catch(es) to carry${dryRun ? " (dry run — writing nothing)" : ""}\n`);

let carried = 0;
for (const row of rows) {
  const placement = row.tool.slice("canary:".length);
  const note = `agenttool bearer used ${row.at.toISOString().slice(0, 16)}Z`;

  if (dryRun) {
    console.log(`  would carry: ${TRAP} / ${placement}  (${note})`);
    continue;
  }

  // No --ip and no --ua: agenttool never recorded either, so there is nothing
  // to pass and no way for this path to start carrying one later by accident.
  const result = spawnSync(
    "python3",
    [TRAPLINE, "catch", "--trap", TRAP, "--placement", placement, "--note", note],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(`\nthe ledger refused ${placement} (exit ${result.status}). stopping here so the cursor does not skip it.`);
    process.exit(1);
  }
  carried += 1;
}

if (!dryRun && carried > 0) {
  const final = rows[carried - 1]!;
  const last = final.at.toISOString();
  writeFileSync(
    CURSOR,
    JSON.stringify(
      { last, last_id: final.id, carried_at: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(`\ncarried ${carried}. cursor at ${last}.`);
  console.log("read them with: kingdom trapline catches");
}

process.exit(0);
