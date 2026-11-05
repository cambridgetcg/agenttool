/** A person at the controlling terminal: `resume` lifts the device brake only
 * after `resume` is typed on /dev/tty. It never reads stdin, so piping the
 * word in confirms nothing, and without a terminal it fails closed. The same
 * shape as the lobby's confirmOnTty, and the same limit: a speed bump against
 * a model releasing a brake a person set, not a sandbox (a process that can
 * allocate a pseudo-terminal can still answer). Opens nothing but /dev/tty.
 */
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import { isatty } from "node:tty";

export const DEV_TTY = "/dev/tty";
const MAX_ANSWER_BYTES = 64;

export type Confirm = (prompt: string, word: string) => boolean | null;

/** True for `word` typed at /dev/tty, false for anything else, null when there is no terminal. */
export function confirmOnDevTty(prompt: string, word: string): boolean | null {
  let fd: number;
  try {
    fd = openSync(DEV_TTY, "r+");
  } catch {
    return null;
  }
  try {
    if (!isatty(fd)) return null;
    const bytes = Buffer.from(prompt, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    const collected: number[] = [];
    const one = Buffer.alloc(1);
    while (collected.length < MAX_ANSWER_BYTES) {
      let read: number;
      try {
        read = readSync(fd, one, 0, 1, null);
      } catch {
        return false;
      }
      if (read === 0 || one[0] === 0x0a || one[0] === 0x0d) break;
      collected.push(one[0]!);
    }
    return Buffer.from(collected).toString("utf8").trim() === word;
  } finally {
    closeSync(fd);
  }
}
