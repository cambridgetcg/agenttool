import { describe, expect, test } from "bun:test";
import { CollabError } from "../src/errors.js";
import { confirmOnTty, terminalRendering, type TtyPort } from "../src/tty.js";

function port(answer: string | null, written: string[] = []): TtyPort {
  return { write: (text) => { written.push(text); }, readLine: () => answer, close: () => {} };
}

const request = { act: "agree to a proposal", summary: ["extent: collab"], bytes: "{\"a\":1}", sha256: "f".repeat(64) };

describe("terminal confirmation", () => {
  test("renders hidden and line-breaking characters as escapes", () => {
    expect(terminalRendering("a​b c\nd")).toBe("a\\u{200B}b\\u{2028}c\nd");
    expect(terminalRendering("決定 yes")).toBe("決定 yes");
  });

  test("confirms only yes typed within the window", () => {
    const written: string[] = [];
    expect(confirmOnTty(request, { openTty: () => port("yes", written) })).toBe(true);
    expect(written.join("")).toContain("{\"a\":1}");
    expect(confirmOnTty(request, { openTty: () => port(" yes ") })).toBe(true);
    expect(confirmOnTty(request, { openTty: () => port("y") })).toBe(false);
    expect(confirmOnTty(request, { openTty: () => port(null) })).toBe(false);
    let now = 0;
    expect(confirmOnTty(request, {
      openTty: () => ({ ...port("yes"), readLine: () => { now = 10 * 60 * 1000; return "yes"; } }),
      now: () => now,
    })).toBe(false);
  });

  test("fails closed without a controlling terminal", () => {
    let code = "";
    try {
      confirmOnTty(request, { openTty: () => null });
    } catch (error) {
      code = error instanceof CollabError ? error.code : "other";
    }
    expect(code).toBe("tty_unavailable");
  });
});
