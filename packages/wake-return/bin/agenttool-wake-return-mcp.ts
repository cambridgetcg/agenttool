#!/usr/bin/env node
/** Explicit local binding, no automatic observation. Doctrine: docs/WAKE-RETURN.md. */
import { isAbsolute } from "node:path";

const HELP = "Usage: agenttool-wake-return-mcp --binding <absolute-file> [--scaffold <absolute-file>]\n" +
  "Private local stdio MCP: wake_return_status and wake_return_observe, both without arguments.\n" +
  "A binding explicitly selects project and identity; no credential is accepted on the command line.\n" +
  "Starting does not observe, retrieve credentials, adopt an identity or read private memory.\n";

function argumentsForHost(args: string[]): { bindingPath: string; scaffoldPath?: string } {
  const selected: { bindingPath?: string; scaffoldPath?: string } = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const path = args[index + 1];
    if ((flag !== "--binding" && flag !== "--scaffold") || path === undefined ||
      !isAbsolute(path) || path.length > 4_096 || /[\x00-\x1f\x7f]/.test(path)) throw new Error("invalid_arguments");
    const key = flag === "--binding" ? "bindingPath" : "scaffoldPath";
    if (selected[key] !== undefined) throw new Error("invalid_arguments");
    selected[key] = path;
  }
  if (selected.bindingPath === undefined) throw new Error("invalid_arguments");
  return { bindingPath: selected.bindingPath, ...(selected.scaffoldPath === undefined ? {} : { scaffoldPath: selected.scaffoldPath }) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(HELP);
    return;
  }
  const options = argumentsForHost(args);
  const [{ loadReturnHost }, { createReturnSession }, { buildReturnMcpServer, ReturnStdioTransport }] = await Promise.all([
    import("../src/host.js"), import("../src/core.js"), import("../mcp/server.js"),
  ]);
  const host = await loadReturnHost(options.bindingPath, options.scaffoldPath);
  const server = buildReturnMcpServer(createReturnSession(host.binding, host.dependencies));
  const transport = new ReturnStdioTransport();
  // SDK errors may contain caller data; no generic logging bridge is installed.
  server.server.onerror = () => undefined;
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await server.close(); } catch { /* No exception reflection. */ }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.stdin.once("end", () => void shutdown());
  await server.connect(transport);
}

function failed(): void {
  process.stderr.write("Wake Return could not start or continue.\n");
  process.exit(1);
}

process.once("uncaughtException", failed);
process.once("unhandledRejection", failed);
void main().catch(failed);
