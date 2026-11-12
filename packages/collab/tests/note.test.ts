import { describe, expect, test } from "bun:test";
import { CollabError } from "../src/errors.js";
import {
  checkNote,
  checkNoteCaps,
  fileLocatorParts,
  isNoteHandle,
  normalizeNoteFields,
  normalizeNoteText,
  noteProblemError,
  NOTE_ACT_CEILINGS,
  NOTE_ACT_GROUPS,
  NOTE_ACTS,
  NOTE_ACTS_NEEDING_RE,
  NOTE_CARD_FAMILIES,
  NOTE_CARRY_DISCLAIMER,
  NOTE_CARRY_MAX,
  NOTE_EVIDENCE_MAX,
  NOTE_EXTENT_MAX,
  NOTE_JOURNAL_MAX,
  NOTE_LIMITS_MAX,
  NOTE_PURPOSE_MAX,
  NOTE_RELAY_TEXT_MAX,
  NOTE_REVIEW_MAX,
  NOTE_STATEMENT_MAX,
  NOTE_VALUE_MAX,
  NOTE_WHY_MAX,
  NOTE_WHY_TEXT_MAX,
  parseEvidence,
  parseNote,
  parseNoteRef,
  renderCarriedNote,
  renderEvidence,
  renderNote,
  splitNoteText,
  STATEMENT_TOO_LONG_REMEDY,
  type NoteAct,
  type NoteBasis,
  type NoteEvidence,
  type NoteFields,
  type NoteReason,
  type NoteTrailer,
} from "../src/note.js";

const R1 = "report_7f3a0c1e-2b4d-4e6f-8a9b-0c1d2e3f4a51";
const R2 = "report_8a4b1d2f-3c5e-4f70-9bac-1d2e3f4a5b62";
const R3 = "report_9b5c2e30-4d6f-4081-acbd-2e3f4a5b6c73";
const T1 = "task_0b12de34-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const E1 = "event_1c23ef45-6f70-4b8c-9dae-1f2a3b4c5d6e";
const S1 = "session_2d34f056-7081-4c9d-aebf-2a3b4c5d6e7f";
const HEX = "3b1f9a".padEnd(64, "0");

function fields(partial: Partial<NoteFields> & Pick<NoteFields, "act" | "statement">): NoteFields {
  return {
    body: null,
    to: null,
    re: null,
    via: null,
    why: [],
    evidence: [],
    limits: null,
    purpose: null,
    extent: null,
    replaces: null,
    trailers: [],
    ...partial,
  };
}

function why(text: string, basis: NoteBasis | null = null, cites: number[] = []): NoteReason {
  return { text, basis, cites };
}

function withoutAdvice(parsed: ReturnType<typeof parseNote>): Omit<ReturnType<typeof parseNote>, "advice"> {
  const { advice: _advice, ...rest } = parsed;
  return rest;
}

function thrown(run: () => unknown): CollabError {
  try {
    run();
  } catch (error) {
    if (error instanceof CollabError) return error;
    throw error;
  }
  throw new Error("expected a CollabError");
}

// ---------------------------------------------------------------- acts

describe("acts", () => {
  test("the act list is the spec's fourteen, grouped without overlap", () => {
    expect([...NOTE_ACTS]).toEqual([
      "note", "support", "challenge", "resolve", "withdraw", "accept", "request_changes", "decide",
      "relay_rejection", "take", "done", "propose", "poll", "vote",
    ]);
    const grouped = [...NOTE_ACT_GROUPS.journal, ...NOTE_ACT_GROUPS.work, ...NOTE_ACT_GROUPS.deciding];
    expect(grouped.sort()).toEqual([...NOTE_ACTS].sort());
    const card = Object.values(NOTE_CARD_FAMILIES).flat();
    expect(new Set(card).size).toBe(card.length);
    expect([...NOTE_ACTS].filter((act) => !card.includes(act as never))).toEqual(["relay_rejection"]);
    expect([...NOTE_ACTS_NEEDING_RE].sort()).toEqual(
      ["accept", "challenge", "relay_rejection", "request_changes", "resolve", "support", "withdraw"],
    );
  });

  test("every act has a ceiling that follows its storage", () => {
    for (const act of NOTE_ACTS) {
      const ceiling = NOTE_ACT_CEILINGS[act];
      if (act === "done" || act === "accept" || act === "request_changes") {
        expect(ceiling).toEqual({ max: NOTE_REVIEW_MAX, measure: "note_without_evidence" });
      } else if (act === "relay_rejection") {
        expect(ceiling).toEqual({ max: NOTE_RELAY_TEXT_MAX, measure: "text" });
      } else {
        expect(ceiling).toEqual({ max: NOTE_JOURNAL_MAX, measure: "note" });
      }
    }
    expect([NOTE_REVIEW_MAX, NOTE_RELAY_TEXT_MAX, NOTE_JOURNAL_MAX, NOTE_CARRY_MAX]).toEqual([4000, 2000, 8000, 800]);
  });
});

// ---------------------------------------------------------------- golden corpus

const GOLDEN: Array<[string, string, NoteFields]> = [
  [
    "note",
    [
      "note: the cache warms in 40 ms on a cold start",
      "",
      "Measured on three runs after a clean build.",
      "",
      "To: claude-air",
      "Why: three timed runs on this machine (seen 1)",
      "Evidence: test bun test tests/cache.test.ts exit=0 runs=3",
      "Limits: one machine; no remote cache",
      "Purpose: decide whether the warm-up step is worth keeping",
    ].join("\n"),
    fields({
      act: "note",
      statement: "the cache warms in 40 ms on a cold start",
      body: "Measured on three runs after a clean build.",
      to: "claude-air",
      why: [why("three timed runs on this machine", "seen", [1])],
      evidence: ["test bun test tests/cache.test.ts exit=0 runs=3"],
      limits: "one machine; no remote cache",
      purpose: "decide whether the warm-up step is worth keeping",
    }),
  ],
  [
    "support",
    [
      "support: renew does not bump the task version",
      "",
      `Re: report:${R1}`,
      "Why: renewLeaseForSession updates only lease_expires_at (seen 1)",
      "Evidence: file packages/collab/src/store.ts:2739-2779",
    ].join("\n"),
    fields({
      act: "support",
      statement: "renew does not bump the task version",
      re: `report:${R1}`,
      why: [why("renewLeaseForSession updates only lease_expires_at", "seen", [1])],
      evidence: ["file packages/collab/src/store.ts:2739-2779"],
    }),
  ],
  [
    "challenge",
    [
      "challenge: the migration drops the old index before the copy finishes",
      "",
      `Re: report:${R1}`,
      "Why: the DROP runs in step 2 and the copy in step 3 (seen 1)",
      "Why: the reviewer of the last migration said the same (told)",
      "Evidence: file migrations/0007.sql:10-24",
      "Evidence: commit 9f2c4e1",
      `Replaces: report:${R2}`,
    ].join("\n"),
    fields({
      act: "challenge",
      statement: "the migration drops the old index before the copy finishes",
      re: `report:${R1}`,
      why: [
        why("the DROP runs in step 2 and the copy in step 3", "seen", [1]),
        why("the reviewer of the last migration said the same", "told"),
      ],
      evidence: ["file migrations/0007.sql:10-24", "commit 9f2c4e1"],
      replaces: `report:${R2}`,
    }),
  ],
  [
    "resolve",
    [
      "resolve: my objection is answered",
      "",
      "Re: report#3fa91c",
      "Why: the copy now runs before the drop (seen 1)",
      "Evidence: commit 0a1b2c3d4e5f",
    ].join("\n"),
    fields({
      act: "resolve",
      statement: "my objection is answered",
      re: "report#3fa91c",
      why: [why("the copy now runs before the drop", "seen", [1])],
      evidence: ["commit 0a1b2c3d4e5f"],
    }),
  ],
  [
    "withdraw",
    [
      "withdraw: disregard my earlier timing note",
      "",
      `Re: report:${R2}`,
      "Why: the timings came from a debug build (inferred)",
    ].join("\n"),
    fields({
      act: "withdraw",
      statement: "disregard my earlier timing note",
      re: `report:${R2}`,
      why: [why("the timings came from a debug build", "inferred")],
    }),
  ],
  [
    "accept",
    [
      "accept: the lease fix does what the task asked",
      "",
      `Re: report:${R3}`,
      "Why: the new test covers the expired-lease path (seen 1)",
      "Evidence: test bun test tests/session-fit.test.ts exit=0",
      "Limits: did not run the full suite",
    ].join("\n"),
    fields({
      act: "accept",
      statement: "the lease fix does what the task asked",
      re: `report:${R3}`,
      why: [why("the new test covers the expired-lease path", "seen", [1])],
      evidence: ["test bun test tests/session-fit.test.ts exit=0"],
      limits: "did not run the full suite",
    }),
  ],
  [
    "request_changes",
    [
      "request_changes: the fix misses the recover path",
      "",
      `Re: task:${T1}`,
      "Why: recoverTaskForSession still writes the old version (seen 1)",
      "Evidence: file packages/collab/src/store.ts:2754-2877",
    ].join("\n"),
    fields({
      act: "request_changes",
      statement: "the fix misses the recover path",
      re: `task:${T1}`,
      why: [why("recoverTaskForSession still writes the old version", "seen", [1])],
      evidence: ["file packages/collab/src/store.ts:2754-2877"],
    }),
  ],
  [
    "decide",
    [
      "decide: install the notes build on this Mac",
      "",
      `Re: proposal:${R1}`,
      `Evidence: report:${R1}`,
      `Evidence: event:${E1}`,
      "Extent: replace the installed collab bundle on this Mac only",
      "  nothing on any other device",
    ].join("\n"),
    fields({
      act: "decide",
      statement: "install the notes build on this Mac",
      re: `proposal:${R1}`,
      evidence: [`report:${R1}`, `event:${E1}`],
      extent: "replace the installed collab bundle on this Mac only\nnothing on any other device",
    }),
  ],
  [
    "relay_rejection",
    [
      "relay_rejection: the person said not this week",
      "",
      `Re: proposal:${R2}`,
      "Via: host:claude-code",
      "Why: the person said so in our chat (told)",
    ].join("\n"),
    fields({
      act: "relay_rejection",
      statement: "the person said not this week",
      re: `proposal:${R2}`,
      via: "host:claude-code",
      why: [why("the person said so in our chat", "told")],
    }),
  ],
  [
    "take",
    [
      "take: fix the doorbell retry",
      "",
      "Purpose: stop the watcher from dropping a ring after one failure",
    ].join("\n"),
    fields({
      act: "take",
      statement: "fix the doorbell retry",
      purpose: "stop the watcher from dropping a ring after one failure",
    }),
  ],
  [
    "done",
    [
      "done: the doorbell keeps its anchor after a failed ring",
      "",
      "The retry backs off from 5 s and stops after six failures.",
      "",
      "    anchor = rang ? covered : anchor;",
      "",
      "Re: task#0b12de",
      "Why: the new watcher test fails on the old code and passes now (seen 1,2)",
      "Evidence: test bun test tests/claude-doorbell-watch.test.ts exit=0",
      "Evidence: commit 1ec5ab4b",
      "Limits: not run against a live host",
    ].join("\n"),
    fields({
      act: "done",
      statement: "the doorbell keeps its anchor after a failed ring",
      body: "The retry backs off from 5 s and stops after six failures.\n\n    anchor = rang ? covered : anchor;",
      re: "task#0b12de",
      why: [why("the new watcher test fails on the old code and passes now", "seen", [1, 2])],
      evidence: ["test bun test tests/claude-doorbell-watch.test.ts exit=0", "commit 1ec5ab4b"],
      limits: "not run against a live host",
    }),
  ],
  [
    "propose",
    [
      "propose: install the notes build on this Mac",
      "",
      "Should this Mac run the notes build for a week?",
      "",
      "Why: the forward-compat harness passes for four revisions (seen 1)",
      "Evidence: test bun test tests/forward-compat.test.ts exit=0",
      "Limits: one device",
      "Extent: replace the installed collab bundle on this Mac only",
      "X-Topic: install",
    ].join("\n"),
    fields({
      act: "propose",
      statement: "install the notes build on this Mac",
      body: "Should this Mac run the notes build for a week?",
      why: [why("the forward-compat harness passes for four revisions", "seen", [1])],
      evidence: ["test bun test tests/forward-compat.test.ts exit=0"],
      limits: "one device",
      extent: "replace the installed collab bundle on this Mac only",
      trailers: [{ key: "X-Topic", value: "install" }],
    }),
  ],
  [
    "poll",
    [
      "poll: which layout should the cache use?",
      "",
      "Criteria: fewest writes per open",
      "Option: a — one table per workspace",
      "Option: b — one shared table",
      "Pick: 1",
      "Quorum: 2",
      "Closes: 2026-11-12T18:00:00Z",
    ].join("\n"),
    fields({
      act: "poll",
      statement: "which layout should the cache use?",
      trailers: [
        { key: "Criteria", value: "fewest writes per open" },
        { key: "Option", value: "a — one table per workspace" },
        { key: "Option", value: "b — one shared table" },
        { key: "Pick", value: "1" },
        { key: "Quorum", value: "2" },
        { key: "Closes", value: "2026-11-12T18:00:00Z" },
      ],
    }),
  ],
  [
    "vote",
    [
      "vote: b",
      "",
      `Re: ballot:${R3}`,
      "Why: one shared table halves the writes on open (inferred 1)",
      `Evidence: data open-trace sha256=${HEX}`,
    ].join("\n"),
    fields({
      act: "vote",
      statement: "b",
      re: `ballot:${R3}`,
      why: [why("one shared table halves the writes on open", "inferred", [1])],
      evidence: [`data open-trace sha256=${HEX}`],
    }),
  ],
  [
    "note to the person, across channels",
    [
      "note: the lab agent raises a 0.4.0 reader concern",
      "",
      "To: person",
      "Re: lobby:room_7471#5",
      "Via: lobby:room_7471#5",
      "Why: the lab desk's room message says its journal is opened by 0.4.0 (told 1)",
      "Why: the lab desk quoted its MCP config (quoted 2)",
      "Evidence: msg lobby room_7471#5",
      "Evidence: url https://example.org/collab/0.4.0",
      "Limits: per-device journals; this is not a voice here",
    ].join("\n"),
    fields({
      act: "note",
      statement: "the lab agent raises a 0.4.0 reader concern",
      to: "person",
      re: "lobby:room_7471#5",
      via: "lobby:room_7471#5",
      why: [
        why("the lab desk's room message says its journal is opened by 0.4.0", "told", [1]),
        why("the lab desk quoted its MCP config", "quoted", [2]),
      ],
      evidence: ["msg lobby room_7471#5", "url https://example.org/collab/0.4.0"],
      limits: "per-device journals; this is not a voice here",
    }),
  ],
  [
    "carrying render keys and every journal evidence kind",
    [
      "propose: retire the old courier binding",
      "",
      `To: ${S1}`,
      `Re: proposal:${R1}`,
      `Evidence: artifact:artifact_${HEX.slice(0, 8)}`,
      `Evidence: checkpoint:${HEX}`,
      `Evidence: report:${R2}`,
      `Sha256: ${HEX}`,
      "Position: consented — 2 voices, 0 standing challenges",
      "Result: top_choice b (2 of 3 units)",
      "Not-carried: nothing",
    ].join("\n"),
    fields({
      act: "propose",
      statement: "retire the old courier binding",
      re: `proposal:${R1}`,
      to: S1,
      evidence: [`artifact:artifact_${HEX.slice(0, 8)}`, `checkpoint:${HEX}`, `report:${R2}`],
      trailers: [
        { key: "Sha256", value: HEX },
        { key: "Position", value: "consented — 2 voices, 0 standing challenges" },
        { key: "Result", value: "top_choice b (2 of 3 units)" },
        { key: "Not-carried", value: "nothing" },
      ],
    }),
  ],
];

describe("golden corpus", () => {
  test("covers every act", () => {
    const acts = new Set(GOLDEN.map(([, , expected]) => expected.act));
    expect([...NOTE_ACTS].filter((act) => !acts.has(act))).toEqual([]);
  });

  for (const [name, text, expected] of GOLDEN) {
    test(`${name}: parses with no advice and renders to the same bytes`, () => {
      expect(parseNote(text)).toEqual({ ...expected, advice: [] });
      expect(renderNote(expected)).toBe(text);
      expect(checkNote(expected)).toEqual([]);
    });
  }

  test("the field order of the rendered trailers is fixed, whatever the input order", () => {
    const text = [
      "challenge: x",
      "",
      `Replaces: report:${R2}`,
      "Evidence: commit 9f2c4e1",
      "Limits: l",
      "Why: w (seen 1)",
      `Re: report:${R1}`,
    ].join("\n");
    expect(renderNote(withoutAdvice(parseNote(text)) as NoteFields)).toBe([
      "challenge: x",
      "",
      `Re: report:${R1}`,
      "Why: w (seen 1)",
      "Evidence: commit 9f2c4e1",
      "Limits: l",
      `Replaces: report:${R2}`,
    ].join("\n"));
  });
});

// ---------------------------------------------------------------- trailer edge cases

describe("trailers", () => {
  test("continuation lines join one-line values with spaces and keep multi-line values", () => {
    const parsed = parseNote([
      "note: wrapped trailers read as one value",
      "",
      "Why: renewLeaseForSession updates only",
      "  lease_expires_at (seen 1)",
      "Evidence: file packages/collab/src/store.ts:2739-2779",
      "Limits: one store build",
      "\tno live journal was opened",
      "X-Context: first",
      "    second",
    ].join("\n"));
    expect(parsed.advice).toEqual([]);
    expect(parsed.why).toEqual([why("renewLeaseForSession updates only lease_expires_at", "seen", [1])]);
    expect(parsed.limits).toBe("one store build\nno live journal was opened");
    expect(parsed.trailers).toEqual([{ key: "X-Context", value: "first\nsecond" }]);
    expect(renderNote(withoutAdvice(parsed) as NoteFields)).toBe([
      "note: wrapped trailers read as one value",
      "",
      "Why: renewLeaseForSession updates only lease_expires_at (seen 1)",
      "Evidence: file packages/collab/src/store.ts:2739-2779",
      "Limits: one store build",
      "  no live journal was opened",
      "X-Context: first",
      "  second",
    ].join("\n"));
  });

  test("a value may start on its continuation line", () => {
    const parsed = parseNote("note: x\n\nLimits:\n  one\n  two");
    expect(parsed.limits).toBe("one\ntwo");
    expect(parsed.body).toBeNull();
    expect(parsed.advice).toEqual([]);
  });

  test("a final paragraph that is not all trailers is body", () => {
    const parsed = parseNote("note: x\n\nWhy: a reason (seen)\nand this line is prose");
    expect(parsed.why).toEqual([]);
    expect(parsed.body).toBe("Why: a reason (seen)\nand this line is prose");
    expect(parsed.advice).toEqual([
      "Line 3 looks like a Why: trailer but is in the body; trailers are read only from the last paragraph, with no blank line between them.",
    ]);
  });

  test("a blank line between trailers leaves the earlier ones in the body, and says so", () => {
    const parsed = parseNote("note: x\n\nWhy: a (seen 1)\n\nEvidence: commit 1ec5ab4b");
    expect(parsed.body).toBe("Why: a (seen 1)");
    expect(parsed.why).toEqual([]);
    expect(parsed.evidence).toEqual(["commit 1ec5ab4b"]);
    expect(parsed.advice).toHaveLength(1);
    expect(parsed.advice[0]).toContain("Line 3 looks like a Why: trailer");
  });

  test("an indented line that opens the final paragraph is body", () => {
    const parsed = parseNote("note: x\n\n    Re: report:abc");
    expect(parsed.re).toBeNull();
    expect(parsed.body).toBe("    Re: report:abc");
  });

  test("unknown keys stay in the body, in order, with advice; known keys around them are read", () => {
    const parsed = parseNote([
      "note: x",
      "",
      "Some prose.",
      "",
      "Why: a (inferred)",
      "Reviewed-by: astra",
      "  and claude-air",
      `Re: report:${R1}`,
      "Signed-off: me",
    ].join("\n"));
    expect(parsed.why).toEqual([why("a", "inferred")]);
    expect(parsed.re).toBe(`report:${R1}`);
    expect(parsed.body).toBe("Some prose.\n\nReviewed-by: astra\n  and claude-air\nSigned-off: me");
    expect(parsed.advice).toEqual([
      expect.stringContaining(`Line 6: "Reviewed-by:" is not a collab-note/1 key, so the line stays in the body.`),
      expect.stringContaining(`Line 9: "Signed-off:" is not a collab-note/1 key`),
    ]);
    // Re-rendering keeps the moved lines in the body and is then stable.
    const again = renderNote(withoutAdvice(parsed) as NoteFields);
    expect(withoutAdvice(parseNote(again))).toEqual(withoutAdvice(parsed));
  });

  test("a final paragraph of unknown keys only is body, unchanged", () => {
    const parsed = parseNote("note: the suite passes\n\nNote: it took 80 s.");
    expect(parsed.body).toBe("Note: it took 80 s.");
    expect(parsed.advice).toEqual([expect.stringContaining(`"Note:" is not a collab-note/1 key`)]);
    expect(renderNote(withoutAdvice(parsed) as NoteFields)).toBe("note: the suite passes\n\nNote: it took 80 s.");
  });

  test("X- keys are carried through with their spelling; an over-long X- key is unknown", () => {
    const longKey = `X-${"a".repeat(31)}`;
    const parsed = parseNote(`note: x\n\nX-Topic: install\nx-trace-id: 42\nX-Multi: one\n  two\n${longKey}: v`);
    expect(parsed.trailers).toEqual([
      { key: "X-Topic", value: "install" },
      { key: "x-trace-id", value: "42" },
      { key: "X-Multi", value: "one\ntwo" },
    ]);
    expect(parsed.body).toBe(`${longKey}: v`);
    expect(parsed.advice).toHaveLength(1);
    const rendered = renderNote({ act: "note", statement: "x", trailers: parsed.trailers });
    expect(rendered).toBe("note: x\n\nX-Topic: install\nx-trace-id: 42\nX-Multi: one\n  two");
  });

  test("keys and basis words are case-insensitive; render keys are spelled as listed", () => {
    const parsed = parseNote([
      "Challenge: x",
      "",
      `RE: report:${R1}`,
      "why: a (SEEN 1)",
      "eViDeNcE: commit abcdef1",
      "TO: person",
      `sha256: ${HEX}`,
      "not-carried: nothing",
    ].join("\n"));
    expect(parsed).toEqual({
      ...fields({
        act: "challenge",
        statement: "x",
        re: `report:${R1}`,
        to: "person",
        why: [why("a", "seen", [1])],
        evidence: ["commit abcdef1"],
        trailers: [{ key: "Sha256", value: HEX }, { key: "Not-carried", value: "nothing" }],
      }),
      advice: [],
    });
  });

  test("without a blank line, lines 2 onward are trailers only when all of them are", () => {
    expect(parseNote(`note: x\nTo: all\nRe: report:${R1}`)).toEqual({
      ...fields({ act: "note", statement: "x", to: "all", re: `report:${R1}` }),
      advice: [],
    });
    const prose = parseNote("note: x\nsecond line\nTo: all");
    expect(prose.to).toBeNull();
    expect(prose.body).toBe("second line\nTo: all");
    expect(prose.advice).toEqual([expect.stringContaining("Line 3 looks like a To: trailer")]);
  });

  test("a second single-valued key stays in the body", () => {
    const parsed = parseNote(`support: x\n\nRe: report:${R1}\nRe: report:${R2}`);
    expect(parsed.re).toBe(`report:${R1}`);
    expect(parsed.body).toBe(`Re: report:${R2}`);
    expect(parsed.advice).toEqual([`Line 4: a second "Re:" stays in the body; only the first one counts.`]);
  });

  test("a key with no value stays in the body", () => {
    const parsed = parseNote("note: x\n\nTo: all\nLimits:");
    expect(parsed.limits).toBeNull();
    expect(parsed.to).toBe("all");
    expect(parsed.body).toBe("Limits:");
    expect(parsed.advice).toEqual([`Line 4: "Limits:" has no value, so the line stays in the body.`]);
  });

  test("a body line missing the space after a key is named", () => {
    const parsed = parseNote(`note: x\n\nRe:report:${R1}`);
    expect(parsed.re).toBeNull();
    expect(parsed.body).toBe(`Re:report:${R1}`);
    expect(parsed.advice).toEqual(["Line 3 looks like a Re: trailer but has no space after the colon, so it is body text."]);
  });

  test("blank-line runs and first-line indentation inside the body are kept", () => {
    const parsed = parseNote("note: x\n\n\n    code()\n\n\nmore\n\n\nTo: all");
    expect(parsed.body).toBe("    code()\n\n\nmore");
    expect(parsed.to).toBe("all");
    expect(renderNote(withoutAdvice(parsed) as NoteFields)).toBe("note: x\n\n    code()\n\n\nmore\n\nTo: all");
  });
});

describe("the first line", () => {
  test("acts are case-insensitive and need a colon and a space", () => {
    expect(parseNote("CHALLENGE: x").act).toBe("challenge");
    expect(parseNote("Request_Changes: x").act).toBe("request_changes");
    expect(parseNote("relay_rejection: x").act).toBe("relay_rejection");
    const noSpace = parseNote("challenge:x");
    expect(noSpace.act).toBeNull();
    expect(noSpace.statement).toBe("challenge:x");
  });

  test("a first line with no known act is the statement, with advice", () => {
    const parsed = parseNote("hello there\n\nTo: all");
    expect(parsed.act).toBeNull();
    expect(parsed.statement).toBe("hello there");
    expect(parsed.to).toBe("all");
    expect(parsed.advice).toEqual([expect.stringContaining("Line 1 does not begin with a known act")]);
    expect(parseNote("notes: x").act).toBeNull();
    expect(parseNote("claim: x").act).toBeNull();
  });

  test("an act with an empty statement is read, with advice", () => {
    const parsed = parseNote("note:");
    expect(parsed.act).toBe("note");
    expect(parsed.statement).toBe("");
    expect(parsed.advice).toEqual([`Line 1: "note:" has no statement after it.`]);
  });

  test("acts that need Re: are named when it is missing", () => {
    for (const act of NOTE_ACTS_NEEDING_RE) {
      expect(parseNote(`${act}: x`).advice).toEqual([`"${act}" needs a Re: line naming what it answers.`]);
    }
    expect(parseNote("note: x").advice).toEqual([]);
  });

  test("an empty text parses to nothing, with advice", () => {
    const parsed = parseNote("");
    expect(parsed.act).toBeNull();
    expect(parsed.statement).toBe("");
    expect(parsed.body).toBeNull();
  });
});

// ---------------------------------------------------------------- reasons

describe("Why: reasons", () => {
  const reasonOf = (value: string) => {
    const parsed = parseNote(`note: x\n\nWhy: ${value}\nEvidence: commit abcdef1\nEvidence: commit abcdef2\nEvidence: commit abcdef3`);
    return { reason: parsed.why[0], advice: parsed.advice };
  };

  test("basis marks, with and without cites", () => {
    expect(reasonOf("plain reason")).toEqual({ reason: why("plain reason"), advice: [] });
    expect(reasonOf("a (seen)")).toEqual({ reason: why("a", "seen"), advice: [] });
    expect(reasonOf("a (told 1,2)")).toEqual({ reason: why("a", "told", [1, 2]), advice: [] });
    expect(reasonOf("a (quoted 1, 3)")).toEqual({ reason: why("a", "quoted", [1, 3]), advice: [] });
    expect(reasonOf("a (Inferred 2)")).toEqual({ reason: why("a", "inferred", [2]), advice: [] });
    expect(reasonOf("a(seen 1)")).toEqual({ reason: why("a", "seen", [1]), advice: [] });
    expect(reasonOf("a (seen 1 2)")).toEqual({ reason: why("a", "seen", [1, 2]), advice: [] });
    expect(reasonOf("x (told) (seen 1)")).toEqual({ reason: why("x (told)", "seen", [1]), advice: [] });
    expect(reasonOf("the docs say (seen) (unmarked)")).toEqual({ reason: why("the docs say (seen)"), advice: [] });
    expect(reasonOf("a (unmarked 1,2)")).toEqual({ reason: why("a", null, [1, 2]), advice: [] });
  });

  test("a parenthesis that is not a basis mark stays text, with advice", () => {
    const { reason, advice } = reasonOf("the build failed (seen yesterday)");
    expect(reason).toEqual(why("the build failed (seen yesterday)"));
    expect(advice).toEqual([expect.stringContaining("not a basis mark")]);
    expect(reasonOf("it ran (twice)")).toEqual({ reason: why("it ran (twice)"), advice: [] });
  });

  test("cites count from 1 and must name an Evidence line; the parser keeps them and says so", () => {
    expect(reasonOf("a (seen 4)").advice).toEqual([
      "Line 3: cites Evidence 4, but the note has 3 Evidence line(s).",
    ]);
    expect(reasonOf("a (seen 0)").advice).toEqual([
      "Line 3: cite 0 is not an Evidence position; cites count from 1.",
    ]);
    expect(reasonOf("(seen 1)")).toEqual({
      reason: why("", "seen", [1]),
      advice: ["Line 3: this Why: has a basis but no reason before it."],
    });
  });

  test("rendering marks what would otherwise read as a basis", () => {
    const render = (reason: NoteReason) =>
      renderNote({ act: "note", statement: "x", why: [reason], evidence: ["commit abcdef1", "commit abcdef2"] })
        .split("\n")[2];
    expect(render(why("a"))).toBe("Why: a");
    expect(render(why("a", "seen"))).toBe("Why: a (seen)");
    expect(render(why("a", null, [2]))).toBe("Why: a (unmarked 2)");
    expect(render(why("the docs say (seen)"))).toBe("Why: the docs say (seen) (unmarked)");
    expect(render(why("built (seen yesterday)"))).toBe("Why: built (seen yesterday) (unmarked)");
    expect(render(why("x (told 1)", "seen", [2, 1]))).toBe("Why: x (told 1) (seen 2,1)");
  });
});

// ---------------------------------------------------------------- evidence

describe("evidence", () => {
  test("every form parses", () => {
    const cases: Array<[string, NoteEvidence]> = [
      ["file packages/collab/src/store.ts:2739-2779", { kind: "file", locator: "packages/collab/src/store.ts:2739-2779", attrs: {} }],
      ["file README.md", { kind: "file", locator: "README.md", attrs: {} }],
      [`file docs/a b.md:3 sha256=${HEX}`, { kind: "file", locator: "docs/a b.md:3", attrs: { sha256: HEX } }],
      ["commit 9f2c4e1", { kind: "commit", locator: "9f2c4e1", attrs: {} }],
      [
        `test FOO=1 bun test exit=0 runs=3 out=sha256:${HEX}`,
        { kind: "test", locator: "FOO=1 bun test", attrs: { exit: "0", runs: "3", out: `sha256:${HEX}` } },
      ],
      ["test make V=1 exit=2", { kind: "test", locator: "make V=1", attrs: { exit: "2" } }],
      ["test run exit=1 exit=0", { kind: "test", locator: "run exit=1", attrs: { exit: "0" } }],
      ["url https://example.org/a?b=1", { kind: "url", locator: "https://example.org/a?b=1", attrs: {} }],
      [`data open-trace sha256=${HEX}`, { kind: "data", locator: "open-trace", attrs: { sha256: HEX } }],
      ["msg slack C123 1700000000.0001", { kind: "msg", locator: "slack C123 1700000000.0001", attrs: {} }],
      [`report:${R1}`, { kind: "report", locator: R1, attrs: {} }],
      [`event:${E1}`, { kind: "event", locator: E1, attrs: {} }],
      ["artifact:artifact_1", { kind: "artifact", locator: "artifact_1", attrs: {} }],
      [`checkpoint:${HEX}`, { kind: "checkpoint", locator: HEX, attrs: {} }],
      ["report#3fa91c", { kind: "report", locator: "report#3fa91c", attrs: {} }],
      ["proposal#3fa91c", { kind: "report", locator: "proposal#3fa91c", attrs: {} }],
      ["FILE a.ts EXIT=0", { kind: "file", locator: "a.ts", attrs: { exit: "0" } }],
    ];
    for (const [text, expected] of cases) expect(parseEvidence(text)).toEqual(expected);
  });

  test("unreadable evidence is refused with the forms", () => {
    const bad = [
      "",
      "a\nb",
      "commit HEAD",
      "url not a url",
      "msg only",
      `task:${T1}`,
      "file a.ts:5-2",
      "file a.ts:0",
      "file :3",
      "test x exit=zero",
      "data x sha256=nothex",
      "photo x.png",
      "report:",
    ];
    for (const text of bad) {
      const error = thrown(() => parseEvidence(text));
      expect(error.code).toBe("invalid_evidence");
      expect(error.message).toContain("Evidence forms:");
    }
    expect(thrown(() => parseEvidence(`task:${T1}`)).message).toContain("cite its completion report");
  });

  test("renderEvidence writes attributes in a fixed order and refuses what would read back differently", () => {
    expect(renderEvidence({ kind: "test", locator: "bun test", attrs: { runs: "2", exit: "0" } })).toBe("test bun test exit=0 runs=2");
    expect(renderEvidence({ kind: "report", locator: R1, attrs: {} })).toBe(`report:${R1}`);
    expect(renderEvidence({ kind: "report", locator: "proposal#3fa91c", attrs: {} })).toBe("report:proposal#3fa91c");
    expect(parseEvidence("report:proposal#3fa91c")).toEqual({ kind: "report", locator: "proposal#3fa91c", attrs: {} });
    expect(thrown(() => renderEvidence({ kind: "test", locator: `cmd sha256=${HEX}`, attrs: {} })).code).toBe("invalid_evidence");
    expect(thrown(() => renderEvidence({ kind: "commit", locator: "HEAD", attrs: {} })).code).toBe("invalid_evidence");
  });

  test("file locators split into a path and a 1-based range", () => {
    expect(fileLocatorParts("src/a.ts:10-24")).toEqual({ path: "src/a.ts", from: 10, to: 24 });
    expect(fileLocatorParts("src/a.ts:7")).toEqual({ path: "src/a.ts", from: 7, to: 7 });
    expect(fileLocatorParts("src/a.ts")).toEqual({ path: "src/a.ts", from: null, to: null });
  });

  test("a note keeps an unreadable evidence line and says so", () => {
    const parsed = parseNote("note: x\n\nEvidence: commit HEAD");
    expect(parsed.evidence).toEqual(["commit HEAD"]);
    expect(parsed.advice).toEqual([expect.stringContaining("Line 3: Evidence 1 is not a known evidence form")]);
  });
});

describe("references", () => {
  test("Re: and Replaces: forms", () => {
    expect(parseNoteRef(`report:${R1}`)).toEqual({ kind: "report", id: R1, handle: false });
    expect(parseNoteRef(`proposal:${R1}`)).toEqual({ kind: "proposal", id: R1, handle: false });
    expect(parseNoteRef(`ballot:${R1}`)).toEqual({ kind: "ballot", id: R1, handle: false });
    expect(parseNoteRef(`task:${T1}`)).toEqual({ kind: "task", id: T1, handle: false });
    expect(parseNoteRef(`event:${E1}`)).toEqual({ kind: "event", id: E1, handle: false });
    expect(parseNoteRef("report#3fa91c")).toEqual({ kind: "report", id: "report#3fa91c", handle: true });
    expect(parseNoteRef("ballot#3FA91C")).toEqual({ kind: "ballot", id: "ballot#3FA91C", handle: true });
    expect(parseNoteRef("proposal:report#3fa91c")).toEqual({ kind: "proposal", id: "report#3fa91c", handle: true });
    expect(parseNoteRef(R1)).toEqual({ kind: "report", id: R1, handle: false });
    expect(parseNoteRef(T1)).toEqual({ kind: "task", id: T1, handle: false });
    expect(parseNoteRef("file:notes/inbox.md#2")).toEqual({ kind: "file", id: "notes/inbox.md#2", handle: false });
    expect(parseNoteRef("lobby:room_7471#5")).toEqual({ kind: "lobby", id: "room_7471#5", handle: false });
    expect(parseNoteRef("msg:slack thread 42")).toEqual({ kind: "msg", id: "slack thread 42", handle: false });
    for (const bad of ["whatever", "report#3fa9", "session:x", "report:", "lobby:a b"]) expect(parseNoteRef(bad)).toBeNull();
    expect(isNoteHandle("task#0b12de")).toBe(true);
    expect(isNoteHandle(T1)).toBe(false);
  });

  test("unknown references and channels are kept, with advice", () => {
    const parsed = parseNote("note: x\n\nRe: whatever\nVia: slack");
    expect(parsed.re).toBe("whatever");
    expect(parsed.via).toBe("slack");
    expect(parsed.advice).toEqual([
      expect.stringContaining(`"Re: whatever" is not a known reference`),
      expect.stringContaining(`"Via: slack" is not a known channel`),
    ]);
  });
});

// ---------------------------------------------------------------- normalisation

describe("normalisation", () => {
  test("strips the BOM, every bidi control and tag characters", () => {
    expect(normalizeNoteText("﻿note: x")).toBe("note: x");
    for (const control of ["؜", "‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"]) {
      expect(normalizeNoteText(`note: pay ${control}evil${control}`)).toBe("note: pay evil");
    }
    expect(normalizeNoteText("note: x\u{E0001}\u{E0068}\u{E0069}\u{E007F}")).toBe("note: x");
  });

  test("turns CRLF and a lone CR into LF and trims trailing spaces and tabs", () => {
    expect(normalizeNoteText("note: x\r\n\r\nTo: all\r")).toBe("note: x\n\nTo: all");
    expect(normalizeNoteText("note: x\r\rTo: all")).toBe("note: x\n\nTo: all");
    expect(normalizeNoteText("note: x \t\n\nTo: all  \n  \n")).toBe("note: x\n\nTo: all");
    // An invisible character between CR and LF does not make a blank line.
    expect(normalizeNoteText("note: x\r‎\nTo: all")).toBe("note: x\nTo: all");
  });

  test("trims the whole text, is idempotent, and leaves other characters alone", () => {
    expect(normalizeNoteText("\n\n  note: x\n\n")).toBe("note: x");
    const kept = "note: 👩‍💻 a b 共筆 ​zero-width";
    expect(normalizeNoteText(kept)).toBe(kept);
    const messy = "﻿\n note: a ‮\r\n\r\n body \t\r\n\r\nTo: all ⁦ ";
    expect(normalizeNoteText(normalizeNoteText(messy))).toBe(normalizeNoteText(messy));
  });

  test("parsing runs on the normalised text", () => {
    const parsed = parseNote("﻿support: x \r\n\r\nW‎hy: a (seen 1) \r\nRe: report:abc‮\r\nEvidence: commit abcdef1\t");
    expect(parsed).toEqual({
      ...fields({
        act: "support",
        statement: "x",
        re: "report:abc",
        why: [why("a", "seen", [1])],
        evidence: ["commit abcdef1"],
      }),
      advice: [],
    });
  });

  test("normalizeNoteFields brings loose input to render form without shortening", () => {
    const loose = normalizeNoteFields({
      act: "Note" as NoteAct,
      statement: ` ${"s".repeat(300)} ‎`,
      body: "\r\n\r\n    code \r\nline\t\r\n\r\n",
      to: " claude-air\n",
      re: "",
      via: "host:\nclaude",
      why: [{ text: " a\nb ", basis: "Seen" as NoteBasis }, { text: "c" }],
      evidence: [" commit abcdef1 ", ""],
      limits: "one\n\n  two  \n",
      purpose: "   ",
      extent: "e",
      replaces: null,
      trailers: [{ key: "sha256", value: ` ${HEX} ` }, { key: "X-Empty", value: " \n " }, { key: "x-k", value: "a\n\nb" }],
    });
    expect(loose).toEqual(fields({
      act: "note",
      statement: "s".repeat(300),
      body: "    code\nline",
      to: "claude-air",
      via: "host: claude",
      why: [why("a b", "seen"), why("c")],
      evidence: ["commit abcdef1"],
      limits: "one\ntwo",
      extent: "e",
      trailers: [{ key: "Sha256", value: HEX }, { key: "x-k", value: "a\nb" }],
    }));
    // A statement with a line break is left for renderNote to refuse with the remedy.
    expect(normalizeNoteFields({ act: "note", statement: "a\nb" }).statement).toBe("a\nb");
  });

  test("splitNoteText reads a statement and a body with no trailer parsing", () => {
    expect(splitNoteText("﻿first line \r\n\r\nTo: all\r\n")).toEqual({ statement: "first line", body: "To: all" });
    expect(splitNoteText("only")).toEqual({ statement: "only", body: null });
  });
});

// ---------------------------------------------------------------- caps

describe("caps", () => {
  const capProblem = (input: Parameters<typeof checkNoteCaps>[0]) => checkNoteCaps(input);

  test("statement: 200 passes; 201 is statement_too_long with the remedy, in check and in render", () => {
    expect(capProblem({ act: "note", statement: "s".repeat(NOTE_STATEMENT_MAX) })).toEqual([]);
    expect(capProblem({ act: "note", statement: "s".repeat(201) })).toEqual([{
      code: "statement_too_long",
      field: "statement",
      max: 200,
      actual: 201,
      unit: "chars",
      message: "The statement is 201 characters; at most 200",
      remedy: STATEMENT_TOO_LONG_REMEDY,
    }]);
    const error = thrown(() => renderNote({ act: "note", statement: "s".repeat(201) }));
    expect(error.code).toBe("statement_too_long");
    expect(error.details).toEqual({ field: "statement", max: 200, actual: 201, unit: "chars", remedy: "put the rest after a blank line" });
  });

  test("Why: at most 8, each at most 300", () => {
    const reasons = (count: number, size = 10) => Array.from({ length: count }, () => ({ text: "w".repeat(size) }));
    expect(capProblem({ act: "note", statement: "x", why: reasons(NOTE_WHY_MAX, NOTE_WHY_TEXT_MAX) })).toEqual([]);
    expect(capProblem({ act: "note", statement: "x", why: reasons(9) })).toEqual([
      expect.objectContaining({ code: "too_long", field: "why", max: 8, actual: 9, unit: "items" }),
    ]);
    expect(capProblem({ act: "note", statement: "x", why: [{ text: "w".repeat(301) }] })).toEqual([
      expect.objectContaining({ code: "too_long", field: "why[0]", max: 300, actual: 301, unit: "chars" }),
    ]);
  });

  test("Evidence: at most 16 items, each at most 1,000", () => {
    const items = (count: number) => Array.from({ length: count }, (_, index) => `commit ${(index + 0x1000000).toString(16)}`);
    expect(capProblem({ act: "note", statement: "x", evidence: items(NOTE_EVIDENCE_MAX) })).toEqual([]);
    expect(capProblem({ act: "note", statement: "x", evidence: items(17) })).toEqual([
      expect.objectContaining({ code: "too_long", field: "evidence", max: 16, actual: 17, unit: "items" }),
    ]);
    const long = `test ${"x".repeat(NOTE_VALUE_MAX - 5)}`;
    expect(long.length).toBe(1000);
    expect(capProblem({ act: "note", statement: "x", evidence: [long] })).toEqual([]);
    expect(capProblem({ act: "note", statement: "x", evidence: [`${long}y`] })).toEqual([
      expect.objectContaining({ code: "too_long", field: "evidence[0]", max: 1000, actual: 1001 }),
    ]);
  });

  test("limits 2,000, purpose 200, extent 1,000, other values 1,000", () => {
    const cases: Array<[keyof NoteFields, number, (size: number) => string]> = [
      ["limits", NOTE_LIMITS_MAX, (size) => "l".repeat(size)],
      ["purpose", NOTE_PURPOSE_MAX, (size) => "p".repeat(size)],
      ["extent", NOTE_EXTENT_MAX, (size) => "e".repeat(size)],
      ["to", NOTE_VALUE_MAX, (size) => "t".repeat(size)],
      ["re", NOTE_VALUE_MAX, (size) => `msg:${"r".repeat(size - 4)}`],
      ["via", NOTE_VALUE_MAX, (size) => `msg:${"v".repeat(size - 4)}`],
      ["replaces", NOTE_VALUE_MAX, (size) => `msg:${"r".repeat(size - 4)}`],
    ];
    for (const [field, max, make] of cases) {
      expect(checkNote({ act: "note", statement: "x", [field]: make(max) })).toEqual([]);
      expect(capProblem({ act: "note", statement: "x", [field]: make(max + 1) })).toEqual([
        expect.objectContaining({ code: "too_long", field, max, actual: max + 1, unit: "chars" }),
      ]);
    }
    const trailer = (size: number): NoteTrailer[] => [{ key: "X-Long", value: "v".repeat(size) }];
    expect(capProblem({ act: "note", statement: "x", trailers: trailer(1000) })).toEqual([]);
    expect(capProblem({ act: "note", statement: "x", trailers: trailer(1001) })).toEqual([
      expect.objectContaining({ code: "too_long", field: "trailers[0]", max: 1000, actual: 1001 }),
    ]);
  });

  // A body of exactly the size that makes the measured note `size` long.
  function noteOfLength(act: NoteAct, size: number, extra: Partial<NoteFields> = {}): NoteFields {
    const base = fields({ act, statement: "x", body: "b", ...extra });
    const measure = NOTE_ACT_CEILINGS[act].measure;
    const measured = (note: NoteFields) =>
      measure === "text"
        ? `${note.statement}\n\n${note.body}`.length
        : renderNote(note, { omitEvidence: measure === "note_without_evidence" }).length;
    return { ...base, body: "b".repeat(size - measured(base) + 1) };
  }

  test("journal notes stop at 8,000", () => {
    for (const act of ["note", "support", "challenge", "decide", "propose", "poll"] as NoteAct[]) {
      const re = NOTE_ACTS_NEEDING_RE.includes(act) ? `report:${R1}` : null;
      const exact = noteOfLength(act, NOTE_JOURNAL_MAX, { re });
      expect(renderNote(exact).length).toBe(8000);
      const over = { ...exact, body: `${exact.body}b` };
      expect(checkNoteCaps(over)).toEqual([
        expect.objectContaining({ code: "too_long", field: "note", max: 8000, actual: 8001 }),
      ]);
      expect(thrown(() => renderNote(over)).details).toEqual(
        expect.objectContaining({ field: "note", max: 8000, actual: 8001, unit: "chars" }),
      );
    }
  });

  test("done, accept and request_changes stop at 4,000 without their Evidence lines", () => {
    const evidence = Array.from({ length: 16 }, (_, index) => `test bun test tests/case-${index}.test.ts exit=0`);
    for (const act of ["done", "accept", "request_changes"] as NoteAct[]) {
      const re = act === "done" ? null : `report:${R1}`;
      const exact = noteOfLength(act, NOTE_REVIEW_MAX, { re, evidence, why: [why("w", "seen", [16])] });
      expect(renderNote(exact, { omitEvidence: true }).length).toBe(4000);
      expect(renderNote(exact).length).toBeGreaterThan(4000);
      const over = { ...exact, body: `${exact.body}b` };
      expect(checkNoteCaps(over)).toEqual([
        expect.objectContaining({ code: "too_long", field: "note", max: 4000, actual: 4001 }),
      ]);
    }
  });

  test("relay_rejection text (statement and body) stops at 2,000; trailers do not count", () => {
    const reasons = Array.from({ length: 8 }, () => why("w".repeat(290), "told"));
    const exact = noteOfLength("relay_rejection", NOTE_RELAY_TEXT_MAX, { re: `proposal:${R1}`, why: reasons });
    expect(renderNote(exact).length).toBeGreaterThan(2000);
    expect(checkNoteCaps(exact)).toEqual([]);
    expect(checkNoteCaps({ ...exact, body: `${exact.body}b` })).toEqual([
      expect.objectContaining({ code: "too_long", field: "text", max: 2000, actual: 2001 }),
    ]);
  });

  test("maxChars refuses a longer note; noteProblemError keeps the details", () => {
    const note = fields({ act: "note", statement: "x".repeat(50) });
    expect(renderNote(note, { maxChars: 56 })).toHaveLength(56);
    const error = thrown(() => renderNote(note, { maxChars: 55 }));
    expect(error.code).toBe("too_long");
    expect(error.details).toEqual({ field: "note", max: 55, actual: 56, unit: "chars" });
    expect(thrown(() => renderNote(note, { maxChars: 0 })).code).toBe("invalid_note_field");
    const converted = noteProblemError({ code: "too_long", field: "limits", message: "m", max: 2000, actual: 2001, unit: "chars" });
    expect(converted).toBeInstanceOf(CollabError);
    expect([converted.code, converted.message, converted.details]).toEqual([
      "too_long",
      "m",
      { field: "limits", max: 2000, actual: 2001, unit: "chars" },
    ]);
  });
});

// ---------------------------------------------------------------- refusals

describe("render refuses what it cannot write faithfully", () => {
  const firstProblem = (input: Parameters<typeof checkNote>[0]) => checkNote(input)[0];

  test("each refusal names its field, and renderNote throws the same", () => {
    const cases: Array<[Parameters<typeof checkNote>[0], string, string]> = [
      [{ act: "claim" as NoteAct, statement: "x" }, "invalid_note_field", "act"],
      [{ act: "note", statement: "" }, "invalid_note_field", "statement"],
      [{ act: "note", statement: "x " }, "invalid_note_field", "statement"],
      [{ act: "note", statement: "x‎" }, "invalid_note_field", "statement"],
      [{ act: "note", statement: "x", body: "\nb" }, "invalid_note_field", "body"],
      [{ act: "note", statement: "x", body: "b\n" }, "invalid_note_field", "body"],
      [{ act: "note", statement: "x", body: "b \nc" }, "invalid_note_field", "body"],
      [{ act: "note", statement: "x", body: "b\r\nc" }, "invalid_note_field", "body"],
      [{ act: "note", statement: "x", body: "b " }, "invalid_note_field", "body"],
      [{ act: "note", statement: "x", to: "a\nb" }, "invalid_note_field", "to"],
      [{ act: "note", statement: "x", limits: "a\n\nb" }, "invalid_note_field", "limits"],
      [{ act: "note", statement: "x", extent: "a\n  b" }, "invalid_note_field", "extent"],
      [{ act: "note", statement: "x", re: "whatever" }, "invalid_ref", "re"],
      [{ act: "note", statement: "x", replaces: "session:x" }, "invalid_ref", "replaces"],
      [{ act: "note", statement: "x", via: "slack" }, "invalid_via", "via"],
      [{ act: "note", statement: "x", why: [{ text: "w", basis: "think" as NoteBasis }] }, "invalid_note_field", "why[0].basis"],
      [{ act: "note", statement: "x", why: [{ text: "w", cites: [0] }] }, "invalid_note_field", "why[0].cites"],
      [{ act: "note", statement: "x", why: [{ text: "w", cites: [1.5] }] }, "invalid_note_field", "why[0].cites"],
      [{ act: "note", statement: "x", why: [{ text: "" }] }, "invalid_note_field", "why[0]"],
      [{ act: "note", statement: "x", why: [{ text: "a\nb" }] }, "invalid_note_field", "why[0]"],
      [{ act: "note", statement: "x", why: [{ text: "w", cites: [2] }], evidence: ["commit abcdef1"] }, "cite_out_of_range", "why[0].cites"],
      [{ act: "note", statement: "x", evidence: ["commit HEAD"] }, "invalid_evidence", "evidence[0]"],
      [{ act: "note", statement: "x", evidence: ["commit abcdef1 "] }, "invalid_note_field", "evidence[0]"],
      [{ act: "note", statement: "x", trailers: [{ key: "Re", value: "report:x" }] }, "invalid_note_field", "trailers[0].key"],
      [{ act: "note", statement: "x", trailers: [{ key: "Ref", value: "v" }] }, "invalid_note_field", "trailers[0].key"],
      [{ act: "note", statement: "x", trailers: [{ key: "sha256", value: HEX }] }, "invalid_note_field", "trailers[0].key"],
      [{ act: "note", statement: "x", trailers: [{ key: "Sha256", value: "abc" }] }, "invalid_note_field", "trailers[0].value"],
      [{ act: "note", statement: "x", trailers: [{ key: "X-a", value: "" }] }, "invalid_note_field", "trailers[0].value"],
    ];
    for (const [input, code, field] of cases) {
      expect(firstProblem(input)).toEqual(expect.objectContaining({ code, field }));
      const error = thrown(() => renderNote(input));
      expect([error.code, error.details.field]).toEqual([code, field]);
    }
    expect(firstProblem({ act: "note", statement: "a\nb" })).toEqual(
      expect.objectContaining({ field: "statement", remedy: STATEMENT_TOO_LONG_REMEDY }),
    );
    expect(firstProblem({ act: "note", statement: "x", trailers: [{ key: "Re", value: "report:x" }] })?.message)
      .toContain("set re instead");
  });

  test("acts that need Re: are refused without it", () => {
    for (const act of NOTE_ACTS_NEEDING_RE) {
      expect(firstProblem({ act, statement: "x" })).toEqual(expect.objectContaining({ code: "re_required", field: "re" }));
      expect(renderNote({ act, statement: "x", re: `report:${R1}` })).toBe(`${act}: x\n\nRe: report:${R1}`);
    }
  });

  test("a body whose last paragraph would read as trailers needs a trailer after it", () => {
    const body = "Some context.\n\nWhy: inline (seen)";
    expect(firstProblem({ act: "note", statement: "x", body })).toEqual(
      expect.objectContaining({ code: "invalid_note_field", field: "body" }),
    );
    const withTrailer = renderNote({ act: "note", statement: "x", body, to: "all" });
    expect(withoutAdvice(parseNote(withTrailer))).toEqual(fields({ act: "note", statement: "x", body, to: "all" }));
    // Unknown keys stay in the body, so such a paragraph needs nothing after it.
    expect(renderNote({ act: "note", statement: "x", body: "Note: fine" })).toBe("note: x\n\nNote: fine");
    // A known key with no value stays in the body as well.
    expect(renderNote({ act: "note", statement: "x", body: "Limits:" })).toBe("note: x\n\nLimits:");
  });

  test("omitEvidence leaves Evidence lines out but still checks cites against them", () => {
    const note = fields({ act: "done", statement: "x", why: [why("w", "seen", [2])], evidence: ["commit abcdef1", "commit abcdef2"] });
    expect(renderNote(note, { omitEvidence: true })).toBe("done: x\n\nWhy: w (seen 2)");
    expect(thrown(() => renderNote({ ...note, evidence: ["commit abcdef1"] }, { omitEvidence: true })).code).toBe("cite_out_of_range");
  });

  test("values of the wrong type are refused, not crashed on", () => {
    expect(thrown(() => renderNote({ act: "note", statement: "x", why: "w" as never })).code).toBe("invalid_note_field");
    const junk = {
      act: "note",
      statement: 5,
      body: 7,
      to: 1,
      why: [{ text: 3, cites: "1" }],
      evidence: [9],
      trailers: [{ key: 2, value: 4 }],
    } as never;
    const problems = checkNote(junk);
    expect(problems.map((problem) => problem.field)).toEqual(
      ["statement", "body", "to", "why[0]", "why[0].cites", "evidence[0]", "trailers[0].key"],
    );
    expect(thrown(() => renderNote(junk)).details.field).toBe("statement");
  });
});

// ---------------------------------------------------------------- generated inputs

/** mulberry32: a small seeded generator, so every run sees the same inputs. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Gen {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = seeded(seed);
  }
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }
  chance(probability: number): boolean {
    return this.next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }
  hex(size: number): string {
    return Array.from({ length: size }, () => "0123456789abcdef"[this.int(0, 15)]).join("");
  }
}

const CLEAN_WORDS = [
  "cache", "lease", "renew", "the", "version", "test", "passes", "fails", "café", "共筆", "🙂", "x=1",
  "exit=0", "—", "…", "50%", "naïve", "Ω", "tabs\there", "report_abc", "#3", "https://example.org/a?b=1",
  "(maybe)", "a,b", "\"quoted\"", "it's", "→", "ü", "é",
];
const TRICKY_WORDS = [...CLEAN_WORDS, "a:", "Why:", "Re:", "note:", "(seen)", "(told 1)", "X-a:", ":", "(", ")"];
const TO_POOL = ["claude-air", "person", "all", S1, "fable/reviewer", "Astra 2"];
const VIA_POOL = ["host:claude-code", "lobby:room_7471#5", "msg:slack thread 42", "file:notes/inbox.md#3"];

interface GenOptions {
  tricky: boolean;
  /** Full ids only, and room for long bodies (carrying tests). */
  carry?: boolean;
}

function uuid(gen: Gen): string {
  return `${gen.hex(8)}-${gen.hex(4)}-4${gen.hex(3)}-8${gen.hex(3)}-${gen.hex(12)}`;
}

function genRef(gen: Gen, carry: boolean): string {
  const full = [
    () => `report:report_${uuid(gen)}`,
    () => `proposal:report_${uuid(gen)}`,
    () => `ballot:report_${uuid(gen)}`,
    () => `task:task_${uuid(gen)}`,
    () => `event:event_${uuid(gen)}`,
    () => `report_${uuid(gen)}`,
    () => "file:notes/inbox.md#2",
    () => "lobby:room_7471#5",
    () => "msg:slack C123 1700000000.0001",
  ];
  const handles = [() => `report#${gen.hex(6)}`, () => `task#${gen.hex(6)}`, () => `proposal:report#${gen.hex(6)}`];
  return gen.pick(carry ? full : [...full, ...handles])();
}

function genWords(gen: Gen, words: readonly string[], low: number, high: number, max = Infinity): string {
  const count = gen.int(low, high);
  let text = "";
  for (let index = 0; index < count; index += 1) {
    const word = gen.pick(words);
    const next = text === "" ? word : `${text} ${word}`;
    if (next.length > max) break;
    text = next;
  }
  return text === "" ? gen.pick(words).slice(0, max) : text;
}

function genEvidence(gen: Gen, carry: boolean): NoteEvidence {
  const kind = gen.pick(["file", "commit", "test", "url", "data", "msg", "report", "event", "artifact", "checkpoint", "handle"] as const);
  switch (kind) {
    case "file": {
      const path = gen.pick(["src/a.ts", "packages/collab/src/store.ts", "docs/x y.md", "a/b.c"]);
      const from = gen.int(1, 400);
      const locator = gen.chance(0.5) ? `${path}:${from}-${from + gen.int(0, 40)}` : path;
      return { kind, locator, attrs: gen.chance(0.3) ? { sha256: gen.hex(64) } : {} };
    }
    case "commit":
      return { kind, locator: gen.hex(gen.int(7, 40)), attrs: {} };
    case "test": {
      const attrs: NoteEvidence["attrs"] = {};
      if (gen.chance(0.8)) attrs.exit = String(gen.int(0, 2));
      if (gen.chance(0.3)) attrs.runs = String(gen.int(1, 9));
      if (gen.chance(0.2)) attrs.out = `sha256:${gen.hex(64)}`;
      const command = gen.pick(["bun test", "bun test tests/note.test.ts", "make V=1", "FOO=1 bun run ci", "bun  test  --bail"]);
      return { kind, locator: command, attrs };
    }
    case "url":
      return { kind, locator: gen.pick(["https://example.org/a", "https://example.org/a?b=c#d", "mailto:x@example.org"]), attrs: {} };
    case "data":
      return { kind, locator: gen.pick(["open-trace", "bench results"]), attrs: { sha256: gen.hex(64) } };
    case "msg":
      return { kind, locator: gen.pick(["lobby room_7471#5", "slack C123 1700000000.0001"]), attrs: {} };
    case "report":
      return { kind, locator: `report_${uuid(gen)}`, attrs: {} };
    case "event":
      return { kind, locator: `event_${uuid(gen)}`, attrs: {} };
    case "artifact":
      return { kind, locator: `artifact_${uuid(gen)}`, attrs: {} };
    case "checkpoint":
      return { kind, locator: gen.hex(64), attrs: {} };
    case "handle":
      return carry
        ? { kind: "report", locator: `report_${uuid(gen)}`, attrs: {} }
        : { kind: "report", locator: `${gen.pick(["report", "proposal", "ballot"])}#${gen.hex(6)}`, attrs: {} };
  }
}

function genBody(gen: Gen, options: GenOptions): string | null {
  if (gen.chance(0.35)) return null;
  const words = options.tricky ? TRICKY_WORDS : CLEAN_WORDS;
  const paragraphs = gen.int(1, options.carry ? 12 : 4);
  const parts: string[] = [];
  for (let index = 0; index < paragraphs; index += 1) {
    const lines: string[] = [];
    const count = gen.int(1, 3);
    for (let line = 0; line < count; line += 1) {
      let text = genWords(gen, words, 1, options.carry ? 20 : 8);
      if (options.tricky && gen.chance(0.15)) text = `${gen.pick(["Why: ", "Foo: ", "X-Note: ", "Re: ", "Limits:"])}${text}`;
      if (gen.chance(0.15)) text = `    ${text}`;
      lines.push(text);
    }
    parts.push(lines.join("\n"));
  }
  return parts.join(gen.chance(0.2) ? "\n\n\n" : "\n\n");
}

function genMultiline(gen: Gen, words: readonly string[], max: number): string {
  const lines = Array.from({ length: gen.int(1, 3) }, () => genWords(gen, words, 1, 6));
  return lines.join("\n").slice(0, max).trim();
}

function genNote(gen: Gen, options: GenOptions): NoteFields {
  const words = options.tricky ? TRICKY_WORDS : CLEAN_WORDS;
  const carry = options.carry === true;
  const act = gen.pick(NOTE_ACTS);
  const evidence = Array.from({ length: gen.chance(0.4) ? 0 : gen.int(1, 16) }, () => renderEvidence(genEvidence(gen, carry)));
  const reasons = Array.from({ length: gen.chance(0.3) ? 0 : gen.int(1, 8) }, (): NoteReason => {
    let text = genWords(gen, words, 1, 12, 280);
    if (options.tricky && gen.chance(0.2)) text = `${text} ${gen.pick(["(seen)", "(told 2)", "(seen yesterday)", "(unmarked)", "(quoted 1, 2)"])}`;
    const basis = gen.pick([null, ...["seen", "told", "inferred", "quoted"] as NoteBasis[]]);
    const cites = evidence.length > 0 && gen.chance(0.6)
      ? Array.from({ length: gen.int(1, 3) }, () => gen.int(1, evidence.length))
      : [];
    return { text, basis, cites };
  });
  const trailers: NoteTrailer[] = Array.from({ length: gen.chance(0.5) ? 0 : gen.int(1, 3) }, () =>
    gen.pick([
      () => ({ key: "X-Topic", value: genWords(gen, words, 1, 5) }),
      () => ({ key: "x-multi", value: genMultiline(gen, words, 300) }),
      () => ({ key: "Position", value: genWords(gen, words, 1, 6) }),
      () => ({ key: "Sha256", value: gen.hex(64) }),
      () => ({ key: "Option", value: `a — ${genWords(gen, words, 1, 4)}` }),
      () => ({ key: "Closes", value: "2026-11-12T18:00:00Z" }),
    ])(),
  );
  return {
    act,
    statement: genWords(gen, words, 1, 14, NOTE_STATEMENT_MAX),
    body: genBody(gen, options),
    to: gen.chance(0.3) ? gen.pick(TO_POOL) : null,
    re: NOTE_ACTS_NEEDING_RE.includes(act) || gen.chance(0.5) ? genRef(gen, carry) : null,
    via: gen.chance(0.2) ? gen.pick(VIA_POOL) : null,
    why: reasons,
    evidence,
    limits: gen.chance(0.4) ? genMultiline(gen, words, 600) : null,
    purpose: gen.chance(0.3) ? genWords(gen, words, 1, 10, NOTE_PURPOSE_MAX) : null,
    extent: gen.chance(0.3) ? genMultiline(gen, words, 600) : null,
    replaces: gen.chance(0.2) ? genRef(gen, carry) : null,
    trailers,
  };
}

describe("round trip over generated notes", () => {
  test("parseNote(renderNote(x)) equals x, with no advice for clean notes", () => {
    const gen = new Gen(0x5eed_0001);
    for (let index = 0; index < 1500; index += 1) {
      const note = genNote(gen, { tricky: false });
      expect(checkNote(note)).toEqual([]);
      const text = renderNote(note);
      expect(normalizeNoteText(text)).toBe(text);
      expect(text.trim()).toBe(text);
      expect(parseNote(text)).toEqual({ ...note, advice: [] });
    }
  });

  test("tricky notes round-trip their fields, or are refused exactly as checkNote says", () => {
    const gen = new Gen(0x5eed_0002);
    let rendered = 0;
    let refusedBody = 0;
    for (let index = 0; index < 2500; index += 1) {
      const note = genNote(gen, { tricky: true });
      const problems = checkNote(note);
      if (problems.length > 0) {
        expect(problems).toEqual([expect.objectContaining({ code: "invalid_note_field", field: "body" })]);
        expect(thrown(() => renderNote(note)).code).toBe("invalid_note_field");
        refusedBody += 1;
        continue;
      }
      const text = renderNote(note);
      expect(normalizeNoteText(text)).toBe(text);
      expect(withoutAdvice(parseNote(text))).toEqual(note);
      rendered += 1;
    }
    // The generator mostly makes notes render can write.
    expect(rendered).toBeGreaterThan(2200);
    expect(refusedBody).toBeGreaterThan(0);
  });

  test("structured evidence round-trips through renderEvidence", () => {
    const gen = new Gen(0x5eed_0003);
    for (let index = 0; index < 2000; index += 1) {
      const evidence = genEvidence(gen, false);
      expect(parseEvidence(renderEvidence(evidence))).toEqual(evidence);
    }
  });

  test("noise that normalisation removes changes nothing a parse returns", () => {
    const gen = new Gen(0x5eed_0004);
    const invisible = ["﻿", "؜", "‎", "‏", "‪", "‮", "⁦", "⁩", "\u{E0041}", "\u{E007F}"];
    for (let index = 0; index < 800; index += 1) {
      const text = renderNote(genNote(gen, { tricky: false }));
      const points = Array.from(text);
      for (let insert = gen.int(0, 6); insert > 0; insert -= 1) {
        points.splice(gen.int(0, points.length), 0, gen.pick(invisible));
      }
      const noisy = "﻿\n " + points.join("")
        .split("\n")
        .map((line) => (gen.chance(0.3) ? `${line}${gen.pick([" ", "\t", "  \t"])}` : line))
        .join(gen.chance(0.5) ? "\r\n" : "\n") + " \r\n\r\n";
      expect(parseNote(noisy)).toEqual(parseNote(text));
    }
  });
});

// ---------------------------------------------------------------- carrying

describe("the carrying render", () => {
  const base = fields({
    act: "propose",
    statement: "install the notes build on this Mac",
    re: `proposal:${R1}`,
    why: [why("the harness passes for four revisions", "seen", [1])],
    evidence: ["test bun test tests/forward-compat.test.ts exit=0"],
    extent: "replace the installed collab bundle on this Mac only",
    trailers: [{ key: "Sha256", value: HEX }, { key: "Position", value: "consented — 2 voices, 0 standing challenges" }],
  });

  test("a note that fits is carried whole, with the disclaimer and Not-carried: nothing", () => {
    const carried = renderCarriedNote(base);
    expect(carried.not_carried).toEqual([]);
    expect(carried.text).toBe([
      "propose: install the notes build on this Mac",
      "",
      NOTE_CARRY_DISCLAIMER,
      "",
      `Re: proposal:${R1}`,
      "Why: the harness passes for four revisions (seen 1)",
      "Evidence: test bun test tests/forward-compat.test.ts exit=0",
      "Extent: replace the installed collab bundle on this Mac only",
      `Sha256: ${HEX}`,
      "Position: consented — 2 voices, 0 standing challenges",
      "Not-carried: nothing",
    ].join("\n"));
    expect(parseNote(carried.text)).toEqual({
      ...base,
      body: NOTE_CARRY_DISCLAIMER,
      trailers: [...base.trailers, { key: "Not-carried", value: "nothing" }],
      advice: [],
    });
  });

  test("a long body is shortened, marked with an ellipsis and named", () => {
    const body = `${"word ".repeat(300).trim()}\n\nsecond paragraph`;
    const carried = renderCarriedNote({ ...base, body });
    expect(carried.text.length).toBeLessThanOrEqual(NOTE_CARRY_MAX);
    expect(carried.not_carried).toHaveLength(1);
    expect(carried.not_carried[0]).toMatch(new RegExp(`^body \\(first \\d+ of ${body.length} chars\\)$`));
    const parsed = parseNote(carried.text);
    expect(parsed.body!.endsWith(`…\n\n${NOTE_CARRY_DISCLAIMER}`)).toBe(true);
    expect(body.startsWith(parsed.body!.split("…")[0]!)).toBe(true);
    expect(parsed.trailers.at(-1)).toEqual({ key: "Not-carried", value: carried.not_carried[0]! });
    expect(parsed.extent).toBe(base.extent);
    expect(parsed.why).toEqual(base.why);
  });

  test("X- trailers go before the body is touched; Evidence goes from the end, keeping cite numbers", () => {
    const evidence = Array.from({ length: 16 }, (_, index) => `test bun test tests/case-${String(index + 1).padStart(2, "0")}.test.ts exit=0`);
    const carried = renderCarriedNote({
      ...base,
      body: "short body",
      why: [why("first", "seen", [1]), why("last", "seen", [16])],
      evidence,
      trailers: [...base.trailers, { key: "X-Trace", value: "t".repeat(40) }],
    });
    expect(carried.text.length).toBeLessThanOrEqual(NOTE_CARRY_MAX);
    const parsed = parseNote(carried.text);
    expect(parsed.body).toBe(`short body\n\n${NOTE_CARRY_DISCLAIMER}`);
    expect(parsed.evidence).toEqual(evidence.slice(0, parsed.evidence.length));
    expect(parsed.why).toEqual([why("first", "seen", [1]), why("last", "seen", [16])]);
    expect(carried.not_carried).toEqual([`evidence ${parsed.evidence.length + 1}-16`, "X-Trace"]);
    expect(parsed.advice).toEqual([expect.stringContaining("cites Evidence 16")]);
  });

  test("handles are refused: a carried note names full ids", () => {
    for (const input of [
      { ...base, re: "proposal#3fa91c" },
      { ...base, replaces: "report:report#3fa91c" },
      { ...base, evidence: ["report#3fa91c"] },
      { ...base, evidence: ["report:proposal#3fa91c"] },
    ]) {
      expect(thrown(() => renderCarriedNote(input)).code).toBe("not_carriable");
    }
  });

  test("local details are withheld and named, never rewritten", () => {
    const carried = renderCarriedNote({
      ...base,
      body: "the log is in /Users/someone/collab/log.txt",
      limits: "measured in ws_0123456789abcdef01234567",
      purpose: "check the MacAir-Two journal",
      why: [why("seen on dev.local", "seen"), why("kept reason", "told")],
      evidence: ["file src/a.ts", "file /private/tmp/x/y.ts", "commit abcdef1"],
      trailers: [...base.trailers, { key: "X-Where", value: "~/collab" }],
    }, { localTerms: ["macair-two"] });
    expect(carried.not_carried).toEqual([
      "body (local detail)",
      "why 1 (local detail)",
      "evidence 2-3 (local detail)",
      "limits (local detail)",
      "purpose (local detail)",
      "X-Where (local detail)",
    ]);
    const parsed = parseNote(carried.text);
    expect(parsed.body).toBe(NOTE_CARRY_DISCLAIMER);
    expect(parsed.limits).toBeNull();
    expect(parsed.purpose).toBeNull();
    expect(parsed.why).toEqual([why("kept reason", "told")]);
    expect(parsed.evidence).toEqual(["file src/a.ts"]);
    expect(carried.text).not.toMatch(/Users|ws_0|tmp|MacAir|dev\.local|~\//i);
    expect(thrown(() => renderCarriedNote({ ...base, statement: "see ~/notes/x" })).code).toBe("not_carriable");
    const device = renderCarriedNote({ ...base, limits: "only on Someones-MacBook-Pro" });
    expect(device.not_carried).toEqual(["limits (local detail)"]);
  });

  test("an over-long statement is shortened to the cap and named", () => {
    const statement = "q".repeat(500);
    const carried = renderCarriedNote({ ...base, statement });
    const parsed = parseNote(carried.text);
    expect(parsed.statement).toBe(`${"q".repeat(199)}…`);
    expect(carried.not_carried).toEqual(["statement (first 199 of 500 chars)"]);
  });

  test("a Not-carried trailer in the input is replaced, not repeated", () => {
    const carried = renderCarriedNote({ ...base, trailers: [{ key: "Not-carried", value: "old" }] });
    expect(parseNote(carried.text).trailers).toEqual([{ key: "Not-carried", value: "nothing" }]);
  });

  test("a smaller budget is honoured, and an impossible one refused", () => {
    const carried = renderCarriedNote({ ...base, body: "b ".repeat(200).trim() }, { maxChars: 400 });
    expect(carried.text.length).toBeLessThanOrEqual(400);
    expect(thrown(() => renderCarriedNote(base, { maxChars: 120 })).code).toBe("too_long");
  });

  test("over generated notes: at most 800, nothing cut without being named", () => {
    const gen = new Gen(0x5eed_0005);
    let cut = 0;
    for (let index = 0; index < 600; index += 1) {
      const note = genNote(gen, { tricky: index % 2 === 1, carry: true });
      const carried = renderCarriedNote(note);
      expect(carried.text.length).toBeLessThanOrEqual(NOTE_CARRY_MAX);
      const parsed = parseNote(carried.text);
      const named = (label: string) => carried.not_carried.some((entry) => entry === label || entry.startsWith(`${label} `));
      expect(parsed.act).toBe(note.act);
      expect(parsed.statement).toBe(note.statement);
      expect(parsed.re).toBe(note.re);
      expect(parsed.trailers.at(-1)).toEqual({ key: "Not-carried", value: carried.not_carried.join("; ") || "nothing" });
      expect(parsed.body === NOTE_CARRY_DISCLAIMER || parsed.body!.endsWith(`\n\n${NOTE_CARRY_DISCLAIMER}`)).toBe(true);
      const carriedBody = parsed.body === NOTE_CARRY_DISCLAIMER ? null : parsed.body!.slice(0, -(NOTE_CARRY_DISCLAIMER.length + 2));
      if (carriedBody !== note.body) expect(named("body")).toBe(true);
      for (const field of ["to", "via", "limits", "purpose", "extent", "replaces"] as const) {
        if (parsed[field] !== note[field]) expect(named(field)).toBe(true);
      }
      expect(parsed.evidence).toEqual(note.evidence.slice(0, parsed.evidence.length));
      if (parsed.evidence.length < note.evidence.length) expect(named("evidence")).toBe(true);
      expect(parsed.why).toEqual(note.why.slice(0, parsed.why.length));
      if (parsed.why.length < note.why.length) expect(named("why")).toBe(true);
      for (const trailer of note.trailers) {
        const before = note.trailers.filter((item) => item.key === trailer.key).length;
        const after = parsed.trailers.filter((item) => item.key === trailer.key && item.value === trailer.value).length;
        if (after < note.trailers.filter((item) => item.key === trailer.key && item.value === trailer.value).length) {
          expect(named(trailer.key)).toBe(true);
        }
        expect(before).toBeGreaterThan(0);
      }
      if (note.trailers.some((trailer) => trailer.key === "Sha256")) {
        expect(parsed.trailers.filter((trailer) => trailer.key === "Sha256")).toEqual(
          note.trailers.filter((trailer) => trailer.key === "Sha256"),
        );
      }
      if (carried.not_carried.length === 0) {
        expect(withoutAdvice(parsed)).toEqual({
          ...note,
          body: note.body === null ? NOTE_CARRY_DISCLAIMER : `${note.body}\n\n${NOTE_CARRY_DISCLAIMER}`,
          trailers: [...note.trailers, { key: "Not-carried", value: "nothing" }],
        });
      } else {
        cut += 1;
      }
    }
    expect(cut).toBeGreaterThan(100);
  });
});
