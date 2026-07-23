import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const BROWSER_ENV = {
  headless: "AGENTOOL_BROWSER_HEADLESS",
  publicWeb: "AGENTOOL_BROWSER_PUBLIC_WEB",
  localNetwork: "AGENTOOL_BROWSER_LOCAL_NETWORK",
  profile: "AGENTOOL_BROWSER_PROFILE",
  profileDir: "AGENTOOL_BROWSER_PROFILE_DIR",
  channel: "AGENTOOL_BROWSER_CHANNEL",
  executable: "AGENTOOL_BROWSER_EXECUTABLE",
  outputDir: "AGENTOOL_BROWSER_OUTPUT_DIR",
} as const;

export type BrowserProfileConfig =
  | { mode: "ephemeral" }
  | { mode: "persistent"; directory: string };

/**
 * Process-scoped authority for one browser server. Tool calls deliberately do
 * not accept these fields, so a page cannot persuade an agent to widen them.
 */
export interface BrowserProcessConfig {
  headless: boolean;
  allowPublicWeb: boolean;
  allowLocalNetwork: boolean;
  profile: BrowserProfileConfig;
  channel?: string;
  executablePath?: string;
  outputDir: string;
}

export interface ParseBrowserConfigOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
}

const DEFAULT_CHANNEL = "chrome";
const SAFE_CHANNEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function booleanValue(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`${name} must be one of 1, 0, true, false, yes, no, on, or off`);
  }
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function absoluteFrom(cwd: string, value: string): string {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function defaultOutputDirectory(
  cwd: string,
  env: Record<string, string | undefined>,
): string {
  const configuredDataHome = env.XDG_DATA_HOME?.trim();
  const dataHome = configuredDataHome
    ? absoluteFrom(cwd, configuredDataHome)
    : join(homedir(), ".local", "share");
  return join(dataHome, "agenttool", "browser", "artifacts");
}

function overlaps(left: string, right: string): boolean {
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);
  const contains = (value: string) =>
    value === "" || (!value.startsWith("..") && !isAbsolute(value));
  return contains(leftToRight) || contains(rightToLeft);
}

function findGitWorktree(cwd: string): string | undefined {
  let candidate = cwd;
  for (;;) {
    if (existsSync(join(candidate, ".git"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

function checkedProfileDirectory(
  cwd: string,
  value: string,
  env: Record<string, string | undefined>,
): string {
  const directory = absoluteFrom(cwd, value);
  const ownerHome = homedir();
  const protectedRoots = [
    join(ownerHome, ".agenttool"),
    join(ownerHome, ".agenttool-agents"),
    join(ownerHome, ".config", "agenttool"),
    join(ownerHome, ".config", "google-chrome"),
    join(ownerHome, ".config", "google-chrome-beta"),
    join(ownerHome, ".config", "chromium"),
    join(ownerHome, ".config", "microsoft-edge"),
    join(ownerHome, ".config", "BraveSoftware", "Brave-Browser"),
    join(ownerHome, "Library", "Application Support", "Google", "Chrome"),
    join(ownerHome, "Library", "Application Support", "Chromium"),
    join(ownerHome, "Library", "Application Support", "Microsoft Edge"),
    join(ownerHome, "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
  ];
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData) {
    protectedRoots.push(
      join(localAppData, "Google", "Chrome", "User Data"),
      join(localAppData, "Chromium", "User Data"),
      join(localAppData, "Microsoft", "Edge", "User Data"),
      join(localAppData, "BraveSoftware", "Brave-Browser", "User Data"),
    );
  }
  if (directory === ownerHome || protectedRoots.some((root) => overlaps(directory, root))) {
    throw new Error(
      "persistent profile must be a dedicated directory and must not overlap AgentTool state or a normal browser profile",
    );
  }
  const worktree = findGitWorktree(cwd);
  if (worktree && overlaps(directory, worktree)) {
    throw new Error("persistent profile must not be inside or contain the current Git worktree");
  }
  return directory;
}

function checkedChannel(value: string, source: string): string {
  if (!SAFE_CHANNEL.test(value)) {
    throw new Error(`${source} must be a browser channel name (letters, numbers, dot, underscore, or dash)`);
  }
  return value;
}

/**
 * Parse only process-start configuration. Unknown arguments are rejected so a
 * misspelled safety flag cannot silently become a broader policy.
 */
export function parseBrowserProcessConfig(
  args: readonly string[],
  options: ParseBrowserConfigOptions = {},
): BrowserProcessConfig {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());

  let headless = booleanValue(BROWSER_ENV.headless, env[BROWSER_ENV.headless], true);
  let allowPublicWeb = booleanValue(BROWSER_ENV.publicWeb, env[BROWSER_ENV.publicWeb], true);
  let allowLocalNetwork = booleanValue(BROWSER_ENV.localNetwork, env[BROWSER_ENV.localNetwork], false);

  const envProfile = (env[BROWSER_ENV.profile] ?? "ephemeral").trim().toLowerCase();
  if (envProfile !== "ephemeral" && envProfile !== "persistent") {
    throw new Error(`${BROWSER_ENV.profile} must be ephemeral or persistent`);
  }

  let profileMode: "ephemeral" | "persistent" = envProfile;
  let profileDirectory = env[BROWSER_ENV.profileDir]?.trim() || undefined;
  let channelName: string | undefined =
    env[BROWSER_ENV.channel]?.trim() || DEFAULT_CHANNEL;
  let executableName = env[BROWSER_ENV.executable]?.trim() || undefined;
  if (executableName) channelName = undefined;
  let outputDirectory =
    env[BROWSER_ENV.outputDir]?.trim() || defaultOutputDirectory(cwd, env);

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    switch (flag) {
      case "--headless":
        headless = true;
        break;
      case "--headed":
        headless = false;
        break;
      case "--public-web":
        allowPublicWeb = true;
        break;
      case "--no-public-web":
        allowPublicWeb = false;
        break;
      case "--local-network":
        allowLocalNetwork = true;
        break;
      case "--no-local-network":
        allowLocalNetwork = false;
        break;
      case "--ephemeral":
        profileMode = "ephemeral";
        profileDirectory = undefined;
        break;
      case "--profile":
      case "--persistent-profile": {
        profileMode = "persistent";
        profileDirectory = requiredValue(args, index, flag);
        index += 1;
        break;
      }
      case "--channel": {
        channelName = requiredValue(args, index, flag);
        executableName = undefined;
        index += 1;
        break;
      }
      case "--executable":
      case "--executable-path": {
        executableName = requiredValue(args, index, flag);
        channelName = undefined;
        index += 1;
        break;
      }
      case "--output-dir":
        outputDirectory = requiredValue(args, index, flag);
        index += 1;
        break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }

  const profile: BrowserProfileConfig =
    profileMode === "ephemeral"
      ? { mode: "ephemeral" }
      : profileDirectory
        ? {
            mode: "persistent",
            directory: checkedProfileDirectory(cwd, profileDirectory, env),
          }
        : (() => {
            throw new Error(`${BROWSER_ENV.profileDir} is required for a persistent profile`);
          })();
  const executablePath = executableName
    ? absoluteFrom(cwd, executableName)
    : undefined;
  const channel = channelName
    ? checkedChannel(channelName, BROWSER_ENV.channel)
    : undefined;
  const outputDir = absoluteFrom(cwd, outputDirectory);

  return {
    headless,
    allowPublicWeb,
    allowLocalNetwork,
    profile,
    ...(channel ? { channel } : {}),
    ...(executablePath ? { executablePath } : {}),
    outputDir,
  };
}

export function formatProcessConfig(config: BrowserProcessConfig): Record<string, unknown> {
  return {
    headless: config.headless,
    public_web: config.allowPublicWeb,
    local_network: config.allowLocalNetwork,
    profile:
      config.profile.mode === "ephemeral"
        ? { mode: "ephemeral" }
        : { mode: "persistent", directory: config.profile.directory },
    browser: config.executablePath
      ? { executable_path: config.executablePath }
      : { channel: config.channel ?? DEFAULT_CHANNEL },
    output_dir: config.outputDir,
  };
}
