/** `agenttool-exit-door` CLI: argv/credential boundary and exit codes.
 *
 *  Parser cases run `runExitDoorCli` with injected process seams. The
 *  end-to-end cases spawn the real bin entry (`src/cli/exit-door.ts`) against
 *  a real `@agenttool/data` node and the stub hosted API, each on a loopback
 *  port-0 socket. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DataNode, serveDataNode } from "../../data/src/index.js";
import { runExitDoorCli, type ExitDoorCliIo } from "../src/cli/_exit-door-cli.js";
import { createHostedFake } from "./_exit-door-fixture.js";

const PROJECT_KEY = "at_cli_project_key_value";
const NODE_TOKEN = "cli_node_bearer_value";
const BIN = join(import.meta.dir, "..", "src", "cli", "exit-door.ts");

function fakeIo(options: { env?: Record<string, string>; stdin?: string; tty?: boolean } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let stdinReads = 0;
  const io: ExitDoorCliIo = {
    env: options.env ?? {},
    stdinIsTTY: options.tty ?? false,
    async readStdin() {
      stdinReads += 1;
      return new TextEncoder().encode(options.stdin ?? "");
    },
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
  };
  return { io, out, err, stdinReads: () => stdinReads };
}

describe("agenttool-exit-door argv and credential boundary", () => {
  const usageCases: Array<[string, string[], string]> = [
    ["no command", [], "command_missing"],
    ["unknown command", ["import"], "command_unknown"],
    ["hosted token in argv", ["plan", "--hosted-token", PROJECT_KEY], "credential_in_argv"],
    ["node token inline in argv", ["export", `--node-token=${NODE_TOKEN}`], "credential_in_argv"],
    ["generic token flag", ["plan", "--token", "x"], "credential_in_argv"],
    ["api key flag", ["plan", "--api-key=x"], "credential_in_argv"],
    ["two stdin tokens", [
      "export", "--hosted-token-stdin", "--node-token-stdin", "--node-url", "http://127.0.0.1:1", "--collection", "c",
    ], "credential_stdin_conflict"],
    ["two hosted sources", ["plan", "--hosted-token-env", "A", "--hosted-token-stdin"], "credential_source_conflict"],
    ["plan with a node", ["plan", "--hosted-token-env", "A", "--node-url", "http://127.0.0.1:1"], "option_not_for_command"],
    ["export without collection", [
      "export", "--hosted-token-env", "A", "--node-url", "http://127.0.0.1:1", "--node-token-env", "B",
    ], "option_required"],
    ["verify with a hosted token", [
      "verify", "--manifest", `rec_${"a".repeat(64)}`, "--node-url", "http://127.0.0.1:1", "--node-token-env", "B", "--hosted-token-env", "A",
    ], "option_not_for_command"],
    ["verify with a bad manifest id", ["verify", "--manifest", "rec_nope"], "manifest_invalid"],
    ["unknown store", ["plan", "--hosted-token-env", "A", "--stores", "memories,vault_values"], "store_unknown"],
    ["bad env name", ["plan", "--hosted-token-env", "1BAD"], "invalid_env_name"],
    ["url with credentials", ["plan", "--hosted-token-env", "A", "--hosted-url", "https://u:p@api.test"], "invalid_url"],
    ["unknown option", ["plan", "--hosted-token-env", "A", "--yes"], "option_unknown"],
    ["repeated option", ["plan", "--hosted-token-env", "A", "--stores", "memories", "--stores", "chronicle"], "option_repeated"],
  ];
  for (const [name, args, code] of usageCases) {
    test(`usage error (exit 2): ${name}`, async () => {
      const { io, err, out } = fakeIo();
      expect(await runExitDoorCli(args, io)).toBe(2);
      expect(err.join("")).toContain(`: ${code}:`);
      expect(out).toEqual([]);
      expect(err.join("")).not.toContain(PROJECT_KEY);
      expect(err.join("")).not.toContain(NODE_TOKEN);
    });
  }

  test("an unset named variable is a usage error that names only the variable", async () => {
    const { io, err } = fakeIo({ env: {} });
    expect(await runExitDoorCli(["plan", "--hosted-token-env", "AT_EXIT_KEY"], io)).toBe(2);
    expect(err.join("")).toContain("credential_env_missing");
    expect(err.join("")).toContain("AT_EXIT_KEY");
  });

  test("stdin tokens refuse an interactive terminal and multi-line input", async () => {
    const tty = fakeIo({ tty: true });
    expect(await runExitDoorCli(["plan", "--hosted-token-stdin"], tty.io)).toBe(2);
    expect(tty.err.join("")).toContain("credential_stdin_tty");
    expect(tty.stdinReads()).toBe(0);

    const multi = fakeIo({ stdin: "one\ntwo\n" });
    expect(await runExitDoorCli(["plan", "--hosted-token-stdin"], multi.io)).toBe(2);
    expect(multi.err.join("")).toContain("credential_not_single_line");
  });

  test("--help prints usage and exits 0", async () => {
    const { io, out } = fakeIo();
    expect(await runExitDoorCli(["--help"], io)).toBe(0);
    expect(out.join("")).toContain("Exit codes: 0 complete, 3 partial, 1 failed, 2 usage.");
  });
});

// ── end to end: the real bin entry, a real node, the stub host ───────────

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function servers(paged: boolean) {
  const root = await mkdtemp(join(tmpdir(), "exit-door-cli-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const node = await DataNode.open({ root, collections: [{ id: "agenttool-exit" }] });
  cleanups.push(() => node.close());
  const nodeServer = serveDataNode(node, { port: 0, node_bearer: NODE_TOKEN });
  cleanups.push(() => nodeServer.stop(true));
  const fake = createHostedFake({ paged, bearer: PROJECT_KEY, maxPage: 2 });
  const hostedServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: fake.handle });
  cleanups.push(() => hostedServer.stop(true));
  return {
    node,
    nodeUrl: `http://127.0.0.1:${nodeServer.port}`,
    hostedUrl: `http://127.0.0.1:${hostedServer.port}`,
  };
}

async function runBin(args: string[], options: { env?: Record<string, string>; stdin?: string } = {}) {
  const child = Bun.spawn({
    cmd: [process.execPath, BIN, ...args],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...options.env,
    },
    stdin: options.stdin !== undefined ? new TextEncoder().encode(options.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  for (const secret of [PROJECT_KEY, NODE_TOKEN]) {
    expect(stdout).not.toContain(secret);
    expect(stderr).not.toContain(secret);
  }
  return { stdout, stderr, code };
}

describe("agenttool-exit-door end to end", () => {
  test("export exits 0 on a complete copy and verify confirms it", async () => {
    const s = await servers(true);
    const exported = await runBin([
      "export",
      "--hosted-url", s.hostedUrl,
      "--hosted-token-env", "EXIT_HOSTED_TOKEN",
      "--node-url", s.nodeUrl,
      "--node-token-stdin",
      "--collection", "agenttool-exit",
    ], { env: { EXIT_HOSTED_TOKEN: PROJECT_KEY }, stdin: `${NODE_TOKEN}\n` });
    expect(exported.code).toBe(0);
    const result = JSON.parse(exported.stdout) as { manifest_record_id: string; manifest: { overall: string } };
    expect(result.manifest.overall).toBe("complete");
    expect(s.node.getRecord(result.manifest_record_id)).not.toBeNull();

    const verified = await runBin([
      "verify",
      "--manifest", result.manifest_record_id,
      "--node-url", s.nodeUrl,
      "--node-token-env", "EXIT_NODE_TOKEN",
    ], { env: { EXIT_NODE_TOKEN: NODE_TOKEN } });
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout).verified).toBe(true);
  }, 30_000);

  test("export exits 3 against a host without cursors; plan agrees", async () => {
    const s = await servers(false);
    const exported = await runBin([
      "export",
      "--hosted-url", s.hostedUrl,
      "--hosted-token-env", "EXIT_HOSTED_TOKEN",
      "--node-url", s.nodeUrl,
      "--node-token-env", "EXIT_NODE_TOKEN",
      "--collection", "agenttool-exit",
      "--progress",
    ], { env: { EXIT_HOSTED_TOKEN: PROJECT_KEY, EXIT_NODE_TOKEN: NODE_TOKEN } });
    expect(exported.code).toBe(3);
    expect(JSON.parse(exported.stdout).manifest.overall).toBe("partial");
    expect(exported.stderr).toContain('"event":"page"');

    const planned = await runBin([
      "plan",
      "--hosted-url", s.hostedUrl,
      "--hosted-token-stdin",
      "--stores", "memories,covenants",
    ], { stdin: PROJECT_KEY });
    expect(planned.code).toBe(3);
    expect(JSON.parse(planned.stdout).stores[0].reason).toBe("host_has_no_cursor");
  }, 30_000);

  test("guard refusals exit 1 with only a reduced code on stderr", async () => {
    const s = await servers(true);
    const reused = await runBin([
      "export",
      "--hosted-url", s.hostedUrl,
      "--hosted-token-env", "SAME",
      "--node-url", s.nodeUrl,
      "--node-token-env", "SAME",
      "--collection", "agenttool-exit",
    ], { env: { SAME: PROJECT_KEY } });
    expect(reused.code).toBe(1);
    expect(JSON.parse(reused.stderr.trim())).toEqual({ error: "data_node_token_reuses_project_bearer" });
    expect(reused.stdout).toBe("");

    const wrongHosted = await runBin([
      "plan",
      "--hosted-url", s.hostedUrl,
      "--hosted-token-env", "WRONG",
      "--stores", "memories",
    ], { env: { WRONG: "not-the-project-key" } });
    expect(wrongHosted.code).toBe(1);
    const plan = JSON.parse(wrongHosted.stdout);
    expect(plan.overall).toBe("failed");
    expect(plan.stores[0].reason).toBe("unauthorized");
  }, 30_000);
});
