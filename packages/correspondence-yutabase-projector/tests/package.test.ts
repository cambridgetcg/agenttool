import { describe, expect, test } from "bun:test";

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
  });
});
