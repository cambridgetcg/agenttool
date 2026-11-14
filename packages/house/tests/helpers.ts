/** Hermetic test doubles: an in-memory file system, a scripted runner, a fixed
 * environment and clock. No test looks at the machine it runs on. Every name,
 * address and secret below is made up. */
import { dirname, join } from "node:path";
import type { EntryStat, Fail, HeadRead, HouseFs } from "../src/fs.js";
import type { LookDeps } from "../src/looks.js";
import type { RunOptions, RunResult, Runner } from "../src/run.js";

export const packageRoot = join(import.meta.dir, "..");
export const repoRoot = join(packageRoot, "..", "..");

export const NOW = new Date("2026-11-14T12:00:00.000Z");
export const UID = 501;

/** A made-up person and device. None of these may ever appear in an output. */
export const HOME = "/Users/quillon";
export const USER = "quillon";
export const HOST = "quillons-air.local";
export const FORBIDDEN = [
  "quillon", "Quillon", "quillons-air", "/Users/", "192.168", "10.0.0.7", "fe80", "atcm_", "ghp_", "sk_live", "sk-proj",
  "xoxb", "example.com", "Desktop", "consent/v3-secret-value", "secret-project", "Bearer", "curl", "notify", "hunter2",
];

export type FakeNode =
  | { type: "dir"; mtime?: number; uid?: number; mode?: number }
  | { type: "file"; text: string; mtime?: number; uid?: number; mode?: number }
  | { type: "link"; target: string; mtime?: number }
  | { type: "denied" }
  | { type: "fifo" };

export interface FsCall {
  op: "lstat" | "readlink" | "list" | "readHead" | "readChosen";
  path: string;
}

export class FakeFs implements HouseFs {
  readonly calls: FsCall[] = [];
  readonly nodes = new Map<string, FakeNode>();

  constructor(entries: Record<string, FakeNode> = {}) {
    for (const [path, node] of Object.entries(entries)) this.put(path, node);
  }

  put(path: string, node: FakeNode): this {
    for (let parent = dirname(path); parent !== "/" && !this.nodes.has(parent); parent = dirname(parent)) {
      this.nodes.set(parent, { type: "dir" });
    }
    this.nodes.set(path, node);
    return this;
  }

  remove(path: string): this {
    for (const key of [...this.nodes.keys()]) if (key === path || key.startsWith(`${path}/`)) this.nodes.delete(key);
    return this;
  }

  /** Resolve every component but the last through links, as the kernel does for lstat. */
  private resolveParent(path: string): string | Fail {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = `${current}/${parts[index]}`;
      for (let hops = 0; hops < 8; hops += 1) {
        const node = this.nodes.get(current);
        if (node === undefined) return { fail: "absent" };
        if (node.type === "denied") return { fail: "denied" };
        if (node.type !== "link") break;
        current = node.target.startsWith("/") ? node.target : join(dirname(current), node.target);
      }
      const node = this.nodes.get(current);
      if (node === undefined) return { fail: "absent" };
      if (node.type !== "dir") return { fail: "absent" };
    }
    return join(current || "/", parts.at(-1) ?? "");
  }

  private node(path: string): FakeNode | Fail {
    const resolved = this.resolveParent(path);
    if (typeof resolved !== "string") return resolved;
    const node = this.nodes.get(resolved);
    if (node === undefined) return { fail: "absent" };
    if (node.type === "denied") return { fail: "denied" };
    return node;
  }

  lstat(path: string): EntryStat | Fail {
    this.calls.push({ op: "lstat", path });
    const node = this.node(path);
    if ("fail" in node) return node;
    const kind = node.type === "dir" ? "directory" : node.type === "file" ? "file" : node.type === "link" ? "link" : "other";
    const defaultMode = node.type === "dir" ? 0o40755 : node.type === "link" ? 0o120755 : 0o100644;
    const mode = "mode" in node && node.mode !== undefined ? node.mode : defaultMode;
    const uid = "uid" in node && node.uid !== undefined ? node.uid : UID;
    const mtime = "mtime" in node && node.mtime !== undefined ? node.mtime : NOW.getTime() - 86_400_000;
    const size = node.type === "file" ? Buffer.byteLength(node.text) : 0;
    return { kind, mtimeMs: mtime, size, uid, mode };
  }

  readlink(path: string): string | Fail {
    this.calls.push({ op: "readlink", path });
    const node = this.node(path);
    if ("fail" in node) return node;
    return node.type === "link" ? node.target : { fail: "failed" };
  }

  list(path: string): string[] | Fail {
    this.calls.push({ op: "list", path });
    const node = this.node(path);
    if ("fail" in node) return node;
    if (node.type !== "dir") return { fail: "failed" };
    const prefix = `${path}/`;
    return [...this.nodes.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/")).map((key) => key.slice(prefix.length));
  }

  private read(path: string, maxBytes: number, follow: boolean): HeadRead | Fail {
    let node = this.node(path);
    for (let hops = 0; follow && hops < 8 && !("fail" in node) && node.type === "link"; hops += 1) {
      const target: string = node.target.startsWith("/") ? node.target : join(dirname(path), node.target);
      node = this.node(target);
    }
    if ("fail" in node) return node;
    if (node.type !== "file") return { fail: "failed" }; // O_NOFOLLOW on a link fails; so does a directory
    const bytes = Buffer.from(node.text, "utf8");
    return { text: bytes.subarray(0, maxBytes).toString("utf8"), truncated: bytes.length > maxBytes };
  }

  readHead(path: string, maxBytes: number): HeadRead | Fail {
    this.calls.push({ op: "readHead", path });
    return this.read(path, maxBytes, false);
  }

  readChosen(path: string, maxBytes: number): HeadRead | Fail {
    this.calls.push({ op: "readChosen", path });
    return this.read(path, maxBytes, true);
  }
}

export type AskAnswer = Partial<RunResult>;

export class FakeRunner implements Runner {
  readonly calls: Array<{ argv: string[]; options: RunOptions }> = [];
  constructor(public answers: { help?: AskAnswer; weather?: AskAnswer } = {}) {}

  async run(argv: readonly string[], options: RunOptions): Promise<RunResult> {
    this.calls.push({ argv: [...argv], options });
    const answer = argv.at(-1) === "--help" ? this.answers.help : this.answers.weather;
    if (answer === undefined) return { exitCode: null, stdout: "", timedOut: false, truncated: false, spawnFailed: true };
    return { exitCode: 0, stdout: "", timedOut: false, truncated: false, spawnFailed: false, ...answer };
  }
}

export const HELP_WITH_WEATHER = {
  stdout: `${JSON.stringify({
    protocol: "agenttool.collab-host/1",
    status: "help",
    usage: "usage: agenttool-collab-host end (--session-file <path> | --seat-ref <ref>) --reason <text> | agenttool-collab-host wait (--session <id>) "
      + "| agenttool-collab-host weather (this device's power, processors, memory, graphics and uplink now; no journal) | agenttool-collab-host person ...",
  })}\n`,
};
export const HELP_WITHOUT_WEATHER = {
  stdout: `${JSON.stringify({
    protocol: "agenttool.collab-host/1",
    status: "help",
    usage: "usage: agenttool-collab-host end (--session-file <path> | --seat-ref <ref>) --reason <text> | agenttool-collab-host wait (--session <id>) | agenttool-collab-host person ...",
  })}\n`,
};

export const WEATHER_SAYS = "On mains power, battery full at 100%; load 2.1 on 8 cores; memory pressure normal; Wi-Fi, route reported reachable. Read 11:59:58Z; good for about a minute.";
export const WEATHER_NOTE = "This device woke 120 seconds ago from a sleep that began at 2026-11-14T11:30:00.000Z: no session on it could read or answer between those two times, so silence across them means the device slept, not that anyone agreed.";

export function weatherReceipt(overrides: { says?: unknown; notes?: unknown; power?: Record<string, unknown> } = {}): string {
  const weather = {
    protocol: "agenttool.collab-weather/1",
    read_at: "2026-11-14T11:59:58.000Z",
    good_for_seconds: 60,
    platform: "darwin",
    basis: "Read by this process from the operating system just now; self-declared, and nothing attests it.",
    authorises: "Nothing: this is a reading, not a permission.",
    says: "says" in overrides ? overrides.says : WEATHER_SAYS,
    notes: "notes" in overrides ? overrides.notes : [WEATHER_NOTE],
    power: {
      source: "ac", battery_percent: 100, battery_state: "full", minutes_remaining: null, low_power_mode: false, sleep_prevented: null,
      awake_since: "2026-11-14T11:58:00.000Z", last_slept_at: "2026-11-14T11:30:00.000Z",
      ...overrides.power,
    },
    cpu: { chip: "Apple M9", cores: 8, load_1m: 2.1 },
    memory: { total_bytes: 17179869184, pressure: "normal", swap_used_bytes: 0 },
    gpu: { devices: [], shares_system_memory: true },
    network: { default_route: true, kind: "wifi", os_reports: "reachable", metered: null },
    inferred: [],
    unknown: [],
  };
  return `${JSON.stringify({ protocol: "agenttool.collab-host/1", status: "weather", weather })}\n`;
}

export const SHARE = `${HOME}/.local/share/agenttool`;
export const STATE = `${HOME}/.local/state/agenttool`;
export const BIN = `${HOME}/.local/bin`;
export const COLLAB_NEW = "0.6.0-dev.0-0f1e2d3c";
export const COLLAB_OLD = "0.5.1-dev.0-a1b2c3d4";
export const COMMIT_NEW = "0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6";
export const COMMIT_OLD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export const LOBBY_VERSION = "0.1.0-dev.0-5e6f7a8b";
export const LOBBY_COMMIT = "5e6f7a8b9c0d1e2f3a4b5c6d7e8f901234567890";
export const SEAT_VERSION = "main-9a8b7c6d";
export const SEAT_COMMIT = "9a8b7c6d5e4f30211203f4e5d6c7b8a998877665";

export function claudeJson(servers: Record<string, unknown>): string {
  return JSON.stringify({
    numStartups: 412,
    userID: "4f1c9e0b7a6d5c3b2a19f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7",
    oauthAccount: { emailAddress: "quillon@example.com", organizationName: "Quillon's org" },
    projects: { "/Users/quillon/secret-project": { allowedTools: [], history: [{ display: "deploy with hunter2" }] } },
    mcpServers: servers,
  }, null, 2);
}

export const CLAUDE_SERVERS = {
  "agenttool-collab": {
    type: "stdio",
    command: "/opt/homebrew/bin/bun",
    args: [`${SHARE}/collab/current/agenttool-collab-mcp.js`],
    env: {
      AGENTOOL_COLLAB_DB: `${SHARE}/collab.sqlite`,
      AGENTOOL_COLLAB_TOOLS: "full",
      AGENTOOL_COLLAB_CONSENT_RULE: "consent/v3-secret-value",
      GITHUB_TOKEN: "ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE",
    },
  },
  "agenttool-lobby": {
    type: "stdio",
    command: "bun",
    args: ["--no-env-file", "--config=/dev/null", `${SHARE}/lobby/current/agenttool-lobby-mcp.js`],
  },
  other: {
    command: "npx",
    args: ["some-server", "--host", HOST, "--ip", "10.0.0.7", "--peer", "fe80::1c2b:3a4d:5e6f:7a8b"],
    env: { API_KEY: `sk_live_${"FAKE".repeat(6)}` },
  },
};

export function claudeSettings(hooks: Record<string, unknown>): string {
  return JSON.stringify({
    env: { SECRET_PASSWORD: "hunter2", ANTHROPIC_API_KEY: "sk-ant-FAKEFAKEFAKEFAKEFAKEFAKE" },
    permissions: { allow: ["Bash(curl:*)"] },
    hooks,
  }, null, 2);
}

export const CLAUDE_HOOKS = {
  SessionStart: [{ hooks: [{ type: "command", command: `bun ${SHARE}/execution-seat/current/bin/agenttool-execution-seat.ts hook claude-code` }] }],
  SessionEnd: [{
    hooks: [{
      type: "command",
      timeout: 10,
      command: `bun $HOME/.local/share/agenttool/execution-seat/current/bin/agenttool-execution-seat.ts hook claude-code --collab-host ${SHARE}/collab/current/agenttool-collab-host.js`,
    }],
  }],
  PostToolUse: [{ matcher: "mcp__.*__collab_.*", hooks: [{ type: "command", command: `bun ${SHARE}/execution-seat/current/bin/agenttool-execution-seat.ts hook claude-code` }] }],
  Stop: [{ hooks: [{ type: "command", command: `curl -H 'Authorization: Bearer atcm_FAKEFAKEFAKEFAKE1234' https://${HOST}/notify --data user=quillon` }] }],
};

export function codexToml(withLobby = false, tools = "notes"): string {
  return [
    'model = "gpt-5"',
    'approval_policy = "never"',
    "",
    "[mcp_servers.agenttool-collab]",
    'command = "/opt/homebrew/bin/bun"',
    `args = ["${SHARE}/collab/current/agenttool-collab-mcp.js"]`,
    "",
    "[mcp_servers.agenttool-collab.env]",
    `AGENTOOL_COLLAB_DB = "${SHARE}/collab.sqlite"`,
    `AGENTOOL_COLLAB_TOOLS = "${tools}"`,
    'OPENAI_API_KEY = "sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE"',
    "",
    ...(withLobby ? ["[mcp_servers.agenttool-lobby]", 'command = "bun"', `args = ["${SHARE}/lobby/current/agenttool-lobby-mcp.js"]`, ""] : []),
    "[mcp_servers.secret-server]",
    `command = "/Users/quillon/bin/x"`,
    'env = { TOKEN = "xoxb-FAKEFAKEFAKEFAKE" }',
    "",
  ].join("\n");
}

function source(commit: string, installed: string | null): string {
  return [
    "repo: cambridgetcg/agenttool",
    "branch: main",
    "note: installed by Quillon on quillons-air at 192.168.7.23 with token atcm_FAKEFAKEFAKEFAKE9876",
    `commit: ${commit}`,
    ...(installed === null ? [] : [`installed: ${installed} by Quillon (quillons-air session 1a2b3c4d) at quillon@example.com's request`]),
    "bundler: bun 1.3.5",
    "",
  ].join("\n");
}

const minutesAgo = (minutes: number) => NOW.getTime() - minutes * 60_000;

/** A whole house, as a device that works might hold it. Doors, hooks and wrappers follow `current`. */
export function fullHouse(): FakeFs {
  return new FakeFs({
    [SHARE]: { type: "dir", mode: 0o40700 },
    [`${SHARE}/collab`]: { type: "dir" },
    [`${SHARE}/collab/${COLLAB_OLD}/SOURCE.txt`]: { type: "file", text: source(COMMIT_OLD, "2026-10-29T12:54:29Z") },
    [`${SHARE}/collab/${COLLAB_OLD}/agenttool-collab-host.js`]: { type: "file", text: "// host bundle", mode: 0o100755 },
    [`${SHARE}/collab/${COLLAB_NEW}/SOURCE.txt`]: { type: "file", text: source(COMMIT_NEW, "2026-11-13T16:25:50Z") },
    [`${SHARE}/collab/${COLLAB_NEW}/agenttool-collab-host.js`]: { type: "file", text: "// host bundle", mode: 0o100755 },
    [`${SHARE}/collab/${COLLAB_NEW}/agenttool-collab-mcp.js`]: { type: "file", text: "// mcp bundle", mode: 0o100755 },
    [`${SHARE}/collab/${COLLAB_NEW}/dist`]: { type: "link", target: "." },
    [`${SHARE}/collab/doorbell`]: { type: "dir", mode: 0o40700 },
    [`${SHARE}/collab/install-check/README.md`]: { type: "file", text: "check" },
    [`${SHARE}/collab/current`]: { type: "link", target: COLLAB_NEW },
    [`${SHARE}/collab.sqlite`]: { type: "file", text: "SQLite format 3\u0000 quillon secret rows", mtime: minutesAgo(2 * 24 * 60), mode: 0o100600 },
    [`${SHARE}/collab.sqlite-wal`]: { type: "file", text: "wal hunter2", mtime: minutesAgo(1), mode: 0o100600 },
    [`${SHARE}/collab-sessions/credential.json`]: { type: "file", text: '{"bearer":"atcm_FAKEFAKEFAKEFAKE5555"}', mode: 0o100600 },
    [`${SHARE}/backups/claude-settings.json`]: { type: "file", text: "hunter2" },
    [`${SHARE}/execution-seat/${SEAT_VERSION}/SOURCE.txt`]: { type: "file", text: source(SEAT_COMMIT, "2026-11-13T14:18:37Z") },
    [`${SHARE}/execution-seat/current`]: { type: "link", target: SEAT_VERSION },
    [`${SHARE}/lobby/${LOBBY_VERSION}/SOURCE.txt`]: { type: "file", text: `commit:      ${LOBBY_COMMIT}\nbuilt by quillon\n` },
    [`${SHARE}/lobby/current`]: { type: "link", target: LOBBY_VERSION },
    [`${SHARE}/lobby/RUNBOOK-lab-hub.md`]: { type: "file", text: "hub at 192.168.7.40, project ws_FAKEFAKEFAKE" },
    [`${STATE}/lobby/lobby.sqlite`]: { type: "file", text: "SQLite", mtime: minutesAgo(60), mode: 0o100600 },
    [`${STATE}/lobby/secrets/desk.key`]: { type: "file", text: "-----BEGIN PRIVATE KEY-----", mode: 0o100600 },
    [`${STATE}/execution-seat/seats.sqlite`]: { type: "file", text: "SQLite", mtime: minutesAgo(5), mode: 0o100600 },
    [`${STATE}/lobby-mail/packet.json`]: { type: "file", text: "{}" },
    [`${BIN}/agenttool-collab-host`]: { type: "file", mode: 0o100755, text: `#!/bin/bash\nexport SECRET=hunter2\ncd /\nexec /opt/homebrew/bin/bun --config=/dev/null ${SHARE}/collab/current/agenttool-collab-host.js "$@"\n` },
    [`${BIN}/agenttool-lobby`]: { type: "file", mode: 0o100755, text: '#!/bin/bash\numask 077\ncd /\nexec bun "$HOME/.local/share/agenttool/lobby/current/agenttool-lobby.js" "$@"\n' },
    [`${BIN}/timewitness`]: { type: "link", target: `${HOME}/Desktop/timewitness/timewitness.py` },
    [`${BIN}/carry`]: { type: "file", text: "#!/bin/bash\nexport TOKEN=atcm_FAKEFAKEFAKEFAKE7777\n" },
    [`${BIN}/private-tool`]: { type: "file", text: "hunter2" },
    [`${HOME}/Desktop/timewitness/timewitness.py`]: { type: "file", text: "# quillon's script" },
    [`${HOME}/.claude.json`]: { type: "file", text: claudeJson(CLAUDE_SERVERS), mode: 0o100600 },
    [`${HOME}/.claude/settings.json`]: { type: "file", text: claudeSettings(CLAUDE_HOOKS) },
    [`${HOME}/.codex/config.toml`]: { type: "file", text: codexToml(), mode: 0o100600 },
    [`${HOME}/.env`]: { type: "file", text: "SECRET=hunter2" },
    [`${HOME}/.kingdom/keys/root.key`]: { type: "file", text: "-----BEGIN PRIVATE KEY-----" },
    ["/usr/bin/true"]: { type: "file", text: "" },
  });
}

export function fakeEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    HOME,
    USER,
    LOGNAME: USER,
    PATH: `${BIN}:/opt/homebrew/bin:/usr/bin:/bin`,
    SSH_CONNECTION: "192.168.7.23 50000 192.168.7.1 22",
    AGENTOOL_COLLAB_TOOLS: "notes",
    SECRET_TOKEN: "atcm_FAKEFAKEFAKEFAKE3333",
    ...extra,
  };
}

export function fullRunner(): FakeRunner {
  return new FakeRunner({ help: HELP_WITH_WEATHER, weather: { stdout: weatherReceipt() } });
}

export function makeDeps(overrides: Partial<LookDeps> = {}): LookDeps {
  return {
    fs: fullHouse(),
    run: fullRunner(),
    env: fakeEnv(),
    home: HOME,
    now: NOW,
    uid: UID,
    hints: { home: HOME, user: USER, host: HOST },
    platform: "darwin",
    ...overrides,
  };
}

export function partOf<T extends { parts: Array<{ id: string }> }>(survey: T, id: string): T["parts"][number] {
  const part = survey.parts.find((candidate) => candidate.id === id);
  if (part === undefined) throw new Error(`no part ${id}`);
  return part;
}
