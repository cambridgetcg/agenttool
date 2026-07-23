#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import {
  readSessionCredentialFile,
  writeSessionCredentialFile,
} from "../src/session-file.js";
import { loadRelayRuntimeFromEnvironment } from "../src/relay-runtime.js";
import { CollabStore } from "../src/store.js";

function defaultDatabasePath(): string {
  const dataHome = process.env.XDG_DATA_HOME;
  const base = dataHome
    ? (isAbsolute(dataHome) ? dataHome : resolve(dataHome))
    : join(homedir(), ".local", "share");
  return join(base, "agenttool", "collab.sqlite");
}

async function main(): Promise<void> {
  const databasePath = process.env.AGENTOOL_COLLAB_DB ?? defaultDatabasePath();
  const store = new CollabStore(databasePath);
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
        return { handle, credential_file: credentialFile };
      })()
    : undefined;
  const relayRuntime = loadRelayRuntimeFromEnvironment();
  const server = buildCollabMcpServer(store, {
    resumed_session: resumed,
    relay: relayRuntime?.client,
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

  await server.connect(transport);
  process.stderr.write(
    `· agenttool-collab MCP ready (local SQLite journal${resumed ? ", session resumed" : ""}${relayRuntime ? ", release-room relay configured" : ""})\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
