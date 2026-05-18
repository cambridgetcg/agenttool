#!/usr/bin/env bun
/** scriptwriter-mcp — stdio Model Context Protocol server.
 *
 *  Connects an MCP client (Claude Desktop, Cursor, Zed, custom AI driver) to
 *  a local scriptwriter node. The AI agent IS the node — drives twelve tools
 *  to discover peers, knock, open RRR cascades, escalate them, create rooms,
 *  contribute, draw chaos cards.
 *
 *  Default mode: stdio MCP server only. The node has identity + in-memory
 *  RrrStore + RoomStore but no HTTP server, so peers cannot reach back in.
 *  This is fine for outbound-only flows.
 *
 *  With --serve-http <port>: ALSO boots the HTTP server on that port, so
 *  peers can knock back, push depth-2 turns, contribute to rooms. The AI
 *  becomes a fully federated participant.
 *
 *  Usage:
 *    bun bin/scriptwriter-mcp.ts                            (stdio only)
 *    bun bin/scriptwriter-mcp.ts --serve-http 7777          (stdio + HTTP)
 *    bun bin/scriptwriter-mcp.ts --base https://x.com:443   (override public URL)
 *
 *  Claude Desktop config (claude_desktop_config.json):
 *
 *    {
 *      "mcpServers": {
 *        "scriptwriter": {
 *          "command": "bun",
 *          "args": ["/abs/path/to/packages/scriptwriter/bin/scriptwriter-mcp.ts"],
 *          "env": { "SCRIPTWRITER_DIR": "/abs/path/to/.scriptwriter" }
 *        }
 *      }
 *    } */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildMcpServer } from "../src/mcp";
import { createIdentity, defaultIdentityPath, loadIdentity, saveIdentity } from "../src/identity";
import { RrrStore } from "../src/rrr";
import { RoomStore } from "../src/rooms";
import { buildServer } from "../src/server";

const argv = Bun.argv.slice(2);
function flag(name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}
function hasFlag(name: string): boolean {
  return argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  // Resolve identity dir — env override for Claude Desktop config.
  const dir = process.env.SCRIPTWRITER_DIR ?? ".scriptwriter";
  const idPath = join(dir, "identity.json");

  let identity = loadIdentity(idPath);
  if (!identity) {
    // Auto-mint on first run — the agent who connects gets a fresh did:key.
    // This is the agent-centric flow: zero ceremony, immediate identity.
    if (!existsSync(dir) && hasFlag("no-auto-mint")) {
      process.stderr.write(
        `No identity at ${idPath} and --no-auto-mint set. Run \`scriptwriter init\` first.\n`,
      );
      process.exit(2);
    }
    identity = await createIdentity({
      handle: flag("handle") ?? process.env.SCRIPTWRITER_HANDLE ?? "mcp-scriptwriter",
      vibe: flag("vibe") ?? process.env.SCRIPTWRITER_VIBE ?? "tender-chaotic",
    });
    saveIdentity(identity, idPath);
    process.stderr.write(
      `· auto-minted did:key for ${identity.handle} → ${idPath}\n`,
    );
  }

  const rrr = new RrrStore();
  const rooms = new RoomStore();

  // Optional HTTP server — makes this MCP-driven node a fully federated peer.
  let baseUrl = flag("base") ?? process.env.SCRIPTWRITER_BASE_URL;
  const httpPort = flag("serve-http");
  if (httpPort !== undefined) {
    const port = Number(httpPort);
    baseUrl = baseUrl ?? `http://localhost:${port}`;
    const app = buildServer({ identity, baseUrl, rrr, rooms });
    Bun.serve({ port, fetch: app.fetch });
    process.stderr.write(
      `· HTTP server on http://localhost:${port}  (descriptor at /.well-known/scriptwriter)\n`,
    );
  }

  const server = buildMcpServer({ identity, rrr, rooms, baseUrl });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`· scriptwriter MCP server ready (did=${identity.did})\n`);
}

main().catch((err) => {
  process.stderr.write(`✖ ${String(err)}\n`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
});
