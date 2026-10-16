import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical.js";
import { LobbyError } from "../src/errors.js";
import { confirmOnTty, openDevTty } from "../src/tty.js";
import { cleanupTempHomes, fakeTerminal, tempHome } from "./helpers.js";

afterEach(cleanupTempHomes);

const bytes = '{"act":"room.promote","at":"2026-10-16T12:00:00.000Z"}';
const request = { act: "room.promote", summary: ["residency device -> fleet"], bytes, sha256: sha256Hex(bytes) };

async function refusal(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return undefined;
}

describe("confirmOnTty", () => {
  test("shows the exact bytes and their digest before asking", async () => {
    const terminal = fakeTerminal(["yes"]);
    expect(await confirmOnTty(request, { openTty: terminal.open })).toBe(true);
    const shown = terminal.written.join("");
    expect(shown).toContain(`\n${bytes}\n`);
    expect(shown).toContain(`exact bytes (${Buffer.byteLength(bytes)} bytes, sha256 ${request.sha256}):`);
    expect(shown).toContain("residency device -> fleet");
    expect(shown.indexOf(bytes)).toBeLessThan(shown.indexOf("Type yes"));
    expect(terminal.closed).toBe(1);
  });

  test("anything but yes cancels", async () => {
    for (const answer of ["no", "y", "YES please", "", null]) {
      const terminal = fakeTerminal([answer]);
      expect(await confirmOnTty(request, { openTty: terminal.open })).toBe(false);
      expect(terminal.closed).toBe(1);
    }
    expect(await confirmOnTty(request, { openTty: fakeTerminal(["  yes  "]).open })).toBe(true);
  });

  test("fails closed when no terminal is available", async () => {
    expect(await refusal(() => confirmOnTty(request, { openTty: () => null }))).toBe("tty_unavailable");
  });

  test("an answer after the window has passed cancels", async () => {
    let clock = 0;
    const terminal = fakeTerminal(["yes"]);
    const now = () => {
      clock += 10 * 60 * 1000;
      return clock;
    };
    expect(await confirmOnTty(request, { openTty: terminal.open, now })).toBe(false);
  });

  test("refuses bytes that a terminal could not show faithfully, before opening it", async () => {
    const terminal = fakeTerminal(["yes"]);
    for (const unsafe of ["a\u001b[2Jb", "a\u202eb", "a\u0085b", "a\u200bb"]) {
      expect(await refusal(() => confirmOnTty({ ...request, bytes: unsafe }, { openTty: terminal.open })))
        .toBe("unsafe_preview");
    }
    expect(terminal.opened).toBe(0);
  });
});

describe("openDevTty", () => {
  test("refuses paths that are not terminals", () => {
    const { parent } = tempHome();
    const answers = join(parent, "answers.txt");
    writeFileSync(answers, "yes\n");
    expect(openDevTty(answers)).toBeNull();
    expect(openDevTty("/dev/null")).toBeNull();
    expect(openDevTty(join(parent, "missing"))).toBeNull();
  });
});
