import {
  ALCHEMY_NETWORKS,
  EVM_EVIDENCE_NON_GRANTS,
  EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT,
  EVM_MEASUREMENT_PROJECTION_FORMAT,
  EVM_OBSERVATION_EVIDENCE_FORMAT,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  TRANSPORT_PROTOCOL,
  canonicalEvmEvidenceTransitionReceiptBytes,
  canonicalEvmObservationEvidenceBytes,
  compareEvmFinality,
  createAlchemyReadClient,
  createEvmEvidenceTransitionReceipt,
  createEvmObservationEvidence,
  parseEvmEvidenceTransitionReceipt,
  parseEvmObservationEvidence,
  projectEvmEvidenceMeasurement,
} from "../dist/index.js";

if (PACKAGE_NAME !== "@agenttool/alchemy") {
  throw new Error("package name changed");
}
if (PACKAGE_VERSION !== "0.1.0-dev.1") {
  throw new Error("package version changed");
}
if (TRANSPORT_PROTOCOL !== "agenttool.alchemy.transport/0.1") {
  throw new Error("transport protocol changed");
}
if (Object.keys(ALCHEMY_NETWORKS).length !== 10) {
  throw new Error("fixed network table changed");
}
if (typeof createAlchemyReadClient !== "function") {
  throw new Error("read client export is unavailable");
}
if (
  typeof EVM_OBSERVATION_EVIDENCE_FORMAT !== "string" ||
  typeof EVM_EVIDENCE_TRANSITION_RECEIPT_FORMAT !== "string" ||
  typeof EVM_MEASUREMENT_PROJECTION_FORMAT !== "string" ||
  typeof EVM_EVIDENCE_NON_GRANTS !== "object" ||
  EVM_EVIDENCE_NON_GRANTS === null
) {
  throw new Error("evidence protocol metadata is unavailable");
}
for (const evidenceFunction of [
  createEvmObservationEvidence,
  parseEvmObservationEvidence,
  canonicalEvmObservationEvidenceBytes,
  compareEvmFinality,
  createEvmEvidenceTransitionReceipt,
  parseEvmEvidenceTransitionReceipt,
  canonicalEvmEvidenceTransitionReceiptBytes,
  projectEvmEvidenceMeasurement,
]) {
  if (typeof evidenceFunction !== "function") {
    throw new Error("evidence protocol export is unavailable");
  }
}

process.stdout.write("node smoke: bounded Alchemy read and evidence exports load\n");
