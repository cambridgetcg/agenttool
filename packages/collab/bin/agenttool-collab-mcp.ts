#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { resolveDatabasePath } from "../src/database-path.js";
import { hostBindingRecorder } from "../src/host-binding.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import {
  readSessionCredentialFile,
  writeSessionCredentialFile,
} from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

async function main(): Promise<void> {
  const databasePath = resolveDatabasePath(process.env);
  const store = new CollabStore(databasePath);
  // An in-memory journal has no collab-sessions directory to bind into.
  const hostBinding = databasePath === ":memory:" ? undefined : hostBindingRecorder(databasePath);
  const sessionFile = process.env.AGENTOOL_COLLAB_SESSION_FILE;
  const resumed = sessionFile
    ? (() => {
        const credential = readSessionCredentialFile(sessionFile);
        const handle = store.resumeSession(credential, {
          allow_cursor_recovery:
            process.env.AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY === "1",
        });
        const credentialFile = writeSessionCredentialFile(
          sessionFile,
          handle.credential,
          { replace: true },
        );
        hostBinding?.record(handle.session.id, credentialFile);
        return { handle, credential_file: credentialFile };
      })()
    : undefined;
  const server = buildCollabMcpServer(store, {
    resumed_session: resumed,
    host_binding: hostBinding,
  });
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } finally {
      store.close();
      process.exit(exitCode);
    }
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
  // The pinned SDK transport only subscribes to stdin data/error, not EOF.
  // A closed host pipe must abort active waits and close SQLite immediately.
  process.stdin.once("end", () => void shutdown(0));
  process.stdin.once("close", () => void shutdown(0));
  process.stdin.once("error", () => void shutdown(1));

  await server.connect(transport);
  process.stderr.write(
    `· agenttool-collab MCP ready (local SQLite journal${resumed ? ", session resumed" : ""})\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
