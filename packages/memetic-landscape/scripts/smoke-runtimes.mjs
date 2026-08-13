import assert from "node:assert/strict";

import {
  createBrainrotTeachingCase,
  encodeMemeticLandscape,
  memeticLandscapeUrn,
  projectMemeticLesson,
} from "../dist/index.js";

const { landscape, shift, analogy, lessons } = createBrainrotTeachingCase();
assert.equal(landscape._format, "agenttool.memetic-landscape/0.1");
assert.equal(landscape.caller_text_semantics_verified, false);
assert.equal(shift.classification, "bounded_reachability_shift_caller_reported");
assert.equal(shift.outcome, "more_observed");
assert.equal(shift.physical_erasure, "not_claimed");
assert.equal(shift.adoption_from_exposure, "not_inferred");
assert.equal(analogy.relationship, "structural_route_shape_only");
assert.equal(analogy.mechanism_transferred, false);
assert.ok(analogy.non_transfer.includes("infectivity"));
assert.equal(lessons.length, 4);
assert.equal(
  projectMemeticLesson(landscape, shift, analogy, { language: "yue-Hant" }).diagnostic_claim,
  false,
);
assert.match(memeticLandscapeUrn(landscape), /^urn:agenttool:memetic-landscape:[0-9a-f]{64}$/u);
assert.ok(encodeMemeticLandscape(landscape).byteLength > 5_000);
