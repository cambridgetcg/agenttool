import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  appendConsequence,
  appendReview,
  CALAMITY_IDS,
  createProposal,
  DARK_CONTINENT_ARTIFACT,
  DARK_CONTINENT_SNAPSHOT_SHA256,
  hfFileEvidenceRef,
  hfSubjectNodeId,
  KARMA_PAPER_ID,
  KARMA_ROLE_IDS,
  prettyJsonBytes,
  sha256,
  validateProposal,
} from "../src/index.js";
import { createProjection } from "../../dark-continent-contract/src/index.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function subject(overrides = {}) {
  return {
    repo_id: "example/synthetic-model",
    repo_type: "model",
    revision: "0".repeat(40),
    visibility: "public",
    license: "apache-2.0",
    files: [
      { path: "tokenizer.json", sha256: "b".repeat(64) },
      { path: "config.json", sha256: "a".repeat(64) },
    ],
    ...overrides,
  };
}

function validInput(overrides = {}) {
  const hfSubject = subject(overrides.hfSubject);
  const normalizedSubject = { kind: "hf-resource", ...hfSubject };
  const subjectId = hfSubjectNodeId(normalizedSubject);
  const subjectRefs = hfSubject.files
    .map((file) => hfFileEvidenceRef(normalizedSubject, file));
  return {
    proposalId: "proposal:synthetic:hf-model",
    consumer: { kind: "kingdom-extension", id: "hf-kingdom-lab" },
    hfSubject,
    baseGraph: { graph_id: "kingdom:graph", sha256: "c".repeat(64) },
    nodes: [
      {
        operation_id: "op:framework",
        id: "framework:agenttool.dark-continent/0.1",
        kind: "framework",
        label: "Dark Continent contract",
        label_class: "synthetic_metadata",
        evidence_refs: [`sha256:${DARK_CONTINENT_SNAPSHOT_SHA256}`],
      },
      {
        operation_id: "op:subject",
        id: subjectId,
        kind: "hf_model",
        label: hfSubject.repo_id,
        label_class: "synthetic_metadata",
        evidence_refs: subjectRefs,
      },
    ],
    edges: [
      {
        operation_id: "op:edge:review-lens",
        from: subjectId,
        to: "framework:agenttool.dark-continent/0.1",
        relation: "evaluated_by",
        evidence_refs: [`sha256:${DARK_CONTINENT_SNAPSHOT_SHA256}`],
      },
    ],
    ...overrides,
    hfSubject,
  };
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("KINGDOM KG proposal", () => {
  test("is deterministic, canonical, frozen, and proposal-only", () => {
    const first = createProposal(validInput());
    const second = createProposal({
      ...validInput(),
      nodes: [...validInput().nodes].reverse(),
      hfSubject: {
        ...validInput().hfSubject,
        files: [...validInput().hfSubject.files].reverse(),
      },
    });

    assert.equal(prettyJsonBytes(first), prettyJsonBytes(second));
    assert.deepEqual(validateProposal(first), []);
    assert.equal(first.state, "proposed");
    assert.equal(first.effects.llm_calls, 0);
    assert.equal(first.effects.graph_writes, 0);
    assert.equal(first.effects.remote_writes, 0);
    assert.equal(first.effects.hf_uploads, 0);
    assert.equal(first.effects.xp_changes, 0);
    assert.equal(first.effects.reward_changes, 0);
    assert.equal(first.authority.authorizes_crown, false);
    assert.equal(first.authority.verifies_runtime_walls, false);
    assert.equal(first.authority.assigns_rank, false);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.graph_delta.nodes));
  });

  test("matches the exact sibling Dark Continent projection", () => {
    const proposal = createProposal(validInput());
    const expected = createProjection({
      projectionId: `${proposal.proposal_id}:dark-continent`,
      consumer: { kind: "kingdom-extension", id: "hf-kingdom-lab" },
      artifact: DARK_CONTINENT_ARTIFACT,
      interpretations: [
        {
          source_profile: "karma-kg-2502.06472v2",
          relation: "parallel_not_equivalent",
        },
      ],
    });
    assert.deepEqual(proposal.dark_continent, expected);
    assert.equal(
      proposal.dark_continent.source_snapshot.artifact,
      "@agenttool/dark-continent-contract/framework",
    );
    assert.deepEqual(
      proposal.dark_continent.checks.map((check) => check.calamity_id),
      CALAMITY_IDS,
    );
    for (const check of proposal.dark_continent.checks) {
      assert.equal(check.risk_state, "unknown");
      assert.equal(check.wall.status, "not_checked");
      assert.equal(check.wall.verified, false);
      assert.deepEqual(check.evidence_refs, []);
    }
    assert.equal(proposal.dark_continent.decision.recommendation, "hold");
  });

  test("projects the same closed contract for the Artbitrage consumer", () => {
    const input = validInput({
      consumer: { kind: "artbitrage", id: "artbitrage" },
    });
    const proposal = createProposal(input);
    assert.deepEqual(proposal.dark_continent, createProjection({
      projectionId: `${proposal.proposal_id}:dark-continent`,
      consumer: { kind: "artbitrage", id: "artbitrage" },
      artifact: DARK_CONTINENT_ARTIFACT,
      interpretations: [
        {
          source_profile: "karma-kg-2502.06472v2",
          relation: "parallel_not_equivalent",
        },
      ],
    }));
    assert.equal(proposal.authority.authorizes_trade, false);
  });

  test("pins KARMA v2 as inspiration and does not claim runtime compatibility", () => {
    const proposal = createProposal(validInput());
    assert.equal(proposal.created_from.karma.paper_id, KARMA_PAPER_ID);
    assert.equal(proposal.created_from.karma.relationship, "inspired_by");
    assert.equal(proposal.created_from.karma.implementation_runtime, "not_imported_or_executed");
    assert.deepEqual(proposal.created_from.karma.roles, KARMA_ROLE_IDS);
    assert.equal(proposal.created_from.karma.roles.length, 9);
  });

  test("appends consequence and review events as one proposal-bound hash chain", () => {
    const initial = createProposal(validInput());
    const consequence = appendConsequence(initial, {
      event_id: "event:consequence:1",
      subject_operation_id: "op:subject",
      consequence: "requires_safety_review",
      epistemic_status: "inferred",
      note_sha256: "d".repeat(64),
      evidence_refs: [initial.graph_delta.nodes[1].evidence_refs[0]],
    });
    const reviewed = appendReview(consequence, {
      event_id: "event:review:2",
      subject_operation_id: "op:subject",
      reviewer_ref: "reviewer:declared-local-fixture",
      lens: "provenance",
      verdict: "deferred",
      note_sha256: "e".repeat(64),
      evidence_refs: [initial.graph_delta.nodes[1].evidence_refs[0]],
    });

    assert.equal(initial.events.length, 0);
    assert.equal(consequence.events.length, 1);
    assert.equal(reviewed.events.length, 2);
    assert.equal(reviewed.events[0].sequence, 0);
    assert.equal(reviewed.events[0].previous_event_sha256, null);
    assert.match(reviewed.events[0].proposal_binding_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      reviewed.events[1].previous_event_sha256,
      reviewed.events[0].event_sha256,
    );
    assert.equal(reviewed.state, "proposed");
    assert.equal(reviewed.authority.authorizes_action, false);
    assert.deepEqual(validateProposal(reviewed), []);
  });

  test("rejects mutable Hub revisions, unsafe paths, and unbound subjects", () => {
    assert.throws(
      () => createProposal(validInput({ hfSubject: { revision: "main" } })),
      /immutable 40-hex commit/,
    );
    assert.throws(
      () => createProposal(validInput({
        hfSubject: {
          files: [{ path: "../secret", sha256: "a".repeat(64) }],
        },
      })),
      /path is invalid/,
    );
    const changed = validInput();
    changed.nodes = changed.nodes.map((node) =>
      node.operation_id === "op:subject"
        ? {
            ...node,
            evidence_refs: [
              `hf://models/example/synthetic-model@${"0".repeat(40)}/wrong.json#sha256=${"a".repeat(64)}`,
            ],
          }
        : node
    );
    assert.throws(() => createProposal(changed), /not bound to its exact files/);
  });

  test("accepts only classified single-line labels and content-addressed evidence", () => {
    for (const separator of ["\n", "\u0085", "\u2028", "\u2029"]) {
      const multiline = validInput();
      multiline.nodes[0] = {
        ...multiline.nodes[0],
        label: `raw chat line one${separator}raw chat line two`,
      };
      assert.throws(() => createProposal(multiline), /single-line metadata/);
    }

    const unclassified = validInput();
    delete unclassified.nodes[0].label_class;
    assert.throws(() => createProposal(unclassified), /closed schema/);

    const credentialUrl = validInput();
    credentialUrl.nodes[0] = {
      ...credentialUrl.nodes[0],
      evidence_refs: ["https://user:password@example.invalid/data?token=SECRET"],
    };
    assert.throws(() => createProposal(credentialUrl), /content-addressed evidence/);

    const privateSubject = validInput({
      hfSubject: { visibility: "private" },
    });
    assert.throws(() => createProposal(privateSubject), /not bound to its exact files/);
    privateSubject.nodes = privateSubject.nodes.map((node) =>
      node.operation_id === "op:subject"
        ? { ...node, label_class: "local_metadata" }
        : node
    );
    assert.deepEqual(validateProposal(createProposal(privateSubject)), []);
  });

  test("rejects sameAs, scores, agent voting, and unknown fields", () => {
    const sameAs = validInput();
    sameAs.edges[0] = { ...sameAs.edges[0], relation: "sameAs" };
    assert.throws(() => createProposal(sameAs), /relation is not supported/);

    const scored = validInput();
    scored.nodes[0] = { ...scored.nodes[0], score: 1 };
    assert.throws(() => createProposal(scored), /closed schema/);

    const proposal = mutable(createProposal(validInput()));
    proposal.agent_votes = Array.from({ length: 9 }, () => "agree");
    const errors = validateProposal(proposal);
    assert.ok(errors.some((error) => error.includes("unknown fields")));
    assert.ok(errors.some((error) => error.includes("agent_votes is forbidden")));
  });

  test("returns bounded errors for deeply malformed or cyclic values", () => {
    const deeplyNested = {};
    let cursor = deeplyNested;
    for (let index = 0; index < 20_000; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    const deepErrors = validateProposal({ extra: deeplyNested });
    assert.ok(deepErrors.some((error) => error.includes("validation depth")));

    const cyclic = {};
    cyclic.self = cyclic;
    assert.ok(
      validateProposal(cyclic).some((error) => error.includes("tree-shaped JSON value")),
    );
  });

  test("rejects wall, Crown, publication, and execution authority escalation", () => {
    for (const mutate of [
      (proposal) => { proposal.dark_continent.checks[0].wall.verified = true; },
      (proposal) => { proposal.authority.authorizes_crown = true; },
      (proposal) => { proposal.authority.authorizes_publication = true; },
      (proposal) => { proposal.authority.authorizes_execution = true; },
    ]) {
      const proposal = mutable(createProposal(validInput()));
      mutate(proposal);
      assert.notDeepEqual(validateProposal(proposal), []);
    }
  });

  test("detects event rewrites and duplicate event identifiers", () => {
    const initial = createProposal(validInput());
    const once = appendConsequence(initial, {
      event_id: "event:one",
      subject_operation_id: "op:subject",
      consequence: "adds_candidate",
      epistemic_status: "declared",
      note_sha256: "d".repeat(64),
      evidence_refs: [initial.graph_delta.nodes[1].evidence_refs[0]],
    });
    const rewritten = mutable(once);
    rewritten.events[0].consequence = "rejected";
    assert.ok(validateProposal(rewritten).some((error) => error.includes("hash is invalid")));
    assert.throws(
      () => appendReview(once, {
        event_id: "event:one",
        subject_operation_id: "op:subject",
        reviewer_ref: "reviewer:fixture",
        lens: "rights",
        verdict: "block",
        note_sha256: "e".repeat(64),
        evidence_refs: [initial.graph_delta.nodes[1].evidence_refs[0]],
      }),
      /already present/,
    );
  });

  test("rejects a valid event chain transplanted onto another proposal", () => {
    const alpha = createProposal(validInput());
    const withEvent = appendConsequence(alpha, {
      event_id: "event:bound-to-alpha",
      subject_operation_id: "op:subject",
      consequence: "requires_rights_review",
      epistemic_status: "inferred",
      note_sha256: "d".repeat(64),
      evidence_refs: [alpha.graph_delta.nodes[1].evidence_refs[0]],
    });
    const beta = mutable(createProposal(validInput({
      hfSubject: {
        repo_id: "example/synthetic-beta",
        revision: "1".repeat(40),
      },
      baseGraph: { graph_id: "kingdom:other", sha256: "e".repeat(64) },
    })));
    beta.events = mutable(withEvent.events);

    assert.ok(
      validateProposal(beta).some((error) => error.includes("proposal binding is invalid")),
    );
  });

  test("uses locale-independent ordering for Unicode Hub paths", () => {
    const input = validInput({
      hfSubject: {
        files: [
          { path: "ä.json", sha256: "a".repeat(64) },
          { path: "z.json", sha256: "b".repeat(64) },
        ],
      },
    });
    const proposal = createProposal(input);
    assert.deepEqual(
      proposal.subject.files.map((file) => file.path),
      ["z.json", "ä.json"],
    );
    assert.ok(
      proposal.graph_delta.nodes[1].evidence_refs.some((ref) => ref.includes("%C3%A4.json")),
    );
  });

  test("canonical bytes have a stable SHA-256", () => {
    const proposal = createProposal(validInput());
    const digest = sha256(prettyJsonBytes(proposal));
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(digest, sha256(prettyJsonBytes(createProposal(validInput()))));
  });
});

describe("HF and npm packaging boundary", () => {
  test("ships a local-only HF export profile", async () => {
    const profile = JSON.parse(await readFile(
      new URL("../exports/hf-kingdom-lab.json", import.meta.url),
      "utf8",
    ));
    assert.equal(profile._format, "kingdom-hf-karma-export-profile/v0.1");
    assert.equal(profile.publication.ready, true);
    assert.equal(profile.publication.authorization_embedded_in_artifact, false);
    assert.equal(profile.effects.hf_uploads, 0);
    assert.equal(profile.effects.remote_writes, 0);
    assert.equal(profile.exclusions.raw_chats, true);
    assert.equal(profile.profile_kind, "metadata_catalog_release_not_exporter_or_sanitizer");
    assert.equal(profile.eligibility_gate.implementation_status, "metadata_catalog_builder_implemented");
    assert.equal(profile.eligibility_gate.requires_subject_visibility, "public");
    assert.deepEqual(profile.eligibility_gate.forbidden_label_classes, ["local_metadata"]);
    assert.ok(profile.dataset_files.every((file) => file.status === "generated"));
    assert.equal(profile.dataset_files.some((file) => file.path === "events.jsonl"), false);
    assert.deepEqual(profile.space.forbidden_tools, [
      "award",
      "authorize",
      "coronate",
      "merge",
      "publish",
    ]);
  });

  test("source profile matches runtime constants", async () => {
    const source = JSON.parse(await readFile(
      new URL("../sources/karma-2502.06472v2.json", import.meta.url),
      "utf8",
    ));
    assert.equal(source.paper.id, KARMA_PAPER_ID);
    assert.equal(source.relationship, "inspired_by");
    assert.deepEqual(source.roles, KARMA_ROLE_IDS);
    assert.equal(source.paper.hf_linked_models, 0);
    assert.equal(source.paper.hf_linked_datasets, 0);
    assert.equal(source.paper.hf_linked_spaces, 0);
    assert.equal(source.authority.authorizes_crown, false);
  });

  test("schema and package are closed, public Apache-2.0, and zero-dependency", async () => {
    const schema = JSON.parse(await readFile(
      new URL("../schema/kingdom-kg-proposal-v0.1.schema.json", import.meta.url),
      "utf8",
    ));
    const packageJson = JSON.parse(await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    ));
    assert.equal(schema.properties._format.const, "kingdom.kg-proposal/0.1");
    assert.equal(schema.additionalProperties, false);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    assert.equal(validate(createProposal(validInput())), true, JSON.stringify(validate.errors));
    for (const path of ["../secret", "a//b", "a/", "raw\u0085path", "raw\u2028path"]) {
      const unsafePath = mutable(createProposal(validInput()));
      unsafePath.subject.files[0].path = path;
      assert.equal(validate(unsafePath), false, `schema accepted unsafe path ${path}`);
    }
    const unsafeRef = mutable(createProposal(validInput()));
    unsafeRef.graph_delta.nodes[0].evidence_refs = [
      "https://user:password@example.invalid/data?token=SECRET",
    ];
    assert.equal(validate(unsafeRef), false, "schema accepted an arbitrary evidence URL");
    const hfRefPrefix = `hf://models/example/synthetic-model@${"0".repeat(40)}/`;
    const hfRefSuffix = `#sha256=${"a".repeat(64)}`;
    for (const encodedPath of [
      "..",
      "%2E%2E",
      "%2F",
      "%5C",
      "%00",
      "%C2%85",
      "%E2%80%A8",
      "%41.json",
    ]) {
      const unsafeEncodedRef = mutable(createProposal(validInput()));
      unsafeEncodedRef.graph_delta.nodes[0].evidence_refs = [
        `${hfRefPrefix}${encodedPath}${hfRefSuffix}`,
      ];
      assert.equal(
        validate(unsafeEncodedRef),
        false,
        `schema accepted unsafe encoded HF path ${encodedPath}`,
      );
    }
    for (const separator of ["\n", "\u0085", "\u2028", "\u2029"]) {
      const multiline = mutable(createProposal(validInput()));
      multiline.graph_delta.nodes[0].label = `raw chat${separator}line`;
      assert.equal(validate(multiline), false, "schema accepted multiline label prose");
    }
    assert.notEqual(packageJson.private, true);
    assert.equal(packageJson.license, "Apache-2.0");
    assert.equal(packageJson.publishConfig?.access, "public");
    assert.equal(packageJson.main, "./dist/index.js");
    assert.equal(packageJson.types, "./dist/index.d.ts");
    assert.ok(packageJson.files.includes("dist"));
    assert.equal(packageJson.files.includes("src"), false);
    assert.equal(typeof packageJson.scripts?.prepack, "string");
    assert.equal(packageJson.dependencies, undefined);
  });

  test("runtime source has no network, filesystem, environment, or process execution path", async () => {
    const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
    for (const forbidden of [
      "node:fs",
      "node:child_process",
      "process.env",
      "fetch(",
      "Bun.spawn",
      "OpenAI",
      "hf_fs_write",
      "localeCompare",
    ]) {
      assert.equal(source.includes(forbidden), false, `source contained ${forbidden}`);
    }
  });

  test("does not depend on the current working directory", async () => {
    assert.ok(packageRoot.endsWith("dark-continent-karma/"));
  });
});
