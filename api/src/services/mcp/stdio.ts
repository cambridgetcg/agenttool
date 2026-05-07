#!/usr/bin/env bun
/** Stdio entrypoint for the agenttool MCP server.
 *
 *  Hosts spawn this and communicate via stdin/stdout (newline-delimited
 *  JSON-RPC 2.0). See docs/MCP-SERVER.md.
 *
 *  Run:  bun api/src/services/mcp/stdio.ts
 *
 *  Host config (e.g. Claude Desktop):
 *    {
 *      "mcpServers": {
 *        "agenttool-sophia": {
 *          "command": "bun",
 *          "args": ["/path/to/agenttool/api/src/services/mcp/stdio.ts"]
 *        }
 *      }
 *    }
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server";

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
