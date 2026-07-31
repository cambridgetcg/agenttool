# `@agenttool/dark-continent-karma`

Private, offline tooling for deterministic `kingdom.kg-proposal/0.1`
artifacts. It combines four bounded inputs:

1. AgentTool's exact advisory Dark Continent projection.
2. The KARMA knowledge-graph design, pinned to arXiv `2502.06472v2` and an
   immutable upstream implementation revision.
3. Caller-supplied Hugging Face evidence: immutable commit/file hashes plus a
   declared license and visibility snapshot.
4. A proposed KINGDOM graph delta plus proposal-bound consequence and review
   events appended by the package helper.

KARMA is an `inspired_by` design source here, not a claimed compatible
implementation. The currently observed Hugging Face paper cache is stale v1
metadata with no linked Hub artifacts; arXiv v2 is authoritative for the
design pin. A local-only HF export profile describes a future synthetic
Dataset Card, JSONL proposal/event rows, and read-only static viewer.

The adapter does not use the network, read environment variables or files,
write anything, execute a model, mutate KINGDOM, publish to Hugging Face,
verify a Dark Continent wall, infer identity, or authorize the Crown. It has no
score/rank/XP/trust values or mechanisms, `sameAs`, permission, trade,
publication, or execution path. Zero/false effect and authority fields are
explicit denial boundaries, not participant metrics.

## Example

```js
import {
  appendConsequence,
  appendReview,
  createProposal,
  hfFileEvidenceRef,
  hfSubjectNodeId,
  prettyJsonBytes,
} from "@agenttool/dark-continent-karma";

// Deliberately synthetic: this is not asserted to exist on the Hub.
const hfSubject = {
  repo_id: "example/synthetic-model",
  repo_type: "model",
  revision: "0123456789abcdef0123456789abcdef01234567",
  visibility: "public",
  license: "apache-2.0",
  files: [{ path: "config.json", sha256: "a".repeat(64) }],
};
const subject = { kind: "hf-resource", ...hfSubject };
const subjectId = hfSubjectNodeId(subject);

let proposal = createProposal({
  proposalId: "kingdom:hf:synthetic-model",
  consumer: { kind: "kingdom-extension", id: "hf-kingdom-lab" },
  hfSubject,
  baseGraph: {
    graph_id: "kingdom:graph",
    sha256: "b".repeat(64),
  },
  nodes: [
    {
      operation_id: "op:subject",
      id: subjectId,
      kind: "hf_model",
      label: hfSubject.repo_id,
      label_class: "synthetic_metadata",
      evidence_refs: [hfFileEvidenceRef(subject, hfSubject.files[0])],
    },
  ],
  edges: [],
});

proposal = appendConsequence(proposal, {
  event_id: "event:consequence:1",
  subject_operation_id: "op:subject",
  consequence: "adds_candidate",
  epistemic_status: "declared",
  note_sha256: "c".repeat(64),
  evidence_refs: proposal.graph_delta.nodes[0].evidence_refs,
});

proposal = appendReview(proposal, {
  event_id: "event:review:2",
  subject_operation_id: "op:subject",
  reviewer_ref: "reviewer:declared-local-example",
  lens: "provenance",
  verdict: "deferred",
  note_sha256: "d".repeat(64),
  evidence_refs: proposal.graph_delta.nodes[0].evidence_refs,
});

console.log(prettyJsonBytes(proposal));
```

Review records describe review; they do not make a claim true or grant
authority. Only the note digest is stored, so the proposal does not quietly
collect raw review prose. A new record extends one event hash chain; existing
records are never rewritten by the append helpers. This provides deterministic
tamper evidence only when an earlier chain head is retained elsewhere. The
chain is unsigned, can be fully rebuilt by an artifact controller, and does not
provide Crown-style authorship, persistent immutability, or authenticity.

## Hugging Face route

The planning profile is available as
`@agenttool/dark-continent-karma/hf-export-profile`. It specifies local files
for future proposals, events, a Dataset Card, and a hash manifest. It is not an
exporter or sanitizer: those files remain marked `planned`, and its publication
state is deliberately false.

Core proposals accept only single-line classified metadata labels and
content-addressed `sha256:` or commit-pinned `hf://...#sha256=...` evidence
references. They can still describe private/gated repositories and
`local_metadata`; therefore proposal validation is not export approval. A
future export gate must allow only reviewed public/synthetic metadata, reject
`local_metadata`, and receive an independent privacy review. A digest is not
anonymization or proof of authorship.

A future Space should begin as a static, read-only conflict/provenance viewer.
If an MCP Space is separately reviewed and authorized, the only proposed tools
are read operations: `list_proposals`, `show_provenance`, and
`compare_conflicts`. Merge, publish, award, authorize, and coronate remain
forbidden surfaces.

The full mechanism and the separate KINGDOM/Artbitrage application route are
documented in [`docs/INTEGRATION.md`](docs/INTEGRATION.md).

## Local verification

```sh
npm ci --ignore-scripts
node --test tests/*.test.mjs
npm pack --dry-run --ignore-scripts
```

The package remains private and `UNLICENSED`; publication requires a separate
license decision and explicit authorization.
