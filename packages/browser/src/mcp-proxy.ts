import { lstat } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  checkedBrowserBrokerSocketPath,
} from "./mcp-broker.js";
import { BrowserError } from "./errors.js";

export interface BrowserMcpProxyOptions {
  socketPath: string;
  input: Readable;
  output: Writable;
  platform?: NodeJS.Platform;
}

interface SocketIdentity {
  dev: number;
  ino: number;
}

interface VerifiedBrokerConnection {
  socket: Socket;
  guardedError: () => Error | null;
  releaseErrorGuard: () => void;
}

const BROKER_PROXY_EOF_DRAIN_MS = 5_000;

function proxyError(message: string): BrowserError {
  return new BrowserError("invalid_options", message);
}

async function inspectBrokerSocket(path: string): Promise<SocketIdentity> {
  const parent = dirname(path);
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw proxyError("Browser broker socket parent is not a real directory.");
  }
  if (
    typeof process.getuid === "function"
    && parentStat.uid !== process.getuid()
  ) {
    throw proxyError("Browser broker socket parent has the wrong owner.");
  }
  if ((parentStat.mode & 0o077) !== 0) {
    throw proxyError(
      "Browser broker socket parent must not be group or world accessible.",
    );
  }
  const socket = await lstat(path);
  if (
    !socket.isSocket()
    || socket.isSymbolicLink()
    || (
      typeof process.getuid === "function"
      && socket.uid !== process.getuid()
    )
    || (socket.mode & 0o777) !== 0o600
  ) {
    throw proxyError(
      "Browser broker endpoint is not a same-UID POSIX-mode-0600 Unix socket.",
    );
  }
  return { dev: socket.dev, ino: socket.ino };
}

async function connect(path: string): Promise<VerifiedBrokerConnection> {
  let before: SocketIdentity;
  try {
    before = await inspectBrokerSocket(path);
  } catch (error) {
    if (error instanceof BrowserError) throw error;
    throw new BrowserError(
      "not_started",
      "Could not inspect the local Browser broker endpoint.",
      { cause: error },
    );
  }
  const socket = createConnection({ path, allowHalfOpen: true });
  socket.setNoDelay(true);
  let earlyError: Error | null = null;
  const guardError = (error: Error): void => {
    earlyError ??= error;
  };
  socket.on("error", guardError);
  await new Promise<void>((resolveConnect, rejectConnect) => {
    const cleanup = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = (): void => {
      cleanup();
      resolveConnect();
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectConnect(error);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  }).catch((error) => {
    socket.destroy();
    socket.off("error", guardError);
    throw new BrowserError(
      "not_started",
      "Could not connect to the local Browser broker.",
      { cause: error },
    );
  });
  try {
    const after = await inspectBrokerSocket(path);
    if (after.dev !== before.dev || after.ino !== before.ino) {
      throw proxyError(
        "Browser broker socket changed while the relay connected.",
      );
    }
    if (earlyError || socket.errored || socket.destroyed || socket.readableEnded) {
      throw new BrowserError(
        "browser_closed",
        "Browser broker closed while the relay verified its endpoint.",
      );
    }
  } catch (error) {
    socket.destroy();
    socket.off("error", guardError);
    if (error instanceof BrowserError) throw error;
    throw new BrowserError(
      "not_started",
      "Could not verify the local Browser broker endpoint.",
      { cause: error },
    );
  }
  return {
    socket,
    guardedError: () => earlyError,
    releaseErrorGuard: () => socket.off("error", guardError),
  };
}

/**
 * Relay exact MCP stdio bytes to one same-UID, POSIX-mode-0600 Unix socket.
 *
 * Input piping and serialized output writes preserve backpressure in both
 * directions. This function never writes diagnostics or readiness text to
 * the protocol output.
 */
export async function relayBrowserMcpStdio(
  options: BrowserMcpProxyOptions,
): Promise<void> {
  if ((options.platform ?? process.platform) !== "darwin") {
    throw proxyError("Browser broker preview currently supports macOS only.");
  }
  const path = checkedBrowserBrokerSocketPath(options.socketPath);
  const connection = await connect(path);
  const socket = connection.socket;
  let failed = Boolean(connection.guardedError() || socket.errored);
  let inputEnded = options.input.readableEnded;
  let eofDrainTimer: NodeJS.Timeout | null = null;
  const onTransportError = (): void => {
    failed = true;
    socket.destroy();
  };

  let outputTail = Promise.resolve();
  const writeOutput = (chunk: Buffer): Promise<void> =>
    new Promise<void>((resolveWrite, rejectWrite) => {
      options.output.write(chunk, (error) => {
        if (error) rejectWrite(error);
        else resolveWrite();
      });
    });
  const socketDone = new Promise<void>((resolveDone) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (!inputEnded) failed = true;
      if (eofDrainTimer) clearTimeout(eofDrainTimer);
      void outputTail.finally(resolveDone);
    };
    socket.on("data", (chunk: Buffer) => {
      socket.pause();
      outputTail = outputTail
        .then(() => writeOutput(chunk))
        .catch(() => {
          failed = true;
          socket.destroy();
        })
        .finally(() => {
          if (!socket.destroyed) socket.resume();
        });
    });
    socket.once("end", () => {
      if (!socket.writableEnded) socket.end();
      finish();
    });
    socket.once("close", finish);
    if (socket.destroyed || socket.readableEnded) finish();
  });
  const onInputEnd = (): void => {
    if (inputEnded) return;
    inputEnded = true;
    if (!socket.destroyed && !socket.writableEnded) socket.end();
    eofDrainTimer = setTimeout(() => {
      failed = true;
      socket.destroy();
    }, BROKER_PROXY_EOF_DRAIN_MS);
  };
  const onInputClose = (): void => {
    if (!inputEnded && !options.input.readableEnded) {
      onTransportError();
    }
  };
  socket.once("error", onTransportError);
  options.input.once("error", onTransportError);
  options.input.once("close", onInputClose);
  options.output.once("error", onTransportError);
  connection.releaseErrorGuard();
  if (connection.guardedError() || socket.errored) onTransportError();
  if (
    options.input.destroyed
    && (!options.input.readableEnded || options.input.readableAborted)
  ) {
    onTransportError();
  } else if (inputEnded) {
    if (!socket.destroyed && !socket.writableEnded) socket.end();
    eofDrainTimer = setTimeout(() => {
      failed = true;
      socket.destroy();
    }, BROKER_PROXY_EOF_DRAIN_MS);
  } else {
    options.input.once("end", onInputEnd);
    options.input.pipe(socket, { end: false });
  }
  try {
    await socketDone;
  } catch {
    failed = true;
  } finally {
    options.input.unpipe(socket);
    options.input.pause();
    options.input.off("end", onInputEnd);
    options.input.off("error", onTransportError);
    options.input.off("close", onInputClose);
    options.output.off("error", onTransportError);
    socket.off("error", onTransportError);
    if (eofDrainTimer) clearTimeout(eofDrainTimer);
    socket.destroy();
  }
  if (failed) {
    throw new BrowserError(
      "browser_closed",
      "Browser broker relay closed after a transport failure.",
    );
  }
}
