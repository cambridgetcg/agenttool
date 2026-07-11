#!/usr/bin/env bun

import { resolve } from "node:path";
import { DataNode } from "./node.js";
import { serveDataNode } from "./server.js";

const rootArgument = process.argv.slice(2).find((argument) => argument.startsWith("--root="));
const root = resolve(rootArgument?.slice("--root=".length) || process.env.AGENT_DATA_DIR || ".agent-data");
const hostname = process.env.AGENT_DATA_HOST || "127.0.0.1";
const port = parsePort(process.env.AGENT_DATA_PORT);
const nodeBearer = process.env.AGENT_DATA_NODE_TOKEN || undefined;

const node = await DataNode.open({
  root,
  collections: [{
    id: "default",
    name: "Default",
    description: "Default local agent data collection",
    schema: { version: "1" },
    policy: { visibility: "private" },
  }],
});
const server = serveDataNode(node, {
  hostname,
  port,
  ...(nodeBearer ? { node_bearer: nodeBearer } : {}),
});

console.log(`agent-data/v1 node ${node.node_id} listening at ${server.url}`);
if (!nodeBearer) console.log("HTTP data access is disabled; set AGENT_DATA_NODE_TOKEN to enable it");

const shutdown = (): void => {
  server.stop(true);
  node.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function parsePort(value: string | undefined): number {
  if (value === undefined) return 7742;
  if (!/^\d+$/.test(value)) throw new Error("AGENT_DATA_PORT must be an integer from 0 to 65535");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("AGENT_DATA_PORT must be an integer from 0 to 65535");
  }
  return port;
}
