import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CALAMITY_IDS,
  CONTRACT_ID,
  FRAMEWORK_FORMAT,
  LOGOS_IDS,
  PROJECTION_FORMAT,
  createProjection,
  frameworkArtifactDigest,
  loadFrameworkSnapshot,
  validateFrameworkSnapshot,
  validateProjection,
} from "../src/index.js";

test("committed framework is a closed, honest six-calamity snapshot", () => {
  const snapshot = loadFrameworkSnapshot();

  assert.equal(snapshot._format, FRAMEWORK_FORMAT);
  assert.equal(snapshot.contract_id, CONTRACT_ID);
  assert.deepEqual(
    snapshot.calamities.map(({ id }) => id),
    CALAMITY_IDS,
  );
  assert.deepEqual(
    snapshot.logos.map(({ id }) => id),
    LOGOS_IDS,
  );
  assert.deepEqual(validateFrameworkSnapshot(snapshot), []);

  for (const calamity of snapshot.calamities) {
    assert.equal(calamity.declared_wall.status, "not_checked");
    assert.equal(calamity.declared_wall.verified, false);
    assert.deepEqual(calamity.declared_wall.evidence_refs, []);
  }
  for (const logos of snapshot.logos) {
    assert.equal(logos.declared_calamity_wall.status, "not_checked");
    assert.equal(logos.declared_calamity_wall.verified, false);
    assert.deepEqual(logos.declared_calamity_wall.evidence_refs, []);
  }
});

test("consumer projection stays advisory and hash-bound", () => {
  const projection = createProjection({
    projectionId: "artbitrage:agenttool-dark-continent",
    consumer: { kind: "artbitrage", id: "artbitrage" },
    artifact: "/data/agenttool-dark-continent-framework.json",
    interpretations: [
      {
        source_profile: "artbitrage-interpretation-v0",
        relation: "parallel_not_equivalent",
      },
    ],
  });

  assert.equal(projection._format, PROJECTION_FORMAT);
  assert.equal(projection.source_snapshot.sha256, frameworkArtifactDigest());
  assert.equal(projection.checks.length, 6);
  assert.equal(projection.decision.recommendation, "hold");
  assert.equal(projection.decision.advisory, true);
  assert.deepEqual(projection.authority, {
    grants_permission: false,
    authorizes_trade: false,
    authorizes_publication: false,
  });
  assert.deepEqual(validateProjection(projection), []);
});

test("invalid verified claims and taxonomy drift are rejected", () => {
  const snapshot = loadFrameworkSnapshot();
  snapshot.calamities[0].declared_wall.status = "verified";
  snapshot.calamities[0].declared_wall.verified = true;
  snapshot.calamities.push({
    ...snapshot.calamities[0],
    id: "legacy-extra",
  });

  const errors = validateFrameworkSnapshot(snapshot);
  assert.ok(errors.some((error) => error.includes("closed six-item")));
  assert.ok(errors.some((error) => error.includes("overstates its wall")));
});

test("unknown fields and unwrapped Logos wall claims are rejected", () => {
  const snapshot = loadFrameworkSnapshot();
  snapshot.unversioned_claim = true;
  snapshot.logos[0].declared_calamity_wall.verified = true;
  snapshot.logos[0].legacy_wall_claim = "holding";

  const errors = validateFrameworkSnapshot(snapshot);
  assert.ok(errors.some((error) => error.includes("unknown fields")));
  assert.ok(errors.some((error) => error.includes("logos guide")));
  assert.ok(errors.some((error) => error.includes("overstates its wall")));
});

test("validators are total and reject schema-level drift", () => {
  const snapshot = loadFrameworkSnapshot();
  snapshot.source.file = "wrong.ts";
  snapshot.guide.warning = "";
  snapshot.logos[0].operation = "";

  const frameworkErrors = validateFrameworkSnapshot(snapshot);
  assert.ok(
    frameworkErrors.some((error) => error.includes("source provenance")),
  );
  assert.ok(frameworkErrors.some((error) => error.includes("guide")));
  assert.ok(
    frameworkErrors.some((error) => error.includes("blank descriptive")),
  );
  assert.doesNotThrow(() =>
    validateFrameworkSnapshot({
      ...loadFrameworkSnapshot(),
      calamities: {},
      logos: null,
    }),
  );

  const projection = createProjection({
    projectionId: "artbitrage:validator-negative",
    consumer: { kind: "artbitrage", id: "artbitrage" },
    artifact: "/data/framework.json",
  });
  projection.decision.reason_codes.push("trade_authorized");
  assert.ok(
    validateProjection(projection).some((error) =>
      error.includes("advisory hold"),
    ),
  );
  assert.doesNotThrow(() =>
    validateProjection({
      ...projection,
      checks: {},
      interpretations: {},
    }),
  );
});

test("package operations do not use fetch or ambient credentials", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("network forbidden in contract test");
  };
  try {
    createProjection({
      projectionId: "kingdom:agenttool-dark-continent",
      consumer: { kind: "kingdom-extension", id: "KINGDOM-OS" },
      artifact: "@agenttool/dark-continent-contract/framework",
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JSON schemas are closed draft 2020-12 contracts", async () => {
  for (const file of [
    "../schema/framework-v0.1.schema.json",
    "../schema/projection-v0.1.schema.json",
  ]) {
    const schema = JSON.parse(
      await readFile(new URL(file, import.meta.url), "utf8"),
    );
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.equal(schema.additionalProperties, false);
  }
});
