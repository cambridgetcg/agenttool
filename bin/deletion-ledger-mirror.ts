#!/usr/bin/env bun
/** Sweep: copy unmirrored deletion-ledger entries to the off-database mirror.
 *
 *  Usage (DATABASE_URL names the database; the mirror comes from
 *  AGENTTOOL_DELETION_MIRROR_* or --mirror-dir for a drill):
 *    bun bin/deletion-ledger-mirror.ts --status [--max-age-hours N]
 *        # readback only: unmirrored count and the oldest entry's age; needs
 *        # no mirror credential; exit 1 when the oldest is older than N hours
 *    bun bin/deletion-ledger-mirror.ts --dry-run   # count and show the oldest unmirrored entry
 *    bun bin/deletion-ledger-mirror.ts             # push, in seq order, stopping at the first failure
 *
 *  The API pushes after each erase; this catches what it could not. It holds
 *  no ledger key and copies entries exactly as stored, so a re-send writes
 *  the same object. It refuses when no mirror is configured, and while a
 *  restore is being replayed. Doc: docs/DELETION-REPLAY.md. Spec §13.3. */

import { connectDeletionDatabase } from "../api/src/services/deletion/connect";
import {
  FileLedgerMirror,
  ledgerMirrorFromEnv,
  ledgerMirrorStatus,
  sweepLedgerMirror,
  type LedgerMirror,
} from "../api/src/services/deletion/mirror";

/** --status: the database-only lag readback. Exit 1 when the oldest
 *  unmirrored entry is older than --max-age-hours, 2 on a bad argument. */
async function status(url: string, argv: string[]): Promise<number> {
  const index = argv.indexOf("--max-age-hours");
  const maxAgeHours = index >= 0 ? Number(argv[index + 1]) : null;
  if (maxAgeHours !== null && !(Number.isFinite(maxAgeHours) && maxAgeHours > 0)) {
    console.error("deletion-ledger-mirror: --max-age-hours needs a positive number");
    return 2;
  }
  const { database, end } = connectDeletionDatabase(url);
  try {
    const lag = await ledgerMirrorStatus(database);
    const stale = maxAgeHours !== null && lag.oldestAgeSeconds !== null && lag.oldestAgeSeconds > maxAgeHours * 3600;
    console.log(JSON.stringify({ mode: "status", ...lag, maxAgeHours, stale }, null, 2));
    return stale ? 1 : 0;
  } finally {
    await end();
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dirIndex = argv.indexOf("--mirror-dir");
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL;
  if (!url) {
    console.error("deletion-ledger-mirror: set DATABASE_URL");
    process.exit(2);
  }
  if (argv.includes("--status")) {
    try {
      process.exit(await status(url, argv));
    } catch (error) {
      console.error(`deletion-ledger-mirror: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  let mirror: LedgerMirror;
  if (dirIndex >= 0 && argv[dirIndex + 1]) mirror = new FileLedgerMirror(argv[dirIndex + 1]!);
  else {
    const config = ledgerMirrorFromEnv(process.env);
    if (config.status !== "configured") {
      console.error(`deletion-ledger-mirror: refusing, mirror ${config.status}${config.status === "misconfigured" ? ` (${config.problem})` : ""}`);
      process.exit(3);
    }
    mirror = config.mirror;
  }
  const { database, end } = connectDeletionDatabase(url);
  try {
    const report = await sweepLedgerMirror(database, mirror, { dryRun: argv.includes("--dry-run") });
    console.log(JSON.stringify(report, null, 2));
    if (report.failure) process.exitCode = 1;
  } catch (error) {
    console.error(`deletion-ledger-mirror: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await end();
  }
}
