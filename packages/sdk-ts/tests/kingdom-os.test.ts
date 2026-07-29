/**
 * KINGDOM OS SDK adapter tests — injected runners only, no subprocess or HTTP.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  AgentTool,
  AgentToolError,
  KingdomOSClient,
  type KingdomOSCommand,
  type KingdomOSCommandResult,
  type KingdomOSRepository,
  type KingdomOSRunner,
} from "../src/index.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.AT_API_KEY;
const ORIGINAL_ARBITRARY_SECRET = process.env.KINGDOM_TEST_SECRET;

const REPOSITORY: KingdomOSRepository = {
  path: "/Users/test/agenttool",
  name: "agenttool",
  kind: "service",
  layer: "platform",
  domain: "agents",
  state: "active",
  place: "kingdom",
  metadataSource: "card",
  purpose: "Agent collaboration substrate",
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  restoreEnv("AT_API_KEY", ORIGINAL_API_KEY);
  restoreEnv("KINGDOM_TEST_SECRET", ORIGINAL_ARBITRARY_SECRET);
});

function recordingRunner(
  result: KingdomOSCommandResult,
): { calls: KingdomOSCommand[]; runner: KingdomOSRunner } {
  const calls: KingdomOSCommand[] = [];
  return {
    calls,
    runner: async (command) => {
      calls.push(command);
      return result;
    },
  };
}

async function caughtError(promise: Promise<unknown>): Promise<AgentToolError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AgentToolError);
  return caught as AgentToolError;
}

describe("KingdomOSClient local boundary", () => {
  test("lists repositories with exact argv, parses the nine fields, and sanitizes env", async () => {
    process.env.AT_API_KEY = "agenttool-project-secret";
    process.env.KINGDOM_TEST_SECRET = "arbitrary-local-secret";
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("KINGDOM OS discovery must not use HTTP");
    }) as typeof fetch;

    const { calls, runner } = recordingRunner({
      exitCode: 0,
      stdout: JSON.stringify([{ ...REPOSITORY, ignoredFutureField: "safe" }]),
      stderr: "",
    });
    const kingdom = new KingdomOSClient({
      executable: "/opt/kingdom/bin/kingdom",
      timeout: 2.5,
      maxOutputBytes: 4096,
      runner,
    });

    const repositories = await kingdom.repositories(["--literal", "agenttool"]);

    expect(repositories).toEqual([REPOSITORY]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      executable: "/opt/kingdom/bin/kingdom",
      args: ["repos", "--json", "--", "--literal", "agenttool"],
      timeoutMs: 2500,
      maxOutputBytes: 4096,
    });
    expect(calls[0]!.env.NO_COLOR).toBe("1");
    expect(calls[0]!.env.TERM).toBe("dumb");
    expect(calls[0]!.env.AT_API_KEY).toBeUndefined();
    expect(calls[0]!.env.KINGDOM_TEST_SECRET).toBeUndefined();
    expect(Object.values(calls[0]!.env).join(" ")).not.toContain(
      "agenttool-project-secret",
    );
    expect(Object.values(calls[0]!.env).join(" ")).not.toContain(
      "arbitrary-local-secret",
    );
    expect(fetchCalls).toBe(0);
  });

  test("resolves exactly one absolute path with the machine path argv", async () => {
    const { calls, runner } = recordingRunner({
      exitCode: 0,
      stdout: "/Users/test/agenttool\n",
      stderr: "",
    });
    const kingdom = new KingdomOSClient({ runner });

    const path = await kingdom.resolve(["agenttool", "active"]);

    expect(path).toBe("/Users/test/agenttool");
    expect(calls[0]!.args).toEqual([
      "repos",
      "--path",
      "--",
      "agenttool",
      "active",
    ]);
  });

  test("composes under AgentTool without using or forwarding hosted authority", async () => {
    process.env.KINGDOM_TEST_SECRET = "arbitrary-local-secret";
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("local KINGDOM OS operations must not use fetch");
    }) as typeof fetch;
    const { calls, runner } = recordingRunner({
      exitCode: 0,
      stdout: JSON.stringify([REPOSITORY]),
      stderr: "",
    });
    const at = new AgentTool({
      apiKey: "agenttool-project-secret",
      kingdomOS: { runner },
    });

    expect(await at.kingdomOS.repositories()).toEqual([REPOSITORY]);
    expect(at.kingdomOS).toBe(at.kingdomOS);
    expect(fetchCalls).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.env.AT_API_KEY).toBeUndefined();
    expect(calls[0]!.env.KINGDOM_TEST_SECRET).toBeUndefined();
    expect(Object.values(calls[0]!.env).join(" ")).not.toContain(
      "agenttool-project-secret",
    );
  });
});

describe("KingdomOSClient guided failures", () => {
  test.each([
    [1, "kingdom_os_repo_not_found"],
    [2, "kingdom_os_repo_ambiguous"],
    [127, "kingdom_os_cli_dependency_missing"],
  ] as const)("maps resolve exit %i to %s", async (exitCode, code) => {
    const { runner } = recordingRunner({
      exitCode,
      stdout: "",
      stderr: "synthetic local diagnostic",
    });

    const error = await caughtError(
      new KingdomOSClient({ runner }).resolve(["agenttool"]),
    );

    expect(error.code).toBe(code);
    expect(error.hint).toContain("synthetic local diagnostic");
    expect(error.safety).toBe("docs/KINGDOM-OS-SDK.md");
  });

  test("rejects missing and control-character queries before invoking the runner", async () => {
    let calls = 0;
    const runner: KingdomOSRunner = async () => {
      calls += 1;
      return { exitCode: 0, stdout: "[]", stderr: "" };
    };
    const kingdom = new KingdomOSClient({ runner });

    const missing = await caughtError(kingdom.resolve([]));
    const invalid = await caughtError(kingdom.repositories(["agenttool\nall"]));
    const malformedUnicode = await caughtError(
      kingdom.repositories(["\ud800"]),
    );

    expect(missing.code).toBe("kingdom_os_query_required");
    expect(invalid.code).toBe("kingdom_os_invalid_query");
    expect(malformedUnicode.code).toBe("kingdom_os_invalid_query");
    expect(calls).toBe(0);
  });

  test.each([
    ["not JSON"],
    [JSON.stringify({ repositories: [] })],
    [JSON.stringify([{ ...REPOSITORY, purpose: 42 }])],
    [JSON.stringify([{ ...REPOSITORY, purpose: "\ud800" }])],
    [JSON.stringify([{ ...REPOSITORY, path: "relative/agenttool" }])],
  ])("rejects malformed repository inventory %#", async (stdout) => {
    const { runner } = recordingRunner({ exitCode: 0, stdout, stderr: "" });

    const error = await caughtError(
      new KingdomOSClient({ runner }).repositories(),
    );

    expect(error.code).toBe("kingdom_os_invalid_response");
    expect(error.safety).toBe("docs/KINGDOM-OS-SDK.md");
  });

  test("rejects a relative resolve result", async () => {
    const { runner } = recordingRunner({
      exitCode: 0,
      stdout: "relative/agenttool\n",
      stderr: "",
    });

    const error = await caughtError(
      new KingdomOSClient({ runner }).resolve(["agenttool"]),
    );

    expect(error.code).toBe("kingdom_os_invalid_response");
  });

  test("wraps an injected runner failure with stable guidance", async () => {
    const runner: KingdomOSRunner = async () => {
      throw new Error("synthetic runner failure");
    };

    const error = await caughtError(
      new KingdomOSClient({ runner }).repositories(),
    );

    expect(error.code).toBe("kingdom_os_runner_failed");
    expect(error.details).toEqual({ reason: "synthetic runner failure" });
    expect(error.safety).toBe("docs/KINGDOM-OS-SDK.md");
  });

  test("enforces the output ceiling even when an injected runner ignores it", async () => {
    const { runner } = recordingRunner({
      exitCode: 0,
      stdout: "x".repeat(1025),
      stderr: "",
    });

    const error = await caughtError(
      new KingdomOSClient({ maxOutputBytes: 1024, runner }).repositories(),
    );

    expect(error.code).toBe("kingdom_os_output_too_large");
    expect(error.safety).toBe("docs/KINGDOM-OS-SDK.md");
  });

  test("rejects malformed Unicode returned by an injected runner", async () => {
    const { runner } = recordingRunner({
      exitCode: 0,
      stdout: "\ud800",
      stderr: "",
    });

    const error = await caughtError(
      new KingdomOSClient({ runner }).repositories(),
    );

    expect(error.code).toBe("kingdom_os_runner_failed");
    expect(error.safety).toBe("docs/KINGDOM-OS-SDK.md");
  });
});
