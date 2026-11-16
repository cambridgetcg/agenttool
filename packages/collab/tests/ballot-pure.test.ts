import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  BALLOT_AUTHORISES,
  BALLOT_BASES,
  BALLOT_COMMITMENT_PROTOCOL,
  BALLOT_SAME_FAMILY_NOTE,
  BALLOT_SEALING,
  BALLOT_SPLIT_NOTE,
  BALLOT_TIE_NEXT,
  MAX_REVEALED_ENTRY_BYTES,
  ballotClosedBy,
  ballotClosesAt,
  ballotCommitment,
  ballotResult,
  ballotUnitId,
  buildElectorate,
  classifyCaster,
  modelFamily,
  nextCastSeq,
  normalizeBallotVoters,
  openSeal,
  resolveCasts,
  revealedEntriesSha256,
  revealedEntryBytes,
  sameVoteInput,
  sealVote,
  unitBasis,
  unitOutcomes,
  validatePollTerms,
  validateVote,
  type BallotResultInput,
  type CastToResolve,
  type ElectorateSession,
  type ElectorateUnit,
  type SealOutcome,
  type SealedVote,
  type SessionLabel,
} from "../src/ballot.js";
import { canonicalJson } from "../src/canonical.js";
import { CollabError } from "../src/errors.js";
import { checkNote, NOTE_BASES, normalizeNoteFields, normalizeNoteText } from "../src/note.js";
import { moduleReach } from "./module-purity.js";

// Sealed approval ballot arithmetic. Contract: Collab Notes build spec,
// revision 2, section 7. Nothing here touches a store, a file or the clock.

const WS = "workspace_ballot_test";
const BALLOT = "report_0b0b0b0b-0000-4000-8000-000000000000";
const JOURNAL = "/journals/collab.sqlite";
const NOW = "2026-11-12T12:00:00.000Z";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function refusal(run: () => unknown): CollabError {
  try {
    run();
  } catch (error) {
    if (error instanceof CollabError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function seat(id: string, voice: string, seatRef: string | null, extra: Partial<ElectorateSession> = {}): ElectorateSession {
  return { session_id: `session_${id}`, voice_id: `session_${voice}`, seat_ref: seatRef, name: id, ...extra };
}

function vote(choice: string[], extra: Partial<SealedVote> = {}): SealedVote {
  return { choice, why: [], evidence: [], ...extra };
}

let castCounter = 0;
function cast(
  units: readonly ElectorateUnit[],
  who: ElectorateSession,
  sealed: SealedVote,
  options: { seal?: "missing" | "tamper" | "garbage"; cast_seq?: number } = {},
): CastToResolve {
  castCounter += 1;
  const cast_id = `00000000-0000-4000-8000-${String(castCounter).padStart(12, "0")}`;
  const { unit_id } = classifyCaster(units, who);
  const salt = sha256(cast_id);
  const commitment = ballotCommitment({ workspace_id: WS, ballot_id: BALLOT, cast_id, unit_id, session_id: who.session_id, vote: sealed, salt });
  const event = { cast_id, unit_id, session_id: who.session_id, commitment, cast_seq: options.cast_seq ?? 1 };
  let seal: SealOutcome;
  if (options.seal === "missing") {
    seal = { state: "seal_missing" };
  } else {
    const fileVote = options.seal === "tamper" ? { ...sealed, choice: sealed.choice.length ? [] : ["a"] } : sealed;
    const file = options.seal === "garbage"
      ? { cast_id, truncated: true }
      : { cast_id, journal_realpath: JOURNAL, session_id: who.session_id, unit_id, salt, vote: fileVote };
    // A seal is read back from disk, so it arrives as parsed JSON.
    seal = openSeal(JSON.parse(JSON.stringify(file)), event, { workspace_id: WS, ballot_id: BALLOT, journal_realpath: JOURNAL });
  }
  return { ...event, voice_id: who.voice_id, seal };
}

const TERMS = {
  options: [
    { key: "a", label: "Alpha" },
    { key: "b", label: "Beta" },
    { key: "c", label: "Gamma" },
  ],
  quorum: 2,
};

function labels(sessions: readonly ElectorateSession[]): Record<string, SessionLabel> {
  return Object.fromEntries(sessions.map((session) => [session.session_id, {
    name: session.name,
    seat_ref: session.seat_ref,
    model: session.model ?? null,
  }]));
}

// Three units: two Claude Code seats and one Codex session with no handle.
const ALPHA = seat("alpha", "alpha", "claude-code:aaaa");
const BETA = seat("beta", "beta", "claude-code:bbbb");
const GAMMA = seat("gamma", "gamma", null);
const THREE = buildElectorate([ALPHA, BETA, GAMMA]).units;

function resultOf(
  units: readonly ElectorateUnit[],
  casts: readonly CastToResolve[],
  sessions: readonly ElectorateSession[],
  extra: Partial<BallotResultInput> = {},
) {
  const entries = resolveCasts(units, casts, { ballot_id: BALLOT });
  return ballotResult({ terms: TERMS, units, entries, withdrawn: false, sessions: labels(sessions), ...extra });
}

describe("purity", () => {
  test("ballot.ts loads no store, filesystem, clock or randomness", () => {
    // Callers pass now, the salt and the cast id, so a reveal on any build
    // recomputes the same commitments and result from the journal alone.
    expect(moduleReach("ballot.ts")).toEqual({
      local: ["ballot.ts", "canonical.ts", "errors.ts", "note.ts"],
      external: ["node:crypto"],
      ambient: [],
    });
  });
});

describe("units", () => {
  test("each voice is a unit, named by the first 32 hex of the sorted voice ids' hash", () => {
    const { units } = buildElectorate([seat("a", "a", "claude-code:1"), seat("b", "b", "claude-code:2")]);
    expect(units).toHaveLength(2);
    for (const unit of units) {
      expect(unit.unit_id).toBe(`unit_${sha256(canonicalJson([...unit.voice_ids].sort())).slice(0, 32)}`);
      expect(unit.unit_id).toMatch(/^unit_[0-9a-f]{32}$/);
    }
    expect(ballotUnitId(["session_b", "session_a"])).toBe(ballotUnitId(["session_a", "session_b", "session_a"]));
  });

  test("a parent and its attested child share one voice and so one unit", () => {
    const { units } = buildElectorate([
      seat("parent", "parent", "claude-code:p"),
      seat("child", "parent", "claude-code:p", { name: "parent/review" }),
      seat("other", "other", null),
    ]);
    const shared = units.find((unit) => unit.voice_ids.includes("session_parent"));
    expect(shared?.session_ids).toEqual(["session_child", "session_parent"]);
    expect(shared?.voice_ids).toEqual(["session_parent"]);
    expect(shared?.names).toEqual(["parent", "parent/review"]);
  });

  test("voices that declared the same handle merge, through a chain of shared handles", () => {
    const { units } = buildElectorate([
      seat("a", "a", "claude-code:x"),
      seat("b1", "b", "claude-code:x"),
      seat("b2", "b", "codex:y"),
      seat("c", "c", "codex:y"),
      seat("d", "d", "claude-code:z"),
    ]);
    expect(units).toHaveLength(2);
    const chain = units.find((unit) => unit.voice_ids.length === 3);
    expect(chain?.voice_ids).toEqual(["session_a", "session_b", "session_c"]);
    expect(chain?.seat_refs).toEqual(["claude-code:x", "codex:y"]);
    expect(chain?.unit_id).toBe(ballotUnitId(["session_a", "session_b", "session_c"]));
  });

  test("sessions with no handle never merge, and an empty handle counts as none", () => {
    const { units } = buildElectorate([seat("a", "a", null), seat("b", "b", null), seat("c", "c", "")]);
    expect(units).toHaveLength(3);
    expect(units.every((unit) => unit.seat_refs.length === 0)).toBe(true);
  });

  test("units and the electorate hash do not depend on the order sessions arrive in", () => {
    const sessions = [
      seat("a", "a", "claude-code:x"),
      seat("b", "b", "claude-code:x"),
      seat("c", "c", null, { model: "gpt-5-codex" }),
    ];
    const forward = buildElectorate(sessions);
    const backward = buildElectorate([...sessions].reverse());
    expect(backward).toEqual(forward);
    expect(forward.electorate_sha256).toBe(sha256(canonicalJson(forward.units)));
    const fewer = buildElectorate(sessions.slice(1));
    expect(fewer.electorate_sha256).not.toBe(forward.electorate_sha256);
  });

  test("a unit carries its declared model, or every model when its sessions disagree", () => {
    const { units } = buildElectorate([
      seat("a", "a", "claude-code:x", { model: "claude-opus-5.5" }),
      seat("b", "b", "claude-code:x", { model: "claude-fable-5.2" }),
      seat("c", "c", null, { model: " gpt-5-codex " }),
      seat("d", "d", null),
    ]);
    const merged = units.find((unit) => unit.voice_ids.length === 2);
    expect(merged?.model).toBeUndefined();
    expect(merged?.models).toEqual(["claude-fable-5.2", "claude-opus-5.5"]);
    expect(units.find((unit) => unit.voice_ids[0] === "session_c")?.model).toBe("gpt-5-codex");
    const bare = units.find((unit) => unit.voice_ids[0] === "session_d");
    expect(bare && ("model" in bare || "models" in bare)).toBe(false);
  });

  test("a session listed twice with different lineage is refused", () => {
    expect(refusal(() => buildElectorate([seat("a", "a", null), seat("a", "b", null)])).code).toBe("invalid_electorate");
    expect(buildElectorate([seat("a", "a", null), seat("a", "a", null)]).units).toHaveLength(1);
  });

  test("unit_basis counts the units that declared no handle", () => {
    expect(unitBasis(THREE)).toBe(
      "A unit is one attested session lineage, or several lineages that declared the same unverified host handle. 1 of 3 units declared no handle and are counted per lineage. This does not show one mind, one model or one operator. A process can hold several sessions; sessions started through the legacy session tool without attestation are separate units.",
    );
  });
});

describe("classifying a caster", () => {
  test("a listed voice casts for its unit, including a child that started after the open", () => {
    const alphaUnit = THREE.find((unit) => unit.voice_ids.includes(ALPHA.voice_id));
    expect(classifyCaster(THREE, ALPHA)).toEqual({ counts_as: "counted", unit_id: alphaUnit?.unit_id as string });
    const laterChild = { voice_id: ALPHA.voice_id, seat_ref: "claude-code:aaaa" };
    expect(classifyCaster(THREE, laterChild)).toEqual({ counts_as: "counted", unit_id: alphaUnit?.unit_id as string });
  });

  test("anyone else is late, with same_handle_as when it declared a unit's handle", () => {
    const betaUnit = THREE.find((unit) => unit.voice_ids.includes(BETA.voice_id));
    const impostor = { voice_id: "session_newcomer", seat_ref: "claude-code:bbbb" };
    expect(classifyCaster(THREE, impostor)).toEqual({
      counts_as: "late",
      unit_id: ballotUnitId(["session_newcomer"]),
      same_handle_as: betaUnit?.unit_id as string,
    });
    expect(classifyCaster(THREE, { voice_id: "session_newcomer", seat_ref: null })).toEqual({
      counts_as: "late",
      unit_id: ballotUnitId(["session_newcomer"]),
    });
  });
});

describe("commitment and seals", () => {
  const input = {
    workspace_id: WS,
    ballot_id: BALLOT,
    cast_id: "cast-1",
    unit_id: ballotUnitId(["session_alpha"]),
    session_id: "session_alpha",
    vote: vote(["a"], { why: [{ text: "smaller diff", basis: "seen", cites: [1] }], evidence: ["file src/a.ts"] }),
    salt: "ab".repeat(32),
  };

  test("is sha256 of the canonical JSON of the protocol and the cast", () => {
    expect(ballotCommitment(input)).toBe(sha256(canonicalJson({ protocol: BALLOT_COMMITMENT_PROTOCOL, ...input })));
    expect(BALLOT_COMMITMENT_PROTOCOL).toBe("agenttool.collab-ballot/1");
  });

  test("does not depend on key order and changes with the salt or any field", () => {
    const reordered = { ...input, vote: { evidence: input.vote.evidence, why: input.vote.why, choice: ["a"] } };
    expect(ballotCommitment(reordered)).toBe(ballotCommitment(input));
    expect(ballotCommitment({ ...input, salt: "cd".repeat(32) })).not.toBe(ballotCommitment(input));
    expect(ballotCommitment({ ...input, vote: vote(["b"]) })).not.toBe(ballotCommitment(input));
    expect(ballotCommitment({ ...input, session_id: "session_beta" })).not.toBe(ballotCommitment(input));
  });

  test("refuses a salt that is not 32 bytes of lowercase hex", () => {
    expect(refusal(() => ballotCommitment({ ...input, salt: "abc" })).code).toBe("invalid_salt");
    expect(refusal(() => ballotCommitment({ ...input, salt: "AB".repeat(32) })).code).toBe("invalid_salt");
  });

  test("a seal opens when it matches its cast, and says whether this journal owns it", () => {
    const commitment = ballotCommitment(input);
    const event = { cast_id: "cast-1", unit_id: input.unit_id, session_id: "session_alpha", commitment, cast_seq: 1 };
    const file = { cast_id: "cast-1", journal_realpath: JOURNAL, session_id: "session_alpha", unit_id: input.unit_id, salt: input.salt, vote: input.vote };
    const context = { workspace_id: WS, ballot_id: BALLOT, journal_realpath: JOURNAL };
    expect(openSeal(file, event, context)).toEqual({ state: "ok", vote: input.vote, salt: input.salt, owned: true });
    expect(openSeal(file, event, { ...context, journal_realpath: "/elsewhere/copy.sqlite" })).toMatchObject({ state: "ok", owned: false });

    expect(openSeal({ ...file, vote: vote(["b"]) }, event, context)).toEqual({ state: "seal_mismatch" });
    expect(openSeal({ ...file, cast_id: "cast-2" }, event, context)).toEqual({ state: "seal_mismatch" });
    expect(openSeal(file, event, { ...context, workspace_id: "workspace_other" })).toEqual({ state: "seal_mismatch" });

    expect(openSeal(null, event, context)).toEqual({ state: "seal_unreadable" });
    expect(openSeal("{", event, context)).toEqual({ state: "seal_unreadable" });
    expect(openSeal({ ...file, salt: undefined }, event, context)).toEqual({ state: "seal_unreadable" });
    expect(openSeal({ ...file, vote: { choice: "a" } }, event, context)).toEqual({ state: "seal_unreadable" });
    const floatCite = { ...input.vote, why: [{ text: "x", cites: [1.5] }] };
    expect(openSeal({ ...file, vote: floatCite }, event, context)).toEqual({ state: "seal_unreadable" });
  });
});

describe("poll terms", () => {
  const options = [{ key: "a", label: "Alpha" }, { key: "b", label: "Beta" }, { key: "c", label: "Gamma" }];
  const poll = { question: "Which layout for the inbox?", options, closes: "30m", criteria: "Smallest change that keeps legacy output." };
  const terms = (input: Record<string, unknown>, units: readonly ElectorateUnit[] = THREE, sessions?: ElectorateSession[]) =>
    validatePollTerms(input, { now: NOW, units, sessions });

  test("a valid poll gets the defaults written into its terms", () => {
    const { terms: written, advice } = terms(poll);
    expect(written).toEqual({
      question: poll.question,
      options,
      criteria: poll.criteria,
      method: "approval/1",
      quorum: 2,
      closes_at: "2026-11-12T12:30:00.000Z",
      close_when_all_cast: false,
    });
    expect(advice).toEqual([]);
  });

  test("missing criteria is advice, not a refusal", () => {
    const { terms: written, advice } = terms({ ...poll, criteria: undefined });
    expect(written.criteria).toBeUndefined();
    expect(advice.join(" ")).toContain("No criteria given");
  });

  test("options are 2 to 9, with distinct keys and labels of at most 120 characters", () => {
    const one = refusal(() => terms({ ...poll, options: [options[0]] }));
    expect(one.code).toBe("invalid_options");
    expect(one.details).toMatchObject({ min: 2, max: 9 });
    const ten = Array.from({ length: 10 }, (_, index) => ({ key: `k${index}`, label: `Option ${index}` }));
    expect(refusal(() => terms({ ...poll, options: ten })).code).toBe("invalid_options");
    expect(terms({ ...poll, options: ten.slice(0, 9) }).terms.options).toHaveLength(9);
    expect(refusal(() => terms({ ...poll, options: [{ key: "a", label: "x" }, { key: "A", label: "y" }] })).code).toBe("invalid_options");
    expect(refusal(() => terms({ ...poll, options: [{ key: "a b", label: "x" }, { key: "c", label: "y" }] })).code).toBe("invalid_options");
    const long = refusal(() => terms({ ...poll, options: [{ key: "a", label: "x".repeat(121) }, { key: "b", label: "y" }] }));
    expect(long.code).toBe("too_long");
    expect(long.details).toMatchObject({ field: "options[0].label", max: 120 });
    expect(refusal(() => terms({ ...poll, options: [{ key: "a", label: "two\nlines" }, { key: "b", label: "y" }] })).code).toBe("invalid_options");
  });

  test("question and criteria are bounded", () => {
    expect(refusal(() => terms({ ...poll, question: "q".repeat(501) })).details).toMatchObject({ field: "question", max: 500 });
    expect(refusal(() => terms({ ...poll, question: "   " })).code).toBe("invalid_question");
    expect(refusal(() => terms({ ...poll, criteria: "c".repeat(2_001) })).code).toBe("too_long");
    expect(terms({ ...poll, question: "q".repeat(500), criteria: "c".repeat(2_000) }).terms.question).toHaveLength(500);
  });

  test("pick is 1 to the number of options, and pick 1 is flagged as plurality", () => {
    expect(refusal(() => terms({ ...poll, pick: 0 })).details).toMatchObject({ field: "pick", min: 1, max: 3 });
    expect(refusal(() => terms({ ...poll, pick: 4 })).code).toBe("invalid_pick");
    expect(terms({ ...poll, pick: 3 }).terms.pick).toBe(3);
    expect(terms({ ...poll, pick: 1 }).advice.join(" ")).toContain("plurality");
  });

  test("quorum is an integer from 2 to the electorate size, refused with the bounds", () => {
    for (const quorum of [1, 4, 2.5, "2"]) {
      const error = refusal(() => terms({ ...poll, quorum }));
      expect(error.code).toBe("invalid_quorum");
      expect(error.details).toMatchObject({ min: 2, max: 3 });
      expect((error.details.remedy as { say: string }).say).toContain("2 to 3");
    }
    expect(terms({ ...poll, quorum: 3 }).terms.quorum).toBe(3);
  });

  test("an electorate of fewer than 2 units is refused, pointing at a note or a proposal", () => {
    const lonely = buildElectorate([ALPHA, seat("alpha-child", "alpha", "claude-code:aaaa")]).units;
    const error = refusal(() => terms(poll, lonely));
    expect(error.code).toBe("electorate_too_small");
    const say = (error.details.remedy as { say: string }).say;
    expect(say).toContain("collab_note");
    expect(say).toContain("collab_propose");
  });

  test("more than 16 units is refused with the same poll naming the 16 most recently seen", () => {
    const crowd = Array.from({ length: 17 }, (_, index) => seat(`s${String(index).padStart(2, "0")}`, `s${String(index).padStart(2, "0")}`, null, {
      last_seen_at: new Date(Date.parse(NOW) - index * 60_000).toISOString(),
    }));
    const { units } = buildElectorate(crowd);
    const error = refusal(() => terms(poll, units, crowd));
    expect(error.code).toBe("electorate_too_large");
    const remedy = error.details.remedy as { tool: string; input: Record<string, unknown> };
    expect(remedy.tool).toBe("collab_poll");
    expect(remedy.input).toMatchObject({ question: poll.question, closes: "30m" });
    expect(remedy.input.voters).toEqual(crowd.slice(0, 16).map((session) => session.session_id));
    expect(refusal(() => terms(poll, units)).details.remedy).toEqual({ say: "Name at most 16 voters with voters." });
    expect(terms(poll, units.slice(0, 16)).terms.quorum).toBe(2);
  });

  test("closes is 1 minute to 7 days, as seconds, a duration or a zoned ISO time", () => {
    const at = (closes: unknown) => ballotClosesAt(closes, NOW);
    expect(at(60)).toBe("2026-11-12T12:01:00.000Z");
    expect(at("1d12h")).toBe("2026-11-14T00:00:00.000Z");
    expect(at("7d")).toBe("2026-11-19T12:00:00.000Z");
    expect(at("2026-11-13T08:00:00+08:00")).toBe("2026-11-13T00:00:00.000Z");
    for (const closes of [59, 604_801, "8d", "soon", "", "2026-11-13T00:00:00", "2026-11-12T12:00:30Z", 90.5, undefined]) {
      const error = refusal(() => at(closes));
      expect(error.code).toBe("invalid_closes");
      expect(error.details).toMatchObject({ min_seconds: 60, max_seconds: 604_800 });
    }
    expect(refusal(() => terms({ ...poll, closes: undefined })).code).toBe("invalid_closes");
  });

  test("close_when_all_cast is opt-in and must be a boolean", () => {
    expect(terms({ ...poll, close_when_all_cast: true }).terms.close_when_all_cast).toBe(true);
    expect(refusal(() => terms({ ...poll, close_when_all_cast: "yes" })).code).toBe("invalid_close_when_all_cast");
  });

  test("voters is a non-empty list of names or ids, repeats removed", () => {
    expect(normalizeBallotVoters(undefined)).toBeNull();
    expect(normalizeBallotVoters(["alpha", "session_beta", "alpha"])).toEqual(["alpha", "session_beta"]);
    expect(refusal(() => normalizeBallotVoters([])).code).toBe("invalid_voters");
    expect(refusal(() => normalizeBallotVoters(["alpha", ""])).code).toBe("invalid_voters");
  });
});

describe("vote shape", () => {
  const ballot = { options: TERMS.options };

  test("choice is kept in option order without repeats; [] abstains", () => {
    const repeated = validateVote({ choice: ["c", "a", "c"], why: [{ text: "both fit" }] }, ballot);
    expect(repeated.vote.choice).toEqual(["a", "c"]);
    expect(repeated.advice.join(" ")).toContain("repeated");
    const abstain = validateVote({ choice: [] }, ballot);
    expect(abstain.vote).toEqual({ choice: [], why: [], evidence: [] });
    expect(abstain.advice.join(" ")).toContain("no reason given");
  });

  test("choice names only this ballot's options, at most pick of them", () => {
    const unknown = refusal(() => validateVote({ choice: ["a", "z"] }, ballot));
    expect(unknown.code).toBe("invalid_choice");
    expect(unknown.details).toMatchObject({ unknown: ["z"], options: ["a", "b", "c"] });
    expect(refusal(() => validateVote({ choice: "a" }, ballot)).code).toBe("invalid_choice");
    expect(refusal(() => validateVote({}, ballot)).code).toBe("invalid_choice");
    expect(refusal(() => validateVote({ choice: ["a", "b"] }, { ...ballot, pick: 1 })).details).toMatchObject({ pick: 1 });
    expect(validateVote({ choice: ["b"] }, { ...ballot, pick: 1 }).vote.choice).toEqual(["b"]);
  });

  test("why holds at most 4 reasons of at most 300 characters, each with a known basis", () => {
    const reason = { text: "r".repeat(300), basis: "inferred" };
    expect(validateVote({ choice: ["a"], why: [reason, reason, reason, reason] }, ballot).vote.why).toHaveLength(4);
    expect(refusal(() => validateVote({ choice: ["a"], why: [reason, reason, reason, reason, reason] }, ballot)).details)
      .toMatchObject({ field: "why", max: 4 });
    const long = refusal(() => validateVote({ choice: ["a"], why: [{ text: "r".repeat(301) }] }, ballot));
    expect(long.code).toBe("too_long");
    expect(long.details).toMatchObject({ field: "why[0].text", max: 300 });
    expect(refusal(() => validateVote({ choice: ["a"], why: [{ text: "x", basis: "felt" }] }, ballot)).code).toBe("invalid_why");
    expect(refusal(() => validateVote({ choice: ["a"], why: [{ text: "" }] }, ballot)).code).toBe("invalid_why");
  });

  test("cites are 1-based positions in the vote's own evidence", () => {
    const evidence = ["file src/a.ts", "commit 0123456789abcdef0123456789abcdef01234567"];
    const ok = validateVote({ choice: ["a"], evidence, why: [{ text: "x", basis: "seen", cites: [2, 1, 2] }] }, ballot);
    expect(ok.vote.why[0]).toEqual({ text: "x", basis: "seen", cites: [1, 2] });
    for (const cites of [[0], [3], [1.5], "1"]) {
      const error = refusal(() => validateVote({ choice: ["a"], evidence, why: [{ text: "x", cites }] }, ballot));
      expect(error.code).toBe("invalid_why");
    }
    expect(refusal(() => validateVote({ choice: ["a"], why: [{ text: "x", cites: [1] }] }, ballot)).code).toBe("invalid_why");
  });

  test("evidence holds at most 4 one-line pointers, and shared at most 200 characters", () => {
    const lines = ["file a", "file b", "file c", "file d"];
    expect(validateVote({ choice: ["a"], evidence: lines }, ballot).vote.evidence).toEqual(lines);
    expect(refusal(() => validateVote({ choice: ["a"], evidence: [...lines, "file e"] }, ballot)).details)
      .toMatchObject({ field: "evidence", max: 4 });
    expect(refusal(() => validateVote({ choice: ["a"], evidence: ["file a\nfile b"] }, ballot)).code).toBe("invalid_evidence");
    expect(validateVote({ choice: ["a"], shared: "s".repeat(200) }, ballot).vote.shared).toHaveLength(200);
    expect(refusal(() => validateVote({ choice: ["a"], shared: "s".repeat(201) }, ballot)).details)
      .toMatchObject({ field: "shared", max: 200 });
  });

  test("a vote whose revealed entry would pass 8 KiB of canonical UTF-8 is refused", () => {
    // Within every per-field cap, but CJK text takes three bytes a character.
    const why = Array.from({ length: 4 }, () => ({ text: "票".repeat(300), basis: "inferred" }));
    const evidence = Array.from({ length: 4 }, (_, index) => `url https://example.invalid/${index}/${"p".repeat(1_200)}`);
    const error = refusal(() => validateVote({ choice: ["a"], why, evidence }, ballot));
    expect(error.code).toBe("too_long");
    expect(error.details).toMatchObject({ field: "vote", max: MAX_REVEALED_ENTRY_BYTES });
    expect(validateVote({ choice: ["a"], why }, ballot).vote.why).toHaveLength(4);
  });

  test("text is normalised: line endings, bidi controls and tag characters", () => {
    const { vote: normalised } = validateVote({ choice: ["a"], why: [{ text: "﻿safe ‮right‬\r\nnext  " }] }, ballot);
    expect(normalised.why[0]?.text).toBe("safe right\nnext");
  });

  test("text normalises exactly as a note does, and reasons use the note's basis words", () => {
    expect([...BALLOT_BASES]).toEqual([...NOTE_BASES]);
    const samples = ["a  b  ", "﻿x\r\ny\rz\t", "‮q\u{E0041}  \n\n  r", " line one \n line two "];
    for (const text of samples) {
      const { vote: normalised } = validateVote({ choice: ["a"], why: [{ text }] }, ballot);
      expect(normalised.why[0]?.text).toBe(normalizeNoteText(text));
    }
  });

  test("evidence with a line break is refused, as a note refuses it", () => {
    // Two pointers on one item would read as one pointer that does not exist.
    const twoInOne = "file src/a.ts\nfile src/b.ts";
    expect(refusal(() => validateVote({ choice: ["a"], evidence: [twoInOne] }, ballot)).code).toBe("invalid_evidence");
    expect(checkNote(normalizeNoteFields({ act: "note", statement: "s", evidence: [twoInOne] })))
      .toEqual([expect.objectContaining({ field: "evidence[0]", message: expect.stringContaining("must be one line") })]);
  });

  test("evidence lines follow the note's Evidence grammar", () => {
    const lines = ["report#3fa91c", "event:event_1", "test bun test exit=0", "url https://example.invalid/a"];
    expect(validateVote({ choice: ["a"], evidence: lines }, ballot).vote.evidence).toEqual(lines);
    for (const line of ["I read the code", "commit not-a-sha", "task#0b12de", "file :3"]) {
      const error = refusal(() => validateVote({ choice: ["a"], evidence: ["file ok.ts", line] }, ballot));
      expect(error.code).toBe("invalid_evidence");
      expect(error.details).toMatchObject({ field: "evidence[1]" });
      expect((error.details.remedy as { say: string }).say).toContain("file src/a.ts:10-20");
    }
  });

  test("the sealed form adds resolved evidence and the declared model; a retry compares input only", () => {
    const { vote: plain } = validateVote({ choice: ["a"], evidence: ["file src/a.ts"], why: [{ text: "x", basis: "seen", cites: [1] }] }, ballot);
    const resolved = [{ text: "file src/a.ts", kind: "file", locator: "src/a.ts", sha256: "f".repeat(64), observed: "server" }];
    const sealed = sealVote(plain, { evidence: resolved, model: "claude-opus-5.5" });
    expect(sealed).toEqual({ ...plain, evidence: resolved, model: "claude-opus-5.5" });
    expect(sealVote(plain, { model: "  " })).toEqual(plain);
    expect(refusal(() => sealVote(plain, { evidence: [{ text: "file src/b.ts" }] })).code).toBe("invalid_vote_evidence");
    expect(sameVoteInput(sealed, plain)).toBe(true);
    expect(sameVoteInput(sealed, { ...plain, choice: ["b"] })).toBe(false);
    expect(sameVoteInput(plain, { ...plain, shared: "same repo" })).toBe(false);
  });

  test("half a character is refused in every text field, with that field's code", () => {
    // A host that cuts text at a UTF-16 boundary splits an emoji. SQLite does
    // not keep the half as given, and these texts reach the poll note body.
    const poll = { question: "Which layout?", options: [{ key: "a", label: "Alpha" }, { key: "b", label: "Beta" }], closes: "30m" };
    const terms = (input: Record<string, unknown>) => validatePollTerms(input, { now: NOW, units: THREE });
    for (const half of ["\ud800", "\udc00", "🏮".slice(0, 1)]) {
      const cases: Array<[() => unknown, string, string]> = [
        [() => terms({ ...poll, question: `which ${half} layout?` }), "invalid_question", "question"],
        [() => terms({ ...poll, criteria: `smallest ${half}` }), "invalid_criteria", "criteria"],
        [() => terms({ ...poll, options: [{ key: "a", label: `Alpha ${half}` }, poll.options[1]] }), "invalid_options", "options[0].label"],
        [() => validateVote({ choice: ["a"], why: [{ text: `x ${half}` }] }, ballot), "invalid_why", "why[0].text"],
        [() => validateVote({ choice: ["a"], evidence: [`file src/a${half}.ts`] }, ballot), "invalid_evidence", "evidence[0]"],
        [() => validateVote({ choice: ["a"], shared: `same repo ${half}` }, ballot), "invalid_shared", "shared"],
      ];
      for (const [run, code, field] of cases) {
        const error = refusal(run);
        expect([error.code, error.details.field]).toEqual([code, field]);
        expect(error.message).toContain("must be well-formed Unicode text");
        expect(error.details.remedy).toEqual({ say: expect.any(String) });
      }
    }
    // A whole pair is one ordinary character.
    expect(validateVote({ choice: ["a"], why: [{ text: "lamp 🏮 lit" }] }, ballot).vote.why[0]!.text).toBe("lamp 🏮 lit");
    expect(terms({ ...poll, question: "🏮 or 共筆?" }).terms.question).toBe("🏮 or 共筆?");
  });

  test("a session may cast at most 3 times in a ballot", () => {
    expect(nextCastSeq(0)).toBe(1);
    expect(nextCastSeq(2)).toBe(3);
    const error = refusal(() => nextCastSeq(3));
    expect(error.code).toBe("cast_limit");
    expect(error.details.remedy).toEqual({ say: "Your latest cast stands; it is revealed at the close." });
  });
});

describe("closing", () => {
  const units = THREE;
  const ids = units.map((unit) => unit.unit_id);
  const terms = { closes_at: "2026-11-12T13:00:00.000Z", close_when_all_cast: false };

  test("a ballot closes at its deadline, the instant itself included", () => {
    expect(ballotClosedBy(terms, units, [], "2026-11-12T12:59:59.999Z")).toBeNull();
    expect(ballotClosedBy(terms, units, [], "2026-11-12T13:00:00.000Z")).toBe("time");
  });

  test("it closes early only when opted in and every electorate unit has cast", () => {
    expect(ballotClosedBy(terms, units, ids, NOW)).toBeNull();
    const early = { ...terms, close_when_all_cast: true };
    expect(ballotClosedBy(early, units, ids.slice(0, 2), NOW)).toBeNull();
    expect(ballotClosedBy(early, units, [...ids.slice(0, 2), ballotUnitId(["session_late"])], NOW)).toBeNull();
    expect(ballotClosedBy(early, units, [...ids, ids[0] as string], NOW)).toBe("all_cast");
  });
});

describe("resolving revealed casts", () => {
  test("each voice's latest cast counts; its earlier casts, from any of its sessions, are replaced", () => {
    const child = seat("alpha-child", "alpha", "claude-code:aaaa");
    const casts = [
      cast(THREE, ALPHA, vote(["a"])),
      cast(THREE, child, vote(["b"])),
      cast(THREE, BETA, vote(["b"])),
    ];
    const entries = resolveCasts(THREE, casts, { ballot_id: BALLOT });
    expect(entries.map((entry) => entry.status)).toEqual(["replaced", "counted", "counted"]);
    const result = resultOf(THREE, casts, [ALPHA, child, BETA, GAMMA]);
    expect(result.options.find((option) => option.key === "b")?.units).toBe(2);
    expect(result.options.find((option) => option.key === "a")?.units).toBe(0);
    expect(result.replaced.map((entry) => entry.name)).toEqual(["alpha"]);
  });

  test("revealed entries carry exactly the committed vote, so anyone can re-verify them", () => {
    const entries = resolveCasts(THREE, [cast(THREE, ALPHA, vote(["a"], { why: [{ text: "x", cites: [] }] }))], { ballot_id: BALLOT });
    const entry = entries[0];
    expect(entry && entry.vote && entry.salt).toBeTruthy();
    const recomputed = ballotCommitment({
      workspace_id: WS,
      ballot_id: entry?.ballot_id as string,
      cast_id: entry?.cast_id as string,
      unit_id: entry?.unit_id as string,
      session_id: entry?.session_id as string,
      vote: entry?.vote as SealedVote,
      salt: entry?.salt as string,
    });
    expect(recomputed).toBe(entry?.commitment as string);
    expect(revealedEntryBytes(entry as never)).toBeLessThanOrEqual(MAX_REVEALED_ENTRY_BYTES);
    expect(revealedEntriesSha256(entries)).toBe(sha256(canonicalJson(entries)));
  });

  test("two different listed voices of one unit conflict: neither counts, nor counts toward quorum", () => {
    const first = seat("first", "first", "claude-code:shared");
    const second = seat("second", "second", "claude-code:shared");
    const solo = seat("solo", "solo", null);
    const { units } = buildElectorate([first, second, solo]);
    const casts = [
      cast(units, first, vote(["a"])),
      cast(units, first, vote(["b"])),
      cast(units, second, vote(["b"])),
      cast(units, solo, vote(["c"])),
    ];
    expect(resolveCasts(units, casts, { ballot_id: BALLOT }).map((entry) => entry.status))
      .toEqual(["replaced", "unit_conflict", "unit_conflict", "counted"]);
    const result = resultOf(units, casts, [first, second, solo]);
    expect(result.unit_conflicts.map((entry) => entry.name)).toEqual(["first", "second"]);
    expect(result.options.find((option) => option.key === "b")?.units).toBe(0);
    expect(result.turnout).toMatchObject({ cast: 2, electorate: 2 });
    expect(result.quorum).toEqual({ needed: 2, met: false, counted: 1 });
    expect(result.status).toBe("inconclusive");
    expect(unitOutcomes(units, resolveCasts(units, casts, { ballot_id: BALLOT })).map((outcome) => outcome.state).sort())
      .toEqual(["counted", "unit_conflict"]);
  });

  for (const broken of ["missing", "tamper", "garbage"] as const) {
    test(`a latest cast whose seal is ${broken} counts toward turnout only; an earlier cast never stands in`, () => {
      const casts = [
        cast(THREE, ALPHA, vote(["a"])),
        cast(THREE, ALPHA, vote(["c"]), { seal: broken }),
        cast(THREE, BETA, vote(["b"])),
        cast(THREE, GAMMA, vote([])),
      ];
      const expected = ({ missing: "seal_missing", tamper: "seal_mismatch", garbage: "seal_unreadable" } as const)[broken];
      const entries = resolveCasts(THREE, casts, { ballot_id: BALLOT });
      expect(entries.map((entry) => entry.status)).toEqual(["replaced", expected, "counted", "counted"]);
      expect(entries[1]?.vote).toBeUndefined();
      expect(entries[1]?.salt).toBeUndefined();
      const result = resultOf(THREE, casts, [ALPHA, BETA, GAMMA]);
      expect(result.turnout.cast).toBe(3);
      expect(result.quorum).toEqual({ needed: 2, met: true, counted: 2 });
      expect(result.options.map((option) => option.units)).toEqual([0, 1, 0]);
      expect((result as unknown as Record<string, unknown[]>)[expected]).toHaveLength(1);
    });
  }

  test("a broken seal alone does not help meet quorum", () => {
    const casts = [cast(THREE, ALPHA, vote(["a"])), cast(THREE, BETA, vote(["a"]), { seal: "missing" })];
    const result = resultOf(THREE, casts, [ALPHA, BETA, GAMMA]);
    expect(result.quorum).toEqual({ needed: 2, met: false, counted: 1 });
    expect(result.status).toBe("inconclusive");
  });

  test("a late cast is revealed and never counted, even when its handle matches a unit", () => {
    const impostor = seat("impostor", "impostor", "claude-code:bbbb");
    const stranger = seat("stranger", "stranger", null);
    const casts = [
      cast(THREE, ALPHA, vote(["a"])),
      cast(THREE, BETA, vote(["b"])),
      cast(THREE, impostor, vote(["b"])),
      cast(THREE, stranger, vote(["b"]), { seal: "missing" }),
    ];
    expect(resolveCasts(THREE, casts, { ballot_id: BALLOT }).map((entry) => entry.status))
      .toEqual(["counted", "counted", "late", "late"]);
    const result = resultOf(THREE, casts, [ALPHA, BETA, GAMMA, impostor, stranger]);
    expect(result.status).toBe("tied");
    expect(result.options.map((option) => option.units)).toEqual([1, 1, 0]);
    const betaUnit = THREE.find((unit) => unit.voice_ids.includes(BETA.voice_id))?.unit_id;
    expect(result.late).toEqual([
      expect.objectContaining({ name: "impostor", choice: ["b"], same_handle_as: betaUnit }),
      expect.objectContaining({ name: "stranger" }),
    ]);
    expect(result.late[1]).not.toHaveProperty("same_handle_as");
    expect(result.late[1]).not.toHaveProperty("choice");
    expect(result.turnout.cast).toBe(2);
  });

  test("a cast whose recorded unit does not list its voice is late", () => {
    const real = cast(THREE, ALPHA, vote(["a"]));
    const forged = { ...cast(THREE, seat("other", "other", null), vote(["a"])), unit_id: real.unit_id };
    expect(resolveCasts(THREE, [forged], { ballot_id: BALLOT })[0]?.status).toBe("late");
  });

  test("a verified seal too large to reveal is never counted and its content is left out", () => {
    const huge = vote(["a"], { shared: "x".repeat(MAX_REVEALED_ENTRY_BYTES) });
    const entries = resolveCasts(THREE, [cast(THREE, ALPHA, huge)], { ballot_id: BALLOT });
    expect(entries[0]?.status).toBe("seal_unreadable");
    expect(entries[0]?.vote).toBeUndefined();
  });
});

describe("result", () => {
  const all = [ALPHA, BETA, GAMMA];

  test("one option ahead is a top choice; differing approvals are a split", () => {
    const casts = [
      cast(THREE, ALPHA, vote(["a"], { why: [{ text: "keeps legacy output", basis: "seen", cites: [1] }], evidence: ["file src/mcp.ts:1-20"] })),
      cast(THREE, BETA, vote(["a", "b"])),
      cast(THREE, GAMMA, vote(["b", "c"], { why: [{ text: "simpler", basis: "inferred" , cites: [] }] })),
      cast(THREE, GAMMA, vote(["c"], { why: [{ text: "simplest", basis: "inferred", cites: [] }] })),
    ];
    const result = resultOf(THREE, casts, all, {
      delivered_session_ids: [ALPHA.session_id, GAMMA.session_id],
      left_out: [{ session_id: "session_quiet", name: "quiet", last_seen_minutes: 45 }],
    });
    expect(result.status).toBe("top_choice");
    expect(result.top).toEqual(["a"]);
    expect(result.split).toBe(true);
    expect(result.notes).toContain(BALLOT_SPLIT_NOTE);
    expect(result.turnout).toEqual({ cast: 3, electorate: 3, delivery_recorded: 2 });
    expect(result.quorum).toEqual({ needed: 2, met: true, counted: 3 });
    const a = result.options[0];
    expect(a?.voters).toEqual(["alpha", "beta"]);
    expect(a?.reasons).toEqual([{ by: "alpha", text: "keeps legacy output", basis: "seen", cites: [1], cited: ["file src/mcp.ts:1-20"] }]);
    expect(a?.no_reason_given).toEqual(["beta"]);
    expect(result.left_out).toEqual([{ session_id: "session_quiet", name: "quiet", last_seen_minutes: 45 }]);
    expect(result.unit_basis).toBe(unitBasis(THREE));
    expect(result.sealing).toBe(BALLOT_SEALING);
    expect(result.authorises).toBe(BALLOT_AUTHORISES);
    expect(result).not.toHaveProperty("next");
    // Spec 7's honesty statements, word for word: a dropped sentence must fail here.
    expect(BALLOT_AUTHORISES).toBe(
      "Nothing. A top choice is the agents' recorded preference: not a decision and not agreement. " +
        "It adds nothing to what you were already allowed to do. A direction-level choice goes to collab_propose, " +
        "where every voice may still object and the person decides.",
    );
    expect(BALLOT_SEALING).toBe(
      "Sealed means no collab tool, event or doorbell shows a vote before the close. It does not hide a vote " +
        "from a process running as the same user that reads the seal files, from the voter's own host transcript, " +
        "or from agents who message each other outside collab. Turnout, timing and the size of each seal file are " +
        "visible. Any process that can read a session's credential file can cast for that session's unit. Notes on " +
        "an open ballot are folded by collab_inbox only; legacy tools and older builds show them.",
    );
  });

  test("units that approve the same set are not a split", () => {
    const casts = [cast(THREE, ALPHA, vote(["a", "b"])), cast(THREE, BETA, vote(["a", "b"])), cast(THREE, GAMMA, vote([]))];
    const result = resultOf(THREE, casts, all);
    expect(result.split).toBe(false);
    expect(result.notes).not.toContain(BALLOT_SPLIT_NOTE);
    expect(result.status).toBe("tied");
  });

  test("a tie names every tied option, breaks nothing, and suggests a next step", () => {
    const casts = [cast(THREE, ALPHA, vote(["a"])), cast(THREE, BETA, vote(["b"])), cast(THREE, GAMMA, vote([]))];
    const result = resultOf(THREE, casts, all);
    expect(result.status).toBe("tied");
    expect(result.top).toEqual(["a", "b"]);
    expect(result.next).toEqual({ say: "the opener may poll again on the tied options or put one to collab_propose" });
    expect(result.next).toEqual({ ...BALLOT_TIE_NEXT });
    expect(result.abstained).toEqual(["gamma"]);
  });

  test("everyone abstaining with quorum met is no_approval, not a tie", () => {
    const casts = [cast(THREE, ALPHA, vote([])), cast(THREE, BETA, vote([])), cast(THREE, GAMMA, vote([]))];
    const result = resultOf(THREE, casts, all);
    expect(result.status).toBe("no_approval");
    expect(result.top).toEqual([]);
    expect(result.abstained).toEqual(["alpha", "beta", "gamma"]);
    expect(result.quorum.met).toBe(true);
    expect(result.split).toBe(false);
    expect(result).not.toHaveProperty("next");
  });

  test("quorum not met is inconclusive, with no top choice", () => {
    const one = resultOf(THREE, [cast(THREE, ALPHA, vote(["a"]))], all);
    expect(one.status).toBe("inconclusive");
    expect(one.top).toEqual([]);
    expect(one.quorum).toEqual({ needed: 2, met: false, counted: 1 });
    expect(one.options[0]?.units).toBe(1);
    const higher = resultOf(THREE, [cast(THREE, ALPHA, vote(["a"])), cast(THREE, BETA, vote(["a"]))], all, {
      terms: { ...TERMS, quorum: 3 },
    });
    expect(higher.status).toBe("inconclusive");
    const none = resultOf(THREE, [], all);
    expect(none.status).toBe("inconclusive");
    expect(none.turnout.cast).toBe(0);
  });

  test("a withdrawn ballot shows its entries and no top choice", () => {
    const casts = [cast(THREE, ALPHA, vote(["a"])), cast(THREE, BETA, vote(["a"])), cast(THREE, GAMMA, vote(["b"]))];
    const result = resultOf(THREE, casts, all, { withdrawn: true });
    expect(result.status).toBe("withdrawn");
    expect(result.top).toEqual([]);
    expect(result.options.map((option) => option.units)).toEqual([2, 1, 0]);
    expect(result).not.toHaveProperty("next");
  });

  test("unique_evidence puts a losing option's own evidence beside the top choice", () => {
    const casts = [
      cast(THREE, ALPHA, vote(["a"], { evidence: ["file src/store.ts:10-20", "test bun test exit=0"] })),
      cast(THREE, BETA, vote(["a"], { evidence: ["test  bun test exit=0"] })),
      cast(THREE, GAMMA, vote(["c"], {
        evidence: ["test bun test exit=0", "file src/proposal.ts:27"],
        why: [{ text: "the bytes include known_conflicts", basis: "seen", cites: [2] }],
      })),
    ];
    const result = resultOf(THREE, casts, all);
    expect(result.top).toEqual(["a"]);
    const c = result.options.find((option) => option.key === "c");
    expect(c?.unique_evidence).toEqual([{ evidence: "file src/proposal.ts:27", cited_by: ["gamma"] }]);
    expect(c?.reasons[0]?.cited).toEqual(["file src/proposal.ts:27"]);
    expect(result.options.find((option) => option.key === "a")?.unique_evidence).toEqual([]);
  });

  test("evidence from a voter who also approved the top choice is not unique", () => {
    const result = resultOf(THREE, [
      cast(THREE, ALPHA, vote(["a"])),
      cast(THREE, BETA, vote(["a", "c"], { evidence: ["file x"] })),
      cast(THREE, GAMMA, vote(["b"], { evidence: ["file x", "file y"] })),
    ], all);
    expect(result.top).toEqual(["a"]);
    expect(result.options.find((option) => option.key === "b")?.unique_evidence).toEqual([{ evidence: "file y", cited_by: ["gamma"] }]);
    expect(result.options.find((option) => option.key === "c")?.unique_evidence).toEqual([]);
  });

  test("with no top choice, each option's evidence is all unanswered", () => {
    const result = resultOf(THREE, [cast(THREE, ALPHA, vote(["a"], { evidence: ["file x"] }))], all);
    expect(result.status).toBe("inconclusive");
    expect(result.options[0]?.unique_evidence).toEqual([{ evidence: "file x", cited_by: ["alpha"] }]);
  });

  test("resolved evidence is matched by what it points at and saw, not how it was observed", () => {
    const at = (observed: string) => ({ text: "file src/a.ts", kind: "file", locator: "src/a.ts", sha256: "a".repeat(64), observed });
    const changed = { text: "file src/a.ts", kind: "file", locator: "src/a.ts", sha256: "b".repeat(64), observed: "server" };
    const casts = [
      cast(THREE, ALPHA, vote(["a"], { evidence: [at("server")] })),
      cast(THREE, BETA, vote(["a"])),
      cast(THREE, GAMMA, vote(["b"], { evidence: [at("caller"), changed] })),
    ];
    const result = resultOf(THREE, casts, all);
    expect(result.options.find((option) => option.key === "b")?.unique_evidence).toEqual([{ evidence: changed, cited_by: ["gamma"] }]);
  });

  test("lineages use the declared model, else the host family in the seat_ref prefix", () => {
    const casts = [
      cast(THREE, ALPHA, vote(["a"], { model: "claude-opus-5.5" })),
      cast(THREE, BETA, vote(["a"])),
      cast(THREE, GAMMA, vote(["b"])),
    ];
    const result = resultOf(THREE, casts, all);
    expect(result.lineages).toEqual({ "claude-opus-5.5": 1, "host:claude-code": 1, undeclared: 1 });
    expect(result.notes).not.toContain(BALLOT_SAME_FAMILY_NOTE);
    expect(result.notes).toContain(
      "every unit approving a declares the same model family (claude): their agreement is not independent confirmation",
    );
    expect(modelFamily("claude-opus-5.5")).toBe("claude");
    expect(modelFamily("claude-code")).toBe("claude");
    expect(modelFamily("gpt-5-codex")).toBe("gpt");
    expect(modelFamily("  ")).toBeNull();
  });

  test("when every counted unit shares one model family, the result says so", () => {
    const codex = seat("gamma", "gamma", null, { model: "claude-fable-5.2" });
    const casts = [
      cast(THREE, ALPHA, vote(["a"])),
      cast(THREE, BETA, vote(["a"], { model: "Claude Opus 5.5" })),
      cast(THREE, codex, vote(["b"])),
    ];
    const result = resultOf(THREE, casts, [ALPHA, BETA, codex]);
    expect(result.lineages).toEqual({ "Claude Opus 5.5": 1, "claude-fable-5.2": 1, "host:claude-code": 1 });
    expect(result.notes[0]).toBe("all counted units declare the same model family: shared support is not independent confirmation");
  });

  test("declared model and any confidence never change a count", () => {
    const plain = [
      cast(THREE, ALPHA, vote(["a"], { why: [{ text: "x", cites: [] }] })),
      cast(THREE, BETA, vote(["b"], { why: [{ text: "y", cites: [] }] })),
      cast(THREE, GAMMA, vote(["b", "c"])),
    ];
    const weighted = [
      cast(THREE, ALPHA, {
        ...vote(["a"], { model: "claude-opus-5.5" }),
        why: [{ text: "x", cites: [], confidence: 0.99 } as never],
        confidence: 1,
      } as SealedVote),
      cast(THREE, BETA, vote(["b"], { model: "gpt-5-codex", why: [{ text: "y", cites: [], confidence: "low" } as never] })),
      cast(THREE, GAMMA, vote(["b", "c"], { model: "claude-opus-5.5" })),
    ];
    // A fractional confidence fails the payload guard, so that seal is unreadable, never weighted.
    expect(weighted[0]?.seal.state).toBe("seal_unreadable");
    const integerConfidence = cast(THREE, ALPHA, {
      ...vote(["a"], { model: "claude-opus-5.5" }),
      why: [{ text: "x", cites: [], confidence: 99 } as never],
      confidence: 100,
    } as SealedVote);
    expect(integerConfidence.seal.state).toBe("ok");
    const counts = (casts: CastToResolve[]) => {
      const result = resultOf(THREE, casts, all);
      return { status: result.status, top: result.top, units: result.options.map((option) => option.units), quorum: result.quorum };
    };
    expect(counts([integerConfidence, weighted[1] as CastToResolve, weighted[2] as CastToResolve])).toEqual(counts(plain));
    expect(counts(plain)).toEqual({ status: "top_choice", top: ["b"], units: [1, 2, 1], quorum: { needed: 2, met: true, counted: 3 } });
  });

  test("an unknown casting session is shown by its id", () => {
    const result = ballotResult({
      terms: TERMS,
      units: THREE,
      entries: resolveCasts(THREE, [cast(THREE, ALPHA, vote(["a"])), cast(THREE, BETA, vote(["a"]))], { ballot_id: BALLOT }),
      withdrawn: false,
    });
    expect(result.options[0]?.voters).toEqual([ALPHA.session_id, BETA.session_id]);
    expect(result.lineages).toEqual({ "host:claude-code": 2 });
    expect(result.notes).toContain(BALLOT_SAME_FAMILY_NOTE);
  });
});
