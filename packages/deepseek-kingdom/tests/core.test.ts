import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  compareUnicode,
  createDeepSeekAfterglowThread,
  createDeepSeekKingdomProposal,
  createDeepSeekSourceBinding,
  deepFreeze,
  DeepSeekKingdomError,
  domainSeparatedId,
  sha256Id,
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

describe("DeepSeek to AFTERGLOW thread seam", () => {
  test("projects only a deterministic digest-only structural thread", () => {
    const source = createDeepSeekSourceBinding(githubSourceInput());
    const proposal = createDeepSeekKingdomProposal(proposalInput(source));
    const first = createDeepSeekAfterglowThread({
      proposal,
      disposition: "park",
    });
    const second = createDeepSeekAfterglowThread({
      proposal,
      disposition: "park",
    });

    expect(first).toEqual(second);
    expect(first).toEqual({
      thread_ref: domainSeparatedId(
        "agenttool.deepseek-afterglow-thread/0.1",
        { artifact_ref: proposal.proposal_id },
      ),
      artifact_ref: proposal.proposal_id,
      disposition: "park",
      assertion: "caller_asserted",
      verified_by_package: false,
      kind: "deepseek",
      state: "proposed_unaccepted",
    });
    expect(Object.keys(first).sort()).toEqual([
      "artifact_ref",
      "assertion",
      "disposition",
      "kind",
      "state",
      "thread_ref",
      "verified_by_package",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
  });

  test("admits only AFTERGLOW dispositions and one exact proposal", () => {
    const proposal = createDeepSeekKingdomProposal(
      proposalInput(createDeepSeekSourceBinding(githubSourceInput())),
    );
    expect(
      (["carry", "park", "release", "withdraw"] as const).map(
        (disposition) =>
          createDeepSeekAfterglowThread({
            proposal,
            disposition,
          }).disposition,
      ),
    ).toEqual(["carry", "park", "release", "withdraw"]);

    try {
      createDeepSeekAfterglowThread({
        proposal,
        disposition: "resume" as "carry",
      });
      throw new Error("invalid disposition was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(DeepSeekKingdomError);
      expect((error as DeepSeekKingdomError).code).toBe(
        "invalid_afterglow_thread",
      );
    }
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal,
        disposition: "park",
        thread_key: "caller-private-label",
      } as never),
    ).toThrow("must contain exactly");
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: {
          ...proposal,
          state: "accepted",
        } as never,
        disposition: "park",
      }),
    ).toThrow("fixed boundary fields");

    let getterCalled = false;
    const hostile = { proposal, disposition: "park" as const };
    Object.defineProperty(hostile, "identity", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "must-not-cross";
      },
    });
    try {
      createDeepSeekAfterglowThread(hostile);
      throw new Error("hostile accessor was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(DeepSeekKingdomError);
      expect((error as DeepSeekKingdomError).code).toBe("invalid_json");
    }
    expect(getterCalled).toBe(false);
  });

  test("rejects nested hostile own-data without invoking it", () => {
    const proposal = createDeepSeekKingdomProposal(
      proposalInput(createDeepSeekSourceBinding(githubSourceInput())),
    );

    let indexGetterCalled = false;
    const accessorProposal = structuredClone(proposal);
    const firstCandidate = accessorProposal.delta.candidates[0]!;
    Object.defineProperty(accessorProposal.delta.candidates, "0", {
      enumerable: true,
      configurable: true,
      get() {
        indexGetterCalled = true;
        return firstCandidate;
      },
    });
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: accessorProposal,
        disposition: "park",
      }),
    ).toThrow("own enumerable data property");
    expect(indexGetterCalled).toBe(false);

    let customMapCalled = false;
    const extraArrayPropertyProposal = structuredClone(proposal);
    Object.defineProperty(extraArrayPropertyProposal.delta.candidates, "map", {
      enumerable: true,
      configurable: true,
      writable: true,
      value() {
        customMapCalled = true;
        return [];
      },
    });
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: extraArrayPropertyProposal,
        disposition: "park",
      }),
    ).toThrow("dense Array");
    expect(customMapCalled).toBe(false);

    const hiddenArrayPropertyProposal = structuredClone(proposal);
    Object.defineProperty(hiddenArrayPropertyProposal.delta.candidates, "private", {
      enumerable: false,
      configurable: true,
      writable: true,
      value: "must-not-cross",
    });
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: hiddenArrayPropertyProposal,
        disposition: "park",
      }),
    ).toThrow("dense Array");

    const symbolArrayPropertyProposal = structuredClone(proposal);
    Object.defineProperty(
      symbolArrayPropertyProposal.delta.candidates,
      Symbol("private"),
      {
        enumerable: true,
        configurable: true,
        writable: true,
        value: "must-not-cross",
      },
    );
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: symbolArrayPropertyProposal,
        disposition: "park",
      }),
    ).toThrow("symbol property");

    let inheritedMapGetterCalled = false;
    const customArrayPrototypeProposal = structuredClone(proposal);
    const customArrayPrototype = Object.create(Array.prototype);
    Object.defineProperty(customArrayPrototype, "map", {
      get() {
        inheritedMapGetterCalled = true;
        return Array.prototype.map;
      },
    });
    Object.setPrototypeOf(
      customArrayPrototypeProposal.delta.candidates,
      customArrayPrototype,
    );
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: customArrayPrototypeProposal,
        disposition: "park",
      }),
    ).toThrow("standard Array");
    expect(inheritedMapGetterCalled).toBe(false);

    const nullArrayPrototypeProposal = structuredClone(proposal);
    Object.setPrototypeOf(nullArrayPrototypeProposal.delta.candidates, null);
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: nullArrayPrototypeProposal,
        disposition: "park",
      }),
    ).toThrow("standard Array");

    let prototypeTrapCalls = 0;
    const prototypeTrap = () => {
      prototypeTrapCalls += 1;
      throw new Error("an array-prototype Proxy trap ran");
    };
    const revokedArrayPrototype = Proxy.revocable({}, {
      get: prototypeTrap,
      getOwnPropertyDescriptor: prototypeTrap,
      getPrototypeOf: prototypeTrap,
      ownKeys: prototypeTrap,
    });
    const revokedArrayPrototypeProposal = structuredClone(proposal);
    Object.setPrototypeOf(
      revokedArrayPrototypeProposal.delta.candidates,
      revokedArrayPrototype.proxy,
    );
    revokedArrayPrototype.revoke();
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: revokedArrayPrototypeProposal,
        disposition: "park",
      }),
    ).toThrow("standard Array");
    expect(prototypeTrapCalls).toBe(0);

    const hiddenProposal = structuredClone(proposal);
    Object.defineProperty(hiddenProposal, "identity", {
      enumerable: false,
      configurable: true,
      writable: true,
      value: "must-not-cross",
    });
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: hiddenProposal,
        disposition: "park",
      }),
    ).toThrow("own enumerable data property");

    const symbolProposal = structuredClone(proposal) as typeof proposal & {
      [key: symbol]: string;
    };
    symbolProposal[Symbol("identity")] = "must-not-cross";
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: symbolProposal,
        disposition: "park",
      }),
    ).toThrow("symbol property");

    const customObjectPrototypeProposal = structuredClone(proposal);
    Object.setPrototypeOf(customObjectPrototypeProposal.target, {
      inherited: "must-not-cross",
    });
    expect(() =>
      createDeepSeekAfterglowThread({
        proposal: customObjectPrototypeProposal,
        disposition: "park",
      }),
    ).toThrow("plain or null-prototype object");
  });
});

describe("canonical bytes", () => {
  test("rejects accessors, cycles, floats, and malformed Unicode", () => {
    expect(() => canonicalJson(Object.defineProperty({}, "value", { get: () => 1 }))).toThrow(
      "own enumerable data property",
    );
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow("rejects cycles");
    expect(() => canonicalJson(new Array(1))).toThrow("dense Array");
    expect(() => canonicalJson(1.5)).toThrow("safe integers only");
    expect(() => canonicalJson("\ud800")).toThrow("malformed Unicode");
  });

  test("bounds depth, values, field bytes, input bytes, and canonical bytes", () => {
    let exactDepth: unknown = 0;
    for (let index = 0; index < 32; index += 1) exactDepth = [exactDepth];
    expect(() => canonicalJson(exactDepth)).not.toThrow();
    expect(() =>
      canonicalJson(Array.from({ length: 16_383 }, (_, index) => index)),
    ).not.toThrow();
    expect(() => canonicalJson("a".repeat(4_096))).not.toThrow();

    let nested: unknown = 0;
    for (let index = 0; index < 64; index += 1) nested = { nested };
    for (const hostile of [
      nested,
      Array.from({ length: 16_384 }, (_, index) => index),
      new Array(1_000_000),
      "a".repeat(4_097),
      { ["k".repeat(4_097)]: 1 },
      Array.from({ length: 700 }, () => "界".repeat(1_000)),
      Array.from({ length: 500 }, () => "\u0000".repeat(3_500)),
    ]) {
      try {
        canonicalJson(hostile);
        throw new Error("hostile canonical JSON was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(DeepSeekKingdomError);
        expect((error as DeepSeekKingdomError).code).toBe("invalid_json");
      }
    }

    const hugeKey = "k".repeat(100_000);
    try {
      canonicalJson({ [hugeKey]: 1 });
      throw new Error("oversized key was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(DeepSeekKingdomError);
      expect((error as Error).message.length).toBeLessThan(256);
    }
  });

  test("rejects root, nested, and revoked Proxies without running traps", () => {
    const hostileProxy = () => {
      let trapCalls = 0;
      const trap = () => {
        trapCalls += 1;
        throw new Error("a Proxy trap ran");
      };
      return {
        proxy: new Proxy({}, {
          defineProperty: trap,
          deleteProperty: trap,
          get: trap,
          getOwnPropertyDescriptor: trap,
          getPrototypeOf: trap,
          has: trap,
          isExtensible: trap,
          ownKeys: trap,
          preventExtensions: trap,
          set: trap,
          setPrototypeOf: trap,
        }),
        trapCalls: () => trapCalls,
      };
    };

    const root = hostileProxy();
    expect(() => canonicalJson(root.proxy)).toThrow("must not be a Proxy");
    expect(root.trapCalls()).toBe(0);

    const nested = hostileProxy();
    expect(() => canonicalJson({ nested: nested.proxy })).toThrow(
      "must not be a Proxy",
    );
    expect(nested.trapCalls()).toBe(0);

    const domain = hostileProxy();
    expect(() => domainSeparatedId(domain.proxy as never, {})).toThrow(
      "must not be a Proxy",
    );
    expect(domain.trapCalls()).toBe(0);

    const comparison = hostileProxy();
    expect(() => compareUnicode(comparison.proxy as never, "safe")).toThrow(
      "must not be Proxy",
    );
    expect(comparison.trapCalls()).toBe(0);

    for (const nonString of [
      1,
      true,
      null,
      undefined,
      Symbol("domain"),
      new String("domain"),
    ]) {
      expect(() => domainSeparatedId(nonString as never, {})).toThrow(
        DeepSeekKingdomError,
      );
      expect(() => compareUnicode(nonString as never, "safe")).toThrow(
        DeepSeekKingdomError,
      );
    }

    let coercionCalls = 0;
    const coerciveDomain = {
      get [Symbol.toPrimitive]() {
        coercionCalls += 1;
        throw new Error("domain coercion ran");
      },
    };
    expect(() => domainSeparatedId(coerciveDomain as never, {})).toThrow(
      DeepSeekKingdomError,
    );
    expect(() => compareUnicode(coerciveDomain as never, "safe")).toThrow(
      DeepSeekKingdomError,
    );
    expect(coercionCalls).toBe(0);

    const frozen = hostileProxy();
    expect(() => deepFreeze(frozen.proxy)).toThrow("must not be a Proxy");
    expect(frozen.trapCalls()).toBe(0);

    let functionTrapCalls = 0;
    const functionProxy = new Proxy(() => "must-not-run", {
      apply() {
        functionTrapCalls += 1;
        throw new Error("a function Proxy trap ran");
      },
      getPrototypeOf() {
        functionTrapCalls += 1;
        throw new Error("a function Proxy trap ran");
      },
      preventExtensions() {
        functionTrapCalls += 1;
        throw new Error("a function Proxy trap ran");
      },
    });
    expect(() => canonicalJson(functionProxy)).toThrow("must not be a Proxy");
    expect(() => deepFreeze(functionProxy)).toThrow("must not be a Proxy");
    expect(functionTrapCalls).toBe(0);

    let revokedTrapCalls = 0;
    const revoked = Proxy.revocable({}, {
      getPrototypeOf() {
        revokedTrapCalls += 1;
        throw new Error("a revoked Proxy trap ran");
      },
    });
    revoked.revoke();
    expect(() => canonicalJson(revoked.proxy)).toThrow("must not be a Proxy");
    expect(revokedTrapCalls).toBe(0);

    const revokedDomain = Proxy.revocable({}, {});
    revokedDomain.revoke();
    expect(() => domainSeparatedId(revokedDomain.proxy as never, {})).toThrow(
      "must not be a Proxy",
    );
    const revokedComparison = Proxy.revocable({}, {});
    revokedComparison.revoke();
    expect(() =>
      compareUnicode("safe", revokedComparison.proxy as never),
    ).toThrow("must not be Proxy");

    let byteTrapCalls = 0;
    const byteTrap = () => {
      byteTrapCalls += 1;
      throw new Error("a byte Proxy trap ran");
    };
    const byteProxy = new Proxy(new Uint8Array([1, 2, 3]), {
      get: byteTrap,
      getOwnPropertyDescriptor: byteTrap,
      getPrototypeOf: byteTrap,
      ownKeys: byteTrap,
    });
    expect(() => sha256Id(byteProxy)).toThrow("must not be a Proxy");
    expect(byteTrapCalls).toBe(0);

    const revokedBytes = Proxy.revocable(new Uint8Array([1, 2, 3]), {});
    revokedBytes.revoke();
    expect(() => sha256Id(revokedBytes.proxy)).toThrow("must not be a Proxy");
    expect(() => sha256Id({} as never)).toThrow("genuine Uint8Array");
    expect(() => sha256Id("\ud800")).toThrow("malformed Unicode");

    let subclassTrapCalls = 0;
    class HostileBytes extends Uint8Array {
      get [Symbol.iterator](): never {
        subclassTrapCalls += 1;
        throw new Error("a byte-subclass iterator ran");
      }

      get buffer(): never {
        subclassTrapCalls += 1;
        throw new Error("a byte-subclass getter ran");
      }

      get byteOffset(): never {
        subclassTrapCalls += 1;
        throw new Error("a byte-subclass getter ran");
      }

      get byteLength(): never {
        subclassTrapCalls += 1;
        throw new Error("a byte-subclass getter ran");
      }
    }
    expect(sha256Id(new HostileBytes([1, 2, 3]))).toBe(
      sha256Id(new Uint8Array([1, 2, 3])),
    );
    expect(subclassTrapCalls).toBe(0);

    const detachedBytes = new Uint8Array([1, 2, 3]);
    structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] });
    expect(() => sha256Id(detachedBytes)).toThrow("could not be copied");
  });

  test("keeps the documented 64 by 64 proposal maximum constructible", () => {
    const boundedId = (prefix: string, index: number, length = 160) => {
      const head = `${prefix}${String(index).padStart(2, "0")}.`;
      return `${head}${"a".repeat(length - head.length)}`;
    };
    const claimIds = Array.from({ length: 64 }, (_, index) =>
      boundedId("claim", index),
    );
    const source = createDeepSeekSourceBinding({
      subject: {
        label: "界".repeat(200),
        evidence: {
          origin: "deepseek_github",
          resource_kind: "code_repository",
          repository_id: "deepseek-ai/DeepSeek-R1",
          revision: "0cf78561f1d51c84a21b2190626b21116d5c68bb",
          path: "界".repeat(512),
          sha256: `sha256:${"a".repeat(64)}`,
          observed_on: "2026-08-01",
        },
      },
      license: {
        scope: "mixed_repository",
        declared_expression: null,
        evidence: null,
        review_status: "not_reviewed",
      },
      claims: claimIds.map((claim_id) => ({
        claim_id,
        claim_kind: "capability" as const,
        summary: "界".repeat(280),
        source_anchor: "界".repeat(160),
      })),
    });
    const proposal = createDeepSeekKingdomProposal({
      proposal_key: boundedId("proposal", 0, 200),
      source,
      target: {
        consumer: {
          kind: "kingdom_extension",
          id: boundedId("consumer", 0),
        },
        kingdom_snapshot_sha256: `sha256:${"b".repeat(64)}`,
      },
      candidates: Array.from({ length: 64 }, (_, index) => ({
        candidate_id: boundedId("candidate", index),
        candidate_kind: "model_candidate" as const,
        lane: "reasoning" as const,
        title: "界".repeat(200),
        claim_refs: claimIds,
      })),
    });
    const encoded = canonicalJson(proposal);
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThan(2 * 1024 * 1024);
    expect(proposal.delta.candidates).toHaveLength(64);
    expect(proposal.delta.candidates[0]?.claim_refs).toHaveLength(64);
    expect(
      createDeepSeekAfterglowThread({ proposal, disposition: "park" }).state,
    ).toBe("proposed_unaccepted");
  });

  test("deep-freezes validated data without invoking accessors", () => {
    const value = { nested: [{ ok: true }] };
    expect(deepFreeze(value)).toBe(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(Object.isFrozen(value.nested[0])).toBe(true);

    let getterCalled = false;
    const hostile = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "must-not-run";
      },
    });
    expect(() => deepFreeze(hostile)).toThrow("own enumerable data property");
    expect(getterCalled).toBe(false);
  });

  test("accepts null-prototype data while preserving canonical bytes", () => {
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, "b", {
      value: 2,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(value, "a", {
      value: 1,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(canonicalJson(value)).toBe('{"a":1,"b":2}');
  });
});
