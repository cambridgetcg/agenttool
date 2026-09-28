#!/usr/bin/env node
const HELP = `Usage: agenttool-local-starter-mcp --dir <absolute-directory> [--write none|handoff|memory|both]

Node >=22. Explicit local stdio MCP. The Local Starter release bundles its dependencies.
Default: local_context_status and local_context_read only.
--write exposes only the selected compare-and-swap save tools.
Starting does not read note bodies, save, install host settings or contact a service.
No paths or credentials are accepted in tool arguments; no automatic context delivery.
Requests and encoded response frames are bounded to 131072 bytes.
`;

function parse(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--dir', '--write'].includes(flag) || value === undefined ||
        Object.hasOwn(options, flag.slice(2))) throw new Error('invalid_arguments');
    options[flag.slice(2)] = value;
  }
  return options;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('unsupported_node');
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(HELP);
    return;
  }
  const options = parse(args);
  const { buildLocalContextMcpServer, LocalContextStdioTransport } = await import('./server.mjs');
  const server = buildLocalContextMcpServer(options);
  server.server.onerror = () => undefined;
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await server.close(); } catch { /* No exception reflection. */ }
    // The process owns stdio. Pausing SDK input alone can leave an open pipe
    // alive after an oversized frame or remote close.
    process.stdin.destroy();
  };
  server.server.onclose = () => void shutdown();
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.stdin.once('end', () => void shutdown());
  await server.connect(new LocalContextStdioTransport());
}

function failed() {
  process.stderr.write('Local context MCP could not start or continue.\n');
  process.exit(1);
}

process.once('uncaughtException', failed);
process.once('unhandledRejection', failed);
void main().catch(failed);
