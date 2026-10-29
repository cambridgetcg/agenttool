import { CollabStore } from "../src/store.js";

// Opens and closes one store at a shared start time, as a person-desk call does.
const [databasePath, startAtText] = Bun.argv.slice(2);
if (!databasePath || !startAtText) throw new Error("open-worker requires a database and a start time");
const delay = Math.max(0, Number(startAtText) - Date.now());
if (delay > 0) await Bun.sleep(delay);
try {
  new CollabStore(databasePath).close();
  process.stdout.write(JSON.stringify({ ok: true }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
}
