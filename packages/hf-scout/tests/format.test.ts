import { describe, expect, test } from "bun:test";

import {
  escapeTerminalText,
  safeJson,
} from "../src/index.js";

describe("terminal-safe output", () => {
  test("escapes control and bidirectional override characters", () => {
    const escaped = escapeTerminalText("safe\ntext\u202eend");
    expect(escaped).toBe("safe\\u000atext\\u202eend");
    expect(escaped).not.toContain("\n");
    expect(escaped).not.toContain("\u202e");
  });

  test("escapes bidi state even in pretty JSON", () => {
    const controls = "\u061c\u200e\u200f\u2066\u206a\u206f";
    const output = safeJson({ value: `left${controls}right` });
    for (const control of controls) expect(output).not.toContain(control);
    expect(output).toContain("\\u061c\\u200e\\u200f\\u2066\\u206a\\u206f");
    expect(escapeTerminalText(controls))
      .toBe("\\u061c\\u200e\\u200f\\u2066\\u206a\\u206f");
  });

  test("escapes DEL and C1 state while preserving valid pretty JSON", () => {
    const output = safeJson({ value: "left\u007f\u009bright" });
    expect(output).toContain("\\u007f\\u009b");
    expect(output).not.toContain("\u007f");
    expect(output).not.toContain("\u009b");
    expect(() => JSON.parse(output)).not.toThrow();
  });
});
