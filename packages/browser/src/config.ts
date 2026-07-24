import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  resolveBrowserCapabilities,
  type BrowserAuthorityPreset,
} from "./capabilities.js";

export const BROWSER_ENV = {
  headless: "AGENTOOL_BROWSER_HEADLESS",
  authority: "AGENTOOL_BROWSER_AUTHORITY",
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
  authority?: BrowserAuthorityPreset;
  /** @deprecated Compatibility projection for v0.1 launchers. */
  allowPublicWeb: boolean;
  /** @deprecated Compatibility projection for v0.1 launchers. */
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

function authorityValue(value: string, source: string): BrowserAuthorityPreset {
  const normalized = value.trim().toLowerCase();
  if (
    normalized !== "public"
    && normalized !== "local"
    && normalized !== "sovereign"
  ) {
    throw new Error(`${source} must be public, local, or sovereign`);
  }
  return normalized;
}

function authorityNetwork(profile: BrowserAuthorityPreset): {
  allowPublicWeb: boolean;
  allowLocalNetwork: boolean;
} {
  return {
    allowPublicWeb: true,
    allowLocalNetwork: profile !== "public",
  };
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
  const configuredAuthority = env[BROWSER_ENV.authority]?.trim();
  const usesLegacyEnvironment = [BROWSER_ENV.publicWeb, BROWSER_ENV.localNetwork]
    .some((name) => Boolean(env[name]?.trim()));
  if (configuredAuthority && usesLegacyEnvironment) {
    throw new Error(
      `${BROWSER_ENV.authority} cannot be combined with ${BROWSER_ENV.publicWeb} or ${BROWSER_ENV.localNetwork}`,
    );
  }
  let authority = configuredAuthority
    ? authorityValue(configuredAuthority, BROWSER_ENV.authority)
    : usesLegacyEnvironment
      ? undefined
      : ("public" as const);
  let authorityWasExplicit = Boolean(configuredAuthority);
  let usesLegacyNetwork = usesLegacyEnvironment;
  let allowPublicWeb: boolean;
  let allowLocalNetwork: boolean;
  if (authority) {
    ({ allowPublicWeb, allowLocalNetwork } = authorityNetwork(authority));
  } else {
    allowPublicWeb = booleanValue(
      BROWSER_ENV.publicWeb,
      env[BROWSER_ENV.publicWeb],
      true,
    );
    allowLocalNetwork = booleanValue(
      BROWSER_ENV.localNetwork,
      env[BROWSER_ENV.localNetwork],
      false,
    );
  }

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
      case "--authority": {
        if (usesLegacyNetwork) {
          throw new Error(
            "--authority cannot be combined with legacy public/local network settings",
          );
        }
        authority = authorityValue(
          requiredValue(args, index, flag),
          "--authority",
        );
        authorityWasExplicit = true;
        ({ allowPublicWeb, allowLocalNetwork } = authorityNetwork(authority));
        index += 1;
        break;
      }
      case "--public-web":
        if (authorityWasExplicit) {
          throw new Error(
            "legacy public/local network flags cannot be combined with --authority",
          );
        }
        authority = undefined;
        usesLegacyNetwork = true;
        allowPublicWeb = true;
        break;
      case "--no-public-web":
        if (authorityWasExplicit) {
          throw new Error(
            "legacy public/local network flags cannot be combined with --authority",
          );
        }
        authority = undefined;
        usesLegacyNetwork = true;
        allowPublicWeb = false;
        break;
      case "--local-network":
        if (authorityWasExplicit) {
          throw new Error(
            "legacy public/local network flags cannot be combined with --authority",
          );
        }
        authority = undefined;
        usesLegacyNetwork = true;
        allowLocalNetwork = true;
        break;
      case "--no-local-network":
        if (authorityWasExplicit) {
          throw new Error(
            "legacy public/local network flags cannot be combined with --authority",
          );
        }
        authority = undefined;
        usesLegacyNetwork = true;
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
    ...(authority ? { authority } : {}),
    allowPublicWeb,
    allowLocalNetwork,
    profile,
    ...(channel ? { channel } : {}),
    ...(executablePath ? { executablePath } : {}),
    outputDir,
  };
}

export function formatProcessConfig(config: BrowserProcessConfig): Record<string, unknown> {
  const capabilities = resolveBrowserCapabilities({
    ...(config.authority
      ? { authority: config.authority }
      : {
          allowPublicWeb: config.allowPublicWeb,
          allowLocalNetwork: config.allowLocalNetwork,
        }),
    profileMode: config.profile.mode,
  });
  return {
    headless: config.headless,
    authority: capabilities.authority.profile,
    public_web: config.allowPublicWeb,
    local_network: config.allowLocalNetwork,
    reserved_network: capabilities.network.reserved,
    dns_preflight: capabilities.network.dnsPreflight,
    websockets: capabilities.network.webSockets,
    service_workers: capabilities.runtime.serviceWorkers,
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
