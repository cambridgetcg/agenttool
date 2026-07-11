/** Regression coverage for the authenticated consciousness-river write path.
 *
 * Public discovery has long advertised POST /v1/river. Keep the production
 * composition layer pinned so the existing router cannot silently become an
 * unmounted promise again. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = join(import.meta.dir, "..");
const indexSource = readFileSync(join(API_ROOT, "src", "index.ts"), "utf8");

const wiring = {
  import: 'import riverRouter from "./routes/river"',
  authExact: 'app.use("/v1/river", authMiddleware)',
  authWildcard: 'app.use("/v1/river/*", authMiddleware)',
  idempotencyExact: 'app.use("/v1/river", idempotency())',
  idempotencyWildcard: 'app.use("/v1/river/*", idempotency())',
  headersExact: 'app.use("/v1/river", rateLimitHeaders())',
  headersWildcard: 'app.use("/v1/river/*", rateLimitHeaders())',
  mount: 'app.route("/v1/river", riverRouter)',
} as const;

describe("POST /v1/river production mount", () => {
  test("imports and mounts the real router after auth and idempotency middleware", () => {
    for (const line of Object.values(wiring)) {
      expect(indexSource).toContain(line);
    }

    const mountIndex = indexSource.indexOf(wiring.mount);
    expect(indexSource.indexOf(wiring.authExact)).toBeLessThan(mountIndex);
    expect(indexSource.indexOf(wiring.authWildcard)).toBeLessThan(mountIndex);
    expect(indexSource.indexOf(wiring.idempotencyExact)).toBeLessThan(mountIndex);
    expect(indexSource.indexOf(wiring.idempotencyWildcard)).toBeLessThan(mountIndex);
    expect(indexSource.indexOf(wiring.headersExact)).toBeLessThan(mountIndex);
    expect(indexSource.indexOf(wiring.headersWildcard)).toBeLessThan(mountIndex);
  });

  test("the assembled app rejects an unauthenticated river drop", async () => {
    const probe = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
          const { app } = await import("./src/index.ts");
          const response = await app.request("/v1/river", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              identity_id: "00000000-0000-4000-8000-000000000000",
              body: "hello, river",
            }),
          });
          process.stdout.write("RIVER_STATUS=" + response.status + "\\n");
          process.exit(0);
        `,
      ],
      {
        cwd: API_ROOT,
        env: {
          ...process.env,
          AGENTTOOL_DISABLE_WORKERS: "1",
          AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
          AGENTOOL_DISABLE_SAGA_SEED: "1",
          AGENTOOL_DISABLE_JOY_INDEX: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      probe.exited,
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
    ]);

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain("RIVER_STATUS=401");
  });
});
