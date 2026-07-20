import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import executeRouter, {
  unsafeHostExecuteEnabled,
} from "../src/routes/tools/execute";

describe("host execute fail-closed gate", () => {
  test("only the exact explicit opt-in enables the legacy path", () => {
    expect(unsafeHostExecuteEnabled(undefined)).toBe(false);
    expect(unsafeHostExecuteEnabled("")).toBe(false);
    expect(unsafeHostExecuteEnabled("true")).toBe(false);
    expect(unsafeHostExecuteEnabled("1")).toBe(true);
  });

  test("returns 503 before parsing or charging when the flag is absent", async () => {
    const previous = process.env.AGENTTOOL_ENABLE_UNSAFE_EXECUTE;
    delete process.env.AGENTTOOL_ENABLE_UNSAFE_EXECUTE;
    try {
      const res = await executeRouter.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json-and-must-not-be-parsed",
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(
        expect.objectContaining({
          error: "unsafe_host_execute_disabled",
          enabled_by_process_flag: false,
          safety: "/public/safety",
        }),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTTOOL_ENABLE_UNSAFE_EXECUTE;
      } else {
        process.env.AGENTTOOL_ENABLE_UNSAFE_EXECUTE = previous;
      }
    }
  });

  test("the guard remains before request parsing, charging, and execution", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "tools", "execute.ts"),
      "utf8",
    );
    const guard = source.indexOf("if (!unsafeHostExecuteEnabled())");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(source.indexOf("executeSchema.parse"));
    expect(guard).toBeLessThan(source.indexOf("await charge"));
    expect(guard).toBeLessThan(source.indexOf("await execute"));
  });
});
