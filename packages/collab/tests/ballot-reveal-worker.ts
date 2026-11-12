import { CollabStore } from "../src/store.js";

// Opens its own store on a shared journal and runs the lazy ballot reveal at
// a shared start time, so two processes race for the same due ballot.
const [databasePath, workspaceId, clockText, startAtText] = Bun.argv.slice(2);
if (!databasePath || !workspaceId || !clockText || !startAtText) {
  throw new Error("ballot-reveal-worker requires a database, a workspace, a clock and a start time");
}
const store = new CollabStore(databasePath, { now: () => new Date(clockText) });
const delay = Math.max(0, Number(startAtText) - Date.now());
if (delay > 0) await Bun.sleep(delay);
try {
  process.stdout.write(JSON.stringify({ ok: true, ...store.revealDueBallots(workspaceId) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
} finally {
  store.close();
}
