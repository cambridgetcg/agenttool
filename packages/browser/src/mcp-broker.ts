import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  rename,
  unlink,
} from "node:fs/promises";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { Transform } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  AgentBrowser,
  loadDefaultBrowserRuntime,
} from "./browser.js";
import type { BrowserProcessConfig } from "./config.js";
import { asBrowserError, BrowserError } from "./errors.js";
import {
  serveBrowserMcpStdio,
  type BrowserMcpStdioHandle,
} from "./mcp.js";
import type {
  AgentBrowserOptions,
  BrowserLike,
  BrowserRuntime,
  RuntimeLaunchOptions,
} from "./types.js";

export const DEFAULT_BROWSER_BROKER_MAX_CLIENTS = 8;
export const MAX_BROWSER_BROKER_CLIENTS = 32;
export const MAX_BROWSER_BROKER_SOCKET_BYTES = 96;
export const MAX_BROWSER_BROKER_MCP_LINE_BYTES = 1_048_576;

export interface BrowserMcpBrokerOptions {
  socketPath: string;
  browser: BrowserProcessConfig;
  maxClients?: number;
}

export interface BrowserMcpBrokerDependencies {
  platform?: NodeJS.Platform;
  runtime?: BrowserRuntime;
  launchSharedBrowser?: (
    options: RuntimeLaunchOptions,
  ) => Promise<BrowserLike>;
  launchSession?: (
    browser: BrowserLike,
    options: AgentBrowserOptions,
  ) => Promise<AgentBrowser>;
  serveSession?: (
    browser: AgentBrowser,
    socket: Socket,
    onerror: () => void,
  ) => BrowserMcpStdioHandle;
}

interface SocketIdentity {
  dev: number;
  ino: number;
}

class BoundedMcpInput extends Transform {
  #lineBytes = 0;

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    for (const byte of chunk) {
      if (byte === 0x0a) {
        this.#lineBytes = 0;
        continue;
      }
      this.#lineBytes += 1;
      if (this.#lineBytes > MAX_BROWSER_BROKER_MCP_LINE_BYTES) {
        callback(new Error("MCP request line exceeds broker byte bound."));
        return;
      }
    }
    callback(null, chunk);
  }
}

function brokerError(message: string): BrowserError {
  return new BrowserError("invalid_options", message);
}

function checkedMaxClients(value: number | undefined): number {
  const result = value ?? DEFAULT_BROWSER_BROKER_MAX_CLIENTS;
  if (
    !Number.isSafeInteger(result)
    || result < 1
    || result > MAX_BROWSER_BROKER_CLIENTS
  ) {
    throw brokerError(
      `Broker maxClients must be an integer from 1 to ${MAX_BROWSER_BROKER_CLIENTS}.`,
    );
  }
  return result;
}

export function checkedBrowserBrokerSocketPath(input: string): string {
  if (
    typeof input !== "string"
    || input.length === 0
    || input.includes("\0")
    || !isAbsolute(input)
  ) {
    throw brokerError("Broker socket path must be an absolute path.");
  }
  const path = resolve(input);
  if (Buffer.byteLength(path) > MAX_BROWSER_BROKER_SOCKET_BYTES) {
    throw brokerError(
      "Broker socket path is too long for the portable Unix socket profile.",
    );
  }
  return path;
}

function assertPublicEphemeralConfig(config: BrowserProcessConfig): void {
  if (config.profile.mode !== "ephemeral") {
    throw brokerError("Browser broker refuses persistent profiles.");
  }
  if (
    config.authority !== "public"
    || config.allowPublicWeb !== true
    || config.allowLocalNetwork !== false
  ) {
    throw brokerError(
      "Browser broker requires the named public authority; legacy, local, and sovereign authority are refused.",
    );
  }
}

async function inspectSecureSocketDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw brokerError("Broker socket parent must be a real directory.");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw brokerError("Broker socket parent has the wrong owner.");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw brokerError(
      "Broker socket parent must not be group or world accessible.",
    );
  }
}

async function ensureSecureSocketDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700, recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await inspectSecureSocketDirectory(path);
}

async function socketAcceptingConnections(path: string): Promise<boolean> {
  return await new Promise<boolean>((resolveProbe) => {
    const socket = createConnection(path);
    let settled = false;
    const finish = (accepting: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(accepting);
    };
    socket.setTimeout(300, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(!["ECONNREFUSED", "ENOENT"].includes(error.code ?? ""));
    });
  });
}

async function removeOwnedStaleSocket(path: string): Promise<void> {
  let before;
  try {
    before = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    before.isSymbolicLink()
    || !before.isSocket()
    || (typeof process.getuid === "function" && before.uid !== process.getuid())
    || (before.mode & 0o077) !== 0
  ) {
    throw brokerError("Refusing to replace an unsafe broker socket path.");
  }
  if (await socketAcceptingConnections(path)) {
    throw brokerError("Another Browser broker is already listening.");
  }
  const after = await lstat(path);
  if (
    !after.isSocket()
    || after.dev !== before.dev
    || after.ino !== before.ino
  ) {
    throw brokerError(
      "Broker socket path changed during stale-socket validation.",
    );
  }
  const quarantinedPath = `${path}.stale-${randomUUID()}`;
  try {
    await lstat(quarantinedPath);
    throw brokerError("Could not reserve a stale-socket quarantine path.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(path, quarantinedPath);
  const quarantined = await lstat(quarantinedPath);
  if (
    !quarantined.isSocket()
    || quarantined.dev !== before.dev
    || quarantined.ino !== before.ino
  ) {
    await restorePreservedReplacement(path, quarantinedPath);
    throw brokerError(
      "Broker socket path changed while quarantining a stale endpoint.",
    );
  }
  await unlink(quarantinedPath);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
  });
}

async function preserveReplacementBeforeServerClose(
  path: string,
  identity: SocketIdentity | null,
): Promise<string | null> {
  if (!identity) return null;
  let current;
  try {
    current = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (current.dev === identity.dev && current.ino === identity.ino) {
    return null;
  }
  const preservedPath = `${path}.preserved-${randomUUID()}`;
  await rename(path, preservedPath);
  return preservedPath;
}

async function restorePreservedReplacement(
  path: string,
  preservedPath: string | null,
): Promise<void> {
  if (!preservedPath) return;
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await rename(preservedPath, path);
      return;
    }
    throw error;
  }
  throw brokerError(
    "Broker socket path changed again while preserving a replacement.",
  );
}

/**
 * One manually-started, same-user Darwin broker.
 *
 * The Unix socket is constrained by UID and POSIX mode. Node does not inspect
 * Darwin ACLs or expose LOCAL_PEERCRED/LOCAL_PEERPID, so this is an honest
 * same-UID/mode boundary, not an ACL or process-identity attestation.
 */
export class BrowserMcpBroker {
  readonly closed: Promise<void>;
  readonly #options: BrowserMcpBrokerOptions;
  readonly #dependencies: BrowserMcpBrokerDependencies;
  readonly #maxClients: number;
  readonly #sockets = new Set<Socket>();
  readonly #sessions = new Set<Promise<void>>();
  #server: Server | null = null;
  #sharedBrowser: BrowserLike | null = null;
  #socketPath: string | null = null;
  #socketIdentity: SocketIdentity | null = null;
  #startPromise: Promise<string> | null = null;
  #closePromise: Promise<void> | null = null;
  #resolveClosed!: () => void;
  #started = false;
  #closing = false;

  constructor(
    options: BrowserMcpBrokerOptions,
    dependencies: BrowserMcpBrokerDependencies = {},
  ) {
    this.closed = new Promise<void>((resolveClosed) => {
      this.#resolveClosed = resolveClosed;
    });
    if ((dependencies.platform ?? process.platform) !== "darwin") {
      throw new BrowserError(
        "invalid_options",
        "Browser broker preview currently supports macOS only.",
      );
    }
    assertPublicEphemeralConfig(options.browser);
    const socketPath = checkedBrowserBrokerSocketPath(options.socketPath);
    this.#maxClients = checkedMaxClients(options.maxClients);
    this.#options = { ...options, socketPath };
    this.#dependencies = dependencies;
  }

  get socketPath(): string | null {
    return this.#socketPath;
  }

  get activeClients(): number {
    return this.#sockets.size;
  }

  async start(): Promise<string> {
    if (this.#started || this.#closing) {
      throw brokerError("Browser broker can only be started once.");
    }
    this.#started = true;
    const startPromise = this.#startOnce();
    this.#startPromise = startPromise;
    try {
      return await startPromise;
    } catch (error) {
      try {
        await this.close();
      } catch {
        // Preserve the startup failure; cleanup diagnostics may contain paths.
      }
      throw asBrowserError(
        error,
        "browser_launch_failed",
        "Could not start the local Browser broker.",
      );
    }
  }

  async #startOnce(): Promise<string> {
    const socketPath = this.#options.socketPath;
    const launchOptions: RuntimeLaunchOptions = {
      headless: this.#options.browser.headless,
      chromiumSandbox: true,
      ...(this.#options.browser.channel
        ? { channel: this.#options.browser.channel }
        : {}),
      ...(this.#options.browser.executablePath
        ? { executablePath: this.#options.browser.executablePath }
        : {}),
    };

    await ensureSecureSocketDirectory(dirname(socketPath));
    await removeOwnedStaleSocket(socketPath);
    this.#throwIfClosing();
    const sharedBrowser = this.#dependencies.launchSharedBrowser
      ? await this.#dependencies.launchSharedBrowser(launchOptions)
      : await (
          this.#dependencies.runtime ?? await loadDefaultBrowserRuntime()
        ).launch(launchOptions);
    this.#sharedBrowser = sharedBrowser;
    this.#throwIfClosing();

    const server = createServer((socket) => {
      this.#accept(socket);
    });
    server.maxConnections = this.#maxClients;
    this.#server = server;
    server.once("error", () => {
      void this.close().catch(() => {
        // The owner observes the same terminal error through close().
      });
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(socketPath, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    this.#throwIfClosing();

    const created = await lstat(socketPath);
    if (
      !created.isSocket()
      || created.isSymbolicLink()
      || (
        typeof process.getuid === "function"
        && created.uid !== process.getuid()
      )
    ) {
      throw brokerError("Browser broker did not create an owned Unix socket.");
    }
    this.#socketIdentity = { dev: created.dev, ino: created.ino };
    await chmod(socketPath, 0o600);
    const secured = await lstat(socketPath);
    if (
      !secured.isSocket()
      || secured.dev !== created.dev
      || secured.ino !== created.ino
      || (secured.mode & 0o777) !== 0o600
    ) {
      throw brokerError(
        "Browser broker socket could not be set to POSIX mode 0600.",
      );
    }
    this.#throwIfClosing();
    this.#socketPath = socketPath;
    return socketPath;
  }

  close(): Promise<void> {
    this.#closing = true;
    if (!this.#closePromise) {
      this.#closePromise = this.#closeAfterStart();
      void this.#closePromise.then(this.#resolveClosed, this.#resolveClosed);
    }
    return this.#closePromise;
  }

  async #closeAfterStart(): Promise<void> {
    try {
      await this.#startPromise;
    } catch {
      // Partial startup resources are still owned and must be closed below.
    }
    await this.#closeOnce();
  }

  async #closeOnce(): Promise<void> {
    const server = this.#server;
    const sharedBrowser = this.#sharedBrowser;
    const socketPath = this.#options.socketPath;
    const socketIdentity = this.#socketIdentity;
    this.#server = null;
    this.#sharedBrowser = null;
    this.#socketPath = null;

    let firstError: unknown;
    let preservedReplacement: string | null = null;
    try {
      preservedReplacement = server
        ? await preserveReplacementBeforeServerClose(
            socketPath,
            socketIdentity,
          )
        : null;
    } catch (error) {
      firstError = error;
    }
    const serverClosed = server ? closeServer(server) : Promise.resolve();
    for (const socket of this.#sockets) socket.destroy();
    await Promise.allSettled([...this.#sessions]);
    try {
      await serverClosed;
    } catch (error) {
      firstError ??= error;
    }
    try {
      await restorePreservedReplacement(
        socketPath,
        preservedReplacement,
      );
    } catch (error) {
      firstError ??= error;
    }
    try {
      await sharedBrowser?.close();
    } catch (error) {
      firstError ??= error;
    }
    if (socketIdentity) {
      try {
        const current = await lstat(socketPath);
        if (
          current.isSocket()
          && current.dev === socketIdentity.dev
          && current.ino === socketIdentity.ino
        ) {
          await unlink(socketPath);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          firstError ??= error;
        }
      }
    }
    if (firstError) {
      throw asBrowserError(
        firstError,
        "browser_closed",
        "Could not completely close the local Browser broker.",
      );
    }
  }

  #throwIfClosing(): void {
    if (this.#closing) {
      throw new BrowserError(
        "browser_closed",
        "Browser broker startup was cancelled by its owner.",
      );
    }
  }

  #accept(socket: Socket): void {
    if (
      this.#closing
      || !this.#sharedBrowser
      || this.#sockets.size >= this.#maxClients
    ) {
      socket.destroy();
      return;
    }
    this.#sockets.add(socket);
    socket.setNoDelay(true);
    socket.once("error", () => {
      // Raw transport diagnostics may contain untrusted bytes or local paths.
    });
    const task = this.#serve(socket).finally(() => {
      this.#sockets.delete(socket);
      this.#sessions.delete(task);
    });
    this.#sessions.add(task);
  }

  async #serve(socket: Socket): Promise<void> {
    const sharedBrowser = this.#sharedBrowser;
    if (!sharedBrowser) {
      socket.destroy();
      return;
    }

    let session: AgentBrowser | null = null;
    let handle: BrowserMcpStdioHandle | null = null;
    let boundedInput: BoundedMcpInput | null = null;
    try {
      const sessionOptions: AgentBrowserOptions = {
        authority: "public",
        profile: { mode: "ephemeral" },
        outputDir: this.#options.browser.outputDir,
      };
      session = this.#dependencies.launchSession
        ? await this.#dependencies.launchSession(
            sharedBrowser,
            sessionOptions,
          )
        : await AgentBrowser.launchEphemeralContext(
            sharedBrowser,
            sessionOptions,
          );
      if (this.#closing || socket.destroyed) return;

      const onProtocolError = (): void => {
        socket.destroy();
      };
      handle = this.#dependencies.serveSession
        ? this.#dependencies.serveSession(
            session,
            socket,
            onProtocolError,
          )
        : (() => {
            boundedInput = new BoundedMcpInput();
            boundedInput.once("error", onProtocolError);
            socket.pipe(boundedInput);
            return serveBrowserMcpStdio(session, {
              transport: new StdioServerTransport(
                boundedInput,
                socket,
              ),
              onerror: onProtocolError,
            });
          })();
      const socketClosed = new Promise<void>((resolveClosed) => {
        if (socket.destroyed) resolveClosed();
        else socket.once("close", () => resolveClosed());
      });
      await Promise.race([handle.closed, socketClosed]);
    } catch {
      socket.destroy();
    } finally {
      try {
        await handle?.close();
      } catch {
        // Session/context cleanup remains mandatory after transport failure.
      }
      if (boundedInput) {
        socket.unpipe(boundedInput);
        boundedInput.destroy();
      }
      try {
        await session?.close();
      } finally {
        socket.destroy();
      }
    }
  }
}
