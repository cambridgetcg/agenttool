import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataNode, serveDataNode } from "../src/index.js";
import { parseCliArgs } from "../src/cli.js";

const TOKEN = "cli-test-dedicated-node-token";
const roots: string[] = [];
const nodes: DataNode[] = [];
const servers: Array<Bun.Server<unknown>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const node of nodes.splice(0)) node.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function startNode(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-data-cli-test-"));
  roots.push(root);
  const node = await DataNode.open({ root, collections: [{ id: "conformance" }] });
  nodes.push(node);
  const server = serveDataNode(node, { port: 0, node_bearer: TOKEN });
  servers.push(server);
  return server.url.origin;
}

async function runCli(
  args: string[],
  options: { stdin?: string; env?: Record<string, string> } = {},
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const subprocess = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined && subprocess.stdin) {
    subprocess.stdin.write(options.stdin);
    subprocess.stdin.end();
  }
  const [exit, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}

describe("agenttool-data CLI", () => {
  test("keeps legacy serve syntax while rejecting unknown commands and flags", () => {
    expect(parseCliArgs([])).toEqual({ command: "serve" });
    expect(parseCliArgs(["--root=.state"])).toEqual({ command: "serve", root: ".state" });
    expect(parseCliArgs(["serve", "--root", ".state"])).toEqual({ command: "serve", root: ".state" });
    expect(() => parseCliArgs(["unknown"])).toThrow("Unknown command");
    expect(() => parseCliArgs(["serve", "--wat"])).toThrow("Unknown serve option");
  });

  test("emits one JSON report and exits 0 for public and stdin-authenticated profiles", async () => {
    const origin = await startNode();
    const publicRun = await runCli(["doctor", origin, "--profile", "public", "--format", "json"]);
    expect(publicRun.exit).toBe(0);
    expect(publicRun.stderr).toBe("");
    expect(JSON.parse(publicRun.stdout)).toMatchObject({
      schema: "agent-data-conformance-report/v1",
      verdict: "pass",
      run: { profile: "public" },
    });

    const readRun = await runCli([
      "doctor",
      origin,
      "--profile",
      "read",
      "--token-stdin",
      "--format=json",
    ], { stdin: `${TOKEN}\n` });
    expect(readRun.exit).toBe(0);
    expect(readRun.stderr).toBe("");
    expect(JSON.parse(readRun.stdout)).toMatchObject({ verdict: "pass", run: { profile: "read" } });
    expect(readRun.stdout).not.toContain(TOKEN);

    const envRun = await runCli([
      "doctor",
      origin,
      "--profile=read",
      "--token-env=CLI_NODE_TOKEN",
      "--format=json",
    ], { env: { CLI_NODE_TOKEN: TOKEN, AT_API_KEY: "must-not-be-used" } });
    expect(envRun.exit).toBe(0);
    expect(JSON.parse(envRun.stdout).verdict).toBe("pass");
    expect(envRun.stdout).not.toContain(TOKEN);
  });

  test("rejects argv credentials without reflecting the value", async () => {
    const canary = "ARGV_CANARY_SECRET_129af";
    const hash = createHash("sha256").update(canary).digest("hex");
    const result = await runCli([
      "doctor",
      "https://node.example",
      "--profile=read",
      `--token=${canary}`,
    ]);
    expect(result.exit).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain(canary);
    expect(`${result.stdout}${result.stderr}`).not.toContain(hash);
    expect(result.stderr).toContain("credential_in_argv");

    const ambientOnly = await runCli([
      "doctor",
      "https://node.example",
      "--profile=read",
    ], { env: { AT_API_KEY: canary, AGENTTOOL_API_KEY: canary } });
    expect(ambientOnly.exit).toBe(2);
    expect(`${ambientOnly.stdout}${ambientOnly.stderr}`).not.toContain(canary);
    expect(ambientOnly.stderr).toContain("credential_source_missing");
  });

  test("uses exit 1 for observed mismatch and exit 3 when the target is unreachable", async () => {
    const redirectServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("redirect body", {
        status: 307,
        headers: { location: "https://elsewhere.invalid/echo" },
      }),
    });
    servers.push(redirectServer);
    const mismatch = await runCli([
      "doctor",
      redirectServer.url.origin,
      "--profile=public",
      "--format=json",
    ]);
    expect(mismatch.exit).toBe(1);
    expect(JSON.parse(mismatch.stdout).verdict).toBe("fail");

    const unreachable = await runCli([
      "doctor",
      "http://127.0.0.1:1",
      "--profile=public",
      "--format=json",
      "--timeout-ms=100",
    ]);
    expect(unreachable.exit).toBe(3);
    expect(JSON.parse(unreachable.stdout).verdict).toBe("inconclusive");
  });

  test("names the local state boundary when serve cannot open its configured root", async () => {
    const result = await runCli(["serve"], { env: { AGENT_DATA_DIR: "/dev/null/agent-data" } });
    expect(result.exit).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("data_node_open_failed");
    expect(result.stderr).toContain("directory permissions and storage health");
  });
});
