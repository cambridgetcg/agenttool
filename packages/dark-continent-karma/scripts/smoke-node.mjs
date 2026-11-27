import {
  DARK_CONTINENT_SOURCE_PROFILE,
  EVENT_ENVELOPE_FORMAT,
  PROPOSAL_FORMAT,
  appendConsequence,
  createCartographerCatalog,
  createProposal,
  extractProposalEvents,
  formatEventJsonl,
  hfFileEvidenceRef,
  hfSubjectNodeId,
  validateProposal,
  verifyEventJsonl,
} from "../dist/index.js";

if (PROPOSAL_FORMAT !== "kingdom.kg-proposal/0.1") {
  throw new Error("proposal format changed");
}
if (EVENT_ENVELOPE_FORMAT !== "kingdom.kg-proposal-event-envelope/0.1") {
  throw new Error("event envelope format changed");
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

const withEvent = appendConsequence(proposal, {
  event_id: "smoke:event:1",
  subject_operation_id: "op:subject",
  consequence: "adds_candidate",
  epistemic_status: "declared",
  note_sha256: "c".repeat(64),
  evidence_refs: proposal.graph_delta.nodes[0].evidence_refs,
});
const envelopes = extractProposalEvents([withEvent]);
const jsonl = formatEventJsonl(envelopes);
const verified = verifyEventJsonl(jsonl, { proposals: [withEvent] });
if (!verified.ok || verified.event_count !== 1) {
  throw new Error(`events.jsonl smoke verification failed: ${verified.errors.join("; ")}`);
}

const catalog = createCartographerCatalog([withEvent]);
const listed = catalog.listProposals();
if (listed.matched_count !== 1) {
  throw new Error("Cartographer smoke list failed");
}
const refused = catalog.invokeTool("MERGE");
if (refused.ok || refused.error.code !== "forbidden_cartographer_surface") {
  throw new Error("Cartographer failed to refuse forbidden surface");
}

process.stdout.write("node smoke: Dark Continent KARMA adapter loads from dist\n");
