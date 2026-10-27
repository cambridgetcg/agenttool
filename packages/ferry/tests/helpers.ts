/**
 * Hermetic harness for the Ferry shell scripts.
 *
 * Every test gets a temp root holding a fake /Library/Ferry, a fake
 * /Users/ferry (spool, stage, log, .ssh), a fake hub home and one fake HOME
 * per Mac. Scripts are copied with only their paths block rewritten, run
 * under an explicit shell with a fixed environment, and never touch the
 * network, the Keychain, real ssh, /Library or /Users/ferry. The runner plays
 * both the ferry account and the hub user.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

export const IS_DARWIN = process.platform === "darwin";
/** Why the suites skip elsewhere: the scripts use BSD stat -f, date -v/-j,
 * xattr and dscacheutil, which exist only on macOS. */
export const DARWIN_ONLY = !IS_DARWIN;
export const PKG_DIR = resolve(import.meta.dir, "..");
export const SHELLS = ["/bin/sh", "/bin/dash"];

export const SCRIPTS = {
  ferry: "bin/ferry",
  hub: "bin/ferry-hub",
  admin: "bin/ferry-admin",
  setup: "bin/ferry-setup",
  gate: "libexec/ferry-gate",
  lib: "libexec/ferry-spool.sh",
} as const;

export const BLOCK_START = "# --- ferry:paths (tests rewrite only this block) ---\n";
export const BLOCK_END = "# --- end ferry:paths ---\n";

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  out: string;
  err: string;
  timedOut: boolean;
}

function sh(cmd: string[], opts: { cwd?: string } = {}): string {
  const r = Bun.spawnSync({ cmd, cwd: opts.cwd, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

export const RUNNER = userInfo().username;
export const RUNNER_GROUP = IS_DARWIN ? sh(["/usr/bin/id", "-gn"]).trim() : "staff";
export const RUNNER_GID = process.getgid?.() ?? 20;
export const RUNNER_UID = process.getuid?.() ?? 501;

export function readScript(name: keyof typeof SCRIPTS): string {
  return readFileSync(join(PKG_DIR, SCRIPTS[name]), "utf8");
}

export function blockOf(text: string): string {
  const a = text.indexOf(BLOCK_START);
  const b = text.indexOf(BLOCK_END);
  if (a < 0 || b < a) throw new Error("no paths block");
  return text.slice(a + BLOCK_START.length, b);
}

export function blockValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of blockOf(text).split("\n")) {
    if (line === "") continue;
    const i = line.indexOf("=");
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/** The script with only its paths block replaced (keys keep their order). */
export function rewriteBlock(text: string, overrides: Record<string, string>): string {
  const values = { ...blockValues(text), ...overrides };
  const body = Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join("");
  const a = text.indexOf(BLOCK_START) + BLOCK_START.length;
  const b = text.indexOf(BLOCK_END);
  return text.slice(0, a) + body + text.slice(b);
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** chmod through /bin/chmod: Bun's chmodSync drops the setgid bit. */
export function chmodBin(mode: string, ...paths: string[]): void {
  sh(["/bin/chmod", mode, ...paths]);
}

function writeExec(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/** A directory tree digest: path, type, mode, size and content hash of every
 * entry, links not followed. Two equal digests mean nothing changed. */
export function treeDigest(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const r = rel === "" ? name : `${rel}/${name}`;
      const st = lstatSync(p);
      if (st.isSymbolicLink()) lines.push(`${r}|link|${readlinkSync(p)}`);
      else if (st.isDirectory()) {
        lines.push(`${r}|dir|${(st.mode & 0o7777).toString(8)}`);
        walk(p, r);
      } else if (st.isFile()) lines.push(`${r}|file|${(st.mode & 0o7777).toString(8)}|${st.size}|${sha256Hex(readFileSync(p))}`);
      else lines.push(`${r}|other|${(st.mode & 0o7777).toString(8)}`);
    }
  };
  walk(root, "");
  return sha256Hex(lines.join("\n"));
}

export function listTree(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const r = rel === "" ? name : `${rel}/${name}`;
      out.push(r);
      const st = lstatSync(p);
      if (st.isDirectory() && !st.isSymbolicLink()) walk(p, r);
    }
  };
  walk(root, "");
  return out;
}

export interface SiteOverrides {
  lan_cidr?: string;
  lobby_queue?: number;
  file_queue_items?: number;
  file_queue_bytes?: number;
  spool_max_bytes?: number;
  floor_kib?: number;
  retain_days?: number;
}

export interface LabOptions {
  peers?: string[];
  site?: SiteOverrides;
  /** Route the library's stat through the fake that can report a foreign
   * owner or another device for listed paths. */
  fakeStat?: boolean;
  /** Leave site.conf out (tests write their own). */
  noSite?: boolean;
}

export const HUB_HOST = "ferry-test.local";
export const FIXED_EXPIRY = "20270125093000";

/**
 * Fake tools. A newly written executable costs a Gatekeeper assessment on
 * its first exec, so there is one dispatcher script (`fake`) with a symlink
 * per tool name, in a content-addressed directory that later runs reuse. The
 * fakes read FERRY_TEST_* variables that the harness sets; the scripts under
 * test never read them.
 */
const FAKE_SCRIPT = `#!/bin/sh
# Ferry test fakes; dispatched on the name this file was run as.
CTL=$FERRY_TEST_CTL
case \${0##*/} in
ssh)
  # Records argv, env and stdin length; maps -i <key> to a peer; can fail a
  # target or answer canned stderr; otherwise runs the copied gate as sshd
  # would, with the client's command as SSH_ORIGINAL_COMMAND.
  { printf -- '--call--\\n'; for a in "$@"; do printf '%s\\n' "$a"; done; } >> "$CTL/ssh.calls"
  env | LC_ALL=C sort > "$CTL/ssh.env.last"
  key=; prev=; n=0; T=; C=
  for a in "$@"; do
    [ "$prev" = -i ] && key=$a
    [ "$a" = -n ] && n=1
    prev=$a; T=$C; C=$a
  done
  if [ -f "$CTL/fail.$T" ]; then cat "$CTL/fail.$T" >&2; exit 255; fi
  if [ -f "$CTL/canned.stderr" ]; then cat "$CTL/canned.stderr" >&2; exit "$(cat "$CTL/canned.exit")"; fi
  peer=$(awk -v k="$key" '$1==k {print $2}' "$CTL/keymap" 2>/dev/null)
  if [ -z "$peer" ]; then echo "ferry@$T: Permission denied (publickey)." >&2; exit 255; fi
  tmp=$(mktemp "$CTL/stdin.XXXXXX")
  if [ "$n" = 1 ]; then : > "$tmp"; else cat > "$tmp"; fi
  wc -c < "$tmp" | tr -d ' ' >> "$CTL/ssh.stdin"
  out=$(mktemp "$CTL/out.XXXXXX")
  env -i PATH=/usr/bin:/bin HOME="$FERRY_TEST_FERRY_HOME" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 \\
    FERRY_TEST_CTL="$CTL" SSH_ORIGINAL_COMMAND="$C" "$FERRY_TEST_SHELL" "$FERRY_TEST_GATE" --peer "$peer" < "$tmp" > "$out"
  rc=$?
  case $C in
    get\\ *) if [ -f "$CTL/flip" ]; then printf X; tail -c +2 "$out"; else cat "$out"; fi ;;
    *) cat "$out" ;;
  esac
  rm -f "$tmp" "$out"
  exit $rc ;;
ssh-keyscan)
  { printf -- '--call--\\n'; for a in "$@"; do printf '%s\\n' "$a"; done; } >> "$CTL/keyscan.calls"
  printf '# x:22 SSH-2.0-OpenSSH_10.2\\n' >&2
  cat "$CTL/keyscan.out" 2>/dev/null
  exit 0 ;;
ps)
  # A pid listed in ps.map ("pid ppid tty comm") answers "ppid tty comm";
  # any other pid is the client itself and answers ps.self.
  [ -f "$CTL/ps.fail" ] && exit 1
  pid=; prev=
  for a in "$@"; do [ "$prev" = -p ] && pid=$a; prev=$a; done
  line=$(awk -v p="$pid" '$1==p { $1=""; sub(/^ /, ""); print; exit }' "$CTL/ps.map" 2>/dev/null)
  if [ -n "$line" ]; then printf '  %s\\n' "$line"; exit 0; fi
  [ -f "$CTL/ps.self" ] || exit 1
  printf '  %s\\n' "$(cat "$CTL/ps.self")"
  exit 0 ;;
dscacheutil)
  cat "$CTL/dscache.out" 2>/dev/null
  exit 0 ;;
id-root)
  case $1 in -u) echo 0 ;; -un) echo root ;; *) /usr/bin/id "$@" ;; esac
  exit 0 ;;
date)
  if [ "$*" = "-u -v+90d +%Y%m%d%H%M%S" ]; then echo ${FIXED_EXPIRY}; exit 0; fi
  exec /bin/date "$@" ;;
scutil)
  [ "$*" = "--get LocalHostName" ] && { echo ferry-test-lab; exit 0; }
  exit 1 ;;
ipconfig)
  [ "$*" = "getifaddr en0" ] && { echo 192.0.2.10; exit 0; }
  exit 1 ;;
stat)
  # The real stat, with a foreign owner or another device for paths listed
  # in stat.owner / stat.dev.
  out=$(/usr/bin/stat "$@") || exit $?
  for last; do :; done
  if [ -f "$CTL/stat.owner" ] && /usr/bin/grep -qxF -- "$last" "$CTL/stat.owner"; then
    out=$(printf '%s\\n' "$out" | awk -F'|' 'BEGIN{OFS="|"} {$2="mallory"; print}')
  fi
  if [ -f "$CTL/stat.dev" ] && /usr/bin/grep -qxF -- "$last" "$CTL/stat.dev"; then
    out=$(printf '%s\\n' "$out" | awk -F'|' 'BEGIN{OFS="|"} {$7="999"; print}')
  fi
  printf '%s\\n' "$out"
  exit 0 ;;
rec-*)
  # The setup recorder: logs every call and answers account queries from a
  # state file; file tools log, then run for real.
  tool=\${0##*/rec-}
  { printf '%s' "$tool"; for a in "$@"; do case $a in ./*) a="$(pwd -P)/\${a#./}" ;; esac; printf ' %s' "$a"; done; printf '\\n'; } >> "$CTL/calls"
  state=$CTL/state
  has() { /usr/bin/grep -qxF -- "$1" "$state" 2>/dev/null; }
  add() { printf '%s\\n' "$1" >> "$state"; }
  case $tool in
    id)
      if [ $# -eq 1 ]; then echo 0; exit 0; fi
      has "user $2" && { echo 600; exit 0; }
      exit 1 ;;
    dscl)
      case $2 in
        -read)
          case $3 in
            /Groups/*)
              has "group \${3#/Groups/}" || exit 1
              [ "$4" = PrimaryGroupID ] && echo "PrimaryGroupID: 701"
              exit 0 ;;
            /Users/*)
              u=\${3#/Users/}
              has "user $u" || exit 1
              case $4 in
                NFSHomeDirectory) v=$(awk -v u="$u" '$1=="home" && $2==u {print $3}' "$state"); [ -n "$v" ] || exit 1; echo "NFSHomeDirectory: $v"; exit 0 ;;
                IsHidden) has "hidden $u" && { echo "IsHidden: 1"; exit 0; }; exit 1 ;;
                PrimaryGroupID) v=$(awk -v u="$u" '$1=="gid" && $2==u {print $3}' "$state"); [ -n "$v" ] || exit 1; echo "PrimaryGroupID: $v"; exit 0 ;;
              esac ;;
          esac
          exit 1 ;;
        -create) add "hidden \${3#/Users/}"; exit 0 ;;
      esac
      exit 1 ;;
    dseditgroup)
      case $2 in
        checkmember) has "member $5 $4" && exit 0; exit 1 ;;
        create) add "group $5"; exit 0 ;;
        edit) add "member $7 $4"; exit 0 ;;
      esac
      exit 1 ;;
    sysadminctl)
      # Like the real one, it exits 0 even when it creates nothing.
      if [ -f "$CTL/sysadminctl.fail" ]; then echo "Creating user record failed" >&2; exit 0; fi
      u=$2; h=; g=; prev=
      for a in "$@"; do case $prev in -home) h=$a ;; -GID) g=$a ;; esac; prev=$a; done
      [ -f "$CTL/sysadminctl.staff" ] && g=20
      add "user $u"; add "home $u $h"; [ -n "$g" ] && add "gid $u $g"
      exit 0 ;;
    createhomedir) mkdir -p "$FERRY_TEST_FERRY_HOME"; exit 0 ;;
    sudo) shift 3; exec "$@" ;;
    install) exec /usr/bin/install "$@" ;;
    chown) exec /usr/sbin/chown "$@" ;;
    chmod) exec /bin/chmod "$@" ;;
    mkdir) exec /bin/mkdir "$@" ;;
  esac
  exit 1 ;;
esac
echo "fake: unknown tool \${0##*/}" >&2
exit 127
`;

export const FAKE_TOOLS = ["ssh", "ssh-keyscan", "ps", "dscacheutil", "id-root", "date", "scutil", "ipconfig", "stat",
  ...["id", "dscl", "dseditgroup", "sysadminctl", "createhomedir", "sudo", "install", "chown", "chmod", "mkdir"].map((t) => `rec-${t}`)];

let FAKES: string | null = null;
export function sharedFakes(): string {
  if (FAKES !== null) return FAKES;
  const dir = join(realpathSync(tmpdir()), `ferry-fakes-${sha256Hex(FAKE_SCRIPT + FAKE_TOOLS.join(",")).slice(0, 16)}`);
  if (!existsSync(join(dir, "ready"))) {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "ferry-fakes-new-")));
    writeExec(join(tmp, "fake"), FAKE_SCRIPT);
    for (const t of FAKE_TOOLS) symlinkSync("fake", join(tmp, t));
    writeFileSync(join(tmp, "ready"), "");
    try {
      renameSync(tmp, dir);
    } catch {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  FAKES = dir;
  return dir;
}

/** One fake lab: post office, hub home, fake tools and a control directory. */
export class Lab {
  readonly root: string;
  readonly ferryRoot: string;
  readonly ferryHome: string;
  readonly spool: string;
  readonly stage: string;
  readonly hubHome: string;
  readonly bin: string;
  readonly ctl: string;
  readonly gatePath: string;
  readonly hubPath: string;
  readonly adminPath: string;
  readonly clientPath: string;
  readonly rootClientPath: string;
  readonly hostKeyPub: string;
  readonly hostKeyB64: string;
  readonly hostKeyFp: string;
  readonly site: Required<SiteOverrides>;

  constructor(readonly shell: string, opts: LabOptions = {}) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), "ferry-test-")));
    chownSync(this.root, RUNNER_UID, RUNNER_GID);
    this.ferryRoot = join(this.root, "Library", "Ferry");
    this.ferryHome = join(this.root, "Users", "ferry");
    this.spool = join(this.ferryHome, "spool");
    this.stage = join(this.ferryHome, "stage");
    this.hubHome = join(this.root, "Users", "hub");
    this.bin = sharedFakes();
    this.ctl = join(this.root, "ctl");
    for (const d of [join(this.ferryRoot, "libexec"), join(this.ferryRoot, "bin"), this.hubHome, this.ctl]) {
      mkdirSync(d, { recursive: true });
    }
    this.site = {
      lan_cidr: "192.0.2.0/24",
      lobby_queue: 4,
      file_queue_items: 32,
      file_queue_bytes: 134217728,
      spool_max_bytes: 1073741824,
      floor_kib: 1024,
      retain_days: 7,
      ...opts.site,
    };

    // Host key for peer add and admin whoami.
    sh(["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "test-host", "-f", join(this.ctl, "host_ed25519")]);
    this.hostKeyPub = join(this.ctl, "host_ed25519.pub");
    this.hostKeyB64 = readFileSync(this.hostKeyPub, "utf8").split(" ")[1]!;
    this.hostKeyFp = sh(["/usr/bin/ssh-keygen", "-l", "-E", "sha256", "-f", this.hostKeyPub]).split(" ")[1]!;

    this.gatePath = join(this.ferryRoot, "libexec", "ferry-gate");
    // An agent shell (no tty) under claude in a terminal tab, as on a real Mac.
    writeFileSync(join(this.ctl, "ps.self"), "500 ?? /bin/sh");
    writeFileSync(join(this.ctl, "ps.map"), [
      "500 400 ?? /bin/zsh", "400 300 ttys010 /usr/local/bin/claude", "300 200 ttys010 -zsh", "200 100 ttys010 login",
      "100 1 ?? /Applications/iTerm.app/Contents/MacOS/iTerm2", "",
    ].join("\n"));

    const lib = rewriteBlock(readScript("lib"), {
      FERRY_HOME: this.ferryHome,
      ROOT_OWNER: RUNNER,
      ROOT_GROUP: RUNNER_GROUP,
      ...(opts.fakeStat ? { STAT: join(this.bin, "stat") } : {}),
    });
    writeFileSync(join(this.ferryRoot, "libexec", "ferry-spool.sh"), lib);
    chmodSync(join(this.ferryRoot, "libexec", "ferry-spool.sh"), 0o644);
    writeExec(this.gatePath, rewriteBlock(readScript("gate"), { FERRY_ROOT: this.ferryRoot }));
    this.hubPath = join(this.ferryRoot, "bin", "ferry-hub");
    writeExec(this.hubPath, rewriteBlock(readScript("hub"), { FERRY_ROOT: this.ferryRoot }));
    this.adminPath = join(this.ferryRoot, "bin", "ferry-admin");
    writeExec(this.adminPath, rewriteBlock(readScript("admin"), {
      FERRY_ROOT: this.ferryRoot,
      REQUIRE_ROOT: "0",
      TTY: join(this.ctl, "tty"),
      HOST_KEYS: this.hostKeyPub,
      DATE: join(this.bin, "date"),
      SCUTIL: join(this.bin, "scutil"),
      IPCONFIG: join(this.bin, "ipconfig"),
    }));
    const clientBlock = {
      SSH: join(this.bin, "ssh"),
      SSH_KEYSCAN: join(this.bin, "ssh-keyscan"),
      PS: join(this.bin, "ps"),
      DSCACHEUTIL: join(this.bin, "dscacheutil"),
    };
    this.clientPath = join(this.root, "client-bin", "ferry");
    mkdirSync(join(this.root, "client-bin"), { recursive: true });
    writeExec(this.clientPath, rewriteBlock(readScript("ferry"), clientBlock));
    this.rootClientPath = join(this.root, "client-bin", "ferry-as-root");
    writeExec(this.rootClientPath, rewriteBlock(readScript("ferry"), { ...clientBlock, ID: join(this.bin, "id-root") }));

    if (!opts.noSite) this.writeSite();

    // The post office's home and spool, as ferry-setup would leave them.
    mkdirSync(this.ferryHome, { recursive: true });
    chmodSync(this.ferryHome, 0o750);
    mkdirSync(join(this.ferryHome, ".ssh"), { mode: 0o755 });
    writeFileSync(join(this.ferryHome, ".ssh", "authorized_keys"),
      "# ferry lanes. Written only by /Library/Ferry/bin/ferry-admin; do not edit by hand.\n");
    chmodSync(join(this.ferryHome, ".ssh", "authorized_keys"), 0o644);
    mkdirSync(this.stage);
    chmodSync(this.stage, 0o700);
    mkdirSync(join(this.ferryHome, "log"));
    chmodBin("2750", join(this.ferryHome, "log"));
    for (const d of ["", "lobby", "lobby/in", "lobby/out", "files", "files/lab"]) this.spoolDir(d);
    for (const p of opts.peers ?? ["air", "studio"]) this.addLaneDirs(p);
  }

  writeSite(text?: string): void {
    const s = this.site;
    const body = text ?? [
      "ferry-site/1",
      `ferry_user=${RUNNER}`,
      `ferry_group=${RUNNER_GROUP}`,
      `hub_user=${RUNNER}`,
      `hub_home=${this.hubHome}`,
      "local_peer=lab",
      `lan_cidr=${s.lan_cidr}`,
      `lobby_queue=${s.lobby_queue}`,
      `file_queue_items=${s.file_queue_items}`,
      `file_queue_bytes=${s.file_queue_bytes}`,
      `spool_max_bytes=${s.spool_max_bytes}`,
      `floor_kib=${s.floor_kib}`,
      `retain_days=${s.retain_days}`,
      "",
    ].join("\n");
    const p = join(this.ferryRoot, "site.conf");
    rmSync(p, { force: true });
    writeFileSync(p, body);
    chmodSync(p, 0o644);
  }

  spoolDir(rel: string): string {
    const p = rel === "" ? this.spool : join(this.spool, rel);
    mkdirSync(p, { recursive: true });
    chmodBin("2770", p);
    return p;
  }

  addLaneDirs(peer: string): void {
    for (const area of ["lobby/in", "lobby/out", "files"]) this.spoolDir(`${area}/${peer}`);
  }

  /** Test-only variables for the shared fakes. The scripts never read them. */
  fakeEnv(): Record<string, string> {
    return {
      FERRY_TEST_CTL: this.ctl,
      FERRY_TEST_GATE: this.gatePath,
      FERRY_TEST_SHELL: this.shell,
      FERRY_TEST_FERRY_HOME: this.ferryHome,
    };
  }

  env(extra: Record<string, string> = {}): Record<string, string> {
    return { PATH: "/usr/bin:/bin", HOME: this.hubHome, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", ...this.fakeEnv(), ...extra };
  }

  run(cmd: string[], opts: { env?: Record<string, string>; stdin?: Buffer | string | ReturnType<typeof Bun.file>; timeout?: number } = {}): RunResult {
    const r = Bun.spawnSync({
      cmd,
      env: opts.env ?? this.env(),
      stdin: opts.stdin === undefined ? "ignore" : typeof opts.stdin === "string" ? Buffer.from(opts.stdin) : opts.stdin,
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts.timeout ?? 30_000,
    });
    const stdout = Buffer.from(r.stdout ?? new Uint8Array());
    return {
      code: r.exitCode,
      stdout,
      out: stdout.toString("utf8"),
      err: Buffer.from(r.stderr ?? new Uint8Array()).toString("utf8"),
      timedOut: Boolean((r as { exitedDueToTimeout?: boolean }).exitedDueToTimeout),
    };
  }

  /** The gate, as sshd would run it for a lane. cmd undefined = unset. */
  gate(peer: string, cmd: string | undefined, stdin?: Buffer | string | ReturnType<typeof Bun.file>, opts: { argv?: string[]; timeout?: number } = {}): RunResult {
    const env = { PATH: "/usr/bin:/bin", HOME: this.ferryHome, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8", FERRY_TEST_CTL: this.ctl } as Record<string, string>;
    if (cmd !== undefined) env.SSH_ORIGINAL_COMMAND = cmd;
    return this.run([this.shell, this.gatePath, ...(opts.argv ?? ["--peer", peer])], { env, stdin, timeout: opts.timeout });
  }

  /** "put lobby" as the client sends it: the command declares the size. */
  putLobby(peer: string, body: Buffer | string, opts: { timeout?: number } = {}): RunResult {
    return this.gate(peer, `put lobby ${byteLength(body)}`, body, opts);
  }

  /** "put file" as the client sends it: the command declares the size. */
  putFile(peer: string, to: string, name: string, body: Buffer | string | ReturnType<typeof Bun.file>, opts: { timeout?: number } = {}): RunResult {
    return this.gate(peer, `put file ${to} ${name} ${byteLength(body)}`, body, opts);
  }

  hub(args: string[], opts: { timeout?: number } = {}): RunResult {
    return this.run([this.shell, this.hubPath, ...args], { timeout: opts.timeout });
  }

  admin(args: string[], tty?: string): RunResult {
    if (tty === undefined) rmSync(join(this.ctl, "tty"), { force: true });
    else writeFileSync(join(this.ctl, "tty"), tty);
    return this.run([this.shell, this.adminPath, ...args], { env: this.env({ SUDO_USER: RUNNER }) });
  }

  mac(name: string): Mac {
    return new Mac(this, name);
  }

  gateLog(): string {
    const p = join(this.ferryHome, "log", "gate.log");
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }

  hubLog(): string {
    const p = join(this.hubHome, ".local/state/agenttool/ferry-hub/hub.log");
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }

  spoolDigest(): string {
    return treeDigest(this.spool);
  }

  /** Every item id published under a spool directory. */
  ids(rel: string): string[] {
    const dir = join(this.spool, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => n.endsWith(".meta")).map((n) => n.slice(0, -5)).sort();
  }

  sshCalls(): string[][] {
    const p = join(this.ctl, "ssh.calls");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("--call--\n").filter((c) => c !== "").map((c) => c.replace(/\n$/, "").split("\n"));
  }

  /** Plant an item exactly as fs_publish would leave it. */
  plant(rel: string, item: { id: string; kind: "lobby-enroll" | "lobby-join" | "file"; from: string; to: string; body: Buffer | string; name?: string; meta?: string }): void {
    const dir = join(this.spool, rel);
    const body = typeof item.body === "string" ? Buffer.from(item.body) : item.body;
    const meta = item.meta ?? [
      "ferry-meta/1",
      `kind=${item.kind}`,
      `from=${item.from}`,
      `to=${item.to}`,
      `size=${body.length}`,
      `sha256=${sha256Hex(body)}`,
      ...(item.kind === "file" ? [`name=${item.name ?? "x.txt"}`] : []),
      "",
    ].join("\n");
    writeFileSync(join(dir, `${item.id}.body`), body);
    chmodSync(join(dir, `${item.id}.body`), 0o640);
    writeFileSync(join(dir, `${item.id}.meta`), meta);
    chmodSync(join(dir, `${item.id}.meta`), 0o640);
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** One fake Mac with its own HOME, talking to the lab through the fake ssh. */
export class Mac {
  readonly home: string;
  constructor(readonly lab: Lab, readonly name: string) {
    this.home = join(lab.root, "Users", `${name}-home`);
    mkdirSync(this.home, { recursive: true });
  }

  get keyPath(): string {
    return join(this.home, ".ssh", "ferry", `ferry_${this.name}_ed25519`);
  }

  get state(): string {
    return join(this.home, ".local/state/agenttool/ferry");
  }

  run(args: string[], opts: { stdin?: Buffer | string; asRoot?: boolean; timeout?: number } = {}): RunResult {
    const script = opts.asRoot ? this.lab.rootClientPath : this.lab.clientPath;
    return this.lab.run([this.lab.shell, script, ...args], {
      env: { PATH: "/usr/bin:/bin", HOME: this.home, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", ...this.lab.fakeEnv() },
      stdin: opts.stdin,
      timeout: opts.timeout,
    });
  }

  /** init, map the lane key to this peer in the fake ssh, and pin the hub. */
  setup(): void {
    const init = this.run(["init", "--self", this.name]);
    if (init.code !== 0) throw new Error(`init failed: ${init.err}`);
    writeFileSync(join(this.lab.ctl, "keymap"), `${this.keyPath} ${this.name}\n`, { flag: "a" });
    this.pin();
  }

  pin(extra: string[] = []): RunResult {
    writeFileSync(join(this.lab.ctl, "keyscan.out"), `${HUB_HOST} ssh-ed25519 ${this.lab.hostKeyB64}\n`);
    const r = this.run(["peer", "add", "hub", "--host", HUB_HOST, "--host-key-fp", this.lab.hostKeyFp, ...extra]);
    if (r.code !== 0) throw new Error(`peer add failed: ${r.err}`);
    return r;
  }
}

export function byteLength(body: Buffer | string | ReturnType<typeof Bun.file>): number {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (Buffer.isBuffer(body)) return body.length;
  return body.size;
}

export function writeFile(path: string, data: Buffer | string, mode = 0o644): string {
  writeFileSync(path, data);
  chmodSync(path, mode);
  return path;
}

export function idAt(date: Date, hex = "0a1b2c3d"): string {
  const t = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${t}-${hex}`;
}

export const ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
