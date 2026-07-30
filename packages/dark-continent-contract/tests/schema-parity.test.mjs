import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
