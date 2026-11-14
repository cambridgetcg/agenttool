import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import {
  arrivalWeather,
  DARWIN_WEATHER_COMMANDS,
  GPU_BUSY_NOTE_PERCENT,
  interfaceKind,
  isHotspotGateway,
  LOAD_PER_CORE_NOTE_ABOVE,
  parseHardwarePorts,
  parseIoreg,
  parsePmsetBattery,
  parsePmsetSettings,
  parsePmsetThermal,
  parseReach,
  parseRoute,
  parseSysctl,
  portKind,
  readWeather,
  RECENT_WAKE_NOTE_SECONDS,
  spawnWeatherCommand,
  WEATHER_AUTHORISES,
  WEATHER_BASIS,
  WEATHER_COMMAND_ENV,
  WEATHER_EVERY_FIELD,
  WEATHER_GOOD_FOR_SECONDS,
  WEATHER_NOTE_LOW_POWER,
  WEATHER_NOTE_METERED,
  WEATHER_NOTE_NO_ROUTE,
  WEATHER_NOTE_ON_BATTERY,
  WEATHER_PROTOCOL,
  WEATHER_VARIABLES,
  weatherBrief,
  WeatherCommandFailure,
  weatherNotes,
  weatherSays,
  weatherSwitch,
  type WeatherDeps,
  type WeatherReading,
  type WeatherRunner,
} from "../src/weather.js";

// Device weather (PROTOCOL.md "Device weather"). Every test injects command
// output, the clock and node:os, so none runs a real command or depends on the
// machine it runs on; CI runs on Linux.
//
// tests/fixtures/weather/darwin-*.txt were captured on a Mac with Apple silicon, with
// the reading's own commands and sanitised before commit: the gateway and
// interface address are in 192.0.2.0/24, the hardware addresses are in the
// 00:00:5e:00:53:00 documentation block, the boot, sleep and wake times, the
// battery's registry id and the programs in the sleep clause are made up, and
// ioreg's report legend is trimmed to two channels.

const FIXTURES = join(import.meta.dir, "fixtures", "weather");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const AT = new Date("2026-11-12T10:00:00.000Z");
const OS = {
  loadavg: () => [8.4, 6.1, 5.02],
  totalmem: () => 16 * 1024 ** 3,
  cpus: () => Array.from({ length: 8 }, () => ({})),
};

type CommandKey = keyof typeof DARWIN_WEATHER_COMMANDS;
type Fake =
  | { stdout?: string; stderr?: string; exit_code?: number | null }
  | { fail: string }
  | { hang: true }
  | { throws: unknown };

const CAPTURED: Record<CommandKey, Fake> = {
  battery: { stdout: fixture("darwin-pmset-batt.txt") },
  settings: { stdout: fixture("darwin-pmset-g.txt") },
  thermal: { stdout: fixture("darwin-pmset-therm.txt") },
  sysctl: { stdout: fixture("darwin-sysctl.txt") },
  graphics: { stdout: fixture("darwin-ioreg.txt") },
  route: { stdout: fixture("darwin-route.txt") },
  ports: { stdout: fixture("darwin-networksetup.txt") },
  reach: { stdout: fixture("darwin-scutil-nwi.txt") },
};

/** A runner that answers each spec command from `outputs` and records what it was asked. */
function runner(outputs: Partial<Record<CommandKey, Fake>>, calls: Array<{ file: string; args: string[] }> = []): WeatherRunner {
  const byCommand = new Map(
    (Object.entries(DARWIN_WEATHER_COMMANDS) as Array<[CommandKey, { file: string; args: readonly string[] }]>)
      .map(([key, command]) => [`${command.file} ${command.args.join(" ")}`, key]),
  );
  return async (file, args) => {
    calls.push({ file, args: [...args] });
    const key = byCommand.get(`${file} ${args.join(" ")}`);
    const fake = key ? outputs[key] : undefined;
    if (!fake) throw new WeatherCommandFailure("could not be started (ENOENT)");
    if ("fail" in fake) throw new WeatherCommandFailure(fake.fail);
    if ("hang" in fake) return new Promise(() => {});
    if ("throws" in fake) throw fake.throws;
    return { stdout: fake.stdout ?? "", stderr: fake.stderr ?? "", exit_code: fake.exit_code === undefined ? 0 : fake.exit_code };
  };
}

function darwin(outputs: Partial<Record<CommandKey, Fake>> = {}, extra: Partial<WeatherDeps> = {}) {
  return readWeather({ platform: "darwin", now: () => AT, os: OS, run: runner({ ...CAPTURED, ...outputs }), ...extra });
}

const unknownOf = (reading: WeatherReading, what: string) => reading.unknown.find((entry) => entry.what === what)?.why;
const inferredOf = (reading: WeatherReading, what: string) => reading.inferred.filter((entry) => entry.what === what);

const IN_USE = 288_768_000;
const SWAP = Math.round(4278.62 * 1024 ** 2);

describe("a reading from output captured on a Mac", () => {
  test("reads every field the commands give, with how each is known", async () => {
    const reading = await darwin();
    expect(reading).toMatchObject({
      protocol: WEATHER_PROTOCOL,
      read_at: "2026-11-12T10:00:00.000Z",
      good_for_seconds: WEATHER_GOOD_FOR_SECONDS,
      platform: "darwin",
      basis: WEATHER_BASIS,
      authorises: WEATHER_AUTHORISES,
    });
    expect(reading.power).toEqual({
      source: "battery",
      battery_percent: 89,
      battery_state: "discharging",
      minutes_remaining: 314,
      low_power_mode: false,
      sleep_prevented: true,
      awake_since: "2026-11-12T07:30:00.167Z",
      last_slept_at: "2026-11-12T06:00:00.562Z",
    });
    expect(reading.cpu).toEqual({
      chip: "Apple M2",
      cores: 8,
      performance_cores: 4,
      efficiency_cores: 4,
      load_1m: 8.4,
      load_5m: 6.1,
      load_15m: 5.02,
      load_per_core: 1.05,
      thermal_warning: "none",
      speed_limit_percent: null,
    });
    expect(reading.memory).toEqual({ total_bytes: 16 * 1024 ** 3, pressure: "warn", swap_used_bytes: SWAP });
    expect(reading.gpu).toEqual({
      devices: [{ model: "Apple M2", utilisation_percent: 4, memory_in_use_bytes: IN_USE }],
      shares_system_memory: true,
    });
    expect(reading.network).toEqual({ default_route: true, kind: "wifi", os_reports: "reachable", metered: null });
    expect(inferredOf(reading, "gpu.shares_system_memory")).toHaveLength(1);
    expect(reading.unknown.map((entry) => entry.what).sort()).toEqual(["cpu.speed_limit_percent", "network.metered"]);
    expect(unknownOf(reading, "network.metered")).toContain("Low Data Mode");
    expect(unknownOf(reading, "cpu.speed_limit_percent")).toContain("no CPU power status");
    expect(reading.says).toBe(
      "On battery at 89%, about 5 h 14 min left; load 8.4 on 8 cores; memory pressure warn; graphics 4% busy; " +
        "Wi-Fi, route reported reachable. Read 10:00:00Z; good for about a minute. 2 facts not read.",
    );
    expect(reading.notes).toEqual([
      WEATHER_NOTE_ON_BATTERY,
      "Memory pressure is warn: more parallel processes will be slow for everyone on this device.",
      "Load is 1.05 per core: timings and timeouts measured now say more about the device than about the code under test.",
    ]);
  });

  test("runs exactly the spec's commands: absolute paths, fixed arguments", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    await readWeather({ platform: "darwin", now: () => AT, os: OS, run: runner(CAPTURED, calls) });
    expect(calls.map((call) => [call.file, ...call.args].join(" ")).sort()).toEqual([
      "/sbin/route -n get default",
      "/usr/bin/pmset -g",
      "/usr/bin/pmset -g batt",
      "/usr/bin/pmset -g therm",
      "/usr/sbin/ioreg -r -d 1 -w 0 -c IOAccelerator",
      "/usr/sbin/networksetup -listallhardwareports",
      "/usr/sbin/scutil --nwi",
      "/usr/sbin/sysctl machdep.cpu.brand_string hw.ncpu hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu " +
        "kern.memorystatus_vm_pressure_level vm.swapusage kern.boottime kern.sleeptime kern.waketime",
    ]);
    expect(WEATHER_COMMAND_ENV).toEqual({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" });
    // pmset -g log is never read.
    expect(calls.some((call) => call.args.includes("log"))).toBe(false);
  });
});

describe("pmset -g batt", () => {
  test("a desktop on mains with no battery", async () => {
    expect(parsePmsetBattery("Now drawing from 'AC Power'\n")).toEqual({ source: "ac", battery: null });
    const reading = await darwin({ battery: { stdout: "Now drawing from 'AC Power'\n" } });
    expect(reading.power).toMatchObject({ source: "ac", battery_percent: null, battery_state: null, minutes_remaining: null });
    for (const field of ["power.battery_percent", "power.battery_state", "power.minutes_remaining"]) {
      expect(unknownOf(reading, field)).toBe("pmset -g batt reports no internal battery");
    }
    expect(reading.says).toStartWith("On mains power; ");
    expect(reading.notes).not.toContain(WEATHER_NOTE_ON_BATTERY);
  });

  test("charging, with no estimate, charged, held at a limit, and on a UPS", async () => {
    const line = (rest: string) => `Now drawing from 'AC Power'\n -InternalBattery-0 (id=4242)\t${rest} present: true\n`;
    expect(parsePmsetBattery(line("78%; charging; 1:05 remaining")).battery).toMatchObject({ percent: 78, state: "charging", minutes: 65 });
    const charging = await darwin({ battery: { stdout: line("78%; charging; 1:05 remaining") } });
    expect(charging.says).toStartWith("On mains power, battery 78% and charging, about 1 h 5 min to full; ");

    const noEstimate = await darwin({ battery: { stdout: line("78%; charging; (no estimate)") } });
    expect(noEstimate.power).toMatchObject({ battery_percent: 78, battery_state: "charging", minutes_remaining: null });
    expect(unknownOf(noEstimate, "power.minutes_remaining")).toBe("macOS has no estimate yet");

    const charged = await darwin({ battery: { stdout: line("100%; charged; 0:00 remaining") } });
    expect(charged.power).toMatchObject({ source: "ac", battery_percent: 100, battery_state: "full", minutes_remaining: 0 });
    expect(charged.says).toStartWith("On mains power, battery full at 100%; ");

    const held = await darwin({ battery: { stdout: line("80%; AC attached; not charging") } });
    expect(held.power.battery_state).toBeNull();
    expect(unknownOf(held, "power.battery_state")).toContain("neither charging, discharging nor full");

    expect(parsePmsetBattery("Now drawing from 'UPS Power'\n").source).toBe("ups");
    expect(parsePmsetBattery("Now drawing from 'Solar Power'\n").source).toBeNull();
  });
});

describe("pmset -g", () => {
  const settings = (lowPower: string, sleep: string) =>
    ` standby              0\n Sleep On Power Button 1\n disksleep            10\n sleep                ${sleep}\n` +
    ` displaysleep         10 (display sleep prevented by sample-app)\n${lowPower}`;

  test("Low Power Mode on, and a sleep line with no prevention clause", async () => {
    expect(parsePmsetSettings(settings(" lowpowermode         1\n", "1"))).toEqual({ low_power_mode: true, sleep_prevented: false });
    const reading = await darwin({ settings: { stdout: settings(" lowpowermode         1\n", "1") } });
    expect(reading.power).toMatchObject({ low_power_mode: true, sleep_prevented: false });
    expect(reading.notes).toContain(WEATHER_NOTE_LOW_POWER);
    expect(reading.says).toContain("Low Power Mode on");
  });

  test("a device with no lowpowermode line leaves it unknown, never false", async () => {
    const reading = await darwin({ settings: { stdout: settings("", "1 (sleep prevented by sample-app)") } });
    expect(reading.power).toMatchObject({ low_power_mode: null, sleep_prevented: true });
    expect(unknownOf(reading, "power.low_power_mode")).toContain("no lowpowermode line");
  });
});

describe("pmset -g therm", () => {
  test("CPU_Speed_Limit = 80 is a limit; only the recorded-nothing sentence reads as none", async () => {
    const intel =
      "Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded\n" +
      "2026-11-12 09:59:58 +0000 CPU Power notify\n\tCPU_Scheduler_Limit \t= 100\n\tCPU_Available_CPUs \t= 8\n\tCPU_Speed_Limit \t= 80\n";
    expect(parsePmsetThermal(intel)).toEqual({ thermal_warning: "none", speed_limit_percent: 80, no_cpu_status: false });
    const reading = await darwin({ thermal: { stdout: intel } });
    expect(reading.cpu).toMatchObject({ thermal_warning: "none", speed_limit_percent: 80 });
    expect(reading.notes.some((note) => note.startsWith("The processor is held to 80% of its speed"))).toBe(true);
    expect(reading.says).toContain("processor held to 80% of its speed");
  });

  test("anything else is unknown rather than guessed", async () => {
    const reading = await darwin({ thermal: { stdout: "Thermal warning level: 3\n" } });
    expect(reading.cpu).toMatchObject({ thermal_warning: null, speed_limit_percent: null });
    expect(unknownOf(reading, "cpu.thermal_warning")).toContain("nothing this build recognises");
    expect(unknownOf(reading, "cpu.speed_limit_percent")).toBe("pmset -g therm printed no CPU_Speed_Limit");
  });
});

describe("sysctl", () => {
  const sysctl = (patch: Record<string, string | null>) => {
    const lines = fixture("darwin-sysctl.txt").split("\n").filter(Boolean);
    const out: string[] = [];
    for (const line of lines) {
      const key = line.slice(0, line.indexOf(":"));
      if (!(key in patch)) out.push(line);
      else if (patch[key] !== null) out.push(`${key}: ${patch[key]}`);
    }
    return out.join("\n") + "\n";
  };

  test("each pressure level, and one with no word", async () => {
    for (const [level, word] of [["1", "normal"], ["2", "warn"], ["4", "critical"]] as const) {
      const reading = await darwin({ sysctl: { stdout: sysctl({ "kern.memorystatus_vm_pressure_level": level }) } });
      expect(reading.memory.pressure).toBe(word);
      expect(reading.notes.some((note) => note.startsWith("Memory pressure is"))).toBe(word !== "normal");
    }
    const odd = await darwin({ sysctl: { stdout: sysctl({ "kern.memorystatus_vm_pressure_level": "3" }) } });
    expect(odd.memory.pressure).toBeNull();
    expect(unknownOf(odd, "memory.pressure")).toContain("no word for");
  });

  test("swap usage in each unit", async () => {
    expect(parseSysctl("vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)\n")["vm.swapusage"])
      .toContain("used = 1024.50M");
    for (const [used, bytes] of [["1024.50M", 1024.5 * 1024 ** 2], ["512.00K", 512 * 1024], ["1.50G", 1.5 * 1024 ** 3]] as const) {
      const reading = await darwin({ sysctl: { stdout: sysctl({ "vm.swapusage": `total = 4.00G  used = ${used}  free = 1.00G  (encrypted)` }) } });
      expect(reading.memory.swap_used_bytes).toBe(Math.round(bytes));
    }
    const garbled = await darwin({ sysctl: { stdout: sysctl({ "vm.swapusage": "total = ?" }) } });
    expect(garbled.memory.swap_used_bytes).toBeNull();
    expect(unknownOf(garbled, "memory.swap_used_bytes")).toBe("sysctl's vm.swapusage line is not in a form this build reads");
  });

  test("a missing key costs only its own field, though sysctl exits 1", async () => {
    const intel = sysctl({
      "machdep.cpu.brand_string": "Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz",
      "hw.ncpu": "12",
      "hw.perflevel0.physicalcpu": null,
      "hw.perflevel1.physicalcpu": null,
      "vm.swapusage": "total = 2048.00M  used = 0.00M  free = 2048.00M  (encrypted)",
    });
    const reading = await darwin({
      sysctl: { stdout: intel, stderr: "sysctl: unknown oid 'hw.perflevel0.physicalcpu'\n", exit_code: 1 },
    });
    expect(reading.cpu).toMatchObject({ chip: "Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz", cores: 12, performance_cores: null, efficiency_cores: null });
    expect(reading.memory.swap_used_bytes).toBe(0);
    expect(unknownOf(reading, "cpu.performance_cores")).toContain("sysctl did not report hw.perflevel0.physicalcpu");
    expect(reading.power.awake_since).toBe("2026-11-12T07:30:00.167Z");
  });

  test("a device that has not slept since boot: last_slept_at is null and is not unknown", async () => {
    const reading = await darwin({
      sysctl: { stdout: sysctl({ "kern.sleeptime": "{ sec = 0, usec = 0 } Thu Jan  1 00:00:00 1970", "kern.waketime": "{ sec = 0, usec = 0 } Thu Jan  1 00:00:00 1970" }) },
    });
    expect(reading.power).toMatchObject({ awake_since: "2026-11-01T08:00:00.211Z", last_slept_at: null });
    expect(unknownOf(reading, "power.last_slept_at")).toBeUndefined();
  });
});

describe("ioreg", () => {
  const accelerator = (name: string, ioClass: string, properties: string) =>
    `+-o ${name}  <class ${ioClass}, id 0x100000abc, registered, matched, active, busy 0 (1 ms), retain 9>\n    {\n` +
    `      "IOClass" = "${ioClass}"\n${properties}    }\n    \n`;

  test("two accelerators, neither Apple silicon: no memory judgement", async () => {
    const two =
      accelerator("IntelAccelerator", "IntelAccelerator", `      "PerformanceStatistics" = {"Device Utilization %"=12,"In use system memory"=104857600}\n`) +
      accelerator("AMDRadeonX6000", "AMDRadeonX6000_AMDNavi14GraphicsAccelerator",
        `      "model" = <"AMD Radeon Pro 5500M">\n      "PerformanceStatistics" = {"Device Utilization %"=85,"vramUsedBytes"=1073741824}\n`);
    expect(parseIoreg(two).map((device) => device.apple_graphics)).toEqual([false, false]);
    const reading = await darwin({ graphics: { stdout: two } });
    expect(reading.gpu.devices).toEqual([
      { model: null, utilisation_percent: 12, memory_in_use_bytes: 104_857_600 },
      { model: "AMD Radeon Pro 5500M", utilisation_percent: 85, memory_in_use_bytes: null },
    ]);
    expect(reading.gpu.shares_system_memory).toBeNull();
    expect(unknownOf(reading, "gpu.shares_system_memory")).toContain("only Apple silicon graphics");
    expect(unknownOf(reading, "gpu.devices[0].model")).toBe('ioreg showed no "model" for this device');
    expect(unknownOf(reading, "gpu.devices[1].memory_in_use_bytes")).toBe('ioreg showed no "In use system memory" for this device');
    expect(reading.says).toContain("graphics 12%, 85% busy");
    expect(reading.notes).toContain(`A graphics device is 85% busy: a local model or render started now shares it.`);
  });

  test("the legend's channel name is not read as a value", () => {
    const [device] = parseIoreg(fixture("darwin-ioreg.txt"));
    expect(device).toEqual({ model: "Apple M2", utilisation_percent: 4, memory_in_use_bytes: IN_USE, apple_graphics: true });
  });

  test("no accelerator listed is a reading, not an unknown", async () => {
    const reading = await darwin({ graphics: { stdout: "" } });
    expect(reading.gpu.devices).toEqual([]);
    expect(unknownOf(reading, "gpu.devices")).toBeUndefined();
    expect(unknownOf(reading, "gpu.shares_system_memory")).toBe("ioreg lists no graphics device");
  });
});

describe("the network", () => {
  const route = (iface: string, gateway = "192.0.2.1") =>
    `   route to: default\ndestination: default\n       mask: default\n    gateway: ${gateway}\n  interface: ${iface}\n` +
    "      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>\n";
  const ports = (...entries: Array<[string, string]>) =>
    entries.map(([port, device], index) => `\nHardware Port: ${port}\nDevice: ${device}\nEthernet Address: 00:00:5e:00:53:${String(10 + index).padStart(2, "0")}\n`).join("") +
    "\nVLAN Configurations\n===================\n";
  const reach = (v4: string, v6: string) =>
    `Network information\n\nIPv4 network interface information\n   REACH : flags ${v4}\n\nIPv6 network interface information\n` +
    `   No IPv6 states found\n   REACH : flags ${v6}\n\nNetwork interfaces: en0\n`;

  test("no default route: kind none, and the note only when the OS reports no reach", async () => {
    expect(parseRoute("", "route: writing to routing socket: not in table\n")).toEqual({ kind: "none" });
    const off = await darwin({
      route: { stderr: "route: writing to routing socket: not in table\n" },
      reach: { stdout: reach("0x00000000 (Not Reachable)", "0x00000000 (Not Reachable)") },
    });
    expect(off.network).toEqual({ default_route: false, kind: "none", os_reports: "not_reachable", metered: null });
    expect(off.notes).toContain(WEATHER_NOTE_NO_ROUTE);
    expect(off.says).toContain("no default route, route reported not reachable");
    // An IPv6-only uplink has no IPv4 default route, and the OS's own reach report says so.
    const v6 = await darwin({
      route: { stderr: "route: writing to routing socket: not in table\n" },
      reach: { stdout: reach("0x00000000 (Not Reachable)", "0x00000002 (Reachable)") },
    });
    expect(v6.network.default_route).toBe(false);
    expect(v6.notes).not.toContain(WEATHER_NOTE_NO_ROUTE);
  });

  test("each hardware port kind", async () => {
    expect(portKind("Wi-Fi")).toBe("wifi");
    expect(portKind("Ethernet")).toBe("ethernet");
    expect(portKind("Ethernet Adapter (en3)")).toBe("ethernet");
    expect(portKind("USB 10/100/1000 LAN")).toBe("ethernet");
    expect(portKind("Thunderbolt Ethernet Slot 0")).toBe("ethernet");
    expect(portKind("iPhone USB")).toBe("phone_usb");
    expect(portKind("Thunderbolt Bridge")).toBe("other");
    expect(portKind("Bluetooth PAN")).toBe("other");
    const list = ports(["Wi-Fi", "en0"], ["USB 10/100/1000 LAN", "en7"], ["iPhone USB", "en9"], ["Thunderbolt Bridge", "bridge0"]);
    expect(parseHardwarePorts(list).get("en7")).toBe("USB 10/100/1000 LAN");
    const kinds: Record<string, string> = { en0: "wifi", en7: "ethernet", en9: "phone_usb", bridge0: "other", en5: "other" };
    for (const [iface, kind] of Object.entries(kinds)) {
      const reading = await darwin({ route: { stdout: route(iface) }, ports: { stdout: list } });
      expect(reading.network.kind).toBe(kind as WeatherReading["network"]["kind"]);
    }
    const phone = await darwin({ route: { stdout: route("en9") }, ports: { stdout: list } });
    expect(phone.network.metered).toBe("likely");
    expect(inferredOf(phone, "network.metered")[0]!.from).toContain("iPhone USB");
    expect(phone.notes).toContain(WEATHER_NOTE_METERED);
    expect(phone.says).toContain("iPhone USB, route reported reachable, likely metered");
  });

  test("a tunnel as the default route needs no port list", async () => {
    for (const iface of ["utun4", "ipsec0", "ppp0", "wg0"]) expect(interfaceKind(iface, null)).toBe("tunnel");
    const reading = await darwin({ route: { stdout: route("utun4") }, ports: { fail: "could not be started (ENOENT)" } });
    expect(reading.network).toMatchObject({ default_route: true, kind: "tunnel" });
    const unlisted = await darwin({ route: { stdout: route("en0") }, ports: { fail: "could not be started (ENOENT)" } });
    expect(unlisted.network.kind).toBeNull();
    expect(unknownOf(unlisted, "network.kind")).toBe("networksetup -listallhardwareports could not be started (ENOENT)");
  });

  test("a Personal Hotspot gateway is a positive inference; elsewhere metered stays unknown", async () => {
    expect(isHotspotGateway("172.20.10.1")).toBe(true);
    expect(isHotspotGateway("172.20.10.15")).toBe(true);
    expect(isHotspotGateway("172.20.10.16")).toBe(false);
    expect(isHotspotGateway("172.20.11.1")).toBe(false);
    expect(isHotspotGateway("fe80::1%en0")).toBe(false);
    const hotspot = await darwin({ route: { stdout: route("en0", "172.20.10.1") } });
    expect(hotspot.network).toMatchObject({ kind: "wifi", metered: "likely" });
    expect(inferredOf(hotspot, "network.metered")[0]!.from).toContain("172.20.10.0/28");
    expect(JSON.stringify(hotspot)).not.toContain("172.20.10.1");
    const home = await darwin({ route: { stdout: route("en0", "192.0.2.1") } });
    expect(home.network.metered).toBeNull();
    expect(unknownOf(home, "network.metered")).toContain("does not show");
  });

  test("the reach flags", () => {
    expect(parseReach(reach("0x00000002 (Reachable)", "0x00000000 (Not Reachable)"))).toBe("reachable");
    expect(parseReach(reach("0x00000000 (Not Reachable)", "0x00000000 (Not Reachable)"))).toBe("not_reachable");
    expect(parseReach(reach("0x00000000 (Not Reachable)", "0x00000002 (Reachable)"))).toBe("reachable");
    expect(parseReach(reach("0x00000007 (Reachable,Transient Connection,Connection Required)", "0x00000000 (Not Reachable)"))).toBe("reachable");
    expect(parseReach("Network information\n")).toBeNull();
  });
});

describe("privacy: kinds, never identifiers", () => {
  const SECRETS = [
    "192.0.2.77", "00:00:5e:00:53:af", "Harbour-Guest-5G", "example-host.local",
    "SecretEditor", "PrivateNotes", "9876543", "fLastSubmissionPID", "AGXAcceleratorG14G", "en0",
  ];
  const leaky: Partial<Record<CommandKey, Fake>> = {
    battery: { stdout: "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=9876543)\t41%; discharging; 2:10 remaining present: true\n" },
    settings: { stdout: " sleep                1 (sleep prevented by SecretEditor, PrivateNotes, powerd)\n lowpowermode         0\n" },
    route: {
      stdout: "   route to: default\ndestination: default\n    gateway: 192.0.2.77\n  interface: en0\n  host: example-host.local\n",
    },
    ports: { stdout: "\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 00:00:5e:00:53:af\nNetwork: Harbour-Guest-5G\n" },
    reach: { stdout: "     en0 : flags : 0x5 (IPv4,DNS)\n  address : 192.0.2.77\n  ssid : Harbour-Guest-5G\n   REACH : flags 0x00000002 (Reachable)\n" },
  };

  test("the serialised reading and the arrive block hold none of them", async () => {
    const reading = await darwin(leaky);
    expect(reading.power).toMatchObject({ source: "battery", battery_percent: 41, sleep_prevented: true });
    expect(reading.network).toMatchObject({ default_route: true, kind: "wifi", os_reports: "reachable" });
    const serialised = JSON.stringify(reading);
    const brief = JSON.stringify(weatherBrief(reading));
    for (const secret of SECRETS) {
      expect(serialised).not.toContain(secret);
      expect(brief).not.toContain(secret);
    }
  });

  test("a failing command's own text is never echoed", async () => {
    const reading = await darwin({
      route: { throws: new Error("route failed near Harbour-Guest-5G on example-host.local") },
      ports: { stdout: "garbage from 192.0.2.77", exit_code: 2, stderr: "example-host.local" },
    });
    expect(unknownOf(reading, "network.default_route")).toBe("route -n get default failed");
    const serialised = JSON.stringify(reading);
    for (const secret of SECRETS) expect(serialised).not.toContain(secret);
  });
});

describe("failure costs only the fields a command feeds", () => {
  test("one command failing leaves the others intact and names its reason", async () => {
    const reading = await darwin({ battery: { fail: "did not finish within 1500 ms" } });
    for (const field of ["power.source", "power.battery_percent", "power.battery_state", "power.minutes_remaining"]) {
      expect(unknownOf(reading, field)).toBe("pmset -g batt did not finish within 1500 ms");
    }
    expect(reading.power.sleep_prevented).toBe(true);
    expect(reading.cpu.chip).toBe("Apple M2");
    expect(reading.network.kind).toBe("wifi");
    const status = await darwin({ thermal: { stdout: "", exit_code: 1 } });
    expect(unknownOf(status, "cpu.thermal_warning")).toBe("pmset -g therm exited with status 1");
  });

  test("every command failing still returns a reading with node:os facts", async () => {
    const reading = await readWeather({ platform: "darwin", now: () => AT, os: OS, run: runner({}) });
    expect(reading.cpu).toMatchObject({ cores: 8, load_1m: 8.4, load_per_core: 1.05, chip: null });
    expect(reading.memory.total_bytes).toBe(16 * 1024 ** 3);
    expect(reading.network).toEqual({ default_route: null, kind: null, os_reports: null, metered: null });
    expect(unknownOf(reading, "power.source")).toBe("pmset -g batt could not be started (ENOENT)");
    expect(unknownOf(reading, "gpu.devices")).toBe("ioreg could not be started (ENOENT)");
    expect(reading.says).toBe(`Load 8.4 on 8 cores. Read 10:00:00Z; good for about a minute. ${reading.unknown.length} facts not read.`);
    // Every null field is explained.
    for (const [group, fields] of Object.entries({ power: reading.power, cpu: reading.cpu, memory: reading.memory, network: reading.network })) {
      for (const [key, value] of Object.entries(fields)) {
        if (value === null) expect(unknownOf(reading, `${group}.${key}`)).toBeString();
      }
    }
  });

  test("a command that never returns is cut off by the deadline", async () => {
    const started = performance.now();
    const reading = await darwin({ graphics: { hang: true } }, { deadline_ms: 40 });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(unknownOf(reading, "gpu.devices")).toBe("ioreg was still running at the 40 ms deadline");
    expect(reading.cpu.chip).toBe("Apple M2");
    expect(reading.power.battery_percent).toBe(89);
  });

  test("nothing throws: a broken clock, node:os, runner or output", async () => {
    const broken = await readWeather({
      platform: "darwin",
      now: () => { throw new Error("no clock"); },
      os: { loadavg: () => { throw new Error("x"); }, totalmem: () => { throw new Error("x"); }, cpus: () => { throw new Error("x"); } },
      run: (() => { throw new Error("sync"); }) as unknown as WeatherRunner,
    });
    expect(broken.protocol).toBe(WEATHER_PROTOCOL);
    expect(Number.isFinite(Date.parse(broken.read_at))).toBe(true);
    expect(unknownOf(broken, "power.source")).toBe("pmset -g batt failed");
    const garbage = await readWeather({ platform: "darwin", now: () => AT, os: OS, run: (async () => null) as unknown as WeatherRunner });
    expect(garbage.unknown.length).toBeGreaterThan(10);
  });

  test("the real runner refuses before starting once the deadline has passed, and reports a missing program by code", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(spawnWeatherCommand("/usr/bin/pmset", ["-g"], { timeout_ms: 10, max_bytes: 10, signal: aborted.signal }))
      .rejects.toThrow("was not started: the deadline had passed");
    // No such program exists, so nothing runs.
    const missing = spawnWeatherCommand("/nonexistent/agenttool-weather-probe", [], {
      timeout_ms: 1_000,
      max_bytes: 1_024,
      signal: new AbortController().signal,
    });
    await expect(missing).rejects.toBeInstanceOf(WeatherCommandFailure);
    await expect(missing).rejects.toThrow(/could not be started|was ended/);
  });
});

/** A reading built by hand, every field read and calm. */
function calm(patch: (reading: WeatherReading) => void = () => {}): WeatherReading {
  const reading: WeatherReading = {
    protocol: WEATHER_PROTOCOL,
    read_at: AT.toISOString(),
    good_for_seconds: WEATHER_GOOD_FOR_SECONDS,
    platform: "darwin",
    basis: WEATHER_BASIS,
    authorises: WEATHER_AUTHORISES,
    says: "",
    notes: [],
    power: {
      source: "ac", battery_percent: 100, battery_state: "full", minutes_remaining: 0, low_power_mode: false,
      sleep_prevented: false, awake_since: "2026-11-12T07:30:00.000Z", last_slept_at: "2026-11-12T06:00:00.000Z",
    },
    cpu: {
      chip: "Apple M2", cores: 8, performance_cores: 4, efficiency_cores: 4, load_1m: 2, load_5m: 2, load_15m: 2,
      load_per_core: 0.25, thermal_warning: "none", speed_limit_percent: 100,
    },
    memory: { total_bytes: 16 * 1024 ** 3, pressure: "normal", swap_used_bytes: 0 },
    gpu: { devices: [{ model: "Apple M2", utilisation_percent: 0, memory_in_use_bytes: 1 }], shares_system_memory: true },
    network: { default_route: true, kind: "ethernet", os_reports: "reachable", metered: null },
    inferred: [],
    unknown: [],
  };
  patch(reading);
  return reading;
}

describe("notes", () => {
  test("a calm device has none", () => {
    expect(weatherNotes(calm())).toEqual([]);
  });

  test("each condition gives its note, and stops just short of its threshold", () => {
    const one = (patch: (reading: WeatherReading) => void) => weatherNotes(calm(patch));
    expect(one((r) => { r.power.source = "battery"; })).toEqual([WEATHER_NOTE_ON_BATTERY]);
    expect(one((r) => { r.power.low_power_mode = true; })).toEqual([WEATHER_NOTE_LOW_POWER]);
    expect(one((r) => { r.memory.pressure = "critical"; })).toEqual([
      "Memory pressure is critical: more parallel processes will be slow for everyone on this device.",
    ]);
    expect(one((r) => { r.cpu.load_per_core = LOAD_PER_CORE_NOTE_ABOVE; })).toEqual([]);
    expect(one((r) => { r.cpu.load_per_core = 1.01; })).toHaveLength(1);
    expect(one((r) => { r.cpu.speed_limit_percent = 99; })[0]).toStartWith("The processor is held to 99% of its speed:");
    expect(one((r) => { r.cpu.thermal_warning = "recorded"; })[0]).toStartWith("A thermal warning is recorded:");
    expect(one((r) => { r.gpu.devices[0]!.utilisation_percent = GPU_BUSY_NOTE_PERCENT - 1; })).toEqual([]);
    expect(one((r) => { r.gpu.devices[0]!.utilisation_percent = GPU_BUSY_NOTE_PERCENT; })).toEqual([
      "A graphics device is 80% busy: a local model or render started now shares it.",
    ]);
    expect(one((r) => { r.network.default_route = false; r.network.kind = "none"; r.network.os_reports = "not_reachable"; }))
      .toEqual([WEATHER_NOTE_NO_ROUTE]);
    expect(one((r) => { r.network.metered = "likely"; })).toEqual([WEATHER_NOTE_METERED]);
    // Unknowns never raise a note.
    expect(one((r) => { r.power.source = null; r.memory.pressure = null; r.network.default_route = null; })).toEqual([]);
  });

  test("a wake shorter than the shortest consultation window, after a known sleep", () => {
    const wokeAgo = (seconds: number) => (r: WeatherReading) => {
      r.power.last_slept_at = "2026-11-12T08:00:00.000Z";
      r.power.awake_since = new Date(AT.getTime() - seconds * 1000).toISOString();
    };
    expect(RECENT_WAKE_NOTE_SECONDS).toBe(600);
    const recent = weatherNotes(calm(wokeAgo(300)));
    expect(recent).toEqual([
      "This device woke 300 seconds ago from a sleep that began at 2026-11-12T08:00:00.000Z: no session on it could read " +
        "or answer between those two times, so silence across them means the device slept, not that anyone agreed.",
    ]);
    expect(weatherNotes(calm(wokeAgo(600)))).toEqual([]);
    // Awake since boot with no sleep since: nothing to say.
    expect(weatherNotes(calm((r) => { r.power.last_slept_at = null; r.power.awake_since = new Date(AT.getTime() - 60_000).toISOString(); }))).toEqual([]);
  });

  test("no note template carries an instruction", () => {
    const stormy = calm((r) => {
      r.power.source = "battery";
      r.power.low_power_mode = true;
      r.memory.pressure = "warn";
      r.cpu.load_per_core = 3.2;
      r.cpu.speed_limit_percent = 70;
      r.cpu.thermal_warning = "recorded";
      r.gpu.devices[0]!.utilisation_percent = 97;
      r.network.default_route = false;
      r.network.kind = "none";
      r.network.os_reports = "not_reachable";
      r.network.metered = "likely";
      r.power.last_slept_at = "2026-11-12T08:00:00.000Z";
      r.power.awake_since = "2026-11-12T09:58:00.000Z";
    });
    const notes = [...weatherNotes(stormy), weatherNotes(calm((r) => { r.cpu.thermal_warning = "recorded"; }))[0]!];
    expect(notes).toHaveLength(10);
    for (const note of notes) {
      expect(note).not.toMatch(/\b(must|should|never)\b|\bdo not\b|\bdon't\b/i);
      expect(note).toMatch(/: /);
    }
  });
});

describe("says", () => {
  test("uses only the fields that were read", async () => {
    const reading = await readWeather({
      platform: "darwin",
      now: () => AT,
      os: { loadavg: () => { throw new Error("x"); }, totalmem: () => 1, cpus: () => [] },
      run: runner({ sysctl: { stdout: "kern.memorystatus_vm_pressure_level: 4\n", exit_code: 1 } }),
    });
    expect(reading.says).toBe(`Memory pressure critical. Read 10:00:00Z; good for about a minute. ${reading.unknown.length} facts not read.`);
    for (const word of ["battery", "mains", "load", "graphics", "Wi-Fi", "route", "cores"]) expect(reading.says).not.toContain(word);
  });

  test("with nothing read it says so", () => {
    const empty = calm((r) => {
      for (const group of [r.power, r.cpu, r.memory, r.network] as Array<Record<string, unknown>>) {
        for (const key of Object.keys(group)) group[key] = null;
      }
      r.gpu = { devices: [], shares_system_memory: null };
      r.unknown = [{ what: "power.source", why: "x" }];
    });
    expect(weatherSays(empty)).toBe("Nothing was read at 10:00:00Z. 1 fact not read.");
  });
});

describe("Linux and other platforms", () => {
  const sys = (files: Record<string, string>) => ({
    list_dir: (path: string) => {
      if (path !== "/sys/class/power_supply") throw new Error("ENOENT");
      return [...new Set(Object.keys(files).map((file) => file.split("/")[0]!))];
    },
    read_file: (path: string) => {
      const value = files[path.replace("/sys/class/power_supply/", "")];
      if (value === undefined) throw new Error("ENOENT");
      return `${value}\n`;
    },
  });

  test("Linux reads node:os and power_supply, and runs no command", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const reading = await readWeather({
      platform: "linux",
      now: () => AT,
      os: OS,
      run: runner(CAPTURED, calls),
      ...sys({ "AC/type": "Mains", "AC/online": "1", "BAT0/type": "Battery", "BAT0/capacity": "57", "BAT0/status": "Charging" }),
    });
    expect(calls).toEqual([]);
    expect(reading.power).toMatchObject({ source: "ac", battery_percent: 57, battery_state: "charging" });
    expect(reading.cpu).toMatchObject({ cores: 8, load_1m: 8.4, load_per_core: 1.05, chip: null });
    expect(unknownOf(reading, "cpu.chip")).toBe("not read on Linux by this build");
    expect(unknownOf(reading, "network.kind")).toBe("not read on Linux by this build");
    expect(unknownOf(reading, "gpu.devices")).toBe("not read on Linux by this build");
    expect(reading.says).toStartWith("On mains power, battery 57% and charging; load 8.4 on 8 cores. ");
  });

  test("Linux on battery, with no supply directory, and with two batteries", async () => {
    const onBattery = await readWeather({
      platform: "linux", now: () => AT, os: OS,
      ...sys({ "AC/type": "Mains", "AC/online": "0", "BAT0/type": "Battery", "BAT0/capacity": "31", "BAT0/status": "Discharging" }),
    });
    expect(onBattery.power).toMatchObject({ source: "battery", battery_percent: 31, battery_state: "discharging" });
    expect(onBattery.notes).toContain(WEATHER_NOTE_ON_BATTERY);
    const none = await readWeather({ platform: "linux", now: () => AT, os: OS, ...sys({}) , list_dir: () => { throw new Error("EACCES"); } });
    expect(unknownOf(none, "power.source")).toBe("/sys/class/power_supply could not be read");
    const two = await readWeather({
      platform: "linux", now: () => AT, os: OS,
      ...sys({ "BAT0/type": "Battery", "BAT0/capacity": "50", "BAT0/status": "Discharging", "BAT1/type": "Battery", "BAT1/capacity": "90", "BAT1/status": "Discharging" }),
    });
    expect(two.power.battery_percent).toBeNull();
    expect(unknownOf(two, "power.battery_percent")).toContain("more than one battery");
  });

  test("other platforms: node:os only; Windows keeps no load average", async () => {
    const windows = await readWeather({ platform: "win32", now: () => AT, os: { ...OS, loadavg: () => [0, 0, 0] } });
    expect(windows.cpu.load_1m).toBeNull();
    expect(unknownOf(windows, "cpu.load_1m")).toBe("Windows keeps no load average");
    expect(unknownOf(windows, "power.source")).toBe("not read on win32 by this build");
    const bsd = await readWeather({ platform: "freebsd", now: () => AT, os: OS });
    expect(bsd.cpu).toMatchObject({ cores: 8, load_1m: 8.4 });
    expect(unknownOf(bsd, "memory.pressure")).toBe("not read on freebsd by this build");
  });
});

describe("the switch and the arrival block", () => {
  test("off when absent or empty; on | off in either spelling; anything else refuses", () => {
    expect(weatherSwitch({})).toBe("off");
    expect(weatherSwitch({ AGENTOOL_COLLAB_WEATHER: "" })).toBe("off");
    for (const name of WEATHER_VARIABLES) {
      expect(weatherSwitch({ [name]: "on" })).toBe("on");
      expect(weatherSwitch({ [name]: "off" })).toBe("off");
    }
    expect(weatherSwitch({ AGENTOOL_COLLAB_WEATHER: "on", AGENTTOOL_COLLAB_WEATHER: "on" })).toBe("on");
    const codeOf = (environment: Record<string, string>) => {
      try {
        weatherSwitch(environment);
        return null;
      } catch (error) {
        return error instanceof CollabError ? [error.code, error.message] : String(error);
      }
    };
    expect(codeOf({ AGENTOOL_COLLAB_WEATHER: "yes" })).toEqual(["invalid_weather_switch", 'AGENTOOL_COLLAB_WEATHER must be on | off, not "yes"']);
    expect(codeOf({ AGENTTOOL_COLLAB_WEATHER: "ON" })?.[0]).toBe("invalid_weather_switch");
    expect(codeOf({ AGENTOOL_COLLAB_WEATHER: "on", AGENTTOOL_COLLAB_WEATHER: "off" })).toEqual([
      "conflicting_weather_switch",
      "AGENTOOL_COLLAB_WEATHER and AGENTTOOL_COLLAB_WEATHER disagree; set one of them to on | off",
    ]);
  });

  test("the compact block, and unavailable when a reader throws or overruns", async () => {
    const reading = await darwin();
    expect(await arrivalWeather(async () => reading)).toEqual({
      read_at: reading.read_at,
      good_for_seconds: 60,
      says: reading.says,
      notes: reading.notes,
      not_read: 2,
      basis: WEATHER_BASIS,
      authorises: WEATHER_AUTHORISES,
      every_field: WEATHER_EVERY_FIELD,
    });
    expect(await arrivalWeather(async () => { throw new Error("secret detail"); })).toEqual({ unavailable: "the reading failed" });
    expect(await arrivalWeather((() => { throw new Error("sync"); }) as never)).toEqual({ unavailable: "the reading failed" });
    expect(await arrivalWeather(() => new Promise(() => {}), 20)).toEqual({ unavailable: "the reading took longer than 20 ms" });
  });
});
