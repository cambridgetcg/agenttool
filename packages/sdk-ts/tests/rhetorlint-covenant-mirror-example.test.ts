import { describe, expect, test } from "bun:test";

import { runCovenantMirrorDemo } from "../examples/rhetorlint-covenant-mirror.ts";

describe("RhetorLint covenant mirror example", () => {
  test("defaults to local refusal with no request", async () => {
    const originalFetch = globalThis.fetch;
    const lines: string[] = [];

    const result = await runCovenantMirrorDemo({
      write: (line) => lines.push(line),
    });

    expect(result.approved).toBe(false);
    expect(result.tells).toBeGreaterThan(0);
    expect(result.transportRequests).toBe(0);
    expect(result.requestBody).toBeNull();
    expect(globalThis.fetch).toBe(originalFetch);
    expect(lines.join("\n")).not.toContain("Mistakes were made");
  });

  test("demo approval signs once without attaching the RhetorLint report", async () => {
    const result = await runCovenantMirrorDemo({
      approve: true,
      write: () => {},
    });

    expect(result.approved).toBe(true);
    expect(result.tells).toBeGreaterThan(0);
    expect(result.transportRequests).toBe(1);
    expect(result.requestBody?.vows).toEqual([
      "Mistakes were made, and I will explain what I did.",
    ]);
    expect(typeof result.requestBody?.signature).toBe("string");

    const wire = JSON.stringify(result.requestBody);
    expect(wire).not.toContain("rhetorlint");
    expect(wire).not.toContain("marks");
    expect(wire).not.toContain("density");
  });
});
