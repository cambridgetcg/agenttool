import {
  afterEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { relayBrowserMcpStdio } from "../src/mcp-proxy.js";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
        }),
    ),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function privateRoot(): Promise<string> {
  const base = process.platform === "darwin" ? "/private/tmp" : tmpdir();
  const root = await mkdtemp(join(base, "atp-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function echoServer(socketPath: string): Promise<Server> {
  const server = createServer((socket) => {
    socket.on("data", (chunk) => {
      if (!socket.write(chunk)) socket.pause();
    });
    socket.on("drain", () => socket.resume());
    socket.on("end", () => socket.end());
    socket.on("error", () => {});
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(socketPath, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  await chmod(socketPath, 0o600);
  servers.push(server);
  return server;
}

describe("Darwin Browser MCP stdio relay", () => {
  test("relays exact bytes with stream backpressure and no protocol noise", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    await echoServer(socketPath);
    const chunks = [
      Buffer.from('{"jsonrpc":"2.0","id":1,'),
      Buffer.from('"method":"server/discover","params":{}}\n'),
      Buffer.from([0, 1, 2, 10, 255]),
    ];
    const expected = Buffer.concat(chunks);
    const captured: Buffer[] = [];
    let receivedExpected!: () => void;
    const received = new Promise<void>((resolveReceived) => {
      receivedExpected = resolveReceived;
    });
    const output = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        captured.push(Buffer.from(chunk));
        setTimeout(() => {
          callback();
          if (Buffer.concat(captured).byteLength >= expected.byteLength) {
            receivedExpected();
          }
        }, 1);
      },
    });
    const input = new PassThrough();

    const running = relayBrowserMcpStdio({
      socketPath,
      input,
      output,
      platform: "darwin",
    });
    for (const chunk of chunks) input.write(chunk);
    await received;
    input.end();
    await running;

    expect(Buffer.concat(captured)).toEqual(expected);
  });

  test("rejects an unrequested peer EOF instead of hanging half-open", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    const server = createServer((socket) => {
      socket.end();
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(socketPath, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    await chmod(socketPath, 0o600);
    servers.push(server);
    const input = new PassThrough();
    const output = new PassThrough();

    await expect(
      relayBrowserMcpStdio({
        socketPath,
        input,
        output,
        platform: "darwin",
      }),
    ).rejects.toMatchObject({ code: "browser_closed" });
    input.destroy();
    output.destroy();
  });

  test("handles stdin that ended before connection without hanging", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    await echoServer(socketPath);
    const input = new PassThrough();
    const ended = new Promise<void>((resolveEnded) => {
      input.once("end", resolveEnded);
    });
    input.resume();
    input.end();
    await ended;
    const output = new PassThrough();

    await relayBrowserMcpStdio({
      socketPath,
      input,
      output,
      platform: "darwin",
    });
    output.destroy();
  });

  test("rejects stdin destroyed after setup without hanging", async () => {
    const root = await privateRoot();
    const socketPath = join(root, "browser.sock");
    await echoServer(socketPath);
    const input = new PassThrough();
    const output = new PassThrough();
    const running = relayBrowserMcpStdio({
      socketPath,
      input,
      output,
      platform: "darwin",
    });

    await Bun.sleep(10);
    input.destroy();
    await expect(running).rejects.toMatchObject({ code: "browser_closed" });
    output.destroy();
  });

  test("refuses non-Darwin use before connecting", async () => {
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    await expect(
      relayBrowserMcpStdio({
        socketPath: "/private/tmp/agenttool-browser-never-connect.sock",
        input: Readable.from([]),
        output,
        platform: "linux",
      }),
    ).rejects.toThrow(/macOS only/);
  });

  test("refuses open, symlinked, and non-0600 endpoints", async () => {
    const root = await privateRoot();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const openParent = join(root, "open");
    await mkdir(openParent);
    await chmod(openParent, 0o755);
    const openSocket = join(openParent, "browser.sock");
    await echoServer(openSocket);
    await expect(
      relayBrowserMcpStdio({
        socketPath: openSocket,
        input: Readable.from([]),
        output,
        platform: "darwin",
      }),
    ).rejects.toThrow(/group or world/);

    const realParent = join(root, "real");
    await mkdir(realParent, { mode: 0o700 });
    const linkedParent = join(root, "linked");
    await symlink(realParent, linkedParent);
    const linkedSocket = join(realParent, "browser.sock");
    await echoServer(linkedSocket);
    await expect(
      relayBrowserMcpStdio({
        socketPath: join(linkedParent, "browser.sock"),
        input: Readable.from([]),
        output,
        platform: "darwin",
      }),
    ).rejects.toThrow(/real directory/);

    const broadSocket = join(root, "broad.sock");
    await echoServer(broadSocket);
    await chmod(broadSocket, 0o666);
    await expect(
      relayBrowserMcpStdio({
        socketPath: broadSocket,
        input: Readable.from([]),
        output,
        platform: "darwin",
      }),
    ).rejects.toThrow(/mode-0600/);
  });
});
