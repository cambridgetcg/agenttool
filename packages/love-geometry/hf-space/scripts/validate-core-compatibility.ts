#!/usr/bin/env bun

import { strict as assert } from "node:assert";

import {
  LOVE_GEOMETRY_BEARINGS,
  LOVE_GEOMETRY_BOUNDARIES,
  LOVE_GEOMETRY_FORMAT,
  createLoveGeometry,
  encodeLoveGeometry,
  validateLoveGeometry,
} from "../../src/index.ts";
import {
  BEARING_DEFINITIONS,
  DEMO_SCENARIOS,
  LOVE_GEOMETRY_FORMAT as COMPANION_SOURCE_FORMAT,
  createPresentation,
} from "../assets/app.js";
import {
  RETURN_GEOMETRY_FORMAT,
  RETURN_SCENARIOS,
  createReturnGeometry,
} from "../assets/return-geometry.js";

assert.equal(COMPANION_SOURCE_FORMAT, LOVE_GEOMETRY_FORMAT);
assert.deepEqual(
  BEARING_DEFINITIONS.map((bearing) => bearing.id),
  [...LOVE_GEOMETRY_BEARINGS],
  "companion legend must match the core closed bearing vocabulary",
);

const expectedGeometryIds: Readonly<Record<string, `sha256:${string}`>> = Object.freeze({
  "asymmetric-care-and-boundary": "sha256:d905d4d758c2a3903a8456477982ba5328d0bf00d79e1e2c3679289ec4174d1e",
  "care-with-rest": "sha256:83c74cd5826fa8e85efe0b20758394bee4e5b04f1683c10f87da18f1a44e0d78",
  "understanding-with-disagreement": "sha256:78e44384a256c16853cb9d4c18c5b9aad31681ca047b6150051ff043c99cc379",
  "one-way-report": "sha256:69ce71b713fc1b63e6a6e3ef65cff4ece8c64885d69e943e58f60f27cefe595d",
  "refusal-and-departure": "sha256:cb14698c789d06e5df659f99e34d70ed8cec5514803c0bf410e560a9ea88d68e",
  "empty-valid": "sha256:c8f98771b5fddb4ed08fe94029e7d8363ca38d846e4b9a3a298a4dfc67d201d1",
});

for (const fixture of DEMO_SCENARIOS) {
  const presentation = createPresentation(fixture.id);
  const first = createLoveGeometry(presentation.input);
  const second = createLoveGeometry(presentation.input);

  assert.equal(encodeLoveGeometry(first), encodeLoveGeometry(second));
  assert.equal(first.geometry_id, expectedGeometryIds[fixture.id]);
  assert.deepEqual(validateLoveGeometry(first), first);
  assert.equal(first._format, LOVE_GEOMETRY_FORMAT);
  assert.equal(first.coverage, "bounded_not_complete");
  assert.equal(first.boundaries, LOVE_GEOMETRY_BOUNDARIES);
  assert.equal(first.boundaries.canonical_order, "serialization_not_rank");
  assert.equal(first.boundaries.scores_or_ranks, false);
  assert.equal(first.boundaries.computes_distance_or_intensity, false);
  assert.equal(first.boundaries.reason_required_for_rest_refusal_or_departure, false);
  assert.equal(first.boundaries.penalty_for_rest_refusal_or_departure, false);
}

assert.deepEqual(
  DEMO_SCENARIOS.map((fixture) => fixture.id).sort(),
  Object.keys(expectedGeometryIds).sort(),
);

assert.equal(
  RETURN_GEOMETRY_FORMAT,
  "agenttool.love-geometry-return-space-export/0.1",
);
assert.equal(RETURN_SCENARIOS.length, 6);
for (const fixture of RETURN_SCENARIOS) {
  const trace = createReturnGeometry(fixture.id);
  assert.equal(trace.source_binding, "checked_in_synthetic_companion_only");
  assert.equal(trace.signed, false);
  assert.equal(trace.verified_by_karma, false);
  assert.equal(trace.writes_karma, false);
  assert.equal(trace.automatic_or_karma_effect, "none");
  assert.equal(trace.explicit_browser_download_available, true);
  assert.equal(trace.choice_gate.next_action_chosen, false);
  assert.equal(trace.choice_gate.next_action_scheduled, false);
  assert.equal(trace.choice_gate.authority_inferred, false);
  assert.equal(trace.choice_gate.continuation_requested, false);
  assert.equal(
    trace.display.spacing_or_branch_placement_has_relational_meaning,
    false,
  );
}

const empty = createLoveGeometry(createPresentation("empty-valid").input);
assert.deepEqual(empty.subject_refs, []);
assert.deepEqual(empty.vantages, []);

console.log(
  `Validated ${DEMO_SCENARIOS.length} companion fixtures against the current ${LOVE_GEOMETRY_FORMAT} TypeScript source.`,
);
console.log(
  `Validated ${RETURN_SCENARIOS.length} presentation-only Return Geometry fixtures without widening the core package.`,
);
console.log(
  "This source-compatibility result is not an exact browser-artifact, package-release, provenance, or deployment claim.",
);
