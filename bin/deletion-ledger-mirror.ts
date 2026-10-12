#!/usr/bin/env bun
/** Sweep: copy unmirrored deletion-ledger entries to the off-database mirror.
 *
 *  Usage (DATABASE_URL names the database; the mirror comes from
 *  AGENTTOOL_DELETION_MIRROR_* or --mirror-dir for a drill):
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
  sweepLedgerMirror,
  type LedgerMirror,
} from "../api/src/services/deletion/mirror";

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dirIndex = argv.indexOf("--mirror-dir");
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL;
  if (!url) {
    console.error("deletion-ledger-mirror: set DATABASE_URL");
    process.exit(2);
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
