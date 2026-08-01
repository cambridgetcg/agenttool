import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  createDeepSeekKingdomProposal,
  createDeepSeekSourceBinding,
  DeepSeekKingdomError,
  validateDeepSeekKingdomProposal,
  validateDeepSeekSourceBinding,
} from "../src/index.js";
import { githubSourceInput, proposalInput } from "./fixtures.js";

describe("DeepSeek primary-source binding", () => {
  test("snapshots mutable caller input into a deterministic deep-frozen binding", () => {
    const input = githubSourceInput();
    const first = createDeepSeekSourceBinding(input);
    const second = createDeepSeekSourceBinding(input);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.subject.evidence)).toBe(true);
    expect(Object.isFrozen(first.claims)).toBe(true);
    input.subject.label = "mutated after binding";
    expect(first.subject.label).toBe("DeepSeek-R1 official repository README");
    expect(validateDeepSeekSourceBinding(first)).toEqual(first);
  });

  test("admits exact Hugging Face and versioned arXiv evidence shapes", () => {
    const hf = createDeepSeekSourceBinding({
      subject: {
        label: "DeepSeek-ProverBench Dataset Card",
        evidence: {
          origin: "deepseek_huggingface",
          resource_kind: "dataset_repository",
          repository_id: "deepseek-ai/DeepSeek-ProverBench",
          revision: "3b9f067088e5e005fab91434ddc05a903e0a6252",
          path: "README.md",
          sha256: `sha256:${"b".repeat(64)}`,
          observed_on: "2026-08-01",
        },
      },
      license: {
        scope: "dataset",
        declared_expression: null,
        evidence: null,
        review_status: "not_reviewed",
      },
      claims: [{
        claim_id: "proverbench.card-observation",
        claim_kind: "evaluation",
        summary: "Caller reports one evaluation-dataset description.",
        source_anchor: "README.md",
      }],
    });
    const paper = createDeepSeekSourceBinding({
      subject: {
        label: "DeepSeek-R1 paper v2",
        evidence: {
          origin: "arxiv_primary",
          resource_kind: "paper",
          repository_id: "2501.12948",
          revision: "2501.12948v2",
          path: null,
          sha256: `sha256:${"c".repeat(64)}`,
          observed_on: "2026-08-01",
        },
      },
      license: {
        scope: "paper",
        declared_expression: null,
        evidence: null,
        review_status: "not_reviewed",
      },
      claims: [{
        claim_id: "r1.paper-observation",
        claim_kind: "training_method",
        summary: "Caller reports one training-method description.",
        source_anchor: "section:2",
      }],
    });
    expect(hf.subject.evidence.revision).toHaveLength(40);
    expect(paper.subject.evidence.revision).toBe("2501.12948v2");
  });

  test("requires exact official-origin pin combinations", () => {
    const input = githubSourceInput();
    input.subject.evidence.revision = "main";
    expect(() => createDeepSeekSourceBinding(input)).toThrow(DeepSeekKingdomError);

    const wrongOrg = githubSourceInput();
    wrongOrg.subject.evidence.repository_id = "someone/DeepSeek-R1";
    expect(() => createDeepSeekSourceBinding(wrongOrg)).toThrow(
      "not a pinned official DeepSeek GitHub document",
    );

    const mismatchedPaper = githubSourceInput();
    Object.assign(mismatchedPaper.subject.evidence, {
      origin: "arxiv_primary",
      resource_kind: "paper",
      repository_id: "2501.12948",
      revision: "2412.19437v2",
      path: null,
    });
    expect(() => createDeepSeekSourceBinding(mismatchedPaper)).toThrow(
      "not a versioned arXiv primary paper",
    );

    const impossibleDate = githubSourceInput();
    impossibleDate.subject.evidence.observed_on = "2026-02-31";
    expect(() => createDeepSeekSourceBinding(impossibleDate)).toThrow(
      "ISO calendar date",
    );
  });

  test("keeps license evidence on the exact subject revision", () => {
    const input = githubSourceInput();
    input.license = {
      scope: "code",
      declared_expression: "MIT",
      evidence: {
        ...input.subject.evidence,
        path: "LICENSE",
        sha256: `sha256:${"d".repeat(64)}`,
      },
      review_status: "caller_reviewed",
    };
    expect(createDeepSeekSourceBinding(input).license.basis).toBe("caller_reported");

    const mismatch = githubSourceInput();
    mismatch.license = {
      scope: "code",
      declared_expression: "MIT",
      evidence: {
        ...mismatch.subject.evidence,
        revision: "1".repeat(40),
        path: "LICENSE",
      },
      review_status: "caller_reviewed",
    };
    expect(() => createDeepSeekSourceBinding(mismatch)).toThrow(
      "must share the subject origin, repository, and revision",
    );
  });

  test("rejects extra keys, unsorted claims, and malformed source text", () => {
    const extra = { ...githubSourceInput(), credential: "no" };
    expect(() => createDeepSeekSourceBinding(extra as never)).toThrow("must contain exactly");

    const unsorted = githubSourceInput();
    unsorted.claims = [...unsorted.claims].reverse();
    expect(() => createDeepSeekSourceBinding(unsorted)).toThrow("sorted by unique claim_id");

    const bidi = githubSourceInput();
    bidi.subject.label = "hidden\u202econtrol";
    expect(() => createDeepSeekSourceBinding(bidi)).toThrow("bounded safe text");
  });

  test("detects binding tampering", () => {
    const binding = createDeepSeekSourceBinding(githubSourceInput());
    expect(() => validateDeepSeekSourceBinding({
      ...binding,
      binding_id: `sha256:${"f".repeat(64)}`,
    })).toThrow("binding digest");
  });
});

describe("proposal-only KINGDOM projection", () => {
  test("creates deterministic unaccepted candidates with zero effects", () => {
    const source = createDeepSeekSourceBinding(githubSourceInput());
    const first = createDeepSeekKingdomProposal(proposalInput(source));
    const second = createDeepSeekKingdomProposal(proposalInput(source));
    expect(first).toEqual(second);
    expect(first.state).toBe("proposed_unaccepted");
    expect(first.integration.dark_continent.walls_status).toBe("not_checked");
    expect(first.integration.dark_continent.recommendation).toBe("hold");
    expect(first.integration.karma.compatibility_claimed).toBe(false);
    expect(Object.values(first.effects).every((value) => value === 0)).toBe(true);
    expect(first.authority.authorizes_kingdom_registration).toBe(false);
    expect(first.authority.approves_license).toBe(false);
    expect(first.license_boundary.upstream_license_review_required).toBe(true);
    expect(Object.isFrozen(first.delta.candidates[0])).toBe(true);
    expect(validateDeepSeekKingdomProposal(first)).toEqual(first);
  });

  test("binds an exact KINGDOM snapshot and existing source claims", () => {
    const source = createDeepSeekSourceBinding(githubSourceInput());
    const unknown = proposalInput(source);
    unknown.candidates[0]!.claim_refs = ["r1.unknown"];
    expect(() => createDeepSeekKingdomProposal(unknown)).toThrow(
      "sorted, unique source claim IDs",
    );

    const mutableTarget = proposalInput(source);
    mutableTarget.target.kingdom_snapshot_sha256 = "sha256:not-a-digest";
    expect(() => createDeepSeekKingdomProposal(mutableTarget)).toThrow(
      "lowercase sha256",
    );
  });

  test("rejects ordering drift, extra fields, and fixed-boundary tampering", () => {
    const source = createDeepSeekSourceBinding(githubSourceInput());
    const unsorted = proposalInput(source);
    unsorted.candidates = [...unsorted.candidates].reverse();
    expect(() => createDeepSeekKingdomProposal(unsorted)).toThrow(
      "sorted by unique candidate_id",
    );

    const extra = { ...proposalInput(source), model: "execute" };
    expect(() => createDeepSeekKingdomProposal(extra as never)).toThrow("must contain exactly");

    const proposal = createDeepSeekKingdomProposal(proposalInput(source));
    expect(() => validateDeepSeekKingdomProposal({
      ...proposal,
      authority: { ...proposal.authority, authorizes_inference: true },
    })).toThrow("fixed boundary fields");
  });
});

describe("canonical bytes", () => {
  test("rejects accessors, cycles, floats, and malformed Unicode", () => {
    expect(() => canonicalJson(Object.defineProperty({}, "value", { get: () => 1 }))).toThrow(
      "rejects accessors",
    );
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow("rejects cycles");
    expect(() => canonicalJson(1.5)).toThrow("safe integers only");
    expect(() => canonicalJson("\ud800")).toThrow("malformed Unicode");
  });
});
