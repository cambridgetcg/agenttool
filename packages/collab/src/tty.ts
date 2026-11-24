/** Terminal confirmation for a person's acts, following the Lobby contract
 * (packages/lobby/src/tty.ts): the exact bytes are written to /dev/tty and the
 * answer is read from /dev/tty, never stdin, so piping "yes" confirms nothing.
 * Without a controlling terminal it fails closed.
 *
 * Limit: this is a speed bump against a model approving its own act through a
 * tool call, not a sandbox. A process that can allocate a pseudo-terminal and
 * type into it (script(1), expect) can still answer. It shows that a terminal
 * answered, not who did.
 */
import { closeSync, constants, openSync, readSync, writeSync } from "node:fs";
import { isatty } from "node:tty";
import { CollabError } from "./errors.js";

export const DEV_TTY = "/dev/tty";
export const CONFIRM_WORD = "yes";
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ANSWER_BYTES = 256;
// Controls, bidirectional and invisible format characters cannot be shown
// faithfully, so they are rendered as escapes. Newline stays a newline.
const TERMINAL_UNSAFE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

export interface TtyPort {
  write(text: string): void;
  /**
   * One line without its newline; null at end of input or once `deadline`
   * (milliseconds since the epoch, by `now`) passes with no full line.
   */
  readLine(maxBytes: number, deadline?: number, now?: () => number): string | null;
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

/** Render text so every code point that a terminal could hide is visible. */
export function terminalRendering(text: string): string {
  return text.replace(TERMINAL_UNSAFE, (char) =>
    `\\u{${char.codePointAt(0)!.toString(16).toUpperCase()}}`
  );
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * How long a write waits, in total, for a terminal that takes no bytes
 * (EAGAIN on the non-blocking descriptor) before it gives up with that error:
 * a terminal paused with ^S, or a pseudo-terminal nobody is draining. Each
 * wait is short, and any progress starts the budget again.
 */
export const WRITE_STALL_BUDGET_MS = 10_000;
const WRITE_RETRY_MS = 20;
const READ_RETRY_MS = 50;

/** The descriptor calls a terminal port makes; tests stub them. */
export interface TtyFdCalls {
  writeSync(fd: number, buffer: Buffer, offset: number, length: number): number;
  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: null): number;
  closeSync(fd: number): void;
  pause(ms: number): void;
}

const FD_CALLS: TtyFdCalls = { writeSync, readSync, closeSync, pause };

function isEagain(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EAGAIN" || code === "EWOULDBLOCK";
}

/**
 * A port over an open, non-blocking terminal descriptor. Reads and writes
 * both wait out EAGAIN: a read until its deadline, a write for at most
 * `stallBudgetMs` without progress, after which it throws that error, as a
 * write did before without waiting.
 */
export function ttyPortForFd(
  fd: number,
  calls: TtyFdCalls = FD_CALLS,
  stallBudgetMs: number = WRITE_STALL_BUDGET_MS,
): TtyPort {
  return {
    write(text: string) {
      const bytes = Buffer.from(text, "utf8");
      let offset = 0;
      let stalled = 0;
      while (offset < bytes.length) {
        let wrote = 0;
        let refused: unknown = null;
        try {
          wrote = calls.writeSync(fd, bytes, offset, bytes.length - offset);
        } catch (error) {
          if (!isEagain(error)) throw error;
          refused = error;
        }
        if (wrote > 0) {
          offset += wrote;
          stalled = 0;
          continue;
        }
        // EAGAIN, or a write that took nothing: wait a little, within the budget.
        if (stalled >= stallBudgetMs) throw refused ?? new Error("the terminal accepted no bytes");
        calls.pause(WRITE_RETRY_MS);
        stalled += WRITE_RETRY_MS;
      }
    },
    readLine(maxBytes: number, deadline?: number, now: () => number = Date.now) {
      const one = Buffer.alloc(1);
      const collected: number[] = [];
      let overflow = false;
      while (true) {
        if (deadline !== undefined && now() > deadline) return null;
        let read: number;
        try {
          read = calls.readSync(fd, one, 0, 1, null);
        } catch (error) {
          if (!isEagain(error)) throw error;
          calls.pause(READ_RETRY_MS);
          continue;
        }
        if (read === 0) return collected.length === 0 ? null : Buffer.from(collected).toString("utf8");
        // A terminal left in raw mode sends "\r" for Enter.
        if (one[0] === 0x0a || one[0] === 0x0d) break;
        // Past the cap, keep reading to the end of the line so nothing is
        // left for the shell, but treat the answer as not "yes".
        if (collected.length < maxBytes) collected.push(one[0]!);
        else overflow = true;
      }
      return overflow ? "" : Buffer.from(collected).toString("utf8");
    },
    close() {
      calls.closeSync(fd);
    },
  };
}

/** Open the controlling terminal, or null when there is none. Refuses any
 * path that is not a terminal (a file, a pipe, /dev/null). */
export function openDevTty(path: string = DEV_TTY): TtyPort | null {
  let fd: number;
  try {
    // Non-blocking, so the confirmation window is a real deadline.
    fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
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
  return ttyPortForFd(fd);
}

/** Show the exact bytes on /dev/tty and return true only for "yes" typed
 * there within the window. Throws `tty_unavailable` when no terminal exists. */
export function confirmOnTty(request: ConfirmRequest, options: ConfirmOptions = {}): boolean {
  const open = options.openTty ?? (() => openDevTty());
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const port = open();
  if (port === null) {
    throw new CollabError(
      "tty_unavailable",
      "This act needs a person at the controlling terminal (/dev/tty); none is available, so nothing was written",
    );
  }
  try {
    const byteLength = Buffer.byteLength(request.bytes, "utf8");
    const rendered = terminalRendering(request.bytes);
    port.write(
      [
        "",
        `agenttool-collab-host: person act ${terminalRendering(request.act)}`,
        ...request.summary.map((line) => `  ${terminalRendering(line)}`),
        `exact bytes (${byteLength} bytes, sha256 ${request.sha256})`
          + (rendered === request.bytes ? ":" : ", hidden characters shown as \\u{...}:"),
        rendered,
        `Type ${CONFIRM_WORD} to record exactly these bytes; anything else cancels: `,
      ].join("\n"),
    );
    const started = now();
    const answer = port.readLine(MAX_ANSWER_BYTES, started + windowMs, now);
    if (answer === null || now() - started > windowMs) {
      port.write("no answer within the confirmation window; nothing was written\n");
      return false;
    }
    const confirmed = answer !== null && answer.trim() === CONFIRM_WORD;
    port.write(confirmed ? "confirmed\n" : "cancelled; nothing was written\n");
    return confirmed;
  } finally {
    port.close();
  }
}
