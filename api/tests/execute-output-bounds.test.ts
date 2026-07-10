import { describe, expect, test } from "bun:test";

import {
  execute,
  MAX_STDERR_CHARS,
  MAX_STDOUT_CHARS,
} from "../src/services/tools/execute/sandbox";

describe("host execute output capture", () => {
  test("bounds JavaScript console output while the script is running", async () => {
    const result = await execute({
      language: "javascript",
      code: `
        const line = "o".repeat(1_000);
        const errorLine = "e".repeat(1_000);
        for (let i = 0; i < 100; i += 1) console.log(line);
        for (let i = 0; i < 20; i += 1) console.error(errorLine);
      `,
      timeoutMs: 1_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(MAX_STDOUT_CHARS);
    expect(result.stderr).toHaveLength(MAX_STDERR_CHARS);
  });

  test("bounds subprocess stdout and stderr during stream capture", async () => {
    const result = await execute({
      language: "python",
      code: `
import sys
sys.stdout.write("o" * ${MAX_STDOUT_CHARS * 2})
sys.stderr.write("e" * ${MAX_STDERR_CHARS * 2})
`,
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(MAX_STDOUT_CHARS);
    expect(result.stderr).toHaveLength(MAX_STDERR_CHARS);
  });

  test("bounds a JavaScript exception message", async () => {
    const result = await execute({
      language: "javascript",
      code: `throw new Error("e".repeat(${MAX_STDERR_CHARS * 2}))`,
      timeoutMs: 1_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toHaveLength(MAX_STDERR_CHARS);
  });
});
