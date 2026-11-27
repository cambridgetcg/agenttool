import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  COLLAB_DOORBELL_SCAN_USAGE,
  COLLAB_HOST_HELP_USAGE,
  COLLAB_HOST_QUIET_VERBS,
  COLLAB_HOST_USAGE,
  COLLAB_HOST_VERBS,
  COLLAB_KNOCKS_SESSION_USAGE,
  COLLAB_KNOCKS_USAGE,
  runCollabHostCli,
} from "../src/host.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store-notes.js";

// What agenttool-collab-host says about itself. Wiring on another Mac may run
// a build that lacks a verb; the answer has to be loud and machine-readable
// without ever disturbing the quiet verbs that hooks and timers call.
const packageRoot = resolve(import.meta.dir, "..");
const VERBS = ["end", "wait", "knocks", "doorbell-scan", "person", "person-remote"];
const QUIET = ["knocks", "doorbell-scan"];
const DESK = ["person", "person-remote"];
const usageLines = [COLLAB_KNOCKS_USAGE, COLLAB_KNOCKS_SESSION_USAGE, COLLAB_DOORBELL_SCAN_USAGE]
  .map((line) => line.slice("usage: ".length));

let directory: string;
let databasePath: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-host-verbs-"));
  mkdirSync(join(directory, "repo"));
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function run(argv: string[]) {
  const result = runCollabHostCli(argv, {});
  return { ...result, receipt: result.line === null ? null : JSON.parse(result.line) as Record<string, any> };
}

describe("agenttool-collab-host verbs and help", () => {
  test("help names every verb, as text and as a list", () => {
    expect([...COLLAB_HOST_VERBS]).toEqual(VERBS);
    expect([...COLLAB_HOST_QUIET_VERBS]).toEqual(QUIET);
    for (const argv of [["--help"], ["-h"], ["end", "--help"], ["wait", "-h"], ["--db", "/nowhere", "--help"]]) {
      const help = run(argv);
      expect(help.exit_code).toBe(0);
      expect(help.receipt).toEqual({
        protocol: "agenttool.collab-host/1",
        status: "help",
        usage: COLLAB_HOST_HELP_USAGE,
        verbs: VERBS,
        quiet_verbs: QUIET,
      });
    }
    expect(COLLAB_HOST_HELP_USAGE.startsWith(COLLAB_HOST_USAGE)).toBe(true);
    for (const line of usageLines) expect(COLLAB_HOST_HELP_USAGE).toContain(line);
    for (const verb of VERBS) expect(COLLAB_HOST_HELP_USAGE).toContain(`agenttool-collab-host ${verb} `);
  });

  test("an unknown verb is answered before its flags, with the verb list and without echoing anything", () => {
    for (const argv of [
      ["frobnicate-TOKEN123"],
      ["frobnicate-TOKEN123", "--host-ancestor", "4242", "--mark-tapped"],
      ["trigger-scan-TOKEN123", "--since", "5", "--help"],
    ]) {
      const refused = run(argv);
      expect(refused.exit_code).toBe(1);
      expect(refused.receipt).toMatchObject({
        protocol: "agenttool.collab-host/1",
        status: "error",
        error: "usage_error",
        verbs: VERBS,
        quiet_verbs: QUIET,
      });
      expect(refused.receipt!.message).toStartWith("Unknown verb");
      expect(refused.receipt!.message).toContain(COLLAB_HOST_HELP_USAGE);
      expect(refused.line).not.toContain("TOKEN123");
      expect(refused.line).not.toContain("4242");
      expect(refused.line).not.toContain("--since");
    }
  });

  test("no verb, or a quiet verb after an option, says the verb comes first", () => {
    for (const argv of [
      [],
      ["--db", "/nowhere"],
      ["--db", "/nowhere", "knocks"],
      ["--db", "/nowhere", "doorbell-scan"],
      // With the quiet verb's own flags, which end and wait do not know.
      ["--db", "/nowhere", "knocks", "--host-ancestor", "4242", "--mark-tapped"],
      ["--db", "/nowhere", "knocks", "--session", "s1", "--mark-tapped"],
      ["--db", "/nowhere", "knocks", "--session", "s1", "--with-sender"],
    ]) {
      const refused = run(argv);
      expect(refused.exit_code).toBe(1);
      expect(refused.receipt).toMatchObject({ status: "error", error: "usage_error", verbs: VERBS, quiet_verbs: QUIET });
      expect(refused.receipt!.message).toContain("first argument");
      expect(refused.receipt!.message).toContain(COLLAB_HOST_HELP_USAGE);
      expect(refused.receipt!.message).not.toStartWith("Unknown verb");
      expect(refused.line).not.toContain("4242");
    }
    // An argument error of end or wait that merely mentions a quiet verb is still that verb's own error.
    const own = run(["end", "--reason", "knocks", "--bogus"]);
    expect(own.receipt!.message).toEndWith(COLLAB_HOST_USAGE);
    expect(own.receipt).not.toHaveProperty("verbs");
  });

  test("every listed verb is answered by this build, quiet verbs silently", () => {
    for (const verb of VERBS) {
      const bare = run([verb, "--bogus"]);
      if (DESK.includes(verb)) {
        // The person's desk answers with its own receipts; it is only shown to be reached here.
        expect(bare.receipt).not.toBeNull();
        expect(bare.receipt!.message ?? "").not.toStartWith("Unknown verb");
        expect(bare.receipt).not.toHaveProperty("verbs");
      } else if (QUIET.includes(verb)) {
        // A quiet verb prints its own protocol's line or nothing, and never exits non-zero.
        expect(bare).toMatchObject({ exit_code: 0, line: null });
        expect(run([verb, "--help"])).toMatchObject({ exit_code: 0, line: null });
      } else {
        expect(bare.exit_code).toBe(1);
        expect(bare.receipt).toMatchObject({ status: "error", error: "usage_error" });
        expect(bare.receipt!.message).not.toStartWith("Unknown verb");
        // An argument error of a known receipt verb keeps that verb's own usage.
        expect(bare.receipt!.message).toEndWith(COLLAB_HOST_USAGE);
      }
    }
  });

  test("person-remote with an argument is told it takes none, not that the verb comes first", () => {
    const refused = run(["person-remote", "extra-TOKEN123"]);
    expect(refused.exit_code).toBe(1);
    expect(refused.receipt).toMatchObject({ status: "error", error: "usage_error" });
    expect(refused.receipt!.message).toStartWith("person-remote takes no arguments");
    expect(refused.receipt!.message).not.toContain("first argument");
    expect(refused.line).not.toContain("TOKEN123");
    // Help is still help, and names every verb.
    expect(run(["person-remote", "--help"]).receipt).toMatchObject({ status: "help", verbs: VERBS });
  });

  test("end and wait still accept an option before the verb", () => {
    const handle = store.startSession({ root_path: join(directory, "repo"), actor: "option-first" });
    writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
    const waited = run(["--db", databasePath, "wait", "--session", handle.session.id, "--wait-ms", "0"]);
    expect(waited.exit_code).toBe(0);
    expect(waited.receipt).toMatchObject({ protocol: "agenttool.collab-host/1", session_id: handle.session.id });
    expect(["idle", "ready"]).toContain(waited.receipt!.status);
  });

  test("the README documents every verb's usage and how to tell a missing verb", async () => {
    const readme = (await Bun.file(join(packageRoot, "README.md")).text()).replace(/\s+/g, " ");
    for (const line of [COLLAB_KNOCKS_USAGE, COLLAB_KNOCKS_SESSION_USAGE, COLLAB_DOORBELL_SCAN_USAGE]) {
      for (const part of line.slice("usage: ".length).split(" | ")) expect(readme).toContain(part);
    }
    // end and wait as the README writes them: one line per form of end.
    for (const usage of [
      "agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]",
      "agenttool-collab-host end --seat-ref <ref> [--seat-ref <ref>...] --reason <text> [--release-leases] [--db <path>]",
      "agenttool-collab-host wait (--session <id> | --session-file <path>) [--after-anchor <json>]",
      "[--wait-ms <ms>] [--include-own] [--addressed [--open]] [--db <path>]",
      "`agenttool-collab-host person`",
      "person-remote`",
    ]) expect(readme).toContain(usage);
    for (const verb of VERBS) expect(readme).toContain(`\`${verb}\``);
    expect(readme).toContain("`verbs`");
    expect(readme).toContain("`quiet_verbs`");
    expect(readme).toContain("exit 1 with a `usage_error` receipt means the verb is absent");
  });
});
