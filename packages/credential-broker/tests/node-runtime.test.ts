import { describe, expect, test } from "bun:test";

describe("published Node runtime surface", () => {
  test("built ESM entrypoint imports under supported Node", () => {
    const source = [
      'import * as broker from "./dist/index.js";',
      'if (typeof broker.AgentCredClient !== "function") process.exit(2);',
      'if (typeof broker.BrokerServer !== "function") process.exit(3);',
      'if (typeof broker.NodeHttpsTransport !== "function") process.exit(4);',
      'if ("getSecret" in broker || "reveal" in broker) process.exit(5);',
    ].join("\n");
    const result = Bun.spawnSync(
      ["node", "--input-type=module", "--eval", source],
      { cwd: new URL("..", import.meta.url).pathname },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
  });

  test("both built CLI entrypoints start under supported Node", () => {
    const cwd = new URL("..", import.meta.url).pathname;
    for (const entrypoint of ["./dist/cli.js", "./dist/controller-cli.js"]) {
      const result = Bun.spawnSync(["node", entrypoint], { cwd });
      expect(result.exitCode).toBe(2);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString()).toStartWith("usage:");
    }
  });
});
