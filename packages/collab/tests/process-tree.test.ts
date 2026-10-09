import { describe, expect, test } from "bun:test";
import {
  ancestry,
  hostKindOf,
  isCollabMcpProcess,
  isHostProcess,
  nearestHost,
  parseProcessTable,
  readProcessTable,
  type ProcessRecord,
  type ProcessTable,
} from "../src/process-tree.js";

function record(pid: number, ppid: number, comm: string, args = comm): ProcessRecord {
  return { pid, ppid, started_at: `Fri Oct 9 10:00:${String(pid % 60).padStart(2, "0")} 2026`, comm, args };
}

function table(...records: ProcessRecord[]): ProcessTable {
  return new Map(records.map((entry) => [entry.pid, entry]));
}

describe("process table parsing", () => {
  test("collapses lstart spacing, keeps spaced executable paths, and joins argv", () => {
    const parsed = parseProcessTable(
      [
        "    1     0 Thu Oct  8 08:00:01 2026     /sbin/launchd",
        "43795 43695 Thu Oct  8 21:50:55 2026     claude",
        " 1212   782 Fri Oct  9 07:12:03 2026     /Applications/Some App.app/Contents/Resources/codex",
        "not a process line",
      ].join("\n"),
      [
        "    1 /sbin/launchd",
        "43795 claude --resume",
        " 1212 /Applications/Some App.app/Contents/Resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled",
        "99999 a process that ended between the two ps calls",
      ].join("\n"),
    );
    expect([...parsed.keys()]).toEqual([1, 43795, 1212]);
    expect(parsed.get(43795)).toEqual({
      pid: 43795,
      ppid: 43695,
      started_at: "Thu Oct 8 21:50:55 2026",
      comm: "claude",
      args: "claude --resume",
    });
    expect(parsed.get(1212)?.comm).toBe("/Applications/Some App.app/Contents/Resources/codex");
    expect(parsed.get(1212)?.started_at).toBe("Fri Oct 9 07:12:03 2026");
  });

  test("reads this test process from the real process table", () => {
    const live = readProcessTable();
    expect(live).not.toBeNull();
    const self = live!.get(process.pid);
    expect(self?.ppid).toBe(process.ppid);
    expect(self?.started_at).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/);
  });
});

describe("host classification (S2 rules)", () => {
  test("claude needs the MCP's CLAUDE_CODE_SESSION_ID; codex splits TUI/exec, app-server and its supervisor", () => {
    const claude = record(100, 1, "/Users/someone/.local/bin/claude", "claude");
    expect(hostKindOf(claude, { CLAUDE_CODE_SESSION_ID: "abc" })).toBe("claude-code");
    expect(hostKindOf(claude, {})).toBe("unknown");
    expect(hostKindOf(claude, { CLAUDE_CODE_SESSION_ID: "" })).toBe("unknown");
    expect(hostKindOf(claude, { CLAUDE_PID: "100" })).toBe("unknown");
    expect(hostKindOf(record(101, 1, "codex", "codex"), {})).toBe("codex");
    expect(hostKindOf(record(102, 1, "codex", "codex -a never exec --json -"), {})).toBe("codex");
    expect(hostKindOf(record(
      103, 1, "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled",
    ), {})).toBe("codex-app-server");
    expect(hostKindOf(record(
      104, 1, "/x/app-server-daemon/releases/0.162.0/bin/codex",
      "/x/app-server-daemon/releases/0.162.0/bin/codex app-server --listen unix:// --managed-daemon",
    ), {})).toBe("codex-app-server");
    const supervisor = record(
      105, 1, "/x/app-server-daemon/releases/0.162.0/bin/codex",
      "/x/app-server-daemon/releases/0.162.0/bin/codex app-server daemon pid-update-loop",
    );
    expect(hostKindOf(supervisor, {})).toBe("unknown");
    expect(isHostProcess(supervisor)).toBe(false);
    expect(hostKindOf(record(106, 1, "bun", "bun dist/agenttool-collab-mcp.js"), {})).toBe("unknown");
    expect(isHostProcess(claude)).toBe(true);
    expect(isHostProcess(record(107, 1, "/bin/zsh"))).toBe(false);
  });

  test("recognises collab MCP processes by argv", () => {
    expect(isCollabMcpProcess(record(1, 1, "bun", "bun dist/agenttool-collab-mcp.js"))).toBe(true);
    expect(isCollabMcpProcess(record(2, 1, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"))).toBe(true);
    expect(isCollabMcpProcess(record(3, 1, "bun", "/abs/bun /abs/pkg/dist/agenttool-collab-mcp.js"))).toBe(true);
    expect(isCollabMcpProcess(record(6, 1, "bun", "/abs/bun /abs/pkg/bin/agenttool-collab-mcp.ts"))).toBe(true);
    expect(isCollabMcpProcess(record(4, 1, "bun", "bun dist/agenttool-collab-host.js knocks"))).toBe(false);
    expect(isCollabMcpProcess(record(5, 1, "node", "node not-agenttool-collab-mcp-x.js"))).toBe(false);
    expect(isCollabMcpProcess(record(7, 1, "/bin/zsh", "/bin/zsh -c knock-tap"))).toBe(false);
  });
});

describe("nearestHost", () => {
  const tree = table(
    record(1, 0, "/sbin/launchd"),
    record(4100, 1, "claude"),
    record(4101, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"),
    record(4200, 4100, "/bin/zsh"),
    record(4201, 4200, "bun", "bun dist/agenttool-collab-mcp.js"),
  );

  test("is the MCP's direct parent, classified, never a further ancestor", () => {
    expect(nearestHost(4101, { process_table: () => tree, env: { CLAUDE_CODE_SESSION_ID: "s" } })).toEqual({
      pid: 4100,
      started_at: tree.get(4100)!.started_at,
      kind: "claude-code",
    });
    // A collab MCP started from a tool shell binds to that shell, not to the seat above it.
    expect(nearestHost(4201, { process_table: () => tree, env: { CLAUDE_CODE_SESSION_ID: "s" } })).toEqual({
      pid: 4200,
      started_at: tree.get(4200)!.started_at,
      kind: "unknown",
    });
  });

  test("fails closed: unreadable table, unknown pid, missing parent, or launchd parent", () => {
    expect(nearestHost(4101, { process_table: () => null })).toBeNull();
    expect(nearestHost(9999, { process_table: () => tree })).toBeNull();
    expect(nearestHost(4101, { process_table: () => table(record(4101, 4100, "bun")) })).toBeNull();
    expect(nearestHost(4100, { process_table: () => tree })).toBeNull();
  });

  test("describes this test process's real parent", () => {
    const host = nearestHost(process.pid);
    expect(host?.pid).toBe(process.ppid);
    expect(host?.started_at).toBe(readProcessTable()!.get(process.ppid)!.started_at);
  });
});

describe("ancestry", () => {
  test("lists pid then ancestors, nearest first, and stops at missing pids and cycles", () => {
    const tree = table(record(1, 0, "launchd"), record(10, 1, "claude"), record(20, 10, "zsh"), record(30, 20, "sh"));
    expect(ancestry(30, tree).map((entry) => entry.pid)).toEqual([30, 20, 10, 1]);
    expect(ancestry(77, tree)).toEqual([]);
    const cyclic = table(record(5, 6, "a"), record(6, 5, "b"));
    expect(ancestry(5, cyclic).map((entry) => entry.pid)).toEqual([5, 6]);
  });
});
