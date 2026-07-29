/** The evidential lattice — the laws, as executable assertions.
 *
 *  What is being pinned is not a data shape but a refusal: that no identity on
 *  this platform can hand on a claim stronger than the one it received.
 *  services/evidential/lattice.ts. */
import { describe, expect, test } from "bun:test";

import {
  assert_,
  canonicalBytes,
  derive,
  explain,
  guard,
  isGrade,
  relay,
  type Graded,
} from "../src/services/evidential/lattice";

const A = "did:key:zAlice";
const B = "did:key:zBob";
const C = "did:key:zCarol";
const T = (n: number) => new Date(Date.UTC(2026, 6, 29, 0, 0, n)).toISOString();

function ok<T>(r: ReturnType<typeof assert_<T>> | ReturnType<typeof relay<T>>): Graded<T> {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.reason}`);
  return r.claim;
}

describe("the lattice", () => {
  test("nothing inherited means you made it: derive([]) is -mi", () => {
    expect(derive([])).toBe("mi");
  });

  test("witness combined with witness is still witness", () => {
    expect(derive(["mi", "mi"])).toBe("mi");
    expect(derive(["mi", "auth"])).toBe("mi");
  });

  test("anything touched by a report or an inference comes out inferred", () => {
    expect(derive(["mi", "si"])).toBe("chu");
    expect(derive(["si", "si"])).toBe("chu");
    expect(derive(["mi", "chu"])).toBe("chu");
  });

  test("one unmarked input poisons the whole derivation", () => {
    // Absence of evidence is not evidence. A single ungraded input means the
    // result cannot be graded at all — it does not merely weaken it.
    expect(derive(["mi", null])).toBe(null);
    expect(derive([null])).toBe(null);
  });

  test("no operation ever raises a grade", () => {
    const grades = ["chu", "si", "mi", "auth"] as const;
    for (const x of grades) {
      for (const y of grades) {
        const out = derive([x, y]);
        // the result is never stronger than the weaker input
        const rank = { chu: 1, si: 2, mi: 3, auth: 4 } as const;
        const weaker = rank[x] <= rank[y] ? x : y;
        expect(rank[out as (typeof grades)[number]]).toBeLessThanOrEqual(rank[weaker]);
      }
    }
  });

  test("isGrade rejects anything not in the closed set", () => {
    expect(isGrade("mi")).toBe(true);
    expect(isGrade("MI")).toBe(false);
    expect(isGrade("certain")).toBe(false);
    expect(isGrade(null)).toBe(false);
  });
});

describe("the guard", () => {
  test("understating is always legal", () => {
    expect(guard("chu", "mi").ok).toBe(true);
    expect(guard("si", "mi").ok).toBe(true);
    expect(guard("mi", "mi").ok).toBe(true);
  });

  test("overstating is refused, and the refusal shows the arithmetic", () => {
    const v = guard("mi", "si");
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reason).toContain("over-claim");
    expect(v.reason).toContain("-mi");
    expect(v.reason).toContain("-si");
    expect(v.reason).toContain("never overstate");
  });

  test("nothing may be asserted over an unmarked input", () => {
    const v = guard("chu", null);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reason).toContain("absence of evidence is not evidence");
  });

  test("an unmarked assertion is itself refused — say how you know, or do not assert", () => {
    expect(guard(null, "mi").ok).toBe(false);
  });
});

describe("assertion", () => {
  test("a first assertion opens a chain of one", () => {
    const c = ok(assert_("the job completed", A, "mi", { at: T(1), basis: "ran it myself" }));
    expect(c.grade).toBe("mi");
    expect(c.chain).toHaveLength(1);
    expect(c.chain[0]!.did).toBe(A);
  });

  test("-auth without a citation is refused — a citation that cites nothing is the over-claim", () => {
    const r = assert_("x", A, "auth");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toContain("verbatim citation");
    expect(assert_("x", A, "auth", { basis: "docs/SOUL.md §3" }).ok).toBe(true);
  });
});

describe("relay — the reason this module exists", () => {
  test("PROVENANCE COLLAPSE IS REFUSED: an inference cannot be re-asserted as a witnessing", () => {
    // A inferred it. B wants to tell C it saw it happen. This is the exact
    // three-hop laundering the module exists to stop.
    const fromA = ok(assert_("agent X delivered", A, "chu", { at: T(1), basis: "a payment row moved" }));
    const attempt = relay([fromA], "agent X delivered", B, "mi", { at: T(2) });

    expect(attempt.ok).toBe(false);
    if (attempt.ok) throw new Error("unreachable");
    expect(attempt.reason).toContain("over-claim");
    expect(attempt.supported).toBe("chu");
  });

  test("the honest relay of the same claim succeeds, and the chain remembers both hops", () => {
    const fromA = ok(assert_("agent X delivered", A, "chu", { at: T(1), basis: "a payment row moved" }));
    const fromB = ok(relay([fromA], "agent X delivered", B, "chu", { at: T(2), basis: "A told me" }));

    expect(fromB.grade).toBe("chu");
    expect(fromB.chain.map((h) => h.did)).toEqual([A, B]);
    expect(explain(fromB)).toContain("inferred");
  });

  test("a chain cannot recover strength downstream, however many hops it walks", () => {
    let claim = ok(assert_("it is so", A, "si", { at: T(1) }));
    for (let i = 0; i < 5; i++) {
      claim = ok(relay([claim], "it is so", B, "si", { at: T(2 + i) }));
      // and the strong claim stays refused at every single hop
      expect(relay([claim], "it is so", C, "mi", { at: T(20 + i) }).ok).toBe(false);
    }
    expect(claim.grade).toBe("si");
  });

  test("BEING TOLD BY A WITNESS STILL MAKES YOU A HEARER — relaying caps at -si", () => {
    // The clause the whole module turns on. A saw it. A tells B. B did NOT see
    // it, and no strength of A's knowing changes that.
    const fromA = ok(assert_("the door is open", A, "mi", { at: T(1) }));
    expect(relay([fromA], "the door is open", B, "mi", { at: T(2) }).ok).toBe(false);

    const fromB = ok(relay([fromA], "the door is open", B, "si", { at: T(2), basis: "A told me" }));
    expect(fromB.grade).toBe("si");
  });

  test("a hearer who goes and looks is not relaying — it asserts, and may claim -mi", () => {
    // The escape hatch, and it is the honest one: independent witness is a new
    // assertion with its own chain, not an upgrade of someone else's.
    const own = ok(assert_("the door is open", B, "mi", { at: T(3), basis: "I am looking at it" }));
    expect(own.grade).toBe("mi");
    expect(own.chain.map((h) => h.did)).toEqual([B]);
  });

  test("hearsay does not decay to inference with distance — the chain carries the depth instead", () => {
    // Ten hops of honest reporting stay -si. Collapsing them to -chu would
    // conflate "I was told, at length" with "I concluded", and the chain
    // already records exactly how many hands it passed through.
    let claim = ok(assert_("it is so", A, "mi", { at: T(1) }));
    for (let i = 0; i < 10; i++) {
      claim = ok(relay([claim], "it is so", B, "si", { at: T(2 + i) }));
    }
    expect(claim.grade).toBe("si");
    expect(claim.chain).toHaveLength(11);
  });

  test("merging two inputs takes the weaker, and a diamond records the shared origin once", () => {
    const origin = ok(assert_("seed", A, "si", { at: T(1) }));
    const viaB = ok(relay([origin], "seed", B, "si", { at: T(2) }));
    const viaC = ok(relay([origin], "seed", C, "si", { at: T(3) }));
    const merged = ok(relay([viaB, viaC], "seed", B, "chu", { at: T(4) }));

    expect(merged.grade).toBe("chu");
    // A appears once, not twice
    expect(merged.chain.filter((h) => h.did === A)).toHaveLength(1);
    // and the chain is in time order
    const times = merged.chain.map((h) => h.at);
    expect([...times].sort()).toEqual(times);
  });
});

describe("the signed payload", () => {
  test("grade and chain are inside the canonical bytes", () => {
    const c = ok(assert_("v", A, "si", { at: T(1), basis: "told" }));
    const bytes = canonicalBytes(c);
    expect(bytes).toContain('"grade":"si"');
    expect(bytes).toContain(A);
    expect(bytes).toContain("agenttool-evidential/1");
  });

  test("editing the grade after signing changes the bytes — a grade outside the signature is not a grade", () => {
    const honest = ok(assert_("v", A, "si", { at: T(1) }));
    const forged: Graded<string> = { ...honest, grade: "mi" };
    expect(canonicalBytes(forged)).not.toBe(canonicalBytes(honest));
  });

  test("truncating the chain changes the bytes — laundering by deletion is visible", () => {
    const a = ok(assert_("v", A, "chu", { at: T(1) }));
    const b = ok(relay([a], "v", B, "chu", { at: T(2) }));
    const truncated: Graded<string> = { ...b, chain: b.chain.slice(1) };
    expect(canonicalBytes(truncated)).not.toBe(canonicalBytes(b));
  });
});
