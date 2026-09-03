import { readFileSync } from "node:fs";

import {
  OFFICIAL_SUITE_SEMANTIC_SHA256,
  OFFICIAL_VECTOR_CASE_COUNT,
  verifyOfficialVectorSources,
} from "../src/index.js";

const packageRoot = new URL("../", import.meta.url);
const suite = verifyOfficialVectorSources(
  readFileSync(new URL("vectors/economic-kernel-v0.2.json", packageRoot)),
  readFileSync(new URL("vectors/manifest.json", packageRoot)),
);
if (suite.cases.length !== OFFICIAL_VECTOR_CASE_COUNT) {
  throw new Error("official vector case count changed after verification");
}
process.stdout.write(
  `verified ${String(suite.cases.length)} economic conformance vectors; semantics ${OFFICIAL_SUITE_SEMANTIC_SHA256}\n`,
);
