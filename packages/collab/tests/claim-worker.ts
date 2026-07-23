import { CollabError } from "../src/errors.js";
import { CollabStore } from "../src/store.js";

const [databasePath, workspaceId, taskId, actor, idempotencyKey, startAtText] = Bun.argv.slice(2);
if (!databasePath || !workspaceId || !taskId || !actor || !idempotencyKey || !startAtText) {
  throw new Error("claim-worker requires database, workspace, task, actor, key, and start time");
}

const startAt = Number(startAtText);
const delay = Math.max(0, startAt - Date.now());
if (delay > 0) await Bun.sleep(delay);

const store = new CollabStore(databasePath);
try {
  const task = store.claimTask({
    workspace_id: workspaceId,
    task_id: taskId,
    actor,
    idempotency_key: idempotencyKey,
    expected_version: 1,
  });
  process.stdout.write(JSON.stringify({ ok: true, assignee: task.assignee }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof CollabError ? error.code : "internal_error",
  }));
} finally {
  store.close();
}
