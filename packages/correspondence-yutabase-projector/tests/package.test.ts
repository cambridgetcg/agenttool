import { describe, expect, test } from "bun:test";

import {
  PROJECTOR_SCHEMA_VERSION,
  REQUIRED_CAPABILITIES,
  YUTABASE_IDENTITY,
} from "../src/constants";
import { ProjectorError } from "../src/errors";

describe("private package boundary", () => {
  test("is not publishable or wired to release hooks", async () => {
    const packageJson = await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json();
    const publishWorkflow = await Bun.file(
      new URL(
        "../../../.github/workflows/publish-npm.yml",
        import.meta.url,
      ),
    ).text();
    const releaseScript = await Bun.file(
      new URL("../../../bin/npm-release.ts", import.meta.url),
    ).text();
    expect(packageJson.private).toBe(true);
    expect(packageJson.publishConfig).toBeUndefined();
    expect(packageJson.scripts?.prepack).toBeUndefined();
    expect(publishWorkflow).not.toContain(
      "- correspondence-yutabase-projector",
    );
    expect(releaseScript).not.toContain(
      "packages/correspondence-yutabase-projector",
    );
  });

  test("schema has no raw private source or credential columns", async () => {
    const schema = await Bun.file(
      new URL("../src/schema.ts", import.meta.url),
    ).text();
    for (const forbidden of [
      "event_body",
      "signature_value",
      "raw_public_key",
      "scope_paths",
      "scope_branch",
      "artifact_locator",
      "bearer_token",
      "database_url",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
    expect(schema).toContain("verified_public_key_sha256");
    expect(schema).toContain("source_identity_id uuid NOT NULL");
    expect(schema).toContain(
      "CONSTRAINT signing_key_cards_public_key_sha256",
    );
    expect(
      schema.match(/yu\._source_locators_valid\(src\)/g),
    ).toHaveLength(7);
    expect(PROJECTOR_SCHEMA_VERSION).toBe(2);
    expect(
      new ProjectorError("signing_key_binding_collision").code,
    ).toBe("signing_key_binding_collision");
  });

  test("delegates exact revision-5 registry guards to YUTABASE", async () => {
    const preflight = await Bun.file(
      new URL("../src/preflight.ts", import.meta.url),
    ).text();
    expect(YUTABASE_IDENTITY.revision).toBe(5);
    expect(REQUIRED_CAPABILITIES).toEqual([
      "row-claims",
      "logical-physical-registry",
      "word-version-pinning",
      "global-thread-id-ledger",
      "endpoint-existence-on-insert",
      "concurrency-safe-to-one",
      "role-scoped-functions",
      "guarded-card-identity",
      "nonblank-source-locators",
    ]);
    expect(preflight).not.toContain(
      "CREATE TRIGGER yutabase_guard_delete",
    );
    expect(preflight).not.toContain(
      "CREATE TRIGGER yutabase_guard_truncate",
    );
    expect(preflight).toContain("t.tgconstraint");
    expect(preflight).toContain("t.tgparentid");
    expect(preflight).toContain("t.tgnargs");
    expect(preflight).toContain("t.tgqual IS NULL AS no_when");
    expect(preflight).toContain(
      "t.tgoldtable IS NULL AND t.tgnewtable IS NULL",
    );
    expect(preflight).toContain(
      "FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY",
    );
    expect(preflight).toContain('name: "yutabase_guard_delete"');
    expect(preflight).toContain('functionName: "_guard_delete"');
    expect(preflight).toContain("securityDefiner: true");
    expect(preflight).toMatch(
      /name: "yutabase_guard_delete",\s+type: 25,[\s\S]*?columns: \[\]/,
    );
    expect(preflight).toContain('name: "yutabase_guard_truncate"');
    expect(preflight).toContain('functionName: "_guard_truncate"');
    expect(preflight).toContain("type: 32");
    expect(preflight).toContain(
      "FROM yu._lock_registry_mapping(${expected.book}, ${expected.deck})",
    );
    expect(preflight).toContain("can_lock_registry_mapping");
    expect(preflight).toContain("source_locator_public_execute");
    expect(preflight).toContain(
      "GRANT yu_appender TO agenttool_yutabase_projector",
    );
    expect(preflight).not.toContain(
      "GRANT INSERT ON yu.threads TO agenttool_yutabase_projector",
    );
    expect(preflight).toContain(
      "SELECT * FROM actual EXCEPT ALL SELECT * FROM expected",
    );
    expect(preflight).not.toContain(
      "GRANT EXECUTE ON FUNCTION yu._source_locators_valid(text[])",
    );
    expect(preflight).not.toContain("[...left].sort()");
  });

  test("uses revision-5-compatible isolation for semantic mutations", async () => {
    const [apply, preflight] = await Promise.all([
      Bun.file(new URL("../src/apply.ts", import.meta.url)).text(),
      Bun.file(new URL("../src/preflight.ts", import.meta.url)).text(),
    ]);
    expect(apply).toMatch(
      /export async function applyVerifiedPlan[\s\S]*?SET TRANSACTION ISOLATION LEVEL READ COMMITTED/,
    );
    expect(preflight).toMatch(
      /export async function installProjector[\s\S]*?SET TRANSACTION ISOLATION LEVEL READ COMMITTED/,
    );
    expect(apply).not.toContain(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    );
    expect(apply).not.toContain(
      "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    );
  });
});
