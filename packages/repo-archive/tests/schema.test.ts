import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generateIdentity } from "@agenttool/adds";

import { archiveRepository } from "../src/index.js";
import {
  cleanupTemporaryRoots,
  createArchiveZones,
  createFixtureRepository,
  temporaryRoot,
} from "./helpers.js";

const schemaText = await readFile(
  join(import.meta.dir, "..", "schema", "agent-repo-archive-v0.1.schema.json"),
  "utf8",
);
const schema = JSON.parse(schemaText) as { $id: string };
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

afterEach(cleanupTemporaryRoots);

describe("bundled Agent Repo Archive schema", () => {
  test("strictly validates every emitted signed record kind", async () => {
    const fixture = await createFixtureRepository();
    const root = await temporaryRoot("agent-repo-archive-schema-");
    const archived = await archiveRepository({
      repositoryPath: fixture.root,
      zones: await createArchiveZones(root),
      publisherIdentity: generateIdentity("urn:test:schema-publisher"),
      now: "2026-07-23T12:00:00.000Z",
    });
    const records = [
      archived.snapshot,
      ...archived.placements,
      ...archived.verifications,
      archived.catalog,
    ];
    for (const record of records) {
      expect(validate(record), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...record, private_key: "must-never-cross" })).toBe(false);
    }
    archived.recoveryCapsule.recovery_key.fill(0);
  });

  test("keeps raw secret-bearing fields out of replicated record schemas", () => {
    for (const forbidden of [
      "private_key",
      "secret_key",
      "recovery_key",
      "password",
      "access_token",
      "refresh_token",
      "mnemonic",
    ]) {
      expect(schemaText).not.toContain(`\"${forbidden}\"`);
    }
  });

  test("resolves media profiles and rejects unsafe scalar boundary cases", () => {
    expect(ajv.getSchema(`${schema.$id}#snapshot-payload`)).toBeFunction();
    expect(ajv.getSchema(`${schema.$id}#recovery-catalog`)).toBeFunction();

    const cid = ajv.getSchema(`${schema.$id}#/$defs/cid`)!;
    expect(cid(`b${"a".repeat(58)}`)).toBe(false);

    const uint53 = ajv.getSchema(`${schema.$id}#/$defs/uint53`)!;
    expect(uint53(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(uint53(Number.MAX_SAFE_INTEGER + 1)).toBe(false);

    const repositoryId = ajv.getSchema(`${schema.$id}#/$defs/repositoryId`)!;
    expect(repositoryId("repo:github.com/cambridgetcg/agenttool")).toBe(true);
    for (const unsafe of [
      "/Users/example/private",
      "relative/repository",
      "FILE:/tmp/private",
      "https://user:password@example.test/repository",
      "https://example.test/repository?token=secret",
    ]) {
      expect(repositoryId(unsafe), unsafe).toBe(false);
    }

    const zone = ajv.getSchema(`${schema.$id}#/$defs/zone`)!;
    const descriptor = {
      zone_id: "zone-a",
      transport: "other",
      locator: "adapter:opaque-zone-a",
      assurance: "operator_asserted",
      delete_authority: "unknown",
      failure_domain: {
        failure_domain_id: "domain-a",
        provider: "provider-a",
        account_root: "account-a",
        region: "region-a",
        credential_root: "credential-a",
        media: "media-a",
      },
    };
    expect(zone(descriptor)).toBe(true);
    expect(zone({
      ...descriptor,
      locator: "https://user:password@example.test/a?token=secret",
    })).toBe(false);
  });
});
