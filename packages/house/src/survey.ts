/** survey: look at this device and say what is here, what is missing, and what could not be told.
 *
 * Each part's reader receives only the looks its row in src/parts.ts declares.
 * Unknown is not present: a part that could not be looked at is `unknown` with
 * the reason. `stale` means only an inconsistency visible on this device: an
 * entry, hook or wrapper that names an install other than the current one.
 * Nothing here judges the house: no score, no fraction, no grade.
 */
import {
  askHelp, askWeather, lookEntry, lookEnv, lookHook, lookLink, lookPath, lookSource, lookSystemPath, lookVersion, lookWrappers,
  runnableHostEntry, spellingsOf, HOST_CONFIG, CLAUDE_SETTINGS,
  type EnvQuestion, type HostName, type LinkLook, type LookDeps, type PathLook, type SourceLook, type VersionLook,
} from "./looks.js";
import { PARTS, type LookName, type PartSpec } from "./parts.js";
import { COMMAND_DIRECTORIES, CONTAINER_MARKERS, type InstallReference, type RootName } from "./places.js";
import {
  GOOD_FOR_SECONDS, SURVEY_AUTHORISES, SURVEY_BASIS, SURVEY_PROTOCOL,
  type HouseSurvey, type PartState, type Place, type SurveyPart,
} from "./shapes.js";

const PLATFORMS = ["darwin", "linux", "win32", "freebsd", "openbsd", "netbsd", "sunos", "aix", "android"];

type WeatherOutcome =
  | { kind: "no_collab"; why: string }
  | { kind: "no_weather"; why: string }
  | { kind: "unknown"; why: string }
  | { kind: "reading"; says: string | null; notes: string[]; withheld: boolean; awake_since: string | null; last_slept_at: string | null; battery: boolean | null };

interface Shared {
  rooms: Map<string, LinkLook>;
  weather: Promise<WeatherOutcome> | null;
}

/** The looks one part may use, and nothing else. */
interface Looks {
  path(root: RootName, rel: string): PathLook;
  systemPath(path: string): PathLook;
  room(tool: string): LinkLook;
  version(tool: string, name: string): VersionLook;
  source(tool: string, version: string): SourceLook;
  entry(host: HostName, server: string): ReturnType<typeof lookEntry>;
  hook(): ReturnType<typeof lookHook>;
  wrappers(): ReturnType<typeof lookWrappers>;
  weather(): Promise<WeatherOutcome>;
  env(question: EnvQuestion): boolean;
}

export class UndeclaredLook extends Error {
  constructor(part: string, look: LookName) {
    super(`part ${part} used the ${look} look, which its row does not declare`);
    this.name = "UndeclaredLook";
  }
}

function looksFor(spec: PartSpec, deps: LookDeps, shared: Shared): Looks {
  const allow = (...names: LookName[]) => {
    for (const name of names) if (!spec.looks.includes(name)) throw new UndeclaredLook(spec.id, name);
  };
  const room = (tool: string): LinkLook => {
    allow("link");
    let seen = shared.rooms.get(tool);
    if (seen === undefined) {
      seen = lookLink(deps, tool);
      shared.rooms.set(tool, seen);
    }
    return seen;
  };
  return {
    path: (root, rel) => (allow("path"), lookPath(deps, root, rel)),
    systemPath: (path) => (allow("path"), lookSystemPath(deps, path)),
    room,
    version: (tool, name) => (allow("link"), lookVersion(deps, tool, name)),
    source: (tool, version) => (allow("source"), lookSource(deps, tool, version)),
    entry: (host, server) => (allow("entry"), lookEntry(deps, host, server)),
    hook: () => (allow("hook"), lookHook(deps, "claude-code")),
    wrappers: () => (allow("wrapper"), lookWrappers(deps)),
    weather: () => {
      allow("link", "path", "ask");
      shared.weather ??= readWeather(deps, room);
      return shared.weather;
    },
    env: (question) => (allow("env"), lookEnv(deps, question)),
  };
}

async function readWeather(deps: LookDeps, room: (tool: string) => LinkLook): Promise<WeatherOutcome> {
  const collab = room("collab");
  if (collab.seen === "absent") return { kind: "no_collab", why: "there is no collab install to ask" };
  if (collab.seen === "unknown") return { kind: "unknown", why: `the collab install could not be looked at: ${collab.why}` };
  if (collab.current === null) {
    return collab.versions.length === 0
      ? { kind: "no_collab", why: "there is no collab install to ask" }
      : { kind: "unknown", why: collab.current_problem ?? "no current collab install is named, so none was asked" };
  }
  const runnable = runnableHostEntry(deps, collab.current);
  if ("why" in runnable) return { kind: "unknown", why: runnable.why };
  const help = await askHelp(deps, runnable.entry);
  if (help.seen === "unknown") return { kind: "unknown", why: help.why };
  if (!help.has_weather) return { kind: "no_weather", why: "the installed collab build has no weather command" };
  const reading = await askWeather(deps, runnable.entry);
  if (reading.seen === "unknown") return { kind: "unknown", why: reading.why };
  return { kind: "reading", ...reading };
}

// ---------------------------------------------------------------- readers

type Reading = Omit<SurveyPart, "id" | "kind" | "for">;

function fileFacts(looks: Looks, root: RootName, rel: string, sidecar: string): { exists: boolean | null; age_seconds: number | null } {
  const main = looks.path(root, rel);
  if (main.seen === "unknown") return { exists: null, age_seconds: null };
  if (main.seen === "absent") return { exists: false, age_seconds: null };
  if (main.type !== "file") return { exists: null, age_seconds: null };
  // SQLite writes land in the write-ahead log first; the newer of the two times is the file's last write.
  const wal = looks.path(root, sidecar);
  const ages = [main.age_seconds, wal.seen === "entry" && wal.type === "file" ? wal.age_seconds : null].filter((age): age is number => age !== null);
  return { exists: true, age_seconds: ages.length === 0 ? null : Math.min(...ages) };
}

function readRoom(spec: PartSpec, looks: Looks): Reading {
  if (spec.of.shape !== "room") throw new Error("not a room");
  const { tool, file } = spec.of;
  // A variable in this process's environment that puts the file elsewhere: the default place is not read as if it were the one in use.
  const moved = file.movedBy.filter((name) => looks.env({ moved: name }));
  const facts = moved.length > 0 ? { exists: null, age_seconds: null } : fileFacts(looks, file.root, file.rel, file.sidecar);
  const ageWords = file.label === "cache"
    ? "its file time on this device's own clock; any write updates it, so the picture of the other devices is at least that old"
    : "its file time (and its write-ahead log's) on this device's own clock";
  const fileWords = moved.length > 0
    ? `${moved.join(" and ")} ${moved.length === 1 ? "is" : "are"} set in this process's environment to another place, so the ${file.label} may be elsewhere: ${file.shown} was not looked at, and whether the ${file.label} is there could not be told.`
    : `lstat ${file.shown} for whether the ${file.label} is there and ${ageWords}.`;
  const how = `Listed ~/.local/share/agenttool/${tool} for version directories (each holding SOURCE.txt), read its current link `
    + `and the commit and installed lines of the current SOURCE.txt; ${fileWords} Nothing was opened besides SOURCE.txt.`;
  const detail: Record<string, unknown> = { versions: [], current: null, commit: null, installed: null, [file.label]: facts };
  const link = looks.room(tool);
  if (link.seen === "absent") return { state: "missing", detail, how, why: `there is no ~/.local/share/agenttool/${tool}` };
  if (link.seen === "unknown") return { state: "unknown", detail, how, why: link.why };
  detail.versions = link.versions;
  if (link.more) detail.more_versions = true;
  if (link.current === null) {
    if (link.current_problem !== null) return { state: "unknown", detail, how, why: link.current_problem };
    if (link.versions.length === 0) return { state: "missing", detail, how, why: `~/.local/share/agenttool/${tool} holds no installed version` };
    return { state: "unknown", detail, how, why: "versions are installed, but no current link says which is in use" };
  }
  detail.current = link.current;
  const source = looks.source(tool, link.current);
  if (source.seen === "read") {
    detail.commit = source.commit;
    detail.installed = source.installed;
    return { state: "present", detail, how };
  }
  return { state: "present", detail, how: `${how} The current SOURCE.txt could not be used: ${source.why}.` };
}

interface Classified {
  tool: string;
  /** The version as printed: `current`, or the name of a version directory installed on this device; null otherwise. */
  version: string | null;
  names_current: boolean | null;
  /** stale: names an install other than the current one; untold: which is current could not be told. */
  standing: "current" | "stale" | "untold";
  why: string;
}

/**
 * Where an entry, hook or wrapper points. The version it names is text from a
 * configuration file or a script, so it is printed only when it is `current` or
 * the name of a version directory that is installed here (checked by lstat); any
 * other text in that place, which could be a token, an address or a name, is
 * neither printed nor repeated in the reason.
 */
function classify(looks: Looks, reference: InstallReference): Classified | null {
  const { tool } = reference;
  const room = looks.room(tool);
  if (reference.version === "current") {
    const version = "current";
    if (room.seen === "unknown") return { tool, version, names_current: null, standing: "untold", why: `which ${tool} install is current could not be told: ${room.why}` };
    if (room.seen === "absent") return { tool, version, names_current: false, standing: "stale", why: `it names a ${tool} install, but there is no ~/.local/share/agenttool/${tool}` };
    if (room.current !== null) return { tool, version, names_current: true, standing: "current", why: "" };
    return room.current_problem !== null
      ? { tool, version, names_current: null, standing: "untold", why: `it follows the ${tool} current link, which could not be used: ${room.current_problem}` }
      : { tool, version, names_current: false, standing: "stale", why: `it follows the ${tool} current link, but there is none` };
  }
  if (room.seen === "unknown") return { tool, version: null, names_current: null, standing: "untold", why: `which ${tool} install it names could not be told: ${room.why}` };
  if (room.seen === "absent") return { tool, version: null, names_current: false, standing: "stale", why: `it names a ${tool} install, but there is no ~/.local/share/agenttool/${tool}` };
  const seen = room.versions.includes(reference.version) ? "installed" : looks.version(tool, reference.version);
  // Another entry in the install area (a doorbell's state, a check directory) is not an install and is ignored.
  if (seen === "not_an_install") return null;
  if (seen === "not_installed") return { tool, version: null, names_current: false, standing: "stale", why: `it names a ${tool} directory that is not installed on this device` };
  if (typeof seen === "object") return { tool, version: null, names_current: null, standing: "untold", why: `which ${tool} install it names could not be looked at: ${seen.why}` };
  const version = reference.version;
  if (room.current === null) return { tool, version, names_current: null, standing: "untold", why: `it names ${tool} ${version}, and which ${tool} install is current could not be told` };
  return room.current === version
    ? { tool, version, names_current: true, standing: "current", why: "" }
    : { tool, version, names_current: false, standing: "stale", why: `it names ${tool} ${version}, but the current ${tool} install is ${room.current}` };
}

function installsOf(classified: Classified[]): Array<{ tool: string; version: string | null; names_current: boolean | null }> {
  return classified.map(({ tool, version, names_current }) => ({ tool, version, names_current }));
}

function standingOf(classified: Classified[], subject: (item: Classified) => string): { state: PartState; why?: string } {
  const stale = classified.filter((item) => item.standing === "stale");
  if (stale.length > 0) return { state: "stale", why: stale.map((item) => `${subject(item)}: ${item.why}`).join("; ") };
  const untold = classified.filter((item) => item.standing === "untold");
  if (untold.length > 0) return { state: "unknown", why: untold.map((item) => `${subject(item)}: ${item.why}`).join("; ") };
  return { state: "present" };
}

function readDoor(spec: PartSpec, looks: Looks): Reading {
  if (spec.of.shape !== "door") throw new Error("not a door");
  const { host, server, tool } = spec.of;
  const config = HOST_CONFIG[host];
  const how = `Read ${config.shown} and kept only its ${config.key}.${server} command and arguments (for the AgentTool install they name) `
    + "and the closed-set switches in its environment; no other key, and no environment value outside those switches.";
  const detail: Record<string, unknown> = { entry: false, names_install: null, version: null, names_current: null, switches: {} };
  if (looks.env({ moved: config.movedBy })) {
    return {
      state: "unknown", detail,
      how: `${config.movedBy} is set in this process's environment to another place, so ${config.shown} was not read.`,
      why: `${config.movedBy} is set in this process's environment to another place, so which configuration this host reads here could not be told`,
    };
  }
  const entry = looks.entry(host, server);
  if (entry.seen === "no_config") return { state: "missing", detail, how, why: `there is no ${config.shown}` };
  if (entry.seen === "unknown") return { state: "unknown", detail, how, why: entry.why };
  if (entry.seen === "no_entry") return { state: "missing", detail, how, why: `${config.shown} has no ${server} entry` };
  detail.entry = true;
  detail.switches = entry.switches;
  if (entry.conflicting.length > 0) {
    const pairs = entry.conflicting.map((name) => spellingsOf(name).join(" and ")).join("; ");
    return {
      state: "unknown", detail, how,
      why: `the entry sets ${pairs} to different values; collab reads the two spellings as one switch and refuses to start when they disagree`,
    };
  }
  const mine = entry.references.filter((reference) => reference.tool === tool);
  if (mine.length === 0) {
    detail.names_install = false;
    return { state: "unknown", detail, how, why: `the entry runs something outside AgentTool's ${tool} installs, so which build it runs cannot be told from here` };
  }
  const classified = mine.map((reference) => classify(looks, reference)).filter((item): item is Classified => item !== null);
  if (classified.length === 0) {
    detail.names_install = false;
    return { state: "unknown", detail, how, why: `the entry names a directory in the ${tool} install area that is not an installed version` };
  }
  detail.names_install = true;
  detail.version = classified[0]!.version;
  detail.names_current = classified.every((item) => item.names_current === true) ? true : classified.some((item) => item.names_current === false) ? false : null;
  const standing = standingOf(classified, () => "the entry");
  return { ...standing, detail, how };
}

function readHooks(spec: PartSpec, looks: Looks): Reading {
  const how = `Read ${CLAUDE_SETTINGS.shown} and kept only, for each hook event, the AgentTool installs its hooks' commands name; never a command, a matcher or any other setting. `
    + "An event this build does not know by name is shown as null.";
  if (looks.env({ moved: CLAUDE_SETTINGS.movedBy })) {
    return {
      state: "unknown", detail: { events: [] },
      how: `${CLAUDE_SETTINGS.movedBy} is set in this process's environment to another place, so ${CLAUDE_SETTINGS.shown} was not read.`,
      why: `${CLAUDE_SETTINGS.movedBy} is set in this process's environment to another place, so which settings Claude Code reads here could not be told`,
    };
  }
  const hooks = looks.hook();
  if (hooks.seen === "no_config") return { state: "missing", detail: { events: [] }, how, why: `there is no ${CLAUDE_SETTINGS.shown}` };
  if (hooks.seen === "unknown") return { state: "unknown", detail: { events: [] }, how, why: hooks.why };
  const events: Array<{ event: string | null; names_install: boolean; installs: ReturnType<typeof installsOf> }> = [];
  const all: Array<{ event: string | null; item: Classified }> = [];
  for (const { event, references } of hooks.events) {
    const classified = references.map((reference) => classify(looks, reference)).filter((item): item is Classified => item !== null);
    events.push({ event, names_install: classified.length > 0, installs: installsOf(classified) });
    for (const item of classified) all.push({ event, item });
  }
  const detail = { events };
  if (all.length === 0) return { state: "missing", detail, how, why: `no hook in ${CLAUDE_SETTINGS.shown} names an AgentTool install` };
  const byItem = new Map(all.map(({ event, item }) => [item, event]));
  const standing = standingOf(all.map(({ item }) => item), (item) => {
    const event = byItem.get(item);
    return typeof event === "string" ? `a ${event} hook` : "a hook under an event this build does not know by name";
  });
  return { ...standing, detail, how };
}

function readWrappers(spec: PartSpec, looks: Looks): Reading {
  const how = "Listed ~/.local/bin and kept only the agenttool-* names, then read the first 4 KiB of each for the AgentTool install it names; "
    + "a link was not followed, no wrapper's text was kept, and a name that is not one of AgentTool's own commands is shown as null.";
  const seen = looks.wrappers();
  if (seen.seen === "absent") return { state: "missing", detail: { wrappers: [] }, how, why: "there is no ~/.local/bin" };
  if (seen.seen === "unknown") return { state: "unknown", detail: { wrappers: [] }, how, why: seen.why };
  const wrappers: Array<Record<string, unknown>> = [];
  const all: Array<{ name: string | null; item: Classified }> = [];
  for (const wrapper of seen.wrappers) {
    if (wrapper.references === null) {
      wrappers.push({ name: wrapper.name, entry: wrapper.entry, names_install: null, installs: [] });
      continue;
    }
    const classified = wrapper.references.map((reference) => classify(looks, reference)).filter((item): item is Classified => item !== null);
    wrappers.push({ name: wrapper.name, entry: wrapper.entry, names_install: classified.length > 0, installs: installsOf(classified) });
    for (const item of classified) all.push({ name: wrapper.name, item });
  }
  const detail: Record<string, unknown> = { wrappers };
  if (seen.more) detail.more_wrappers = true;
  if (wrappers.length === 0) return { state: "missing", detail, how, why: "~/.local/bin holds no agenttool-* wrapper" };
  // Unknown is not present: wrappers that are all links (not followed) or unreadable say nothing about what runs.
  if (wrappers.every((wrapper) => wrapper.names_install === null)) {
    return { state: "unknown", detail, how, why: "no agenttool-* wrapper could be read: each is a link, which was not followed, or not a regular file that could be read" };
  }
  const byItem = new Map(all.map(({ name, item }) => [item, name]));
  const standing = standingOf(all.map(({ item }) => item), (item) => byItem.get(item) ?? "an agenttool-* file this build does not know by name");
  return { ...standing, detail, how };
}

function readWitness(spec: PartSpec, looks: Looks): Reading {
  const how = `lstat timewitness in ${COMMAND_DIRECTORIES.join(", ")} (a link is not followed), and whether that directory is on this process's PATH. The survey never runs it.`;
  const unknown: string[] = [];
  let linked: { dir: (typeof COMMAND_DIRECTORIES)[number] } | null = null;
  for (const dir of COMMAND_DIRECTORIES) {
    const seen = dir === "~/.local/bin" ? looks.path("bin", "timewitness") : looks.systemPath(`${dir}/timewitness`);
    if (seen.seen === "unknown") unknown.push(`${dir}: ${seen.why}`);
    if (seen.seen !== "entry") continue;
    if (seen.type === "link") {
      // Not followed, so whether it leads to timewitness cannot be told; a regular file further on still counts.
      linked ??= { dir };
      unknown.push(`${dir}/timewitness is a link, which was not followed, so whether it leads to timewitness could not be told`);
      continue;
    }
    if (seen.type !== "file") {
      unknown.push(`${dir}/timewitness is not a regular file`);
      continue;
    }
    return {
      state: "present",
      detail: { found_in: dir, entry: seen.type, on_process_path: looks.env({ path_has: dir }), run_by_survey: false },
      how: `${how} Running it gives a tied clock; until then this device's clock is its own word.`,
    };
  }
  const detail = linked === null
    ? { found_in: null, entry: null, on_process_path: null, run_by_survey: false }
    : { found_in: linked.dir, entry: "link", on_process_path: looks.env({ path_has: linked.dir }), run_by_survey: false };
  if (unknown.length > 0) return { state: "unknown", detail, how, why: unknown.join("; ") };
  return { state: "missing", detail, how, why: "timewitness is in none of those directories" };
}

function readNetcheck(spec: PartSpec, looks: Looks): Reading {
  const how = "lstat ~/.local/bin/agenttool-lobby-doorbell and ~/.local/bin/lobby-netcheck (a link is not followed), and read ~/.local/share/agenttool/lobby-doorbell's current link. The survey never runs netcheck.";
  const found: string[] = [];
  const unknown: string[] = [];
  for (const name of ["agenttool-lobby-doorbell", "lobby-netcheck"]) {
    const seen = looks.path("bin", name);
    if (seen.seen === "unknown") unknown.push(`~/.local/bin/${name}: ${seen.why}`);
    if (seen.seen !== "entry") continue;
    if (seen.type === "file") found.push(`~/.local/bin/${name}`);
    else if (seen.type === "link") unknown.push(`~/.local/bin/${name} is a link, which was not followed, so whether it leads to the doorbell could not be told`);
    else unknown.push(`~/.local/bin/${name} is not a regular file`);
  }
  const room = looks.room("lobby-doorbell");
  if (room.seen === "unknown") unknown.push(`~/.local/share/agenttool/lobby-doorbell: ${room.why}`);
  if (room.seen === "tool") {
    if (room.current !== null) found.push("~/.local/share/agenttool/lobby-doorbell");
    // The rooms' rule: versions without a usable current link do not say which one is in use.
    else if (room.current_problem !== null) unknown.push(`~/.local/share/agenttool/lobby-doorbell: ${room.current_problem}`);
    else if (room.versions.length > 0) unknown.push("~/.local/share/agenttool/lobby-doorbell: versions are installed, but no current link says which is in use");
  }
  const detail = { found, current: room.seen === "tool" ? room.current : null, run_by_survey: false };
  if (found.length > 0) return { state: "present", detail, how };
  if (unknown.length > 0) return { state: "unknown", detail, how, why: unknown.join("; ") };
  return { state: "missing", detail, how, why: "the doorbell's netcheck was not found in those places" };
}

async function readWeatherPart(spec: PartSpec, looks: Looks): Promise<Reading> {
  const how = "Asked the current collab install's host for --help, and for weather when the help lists it, each with a fixed argument, a timeout, a fixed small environment and a capped output; kept only the reading's says and notes.";
  const weather = await looks.weather();
  if (weather.kind === "no_collab" || weather.kind === "no_weather") return { state: "missing", detail: {}, how, why: weather.why };
  if (weather.kind === "unknown") return { state: "unknown", detail: {}, how, why: weather.why };
  if (weather.withheld) return { state: "unknown", detail: {}, how, why: "the reading's sentences held something that looked like an identifier, so none of them was kept" };
  if (weather.says === null) return { state: "unknown", detail: { notes: weather.notes }, how, why: "the reading had no says line" };
  return { state: "present", detail: { says: weather.says, notes: weather.notes }, how };
}

async function readWake(spec: PartSpec, looks: Looks): Promise<Reading> {
  const how = "Took power.awake_since and power.last_slept_at from the weather reading (the operating system's own times, on this device's clock).";
  const weather = await looks.weather();
  const detail = { awake_since: null as string | null, last_slept_at: null as string | null };
  if (weather.kind === "no_collab" || weather.kind === "no_weather") return { state: "missing", detail, how, why: `there is no weather reading to take wake times from: ${weather.why}` };
  if (weather.kind === "unknown") return { state: "unknown", detail, how, why: `the weather reading could not be taken: ${weather.why}` };
  detail.awake_since = weather.awake_since;
  detail.last_slept_at = weather.last_slept_at;
  if (weather.awake_since === null && weather.last_slept_at === null) return { state: "unknown", detail, how, why: "the weather reading had no wake times" };
  return { state: "present", detail, how };
}

const READERS: Record<PartSpec["of"]["shape"], (spec: PartSpec, looks: Looks) => Reading | Promise<Reading>> = {
  weather: readWeatherPart,
  room: readRoom,
  door: readDoor,
  hooks: readHooks,
  wrappers: readWrappers,
  witness: readWitness,
  netcheck: readNetcheck,
  wake: readWake,
};

// ---------------------------------------------------------------- the survey

function place(deps: LookDeps, weather: WeatherOutcome | null): Place {
  const platform = PLATFORMS.includes(deps.platform) ? deps.platform : "other";
  let container: boolean | null = null;
  if (platform === "darwin") container = false; // macOS processes do not run in Linux containers
  else if (platform === "linux") {
    const marked = CONTAINER_MARKERS.some((marker) => lookSystemPath(deps, marker).seen === "entry");
    container = marked || lookEnv(deps, "container") ? true : null; // no marker does not prove no container
  }
  return {
    platform,
    has_battery: weather !== null && weather.kind === "reading" ? weather.battery : null,
    container,
    ci: lookEnv(deps, "ci"),
    over_ssh: lookEnv(deps, "over_ssh"),
  };
}

function says(parts: SurveyPart[], at: Date): string {
  const groups: Array<[string, PartState]> = [["Here", "present"], ["Stale", "stale"], ["Missing", "missing"], ["Could not tell", "unknown"]];
  const sentences = groups
    .map(([label, state]) => [label, parts.filter((part) => part.state === state).map((part) => part.id)] as const)
    .filter(([, ids]) => ids.length > 0)
    .map(([label, ids]) => `${label}: ${ids.join(", ")}.`);
  return `${sentences.join(" ")} A reading from ${at.toISOString().slice(11, 19)}Z, good for about five minutes.`;
}

/** One survey of this device. Never throws for a device state: a part that fails is `unknown`. */
export async function survey(deps: LookDeps): Promise<HouseSurvey> {
  const shared: Shared = { rooms: new Map(), weather: null };
  const parts: SurveyPart[] = [];
  for (const spec of PARTS) {
    let reading: Reading;
    try {
      reading = await READERS[spec.of.shape](spec, looksFor(spec, deps, shared));
    } catch (error) {
      // An undeclared look is a defect in this build, not a device state: let it surface.
      if (error instanceof UndeclaredLook) throw error;
      reading = { state: "unknown", detail: {}, how: "This build could not finish looking at it.", why: "this build failed while looking at it" };
    }
    parts.push({ id: spec.id, kind: spec.kind, for: spec.for, ...reading });
  }
  const weather = shared.weather === null ? null : await shared.weather;
  return {
    protocol: SURVEY_PROTOCOL,
    surveyed_at: deps.now.toISOString(),
    good_for_seconds: GOOD_FOR_SECONDS,
    basis: SURVEY_BASIS,
    authorises: SURVEY_AUTHORISES,
    place: place(deps, weather),
    says: says(parts, deps.now),
    parts,
  };
}
