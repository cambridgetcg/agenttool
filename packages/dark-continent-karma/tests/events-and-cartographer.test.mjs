import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CARTOGRAPHER_TOOLS,
  DARK_CONTINENT_SNAPSHOT_SHA256,
  EVENT_ENVELOPE_FORMAT,
  EVENT_ENVELOPE_HASH_DOMAIN,
  EVENT_HASH_DOMAIN,
  FORBIDDEN_CARTOGRAPHER_SURFACES,
  appendConsequence,
  appendReview,
  createCartographerCatalog,
  createProposal,
  extractProposalEvents,
  formatEventJsonl,
  hfFileEvidenceRef,
  hfSubjectNodeId,
  prettyJsonBytes,
  sha256,
  validateEventEnvelope,
  verifyEventJsonl,
} from "../src/index.js";

const FORBIDDEN_KEYS = new Set([
  "score",
  "points",
  "xp",
  "rank",
  "leaderboard",
  "trust_score",
  "karma_score",
  "sameAs",
  "same_as",
  "agent_votes",
]);

function assertNoForbiddenKeys(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(FORBIDDEN_KEYS.has(key), false, `found forbidden key ${path}.${key}`);
    assertNoForbiddenKeys(nested, `${path}.${key}`);
  }
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeProposal(overrides = {}) {
  const hfSubject = {
    repo_id: "example/synthetic-model",
    repo_type: "model",
    revision: "0".repeat(40),
    visibility: "public",
    license: "apache-2.0",
    files: [
      { path: "config.json", sha256: "a".repeat(64) },
      { path: "tokenizer.json", sha256: "b".repeat(64) },
    ],
    ...(overrides.hfSubject ?? {}),
  };
  const normalizedSubject = { kind: "hf-resource", ...hfSubject };
  const subjectId = hfSubjectNodeId(normalizedSubject);
  const subjectRefs = hfSubject.files.map((file) =>
    hfFileEvidenceRef(normalizedSubject, file),
  );
  return createProposal({
    proposalId: overrides.proposalId ?? "proposal:synthetic:alpha",
    consumer: overrides.consumer ?? { kind: "kingdom-extension", id: "hf-kingdom-lab" },
    hfSubject,
    baseGraph: overrides.baseGraph ?? {
      graph_id: "kingdom:graph",
      sha256: "c".repeat(64),
    },
    nodes: overrides.nodes ?? [
      {
        operation_id: "op:framework",
        id: "framework:agenttool.dark-continent/0.1",
        kind: "framework",
        label: overrides.frameworkLabel ?? "Dark Continent contract",
        label_class: "synthetic_metadata",
        evidence_refs: [`sha256:${DARK_CONTINENT_SNAPSHOT_SHA256}`],
      },
      {
        operation_id: "op:subject",
        id: subjectId,
        kind: hfSubject.repo_type === "dataset"
          ? "hf_dataset"
          : hfSubject.repo_type === "space"
            ? "hf_space"
            : "hf_model",
        label: hfSubject.repo_id,
        label_class: hfSubject.visibility === "public"
          ? "synthetic_metadata"
          : "local_metadata",
        evidence_refs: subjectRefs,
      },
    ],
    edges: overrides.edges ?? [
      {
        operation_id: "op:edge:review-lens",
        from: subjectId,
        to: "framework:agenttool.dark-continent/0.1",
        relation: overrides.edgeRelation ?? "evaluated_by",
        evidence_refs: [`sha256:${DARK_CONTINENT_SNAPSHOT_SHA256}`],
      },
    ],
  });
}

function addTwoEvents(proposal, suffix = "1") {
  const ref = proposal.graph_delta.nodes.find((n) => n.operation_id === "op:subject").evidence_refs[0];
  let next = appendConsequence(proposal, {
    event_id: `event:consequence:${suffix}:0`,
    subject_operation_id: "op:subject",
    consequence: "adds_candidate",
    epistemic_status: "declared",
    note_sha256: "d".repeat(64),
    evidence_refs: [ref],
  });
  next = appendReview(next, {
    event_id: `event:review:${suffix}:1`,
    subject_operation_id: "op:subject",
    reviewer_ref: "reviewer:declared-local-fixture",
    lens: "provenance",
    verdict: "deferred",
    note_sha256: "e".repeat(64),
    evidence_refs: [ref],
  });
  return next;
}

function recomputeEnvelopeHashes(envelope) {
  const copy = mutable(envelope);
  const { event_sha256: _eventSha, ...eventPayload } = copy.event;
  copy.event.event_sha256 = sha256(`${EVENT_HASH_DOMAIN}\n${prettyJsonBytes(eventPayload)}`);
  const { envelope_sha256: _envSha, ...envPayload } = copy;
  copy.envelope_sha256 = sha256(`${EVENT_ENVELOPE_HASH_DOMAIN}\n${prettyJsonBytes(envPayload)}`);
  return copy;
}

describe("standalone events.jsonl schema, envelope, and verifier", () => {
  test("event envelope schema validates extracted envelopes and enforces sequence/previous-hash rules", async () => {
    const schema = JSON.parse(await readFile(
      new URL("../schema/kingdom-kg-proposal-event-envelope-v0.1.schema.json", import.meta.url),
      "utf8",
    ));
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    ));
    assert.equal(
      packageJson.exports["./event-envelope-schema"],
      "./schema/kingdom-kg-proposal-event-envelope-v0.1.schema.json",
    );
    assert.equal(schema.properties._format.const, EVENT_ENVELOPE_FORMAT);
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.description.includes("verifyEventJsonl is authoritative"));

    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const proposal = addTwoEvents(makeProposal());
    const envelopes = extractProposalEvents([proposal]);
    assert.equal(envelopes.length, 2);
    for (const envelope of envelopes) {
      assert.equal(validate(envelope), true, JSON.stringify(validate.errors));
      assert.deepEqual(validateEventEnvelope(envelope), []);
      assert.ok(Object.isFrozen(envelope));
    }

    // sequence 0 with non-null previous_event_sha256 must be rejected by schema if/then
    const badSeq0 = mutable(envelopes[0]);
    badSeq0.event.previous_event_sha256 = "f".repeat(64);
    assert.equal(validate(badSeq0), false, "schema accepted sequence 0 with non-null previous hash");

    // sequence 1 with null previous_event_sha256 must be rejected by schema else
    const badSeq1 = mutable(envelopes[1]);
    badSeq1.event.previous_event_sha256 = null;
    assert.equal(validate(badSeq1), false, "schema accepted sequence 1 with null previous hash");

    // authority escalation must be rejected
    const escalated = mutable(envelopes[0]);
    escalated.authority.authorizes_crown = true;
    assert.equal(validate(escalated), false, "schema accepted escalated envelope authority");
  });

  test("extracts, formats, and verifies canonical events.jsonl across proposals and HF release fixtures", async () => {
    const alpha = addTwoEvents(makeProposal({ proposalId: "proposal:z" }), "z");
    const beta = addTwoEvents(makeProposal({
      proposalId: "proposal:a",
      hfSubject: { repo_id: "example/synthetic-beta", revision: "1".repeat(40) },
    }), "a");
    const empty = makeProposal({
      proposalId: "proposal:empty",
      hfSubject: { repo_id: "example/synthetic-empty", revision: "2".repeat(40) },
    });

    const jsonl = formatEventJsonl([alpha, beta, empty]);
    const verified = verifyEventJsonl(jsonl, {
      proposals: [alpha, beta, empty],
      expectedHeads: {
        [alpha.proposal_id]: alpha.events.at(-1).event_sha256,
        [beta.proposal_id]: beta.events.at(-1).event_sha256,
        [empty.proposal_id]: null,
      },
    });
    assert.equal(verified.ok, true, JSON.stringify(verified.errors));
    assert.equal(verified.event_count, 4);
    assert.equal(verified.proposal_count, 3);
    assert.deepEqual(
      verified.proposals.map((entry) => entry.proposal_id),
      ["proposal:a", "proposal:empty", "proposal:z"],
    );
    assert.ok(verified.proposals.every((entry) => entry.matches_proposal_head === true));
    assert.ok(Object.isFrozen(verified));
    assertNoForbiddenKeys(verified);

    // Interleaved multi-proposal stream is valid when per-proposal chains are contiguous
    const envelopes = extractProposalEvents([beta, alpha]);
    const interleaved = formatEventJsonl([
      envelopes[0],
      envelopes[2],
      envelopes[1],
      envelopes[3],
    ]);
    const interleavedResult = verifyEventJsonl(interleaved, { proposals: [alpha, beta] });
    assert.equal(interleavedResult.ok, true, JSON.stringify(interleavedResult.errors));

    // Empty log verifies cleanly for zero-event proposals
    const emptyLog = formatEventJsonl([empty]);
    assert.equal(emptyLog, "");
    const emptyVerified = verifyEventJsonl(emptyLog, { proposals: [empty] });
    assert.equal(emptyVerified.ok, true);
    assert.equal(emptyVerified.event_count, 0);
    assert.equal(emptyVerified.proposals[0].matches_proposal_head, true);

    // Verify against the committed 18-proposal HF release fixture
    const hfLines = (await readFile(
      new URL("../hf/dataset/artifacts/proposals.jsonl", import.meta.url),
      "utf8",
    ))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    const hfJsonl = formatEventJsonl(hfLines);
    const hfVerified = verifyEventJsonl(hfJsonl, { proposals: hfLines });
    assert.equal(hfVerified.ok, true, JSON.stringify(hfVerified.errors));
    assert.equal(hfVerified.proposal_count, 18);
    assert.equal(hfVerified.event_count, 18);
  });

  test("rejects forked, truncated, extended, and last-event-edited chains when verified against proposals", () => {
    const base = makeProposal();
    const ref = base.graph_delta.nodes.find((n) => n.operation_id === "op:subject").evidence_refs[0];
    const oneEvent = appendConsequence(base, {
      event_id: "event:c0",
      subject_operation_id: "op:subject",
      consequence: "adds_candidate",
      epistemic_status: "declared",
      note_sha256: "d".repeat(64),
      evidence_refs: [ref],
    });
    const branchA = appendReview(oneEvent, {
      event_id: "event:r1:a",
      subject_operation_id: "op:subject",
      reviewer_ref: "reviewer:alice",
      lens: "provenance",
      verdict: "pass",
      note_sha256: "e".repeat(64),
      evidence_refs: [ref],
    });
    const branchB = appendReview(oneEvent, {
      event_id: "event:r1:b",
      subject_operation_id: "op:subject",
      reviewer_ref: "reviewer:bob",
      lens: "provenance",
      verdict: "block",
      note_sha256: "f".repeat(64),
      evidence_refs: [ref],
    });
    const editedLast = appendReview(oneEvent, {
      event_id: "event:r1:a",
      subject_operation_id: "op:subject",
      reviewer_ref: "reviewer:alice",
      lens: "provenance",
      verdict: "concern",
      note_sha256: "e".repeat(64),
      evidence_refs: [ref],
    });

    // 1. Forked chain (same proposal_binding_sha256, different seq 1 event)
    const forkedResult = verifyEventJsonl(formatEventJsonl([branchB]), {
      proposals: [branchA],
    });
    assert.equal(forkedResult.ok, false);
    assert.ok(forkedResult.errors.some((e) => e.includes("diverges from proposal.events at sequence 1")));

    // 2. Truncated chain (proposal has 2 events, log has 1 event or 0 events)
    const truncatedOne = verifyEventJsonl(formatEventJsonl([oneEvent]), {
      proposals: [branchA],
    });
    assert.equal(truncatedOne.ok, false);
    assert.ok(truncatedOne.errors.some((e) => e.includes("truncated relative to proposal.events")));

    const truncatedEmpty = verifyEventJsonl("", { proposals: [branchA] });
    assert.equal(truncatedEmpty.ok, false);
    assert.ok(truncatedEmpty.errors.some((e) => e.includes("truncated relative to proposal.events")));

    // 3. Extended chain rejected by default; permitted only with explicit allowExtensions: true
    const extendedDefault = verifyEventJsonl(formatEventJsonl([branchA]), {
      proposals: [oneEvent],
    });
    assert.equal(extendedDefault.ok, false);
    assert.ok(extendedDefault.errors.some((e) => e.includes("extends beyond proposal.events")));

    const extendedAllowed = verifyEventJsonl(formatEventJsonl([branchA]), {
      proposals: [oneEvent],
      allowExtensions: true,
    });
    assert.equal(extendedAllowed.ok, true, JSON.stringify(extendedAllowed.errors));
    assert.equal(extendedAllowed.proposals[0].matches_proposal_head, false);
    assert.equal(extendedAllowed.proposals[0].proposal_event_count, 1);
    assert.equal(extendedAllowed.proposals[0].event_count, 2);
    assert.equal(extendedAllowed.proposals[0].proposal_head_sha256, oneEvent.events[0].event_sha256);
    assert.equal(extendedAllowed.proposals[0].log_head_sha256, branchA.events[1].event_sha256);

    // 4. Edited last event (same event_id, recomputed valid hashes, different verdict)
    const editedResult = verifyEventJsonl(formatEventJsonl([editedLast]), {
      proposals: [branchA],
    });
    assert.equal(editedResult.ok, false);
    assert.ok(editedResult.errors.some((e) => e.includes("diverges from proposal.events at sequence 1")));

    // 5. Forked prefix even with allowExtensions: true must fail
    const forkedExtended = verifyEventJsonl(formatEventJsonl([branchB]), {
      proposals: [branchA],
      allowExtensions: true,
    });
    assert.equal(forkedExtended.ok, false);

    // 6. Unknown proposal_id in log when proposals list is provided
    const stranger = addTwoEvents(makeProposal({
      proposalId: "proposal:stranger",
      hfSubject: { repo_id: "example/stranger", revision: "9".repeat(40) },
    }), "stranger");
    const unknownProposalResult = verifyEventJsonl(formatEventJsonl([stranger]), {
      proposals: [branchA],
    });
    assert.equal(unknownProposalResult.ok, false);
    assert.ok(unknownProposalResult.errors.some((e) => e.includes("not present in supplied proposals")));

    // 7. Mismatched expectedHeads fails
    const badHeadResult = verifyEventJsonl(formatEventJsonl([branchA]), {
      expectedHeads: { [branchA.proposal_id]: "0".repeat(64) },
    });
    assert.equal(badHeadResult.ok, false);
    assert.ok(badHeadResult.errors.some((e) => e.includes("expected head")));
  });

  test("rejects duplicate JSON keys, non-canonical serialization, and line framing anomalies", () => {
    const proposal = addTwoEvents(makeProposal());
    const validLine = formatEventJsonl([proposal]).split("\n")[0];

    // Duplicate consequence key ("rejected" shadowed by "adds_candidate")
    const dupConsequence = validLine.replace(
      '"consequence":"adds_candidate"',
      '"consequence":"rejected","consequence":"adds_candidate"',
    );
    assert.notEqual(dupConsequence, validLine);
    const dupConsequenceResult = verifyEventJsonl(`${dupConsequence}\n`);
    assert.equal(dupConsequenceResult.ok, false);
    assert.ok(dupConsequenceResult.errors.some((e) => e.includes("not canonical compact JSON")));

    // Duplicate proposal_id key (even with identical value)
    const dupProposalId = validLine.replace(
      `"proposal_id":"${proposal.proposal_id}"`,
      `"proposal_id":"${proposal.proposal_id}","proposal_id":"${proposal.proposal_id}"`,
    );
    assert.equal(verifyEventJsonl(`${dupProposalId}\n`).ok, false);

    // Reordered keys (valid JSON, identical parsed object, wrong key order)
    const parsed = JSON.parse(validLine);
    const reordered = JSON.stringify({
      proposal_id: parsed.proposal_id,
      _format: parsed._format,
      authority: parsed.authority,
      effects: parsed.effects,
      envelope_sha256: parsed.envelope_sha256,
      event: parsed.event,
      proposal_binding_sha256: parsed.proposal_binding_sha256,
    });
    assert.equal(verifyEventJsonl(`${reordered}\n`).ok, false);

    // Whitespace padding / pretty-printed line
    assert.equal(verifyEventJsonl(` ${validLine}\n`).ok, false);
    assert.equal(verifyEventJsonl(`${validLine} \n`).ok, false);
    assert.equal(verifyEventJsonl(`${validLine.replace(":", ": ")}\n`).ok, false);

    // Non-canonical numeric literals (0.0e0 and -0)
    const expZero = validLine.replace('"sequence":0', '"sequence":0.0e0');
    assert.equal(verifyEventJsonl(`${expZero}\n`).ok, false);
    const negZero = validLine.replace('"sequence":0', '"sequence":-0');
    assert.equal(verifyEventJsonl(`${negZero}\n`).ok, false);

    // Non-canonical Unicode string escape
    const unicodeEscaped = validLine.replace('"adds_candidate"', '"\\u0061dds_candidate"');
    assert.equal(verifyEventJsonl(`${unicodeEscaped}\n`).ok, false);

    // Framing errors: missing trailing LF, CRLF, blank line
    assert.equal(verifyEventJsonl(validLine).ok, false);
    assert.equal(verifyEventJsonl(`${validLine}\r\n`).ok, false);
    assert.equal(verifyEventJsonl(`${validLine}\n\n`).ok, false);
  });

  test("rejects swaps, drops, replays, renumbering, cross-proposal moves, bad refs, and malformed envelopes", () => {
    const proposal = addTwoEvents(makeProposal());
    const [env0, env1] = extractProposalEvents([proposal]);
    const line0 = JSON.stringify(env0);
    const line1 = JSON.stringify(env1);

    // Swapped lines
    assert.equal(verifyEventJsonl(`${line1}\n${line0}\n`).ok, false);

    // Dropped event 0 (starts at seq 1)
    assert.equal(verifyEventJsonl(`${line1}\n`).ok, false);

    // Replayed line 0
    assert.equal(verifyEventJsonl(`${line0}\n${line0}\n`).ok, false);

    // Renumbered sequence on env1 without valid chain
    const renumbered = mutable(env1);
    renumbered.event.sequence = 0;
    renumbered.event.previous_event_sha256 = null;
    const renumberedLine = JSON.stringify(recomputeEnvelopeHashes(renumbered));
    assert.equal(
      verifyEventJsonl(`${renumberedLine}\n`, { proposals: [proposal] }).ok,
      false,
    );

    // Cross-proposal move: envelope proposal_id swapped without matching proposal binding
    const other = makeProposal({
      proposalId: "proposal:other",
      hfSubject: { repo_id: "example/other", revision: "3".repeat(40) },
    });
    const moved = mutable(env0);
    moved.proposal_id = other.proposal_id;
    const movedRehashed = recomputeEnvelopeHashes(moved);
    assert.equal(
      verifyEventJsonl(`${JSON.stringify(movedRehashed)}\n`, { proposals: [other] }).ok,
      false,
    );

    // Envelope vs event proposal_binding_sha256 mismatch
    const splitBinding = mutable(env0);
    splitBinding.proposal_binding_sha256 = "9".repeat(64);
    const { envelope_sha256: _old, ...splitPayload } = splitBinding;
    splitBinding.envelope_sha256 = sha256(
      `${EVENT_ENVELOPE_HASH_DOMAIN}\n${prettyJsonBytes(splitPayload)}`,
    );
    assert.ok(
      validateEventEnvelope(splitBinding).some((e) =>
        e.includes("does not match envelope.proposal_binding_sha256"),
      ),
    );

    // Invalid UTF-8 percent escapes (%FF, %C0%AF) and unsorted evidence_refs
    const baseRef = `hf://models/example/synthetic-model@${"0".repeat(40)}/`;
    const suffix = `#sha256=${"a".repeat(64)}`;
    for (const badEncoded of ["%FF.json", "%C0%AF.json"]) {
      const badRefEnv = mutable(env0);
      badRefEnv.event.evidence_refs = [`${baseRef}${badEncoded}${suffix}`];
      const rehashed = recomputeEnvelopeHashes(badRefEnv);
      assert.equal(verifyEventJsonl(`${JSON.stringify(rehashed)}\n`).ok, false);
    }
    const unsortedRefsEnv = mutable(env0);
    unsortedRefsEnv.event.evidence_refs = [
      `sha256:${"f".repeat(64)}`,
      `sha256:${"0".repeat(64)}`,
    ];
    const unsortedRehashed = recomputeEnvelopeHashes(unsortedRefsEnv);
    assert.equal(verifyEventJsonl(`${JSON.stringify(unsortedRehashed)}\n`).ok, false);

    // Missing subject_operation_id when verified against proposal
    const missingOp = mutable(env0);
    missingOp.event.subject_operation_id = "op:does-not-exist";
    const missingOpRehashed = recomputeEnvelopeHashes(missingOp);
    const missingOpRes = verifyEventJsonl(`${JSON.stringify(missingOpRehashed)}\n`, {
      proposals: [makeProposal()],
      allowExtensions: true,
    });
    assert.equal(missingOpRes.ok, false);
    assert.ok(missingOpRes.errors.some((e) => e.includes("missing subject_operation_id")));

    // Cyclic / deeply malformed objects never throw in validateEventEnvelope
    const cyclic = {};
    cyclic.self = cyclic;
    assert.ok(validateEventEnvelope(cyclic).some((e) => e.includes("tree-shaped JSON")));

    // Unknown option fails closed
    assert.equal(verifyEventJsonl("", { unknownFlag: true }).ok, false);
  });
});

describe("pure read-only Cartographer catalog", () => {
  test("freezes views, orders deterministically by codepoint, handles prototype keys, and emits zero forbidden keys", () => {
    const pLower = addTwoEvents(makeProposal({
      proposalId: "proposal:a",
      hfSubject: { repo_id: "example/alpha", revision: "1".repeat(40) },
    }), "a");
    const pUpper = addTwoEvents(makeProposal({
      proposalId: "proposal:Z",
      hfSubject: { repo_id: "example/zebra", revision: "2".repeat(40) },
    }), "z");
    const pConstructor = makeProposal({
      proposalId: "constructor",
      hfSubject: { repo_id: "example/ctor", revision: "3".repeat(40) },
    });
    const pToString = makeProposal({
      proposalId: "toString",
      hfSubject: { repo_id: "example/tostr", revision: "4".repeat(40) },
    });

    const mutableInput = [mutable(pLower), mutable(pUpper), mutable(pConstructor), mutable(pToString)];
    const catalog = createCartographerCatalog(mutableInput);

    // Mutating caller input afterwards has no effect on catalog
    mutableInput[0].proposal_id = "mutated";
    mutableInput[0].subject.repo_id = "mutated/repo";

    assert.deepEqual(catalog.tools, CARTOGRAPHER_TOOLS);
    assert.deepEqual(catalog.forbidden_surfaces, FORBIDDEN_CARTOGRAPHER_SURFACES);
    assert.ok(Object.isFrozen(catalog));

    const listed = catalog.listProposals();
    assert.equal(listed.total_count, 4);
    assert.equal(listed.matched_count, 4);
    // Codepoint order puts uppercase "Z" (90) before lowercase "a" (97)
    assert.deepEqual(
      listed.proposals.map((entry) => entry.proposal_id),
      ["constructor", "proposal:Z", "proposal:a", "toString"],
    );
    assert.ok(Object.isFrozen(listed));
    assert.ok(Object.isFrozen(listed.proposals));
    assertNoForbiddenKeys(listed);

    // Prototype property names work cleanly as real proposal IDs, and __proto__ fails cleanly
    const ctorProv = catalog.showProvenance("constructor");
    assert.equal(ctorProv.proposal_id, "constructor");
    assert.equal(ctorProv.dark_continent.wall_verified, false);
    assert.equal(ctorProv.dark_continent.recommendation, "hold");
    assertNoForbiddenKeys(ctorProv);

    assert.throws(() => catalog.showProvenance("__proto__"), RangeError);
    assert.throws(() => catalog.showProvenance("hasOwnProperty"), RangeError);

    // Filtered listing and closed filter validation
    const filtered = catalog.listProposals({ consequence: "adds_candidate" });
    assert.equal(filtered.matched_count, 2);
    assert.throws(() => catalog.listProposals({ score: 1 }), TypeError);
  });

  test("compareConflicts separates cross-proposal divergences from self-comparison cleanly", () => {
    const baseLeft = makeProposal({
      proposalId: "proposal:left",
      frameworkLabel: "Dark Continent contract (left)",
      edgeRelation: "evaluated_by",
    });
    const ref = baseLeft.graph_delta.nodes.find((n) => n.operation_id === "op:subject").evidence_refs[0];
    let left = appendConsequence(baseLeft, {
      event_id: "event:left:c0",
      subject_operation_id: "op:subject",
      consequence: "conflicts_with_source",
      epistemic_status: "observed",
      note_sha256: "1".repeat(64),
      evidence_refs: [ref],
    });
    left = appendReview(left, {
      event_id: "event:left:r1",
      subject_operation_id: "op:subject",
      reviewer_ref: "reviewer:a",
      lens: "rights",
      verdict: "block",
      note_sha256: "2".repeat(64),
      evidence_refs: [ref],
    });

    const baseRight = makeProposal({
      proposalId: "proposal:right",
      frameworkLabel: "Dark Continent contract (right)",
      edgeRelation: "evidence_for",
    });
    let right = appendConsequence(baseRight, {
      event_id: "event:right:c0",
      subject_operation_id: "op:subject",
      consequence: "adds_candidate",
      epistemic_status: "declared",
      note_sha256: "3".repeat(64),
      evidence_refs: [ref],
    });
    right = appendReview(right, {
      event_id: "event:right:r1",
      subject_operation_id: "op:subject",
      reviewer_ref: "reviewer:b",
      lens: "rights",
      verdict: "pass",
      note_sha256: "4".repeat(64),
      evidence_refs: [ref],
    });

    const catalog = createCartographerCatalog([left, right]);

    // Pair comparison catches label, edge relation, verdict, and consequence divergences
    const pair = catalog.compareConflicts("proposal:left", "proposal:right");
    assert.equal(pair.same_proposal, false);
    assert.equal(pair.same_subject_repo, true);
    assert.equal(pair.same_subject_revision, true);
    assert.equal(pair.node_label_divergences.length, 1);
    assert.equal(pair.edge_relation_divergences.length, 1);
    assert.equal(pair.verdict_divergences.length, 1);
    assert.deepEqual(pair.verdict_divergences[0], {
      lens: "rights",
      left_verdicts: ["block"],
      right_verdicts: ["pass"],
    });
    assert.deepEqual(pair.consequence_differences, {
      shared: [],
      left_only: ["conflicts_with_source"],
      right_only: ["adds_candidate"],
    });
    assert.equal(pair.has_cross_proposal_divergence, true);
    assert.equal(pair.has_any_conflict_or_block, true);
    assertNoForbiddenKeys(pair);

    // Self-comparison reports zero cross-proposal divergence while still stating self conflicts
    const selfConflict = catalog.compareConflicts("proposal:left", "proposal:left");
    assert.equal(selfConflict.same_proposal, true);
    assert.equal(selfConflict.has_cross_proposal_divergence, false);
    assert.deepEqual(selfConflict.node_label_divergences, []);
    assert.deepEqual(selfConflict.edge_relation_divergences, []);
    assert.deepEqual(selfConflict.verdict_divergences, []);
    assert.deepEqual(selfConflict.consequence_differences, {
      shared: ["conflicts_with_source"],
      left_only: [],
      right_only: [],
    });
    assert.equal(selfConflict.has_any_conflict_or_block, true);
    assertNoForbiddenKeys(selfConflict);

    const selfClean = catalog.compareConflicts("proposal:right", "proposal:right");
    assert.equal(selfClean.same_proposal, true);
    assert.equal(selfClean.has_cross_proposal_divergence, false);
    assert.equal(selfClean.has_any_conflict_or_block, false);
  });

  test("invokeTool dispatches only read-only tools and refuses forbidden surfaces case-insensitively", async () => {
    const hfProposals = (await readFile(
      new URL("../hf/dataset/artifacts/proposals.jsonl", import.meta.url),
      "utf8",
    ))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    const catalog = createCartographerCatalog(hfProposals);

    const listRes = catalog.invokeTool("list_proposals", { has_conflicts_or_blocks: true });
    assert.equal(listRes.ok, true);
    assert.equal(listRes.result.matched_count, 1);
    assert.equal(listRes.result.proposals[0].proposal_id, "kingdom:hf-treasure:01");
    assertNoForbiddenKeys(listRes);

    const provRes = catalog.invokeTool("show_provenance", {
      proposal_id: "kingdom:hf-treasure:01",
    });
    assert.equal(provRes.ok, true);
    assert.equal(provRes.result.subject.repo_id, "allenai/Dolci-RL-Zero-IF-7B");
    assertNoForbiddenKeys(provRes);

    const cmpRes = catalog.invokeTool("compare_conflicts", {
      left_proposal_id: "kingdom:hf-treasure:01",
      right_proposal_id: "kingdom:hf-treasure:02",
    });
    assert.equal(cmpRes.ok, true);
    assert.equal(cmpRes.result.has_any_conflict_or_block, true);
    assertNoForbiddenKeys(cmpRes);

    // Forbidden mutation / authority surfaces in lowercase, uppercase, mixed case, and whitespace
    for (const surface of [
      "merge",
      "MERGE",
      "Publish",
      "AWARD",
      "Authorize",
      "Coronate",
      "  MeRgE  ",
    ]) {
      const refused = catalog.invokeTool(surface, {});
      assert.equal(refused.ok, false);
      assert.equal(refused.error.code, "forbidden_cartographer_surface");
      assert.equal(refused.authority.authorizes_crown, false);
      assert.equal(refused.effects.graph_writes, 0);
      assertNoForbiddenKeys(refused);
    }

    // Unknown tools (including wrong-cased valid tool names) are refused cleanly
    for (const unknown of ["delete_proposal", "LIST_PROPOSALS", "apply_delta"]) {
      const refused = catalog.invokeTool(unknown, {});
      assert.equal(refused.ok, false);
      assert.equal(refused.error.code, "unknown_cartographer_tool");
    }

    // Unknown proposal & invalid args return structured errors
    const missing = catalog.invokeTool("show_provenance", { proposal_id: "__proto__" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "unknown_proposal");

    const badArgs = catalog.invokeTool("show_provenance", {
      proposal_id: "kingdom:hf-treasure:01",
      extra: true,
    });
    assert.equal(badArgs.ok, false);
    assert.equal(badArgs.error.code, "invalid_arguments");
  });
});
