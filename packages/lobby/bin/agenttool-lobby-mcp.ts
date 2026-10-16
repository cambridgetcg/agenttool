#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { resolveLobbyHome } from "../src/home.js";
import { buildLobbyMcpServer } from "../src/mcp.js";

async function main(): Promise<void> {
  process.umask(0o077);
  const server = buildLobbyMcpServer({ home: resolveLobbyHome(process.env) });
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } finally {
      process.exit(exitCode);
    }
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
  // The pinned SDK transport subscribes to stdin data/error only, not EOF.
  process.stdin.once("end", () => void shutdown(0));
  process.stdin.once("close", () => void shutdown(0));
  process.stdin.once("error", () => void shutdown(1));

  await server.connect(transport);
  process.stderr.write("· agenttool-lobby MCP ready (read-only local hall)\n");
}

main().catch((error) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
