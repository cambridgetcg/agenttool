import { CollabError } from "../src/errors.js";
import { CollabStore } from "../src/store.js";

const [databasePath, workspaceId, clientInstanceId, startAtText] = Bun.argv.slice(2);
if (!databasePath || !workspaceId || !clientInstanceId || !startAtText) {
  throw new Error(
    "session-worker requires database, workspace, client instance, and start time",
  );
}

const delay = Math.max(0, Number(startAtText) - Date.now());
if (delay > 0) await Bun.sleep(delay);

const store = new CollabStore(databasePath);
try {
  const session = store.joinSession({
    workspace_id: workspaceId,
    client_instance_id: clientInstanceId,
    actor_label: "same-label",
    runtime_kind: "custom",
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    session_id: session.id,
    actor_key: session.actor_key,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof CollabError ? error.code : "internal_error",
  }));
} finally {
  store.close();
}
