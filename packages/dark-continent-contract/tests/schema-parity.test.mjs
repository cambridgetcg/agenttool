import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  createProjection,
  loadFrameworkSnapshot,
  validateFrameworkSnapshot,
  validateProjection,
} from "../src/index.js";

const frameworkSchema = JSON.parse(
  await readFile(
    new URL("../schema/framework-v0.1.schema.json", import.meta.url),
    "utf8",
  ),
);
const projectionSchema = JSON.parse(
  await readFile(
    new URL("../schema/projection-v0.1.schema.json", import.meta.url),
    "utf8",
  ),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateFrameworkSchema = ajv.compile(frameworkSchema);
const validateProjectionSchema = ajv.compile(projectionSchema);

test("strict schemas compile and accept emitted contracts", () => {
  const snapshot = loadFrameworkSnapshot();
  const projection = createProjection({
    projectionId: "schema-parity",
    consumer: { kind: "artbitrage", id: "artbitrage" },
    artifact: "/data/framework.json",
  });

  assert.equal(validateFrameworkSchema(snapshot), true);
  assert.equal(validateProjectionSchema(projection), true);
  assert.deepEqual(validateFrameworkSnapshot(snapshot), []);
  assert.deepEqual(validateProjection(projection), []);
});

test("schemas and public validators reject the same authority drift", () => {
  const snapshot = loadFrameworkSnapshot();
  snapshot.logos[0].declared_calamity_wall.verified = true;
  snapshot.logos[0].declared_calamity_wall.status = "verified";
  snapshot.extra = "unknown";

  assert.equal(validateFrameworkSchema(snapshot), false);
  assert.notDeepEqual(validateFrameworkSnapshot(snapshot), []);

  const projection = createProjection({
    projectionId: "schema-parity-negative",
    consumer: { kind: "artbitrage", id: "artbitrage" },
    artifact: "/data/framework.json",
  });
  projection.decision.reason_codes.push("trade_authorized");
  projection.authority.authorizes_trade = true;

  assert.equal(validateProjectionSchema(projection), false);
  assert.notDeepEqual(validateProjection(projection), []);
});

test("a newer source profile differs from v0.1 only in its profile pins", async () => {
  const sourceProfilesUrl = new URL("../source-profiles/", import.meta.url);
  const records = (await readdir(sourceProfilesUrl)).filter(
    (name) => name.endsWith(".json") && !name.endsWith(".manifest.json"),
  );
  assert.ok(records.length > 0);

  // The v0.1 schema fixes source_profile and source.version to the packaged
  // 0.17.0 profile. With only those two constants opened, it must accept a
  // newer profile: same shape, same advisory walls, same authority limits.
  const opened = structuredClone(frameworkSchema);
  opened.properties.source_profile = { type: "string" };
  opened.properties.source.properties.version = { type: "string" };
  const validateOpened = new Ajv2020({ allErrors: true, strict: true }).compile(
    opened,
  );

  for (const name of records) {
    const record = JSON.parse(
      await readFile(new URL(name, sourceProfilesUrl), "utf8"),
    );
    assert.equal(validateFrameworkSchema(record), false, name);
    assert.equal(validateOpened(record), true, name);
    assert.deepEqual(
      validateFrameworkSnapshot(record),
      ["unexpected source_profile", "source provenance is incomplete"],
      name,
    );
  }
});
