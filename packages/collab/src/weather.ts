/**
 * Device weather (agenttool.collab-weather/1): one short-lived report of the
 * ground every agent on this device shares (power, processors, memory,
 * graphics and uplink), read by this process from the operating system.
 * Contract: PROTOCOL.md "Device weather"; tests: tests/weather.test.ts.
 *
 * A reading is about the moment it was read: it is never written to the
 * journal, put in an event or kept. It holds kinds, never identifiers: no
 * address, network name, host name, serial, user name or process name, and no
 * raw command output. Each fact is read directly, or listed under `inferred`
 * with what it was inferred from, or is null and listed under `unknown` with
 * the reason. It authorises nothing, proves nothing about a session, and no
 * verb behaves differently because of it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { cpus, loadavg, totalmem } from "node:os";
import { CollabError } from "./errors.js";
import { MIN_PROPOSAL_CONSULT_SECONDS } from "./protocol.js";

export const WEATHER_PROTOCOL = "agenttool.collab-weather/1" as const;
/** A load figure is false a minute on, so a reading says so. */
export const WEATHER_GOOD_FOR_SECONDS = 60;

export const WEATHER_BASIS =
  "Read by this process from the operating system just now; self-declared, and nothing attests it.";
export const WEATHER_AUTHORISES = "Nothing: this is a reading, not a permission.";
/** Said in the compact block collab_arrive returns, which leaves most fields out. */
export const WEATHER_EVERY_FIELD =
  "agenttool-collab-host weather prints every field of a reading, with what was inferred and what was not read.";

// ---------------------------------------------------------------------------
// Thresholds for the notes. Each note states a consequence; none is a limit.

/** One runnable thread per core: above it, work waits for a processor, and a measured time includes the wait. */
export const LOAD_PER_CORE_NOTE_ABOVE = 1;
/** At four fifths busy, a job started now gets at most the remaining fifth of the graphics device. */
export const GPU_BUSY_NOTE_PERCENT = 80;
/** Below 100, the operating system holds the processor under its full speed. */
export const SPEED_LIMIT_NOTE_BELOW = 100;
/**
 * The shortest window collab_propose accepts: a device that woke more recently
 * than that may have slept through part of any window still open.
 */
export const RECENT_WAKE_NOTE_SECONDS = MIN_PROPOSAL_CONSULT_SECONDS;

// ---------------------------------------------------------------------------
// How the commands run

/** Each command's own bound; each is measured at 20 to 50 ms on Apple silicon. */
export const WEATHER_COMMAND_TIMEOUT_MS = 1_500;
/** The whole reading's bound: a late command costs only the fields it feeds. */
export const WEATHER_DEADLINE_MS = 2_500;
/** collab_arrive's bound on a reader, a little past the reading's own deadline. */
export const WEATHER_ARRIVAL_LIMIT_MS = 3_000;
const OUTPUT_CAP_BYTES = 64 * 1024;
/** ioreg prints about 43 KB for one Apple graphics device, most of it a report legend. */
const GRAPHICS_OUTPUT_CAP_BYTES = 512 * 1024;
/** Nothing of the caller's environment is inherited. */
export const WEATHER_COMMAND_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  LC_ALL: "C",
});

export const WEATHER_SYSCTL_KEYS = [
  "machdep.cpu.brand_string",
  "hw.ncpu",
  "hw.perflevel0.physicalcpu",
  "hw.perflevel1.physicalcpu",
  "kern.memorystatus_vm_pressure_level",
  "vm.swapusage",
  "kern.boottime",
  "kern.sleeptime",
  "kern.waketime",
] as const;

/** Absolute paths and fixed arguments; no shell. `label` is what a reason names. */
export const DARWIN_WEATHER_COMMANDS = {
  battery: { label: "pmset -g batt", file: "/usr/bin/pmset", args: ["-g", "batt"] },
  settings: { label: "pmset -g", file: "/usr/bin/pmset", args: ["-g"] },
  thermal: { label: "pmset -g therm", file: "/usr/bin/pmset", args: ["-g", "therm"] },
  sysctl: { label: "sysctl", file: "/usr/sbin/sysctl", args: [...WEATHER_SYSCTL_KEYS] },
  graphics: {
    label: "ioreg",
    file: "/usr/sbin/ioreg",
    args: ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"],
    max_bytes: GRAPHICS_OUTPUT_CAP_BYTES,
  },
  route: { label: "route -n get default", file: "/sbin/route", args: ["-n", "get", "default"] },
  ports: { label: "networksetup -listallhardwareports", file: "/usr/sbin/networksetup", args: ["-listallhardwareports"] },
  reach: { label: "scutil --nwi", file: "/usr/sbin/scutil", args: ["--nwi"] },
} as const satisfies Record<string, { label: string; file: string; args: readonly string[]; max_bytes?: number }>;

type DarwinCommand = keyof typeof DARWIN_WEATHER_COMMANDS;

/** The range an iPhone's Personal Hotspot hands out: 172.20.10.0/28. */
const HOTSPOT_NETWORK = [172, 20, 10] as const;
const HOTSPOT_HOSTS = 16;

// ---------------------------------------------------------------------------
// The reading

export type PowerSource = "battery" | "ac" | "ups";
export type BatteryState = "charging" | "discharging" | "full";
export type MemoryPressure = "normal" | "warn" | "critical";
export type NetworkKind = "wifi" | "ethernet" | "phone_usb" | "tunnel" | "other" | "none";

export interface WeatherGraphicsDevice {
  model: string | null;
  utilisation_percent: number | null;
  memory_in_use_bytes: number | null;
}

export interface WeatherReading {
  protocol: typeof WEATHER_PROTOCOL;
  /** When the reading began, ISO 8601 in UTC; every command ran within the deadline after it. */
  read_at: string;
  good_for_seconds: number;
  platform: string;
  basis: string;
  authorises: string;
  says: string;
  notes: string[];
  power: {
    source: PowerSource | null;
    battery_percent: number | null;
    battery_state: BatteryState | null;
    /** macOS's estimate: to empty while discharging, to full while charging. */
    minutes_remaining: number | null;
    low_power_mode: boolean | null;
    /** Something holds the device awake; never which program. */
    sleep_prevented: boolean | null;
    /** The later of boot and last wake. */
    awake_since: string | null;
    /** Null, and not unknown, when the device has not slept since boot. */
    last_slept_at: string | null;
  };
  cpu: {
    chip: string | null;
    cores: number | null;
    performance_cores: number | null;
    efficiency_cores: number | null;
    load_1m: number | null;
    load_5m: number | null;
    load_15m: number | null;
    load_per_core: number | null;
    thermal_warning: "none" | "recorded" | null;
    speed_limit_percent: number | null;
  };
  memory: {
    total_bytes: number | null;
    pressure: MemoryPressure | null;
    swap_used_bytes: number | null;
  };
  gpu: {
    devices: WeatherGraphicsDevice[];
    shares_system_memory: boolean | null;
  };
  network: {
    /** An IPv4 default route exists; nothing was contacted to learn it. */
    default_route: boolean | null;
    kind: NetworkKind | null;
    os_reports: "reachable" | "not_reachable" | null;
    /** Only ever a positive inference; absence is unknown, never "no". */
    metered: "likely" | null;
  };
  inferred: Array<{ what: string; from: string }>;
  unknown: Array<{ what: string; why: string }>;
}

export type WeatherReader = () => Promise<WeatherReading>;

/** Every scalar field a reading has, by path; a null one is always explained. */
const FIELDS = [
  "power.source",
  "power.battery_percent",
  "power.battery_state",
  "power.minutes_remaining",
  "power.low_power_mode",
  "power.sleep_prevented",
  "power.awake_since",
  "power.last_slept_at",
  "cpu.chip",
  "cpu.cores",
  "cpu.performance_cores",
  "cpu.efficiency_cores",
  "cpu.load_1m",
  "cpu.load_5m",
  "cpu.load_15m",
  "cpu.load_per_core",
  "cpu.thermal_warning",
  "cpu.speed_limit_percent",
  "memory.total_bytes",
  "memory.pressure",
  "memory.swap_used_bytes",
  "gpu.shares_system_memory",
  "network.default_route",
  "network.kind",
  "network.os_reports",
  "network.metered",
] as const;

// ---------------------------------------------------------------------------
// Injection points: every test supplies these, so none reads a real device.

export interface WeatherCommandOutput {
  stdout: string;
  stderr: string;
  exit_code: number | null;
}

export interface WeatherCommandLimits {
  timeout_ms: number;
  max_bytes: number;
  /** Aborted at the overall deadline; a runner stops its command then. */
  signal: AbortSignal;
}

export type WeatherRunner = (
  file: string,
  args: readonly string[],
  limits: WeatherCommandLimits,
) => Promise<WeatherCommandOutput>;

/** A command's failure, in a fixed phrase that never carries its output. */
export class WeatherCommandFailure extends Error {}

export interface WeatherOs {
  loadavg(): number[];
  totalmem(): number;
  cpus(): readonly unknown[];
}

export interface WeatherDeps {
  platform?: string;
  now?: () => Date;
  run?: WeatherRunner;
  os?: WeatherOs;
  /** Linux power: read one small file; throws or rejects when it cannot. */
  read_file?: (path: string) => string | Promise<string>;
  /** Linux power: list a directory; throws or rejects when it cannot. */
  list_dir?: (path: string) => string[] | Promise<string[]>;
  command_timeout_ms?: number;
  deadline_ms?: number;
}

const SYSTEM_OS: WeatherOs = { loadavg, totalmem, cpus };

/**
 * Read the device now. Async, never throws, never contacts a network: on
 * darwin it runs fixed local commands in parallel under one deadline; on Linux
 * it reads node:os and, under the same deadline, /sys/class/power_supply;
 * elsewhere node:os alone.
 */
export async function readWeather(deps: WeatherDeps = {}): Promise<WeatherReading> {
  let at: Date;
  try {
    at = (deps.now ?? (() => new Date()))();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) at = new Date();
  } catch {
    at = new Date();
  }
  const platform = deps.platform ?? process.platform;
  const reading = emptyReading(at, platform);
  const ledger = new Ledger();
  let elsewhere = `not read on ${platform} by this build`;
  try {
    readOsFacts(reading, ledger, deps.os ?? SYSTEM_OS, platform);
    if (platform === "darwin") {
      elsewhere = "not read by this build";
      await readDarwin(reading, ledger, deps);
    } else if (platform === "linux") {
      elsewhere = "not read on Linux by this build";
      await readLinuxPower(reading, ledger, deps);
    }
  } catch {
    // A fault in this build's own parsing: what was read stands, the rest is explained.
    elsewhere = "this build failed while reading it";
  }
  return finish(reading, ledger, elsewhere);
}

function emptyReading(at: Date, platform: string): WeatherReading {
  return {
    protocol: WEATHER_PROTOCOL,
    read_at: at.toISOString(),
    good_for_seconds: WEATHER_GOOD_FOR_SECONDS,
    platform,
    basis: WEATHER_BASIS,
    authorises: WEATHER_AUTHORISES,
    says: "",
    notes: [],
    power: {
      source: null,
      battery_percent: null,
      battery_state: null,
      minutes_remaining: null,
      low_power_mode: null,
      sleep_prevented: null,
      awake_since: null,
      last_slept_at: null,
    },
    cpu: {
      chip: null,
      cores: null,
      performance_cores: null,
      efficiency_cores: null,
      load_1m: null,
      load_5m: null,
      load_15m: null,
      load_per_core: null,
      thermal_warning: null,
      speed_limit_percent: null,
    },
    memory: { total_bytes: null, pressure: null, swap_used_bytes: null },
    gpu: { devices: [], shares_system_memory: null },
    network: { default_route: null, kind: null, os_reports: null, metered: null },
    inferred: [],
    unknown: [],
  };
}

/** What was inferred and what was not read, first reason kept. */
class Ledger {
  readonly unknown = new Map<string, string>();
  readonly inferred: Array<{ what: string; from: string }> = [];
  /** Fields whose null is itself the reading (last_slept_at with no sleep since boot). */
  readonly read_as_null = new Set<string>();
  miss(what: string, why: string): void {
    if (!this.unknown.has(what)) this.unknown.set(what, why);
  }
  infer(what: string, from: string): void {
    this.inferred.push({ what, from });
  }
}

function fieldValue(reading: WeatherReading, path: string): unknown {
  const [group, key] = path.split(".") as [keyof WeatherReading, string];
  return (reading[group] as unknown as Record<string, unknown>)[key];
}

function finish(reading: WeatherReading, ledger: Ledger, elsewhere: string): WeatherReading {
  const { load_1m: load, cores } = reading.cpu;
  if (load !== null && cores !== null && cores > 0) reading.cpu.load_per_core = round2(load / cores);
  else ledger.miss("cpu.load_per_core", "it needs both the 1-minute load and the core count");
  for (const path of FIELDS) {
    const value = fieldValue(reading, path);
    if (value === null && !ledger.read_as_null.has(path)) ledger.miss(path, elsewhere);
    if (value !== null) ledger.unknown.delete(path);
  }
  // An empty list is a reading only when ioreg listed the devices and there were none.
  if (reading.gpu.devices.length === 0 && !ledger.read_as_null.has("gpu.devices")) ledger.miss("gpu.devices", elsewhere);
  reading.gpu.devices.forEach((device, index) => {
    for (const key of ["model", "utilisation_percent", "memory_in_use_bytes"] as const) {
      if (device[key] === null) ledger.miss(`gpu.devices[${index}].${key}`, `ioreg showed no ${GRAPHICS_KEY_WORDS[key]} for this device`);
    }
  });
  reading.inferred = ledger.inferred;
  reading.unknown = [...ledger.unknown].map(([what, why]) => ({ what, why }));
  reading.notes = weatherNotes(reading);
  reading.says = weatherSays(reading);
  return reading;
}

const GRAPHICS_KEY_WORDS = {
  model: '"model"',
  utilisation_percent: '"Device Utilization %"',
  memory_in_use_bytes: '"In use system memory"',
} as const;

// ---------------------------------------------------------------------------
// node:os facts, on every platform

function readOsFacts(reading: WeatherReading, ledger: Ledger, os: WeatherOs, platform: string): void {
  try {
    const total = os.totalmem();
    if (isWhole(total) && total > 0) reading.memory.total_bytes = total;
    else ledger.miss("memory.total_bytes", "node:os gave no total memory");
  } catch {
    ledger.miss("memory.total_bytes", "node:os gave no total memory");
  }
  try {
    const count = os.cpus().length;
    if (isWhole(count) && count > 0) reading.cpu.cores = count;
  } catch {
    // The core count stays unknown unless sysctl gives it.
  }
  if (platform === "win32") {
    for (const path of ["cpu.load_1m", "cpu.load_5m", "cpu.load_15m"]) ledger.miss(path, "Windows keeps no load average");
    return;
  }
  try {
    const [one, five, fifteen] = os.loadavg();
    const loads = [one, five, fifteen].map((value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? round2(value) : null));
    [reading.cpu.load_1m, reading.cpu.load_5m, reading.cpu.load_15m] = loads as [number | null, number | null, number | null];
  } catch {
    // Explained in finish().
  }
}

// ---------------------------------------------------------------------------
// darwin

type CommandResult = { ok: true; output: WeatherCommandOutput } | { ok: false; why: string };

async function readDarwin(reading: WeatherReading, ledger: Ledger, deps: WeatherDeps): Promise<void> {
  const results = await runDarwinCommands(deps);
  applyBattery(reading, ledger, results.battery);
  applySettings(reading, ledger, results.settings);
  applyThermal(reading, ledger, results.thermal);
  applySysctl(reading, ledger, results.sysctl);
  applyGraphics(reading, ledger, results.graphics);
  applyNetwork(reading, ledger, results.route, results.ports, results.reach);
}

async function runDarwinCommands(deps: WeatherDeps): Promise<Record<DarwinCommand, CommandResult>> {
  const run = deps.run ?? spawnWeatherCommand;
  const timeoutMs = deps.command_timeout_ms ?? WEATHER_COMMAND_TIMEOUT_MS;
  const deadlineMs = deps.deadline_ms ?? WEATHER_DEADLINE_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<CommandResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, why: `was still running at the ${deadlineMs} ms deadline` }), deadlineMs);
  });
  const keys = Object.keys(DARWIN_WEATHER_COMMANDS) as DarwinCommand[];
  try {
    const results = await Promise.all(keys.map((key) => {
      const command: { file: string; args: readonly string[]; max_bytes?: number } = DARWIN_WEATHER_COMMANDS[key];
      const attempt = (async (): Promise<CommandResult> => {
        try {
          const output = await run(command.file, command.args, {
            timeout_ms: timeoutMs,
            max_bytes: command.max_bytes ?? OUTPUT_CAP_BYTES,
            signal: controller.signal,
          });
          return { ok: true, output: normaliseOutput(output) };
        } catch (error) {
          return { ok: false, why: error instanceof WeatherCommandFailure ? error.message : "failed" };
        }
      })();
      return Promise.race([attempt, late]);
    }));
    return Object.fromEntries(keys.map((key, index) => [key, results[index]!])) as Record<DarwinCommand, CommandResult>;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function normaliseOutput(output: unknown): WeatherCommandOutput {
  const value = (output ?? {}) as Partial<WeatherCommandOutput>;
  return {
    stdout: typeof value.stdout === "string" ? value.stdout : "",
    stderr: typeof value.stderr === "string" ? value.stderr : "",
    exit_code: typeof value.exit_code === "number" ? value.exit_code : null,
  };
}

/**
 * The text a command printed, or why there is none. sysctl exits 1 when one
 * key is missing yet prints the others, so it is read whatever its status.
 */
function textOf(key: DarwinCommand, result: CommandResult, anyStatus = false): { text: string } | { why: string } {
  const label = DARWIN_WEATHER_COMMANDS[key].label;
  if (!result.ok) return { why: `${label} ${result.why}` };
  const { stdout, exit_code } = result.output;
  if (exit_code === null) return { why: `${label} was ended before it exited` };
  if (exit_code !== 0 && !anyStatus) return { why: `${label} exited with status ${exit_code}` };
  return { text: stdout };
}

function missAll(ledger: Ledger, paths: readonly string[], why: string): void {
  for (const path of paths) ledger.miss(path, why);
}

const BATTERY_FIELDS = ["power.source", "power.battery_percent", "power.battery_state", "power.minutes_remaining"] as const;

function applyBattery(reading: WeatherReading, ledger: Ledger, result: CommandResult): void {
  const read = textOf("battery", result);
  if ("why" in read) return missAll(ledger, BATTERY_FIELDS, read.why);
  const facts = parsePmsetBattery(read.text);
  if (facts.source) reading.power.source = facts.source;
  else ledger.miss("power.source", "pmset -g batt named no power source this build recognises");
  if (!facts.battery) {
    // Only a recognised report can say there is no battery; silence says nothing about the hardware.
    missAll(ledger, BATTERY_FIELDS.slice(1), facts.drawing_from_line
      ? "pmset -g batt reports no internal battery"
      : "pmset -g batt printed nothing this build recognises");
    return;
  }
  const battery = facts.battery;
  if (battery.percent !== null) reading.power.battery_percent = battery.percent;
  else ledger.miss("power.battery_percent", "pmset -g batt showed no charge percentage this build recognises");
  if (battery.state !== null) reading.power.battery_state = battery.state;
  else ledger.miss("power.battery_state", battery.state_known
    ? "pmset -g batt reports the battery neither charging, discharging nor full (as when it is held at a charge limit)"
    : "pmset -g batt showed a battery state this build has no word for");
  if (battery.minutes !== null) reading.power.minutes_remaining = battery.minutes;
  else ledger.miss("power.minutes_remaining", battery.no_estimate
    ? "macOS has no estimate yet"
    : "pmset -g batt showed no time remaining");
}

function applySettings(reading: WeatherReading, ledger: Ledger, result: CommandResult): void {
  const read = textOf("settings", result);
  if ("why" in read) return missAll(ledger, ["power.low_power_mode", "power.sleep_prevented"], read.why);
  const facts = parsePmsetSettings(read.text);
  if (facts.low_power_mode !== null) reading.power.low_power_mode = facts.low_power_mode;
  else ledger.miss("power.low_power_mode", "pmset -g has no lowpowermode line on this device");
  if (facts.sleep_prevented !== null) reading.power.sleep_prevented = facts.sleep_prevented;
  else ledger.miss("power.sleep_prevented", "pmset -g has no sleep line");
}

function applyThermal(reading: WeatherReading, ledger: Ledger, result: CommandResult): void {
  const read = textOf("thermal", result);
  if ("why" in read) return missAll(ledger, ["cpu.thermal_warning", "cpu.speed_limit_percent"], read.why);
  const facts = parsePmsetThermal(read.text);
  if (facts.thermal_warning !== null) reading.cpu.thermal_warning = facts.thermal_warning;
  else ledger.miss("cpu.thermal_warning", "pmset -g therm printed nothing this build recognises about thermal warnings");
  if (facts.speed_limit_percent !== null) reading.cpu.speed_limit_percent = facts.speed_limit_percent;
  else ledger.miss("cpu.speed_limit_percent", facts.no_cpu_status
    ? "macOS has recorded no CPU power status, so no speed limit was read"
    : "pmset -g therm printed no CPU_Speed_Limit");
}

const PRESSURE_LEVELS: Record<string, MemoryPressure> = { "1": "normal", "2": "warn", "4": "critical" };

function applySysctl(reading: WeatherReading, ledger: Ledger, result: CommandResult): void {
  const paths = [
    "cpu.chip", "cpu.performance_cores", "cpu.efficiency_cores", "memory.pressure",
    "memory.swap_used_bytes", "power.awake_since", "power.last_slept_at",
  ] as const;
  const read = textOf("sysctl", result, true);
  if ("why" in read) {
    missAll(ledger, paths, read.why);
    if (reading.cpu.cores === null) ledger.miss("cpu.cores", read.why);
    return;
  }
  const values = parseSysctl(read.text);
  const absent = (key: string) => `sysctl did not report ${key}`;
  const chip = values["machdep.cpu.brand_string"]?.trim();
  if (chip && chip.length <= 120 && !/[\u0000-\u001f\u007f]/.test(chip)) reading.cpu.chip = chip;
  else ledger.miss("cpu.chip", absent("machdep.cpu.brand_string"));
  const cores = wholeOf(values["hw.ncpu"]);
  if (cores !== null && cores > 0) reading.cpu.cores = cores;
  else if (reading.cpu.cores === null) ledger.miss("cpu.cores", absent("hw.ncpu"));
  const performance = wholeOf(values["hw.perflevel0.physicalcpu"]);
  if (performance !== null) reading.cpu.performance_cores = performance;
  else ledger.miss("cpu.performance_cores", `${absent("hw.perflevel0.physicalcpu")} (a processor without performance levels)`);
  const efficiency = wholeOf(values["hw.perflevel1.physicalcpu"]);
  if (efficiency !== null) reading.cpu.efficiency_cores = efficiency;
  else ledger.miss("cpu.efficiency_cores", `${absent("hw.perflevel1.physicalcpu")} (a processor without efficiency cores)`);
  const level = values["kern.memorystatus_vm_pressure_level"]?.trim();
  if (level !== undefined && PRESSURE_LEVELS[level]) reading.memory.pressure = PRESSURE_LEVELS[level]!;
  else ledger.miss("memory.pressure", level === undefined
    ? absent("kern.memorystatus_vm_pressure_level")
    : "sysctl gave a pressure level this build has no word for");
  const swap = swapUsedBytes(values["vm.swapusage"]);
  if (swap !== null) reading.memory.swap_used_bytes = swap;
  else ledger.miss("memory.swap_used_bytes", values["vm.swapusage"] === undefined
    ? absent("vm.swapusage")
    : "sysctl's vm.swapusage line is not in a form this build reads");
  const boot = timevalMs(values["kern.boottime"]);
  const slept = timevalMs(values["kern.sleeptime"]);
  const woke = timevalMs(values["kern.waketime"]);
  if (boot === null || boot === 0) {
    ledger.miss("power.awake_since", absent("kern.boottime"));
  } else if (woke === null) {
    ledger.miss("power.awake_since", absent("kern.waketime"));
  } else {
    reading.power.awake_since = new Date(Math.max(boot, woke)).toISOString();
  }
  if (slept === null) {
    ledger.miss("power.last_slept_at", absent("kern.sleeptime"));
  } else if (slept === 0) {
    ledger.read_as_null.add("power.last_slept_at");
  } else {
    reading.power.last_slept_at = new Date(slept).toISOString();
  }
}

function applyGraphics(reading: WeatherReading, ledger: Ledger, result: CommandResult): void {
  const read = textOf("graphics", result);
  if ("why" in read) return missAll(ledger, ["gpu.devices", "gpu.shares_system_memory"], read.why);
  const devices = parseIoreg(read.text);
  reading.gpu.devices = devices.map(({ model, utilisation_percent, memory_in_use_bytes }) => ({ model, utilisation_percent, memory_in_use_bytes }));
  if (devices.length === 0) ledger.read_as_null.add("gpu.devices");
  if (devices.some((device) => device.apple_graphics)) {
    reading.gpu.shares_system_memory = true;
    ledger.infer(
      "gpu.shares_system_memory",
      "ioreg names an AGX graphics class, which is Apple silicon graphics: its memory is the same memory as the processors'",
    );
  } else {
    ledger.miss("gpu.shares_system_memory", devices.length === 0
      ? "ioreg lists no graphics device"
      : "only Apple silicon graphics (an AGX class) is recognised as sharing memory; this build does not judge others");
  }
}

const NETWORK_PATHS = ["network.default_route", "network.kind"] as const;
const UNMETERED_UNKNOWN =
  "macOS does not show its \"expensive\" or Low Data Mode flags to a command-line reader, so only a phone link is recognised";

function applyNetwork(
  reading: WeatherReading,
  ledger: Ledger,
  routeResult: CommandResult,
  portsResult: CommandResult,
  reachResult: CommandResult,
): void {
  const reach = textOf("reach", reachResult);
  if ("why" in reach) ledger.miss("network.os_reports", reach.why);
  else {
    const reported = parseReach(reach.text);
    if (reported === "reachable" || reported === "not_reachable") reading.network.os_reports = reported;
    else ledger.miss("network.os_reports", reported === "connection_required"
      ? "scutil --nwi reports a route only once a connection is brought up (Connection Required), which says nothing about now"
      : "scutil --nwi printed no REACH line");
  }

  const label = DARWIN_WEATHER_COMMANDS.route.label;
  let route: ReturnType<typeof parseRoute> = null;
  let routeWhy = "";
  if (!routeResult.ok) {
    routeWhy = `${label} ${routeResult.why}`;
  } else {
    const { stdout, stderr, exit_code } = routeResult.output;
    route = parseRoute(stdout, stderr);
    // "not in table" is the answer whatever the status; a route is trusted only from a clean exit.
    if (route?.kind === "route" && exit_code !== 0) route = null;
    if (route === null) {
      routeWhy = exit_code === null
        ? `${label} was ended before it exited`
        : exit_code !== 0 ? `${label} exited with status ${exit_code}` : `${label} printed nothing this build recognises`;
    }
  }
  if (route === null) {
    missAll(ledger, NETWORK_PATHS, routeWhy);
    ledger.miss("network.metered", UNMETERED_UNKNOWN);
    return;
  }
  if (route.kind === "none") {
    reading.network.default_route = false;
    reading.network.kind = "none";
    // Only the IPv4 table was read: an uplink with IPv6 alone may still carry a connection.
    ledger.miss("network.metered", "the IPv4 table has no default route, so no link or gateway was there to judge");
    return;
  }
  reading.network.default_route = true;
  const ports = textOf("ports", portsResult);
  const judged = interfaceKind(route.interface, "why" in ports ? null : parseHardwarePorts(ports.text));
  const kind = judged.kind;
  if (kind !== null) {
    reading.network.kind = kind;
    if (judged.from !== undefined) ledger.infer("network.kind", judged.from);
  } else ledger.miss("network.kind", route.interface === null
    ? "route -n get default named no interface"
    : "why" in ports ? ports.why : "networksetup printed nothing this build recognises");
  let metered = false;
  if (kind === "phone_usb") {
    metered = true;
    ledger.infer("network.metered", "the default route runs over an iPhone USB link, which uses the phone's data plan");
  }
  if (isHotspotGateway(route.gateway)) {
    metered = true;
    ledger.infer("network.metered", "the default gateway is in 172.20.10.0/28, the range an iPhone's Personal Hotspot hands out");
  }
  if (metered) reading.network.metered = "likely";
  else ledger.miss("network.metered", UNMETERED_UNKNOWN);
}

/** Runs one command: absolute path, fixed arguments, no shell, no stdin, a minimal environment. */
export const spawnWeatherCommand: WeatherRunner = (file, args, limits) => new Promise((resolve, reject) => {
  if (limits.signal.aborted) {
    reject(new WeatherCommandFailure("was not started: the deadline had passed"));
    return;
  }
  let child: ChildProcess;
  try {
    child = spawn(file, [...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...WEATHER_COMMAND_ENV }, shell: false });
  } catch {
    reject(new WeatherCommandFailure("could not be started"));
    return;
  }
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  const settle = (done: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    limits.signal.removeEventListener("abort", onAbort);
    done();
  };
  const stop = (why: string) => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    settle(() => reject(new WeatherCommandFailure(why)));
  };
  const timer = setTimeout(() => stop(`did not finish within ${limits.timeout_ms} ms`), limits.timeout_ms);
  const onAbort = () => stop("was still running at the overall deadline");
  limits.signal.addEventListener("abort", onAbort, { once: true });
  const collect = (into: Buffer[]) => (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > limits.max_bytes) {
      stop(`printed more than ${limits.max_bytes} bytes`);
      return;
    }
    into.push(chunk);
  };
  child.stdout?.on("data", collect(stdout));
  child.stderr?.on("data", collect(stderr));
  child.once("error", (error: NodeJS.ErrnoException) => {
    settle(() => reject(new WeatherCommandFailure(`could not be started (${typeof error.code === "string" ? error.code : "error"})`)));
  });
  child.once("close", (code: number | null) => {
    settle(() => code === null
      ? reject(new WeatherCommandFailure("was ended by a signal"))
      : resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exit_code: code }));
  });
});

// ---------------------------------------------------------------------------
// darwin parsers: pure, exported for tests. None returns raw text from the
// output except the chip and graphics model names, which are model names.

export interface PmsetBatteryFacts {
  source: PowerSource | null;
  /** pmset printed its "Now drawing from '…'" line, so a missing battery line means there is none. */
  drawing_from_line: boolean;
  battery: null | {
    percent: number | null;
    state: BatteryState | null;
    /** A state pmset names that has no word here ("AC attached; not charging"). */
    state_known: boolean;
    minutes: number | null;
    no_estimate: boolean;
  };
}

const SOURCES: Record<string, PowerSource> = { "AC Power": "ac", "Battery Power": "battery", "UPS Power": "ups" };
const STATES: Record<string, BatteryState> = {
  charging: "charging",
  "finishing charge": "charging",
  discharging: "discharging",
  charged: "full",
};

export function parsePmsetBattery(text: string): PmsetBatteryFacts {
  const named = /Now drawing from '([^'\n]*)'/.exec(text)?.[1];
  const source = named !== undefined ? SOURCES[named] ?? null : null;
  const drawing_from_line = named !== undefined;
  const line = text.split("\n").find((entry) => /^\s*-InternalBattery-\d+/.test(entry));
  if (!line) return { source, drawing_from_line, battery: null };
  const fields = /(\d{1,3})%;\s*([^;]*?)\s*(?:;\s*(.*))?$/.exec(line);
  const percent = fields ? Number(fields[1]) : Number.NaN;
  const stateWord = fields?.[2]?.trim().toLowerCase() ?? "";
  const rest = fields?.[3] ?? "";
  const remaining = /(\d+):(\d{2}) remaining/.exec(rest);
  return {
    source,
    drawing_from_line,
    battery: {
      percent: Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : null,
      state: STATES[stateWord] ?? null,
      state_known: stateWord === "ac attached" && /not charging/.test(rest),
      minutes: remaining ? Number(remaining[1]) * 60 + Number(remaining[2]) : null,
      no_estimate: /\(no estimate\)/.test(rest),
    },
  };
}

export function parsePmsetSettings(text: string): { low_power_mode: boolean | null; sleep_prevented: boolean | null } {
  const low = /^\s*lowpowermode\s+(\d+)\s*$/m.exec(text)?.[1];
  // Only the `sleep` line, never which programs it names.
  const sleep = /^\s*sleep\s+\d+(.*)$/m.exec(text);
  return {
    low_power_mode: low === undefined ? null : low === "1" ? true : low === "0" ? false : null,
    sleep_prevented: sleep ? /\(sleep prevented by/.test(sleep[1] ?? "") : null,
  };
}

/**
 * The thermal output of a throttled Apple silicon Mac is not known here, so
 * only two things are recognised and anything else is unknown, not guessed.
 */
export function parsePmsetThermal(text: string): {
  thermal_warning: "none" | null;
  speed_limit_percent: number | null;
  no_cpu_status: boolean;
} {
  const limit = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(text)?.[1];
  const value = limit === undefined ? Number.NaN : Number(limit);
  return {
    thermal_warning: /No thermal warning level has been recorded/.test(text) ? "none" : null,
    speed_limit_percent: Number.isInteger(value) && value >= 0 && value <= 100 ? value : null,
    no_cpu_status: /No CPU power status has been recorded/.test(text),
  };
}

/** The asked-for keys sysctl printed; a missing one is simply absent. */
export function parseSysctl(text: string): Partial<Record<(typeof WEATHER_SYSCTL_KEYS)[number], string>> {
  const values: Partial<Record<string, string>> = {};
  for (const line of text.split("\n")) {
    const match = /^([a-z0-9_.]+):\s?(.*)$/i.exec(line);
    if (match && (WEATHER_SYSCTL_KEYS as readonly string[]).includes(match[1]!)) values[match[1]!] = match[2]!;
  }
  return values;
}

const SWAP_UNITS: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

function swapUsedBytes(value: string | undefined): number | null {
  const match = value === undefined ? null : /used\s*=\s*([\d.]+)([KMGT])/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? Math.round(amount * SWAP_UNITS[match[2]!]!) : null;
}

/** Milliseconds since the epoch from `{ sec = N, usec = M }`; 0 for a time that never happened. */
function timevalMs(value: string | undefined): number | null {
  const match = value === undefined ? null : /\{\s*sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)\s*\}/.exec(value);
  if (!match) return null;
  const ms = Number(match[1]) * 1000 + Math.floor(Number(match[2]) / 1000);
  return Number.isSafeInteger(ms) ? ms : null;
}

export interface IoregGraphicsDevice extends WeatherGraphicsDevice {
  /** The IOClass begins with AGX: Apple silicon graphics. The class itself is never emitted. */
  apple_graphics: boolean;
}

export function parseIoreg(text: string): IoregGraphicsDevice[] {
  const blocks = text.split(/^(?=\+-o )/m).filter((block) => block.startsWith("+-o "));
  return blocks.map((block) => {
    const model = /"model" = <?"([^"\n]{1,120})">?/.exec(block)?.[1] ?? null;
    const utilisation = wholeOf(/"Device Utilization %"=(\d+)/.exec(block)?.[1]);
    const memory = wholeOf(/"In use system memory"=(\d+)/.exec(block)?.[1]);
    const ioClass = /"IOClass" = "([^"\n]*)"/.exec(block)?.[1] ?? "";
    return {
      model: model && !/[\u0000-\u001f\u007f]/.test(model) ? model : null,
      utilisation_percent: utilisation !== null && utilisation <= 100 ? utilisation : null,
      memory_in_use_bytes: memory,
      apple_graphics: /^AGX/.test(ioClass),
    };
  });
}

/** The gateway is kept only for the hotspot inference and is never emitted. */
export function parseRoute(stdout: string, stderr: string):
  | { kind: "none" }
  | { kind: "route"; interface: string | null; gateway: string | null }
  | null {
  if (/not in table/.test(stderr) || /not in table/.test(stdout)) return { kind: "none" };
  const iface = /^\s*interface:\s*(\S+)\s*$/m.exec(stdout)?.[1] ?? null;
  const gateway = /^\s*gateway:\s*(\S+)\s*$/m.exec(stdout)?.[1] ?? null;
  if (iface === null && !/^\s*route to:/m.test(stdout)) return null;
  return { kind: "route", interface: iface, gateway };
}

/** Device name to hardware port name, as networksetup lists them. */
export function parseHardwarePorts(text: string): Map<string, string> {
  const ports = new Map<string, string>();
  let port: string | null = null;
  for (const line of text.split("\n")) {
    const named = /^Hardware Port:\s*(.+?)\s*$/.exec(line);
    if (named) {
      port = named[1]!;
      continue;
    }
    const device = /^Device:\s*(\S+)\s*$/.exec(line);
    if (device && port !== null) {
      ports.set(device[1]!, port);
      port = null;
    }
  }
  return ports;
}

export function portKind(port: string): Exclude<NetworkKind, "tunnel" | "none"> {
  if (/^iPhone USB\b/i.test(port)) return "phone_usb";
  if (/^Wi-?Fi\b/i.test(port)) return "wifi";
  if (/\bEthernet\b|\bLAN\b/i.test(port)) return "ethernet";
  return "other";
}

/**
 * The default route's interface as a kind. A tunnel is known by its name, and
 * a port this build names is read directly. `other` is reached by exclusion,
 * so it comes with `from`, what it was inferred from: a port named in another
 * language (a German Mac calls its Wi-Fi port "WLAN") reads as other too. The
 * kind is null when there is nothing to judge: no interface, or no port list
 * with anything this build recognises.
 */
export function interfaceKind(
  iface: string | null,
  ports: Map<string, string> | null,
): { kind: NetworkKind | null; from?: string } {
  if (iface === null) return { kind: null };
  if (/^(?:utun|ipsec|ppp|wg)\d*$/.test(iface)) return { kind: "tunnel" };
  if (ports === null || ports.size === 0) return { kind: null };
  const port = ports.get(iface);
  if (port === undefined) {
    return { kind: "other", from: "networksetup lists no hardware port for the default route's interface" };
  }
  const kind = portKind(port);
  return kind === "other"
    ? {
      kind,
      from: "networksetup names the default route's port with none of the names this build reads as Wi-Fi, Ethernet " +
        "or iPhone USB; a port named in another language reads as other too",
    }
    : { kind };
}

/** SCNetworkReachability flags, as scutil --nwi prints them. */
const REACH_REACHABLE = 0x2;
const REACH_CONNECTION_REQUIRED = 0x4;

/**
 * The system's own reach flags; nothing was contacted. Reachable without
 * Connection Required is reachable now. Reachable with it means only once a
 * connection (an on-demand VPN, a PPP link) is brought up, which says nothing
 * about now, so it is reported apart and read as unknown.
 */
export function parseReach(text: string): "reachable" | "not_reachable" | "connection_required" | null {
  const flags = [...text.matchAll(/REACH\s*:\s*flags\s+0x([0-9a-f]+)/gi)].map((match) => Number.parseInt(match[1]!, 16));
  if (flags.length === 0) return null;
  const reachable = flags.filter((value) => (value & REACH_REACHABLE) !== 0);
  if (reachable.some((value) => (value & REACH_CONNECTION_REQUIRED) === 0)) return "reachable";
  return reachable.length > 0 ? "connection_required" : "not_reachable";
}

export function isHotspotGateway(gateway: string | null): boolean {
  const parts = gateway === null ? null : /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(gateway);
  if (!parts) return false;
  const [a, b, c, d] = parts.slice(1).map(Number) as [number, number, number, number];
  return a === HOTSPOT_NETWORK[0] && b === HOTSPOT_NETWORK[1] && c === HOTSPOT_NETWORK[2] && d < HOTSPOT_HOSTS;
}

// ---------------------------------------------------------------------------
// Linux power

const POWER_SUPPLY = "/sys/class/power_supply";
const LINUX_STATES: Record<string, BatteryState> = { Charging: "charging", Discharging: "discharging", Full: "full" };
/** Supplies that bring power from outside: a mains adapter, or a USB or USB-C charger the kernel lists as USB. */
const OUTSIDE_POWER_TYPES = /^(?:Mains|USB(?:_[A-Z0-9_]+)?)$/;
/** A power_supply attribute is at most one page. */
const SYSFS_READ_CAP = 4096;

/**
 * The default Linux readers. They are asynchronous because reading a supply
 * calls its driver, which can stall (an embedded controller, a fuel gauge); a
 * synchronous read would hold the event loop, and with it every session on
 * this server, past every deadline.
 */
export const LINUX_FILE_READERS = {
  read_file: async (path: string): Promise<string> => (await readFile(path, "utf8")).slice(0, SYSFS_READ_CAP),
  list_dir: (path: string): Promise<string[]> => readdir(path),
};

/** One supply's files, as read; null where a file could not be read or was not asked for. */
interface LinuxSupply {
  type: string | null;
  scope: string | null;
  present: string | null;
  online: string | null;
  capacity: string | null;
  status: string | null;
}

/**
 * The power fields, from /sys/class/power_supply, under the reading's
 * deadline. The supplies are read first and applied only if they all answered
 * in time, so a late file costs the power fields and never changes a reading
 * after it was returned.
 */
async function readLinuxPower(reading: WeatherReading, ledger: Ledger, deps: WeatherDeps): Promise<void> {
  const deadlineMs = deps.deadline_ms ?? WEATHER_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ late: true }>((resolve) => {
    timer = setTimeout(() => resolve({ late: true }), deadlineMs);
  });
  try {
    const outcome = await Promise.race([
      readLinuxSupplies(deps).then((supplies) => ({ supplies }), () => ({ failed: true as const })),
      late,
    ]);
    if ("late" in outcome) missAll(ledger, BATTERY_FIELDS, `${POWER_SUPPLY} was still being read at the ${deadlineMs} ms deadline`);
    else if ("failed" in outcome) missAll(ledger, BATTERY_FIELDS, `${POWER_SUPPLY} could not be read`);
    else applyLinuxPower(reading, ledger, outcome.supplies);
  } finally {
    clearTimeout(timer);
  }
}

async function readLinuxSupplies(deps: WeatherDeps): Promise<LinuxSupply[]> {
  const list = deps.list_dir ?? LINUX_FILE_READERS.list_dir;
  const readFile = deps.read_file ?? LINUX_FILE_READERS.read_file;
  const read = async (name: string, file: string): Promise<string | null> => {
    try {
      const value = await readFile(`${POWER_SUPPLY}/${name}/${file}`);
      return typeof value === "string" ? value.trim() : null;
    } catch {
      return null;
    }
  };
  const names = [...await list(POWER_SUPPLY)].filter((name) => /^[A-Za-z0-9_.:-]{1,64}$/.test(name)).sort();
  return Promise.all(names.map(async (name): Promise<LinuxSupply> => {
    const [type, scope] = await Promise.all([read(name, "type"), read(name, "scope")]);
    const supply: LinuxSupply = { type, scope, present: null, online: null, capacity: null, status: null };
    // A peripheral's battery (a mouse, a keyboard, a headset) has scope Device: it is
    // not this device's power, and its files are not read, since asking it can wait.
    if (type === null || scope === "Device") return supply;
    if (OUTSIDE_POWER_TYPES.test(type)) {
      supply.online = await read(name, "online");
    } else if (type === "Battery") {
      supply.present = await read(name, "present");
      if (supply.present !== "0") [supply.capacity, supply.status] = await Promise.all([read(name, "capacity"), read(name, "status")]);
    }
    return supply;
  }));
}

function applyLinuxPower(reading: WeatherReading, ledger: Ledger, supplies: LinuxSupply[]): void {
  const own = supplies.filter((supply) => supply.type !== null && supply.scope !== "Device");
  const outside = own.filter((supply) => OUTSIDE_POWER_TYPES.test(supply.type!));
  // An empty slot (present 0) holds no battery.
  const batteries = own.filter((supply) => supply.type === "Battery" && supply.present !== "0");
  // Mains offline is not on its own a reading of battery power: a charger the
  // kernel does not list would leave it so. Only the battery saying so is.
  if (outside.some((supply) => supply.online === "1")) reading.power.source = "ac";
  else if (batteries.some((supply) => supply.status === "Discharging")) reading.power.source = "battery";
  else {
    ledger.miss("power.source", `${POWER_SUPPLY} shows no online mains or USB supply and no battery of this device's own discharging`);
  }
  if (batteries.length === 0) {
    missAll(ledger, BATTERY_FIELDS.slice(1), supplies.some((supply) => supply.type === null)
      ? `${POWER_SUPPLY} lists no battery of this device's own that could be read`
      : `${POWER_SUPPLY} lists no battery of this device's own`);
    return;
  }
  const battery = batteries.length === 1 ? batteries[0]! : null;
  if (battery === null) {
    missAll(
      ledger,
      ["power.battery_percent", "power.battery_state"],
      `${POWER_SUPPLY} lists more than one battery of this device's own; this build does not combine them`,
    );
    return;
  }
  const capacity = wholeOf(battery.capacity ?? undefined);
  if (capacity !== null && capacity <= 100) reading.power.battery_percent = capacity;
  else ledger.miss("power.battery_percent", "the battery's capacity file could not be read");
  const state = battery.status === null ? undefined : LINUX_STATES[battery.status];
  if (state) reading.power.battery_state = state;
  else ledger.miss("power.battery_state", battery.status === null
    ? "the battery's status file could not be read"
    : "the battery reports a status this build has no word for");
}

// ---------------------------------------------------------------------------
// Notes and the one-line summary, built only from what was read

export const WEATHER_NOTE_ON_BATTERY =
  "On battery: work here spends the person's charge, and a closed lid stops every session on this device at once.";
export const WEATHER_NOTE_LOW_POWER = "Low Power Mode is on: the person has asked this device to be frugal.";
// A peer on the same link (a Thunderbolt Bridge, a switch with no router) needs
// no default route and can still answer, so the note names only what does.
export const WEATHER_NOTE_NO_ROUTE =
  "No default route: the local journal still works; anything reached through a router, hosted services among them, " +
  "will not answer, which is not the same as a peer staying silent.";
export const WEATHER_NOTE_METERED = "The connection is likely metered: large downloads spend the person's data.";

/** Each note states a consequence and its reason; none tells an agent what to do. */
export function weatherNotes(reading: WeatherReading): string[] {
  const notes: string[] = [];
  const { power, cpu, memory, gpu, network } = reading;
  if (power.source === "battery") notes.push(WEATHER_NOTE_ON_BATTERY);
  if (power.low_power_mode === true) notes.push(WEATHER_NOTE_LOW_POWER);
  if (memory.pressure === "warn" || memory.pressure === "critical") {
    notes.push(`Memory pressure is ${memory.pressure}: more parallel processes will be slow for everyone on this device.`);
  }
  if (cpu.load_per_core !== null && cpu.load_per_core > LOAD_PER_CORE_NOTE_ABOVE) {
    notes.push(
      `Load is ${cpu.load_per_core} per core: timings and timeouts measured now say more about the device than about the code under test.`,
    );
  }
  const limited = cpu.speed_limit_percent !== null && cpu.speed_limit_percent < SPEED_LIMIT_NOTE_BELOW;
  if (limited) {
    notes.push(
      `The processor is held to ${cpu.speed_limit_percent}% of its speed${cpu.thermal_warning === "recorded" ? ", and a thermal warning is recorded" : ""}: ` +
        "work here runs slower than this device's usual pace, and timings measured now include that.",
    );
  } else if (cpu.thermal_warning === "recorded") {
    notes.push("A thermal warning is recorded: work here may run slower than this device's usual pace, and timings measured now include that.");
  }
  const busiest = Math.max(-1, ...gpu.devices.map((device) => device.utilisation_percent ?? -1));
  if (busiest >= GPU_BUSY_NOTE_PERCENT) {
    notes.push(`A graphics device is ${busiest}% busy: a local model or render started now shares it.`);
  }
  // An IPv6-only uplink has no IPv4 default route; the OS's own reach report then says otherwise.
  if (network.default_route === false && network.os_reports !== "reachable") notes.push(WEATHER_NOTE_NO_ROUTE);
  if (network.metered === "likely") notes.push(WEATHER_NOTE_METERED);
  const awake = awakeSeconds(reading);
  if (awake !== null && awake < RECENT_WAKE_NOTE_SECONDS) {
    notes.push(
      `This device woke ${awake} seconds ago from a sleep that began at ${power.last_slept_at}: no session on it could read ` +
        "or answer between those two times, so silence across them means the device slept, not that anyone agreed.",
    );
  }
  return notes;
}

/** Seconds awake since a wake that followed a known sleep; null when either is not known. */
function awakeSeconds(reading: WeatherReading): number | null {
  const { awake_since: since, last_slept_at: slept } = reading.power;
  if (since === null || slept === null) return null;
  const sinceMs = Date.parse(since);
  const sleptMs = Date.parse(slept);
  const atMs = Date.parse(reading.read_at);
  if (![sinceMs, sleptMs, atMs].every(Number.isFinite) || sinceMs <= sleptMs || atMs < sinceMs) return null;
  return Math.floor((atMs - sinceMs) / 1000);
}

const KIND_WORDS: Record<NetworkKind, string> = {
  wifi: "Wi-Fi",
  ethernet: "Ethernet",
  phone_usb: "iPhone USB",
  tunnel: "a tunnel",
  other: "another network link",
  none: "no default route",
};

/** One line in plain words from the fields that were read, ending with how many were not. */
export function weatherSays(reading: WeatherReading): string {
  const { power, cpu, memory, gpu, network } = reading;
  const parts: string[] = [];
  const powerPart = powerPhrase(power);
  if (powerPart) parts.push(powerPart);
  if (power.low_power_mode === true) parts.push("Low Power Mode on");
  if (cpu.load_1m !== null) parts.push(`load ${cpu.load_1m.toFixed(1)}${cpu.cores !== null ? ` on ${cpu.cores} cores` : ""}`);
  if (cpu.speed_limit_percent !== null && cpu.speed_limit_percent < SPEED_LIMIT_NOTE_BELOW) {
    parts.push(`processor held to ${cpu.speed_limit_percent}% of its speed`);
  }
  if (cpu.thermal_warning === "recorded") parts.push("a thermal warning recorded");
  if (memory.pressure !== null) parts.push(`memory pressure ${memory.pressure}`);
  const busy = gpu.devices.map((device) => device.utilisation_percent).filter((value): value is number => value !== null);
  const unread = gpu.devices.length - busy.length;
  if (busy.length > 0) {
    // "Idle" only when every device's use was read: an unread one is not idle.
    const words = unread === 0 && busy.every((value) => value === 0)
      ? "graphics idle"
      : `graphics ${busy.map((value) => `${value}%`).join(", ")} busy`;
    parts.push(unread > 0 ? `${words}, use of ${unread} other ${unread === 1 ? "device" : "devices"} not read` : words);
  }
  const networkWords: string[] = [];
  if (network.kind !== null) networkWords.push(KIND_WORDS[network.kind]);
  else if (network.default_route === true) networkWords.push("a default route");
  else if (network.default_route === false) networkWords.push(KIND_WORDS.none);
  if (network.os_reports !== null) networkWords.push(`route reported ${network.os_reports === "reachable" ? "reachable" : "not reachable"}`);
  if (network.metered === "likely") networkWords.push("likely metered");
  if (networkWords.length > 0) parts.push(networkWords.join(", "));
  const time = `${reading.read_at.slice(11, 19)}Z`;
  const missing = reading.unknown.length;
  const notRead = missing > 0 ? ` ${missing} ${missing === 1 ? "fact" : "facts"} not read.` : "";
  if (parts.length === 0) return `Nothing was read at ${time}.${notRead}`;
  const line = parts.join("; ");
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}. Read ${time}; good for about a minute.${notRead}`;
}

function powerPhrase(power: WeatherReading["power"]): string | null {
  const percent = power.battery_percent;
  const left = power.minutes_remaining !== null ? duration(power.minutes_remaining) : null;
  if (power.source === "battery") {
    return `On battery${percent !== null ? ` at ${percent}%` : ""}${left !== null && power.battery_state !== "charging" ? `, about ${left} left` : ""}`;
  }
  if (power.source === "ac" || power.source === "ups") {
    const on = power.source === "ac" ? "On mains power" : "On UPS power";
    if (percent === null) return on;
    if (power.battery_state === "full") return `${on}, battery full at ${percent}%`;
    if (power.battery_state === "charging") {
      return `${on}, battery ${percent}% and charging${left !== null && power.minutes_remaining! > 0 ? `, about ${left} to full` : ""}`;
    }
    return `${on}, battery ${percent}%`;
  }
  return percent !== null ? `battery ${percent}%` : null;
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

// ---------------------------------------------------------------------------
// The switch, and the compact block collab_arrive shows

/** Both spellings are read, as for the tools profile and the consent rule. */
export const WEATHER_VARIABLES = ["AGENTOOL_COLLAB_WEATHER", "AGENTTOOL_COLLAB_WEATHER"] as const;
export type WeatherSwitch = "on" | "off";

/**
 * Whether collab_arrive volunteers a reading. The device is the person's, so
 * absent or empty is off. An unknown value, or two spellings that disagree,
 * refuses to start rather than guess what the host meant to share.
 */
export function weatherSwitch(environment: Record<string, string | undefined>): WeatherSwitch {
  const values = WEATHER_VARIABLES
    .map((name) => ({ name, value: environment[name] }))
    .filter((entry): entry is { name: (typeof WEATHER_VARIABLES)[number]; value: string } =>
      entry.value !== undefined && entry.value !== "");
  for (const { name, value } of values) {
    if (value !== "on" && value !== "off") {
      throw new CollabError("invalid_weather_switch", `${name} must be on | off, not ${JSON.stringify(value)}`);
    }
  }
  if (values.length === 2 && values[0]!.value !== values[1]!.value) {
    throw new CollabError(
      "conflicting_weather_switch",
      "AGENTOOL_COLLAB_WEATHER and AGENTTOOL_COLLAB_WEATHER disagree; set one of them to on | off",
    );
  }
  return (values[0]?.value as WeatherSwitch | undefined) ?? "off";
}

/** The part of a reading collab_arrive shows. */
export function weatherBrief(reading: WeatherReading): Record<string, unknown> {
  return {
    read_at: reading.read_at,
    good_for_seconds: reading.good_for_seconds,
    says: reading.says,
    notes: [...reading.notes],
    not_read: reading.unknown.length,
    basis: reading.basis,
    authorises: reading.authorises,
    every_field: WEATHER_EVERY_FIELD,
  };
}

/**
 * The block for an arrival. A reader that throws or overruns gives
 * `{unavailable}` with a fixed reason, never its error text, and the arrival
 * goes on exactly as it would have.
 */
export async function arrivalWeather(
  read: WeatherReader,
  limitMs: number = WEATHER_ARRIVAL_LIMIT_MS,
): Promise<Record<string, unknown>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      Promise.resolve().then(read).then((reading) => ({ reading })),
      new Promise<{ late: true }>((resolve) => {
        timer = setTimeout(() => resolve({ late: true }), limitMs);
      }),
    ]);
    if ("late" in outcome) return { unavailable: `the reading took longer than ${limitMs} ms` };
    return weatherBrief(outcome.reading);
  } catch {
    return { unavailable: "the reading failed" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function wholeOf(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (!/^\d{1,15}$/.test(text)) return null;
  return Number(text);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
