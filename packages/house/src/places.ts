/** The fixed places the survey may look, and how a text names an install.
 *
 * Three roots under the home directory, where AgentTool's own installs put
 * things, plus two named commands in fixed command directories and two
 * container markers. Nothing else is ever looked at, and nothing is searched:
 * the only listings are of an install directory (its version names) and of
 * `~/.local/bin` (filtered to `agenttool-*` before anything else happens).
 */
import { isAbsolute, join, normalize } from "node:path";

export const SHARE_REL = ".local/share/agenttool";
export const STATE_REL = ".local/state/agenttool";
export const BIN_REL = ".local/bin";

export type RootName = "share" | "state" | "bin";
export const ROOT_SHOWN: Record<RootName, string> = {
  share: "~/.local/share/agenttool",
  state: "~/.local/state/agenttool",
  bin: "~/.local/bin",
};

/** The tools whose installs live as ~/.local/share/agenttool/<tool>/<version>/ beside a `current` link. */
export const TOOLS = ["collab", "lobby", "execution-seat"] as const;
export type Tool = (typeof TOOLS)[number];
/** Tool names the matcher recognises in a command or wrapper (the three above, and the two later tools' names). */
export const KNOWN_INSTALL_NAMES = ["collab", "lobby", "execution-seat", "lobby-doorbell", "house"] as const;

/** A version directory's name, e.g. `0.6.0-dev.0-ee916989` or `main-24ba2300`. Anything else is never emitted. */
export const VERSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
/** A wrapper the survey may look at. */
export const WRAPPER_NAME = /^agenttool-[a-z0-9][a-z0-9-]{0,63}$/;
/** The agenttool-* commands this repository's packages declare (their package.json `bin`, less one whose name
 * carries a project's own name). Only these names are
 * printed; any other agenttool-* file is shown without its name, since a file name on the device can carry anything. */
export const KNOWN_WRAPPERS = [
  "agenttool-browser", "agenttool-codex-usage", "agenttool-collab-courier", "agenttool-collab-host", "agenttool-collab-mcp",
  "agenttool-constructive", "agenttool-data", "agenttool-execution-seat",
  "agenttool-exit-door", "agenttool-hf-scout", "agenttool-house", "agenttool-kingdom", "agenttool-lobby", "agenttool-lobby-doorbell",
  "agenttool-lobby-mcp", "agenttool-local-starter", "agenttool-local-starter-mcp", "agenttool-research-commons", "agenttool-rhizome",
  "agenttool-skill", "agenttool-telescope", "agenttool-telescope-mcp", "agenttool-wake-return-mcp",
] as const;
/** The two names outside `agenttool-*` the survey may lstat in a command directory. */
export const NAMED_COMMANDS = ["timewitness", "lobby-netcheck"] as const;
export type NamedCommand = (typeof NAMED_COMMANDS)[number];
/** Fixed command directories for the named commands, shown as written here. */
export const COMMAND_DIRECTORIES = ["~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"] as const;
/** Fixed system files whose presence says a Linux container; lstat only. */
export const CONTAINER_MARKERS = ["/.dockerenv", "/run/.containerenv"] as const;

export function rootPath(home: string, root: RootName): string {
  return join(home, rootRel(root));
}

export function rootRel(root: RootName): string {
  return root === "share" ? SHARE_REL : root === "state" ? STATE_REL : BIN_REL;
}

export function commandDirectory(home: string, shown: (typeof COMMAND_DIRECTORIES)[number]): string {
  return shown === "~/.local/bin" ? join(home, BIN_REL) : shown;
}

/** A usable home: absolute, normalised, not the filesystem root. */
export function usableHome(home: string | undefined): string | null {
  if (home === undefined || home === "" || !isAbsolute(home)) return null;
  const normal = normalize(home).replace(/\/+$/, "");
  return normal === "" ? null : normal;
}

/** A relative path under a root: plain components only, never `..`, never absolute. */
export function safeRelative(rel: string): boolean {
  if (rel === "" || isAbsolute(rel)) return false;
  return rel.split("/").every((part) => part !== "" && part !== "." && part !== ".." && /^[A-Za-z0-9._+-]{1,80}$/.test(part));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface InstallReference {
  tool: string;
  version: string;
}

/** Every distinct `<tool>/<version>` named under the share root in a text: by
 * the home's absolute path, `$HOME`, `${HOME}` or `~`. Only known tool names
 * and well-formed version names are returned; the text itself never leaves. */
export function installReferences(text: string, home: string): InstallReference[] {
  const prefixes = [escapeRegExp(home), "\\$HOME", "\\$\\{HOME\\}", "~"].join("|");
  const pattern = new RegExp(`(?:${prefixes})/\\.local/share/agenttool/([a-z0-9-]{1,40})/([^/\\s"'\`;:|&<>()]{1,80})/`, "g");
  const seen = new Set<string>();
  const found: InstallReference[] = [];
  for (const match of text.matchAll(pattern)) {
    const tool = match[1]!;
    const version = match[2]!;
    if (!(KNOWN_INSTALL_NAMES as readonly string[]).includes(tool) || !VERSION_NAME.test(version)) continue;
    const key = `${tool}/${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ tool, version });
    if (found.length >= 8) break;
  }
  return found;
}
