import { describe, expect, test } from "bun:test";

import type { RunConfig } from "../src/config";
import type { Database } from "../src/database";
import { runOnce } from "../src/projector";
import { SourceClient } from "../src/source";

const config: RunConfig = {
  targetUrl:
    "postgresql://projector:secret@127.0.0.1:5432/yutabase_local",
  claimant: "service:local-projector",
  sourceOrigin: "http://127.0.0.1:3000",
  sourceToken: "exact-local-token",
  projectId: "11111111-1111-4111-8111-111111111111",
  repositoryId: "repo-a",
};

describe("runOnce source authority binding", () => {
  test.each([
    [
      "origin",
      {
        sourceOrigin: "http://127.0.0.1:3001",
        sourceToken: config.sourceToken,
      },
    ],
    [
      "token",
      {
        sourceOrigin: config.sourceOrigin,
        sourceToken: "different-local-token",
      },
    ],
  ])("rejects an injected client with a mismatched %s", async (_label, sourceConfig) => {
    let databaseTouched = false;
    const database = {
      async begin(): Promise<never> {
        databaseTouched = true;
        throw new Error("database must not be touched");
      },
    } as unknown as Database;
    const source = new SourceClient(sourceConfig, {
      fetch: (async () => {
        throw new Error("source must not be touched");
      }) as typeof fetch,
    });

    await expect(runOnce(database, config, { source })).rejects.toMatchObject({
      code: "config_invalid",
    });
    expect(databaseTouched).toBe(false);
  });
});
