import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import type { AgentBrowser } from "../src/browser.js";
import {
  JSONL_PROTOCOL_VERSION,
  runCli,
  runJsonlSession,
} from "../src/cli.js";
import { resolveBrowserCapabilities } from "../src/capabilities.js";
import { parseBrowserProcessConfig } from "../src/config.js";
import { BrowserError } from "../src/errors.js";
import { planBrowserAction } from "../src/planning.js";
import type { BrowserAction } from "../src/types.js";

function capture() {
  let value = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      value += chunk.toString();
      callback();
    },
  });
  return { stream, text: () => value };
}

function fakeBrowser(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const capabilities = resolveBrowserCapabilities({ authority: "public" });
  const browser = {
    capabilities() {
      calls.push({ method: "capabilities" });
      return capabilities;
    },
    plan(action: BrowserAction) {
      calls.push({ method: "plan", input: action });
      return planBrowserAction(action, capabilities);
    },
    async open(url: string) {
      calls.push({ method: "open", input: url });
      return { untrusted: true, url, snapshotId: "snapshot-1" };
    },
    async observe(input?: unknown) {
      calls.push({ method: "observe", input });
      return { untrusted: true, snapshotId: "snapshot-2" };
    },
    async act(input: unknown) {
      calls.push({ method: "act", input });
      return {
        ok: true,
        kind: (input as { kind: string }).kind,
        sessionId: "session-1",
        tabId: "tab-1",
        pageId: "page-1",
        revision: 2,
        url: "https://example.com/",
      };
    },
    async actAndObserve(input: unknown) {
      calls.push({ method: "act", input });
      calls.push({ method: "observe", input: { tabId: "tab-1" } });
      return {
        action: {
          ok: true,
          kind: (input as { kind: string }).kind,
          sessionId: "session-1",
          tabId: "tab-1",
          pageId: "page-1",
          revision: 2,
          url: "https://example.com/",
        },
        observation: { untrusted: true, snapshotId: "snapshot-2" },
        observationError: null,
      };
    },
    async extract(input: unknown) {
      calls.push({ method: "extract", input });
      return { format: "text", content: "page data", untrusted: true };
    },
    async screenshot(input?: unknown) {
      calls.push({ method: "screenshot", input });
      return {
        path: "/tmp/shot.png",
        sha256: "b".repeat(64),
        bytes: 42,
        mimeType: "image/png",
        untrusted: true,
      };
    },
    async tabs() {
      calls.push({ method: "tabs" });
      return [];
    },
    async close() {
      calls.push({ method: "close" });
    },
    ...overrides,
  };
  return { browser: browser as unknown as AgentBrowser, calls };
}

function request(
  id: string | number,
  method: string,
  params: Record<string, unknown> = {},
) {
  return JSON.stringify({
    version: JSONL_PROTOCOL_VERSION,
    id,
    method,
    params,
  });
}

async function jsonl(
  browser: AgentBrowser,
  lines: string[],
  options: { maxRequestBytes?: number; maxResponseBytes?: number } = {},
) {
  const output = capture();
  await runJsonlSession(browser, {
    input: Readable.from([`${lines.join("\n")}\n`]),
    output: output.stream,
    ...options,
  });
  return output
    .text()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("browser process configuration", () => {
  test("defaults to a headless public-web ephemeral session outside the cwd", () => {
    const config = parseBrowserProcessConfig([], {
      env: { XDG_DATA_HOME: "/tmp/agenttool-browser-data" },
      cwd: "/tmp/project",
    });
    expect(config).toEqual({
      headless: true,
      authority: "public",
      allowPublicWeb: true,
      allowLocalNetwork: false,
      profile: { mode: "ephemeral" },
      channel: "chrome",
      outputDir: "/tmp/agenttool-browser-data/agenttool/browser/artifacts",
    });
  });

  test("CLI flags override environment only at process start", () => {
    const config = parseBrowserProcessConfig(
      ["--headed", "--local-network", "--no-public-web", "--executable", "./chrome"],
      {
        env: {
          AGENTOOL_BROWSER_HEADLESS: "1",
          AGENTOOL_BROWSER_CHANNEL: "chrome-beta",
          XDG_DATA_HOME: "/tmp/agenttool-browser-data",
        },
        cwd: "/tmp/project",
      },
    );
    expect(config).toMatchObject({
      headless: false,
      allowPublicWeb: false,
      allowLocalNetwork: true,
      executablePath: "/tmp/project/chrome",
    });
    expect(config.channel).toBeUndefined();
  });

  test("selects named authority consistently from environment and CLI", () => {
    const cases = [
      {
        args: [],
        env: { AGENTOOL_BROWSER_AUTHORITY: "public" },
        authority: "public",
        allowLocalNetwork: false,
      },
      {
        args: [],
        env: { AGENTOOL_BROWSER_AUTHORITY: "local" },
        authority: "local",
        allowLocalNetwork: true,
      },
      {
        args: ["--authority", "sovereign"],
        env: { AGENTOOL_BROWSER_AUTHORITY: "public" },
        authority: "sovereign",
        allowLocalNetwork: true,
      },
    ] as const;

    for (const testCase of cases) {
      const config = parseBrowserProcessConfig(testCase.args, {
        env: {
          ...testCase.env,
          XDG_DATA_HOME: "/tmp/agenttool-browser-data",
        },
        cwd: "/tmp/project",
      });
      expect(config).toMatchObject({
        authority: testCase.authority,
        allowPublicWeb: true,
        allowLocalNetwork: testCase.allowLocalNetwork,
      });
    }
  });

  test("rejects mixed named authority and legacy network controls", () => {
    expect(() =>
      parseBrowserProcessConfig([], {
        env: {
          AGENTOOL_BROWSER_AUTHORITY: "sovereign",
          AGENTOOL_BROWSER_LOCAL_NETWORK: "1",
        },
      }),
    ).toThrow("cannot be combined");
    expect(() =>
      parseBrowserProcessConfig(
        ["--authority", "local", "--no-public-web"],
        { env: {} },
      ),
    ).toThrow("cannot be combined");
    expect(() =>
      parseBrowserProcessConfig(
        ["--local-network", "--authority", "sovereign"],
        { env: {} },
      ),
    ).toThrow("cannot be combined");
  });

  test("explicit profile and executable flags can replace incomplete environment choices", () => {
    const config = parseBrowserProcessConfig(
      ["--ephemeral", "--executable", "./chrome"],
      {
        env: {
          AGENTOOL_BROWSER_PROFILE: "persistent",
          AGENTOOL_BROWSER_CHANNEL: "not a valid channel!",
          XDG_DATA_HOME: "/tmp/agenttool-browser-data",
        },
        cwd: "/tmp/project",
      },
    );
    expect(config.profile).toEqual({ mode: "ephemeral" });
    expect(config.executablePath).toBe("/tmp/project/chrome");
  });

  test("rejects ordinary, AgentTool, and current-worktree profile roots", () => {
    expect(() =>
      parseBrowserProcessConfig(["--profile", join(homedir(), ".agenttool", "browser")], {
        env: {},
        cwd: "/tmp",
      }),
    ).toThrow("dedicated directory");
    expect(() =>
      parseBrowserProcessConfig(
        ["--profile", join(homedir(), "Library", "Application Support", "Google", "Chrome", "Profile 1")],
        { env: {}, cwd: "/tmp" },
      ),
    ).toThrow("normal browser profile");
    expect(() =>
      parseBrowserProcessConfig(["--profile", resolve(".agent-browser-profile")], {
        env: {},
        cwd: process.cwd(),
      }),
    ).toThrow("Git worktree");
  });
});

describe("JSONL protocol", () => {
  test("exposes capability and planning parity without touching the page", async () => {
    const { browser, calls } = fakeBrowser();
    const capabilities = resolveBrowserCapabilities({ authority: "public" });
    const typedAction: BrowserAction = {
      kind: "type",
      ref: "e1",
      snapshotId: "snapshot-1",
      text: "do-not-echo-this-secret",
    };
    const navigateAction: BrowserAction = {
      kind: "navigate",
      url: "https://example.com/search?token=secret&query=private#results",
    };
    const responses = await jsonl(browser, [
      request("capabilities", "browser_capabilities"),
      request("type-plan", "browser_plan", {
        action: {
          kind: "type",
          ref: "e1",
          snapshot_id: "snapshot-1",
          text: typedAction.text,
        },
      }),
      request("navigate-plan", "browser_plan", {
        action: navigateAction,
      }),
    ]);

    expect(responses[0]).toMatchObject({
      id: "capabilities",
      ok: true,
      result: capabilities,
    });
    expect(responses[1].result).toEqual(
      planBrowserAction(typedAction, capabilities),
    );
    expect(JSON.stringify(responses[1])).not.toContain(typedAction.text);
    expect(responses[2].result).toEqual(
      planBrowserAction(navigateAction, capabilities),
    );
    expect(responses[2].result.action.url).toBe(
      "https://example.com/search?token=%5Bredacted%5D&query=%5Bredacted%5D#results",
    );
    expect(calls.filter((call) =>
      call.method === "act" || call.method === "observe"
    )).toHaveLength(0);
  });

  test("executes request lines sequentially and preserves IDs", async () => {
    let active = 0;
    let maximumActive = 0;
    const { browser } = fakeBrowser({
      async observe() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        active -= 1;
        return { untrusted: true, snapshotId: "snapshot" };
      },
    });
    const responses = await jsonl(browser, [
      request("first", "browser_observe"),
      request("second", "browser_observe"),
    ]);

    expect(responses.map((response) => response.id)).toEqual(["first", "second"]);
    expect(responses.every((response) => response.ok)).toBe(true);
    expect(maximumActive).toBe(1);
  });

  test("requires snapshot binding and never calls an invalid action", async () => {
    const { browser, calls } = fakeBrowser();
    const responses = await jsonl(browser, [
      request("bad-action", "browser_act", {
        action: { kind: "click", ref: "e1" },
      }),
    ]);

    expect(responses[0].ok).toBe(false);
    expect(responses[0].error.code).toBe("invalid_params");
    expect(calls.some((call) => call.method === "act")).toBe(false);
  });

  test("rejects misspelled nested action fields instead of using the active tab", async () => {
    const { browser, calls } = fakeBrowser();
    const responses = await jsonl(browser, [
      request("wrong-tab", "browser_act", {
        action: { kind: "close_tab", tabid: "tab-2" },
      }),
    ]);

    expect(responses[0].ok).toBe(false);
    expect(responses[0].error.code).toBe("invalid_params");
    expect(calls.some((call) => call.method === "act")).toBe(false);
  });

  test("rejects arbitrary selector extraction before it reaches the core", async () => {
    const { browser, calls } = fakeBrowser();
    const responses = await jsonl(browser, [
      request("selector", "browser_extract", {
        format: "text",
        selector: "body",
      }),
    ]);

    expect(responses[0].ok).toBe(false);
    expect(responses[0].error.code).toBe("invalid_params");
    expect(calls.some((call) => call.method === "extract")).toBe(false);
  });

  test("rejects zero character bounds before core dispatch", async () => {
    const { browser, calls } = fakeBrowser();
    const responses = await jsonl(browser, [
      request("observe-zero", "browser_observe", { max_text_chars: 0 }),
      request("extract-zero", "browser_extract", { format: "text", max_chars: 0 }),
    ]);

    expect(responses.map((response) => response.error.code)).toEqual([
      "invalid_params",
      "invalid_params",
    ]);
    expect(calls).toHaveLength(0);
  });

  test("rejects character bounds above the process defaults before dispatch", async () => {
    const { browser, calls } = fakeBrowser();
    const responses = await jsonl(browser, [
      request("observe-large", "browser_observe", { max_text_chars: 12_001 }),
      request("extract-large", "browser_extract", {
        format: "text",
        max_chars: 100_001,
      }),
    ]);

    expect(responses.map((response) => response.error.code)).toEqual([
      "invalid_params",
      "invalid_params",
    ]);
    expect(calls).toHaveLength(0);
  });

  test("returns screenshot metadata but no inline image bytes", async () => {
    const { browser } = fakeBrowser();
    const responses = await jsonl(browser, [
      request("shot", "browser_screenshot"),
    ]);
    expect(responses[0]).toMatchObject({
      id: "shot",
      ok: true,
      result: {
        path: "/tmp/shot.png",
        sha256: "b".repeat(64),
        bytes: 42,
      },
    });
    expect(JSON.stringify(responses[0])).not.toContain("base64");
  });

  test("rejects full-page screenshots at the model-facing boundary", async () => {
    const { browser, calls } = fakeBrowser();
    const responses = await jsonl(browser, [
      request("full-page", "browser_screenshot", { full_page: true }),
    ]);

    expect(responses[0].ok).toBe(false);
    expect(responses[0].error.code).toBe("invalid_params");
    expect(calls.some((call) => call.method === "screenshot")).toBe(false);
  });

  test("bounds request and response lines with explicit errors", async () => {
    const { browser } = fakeBrowser({
      async observe() {
        return { untrusted: true, text: "x".repeat(2_000) };
      },
    });
    const oversizedInput = JSON.stringify({
      version: JSONL_PROTOCOL_VERSION,
      id: "large-input",
      method: "browser_tabs",
      params: {},
      padding: "x".repeat(1_000),
    });
    const responses = await jsonl(
      browser,
      [oversizedInput, request("large-result", "browser_observe")],
      { maxRequestBytes: 256, maxResponseBytes: 300 },
    );

    expect(responses[0].error.code).toBe("line_too_large");
    expect(responses[1].id).toBe("large-result");
    expect(responses[1].error.code).toBe("result_too_large");
  });

  test("keeps error envelopes bounded even when the request ID fills its limit", async () => {
    const { browser } = fakeBrowser({
      async observe() {
        return { untrusted: true, text: "x".repeat(2_000) };
      },
    });
    const output = capture();
    await runJsonlSession(browser, {
      input: Readable.from([
        `${request("i".repeat(200), "browser_observe")}\n`,
      ]),
      output: output.stream,
      maxResponseBytes: 256,
    });

    expect(Buffer.byteLength(output.text())).toBeLessThanOrEqual(256);
    expect(JSON.parse(output.text())).toMatchObject({
      id: null,
      ok: false,
      error: { code: "result_too_large" },
    });
  });

  test("rejects mismatched versions without dispatch", async () => {
    const { browser, calls } = fakeBrowser();
    const output = capture();
    await runJsonlSession(browser, {
      input: Readable.from([
        `${JSON.stringify({
          version: "agenttool-browser-jsonl/9.9",
          id: "future",
          method: "browser_tabs",
          params: {},
        })}\n`,
      ]),
      output: output.stream,
    });
    const response = JSON.parse(output.text());
    expect(response.error.code).toBe("unsupported_version");
    expect(calls).toHaveLength(0);
  });
});

describe("browser CLI", () => {
  test("help does not launch a browser", async () => {
    const output = capture();
    let launches = 0;
    const code = await runCli(["help"], {
      stdout: output.stream,
      launch: async () => {
        launches += 1;
        return fakeBrowser().browser;
      },
    });
    expect(code).toBe(0);
    expect(launches).toBe(0);
    expect(output.text()).toContain("Browser binaries are never downloaded automatically");
  });

  test("doctor launches once, closes once, and reports the fixed policy and capabilities", async () => {
    const output = capture();
    const error = capture();
    const capabilities = resolveBrowserCapabilities({
      allowPublicWeb: true,
      allowLocalNetwork: true,
    });
    const { browser, calls } = fakeBrowser({
      capabilities() {
        return capabilities;
      },
    });
    let launchedWith: unknown;
    const code = await runCli(["doctor", "--local-network"], {
      env: { XDG_DATA_HOME: "/tmp/agenttool-browser-data" },
      cwd: "/tmp/project",
      stdout: output.stream,
      stderr: error.stream,
      launch: async (config) => {
        launchedWith = config;
        return browser;
      },
    });

    expect(code).toBe(0);
    expect(launchedWith).toMatchObject({ allowLocalNetwork: true });
    expect(calls.filter((call) => call.method === "close")).toHaveLength(1);
    expect(JSON.parse(output.text())).toMatchObject({
      ok: true,
      version: "agenttool-browser-doctor/0.2",
      config: { authority: "legacy_custom" },
      capabilities: {
        schema: "agent-browser-capabilities/0.2",
        authority: { profile: "legacy_custom", fixedAt: "process_start" },
      },
      checks: { browser_launch: "ok", automatic_download: false },
    });
    expect(error.text()).toBe("");
  });

  test("doctor names an unavailable channel and gives bounded launch help", async () => {
    const output = capture();
    const error = capture();
    const code = await runCli(["doctor", "--channel", "chrome-beta"], {
      env: { XDG_DATA_HOME: "/tmp/agenttool-browser-data" },
      cwd: "/tmp/project",
      stdout: output.stream,
      stderr: error.stream,
      launch: async () => {
        throw new BrowserError(
          "browser_launch_failed",
          "Could not launch the local browser.",
          { cause: new Error("raw Playwright details from /private/not-for-output") },
        );
      },
    });

    expect(code).toBe(1);
    expect(output.text()).toBe("");
    expect(error.text()).toContain(
      "error: browser_launch_failed: Could not launch the local browser.",
    );
    expect(error.text()).toContain('configured browser channel "chrome-beta"');
    expect(error.text()).toContain("--channel NAME");
    expect(error.text()).toContain("--executable PATH");
    expect(error.text()).toContain("install one and retry");
    expect(error.text()).not.toContain("raw Playwright details");
    expect(error.text()).not.toContain("/private/not-for-output");
  });

  test("doctor names an executable without exposing its parent path", async () => {
    const output = capture();
    const error = capture();
    const code = await runCli(
      ["doctor", "--executable", "/private/not-for-output/selected-chrome"],
      {
        env: { XDG_DATA_HOME: "/tmp/agenttool-browser-data" },
        cwd: "/tmp/project",
        stdout: output.stream,
        stderr: error.stream,
        launch: async () => {
          throw new BrowserError(
            "browser_launch_failed",
            "Could not launch the local browser.",
          );
        },
      },
    );

    expect(code).toBe(1);
    expect(output.text()).toBe("");
    expect(error.text()).toContain(
      'configured browser executable "selected-chrome" (parent path omitted)',
    );
    expect(error.text()).not.toContain("/private/not-for-output");
  });

  test("doctor bounds and neutralizes a caller-controlled executable name", async () => {
    const output = capture();
    const error = capture();
    const unsafeName =
      `selected\u202e\u2066\u200e\n-${"x".repeat(140)}`;
    const code = await runCli(
      ["doctor", "--executable", `/private/not-for-output/${unsafeName}`],
      {
        env: { XDG_DATA_HOME: "/tmp/agenttool-browser-data" },
        cwd: "/tmp/project",
        stdout: output.stream,
        stderr: error.stream,
        launch: async () => {
          throw new BrowserError(
            "browser_launch_failed",
            "Could not launch the local browser.",
          );
        },
      },
    );

    expect(code).toBe(1);
    expect(output.text()).toBe("");
    expect(error.text()).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
    expect(error.text()).not.toContain("/private/not-for-output");
    const lines = error.text().trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("selected????-");
    expect(lines[1]).toContain("...");
    expect(lines[1]!.length).toBeLessThan(400);
  });

  for (const command of ["jsonl", "mcp"] as const) {
    test(`${command} keeps startup diagnostics off protocol stdout`, async () => {
      const output = capture();
      const error = capture();
      const code = await runCli([command, "--channel", "chrome"], {
        env: { XDG_DATA_HOME: "/tmp/agenttool-browser-data" },
        cwd: "/tmp/project",
        stdout: output.stream,
        stderr: error.stream,
        launch: async () => {
          throw new BrowserError(
            "browser_launch_failed",
            "Could not launch the local browser.",
          );
        },
      });

      expect(code).toBe(1);
      expect(output.text()).toBe("");
      expect(error.text()).toContain('configured browser channel "chrome"');
    });
  }
});
