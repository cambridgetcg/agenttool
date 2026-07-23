#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { buildTelescopeMcpServer } from "../mcp/server.js";

async function main(): Promise<void> {
  const server = buildTelescopeMcpServer();
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

  await server.connect(transport);
  process.stderr.write(
    "· agenttool-telescope MCP ready (bounded public HTTPS evidence only)\n",
  );
}

main().catch(() => {
  process.stderr.write("✖ agenttool-telescope MCP could not start\n");
  process.exit(1);
});
