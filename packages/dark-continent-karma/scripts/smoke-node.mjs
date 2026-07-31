import {
  DARK_CONTINENT_SOURCE_PROFILE,
  PROPOSAL_FORMAT,
  createProposal,
  hfFileEvidenceRef,
  hfSubjectNodeId,
  validateProposal,
} from "../dist/index.js";

if (PROPOSAL_FORMAT !== "kingdom.kg-proposal/0.1") {
  throw new Error("proposal format changed");
}
if (DARK_CONTINENT_SOURCE_PROFILE !== "agenttool-sdk-ts-0.17.0") {
  throw new Error("Dark Continent source profile changed");
}

const hfSubject = {
  repo_id: "example/synthetic-dataset",
  repo_type: "dataset",
  revision: "0".repeat(40),
  visibility: "public",
  license: "apache-2.0",
  files: [{ path: "README.md", sha256: "a".repeat(64) }],
};
const normalizedSubject = { kind: "hf-resource", ...hfSubject };
const subjectId = hfSubjectNodeId(normalizedSubject);
const proposal = createProposal({
  proposalId: "smoke:hf-dataset",
  consumer: { kind: "kingdom-extension", id: "KINGDOM" },
  hfSubject,
  baseGraph: { graph_id: "kingdom:smoke", sha256: "b".repeat(64) },
  nodes: [{
    operation_id: "op:subject",
    id: subjectId,
    kind: "hf_dataset",
    label: hfSubject.repo_id,
    label_class: "synthetic_metadata",
    evidence_refs: [hfFileEvidenceRef(normalizedSubject, hfSubject.files[0])],
  }],
  edges: [],
});
if (validateProposal(proposal).length !== 0) {
  throw new Error("built proposal failed validation");
}
if (proposal.state !== "proposed" || proposal.authority.authorizes_crown) {
  throw new Error("proposal-only authority boundary changed");
}

process.stdout.write("node smoke: Dark Continent KARMA adapter loads from dist\n");
