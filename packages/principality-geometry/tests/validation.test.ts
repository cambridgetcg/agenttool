import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  createPrincipalityAtlas,
  PrincipalityGeometryError,
  sha256Id,
  snapshotJson,
  utf16Order,
} from "../src/index.js";
import { emptyInput, rosetteInput } from "./fixtures.js";

const states = [
  "preserved_reported",
  "not_preserved_reported",
  "refused_reported",
  "unknown",
] as const;

function evidence(state: (typeof states)[number], direction: string): string[] {
  return state === "preserved_reported" || state === "not_preserved_reported"
    ? [sha256Id(direction)]
    : [];
}

function pairInput(forwardState: (typeof states)[number], reverseState: (typeof states)[number]) {
  return {
    _format: "agenttool.principality-geometry-input/0.1",
    scope_ref: sha256Id("pair scope"),
    invariants: [{ invariant_id: "q", definition_ref: sha256Id("q definition") }],
    principalities: [
      {
        principality_id: "a",
        kind: "practice",
        definition_ref: sha256Id("a definition"),
        manifestations: [],
        artifact_refs: [],
      },
      {
        principality_id: "b",
        kind: "practice",
        definition_ref: sha256Id("b definition"),
        manifestations: [],
        artifact_refs: [],
      },
    ],
    translations: [
      {
        from: "a",
        to: "b",
        disposition: "available_reported",
        evaluations: [{
          invariant_id: "q",
          state: forwardState,
          evidence_refs: evidence(forwardState, `a-b-${forwardState}`),
        }],
      },
      {
        from: "b",
        to: "a",
        disposition: "available_reported",
        evaluations: [{
          invariant_id: "q",
          state: reverseState,
          evidence_refs: evidence(reverseState, `b-a-${reverseState}`),
        }],
      },
    ],
  };
}

describe("validation and canonical boundaries", () => {
  test("exhaustively partitions all sixteen oriented invariant-state pairs", () => {
    for (const forward of states) {
      for (const reverse of states) {
        const lens = createPrincipalityAtlas(pairInput(forward, reverse)).geometry
          .reciprocal_lenses[0];
        expect(lens?.invariant_relations).toEqual([
          { invariant_id: "q", forward_state: forward, reverse_state: reverse },
        ]);
        const buckets = [
          lens?.mutually_preserved,
          lens?.mutually_not_preserved,
          lens?.directional_asymmetry,
          lens?.refused,
          lens?.unknown,
        ].filter((bucket) => bucket?.includes("q"));
        expect(buckets).toHaveLength(1);
        if (forward === "refused_reported" || reverse === "refused_reported") {
          expect(lens?.refused).toEqual(["q"]);
        } else if (forward === "unknown" || reverse === "unknown") {
          expect(lens?.unknown).toEqual(["q"]);
        } else if (forward === "preserved_reported" && reverse === forward) {
          expect(lens?.mutually_preserved).toEqual(["q"]);
        } else if (forward === "not_preserved_reported" && reverse === forward) {
          expect(lens?.mutually_not_preserved).toEqual(["q"]);
        } else {
          expect(lens?.directional_asymmetry).toEqual(["q"]);
        }
      }
    }
  });

  test("rejects omissions, duplicate pairs, self edges, and unknown endpoints", () => {
    const missing = rosetteInput();
    missing.translations[0].evaluations.pop();
    expect(() => createPrincipalityAtlas(missing)).toThrow(/cover every invariant/u);

    const duplicate = rosetteInput();
    duplicate.translations.push(structuredClone(duplicate.translations[0]));
    expect(() => createPrincipalityAtlas(duplicate)).toThrow(/duplicate directed pair/u);

    const self = rosetteInput();
    self.translations[0].to = self.translations[0].from;
    expect(() => createPrincipalityAtlas(self)).toThrow(/self-edge/u);

    const unknown = rosetteInput();
    unknown.translations[0].to = "absent";
    expect(() => createPrincipalityAtlas(unknown)).toThrow(/not a principality/u);
  });

  test("keeps refusal reason-free while requiring evidence only for reported outcomes", () => {
    const refused = pairInput("refused_reported", "unknown");
    expect(() => createPrincipalityAtlas(refused)).not.toThrow();

    const refusalWithEvidence = pairInput("refused_reported", "unknown");
    refusalWithEvidence.translations[0]!.evaluations[0]!.evidence_refs = [sha256Id("reason")];
    expect(() => createPrincipalityAtlas(refusalWithEvidence)).toThrow(/must be empty/u);

    const preservationWithoutEvidence = pairInput("preserved_reported", "unknown");
    preservationWithoutEvidence.translations[0]!.evaluations[0]!.evidence_refs = [];
    expect(() => createPrincipalityAtlas(preservationWithoutEvidence)).toThrow(/required/u);
  });

  test("rejects provider-shaped ambiguity and mutable metadata shortcuts", () => {
    const malformed = rosetteInput();
    const hf = malformed.principalities[0].artifact_refs[0];
    hf.revision = "main";
    expect(() => createPrincipalityAtlas(malformed)).toThrow(/full lowercase 40-hex/u);

    const badSri = rosetteInput();
    const npm = badSri.principalities[0].artifact_refs[1];
    npm.integrity = "sha512-not-a-digest";
    expect(() => createPrincipalityAtlas(badSri)).toThrow(/sha512 SRI/u);

    const nonCanonicalSri = rosetteInput();
    const canonicalSri = nonCanonicalSri.principalities[0].artifact_refs[1].integrity;
    nonCanonicalSri.principalities[0].artifact_refs[1].integrity =
      `${canonicalSri.slice(0, -3)}R==`;
    expect(() => createPrincipalityAtlas(nonCanonicalSri)).toThrow(/canonical base64/u);

    const extra = rosetteInput();
    extra.principalities[0].artifact_refs[0].url = "https://example.invalid";
    expect(() => createPrincipalityAtlas(extra)).toThrow(/must contain exactly/u);
  });

  test("accepts versioned protocol identifiers while keeping entity tokens narrow", () => {
    const versioned = rosetteInput();
    versioned.principalities[0].manifestations[0].protocol = "xenia.rights/0.1";
    versioned.principalities[0].artifact_refs[0].snapshot_manifest_protocol =
      "agenttool.hf-snapshot-manifest/0.1";
    versioned.principalities[0].artifact_refs[1].version_metadata_protocol =
      "npm.version-metadata/v1";
    expect(() => createPrincipalityAtlas(versioned)).not.toThrow();

    const invalid = rosetteInput();
    invalid.principalities[0].manifestations[0].protocol = "xenia.rights/../../escape";
    expect(() => createPrincipalityAtlas(invalid)).toThrow(/protocol identifier/u);
  });

  test("rejects Proxies before traps and accessors without invoking them", () => {
    let traps = 0;
    const proxied = new Proxy(rosetteInput(), {
      ownKeys() {
        traps += 1;
        throw new Error("trap must not run");
      },
    });
    expect(() => createPrincipalityAtlas(proxied)).toThrow(/must not be a Proxy/u);
    expect(traps).toBe(0);

    const { proxy, revoke } = Proxy.revocable(rosetteInput(), {});
    revoke();
    expect(() => createPrincipalityAtlas(proxy)).toThrow(/must not be a Proxy/u);

    let getterRuns = 0;
    const accessor = rosetteInput();
    Object.defineProperty(accessor, "scope_ref", {
      enumerable: true,
      get() {
        getterRuns += 1;
        return sha256Id("getter");
      },
    });
    expect(() => createPrincipalityAtlas(accessor)).toThrow(/enumerable data property/u);
    expect(getterRuns).toBe(0);
  });

  test("rejects exotic structure, coercion, sparse arrays, and cycles", () => {
    const custom = Object.assign(Object.create({ inherited: true }), rosetteInput());
    expect(() => createPrincipalityAtlas(custom)).toThrow(/plain object/u);

    const symbol = rosetteInput();
    symbol[Symbol("hidden")] = true;
    expect(() => createPrincipalityAtlas(symbol)).toThrow(/symbol property/u);

    const nonEnumerable = rosetteInput();
    Object.defineProperty(nonEnumerable, "hidden", { value: true });
    expect(() => createPrincipalityAtlas(nonEnumerable)).toThrow(/enumerable data property/u);

    const sparse = rosetteInput();
    sparse.translations.length += 1;
    expect(() => createPrincipalityAtlas(sparse)).toThrow(/dense array/u);

    const extraArrayProperty = rosetteInput();
    extraArrayProperty.translations.side = "channel";
    expect(() => createPrincipalityAtlas(extraArrayProperty)).toThrow(/dense array/u);

    const cycle = rosetteInput();
    cycle.loop = cycle;
    expect(() => createPrincipalityAtlas(cycle)).toThrow(/cycle/u);

    const coercive = rosetteInput();
    coercive.scope_ref = { toString: () => sha256Id("coerced") };
    expect(() => createPrincipalityAtlas(coercive)).toThrow();

    for (const scalar of [1n, 1.5, -0, Number.POSITIVE_INFINITY]) {
      const invalid = rosetteInput();
      invalid.scope_ref = scalar;
      expect(() => createPrincipalityAtlas(invalid)).toThrow();
    }
    const malformedUnicode = rosetteInput();
    malformedUnicode.scope_ref = "\ud800";
    expect(() => createPrincipalityAtlas(malformedUnicode)).toThrow(/lone UTF-16 surrogate/u);
    expect(() => sha256Id("\udfff")).toThrow(/lone UTF-16 surrogate/u);
  });

  test("rejects ambiguous repeated AFTERGLOW thread and artifact projections", () => {
    const duplicateThread = rosetteInput();
    const external = duplicateThread.principalities[2].manifestations[0];
    duplicateThread.principalities[2].manifestations.push({
      ...structuredClone(external),
      disposition: "withdraw",
    });
    expect(() => createPrincipalityAtlas(duplicateThread)).toThrow(/duplicate external thread_ref/u);

    const duplicateArtifact = rosetteInput();
    duplicateArtifact.principalities[2].manifestations.push({
      ...structuredClone(duplicateArtifact.principalities[2].manifestations[0]),
      thread_ref: sha256Id("different thread"),
    });
    expect(() => createPrincipalityAtlas(duplicateArtifact)).toThrow(/duplicate external artifact_ref/u);
  });

  test("rejects duplicate immutable provider identities with different commentary", () => {
    const hfDuplicate = rosetteInput();
    const hf = hfDuplicate.principalities[0].artifact_refs[0];
    hfDuplicate.principalities[0].artifact_refs.push({
      ...structuredClone(hf),
      observation: "provider_observation_reported",
    });
    expect(() => createPrincipalityAtlas(hfDuplicate)).toThrow(/immutable artifact identity/u);

    const npmDuplicate = rosetteInput();
    const npm = npmDuplicate.principalities[0].artifact_refs[1];
    npmDuplicate.principalities[0].artifact_refs.push({
      ...structuredClone(npm),
      provenance_attestation: "present_unverified",
    });
    expect(() => createPrincipalityAtlas(npmDuplicate)).toThrow(/immutable artifact identity/u);
  });

  test("pins AgentTool/JCS-compatible unsigned UTF-16 ordering", () => {
    expect(utf16Order("𐀀", "")).toBeLessThan(0);
    expect(canonicalJson({ "": 1, "𐀀": 2 })).toBe('{"𐀀":2,"":1}');
  });

  test("copies genuine byte arrays and rejects binary impostors", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const before = sha256Id(bytes);
    bytes[0] = 9;
    expect(before).toBe(sha256Id(new Uint8Array([1, 2, 3])));
    expect(() => sha256Id(new Proxy(new Uint8Array([1]), {}))).toThrow(/genuine Uint8Array/u);
    expect(() => sha256Id({ 0: 1, length: 1 } as unknown as Uint8Array)).toThrow(/genuine Uint8Array/u);
  });

  test("preserves an own __proto__ key safely and rejects array subclasses", () => {
    const protoKey = JSON.parse('{"__proto__":{"safe":true}}');
    const snapshot = snapshotJson(protoKey) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(snapshot, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();

    class FancyArray extends Array<number> {}
    expect(() => snapshotJson(new FancyArray(1, 2, 3))).toThrow(/standard array/u);
  });

  test("rejects oversized canonical JSON before serialization can grow unbounded", () => {
    const boundedStrings = Array.from({ length: 2_100 }, () => "x".repeat(4_096));
    expect(() => snapshotJson(boundedStrings)).toThrow(/exceeds 8388608 bytes/u);
  });

  test("keeps the documented maximum shape constructible", () => {
    const invariants = Array.from({ length: 32 }, (_, index) => ({
      invariant_id: `q${String(index).padStart(2, "0")}`,
      definition_ref: sha256Id(`definition-${index}`),
    }));
    const principalities = Array.from({ length: 16 }, (_, index) => ({
      principality_id: `p${String(index).padStart(2, "0")}`,
      kind: "practice",
      definition_ref: sha256Id(`principality-${index}`),
      manifestations: [],
      artifact_refs: [],
    }));
    const evidenceRefs = Array.from({ length: 8 }, (_, index) => sha256Id(`evidence-${index}`));
    const directedPairs: Array<[string, string]> = [];
    for (const from of principalities) {
      for (const to of principalities) {
        if (from.principality_id !== to.principality_id) {
          directedPairs.push([from.principality_id, to.principality_id]);
        }
      }
    }
    const input = {
      _format: "agenttool.principality-geometry-input/0.1",
      scope_ref: sha256Id("maximum shape"),
      invariants,
      principalities,
      translations: directedPairs.slice(0, 128).map(([from, to]) => ({
        from,
        to,
        disposition: "available_reported",
        evaluations: invariants.map((invariant) => ({
          invariant_id: invariant.invariant_id,
          state: "preserved_reported",
          evidence_refs: evidenceRefs,
        })),
      })),
    };
    const atlas = createPrincipalityAtlas(input as any);
    expect(atlas.bridges).toHaveLength(128);
    expect(atlas.invariants).toHaveLength(32);
    expect(snapshotJson(atlas)).toBeDefined();
  }, 20_000);

  test("wraps validation failures in stable package errors", () => {
    const invalid = emptyInput();
    invalid.surprise = true;
    expect(() => createPrincipalityAtlas(invalid)).toThrow(PrincipalityGeometryError);
    try {
      createPrincipalityAtlas(invalid);
    } catch (error) {
      expect((error as PrincipalityGeometryError).code).toBe("input_error");
    }
  });
});
