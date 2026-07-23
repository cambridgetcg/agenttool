import { describe, expect, test } from "bun:test";

import {
  loadRunConfig,
  loadScopeConfig,
  loadTargetConfig,
} from "../src/config";
import { ProjectorError, safeErrorText } from "../src/errors";

const valid = {
  AGENTTOOL_YUTABASE_TARGET_URL:
    "postgresql://projector:secret@127.0.0.1:5432/yutabase_local",
  AGENTTOOL_YUTABASE_CLAIMANT: "service:local-projector",
  AGENTTOOL_YUTABASE_SOURCE_URL: "http://127.0.0.1:3000",
  AGENTTOOL_YUTABASE_SOURCE_TOKEN: "local-secret-token",
  AGENTTOOL_YUTABASE_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
  AGENTTOOL_YUTABASE_REPOSITORY_ID: "repo-a",
};

describe("fail-closed local configuration", () => {
  test("loads only dedicated variables", () => {
    expect(loadTargetConfig(valid).claimant).toBe("service:local-projector");
    expect(loadScopeConfig(valid).sourceOrigin).toBe(
      "http://127.0.0.1:3000",
    );
    expect(loadRunConfig(valid).sourceToken).toBe("local-secret-token");
  });

  test.each([
    ["source hostname", { AGENTTOOL_YUTABASE_SOURCE_URL: "http://localhost:3000" }],
    ["source remote", { AGENTTOOL_YUTABASE_SOURCE_URL: "https://api.agenttool.dev" }],
    ["source path", { AGENTTOOL_YUTABASE_SOURCE_URL: "http://127.0.0.1:3000/api" }],
    ["source credentials", { AGENTTOOL_YUTABASE_SOURCE_URL: "http://x@127.0.0.1:3000" }],
    ["target hostname", { AGENTTOOL_YUTABASE_TARGET_URL: "postgresql://localhost/db" }],
    ["target remote", { AGENTTOOL_YUTABASE_TARGET_URL: "postgresql://db.example/db" }],
    ["target no database", { AGENTTOOL_YUTABASE_TARGET_URL: "postgresql://127.0.0.1/" }],
  ])("rejects %s", (_label, replacement) => {
    expect(() => loadRunConfig({ ...valid, ...replacement })).toThrow(
      ProjectorError,
    );
  });

  test("never falls back to ambient AgentTool or Postgres credentials", () => {
    expect(() =>
      loadRunConfig({
        AT_API_KEY: "ambient-token",
        POSTGRES_URL: "postgresql://127.0.0.1/ambient",
      }),
    ).toThrow(ProjectorError);
  });

  test("safe errors never include config secrets", () => {
    const raw = new Error(
      `${valid.AGENTTOOL_YUTABASE_SOURCE_TOKEN} ${valid.AGENTTOOL_YUTABASE_TARGET_URL}`,
    );
    expect(safeErrorText(raw)).toBe("apply_failed");
    expect(safeErrorText(raw)).not.toContain("secret");
  });
});
