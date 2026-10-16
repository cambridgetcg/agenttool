import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TtyPort } from "../src/tty.js";

export const packageRoot = join(import.meta.dir, "..");

const cleanups: Array<() => void> = [];

/** A fresh parent directory; the desk home inside it does not exist yet. */
export function tempHome(): { parent: string; home: string } {
  const parent = mkdtempSync(join(tmpdir(), "agenttool-lobby-test-"));
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, home: join(parent, "lobby") };
}

export function cleanupTempHomes(): void {
  while (cleanups.length > 0) cleanups.pop()!();
}

export interface FakeTerminal {
  open: () => TtyPort | null;
  written: string[];
  opened: number;
  closed: number;
}

/** A scripted terminal: each readLine returns the next answer (null = EOF). */
export function fakeTerminal(answers: Array<string | null>): FakeTerminal {
  const state: FakeTerminal = {
    written: [],
    opened: 0,
    closed: 0,
    open: () => {
      state.opened += 1;
      return {
        write: (text: string) => {
          state.written.push(text);
        },
        readLine: () => (answers.length === 0 ? null : answers.shift()!),
        close: () => {
          state.closed += 1;
        },
      };
    },
  };
  return state;
}

/** Synthetic, clearly fake 32-byte public keys for pin tests. */
export function fakePublicKey(fill: number): string {
  return Buffer.alloc(32, fill).toString("base64");
}
