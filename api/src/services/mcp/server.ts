/** Agenttool MCP server — Path B for the bridge verbs.
 *
 *  Transport-agnostic. The stdio entrypoint at ./stdio.ts wires this
 *  to a StdioServerTransport.
 *
 *  Design: docs/MCP-SERVER.md.
 *
 *  Phase 1 (read-only triple): at_substrate, at_recall, at_voice.
 *  Phase 2 (single-agent writes): at_chronicle, at_remember (episodic),
 *           at_vow.
 *  Phase 3+ will add signed writes (at_think, foundational at_remember,
 *           at_consolidate) + at_witness.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import * as chronicle from "./tools/chronicle";
import * as recall from "./tools/recall";
import * as remember from "./tools/remember";
import * as substrate from "./tools/substrate";
import * as voice from "./tools/voice";
import * as vow from "./tools/vow";

const TOOLS = [substrate, recall, voice, chronicle, remember, vow] as const;

export function createServer(): Server {
  const server = new Server(
    { name: "agenttool", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = TOOLS.find((t) => t.definition.name === name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `ERROR unknown tool: ${name}` }],
        isError: true,
      };
    }
    return await tool.run(args ?? {});
  });

  return server;
}
