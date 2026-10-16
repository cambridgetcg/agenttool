/** Terminal confirmation for consequential acts.
 *
 * confirmOnTty() writes the exact bytes of the act to /dev/tty and reads the
 * answer from /dev/tty. It never reads stdin, so piping "yes" into the CLI
 * confirms nothing. Without a controlling terminal it fails closed.
 *
 * Limit: this is a speed bump against a model approving its own act through
 * a tool call, not a sandbox. A process that can allocate a pseudo-terminal
 * and type into it (for example with script(1) or expect) can still answer.
 */
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import { isatty } from "node:tty";
import { LobbyError } from "./errors.js";
import { TERMINAL_UNSAFE } from "./text.js";

export const DEV_TTY = "/dev/tty";
export const CONFIRM_WORD = "yes";
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ANSWER_BYTES = 256;

export interface TtyPort {
  write(text: string): void;
  /** One line without its newline; null at end of input. */
  readLine(maxBytes: number): string | null;
  close(): void;
}

export type OpenTty = () => TtyPort | null;

export interface ConfirmRequest {
  act: string;
  summary: readonly string[];
  bytes: string;
  sha256: string;
}

export interface ConfirmOptions {
  openTty?: OpenTty;
  now?: () => number;
  windowMs?: number;
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Open the controlling terminal, or null when there is none. Refuses any
 * path that is not a terminal (a file, a pipe, /dev/null). */
export function openDevTty(path: string = DEV_TTY): TtyPort | null {
  let fd: number;
  try {
    fd = openSync(path, "r+");
  } catch {
    return null;
  }
  let terminal = false;
  try {
    terminal = isatty(fd);
  } catch {
    terminal = false;
  }
  if (!terminal) {
    closeSync(fd);
    return null;
  }
  return {
    write(text: string) {
      const bytes = Buffer.from(text, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        offset += writeSync(fd, bytes, offset, bytes.length - offset);
      }
    },
    readLine(maxBytes: number) {
      const collected: number[] = [];
      const one = Buffer.alloc(1);
      while (collected.length < maxBytes) {
        let count: number;
        try {
          count = readSync(fd, one, 0, 1, null);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EAGAIN") {
            pause(50);
            continue;
          }
          throw error;
        }
        if (count === 0) return collected.length === 0 ? null : Buffer.from(collected).toString("utf8");
        if (one[0] === 0x0a) break;
        collected.push(one[0]!);
      }
      return Buffer.from(collected).toString("utf8");
    },
    close() {
      closeSync(fd);
    },
  };
}

function assertTerminalSafe(text: string, what: string): void {
  if (TERMINAL_UNSAFE.test(text)) {
    throw new LobbyError("unsafe_preview", `${what} contains characters that cannot be shown faithfully`);
  }
}

/** Show the exact bytes on /dev/tty and return true only for "yes" typed
 * there within the window. Throws `tty_unavailable` when no terminal exists. */
export async function confirmOnTty(request: ConfirmRequest, options: ConfirmOptions = {}): Promise<boolean> {
  assertTerminalSafe(request.bytes, "the act bytes");
  for (const line of request.summary) assertTerminalSafe(line, "the act summary");
  assertTerminalSafe(request.act, "the act name");
  const open = options.openTty ?? (() => openDevTty());
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const port = open();
  if (port === null) {
    throw new LobbyError(
      "tty_unavailable",
      "this act needs a person at the controlling terminal (/dev/tty); none is available, so nothing was written",
    );
  }
  try {
    const byteLength = Buffer.byteLength(request.bytes, "utf8");
    port.write(
      [
        "",
        `agenttool-lobby: consequential act ${request.act}`,
        ...request.summary.map((line) => `  ${line}`),
        `exact bytes (${byteLength} bytes, sha256 ${request.sha256}):`,
        request.bytes,
        `Type ${CONFIRM_WORD} to record exactly these bytes; anything else cancels: `,
      ].join("\n"),
    );
    const started = now();
    const answer = port.readLine(MAX_ANSWER_BYTES);
    if (now() - started > windowMs) {
      port.write("confirmation window passed; nothing was written\n");
      return false;
    }
    const confirmed = answer !== null && answer.trim() === CONFIRM_WORD;
    port.write(confirmed ? "confirmed\n" : "cancelled; nothing was written\n");
    return confirmed;
  } finally {
    port.close();
  }
}
