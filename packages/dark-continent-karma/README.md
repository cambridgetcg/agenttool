# `@agenttool/dark-continent-karma`

Public, offline tooling for deterministic `kingdom.kg-proposal/0.1`
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
design pin. The bundled HF export profile describes the metadata-only
catalog release that is now a public Hugging Face dataset and Space (see
[Hugging Face route](#hugging-face-route)).

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

The export profile is available as
`@agenttool/dark-continent-karma/hf-export-profile`. It describes the
metadata-only catalog release built by `hf/scripts/build-release.mjs`: its
dataset files are marked `generated` and `publication.ready` is true, but the
profile embeds no authorization, and every publish needs its own explicit
external approval. It is not an exporter or sanitizer.

Published, as read anonymously from the Hub API on 2026-10-27:

- Dataset [`Yu-and-Ai/kingdom-dark-continent-karma`](https://huggingface.co/datasets/Yu-and-Ai/kingdom-dark-continent-karma)
  at revision `4ea106235b6d7dd53122b3025163a1bb32b02f97`, the revision
  `hf/space/source-manifest.json` pins. Its nine content files match
  `hf/dataset/` byte for byte.
- Space [`Yu-and-Ai/kingdom-dark-continent-karma`](https://huggingface.co/spaces/Yu-and-Ai/kingdom-dark-continent-karma),
  the Cartographer. It is a Gradio 6.21.0 app, not a static viewer: it loads
  two bundled JSONL files, checks their SHA-256 values, offers filters, record
  inspection, and a comparison view, and launches with its MCP server
  disabled. Its eight files match `hf/space/`.
- A second Space, `Yu-and-Ai/kingdom-dark-continent-viewer`, carried older
  boundary wording; it was deleted on 2026-10-27.

Not built: the MCP tools `list_proposals` and `show_provenance` (the Gradio
app's comparison view is a UI handler, not an MCP tool), a standalone
`events.jsonl` with a defined envelope and verifier, and any recorded
independent privacy review. If an MCP Space is separately reviewed and
authorized, the only proposed tools are read operations: `list_proposals`,
`show_provenance`, and `compare_conflicts`. Merge, publish, award, authorize,
and coronate remain forbidden surfaces.

Core proposals accept only single-line classified metadata labels and
content-addressed `sha256:` or commit-pinned `hf://...#sha256=...` evidence
references. They can still describe private/gated repositories and
`local_metadata`; therefore proposal validation is not export approval. The
profile's export gate allows only reviewed public/synthetic metadata, rejects
`local_metadata`, and asks for an independent privacy review; no record of
that review was found on 2026-10-27, although the dataset is public. A digest
is not anonymization or proof of authorship.

The full mechanism and the separate KINGDOM/Artbitrage application route are
documented in [`docs/INTEGRATION.md`](docs/INTEGRATION.md).

## Local verification

The package keeps a `bun.lock`, not an npm lockfile. In an AgentTool checkout,
prepare dependencies with the root `AGENTS.md` preparer; in the public package
repository, run `bun install --frozen-lockfile --ignore-scripts` here. Then:

```sh
bun run ci
bun run check:package
```

`ci` rewrites the committed Hugging Face release tree from source, runs the
Node tests, builds, and smoke-imports under Node; `check:package` dry-runs the
pack.

The developer preview is Apache-2.0 and public; `0.1.0-dev.0` is on npm.
Publication is still a separate, protected repository workflow; importing the
package never uploads, deploys, or authorizes a proposal.
