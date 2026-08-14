import { describe, expect, test } from "bun:test";

import {
  MAX_HASH_INPUT_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_STRING_BYTES,
  MathCardError,
  canonicalJson,
  createMathCard,
  sha256Id,
} from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

function readyInput(): Record<string, any> {
  return jsonClone(vectors.cases.ready_proof.input);
}

describe("hostile and bounded input handling", () => {
  test("rejects Proxy without executing traps", () => {
    let traps = 0;
    const trap = () => { traps += 1; throw new Error("trap executed"); };
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(() => createMathCard(hostile)).toThrow(MathCardError);
    expect(traps).toBe(0);
  });

  test("rejects accessors, cycles, custom prototypes, sparse arrays, and symbols", () => {
    const accessor = readyInput();
    Object.defineProperty(accessor, "question_ref", { enumerable: true, get: () => sha256Id("getter") });
    expect(() => createMathCard(accessor)).toThrow(/data property/u);

    const cycle = readyInput();
    cycle.loop = cycle;
    expect(() => createMathCard(cycle)).toThrow(/cycles/u);

    const custom = Object.assign(Object.create({ inherited: true }), readyInput());
    expect(() => createMathCard(custom)).toThrow(/plain object/u);

    const sparse = readyInput();
    sparse.outcome_uses = new Array(5);
    sparse.outcome_uses[4] = readyInput().outcome_uses[4];
    expect(() => createMathCard(sparse)).toThrow(/dense Array/u);

    const symbol = readyInput();
    symbol[Symbol("hidden")] = true;
    expect(() => createMathCard(symbol)).toThrow(/symbol property/u);
  });

  test("does not coerce values and rejects malformed Unicode", () => {
    const coercion = readyInput();
    coercion.question_ref = new String(coercion.question_ref);
    expect(() => createMathCard(coercion)).toThrow(/plain object|standard Array/u);

    const malformed = readyInput();
    malformed.question_ref = `sha256:${"0".repeat(63)}\ud800`;
    expect(() => createMathCard(malformed)).toThrow(/malformed Unicode/u);
  });

  test("enforces string, hash, depth, node, and total-reference bounds", () => {
    expect(() => canonicalJson("x".repeat(MAX_STRING_BYTES + 1))).toThrow(/string byte bound/u);
    expect(() => sha256Id("x".repeat(MAX_HASH_INPUT_BYTES + 1))).toThrow(/hash input exceeds/u);
    expect(() => sha256Id(new Uint8Array(MAX_HASH_INPUT_BYTES + 1))).toThrow(/hash input exceeds/u);

    let deep: any = null;
    for (let index = 0; index < MAX_JSON_DEPTH + 2; index += 1) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow(/deeply nested/u);
    expect(() => canonicalJson(Array.from({ length: MAX_JSON_NODES + 1 }, () => null))).toThrow(/dense Array|too many/u);

    const excessive = readyInput();
    excessive.question_frame.posture = "model_comparison_or_identification";
    excessive.method = {
      kind: "model",
      model_ref: sha256Id("budget:model"),
      assumption_refs: Array.from({ length: 64 }, (_, index) => sha256Id(`budget:a:${index}`)),
      comparison_or_identification_ref: sha256Id("budget:comparison"),
      revision_or_falsifier_refs: Array.from({ length: 64 }, (_, index) => sha256Id(`budget:f:${index}`)),
    };
    excessive.revision_and_stop.revision_or_challenge_refs = Array.from(
      { length: 64 },
      (_, index) => sha256Id(`budget:r:${index}`),
    );
    excessive.authority.declared_scope_refs = Array.from(
      { length: 64 },
      (_, index) => sha256Id(`budget:s:${index}`),
    );
    expect(() => createMathCard(excessive)).toThrow(/more than 256 digest references/u);
  });

  test("turns detached Uint8Array failures into typed protocol errors", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    structuredClone(bytes, { transfer: [bytes.buffer] });
    try {
      sha256Id(bytes);
      throw new Error("detached bytes unexpectedly hashed");
    } catch (error) {
      expect(error).toBeInstanceOf(MathCardError);
      expect((error as MathCardError).code).toBe("invalid_input");
    }
  });
});
