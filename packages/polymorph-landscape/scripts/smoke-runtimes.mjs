import assert from "node:assert/strict";

import {
  createRitonavirCase,
  encodePolymorphLandscape,
  polymorphLandscapeUrn,
  projectPolymorphLesson,
} from "../dist/index.js";

const { landscape, shift, lessons } = createRitonavirCase();
assert.equal(landscape._format, "agenttool.polymorph-landscape/0.1");
assert.equal(shift.classification, "not_reproduced_in_named_condition_reported");
assert.equal(shift.physical_erasure, "not_claimed");
assert.equal(lessons.length, 4);
assert.equal(projectPolymorphLesson(landscape, shift, { language: "yue-Hant" }).medical_advice, false);
assert.match(polymorphLandscapeUrn(landscape), /^urn:agenttool:polymorph-landscape:[0-9a-f]{64}$/u);
assert.ok(encodePolymorphLandscape(landscape).byteLength > 1_000);
