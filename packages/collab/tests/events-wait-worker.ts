import { Database } from "bun:sqlite";
import { CollabStore } from "../src/store.js";

const [mode, path, root] = process.argv.slice(2);
if (!path) throw new Error("fixture database required");
if (mode === "lock") {
  const db = new Database(path, { strict: true });
  db.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  process.stdout.write("locked\n");
  await Bun.stdin.text();
  db.exec("ROLLBACK");
  db.close();
} else if (mode === "append" && root) {
  const store = new CollabStore(path);
  try {
    const session = store.startSession({ root_path: root, actor: "independent-writer" });
    const report = store.appendReportForSession({
      ...session.credential,
      idempotency_key: "multiprocess-observation",
      kind: "observation",
      body: "Feedback from an independently attributed local process",
    });
    process.stdout.write(JSON.stringify({ session_id: session.session.id, report_id: report.id }));
  } finally {
    store.close();
  }
} else if (mode === "end" || mode === "resume" || mode === "recovery") {
  const credential = JSON.parse(await Bun.stdin.text());
  if (mode === "recovery") {
    const db = new Database(path, { strict: true });
    db.query("UPDATE coordination_sessions SET cursor_recovery_required = 1 WHERE id = ?").run(credential.session_id);
    db.close();
  } else {
    const store = new CollabStore(path);
    try {
      if (mode === "end") store.endSession(credential);
      else store.resumeSession(credential);
    } finally {
      store.close();
    }
  }
} else {
  throw new Error("unknown fixture mode");
}
