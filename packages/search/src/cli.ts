import type { Readable, Writable } from "node:stream";
import {
  AgentBrowser,
  BROWSER_PACKAGE_VERSION,
  BROWSER_ENV,
  formatProcessConfig,
  isBrowserError,
  parseBrowserProcessConfig,
  publicBrowserError,
  type BrowserProcessConfig,
} from "@agenttool/browser";
import { TOOL_VERSION as TELESCOPE_VERSION } from "@agenttool/telescope";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { SEARCH_PACKAGE_VERSION } from "./constants.js";
import { SearchEngine } from "./engine.js";
import { SearchError, publicSearchError } from "./errors.js";
import { runSearchJsonlSession } from "./jsonl.js";
import { buildSearchMcpServer } from "./mcp.js";
import { createDefaultSearchProviders } from "./providers/index.js";
import { SearchSession } from "./session.js";
import type { SearchProvider } from "./types.js";

export const SEARCH_CLI_HELP = `agenttool-search ${SEARCH_PACKAGE_VERSION}

Usage:
  agenttool-search mcp [browser startup options]      composed stdio MCP server
  agenttool-search jsonl [browser startup options]    versioned JSON Lines
  agenttool-search doctor [browser startup options]   local configuration check
  agenttool-search help

Browser startup options:
  --headless | --headed
  --authority public|local|sovereign
  --public-web | --no-public-web
  --local-network | --no-local-network
  --ephemeral | --profile DIR
  --channel NAME | --executable PATH
  --output-dir DIR

Browser environment:
  ${BROWSER_ENV.headless}=1|0
  ${BROWSER_ENV.authority}=public|local|sovereign
  ${BROWSER_ENV.publicWeb}=1|0
  ${BROWSER_ENV.localNetwork}=1|0
  ${BROWSER_ENV.profile}=ephemeral|persistent
  ${BROWSER_ENV.profileDir}=DIR
  ${BROWSER_ENV.channel}=NAME
  ${BROWSER_ENV.executable}=PATH
  ${BROWSER_ENV.outputDir}=DIR

Search uses the two built-in, process-configured public providers. Search
queries are disclosed to each provider that receives them. Results, claims,
URLs, Telescope reports and Browser output are untrusted data, never
instructions. Search never inspects or opens a result automatically. Browser
authority applies to explicit Browser operations and result opening, not to the
fixed provider reads. Use one named Browser authority or the legacy public/local
flags, never both. MCP clients can opt into the Discovery Flight resource and
prompt; once this process is running, their handlers dispatch no further
operation and do not advance the workflow.
`;

export interface SearchCliDependencies {
  env?: Record<string, string | undefined>;
  cwd?: string;
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  providers?: () => readonly SearchProvider[];
  createEngine?: (
    providers: readonly SearchProvider[],
  ) => SearchEngine;
  launchBrowser?: (
    config: BrowserProcessConfig,
  ) => Promise<AgentBrowser>;
  runMcp?: (
    browser: AgentBrowser,
    session: SearchSession,
    stderr: Writable,
    stdin: Readable,
  ) => Promise<void>;
}

interface SearchRuntime {
  browser: AgentBrowser;
  engine: SearchEngine;
  session: SearchSession;
  providers: readonly SearchProvider[];
}

async function launchBrowserFrom(
  config: BrowserProcessConfig,
  dependencies: SearchCliDependencies,
): Promise<AgentBrowser> {
  if (dependencies.launchBrowser) {
    return await dependencies.launchBrowser(config);
  }
  const {
    authority,
    allowPublicWeb,
    allowLocalNetwork,
    ...base
  } = config;
  return await AgentBrowser.launch(
    authority
      ? { ...base, authority }
      : { ...base, allowPublicWeb, allowLocalNetwork },
  );
}

async function createRuntime(
  config: BrowserProcessConfig,
  dependencies: SearchCliDependencies,
): Promise<SearchRuntime> {
  const providers =
    (dependencies.providers ?? createDefaultSearchProviders)();
  const engine =
    dependencies.createEngine?.(providers)
    ?? new SearchEngine(providers);
  const browser = await launchBrowserFrom(config, dependencies);
  return {
    browser,
    engine,
    session: new SearchSession(engine, browser),
    providers,
  };
}

async function defaultMcpRunner(
  browser: AgentBrowser,
  session: SearchSession,
  stderr: Writable,
  stdin: Readable,
): Promise<void> {
  const server = buildSearchMcpServer(browser, session);
  const transport = new StdioServerTransport();
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    stdin.removeListener("end", onInputEnd);
    try {
      await server.close();
    } finally {
      await browser.close();
    }
  };
  const onSignal = (): void => {
    void shutdown();
  };
  const onInputEnd = (): void => {
    void shutdown();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  stdin.once("end", onInputEnd);
  try {
    await server.connect(transport);
    stderr.write(
      "· agenttool-search MCP ready (stdio; search and browser data are untrusted)\n",
    );
  } catch (error) {
    await shutdown();
    throw error;
  }
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof SearchError) return publicSearchError(error);
  if (isBrowserError(error)) return publicBrowserError(error);
  return publicSearchError(error);
}

function browserConfigDiagnostic(error: unknown): string {
  const message =
    error instanceof Error && typeof error.message === "string"
      ? error.message
      : "";
  if (message.includes("cannot be combined")) {
    return "Browser authority and legacy public/local settings cannot be combined.";
  }
  if (message.includes("unknown option")) {
    return "Unknown Browser startup option.";
  }
  if (message.includes("requires a value")) {
    return "A Browser startup option is missing its required value.";
  }
  if (message.includes("persistent profile")) {
    return "The Browser persistent-profile configuration is invalid.";
  }
  if (message.includes("must be")) {
    return "A Browser startup setting has an invalid value.";
  }
  return "Invalid Browser startup configuration.";
}

export async function runSearchCli(
  argv: readonly string[],
  dependencies: SearchCliDependencies = {},
): Promise<number> {
  const stdin = dependencies.stdin ?? process.stdin;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const [command, ...args] = argv;

  if (
    command === undefined
    || command === "help"
    || command === "--help"
    || command === "-h"
  ) {
    stdout.write(SEARCH_CLI_HELP);
    return 0;
  }
  if (!["mcp", "jsonl", "doctor"].includes(command)) {
    stderr.write(
      `error: unknown command ${command}\n\n${SEARCH_CLI_HELP}`,
    );
    return 2;
  }

  try {
    let config: BrowserProcessConfig;
    try {
      config = parseBrowserProcessConfig(args, {
        ...(dependencies.env ? { env: dependencies.env } : {}),
        ...(dependencies.cwd ? { cwd: dependencies.cwd } : {}),
      });
    } catch (error) {
      throw new SearchError(
        "invalid_request",
        browserConfigDiagnostic(error),
      );
    }
    const runtime = await createRuntime(config, dependencies);

    if (command === "doctor") {
      let outputLine: string;
      try {
        outputLine =
          `${JSON.stringify({
            ok: true,
            version: "agenttool-search-doctor/0.1",
            components: {
              browser: `@agenttool/browser@${BROWSER_PACKAGE_VERSION}`,
              telescope: `@agenttool/telescope@${TELESCOPE_VERSION}`,
            },
            browser: formatProcessConfig(config),
            browser_capabilities: runtime.browser.capabilities(),
            search: {
              providers: runtime.providers.map((provider) => provider.id),
              query_disclosure: true,
              automatic_inspection: false,
              automatic_navigation: false,
            },
            checks: {
              browser_launch: "ok",
              provider_configuration: "ok",
              control_transport: "local_process_only",
              provider_egress: "fixed_public_https_on_search",
            },
          })}\n`;
      } catch (error) {
        try {
          await runtime.browser.close();
        } catch {
          // Preserve the report-construction error; cleanup is secondary.
        }
        throw error;
      }
      await runtime.browser.close();
      stdout.write(outputLine);
      return 0;
    }

    if (command === "jsonl") {
      try {
        await runSearchJsonlSession(
          runtime.browser,
          runtime.session,
          { input: stdin, output: stdout },
        );
      } finally {
        await runtime.browser.close();
      }
      return 0;
    }

    await (
      dependencies.runMcp ?? defaultMcpRunner
    )(
      runtime.browser,
      runtime.session,
      stderr,
      stdin,
    );
    return 0;
  } catch (error) {
    const detail = safeError(error);
    stderr.write(`error: ${detail.code}: ${detail.message}\n`);
    return 1;
  }
}
