/** Static checks on the shipped scripts: they parse under sh and dash, keep
 * the hygiene header, never eval or source anything but the one library,
 * carry their production paths blocks, match SHA256SUMS, and hold no value
 * from the owner's own network. */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blockOf, IS_DARWIN, PKG_DIR, readScript, SCRIPTS, sha256Hex } from "./helpers.ts";

const NAMES = Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[];
const EXECUTABLES: (keyof typeof SCRIPTS)[] = ["ferry", "hub", "admin", "setup", "gate"];
const LIBRARY_LINE = '. "$FERRY_ROOT/libexec/ferry-spool.sh"';

const PRODUCTION_BLOCKS: Record<keyof typeof SCRIPTS, string> = {
  lib: [
    "FERRY_HOME=/Users/ferry", "ROOT_OWNER=root", "ROOT_GROUP=wheel", "ID=/usr/bin/id", "STAT=/usr/bin/stat",
    "JQ=/usr/bin/jq", "ICONV=/usr/bin/iconv", "SHASUM=/usr/bin/shasum", "XATTR=/usr/bin/xattr",
  ].join("\n"),
  gate: "FERRY_ROOT=/Library/Ferry",
  hub: "FERRY_ROOT=/Library/Ferry",
  admin: [
    "FERRY_ROOT=/Library/Ferry", "REQUIRE_ROOT=1", "TTY=/dev/tty", "HOST_KEYS=/etc/ssh/ssh_host_ed25519_key.pub",
    "DATE=/bin/date", "SSH_KEYGEN=/usr/bin/ssh-keygen", "SCUTIL=/usr/sbin/scutil", "IPCONFIG=/usr/sbin/ipconfig",
  ].join("\n"),
  ferry: [
    "SSH=/usr/bin/ssh", "SSH_KEYSCAN=/usr/bin/ssh-keyscan", "SSH_KEYGEN=/usr/bin/ssh-keygen", "PS=/bin/ps",
    "DSCACHEUTIL=/usr/bin/dscacheutil", "XATTR=/usr/bin/xattr", "JQ=/usr/bin/jq", "ICONV=/usr/bin/iconv",
    "SHASUM=/usr/bin/shasum", "ID=/usr/bin/id", "STAT=/usr/bin/stat",
  ].join("\n"),
  setup: [
    "FERRY_ROOT=/Library/Ferry", "FERRY_HOME=/Users/ferry", "REQUIRE_ROOT=1", "ROOT_OWNER=root", "ROOT_GROUP=wheel",
    "FERRY_USER=ferry", "FERRY_GROUP=ferryhand", "STAFF_GROUP=staff", "TMPROOT=/private/tmp", "ID=/usr/bin/id",
    "SYSADMINCTL=/usr/sbin/sysadminctl", "DSCL=/usr/bin/dscl", "DSEDITGROUP=/usr/sbin/dseditgroup",
    "CREATEHOMEDIR=/usr/sbin/createhomedir", "INSTALL=/usr/bin/install", "CHOWN=/usr/sbin/chown", "CHMOD=/bin/chmod",
    "MKDIR=/bin/mkdir", "SUDO=/usr/bin/sudo", "STAT=/usr/bin/stat", "SHASUM=/usr/bin/shasum", "JQ=/usr/bin/jq", "ICONV=/usr/bin/iconv",
    "XATTR=/usr/bin/xattr", "SSH_KEYGEN=/usr/bin/ssh-keygen",
  ].join("\n"),
};

/** Code with comments and quoted strings removed, for token checks. */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return "";
      return line.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\s#.*$/, "");
    })
    .join("\n");
}

function packageFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(PKG_DIR);
  return out;
}

describe("static", () => {
  test.skipIf(!IS_DARWIN)("every script parses under sh and dash", () => {
    for (const name of NAMES) {
      for (const shell of ["/bin/sh", "/bin/dash"]) {
        const r = Bun.spawnSync({ cmd: [shell, "-n", join(PKG_DIR, SCRIPTS[name])], stderr: "pipe" });
        expect({ name, shell, code: r.exitCode, err: r.stderr.toString() }).toEqual({ name, shell, code: 0, err: "" });
      }
    }
  });

  test("each starts with #!/bin/sh and sets -euf within 15 lines; lab scripts pin the environment", () => {
    for (const name of NAMES) {
      const lines = readScript(name).split("\n");
      expect({ name, first: lines[0] }).toEqual({ name, first: "#!/bin/sh" });
      expect({ name, euf: lines.slice(0, 15).includes("set -euf") }).toEqual({ name, euf: true });
      if (name === "lib") continue;
      const head = lines.slice(0, 15).join("\n");
      expect(head).toContain("PATH=/usr/bin:/bin:/usr/sbin:/sbin; export PATH");
      expect(head).toContain("LC_ALL=C; export LC_ALL");
      expect(head).toContain("IFS=$(printf ' \\t\\n_'); IFS=${IFS%_}");
      expect(head).toMatch(name === "ferry" ? /\numask 077\n/ : /\numask 02[27]\n/);
    }
  });

  test("no eval, no backticks, no source, and no dot but the one library line", () => {
    for (const name of NAMES) {
      const text = readScript(name);
      const code = codeOnly(text);
      expect({ name, eval: /\beval\b/.test(code) }).toEqual({ name, eval: false });
      expect({ name, backtick: text.includes("`") }).toEqual({ name, backtick: false });
      expect({ name, source: /(^|[\s;&|(){}])source\s/m.test(code) }).toEqual({ name, source: false });
      const dots = text.split("\n").filter((l) => /^\s*\.\s/.test(l) || /[;&|]\s*\.\s/.test(l));
      const expected = ["gate", "hub", "admin"].includes(name) ? [LIBRARY_LINE] : [];
      expect({ name, dots }).toEqual({ name, dots: expected });
    }
  });

  test("every read uses -r", () => {
    for (const name of NAMES) {
      const code = codeOnly(readScript(name));
      for (const m of code.matchAll(/(^|[\s;&|(){}])read\s+(\S+)/gm)) {
        expect({ name, read: m[0].trim(), r: m[2] === "-r" }).toEqual({ name, read: m[0].trim(), r: true });
      }
    }
  });

  test("the shipped paths blocks hold the production values", () => {
    for (const name of NAMES) {
      expect({ name, block: blockOf(readScript(name)).replace(/\n$/, "") }).toEqual({ name, block: PRODUCTION_BLOCKS[name] });
    }
  });

  test.skipIf(!IS_DARWIN)("the production tool paths exist on this Mac", () => {
    for (const name of NAMES) {
      for (const line of PRODUCTION_BLOCKS[name].split("\n")) {
        const value = line.slice(line.indexOf("=") + 1);
        if (/^\/(usr\/bin|usr\/sbin|bin)\//.test(value)) expect({ value, exists: existsSync(value) }).toEqual({ value, exists: true });
      }
    }
  });

  test("SHA256SUMS is fresh", () => {
    const want = Object.values(SCRIPTS)
      .slice()
      .sort()
      .map((rel) => `${sha256Hex(readFileSync(join(PKG_DIR, rel)))}  ${rel}`)
      .join("\n");
    expect(readFileSync(join(PKG_DIR, "SHA256SUMS"), "utf8")).toBe(`${want}\n`);
  });

  test("git modes: 100755 for the five executables, 100644 for the library", () => {
    const r = Bun.spawnSync({ cmd: ["git", "ls-files", "-s", "--", ...Object.values(SCRIPTS)], cwd: PKG_DIR, stdout: "pipe", stderr: "pipe" });
    const listed = r.exitCode === 0 ? r.stdout.toString().trim() : "";
    for (const name of NAMES) {
      const rel = SCRIPTS[name];
      const want = EXECUTABLES.includes(name) ? "100755" : "100644";
      const entry = listed.split("\n").find((l) => l.endsWith(`\t${rel}`) || l.endsWith(`\tpackages/ferry/${rel}`));
      if (entry !== undefined) {
        expect({ rel, mode: entry.split(" ")[0] }).toEqual({ rel, mode: want });
      } else {
        // Not yet in the index (or not a checkout): the working-tree bit must agree.
        const exec = (statSync(join(PKG_DIR, rel)).mode & 0o111) !== 0;
        expect({ rel, exec }).toEqual({ rel, exec: want === "100755" });
      }
    }
  });

  test("no owner-specific path, LAN address or mDNS name appears in the package", () => {
    // Built from parts so this file does not match itself.
    const home = ["", "Users", "mac" + "air"].join("/");
    const lan = new RegExp(["192", "168", "50", ""].join("\\."));
    const mdns = new RegExp(["users-mac", "book|mac", "book-?pro"].join(""), "i");
    for (const p of packageFiles()) {
      const text = readFileSync(p, "utf8");
      const rel = relative(PKG_DIR, p);
      expect({ rel, home: text.includes(home) }).toEqual({ rel, home: false });
      expect({ rel, lan: lan.test(text) }).toEqual({ rel, lan: false });
      expect({ rel, mdns: mdns.test(text) }).toEqual({ rel, mdns: false });
    }
  });

  test("the client and the library share the same contract constants", () => {
    const lib = readScript("lib");
    const client = readScript("ferry");
    for (const key of ["LOBBY_MAX", "FILE_MAX", "ENROLL_FORMAT", "JOIN_FORMAT", "ENROLL_KEYS", "JOIN_KEYS", "SHAPE_FILTER", "DISPLAY_FILTER"]) {
      const re = new RegExp(`^${key}=(.*)$`, "m");
      const a = re.exec(lib)?.[1];
      const b = re.exec(client)?.[1];
      expect({ key, defined: a !== undefined }).toEqual({ key, defined: true });
      expect({ key, client: b }).toEqual({ key, client: a });
    }
    expect(/^LOBBY_MAX=65536$/m.test(lib)).toBe(true);
  });

  test("the packet formats and key sets match the lobby's own parser", () => {
    const packets = join(PKG_DIR, "../lobby/src/packets.ts");
    if (!existsSync(packets)) return;
    const src = readFileSync(packets, "utf8");
    const lib = readScript("lib");
    const enrollFormat = /ENROLLMENT_PACKET_FORMAT = "([^"]+)"/.exec(src)?.[1];
    const joinFormat = /JOIN_PACKET_FORMAT = "([^"]+)"/.exec(src)?.[1];
    expect(lib).toContain(`ENROLL_FORMAT=${enrollFormat}\n`);
    expect(lib).toContain(`JOIN_FORMAT=${joinFormat}\n`);
    const exactLists = [...src.matchAll(/exact\((?:value|packet\.\w+|request\.headers|parsed|value), \[([^\]]+)\]/g)].map((m) =>
      [...m[1]!.matchAll(/"([^"]+)"/g)].map((k) => k[1]!).sort());
    const enrollKeys = JSON.parse(/^ENROLL_KEYS='(.*)'$/m.exec(lib)![1]!) as string[];
    const joinKeys = JSON.parse(/^JOIN_KEYS='(.*)'$/m.exec(lib)![1]!) as string[];
    expect(exactLists.map((l) => l.join(","))).toContain(enrollKeys.join(","));
    expect(exactLists.map((l) => l.join(","))).toContain(joinKeys.join(","));
    expect(enrollKeys).toEqual([...enrollKeys].sort());
    expect(joinKeys).toEqual([...joinKeys].sort());
  });

  test("the lobby writes packets in the layout Ferry's filter expects, under the same cap", () => {
    // Ferry's packet filter wants "format" on line 2 of JSON.stringify(x, null, 2)
    // output and at most LOBBY_MAX bytes. The lobby's parser accepts other
    // layouts, so a change to its writers or cap must fail here, not live.
    const src = join(PKG_DIR, "../lobby/src");
    if (!existsSync(join(src, "cli-fleet.ts")) || !existsSync(join(src, "hub.ts"))) return;
    const cli = readFileSync(join(src, "cli-fleet.ts"), "utf8");
    const hub = readFileSync(join(src, "hub.ts"), "utf8");
    const lib = readScript("lib");
    const cap = /^const MAX_PACKET_BYTES = ([0-9_]+);$/m.exec(cli)?.[1];
    expect(cap).toBeDefined();
    expect(lib).toContain(`\nLOBBY_MAX=${Number(cap!.replaceAll("_", ""))}\n`);
    // enroll-device prints the enrollment packet; hub relay prints the join packet.
    expect(cli).toContain("io.stdout(`${JSON.stringify(packet, null, 2)}\\n`);");
    expect(cli).toContain("io.stdout(`${JSON.stringify(outcome.value.join, null, 2)}\\n`);");
    // The relay's join object names format first (lobby-lane.test.ts runs the
    // enrollment builder itself).
    expect(hub).toMatch(/\bjoin: \{\s+format: JOIN_PACKET_FORMAT,\s+origin: /);
  });
});
