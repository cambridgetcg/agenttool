import {
  afterEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  createServer,
  type Socket,
} from "node:net";
import type { AgentBrowser } from "../src/browser.js";
import { resolveBrowserCapabilities } from "../src/capabilities.js";
import type { BrowserProcessConfig } from "../src/config.js";
import {
  BrowserMcpBroker,
  checkedBrowserBrokerSocketPath,
  MAX_BROWSER_BROKER_MCP_LINE_BYTES,
  type BrowserMcpBrokerDependencies,
} from "../src/mcp-broker.js";
import type { BrowserAction } from "../src/types.js";
import { planBrowserAction } from "../src/planning.js";

const roots: string[] = [];
const brokers: BrowserMcpBroker[] = [];

afterEach(async () => {
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function privateRoot(): Promise<string> {
  const base = process.platform === "darwin" ? "/private/tmp" : tmpdir();
  const root = await mkdtemp(join(base, "atb-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for broker state");
    }
    await Bun.sleep(5);
  }
}

function publicEphemeral(
  outputDir = join(tmpdir(), "agenttool-browser-broker-artifacts"),
): BrowserProcessConfig {
  return {
    headless: true,
    authority: "public",
    allowPublicWeb: true,
    allowLocalNetwork: false,
    profile: { mode: "ephemeral" },
    channel: "chrome",
    outputDir,
  };
}

function fakeSession(onClose: () => void): AgentBrowser {
  const capabilities = resolveBrowserCapabilities({ authority: "public" });
  return {
    capabilities() {
      return capabilities;
    },
    plan(action: BrowserAction) {
      return planBrowserAction(action, capabilities);
    },
    async close() {
      onClose();
    },
  } as unknown as AgentBrowser;
}

function fakeDependencies() {
  let sharedCloseCalls = 0;
  const sessionCloseCalls: number[] = [];
  const launchOptions: unknown[] = [];
  const sessionOptions: unknown[] = [];
  const dependencies: BrowserMcpBrokerDependencies = {
    platform: "darwin",
    async launchSharedBrowser(options) {
      launchOptions.push(options);
      return {
        async newContext() {
          throw new Error("test sessions use the injected session factory");
        },
        async close() {
          sharedCloseCalls += 1;
        },
      };
    },
    async launchSession(_browser, options) {
      const index = sessionCloseCalls.length;
      sessionCloseCalls.push(0);
      sessionOptions.push(options);
      return fakeSession(() => {
        sessionCloseCalls[index] = (sessionCloseCalls[index] ?? 0) + 1;
      });
    },
  };
  return {
    dependencies,
    launchOptions,
    sessionOptions,
    sessionCloseCalls,
    get sharedCloseCalls() {
      return sharedCloseCalls;
    },
  };
}

async function connectSocket(path: string): Promise<Socket> {
  const socket = createConnection(path);
  socket.on("error", () => {
    // Protocol and capacity tests deliberately trigger server-side closure.
  });
  await new Promise<void>((resolveConnect, rejectConnect) => {
    socket.once("connect", resolveConnect);
    socket.once("error", rejectConnect);
  });
  return socket;
}

function lineReader(socket: Socket) {
  let buffer = "";
  const pending: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else pending.push(line);
    }
  });
  return async (): Promise<Record<string, unknown>> => {
    const line = pending.shift() ?? await new Promise<string>((resolveLine, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("timed out waiting for broker response")),
        2_000,
      );
      waiters.push((value) => {
        clearTimeout(timeout);
        resolveLine(value);
      });
    });
    return JSON.parse(line) as Record<string, unknown>;
  };
}

function modernParams() {
  return {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

describe("Darwin Browser MCP broker", () => {
  test("creates a same-UID 0600 endpoint and removes only its own socket", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "run", "browser.sock");
    const fake = fakeDependencies();
    const broker = new BrowserMcpBroker(
      {
        socketPath,
        browser: publicEphemeral(join(root, "artifacts")),
      },
      fake.dependencies,
    );
    brokers.push(broker);

    expect(await broker.start()).toBe(socketPath);
    const parent = await lstat(join(root, "run"));
    const socket = await lstat(socketPath);
    expect(parent.mode & 0o777).toBe(0o700);
    expect(socket.mode & 0o777).toBe(0o600);
    expect(socket.isSocket()).toBe(true);
    expect(fake.launchOptions).toEqual([
      {
        headless: true,
        chromiumSandbox: true,
        channel: "chrome",
      },
    ]);

    await broker.close();
    await broker.close();
    await broker.closed;
    expect(fake.sharedCloseCalls).toBe(1);
    await expect(lstat(socketPath)).rejects.toThrow();
  });

  test("a close racing startup cannot publish or leak the late browser", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    let releaseLaunch!: (browser: {
      newContext(): Promise<never>;
      close(): Promise<void>;
    }) => void;
    let launchStarted!: () => void;
    const launched = new Promise<void>((resolveLaunched) => {
      launchStarted = resolveLaunched;
    });
    const waitingBrowser = new Promise<{
      newContext(): Promise<never>;
      close(): Promise<void>;
    }>((resolveBrowser) => {
      releaseLaunch = resolveBrowser;
    });
    let sharedCloseCalls = 0;
    const broker = new BrowserMcpBroker(
      { socketPath, browser: publicEphemeral(join(root, "artifacts")) },
      {
        platform: "darwin",
        async launchSharedBrowser() {
          launchStarted();
          return await waitingBrowser;
        },
      },
    );
    brokers.push(broker);

    const starting = broker.start();
    await launched;
    const closing = broker.close();
    releaseLaunch({
      async newContext(): Promise<never> {
        throw new Error("a cancelled broker must not create a context");
      },
      async close() {
        sharedCloseCalls += 1;
      },
    });

    await expect(starting).rejects.toMatchObject({ code: "browser_closed" });
    await closing;
    await broker.closed;
    expect(sharedCloseCalls).toBe(1);
    expect(broker.socketPath).toBeNull();
    expect(broker.activeClients).toBe(0);
    await expect(lstat(socketPath)).rejects.toThrow();
    await broker.close();
    expect(sharedCloseCalls).toBe(1);
  });

  test("gives each client a fresh session and isolates malformed peers", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    const fake = fakeDependencies();
    const broker = new BrowserMcpBroker(
      {
        socketPath,
        browser: publicEphemeral(join(root, "artifacts")),
        maxClients: 2,
      },
      fake.dependencies,
    );
    brokers.push(broker);
    await broker.start();

    const malformed = await connectSocket(socketPath);
    const healthy = await connectSocket(socketPath);
    const receiveHealthy = lineReader(healthy);
    await waitFor(() => fake.sessionOptions.length === 2);
    expect(broker.activeClients).toBe(2);
    expect(fake.sessionOptions).toHaveLength(2);
    expect(fake.sessionOptions).toEqual([
      expect.objectContaining({
        authority: "public",
        profile: { mode: "ephemeral" },
      }),
      expect.objectContaining({
        authority: "public",
        profile: { mode: "ephemeral" },
      }),
    ]);

    malformed.write("{definitely-not-json}\n");
    await Bun.sleep(10);

    healthy.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "server/discover",
        params: modernParams(),
      })}\n`,
    );
    const response = await receiveHealthy();
    expect(response.id).toBe(7);
    expect(response).toHaveProperty("result");
    expect(fake.sessionCloseCalls[0]).toBe(0);
    expect(fake.sessionCloseCalls[1]).toBe(0);
    expect(fake.sharedCloseCalls).toBe(0);

    malformed.destroy();
    const healthyClosed = new Promise<void>((resolveClosed) => {
      healthy.once("close", () => resolveClosed());
    });
    healthy.end();
    await healthyClosed;
    await waitFor(() => fake.sessionCloseCalls.every((calls) => calls === 1));
    expect(fake.sessionCloseCalls).toEqual([1, 1]);

    await broker.close();
    expect(fake.sharedCloseCalls).toBe(1);
  });

  test("bounds live clients without launching an extra session", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    const fake = fakeDependencies();
    const broker = new BrowserMcpBroker(
      {
        socketPath,
        browser: publicEphemeral(join(root, "artifacts")),
        maxClients: 1,
      },
      fake.dependencies,
    );
    brokers.push(broker);
    await broker.start();

    const first = await connectSocket(socketPath);
    await waitFor(() => fake.sessionOptions.length === 1);
    expect(fake.sessionOptions).toHaveLength(1);
    const second = createConnection(socketPath);
    second.on("error", () => {});
    await new Promise<void>((resolveDone) => {
      const timeout = setTimeout(resolveDone, 100);
      second.once("close", () => {
        clearTimeout(timeout);
        resolveDone();
      });
      second.once("error", () => {
        clearTimeout(timeout);
        resolveDone();
      });
    });
    expect(fake.sessionOptions).toHaveLength(1);
    first.destroy();
    second.destroy();
  });

  test("bounds MCP lines and keeps a healthy peer available", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    const fake = fakeDependencies();
    const broker = new BrowserMcpBroker(
      {
        socketPath,
        browser: publicEphemeral(join(root, "artifacts")),
        maxClients: 2,
      },
      fake.dependencies,
    );
    brokers.push(broker);
    await broker.start();

    const oversized = await connectSocket(socketPath);
    const healthy = await connectSocket(socketPath);
    const receiveHealthy = lineReader(healthy);
    await waitFor(() => fake.sessionOptions.length === 2);
    const oversizedClosed = new Promise<void>((resolveClosed) => {
      oversized.once("close", () => resolveClosed());
    });
    oversized.write(
      Buffer.alloc(MAX_BROWSER_BROKER_MCP_LINE_BYTES + 1, 0x61),
    );
    await oversizedClosed;
    await waitFor(() => fake.sessionCloseCalls[0] === 1);

    healthy.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "server/discover",
        params: modernParams(),
      })}\n`,
    );
    expect((await receiveHealthy()).id).toBe(8);
    expect(fake.sessionCloseCalls[1]).toBe(0);
    healthy.destroy();
  });

  test("refuses non-public, persistent, non-Darwin, and overlong configurations", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    expect(
      () =>
        new BrowserMcpBroker({
          socketPath,
          browser: {
            ...publicEphemeral(),
            authority: "local",
            allowLocalNetwork: true,
          },
        }, { platform: "darwin" }),
    ).toThrow(/named public authority/);
    expect(
      () =>
        new BrowserMcpBroker({
          socketPath,
          browser: {
            ...publicEphemeral(),
            profile: { mode: "persistent", directory: join(root, "profile") },
          },
        }, { platform: "darwin" }),
    ).toThrow(/refuses persistent/);
    expect(
      () =>
        new BrowserMcpBroker(
          { socketPath, browser: publicEphemeral() },
          { platform: "linux" },
        ),
    ).toThrow(/macOS only/);
    expect(
      () => checkedBrowserBrokerSocketPath(`/${"x".repeat(120)}.sock`),
    ).toThrow(/too long/);
    expect(
      () =>
        new BrowserMcpBroker({
          socketPath,
          browser: publicEphemeral(),
          maxClients: 33,
        }, { platform: "darwin" }),
    ).toThrow(/1 to 32/);
  });

  test("refuses unsafe parents, symlinks, files, and active sockets", async () => {
    const root = await privateRoot();
    const fake = fakeDependencies();

    const openParent = join(root, "open");
    await mkdir(openParent);
    await writeFile(join(openParent, ".keep"), "");
    await chmod(openParent, 0o755);
    const openBroker = new BrowserMcpBroker(
      {
        socketPath: join(openParent, "browser.sock"),
        browser: publicEphemeral(),
      },
      fake.dependencies,
    );
    await expect(openBroker.start()).rejects.toThrow(/group or world/);

    const realParent = join(root, "real");
    await mkdir(realParent);
    await writeFile(join(realParent, ".keep"), "");
    await chmod(realParent, 0o700);
    const linkedParent = join(root, "linked");
    await symlink(realParent, linkedParent);
    const linkedBroker = new BrowserMcpBroker(
      {
        socketPath: join(linkedParent, "browser.sock"),
        browser: publicEphemeral(),
      },
      fake.dependencies,
    );
    await expect(linkedBroker.start()).rejects.toThrow(/real directory/);

    const filePath = join(root, "not-a-socket");
    await writeFile(filePath, "keep", { mode: 0o600 });
    const fileBroker = new BrowserMcpBroker(
      { socketPath: filePath, browser: publicEphemeral() },
      fake.dependencies,
    );
    await expect(fileBroker.start()).rejects.toThrow(/unsafe/);
    expect(await readFile(filePath, "utf8")).toBe("keep");

    const livePath = join(root, "live.sock");
    const live = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      live.once("error", rejectListen);
      live.listen(livePath, () => resolveListen());
    });
    await chmod(livePath, 0o600);
    const activeBroker = new BrowserMcpBroker(
      { socketPath: livePath, browser: publicEphemeral() },
      fake.dependencies,
    );
    await expect(activeBroker.start()).rejects.toThrow(/already listening/);
    await new Promise<void>((resolveClose) => live.close(() => resolveClose()));
    await unlink(livePath).catch(() => {});
    expect(fake.launchOptions).toHaveLength(0);
  });

  test("reclaims an owned stale socket but preserves a replacement at cleanup", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    const child = spawn(
      process.execPath,
      [
        "--eval",
        "const { createServer } = require('node:net');"
          + "const { chmodSync } = require('node:fs');"
          + "const path = process.argv[1];"
          + "const server = createServer();"
          + "server.listen(path, () => { chmodSync(path, 0o600); process.stdout.write('ready\\n'); });",
        socketPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolveReady, rejectReady) => {
      child.stdout.once("data", () => resolveReady());
      child.once("error", rejectReady);
      child.once("exit", (code) => {
        if (code !== null) rejectReady(new Error(`stale socket child exited ${code}`));
      });
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolveExit) => child.once("close", () => resolveExit()));
    expect((await lstat(socketPath)).isSocket()).toBe(true);

    const fake = fakeDependencies();
    const broker = new BrowserMcpBroker(
      { socketPath, browser: publicEphemeral(join(root, "artifacts")) },
      fake.dependencies,
    );
    brokers.push(broker);
    await broker.start();
    expect((await lstat(socketPath)).isSocket()).toBe(true);

    await unlink(socketPath);
    await writeFile(socketPath, "replacement", { mode: 0o600 });
    await broker.close();
    expect(await readFile(socketPath, "utf8")).toBe("replacement");
    expect(fake.sharedCloseCalls).toBe(1);
  });

  test("still closes the server and browser when replacement preservation fails", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    const fake = fakeDependencies();
    const broker = new BrowserMcpBroker(
      { socketPath, browser: publicEphemeral(join(root, "artifacts")) },
      fake.dependencies,
    );
    brokers.push(broker);
    await broker.start();

    await unlink(socketPath);
    await writeFile(socketPath, "replacement", { mode: 0o600 });
    await chmod(root, 0o500);
    try {
      await expect(broker.close()).rejects.toMatchObject({
        code: "browser_closed",
      });
      await broker.closed;
      expect(fake.sharedCloseCalls).toBe(1);
      expect(broker.activeClients).toBe(0);
    } finally {
      await chmod(root, 0o700);
    }
    expect(await readFile(socketPath, "utf8")).toBe("replacement");
  });
});
