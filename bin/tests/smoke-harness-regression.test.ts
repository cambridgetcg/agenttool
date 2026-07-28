import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, test } from "bun:test";

const ROOT = resolve(import.meta.dir, "../..");

function runBash(script: string): number {
  return Bun.spawnSync(["bash", "-c", script], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  }).exitCode;
}

describe("deployed smoke harness response parsing", () => {
  test("recognizes generic and structured-suffix JSON media types", async () => {
    const helperUrl = pathToFileURL(
      join(ROOT, "api", "scripts", "_e2e-http.mjs"),
    ).href;
    const { isJsonMediaType } = await import(helperUrl) as {
      isJsonMediaType: (value: string | null | undefined) => boolean;
    };

    for (const contentType of [
      "application/json",
      "Application/Problem+JSON; charset=utf-8",
      "application/vnd.agenttool.wake+json; provider=anthropic; charset=utf-8",
      "application/mathos+json",
    ]) {
      expect(isJsonMediaType(contentType), contentType).toBe(true);
    }
    for (const contentType of [
      null,
      "",
      "text/plain",
      "text/json",
      "application/json-seq",
    ]) {
      expect(isJsonMediaType(contentType), String(contentType)).toBe(false);
    }
  });

  test("does not pipe any response into an early-closing grep", async () => {
    const smoke = await readFile(join(ROOT, "bin", "smoke-test.sh"), "utf8");

    expect(smoke).toContain("WAKE_MD=$(curl -fsS");
    expect(smoke).toContain('[[ "$WAKE_MD" == "# "* ]]');
    expect(smoke).not.toMatch(/\|\s*grep\s+-q/);
    expect(smoke.match(/\|\s*grep\s+-F\s+/g)?.length).toBeGreaterThanOrEqual(9);
  });

  test("read-to-EOF matching drains large bodies and preserves producer failures", () => {
    const largeResponse = runBash(`
      set -o pipefail
      python3 -c 'import sys; sys.stdout.write("MATCH\\n" + "x" * 1048576)' |
        grep -F MATCH >/dev/null
    `);
    expect(largeResponse).toBe(0);

    const failedProducer = runBash(`
      set -o pipefail
      (printf 'MATCH\\n'; exit 23) | grep -F MATCH >/dev/null
    `);
    expect(failedProducer).toBe(23);
  });
});
