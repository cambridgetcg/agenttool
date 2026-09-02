import { readFileSync } from "node:fs";

import {
  ConformanceFormatError,
  OFFICIAL_SUITE_SEMANTIC_SHA256,
  evaluateConformance,
  verifyOfficialVectorSources,
} from "../dist/index.js";

const packageRoot = new URL("../", import.meta.url);
const suite = verifyOfficialVectorSources(
  readFileSync(new URL("vectors/economic-kernel-v0.1.json", packageRoot)),
  readFileSync(new URL("vectors/manifest.json", packageRoot)),
);
if (suite.cases.length !== 34) throw new Error("official vector count mismatch");

const report = evaluateConformance(suite, {
  schema: "agenttool.economic-conformance-trace/1",
  suite_id: suite.suite_id,
  suite_revision: suite.suite_revision,
  producer_declared_ref: "adapter:node-smoke",
  entries: [{ case_id: suite.cases[0].case_id, observed: suite.cases[0].expected }],
});
if (report.status !== "INCONCLUSIVE" || report.counts.pass !== 1 || report.counts.inconclusive !== 33) {
  throw new Error("closed status semantics failed");
}
if (report.suite_semantic_sha256 !== OFFICIAL_SUITE_SEMANTIC_SHA256) {
  throw new Error("semantic suite pin mismatch");
}
if (!/^sha256:[0-9a-f]{64}$/u.test(report.trace_semantic_sha256)) {
  throw new Error("semantic trace binding is missing");
}
if (
  report.boundaries.producer_authenticated !== false
  || report.boundaries.future_behavior_proven !== false
  || report.boundaries.comparator_network_requests !== 0
) {
  throw new Error("report boundary mismatch");
}
if (Object.hasOwn(report.cases[0], "expected") || Object.hasOwn(report.cases[0], "observed")) {
  throw new Error("report exposed raw observations");
}

try {
  evaluateConformance(suite, {
    schema: "agenttool.economic-conformance-trace/1",
    suite_id: suite.suite_id,
    suite_revision: suite.suite_revision,
    producer_declared_ref: "unsafe producer ref",
    entries: [],
  });
  throw new Error("unsafe producer reference was accepted");
} catch (error) {
  if (!(error instanceof ConformanceFormatError)) throw error;
}
