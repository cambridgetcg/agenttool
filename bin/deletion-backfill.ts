#!/usr/bin/env bun
/** Purge content deleted before deletion wave 2 (operator, one time).
 *
 *  Usage (DATABASE_SESSION_URL or DATABASE_URL; mirror from
 *  AGENTTOOL_DELETION_MIRROR_* or --mirror-dir for a drill):
 *    bun bin/deletion-backfill.ts --announced-on YYYY-MM-DD            # dry run: counts and earliest run
 *    bun bin/deletion-backfill.ts --announced-on YYYY-MM-DD --apply    # purge, one ledger entry per store
 *
 *  --announced-on is the date the deployed /public/retention first carried
 *  the backfill notice (read it from the wave 2 deploy receipt). --apply
 *  refuses before both the published date (ALREADY_DELETED_PURGE.not_before)
 *  and that date + 30 days, and without a current mirror.
 *  Service: api/src/services/deletion/backfill.ts. Doc: docs/DELETION-REPLAY.md. */

import { BackfillRefusedError, runBackfill } from "../api/src/services/deletion/backfill";
import { connectDeletionDatabase } from "../api/src/services/deletion/connect";
import { FileLedgerMirror, ledgerMirrorFromEnv, type LedgerMirror } from "../api/src/services/deletion/mirror";

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? null : null;
  };
  const apply = argv.includes("--apply");
  const mirrorDir = value("--mirror-dir");
  let mirror: LedgerMirror | null = mirrorDir ? new FileLedgerMirror(mirrorDir) : null;
  if (!mirror) {
    const config = ledgerMirrorFromEnv(process.env);
    mirror = config.status === "configured" ? config.mirror : null;
  }
  const url = process.env.DATABASE_SESSION_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("deletion-backfill: set DATABASE_SESSION_URL or DATABASE_URL");
    process.exit(2);
  }
  const { database, end } = connectDeletionDatabase(url);
  try {
    const report = await runBackfill(database, {
      apply, announcedOn: value("--announced-on"), mirror,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`deletion-backfill: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error instanceof BackfillRefusedError ? 3 : 1;
  } finally {
    await end();
  }
}
