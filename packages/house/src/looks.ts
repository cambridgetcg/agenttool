/** The looks: the closed vocabulary of what the survey may do on a device.
 *
 * Each look returns only what README.md's look table says it may emit. File
 * text, configuration values, command output and error messages are read into
 * memory, reduced to closed words, validated names, canonical times, numbers
 * and booleans, and dropped. Nothing here writes, searches or follows a link it
 * was not told to read.
 */
import { join } from "node:path";
import { isFail, type EntryKind, type HouseFs } from "./fs.js";
import {
  CONTAINER_MARKERS, COMMAND_DIRECTORIES, NAMED_COMMANDS, VERSION_NAME, WRAPPER_NAME,
  installReferences, rootPath, safeRelative, type InstallReference, type RootName,
} from "./places.js";
import { looksIdentifying, type PrivacyHints } from "./privacy.js";
import { askArgv, assertAllowedArgv, childEnvironment, COLLAB_HOST_FILE, type AskName, type Runner } from "./run.js";

export type Environment = Record<string, string | undefined>;

export interface LookDeps {
  fs: HouseFs;
  run: Runner;
  env: Environment;
  home: string;
  now: Date;
  /** This process's user id, for the owner check before anything is run; null where there is none. */
  uid: number | null;
  hints: PrivacyHints;
  platform: string;
}

/** A look asked for something outside its boundary. A programming error, never a device state. */
export class LookRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookRefused";
  }
}

const FAIL_WORDS = { absent: "it is not there", denied: "permission was refused", failed: "the look failed" } as const;

function ageSeconds(now: Date, mtimeMs: number): number | null {
  const age = Math.floor((now.getTime() - mtimeMs) / 1000);
  return Number.isFinite(age) && age >= 0 ? age : null;
}

// ---------------------------------------------------------------- path

export type PathLook =
  | { seen: "absent" }
  | { seen: "entry"; type: EntryKind; age_seconds: number | null }
  | { seen: "unknown"; why: string };

function assertPathAllowed(root: RootName, rel: string): void {
  if (!safeRelative(rel)) throw new LookRefused("a path look takes plain components under its root, never .. or an absolute path");
  if (root === "bin" && !(WRAPPER_NAME.test(rel) || (NAMED_COMMANDS as readonly string[]).includes(rel))) {
    throw new LookRefused("in ~/.local/bin a path look sees agenttool-* wrappers and the named commands only");
  }
}

/** lstat a fixed path under an allowed root. Every component from the root down
 * is lstat'ed; a link on the way is not followed (the final entry is reported
 * as a link, also not followed). */
export function lookPath(deps: LookDeps, root: RootName, rel: string): PathLook {
  assertPathAllowed(root, rel);
  let path = rootPath(deps.home, root);
  const parts = ["", ...rel.split("/")];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== "") path = join(path, parts[index]!);
    const stat = deps.fs.lstat(path);
    const last = index === parts.length - 1;
    if (isFail(stat)) {
      if (stat.fail === "absent") return { seen: "absent" };
      return { seen: "unknown", why: `it could not be looked at: ${FAIL_WORDS[stat.fail]}` };
    }
    if (last) return { seen: "entry", type: stat.kind, age_seconds: ageSeconds(deps.now, stat.mtimeMs) };
    if (stat.kind === "link") return { seen: "unknown", why: "a link stands on the way to it; the link was not followed" };
    if (stat.kind !== "directory") return { seen: "absent" };
  }
  return { seen: "absent" };
}

const SYSTEM_PATHS: readonly string[] = [
  ...CONTAINER_MARKERS,
  ...COMMAND_DIRECTORIES.filter((dir) => dir.startsWith("/")).flatMap((dir) => NAMED_COMMANDS.map((name) => `${dir}/${name}`)),
];

/** lstat one of a closed list of system paths (container markers, the named commands in fixed command directories). */
export function lookSystemPath(deps: LookDeps, path: string): PathLook {
  if (!SYSTEM_PATHS.includes(path)) throw new LookRefused("that system path is not on the house's list");
  const stat = deps.fs.lstat(path);
  if (isFail(stat)) return stat.fail === "absent" ? { seen: "absent" } : { seen: "unknown", why: `it could not be looked at: ${FAIL_WORDS[stat.fail]}` };
  return { seen: "entry", type: stat.kind, age_seconds: ageSeconds(deps.now, stat.mtimeMs) };
}

// ---------------------------------------------------------------- link

export type LinkLook =
  | { seen: "absent" }
  | { seen: "unknown"; why: string }
  | {
    seen: "tool";
    versions: string[];
    more: boolean;
    current: string | null;
    current_problem: string | null;
    /** Other well-formed names in the install directory (a doorbell's state, a check directory): not installs. Never emitted. */
    others: string[];
  };

export const MAX_VERSIONS = 32;
export const SOURCE_FILE = "SOURCE.txt";

/** Read an install directory's `current` link and the version directories beside it (a directory holding SOURCE.txt). */
export function lookLink(deps: LookDeps, tool: string): LinkLook {
  if (!/^[a-z0-9-]{1,40}$/.test(tool)) throw new LookRefused("an install directory's name is a plain word");
  const top = lookPath(deps, "share", tool);
  if (top.seen !== "entry") return top;
  if (top.type === "link") return { seen: "unknown", why: "the install directory is a link; it was not followed" };
  if (top.type !== "directory") return { seen: "unknown", why: "the install directory is not a directory" };
  const dir = join(rootPath(deps.home, "share"), tool);
  const names = deps.fs.list(dir);
  if (isFail(names)) return { seen: "unknown", why: `the install directory could not be listed: ${FAIL_WORDS[names.fail]}` };
  const versions: string[] = [];
  const others: string[] = [];
  let more = false;
  for (const name of [...names].sort().slice(0, 4 * MAX_VERSIONS)) {
    if (name === "current" || !VERSION_NAME.test(name)) continue;
    const stat = deps.fs.lstat(join(dir, name));
    const source = isFail(stat) || stat.kind !== "directory" ? null : deps.fs.lstat(join(dir, name, SOURCE_FILE));
    if (source === null || isFail(source) || source.kind !== "file") {
      others.push(name);
      continue;
    }
    if (versions.length >= MAX_VERSIONS) {
      more = true;
      continue;
    }
    versions.push(name);
  }
  const tool_ = (current: string | null, current_problem: string | null): LinkLook => ({ seen: "tool", versions, more, current, current_problem, others });
  const link = deps.fs.lstat(join(dir, "current"));
  if (isFail(link)) {
    if (link.fail === "absent") return tool_(null, null);
    return tool_(null, `the current link could not be looked at: ${FAIL_WORDS[link.fail]}`);
  }
  if (link.kind !== "link") return tool_(null, "current is not a link");
  const target = deps.fs.readlink(join(dir, "current"));
  if (isFail(target)) return tool_(null, "the current link could not be read");
  if (target.includes("/") || !VERSION_NAME.test(target)) {
    return tool_(null, "the current link leads outside the install directory; it was not followed");
  }
  if (!versions.includes(target)) return tool_(null, "the current link names a directory that is not an installed version");
  return tool_(target, null);
}

// ---------------------------------------------------------------- source

export type SourceLook = { seen: "read"; commit: string | null; installed: string | null } | { seen: "unknown"; why: string };

const SOURCE_MAX_BYTES = 8192;
const COMMIT_LINE = /^commit:[ \t]*([0-9a-f]{7,40})[ \t]*$/;
/** Only the leading UTC time survives; anything after it on the line (a name, a note) is dropped. */
const INSTALLED_LINE = /^installed:[ \t]*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)(?=\s|$)/;

/** The `commit:` and `installed:` lines of an install's SOURCE.txt; nothing else of it is kept. */
export function lookSource(deps: LookDeps, tool: string, version: string): SourceLook {
  if (!/^[a-z0-9-]{1,40}$/.test(tool) || !VERSION_NAME.test(version) || version === "current") {
    throw new LookRefused("a source look names one install directory and one version directory");
  }
  const at = lookPath(deps, "share", `${tool}/${version}/${SOURCE_FILE}`);
  if (at.seen === "absent") return { seen: "unknown", why: "SOURCE.txt is not there" };
  if (at.seen === "unknown") return at;
  if (at.type !== "file") return { seen: "unknown", why: "SOURCE.txt is not a regular file; it was not read" };
  const read = deps.fs.readHead(join(rootPath(deps.home, "share"), tool, version, SOURCE_FILE), SOURCE_MAX_BYTES);
  if (isFail(read)) return { seen: "unknown", why: `SOURCE.txt could not be read: ${FAIL_WORDS[read.fail]}` };
  let commit: string | null = null;
  let installed: string | null = null;
  for (const line of read.text.split(/\r?\n/)) {
    if (commit === null) {
      const match = COMMIT_LINE.exec(line);
      if (match) commit = match[1]!;
    }
    if (installed === null) {
      const match = INSTALLED_LINE.exec(line);
      if (match && Number.isFinite(Date.parse(match[1]!))) installed = match[1]!;
    }
  }
  return { seen: "read", commit, installed };
}

// ---------------------------------------------------------------- entry and hook

export type HostName = "claude-code" | "codex";

export const SWITCHES: Readonly<Record<string, readonly string[]>> = {
  AGENTOOL_COLLAB_TOOLS: ["full", "notes"],
  AGENTOOL_COLLAB_CONSENT_RULE: ["consent/v1", "consent/v2"],
  AGENTOOL_COLLAB_WEATHER: ["on", "off"],
  AGENTTOOL_COLLAB_TOOLS: ["full", "notes"],
  AGENTTOOL_COLLAB_CONSENT_RULE: ["consent/v1", "consent/v2"],
  AGENTTOOL_COLLAB_WEATHER: ["on", "off"],
};
export const SWITCH_ELSE = "set to something else";

export const HOST_CONFIG = {
  "claude-code": { rel: ".claude.json", shown: "~/.claude.json", key: "mcpServers", format: "json" },
  codex: { rel: ".codex/config.toml", shown: "~/.codex/config.toml", key: "mcp_servers", format: "toml" },
} as const;
export const CLAUDE_SETTINGS = { rel: ".claude/settings.json", shown: "~/.claude/settings.json" } as const;
const CONFIG_MAX_BYTES = 8 * 1024 * 1024;

type ConfigRead = { seen: "no_config" } | { seen: "unknown"; why: string } | { seen: "parsed"; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read and parse a named host configuration file. A parser's message is never kept: it can quote the file. */
function readConfig(deps: LookDeps, rel: string, format: "json" | "toml"): ConfigRead {
  const path = join(deps.home, rel);
  const stat = deps.fs.lstat(path);
  if (isFail(stat)) return stat.fail === "absent" ? { seen: "no_config" } : { seen: "unknown", why: `the configuration file could not be looked at: ${FAIL_WORDS[stat.fail]}` };
  if (stat.kind === "link") return { seen: "unknown", why: "the configuration file is a link; it was not followed" };
  if (stat.kind !== "file") return { seen: "unknown", why: "the configuration file is not a regular file" };
  const read = deps.fs.readHead(path, CONFIG_MAX_BYTES);
  if (isFail(read)) return { seen: "unknown", why: `the configuration file could not be read: ${FAIL_WORDS[read.fail]}` };
  if (read.truncated) return { seen: "unknown", why: "the configuration file is larger than 8 MiB; it was not read" };
  try {
    return { seen: "parsed", value: format === "json" ? JSON.parse(read.text) : Bun.TOML.parse(read.text) };
  } catch {
    return { seen: "unknown", why: `the configuration file could not be parsed as ${format === "json" ? "JSON" : "TOML"}` };
  }
}

export type EntryLook =
  | { seen: "no_config" }
  | { seen: "unknown"; why: string }
  | { seen: "no_entry" }
  | { seen: "entry"; references: InstallReference[]; switches: Record<string, string> };

/** One named server entry of a host's configuration: whether it exists, which
 * installs its command and arguments name, and the closed-set switches in its
 * environment. Nothing else of the entry (or the file) is kept. */
export function lookEntry(deps: LookDeps, host: HostName, server: string): EntryLook {
  if (!/^agenttool-[a-z0-9-]{1,40}$/.test(server)) throw new LookRefused("an entry look names one agenttool-* server");
  const config = HOST_CONFIG[host];
  const read = readConfig(deps, config.rel, config.format);
  if (read.seen !== "parsed") return read;
  if (!isRecord(read.value)) return { seen: "unknown", why: "the configuration is not a table of settings" };
  const servers = read.value[config.key];
  if (servers === undefined) return { seen: "no_entry" };
  if (!isRecord(servers)) return { seen: "unknown", why: `${config.key} is not a table of servers` };
  if (!Object.hasOwn(servers, server)) return { seen: "no_entry" };
  const entry = servers[server];
  if (!isRecord(entry)) return { seen: "unknown", why: "the entry is not a table" };
  const words: string[] = [];
  if (typeof entry.command === "string") words.push(entry.command);
  if (Array.isArray(entry.args)) for (const arg of entry.args) if (typeof arg === "string") words.push(arg);
  const references = installReferences(words.join("\n"), deps.home);
  const switches: Record<string, string> = {};
  const env = entry.env;
  if (isRecord(env)) {
    for (const [name, allowed] of Object.entries(SWITCHES)) {
      if (!Object.hasOwn(env, name)) continue;
      const value = env[name];
      switches[name] = typeof value === "string" && allowed.includes(value) ? value : SWITCH_ELSE;
    }
  }
  return { seen: "entry", references, switches };
}

export type HookLook =
  | { seen: "no_config" }
  | { seen: "unknown"; why: string }
  | { seen: "hooks"; events: Array<{ event: string; references: InstallReference[] }> };

const EVENT_NAME = /^[A-Z][A-Za-z]{1,39}$/;
const MAX_EVENTS = 32;

/** Claude Code's hook settings: for each event, the installs its hooks' commands name. Never the command. */
export function lookHook(deps: LookDeps, host: "claude-code"): HookLook {
  if (host !== "claude-code") throw new LookRefused("the hook look reads Claude Code's settings only");
  const read = readConfig(deps, CLAUDE_SETTINGS.rel, "json");
  if (read.seen !== "parsed") return read;
  if (!isRecord(read.value)) return { seen: "unknown", why: "the settings are not a table" };
  const hooks = read.value.hooks;
  if (hooks === undefined) return { seen: "hooks", events: [] };
  if (!isRecord(hooks)) return { seen: "unknown", why: "hooks is not a table of events" };
  const events: Array<{ event: string; references: InstallReference[] }> = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!EVENT_NAME.test(event) || !Array.isArray(groups) || events.length >= MAX_EVENTS) continue;
    const commands: string[] = [];
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
      for (const hook of group.hooks) if (isRecord(hook) && typeof hook.command === "string") commands.push(hook.command);
    }
    events.push({ event, references: installReferences(commands.join("\n"), deps.home) });
  }
  return { seen: "hooks", events };
}

// ---------------------------------------------------------------- wrapper

export type WrapperLook =
  | { seen: "absent" }
  | { seen: "unknown"; why: string }
  | { seen: "wrappers"; wrappers: Array<{ name: string; entry: EntryKind; references: InstallReference[] | null }>; more: boolean };

const WRAPPER_HEAD_BYTES = 4096;
const MAX_WRAPPERS = 32;

/** Which agenttool-* wrappers ~/.local/bin holds, and the installs each names in
 * its first 4 KiB. A link is not followed; the wrapper's text never leaves. */
export function lookWrappers(deps: LookDeps): WrapperLook {
  const bin = rootPath(deps.home, "bin");
  const stat = deps.fs.lstat(bin);
  if (isFail(stat)) return stat.fail === "absent" ? { seen: "absent" } : { seen: "unknown", why: `~/.local/bin could not be looked at: ${FAIL_WORDS[stat.fail]}` };
  if (stat.kind === "link") return { seen: "unknown", why: "~/.local/bin is a link; it was not followed" };
  if (stat.kind !== "directory") return { seen: "absent" };
  const names = deps.fs.list(bin);
  if (isFail(names)) return { seen: "unknown", why: `~/.local/bin could not be listed: ${FAIL_WORDS[names.fail]}` };
  const wanted = names.filter((name) => WRAPPER_NAME.test(name)).sort();
  const wrappers: Array<{ name: string; entry: EntryKind; references: InstallReference[] | null }> = [];
  for (const name of wanted.slice(0, MAX_WRAPPERS)) {
    const at = lookPath(deps, "bin", name);
    if (at.seen !== "entry") continue;
    if (at.type !== "file") {
      wrappers.push({ name, entry: at.type, references: null });
      continue;
    }
    const read = deps.fs.readHead(join(bin, name), WRAPPER_HEAD_BYTES);
    wrappers.push({ name, entry: "file", references: isFail(read) ? null : installReferences(read.text, deps.home) });
  }
  return { seen: "wrappers", wrappers, more: wanted.length > MAX_WRAPPERS };
}

// ---------------------------------------------------------------- ask

export type HelpAsk = { seen: "answer"; has_weather: boolean } | { seen: "unknown"; why: string };
export type WeatherAsk =
  | { seen: "answer"; says: string | null; notes: string[]; withheld: boolean; awake_since: string | null; last_slept_at: string | null; battery: boolean | null }
  | { seen: "unknown"; why: string };

const ASK_LIMITS: Record<AskName, { timeoutMs: number; maxBytes: number }> = {
  help: { timeoutMs: 5000, maxBytes: 64 * 1024 },
  weather: { timeoutMs: 8000, maxBytes: 64 * 1024 },
};
const HOST_PROTOCOL = "agenttool.collab-host/1";
const WEATHER_PROTOCOL = "agenttool.collab-weather/1";
const MAX_TEXT = 600;
const MAX_NOTES = 16;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** The current collab host bundle may be run only when it and its directory are this user's and writable by no one else. */
export function runnableHostEntry(deps: LookDeps, version: string): { entry: string } | { why: string } {
  const dir = join(rootPath(deps.home, "share"), "collab", version);
  const entry = join(dir, COLLAB_HOST_FILE);
  const file = deps.fs.lstat(entry);
  if (isFail(file)) return { why: file.fail === "absent" ? "the current collab install has no host bundle" : `the host bundle could not be looked at: ${FAIL_WORDS[file.fail]}` };
  if (file.kind !== "file") return { why: "the host bundle is not a regular file, so it was not run" };
  const folder = deps.fs.lstat(dir);
  if (isFail(folder) || folder.kind !== "directory") return { why: "the current collab install directory could not be looked at" };
  for (const stat of [file, folder]) {
    if ((deps.uid !== null && stat.uid !== deps.uid) || (stat.mode & 0o022) !== 0) {
      return { why: "the host bundle or its directory is not this user's alone to change, so it was not run" };
    }
  }
  return { entry };
}

async function ask(deps: LookDeps, entry: string, name: AskName): Promise<{ receipt: Record<string, unknown> } | { why: string }> {
  const argv = askArgv(entry, name);
  assertAllowedArgv(argv, deps.home);
  const result = await deps.run.run(argv, { env: childEnvironment(deps.home), ...ASK_LIMITS[name] });
  if (result.spawnFailed) return { why: "the collab host could not be started" };
  if (result.timedOut) return { why: `the collab host did not answer within ${ASK_LIMITS[name].timeoutMs / 1000} seconds` };
  if (result.truncated) return { why: `the collab host printed more than ${ASK_LIMITS[name].maxBytes / 1024} KiB` };
  if (result.exitCode !== 0) return { why: "the collab host exited with an error" };
  const lines = result.stdout.split("\n").filter((line, index, all) => !(line === "" && index === all.length - 1));
  if (lines.length !== 1) return { why: "the collab host did not print exactly one line" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]!);
  } catch {
    return { why: "the collab host's line was not JSON" };
  }
  if (!isRecord(parsed) || parsed.protocol !== HOST_PROTOCOL) return { why: "the collab host's line was not a collab-host receipt" };
  return { receipt: parsed };
}

/** `--help`: whether the installed build lists the weather command. The usage text itself never leaves. */
export async function askHelp(deps: LookDeps, entry: string): Promise<HelpAsk> {
  const answer = await ask(deps, entry, "help");
  if ("why" in answer) return { seen: "unknown", why: answer.why };
  if (answer.receipt.status !== "help" || typeof answer.receipt.usage !== "string") return { seen: "unknown", why: "the collab host's help receipt had no usage" };
  return { seen: "answer", has_weather: /(?:^|\|\s*)agenttool-collab-host weather\b/.test(answer.receipt.usage) };
}

function utcOrNull(value: unknown): string | null {
  return typeof value === "string" && UTC_TIME.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

/** `weather`: its `says` and `notes`, the two wake times, and whether it shows a battery. Nothing else of the reading is kept. */
export async function askWeather(deps: LookDeps, entry: string): Promise<WeatherAsk> {
  const answer = await ask(deps, entry, "weather");
  if ("why" in answer) return { seen: "unknown", why: answer.why };
  const reading = answer.receipt.weather;
  if (answer.receipt.status !== "weather" || !isRecord(reading)) return { seen: "unknown", why: "the collab host's weather receipt had no reading" };
  if (reading.protocol !== undefined && reading.protocol !== WEATHER_PROTOCOL) return { seen: "unknown", why: "the weather reading is of a protocol this build does not know" };
  const power = isRecord(reading.power) ? reading.power : {};
  const battery = power.source === "battery" || (typeof power.battery_percent === "number" && Number.isFinite(power.battery_percent)) ? true : null;
  const texts: string[] = [];
  let says: string | null = null;
  if (typeof reading.says === "string" && reading.says.length > 0 && reading.says.length <= MAX_TEXT) {
    says = reading.says;
    texts.push(says);
  }
  const notes: string[] = [];
  if (Array.isArray(reading.notes)) {
    for (const note of reading.notes.slice(0, MAX_NOTES)) {
      if (typeof note === "string" && note.length > 0 && note.length <= MAX_TEXT) notes.push(note);
    }
  }
  texts.push(...notes);
  const unsafe = texts.some((text) => /[\u0000-\u001f\u007f]/.test(text) || looksIdentifying(text, deps.hints));
  return {
    seen: "answer",
    says: unsafe ? null : says,
    notes: unsafe ? [] : notes,
    withheld: unsafe,
    awake_since: utcOrNull(power.awake_since),
    last_slept_at: utcOrNull(power.last_slept_at),
    battery,
  };
}

// ---------------------------------------------------------------- env

export type EnvQuestion = "ci" | "over_ssh" | "container" | { path_has: (typeof COMMAND_DIRECTORIES)[number] };

function setTo(env: Environment, name: string): boolean {
  const value = env[name];
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/** The process environment, in closed form: booleans only. No value is ever kept. */
export function lookEnv(deps: LookDeps, question: EnvQuestion): boolean {
  if (question === "ci") return setTo(deps.env, "CI") || setTo(deps.env, "GITHUB_ACTIONS");
  if (question === "over_ssh") return setTo(deps.env, "SSH_CONNECTION") || setTo(deps.env, "SSH_CLIENT") || setTo(deps.env, "SSH_TTY");
  if (question === "container") return setTo(deps.env, "container");
  const dir = question.path_has === "~/.local/bin" ? join(deps.home, ".local", "bin") : question.path_has;
  return (deps.env.PATH ?? "").split(":").some((entry) => entry.replace(/\/+$/, "") === dir);
}
