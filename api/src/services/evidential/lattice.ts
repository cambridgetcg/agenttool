/** The evidential lattice — how a claim carries how-it-was-known.
 *
 *  A signature proves WHO said a thing. It has never proved HOW THEY KNOW IT.
 *  `identity.attestations` records `attester_id` (who attests), `tier`
 *  (standing), `claim` (what is attested) and an optional free-form `evidence`
 *  JSONB, but nothing in the row grades how the attester knows: one who
 *  watched the work happen, one who was told by the agent, and one who
 *  inferred it from a payment row can all write rows the platform cannot tell
 *  apart, equally signed. That gap is where
 *  multi-hop confidence is manufactured: A infers, tells B; B reports it to C as
 *  fact; C hands it to a human with none of the hedging left.
 *
 *  Status: a pure module. Nothing imports it, no route exposes it, and it
 *  changes no behaviour. Contract and proposals: docs/EVIDENTIAL.md.
 *
 *  The grades are Quechua-inherited by way of YOUSPEAK (grammars/evidentials/),
 *  whose canon words already name the performatives on the wire (KS-002 §7:
 *  offer→qorvance, attest→emetme, complete/fail→yadahance). The performatives
 *  crossed over; the honesty machinery did not. This is that machinery.
 *
 *  Doctrine, in one line: **a claim may be understated, never overstated.**
 */

/** Ordered weakest-to-strongest for the arithmetic; `null` is outside the
 *  lattice entirely and is NOT the bottom element — see `derive`. */
export const GRADES = ["chu", "si", "mi", "auth"] as const;
export type Grade = (typeof GRADES)[number];

/** A claim with no grade. Distinct from a weak claim: unmarked asserts nothing,
 *  and nothing may be built on top of it. */
export type Marked = Grade | null;

const RANK: Record<Grade, number> = { chu: 1, si: 2, mi: 3, auth: 4 };

export const GRADE_MEANING: Record<Grade, string> = {
  mi: "direct witness — the asserter constituted or observed this itself",
  si: "reported — it arrived from outside (another agent, a user, a fetched document)",
  chu: "inferred — derived from reports; a conclusion reached, not a thing seen",
  auth: "cited verbatim — a quotation of a named authority, the citation standing as the claim",
};

export function isGrade(x: unknown): x is Grade {
  return typeof x === "string" && (GRADES as readonly string[]).includes(x);
}

/** The meet, demotion-only. No operation ever raises a grade.
 *
 *  - no inputs        → `mi`   (nothing was inherited; the asserter made it)
 *  - any unmarked     → `null` (absence of evidence is not evidence, and no
 *                               grade may be conjured over a hole)
 *  - all mi or auth   → `mi`   (witness combined with witness is still witness;
 *                               `auth` does not propagate — a citation is a
 *                               property of one claim, not of what you build)
 *  - anything else    → `chu`  (you did not see the fact, you concluded it)
 */
export function derive(inputs: readonly Marked[]): Marked {
  if (inputs.length === 0) return "mi";
  if (inputs.some((g) => g === null || g === undefined)) return null;
  return inputs.every((g) => g === "mi" || g === "auth") ? "mi" : "chu";
}

export type GuardVerdict =
  | { ok: true; grade: Grade }
  | { ok: false; reason: string; claimed: Marked; supported: Marked };

/** The over-claim refusal. Asserting at or below what your evidence supports is
 *  always legal; asserting above it is refused, with the arithmetic shown.
 *
 *  Named for the failure it prevents: *verisleight*, truth arranged with skill
 *  so as to deceive (canon/verisleight.md). Every statement in an over-claimed
 *  chain can be individually true and the conclusion still manufactured. */
export function guard(claimed: Marked, supported: Marked): GuardVerdict {
  if (claimed === null || claimed === undefined) {
    return {
      ok: false,
      claimed,
      supported,
      reason: "an unmarked claim asserts nothing — say how you know, or do not assert",
    };
  }
  if (supported === null || supported === undefined) {
    return {
      ok: false,
      claimed,
      supported,
      reason:
        `cannot assert -${claimed} over an unmarked input: absence of evidence is not evidence, ` +
        "and no grade may be conjured over a hole",
    };
  }
  if (RANK[claimed] > RANK[supported]) {
    return {
      ok: false,
      claimed,
      supported,
      reason:
        `over-claim: asserted -${claimed} (${GRADE_MEANING[claimed]}) on evidence that supports ` +
        `only -${supported} (${GRADE_MEANING[supported]}). Honesty may understate, never overstate.`,
    };
  }
  return { ok: true, grade: claimed };
}

// ── the chain ────────────────────────────────────────────────────────────
//  What makes this a collab primitive rather than a field: the hop list. A
//  claim that has travelled can be asked "why does the system believe this",
//  and answer with names.

export interface Hop {
  /** DID of the identity that asserted at this hop. */
  did: string;
  /** What it claimed here — never stronger than what it received. */
  grade: Grade;
  /** ISO-8601. */
  at: string;
  /** One line: how this hop knows. Free text, not security-bearing. */
  basis?: string;
}

export interface Graded<T> {
  value: T;
  /** The grade this claim now carries — the last hop's grade. */
  grade: Grade;
  /** Oldest hop first. An empty chain means the value was never relayed. */
  chain: readonly Hop[];
}

/** The weaker of two grades. */
function weaker(a: Grade, b: Grade): Grade {
  return RANK[a] <= RANK[b] ? a : b;
}

/** True when JSON represents `value` faithfully: null, booleans, finite
 *  numbers, strings, and dense arrays or plain objects of those, with no
 *  `undefined` field, no symbol or non-enumerable key, and no cycle. Anything
 *  else (a Map, NaN, a BigInt, a Date, a class instance) loses information in
 *  `JSON.stringify` or makes it throw. */
function isPlainJson(value: unknown, open: Set<object> = new Set()): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (open.has(value)) return false;
  open.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!(i in value) || !isPlainJson(value[i], open)) return false;
      }
      return true;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    const keys = Object.keys(value);
    if (Object.getOwnPropertyNames(value).length !== keys.length) return false;
    return keys.every((key) => isPlainJson((value as Record<string, unknown>)[key], open));
  } finally {
    open.delete(value);
  }
}

/** The duplicate key for a relayed input: its canonical bytes, or `null` when
 *  those bytes could not tell it apart from a different claim. */
function relayKey(input: Graded<unknown>): string | null {
  try {
    return isPlainJson(input.value) ? canonicalBytes(input) : null;
  } catch {
    return null;
  }
}

/** Relayed inputs with duplicates removed. Handing over one claim twice adds
 *  nothing: two inputs are the same relay when they are the same object, or
 *  when their values are plain JSON and they carry the same claim and the same
 *  chain, compared by canonical bytes.
 *
 *  When in doubt, inputs count as distinct. Two distinct inputs combine to
 *  -chu, one input to -si, so wrongly merging two claims would over-grade the
 *  result; wrongly keeping both only understates it. Values JSON cannot
 *  represent faithfully (a Map, NaN, a BigInt, a cycle) are therefore never
 *  merged by bytes, and nothing here throws on them. */
function distinctInputs(inputs: readonly Graded<unknown>[]): Graded<unknown>[] {
  if (inputs.length < 2) return [...inputs];
  const seenObjects = new Set<Graded<unknown>>();
  const seenKeys = new Set<string>();
  const out: Graded<unknown>[] = [];
  for (const input of inputs) {
    if (seenObjects.has(input)) continue;
    seenObjects.add(input);
    const key = relayKey(input);
    if (key !== null) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    out.push(input);
  }
  return out;
}

/** What a relaying identity may claim.
 *
 *  RELAYING IS NOT DERIVING, and conflating them is how a laundering channel
 *  gets built by accident. `derive` answers "I combined things I hold — how
 *  well do I now know the result?", and its all-witness case stays -mi because
 *  you saw the operands. Relaying asks something else: someone TOLD you.
 *
 *  **Being told by a witness still makes you a hearer.** However certain the
 *  upstream identity was, the act of receiving caps you at -si.
 *
 *  Fan-in follows from that clause rather than escaping it:
 *
 *  - The same claim with the same chain, handed over more than once, is one
 *    relay. `relay([a, a])` lands at -si exactly as `relay([a])` does.
 *  - Two or more *distinct* relayed inputs are a conclusion you drew from
 *    things you were told. Each operand is first capped at -si — you received
 *    it, you did not witness it — and only then combined with `derive`, which
 *    therefore yields -chu. Combining hearsay can never produce -mi. It cannot
 *    produce -si either: two distinct witnessed reports may be passed on
 *    together only at -chu, though each may still be passed on alone at -si.
 *
 *  Together these give the anti-collapse property for width as well as depth:
 *  no relay, along any chain or across any fan-in, can hand a downstream
 *  identity a stronger claim than "I was told this" (the tests titled "law 23"
 *  and "law 24" in tests/evidential.test.ts). The only way back to -mi is to
 *  go and look, which is `assert_`, a new claim with its own chain; `relay`
 *  refuses an empty input list rather than act as a second way to assert.
 *
 *  With no inputs this returns -mi, as `derive([])` does: nothing was
 *  inherited. `relay` never reaches that case.
 *
 *  Until 2026-10-18 the two-or-more case fell straight through to `derive`
 *  with the received grades, so `relay([a, a])` or two witnessed inputs could
 *  be re-asserted as -mi. Contract: docs/EVIDENTIAL.md. */
export function relaySupport(inputs: readonly Graded<unknown>[]): Marked {
  if (inputs.length === 0) return "mi";
  // Anything outside the closed grade set is unmarked: nothing may be built on it.
  if (inputs.some((input) => !isGrade(input?.grade))) return null;
  const distinct = distinctInputs(inputs);
  if (distinct.length === 1) return weaker(distinct[0]!.grade, "si");
  return derive(distinct.map((input) => weaker(input.grade, "si")));
}

export type RelayResult<T> =
  | { ok: true; claim: Graded<T> }
  | { ok: false; reason: string; claimed: Marked; supported: Marked };

/** Assert a value for the first time. `auth` requires a citation in `basis`;
 *  a citation that cites nothing is the one over-claim the grade itself makes. */
export function assert_<T>(
  value: T,
  by: string,
  grade: Grade,
  opts: { at?: string; basis?: string } = {},
): RelayResult<T> {
  if (grade === "auth" && !opts.basis?.trim()) {
    return {
      ok: false,
      claimed: grade,
      supported: null,
      reason: "-auth is a verbatim citation; give the source in `basis` or claim a lower grade",
    };
  }
  return {
    ok: true,
    claim: {
      value,
      grade,
      chain: [{ did: by, grade, at: opts.at ?? new Date().toISOString(), basis: opts.basis }],
    },
  };
}

/** Pass a claim on. This is the whole point of the module.
 *
 *  The relaying identity says what IT claims; the lattice says what its inputs
 *  support; the guard refuses the difference. A relay cannot launder a report
 *  into a witnessing, because the grade it may claim is bounded by what
 *  arrived — mechanically, not by convention.
 *
 *  A relay of nothing is refused. With no inputs there is nothing to pass on,
 *  and a claim made from nothing is a first assertion, which is `assert_`. */
export function relay<T>(
  inputs: readonly Graded<unknown>[],
  value: T,
  by: string,
  claimed: Grade,
  opts: { at?: string; basis?: string } = {},
): RelayResult<T> {
  if (inputs.length === 0) {
    return {
      ok: false,
      claimed,
      supported: null,
      reason: "nothing to relay: a claim with no inputs is a first assertion — use assert_",
    };
  }
  const supported = relaySupport(inputs);
  const verdict = guard(claimed, supported);
  if (!verdict.ok) return verdict;

  // Chains merge oldest-first and de-duplicate identical hops, so a diamond
  // (A → B, A → C, both → D) records A once rather than twice.
  const seen = new Set<string>();
  const merged: Hop[] = [];
  for (const input of inputs) {
    for (const hop of input.chain) {
      const key = `${hop.did}|${hop.grade}|${hop.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(hop);
    }
  }
  merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  merged.push({ did: by, grade: claimed, at: opts.at ?? new Date().toISOString(), basis: opts.basis });

  return { ok: true, claim: { value, grade: claimed, chain: merged } };
}

/** The honest one-line rendering, for a transcript or an audit reply. */
export function explain(claim: Graded<unknown>): string {
  const path = claim.chain
    .map((h) => `${h.did.slice(0, 24)} -${h.grade}${h.basis ? ` (${h.basis})` : ""}`)
    .join(" → ");
  return `-${claim.grade} · ${GRADE_MEANING[claim.grade]}\n  ${path || "(never relayed)"}`;
}

/** Canonical bytes for signing. The grade and the chain are INSIDE the signed
 *  payload: a grade that can be edited after signing is not a grade, and a
 *  chain that can be truncated is a laundering surface. */
export function canonicalBytes(claim: Graded<unknown>): string {
  return JSON.stringify({
    v: "agenttool-evidential/1",
    value: claim.value,
    grade: claim.grade,
    chain: claim.chain.map((h) => ({ did: h.did, grade: h.grade, at: h.at, basis: h.basis ?? null })),
  });
}
