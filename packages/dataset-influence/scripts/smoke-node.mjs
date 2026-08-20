import { readFileSync } from "node:fs";

import {
  PACKAGE_VERSION,
  validateDatasetInfluenceStudy,
  validateDatasetLineage,
  validateIdentityEvidenceView,
  validateShadowAttribution,
} from "../dist/index.js";

const vectors = JSON.parse(readFileSync(new URL(
  "../vectors/agenttool-dataset-influence-v0.1.json",
  import.meta.url,
), "utf8"));

if (PACKAGE_VERSION !== "0.1.0-dev.0") throw new Error("unexpected package version");
validateDatasetLineage(vectors.cases.exact_lineage.artifact);
validateDatasetInfluenceStudy(vectors.cases.randomized_study.artifact);
validateIdentityEvidenceView(vectors.cases.revisable_identity_evidence.artifact);
const shadow = validateShadowAttribution(vectors.cases.exact_shadow_attribution.artifact);
if (shadow.economic_effect !== "none" || shadow.authorizes_payment !== false) {
  throw new Error("shadow attribution crossed the economic boundary");
}
