import { afterEach, describe, expect, test } from "bun:test";
import { CONSENT_RULE_V2 } from "../src/protocol.js";
import { CollabError } from "../src/errors.js";
import { cleanup, journal, ok, runCleanup } from "./notes-helpers.js";

// A declared rest changes no standing on the Collab Notes and consent
// surfaces: they read presence only (active, and seen within their window),
// as leases do. A resting session that was seen recently is a consulted
// voice, still blocks a set-aside of its challenge, and is in a ballot's
// default electorate; one that has gone unseen drops out exactly as a session
// that never rested would.
void cleanup;
afterEach(runCleanup);

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function codeOf(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (error instanceof CollabError) return error.code;
    throw error;
  }
  return "no error";
}

describe("a rest changes no standing", () => {
  test("a resting session seen within 6 hours is a consulted voice when a proposal opens", () => {
    const j = journal();
    const author = j.start("author");
    const rester = j.start("rester");
    const quiet = j.start("quiet");
    j.store.restSessionForSession({ ...rester.credential, idempotency_key: "rest", mode: "resting" });
    const opened = j.store.openProposalForSession({
      ...author.credential, idempotency_key: "open", question: "Q?", criteria: "C", extent: "E", consult_seconds: 600,
    });
    const voices = opened.terms.voices.map((voice: { voice_id: string }) => voice.voice_id);
    expect(voices).toContain(rester.session.id);
    expect(voices).toContain(quiet.session.id);
  });

  test("a resting challenger seen within 6 hours still blocks a set-aside; after 6 hours unseen it no longer does", () => {
    const j = journal();
    const author = j.start("author");
    const peer = j.start("peer");
    const challenger = j.start("challenger");
    const opened = j.store.openProposalForSession({
      ...author.credential, idempotency_key: "open", question: "Q?", criteria: "C", extent: "E", consult_seconds: 600,
      rule: CONSENT_RULE_V2,
    });
    j.store.appendReportForSession({
      ...peer.credential, idempotency_key: "support", kind: "inference", body: "Yes.", relation: "supports", target_report_id: opened.proposal.id,
    });
    const challenge = j.store.appendReportForSession({
      ...challenger.credential, idempotency_key: "challenge", kind: "inference", body: "No.", relation: "challenges", target_report_id: opened.proposal.id,
    });
    j.store.restSessionForSession({ ...challenger.credential, idempotency_key: "rest", mode: "resting", wake_on: ["addressed"] });
    const setAside = () => {
      const shown = j.store.personSetAsideChallenge({ proposal_report_id: opened.proposal.id, challenge_report_id: challenge.id, reason: "Gone." });
      return j.store.recordSetAsideAtTerminal({
        proposal_report_id: opened.proposal.id,
        proposal_sha256: shown.proposal_sha256,
        challenge_report_id: challenge.id,
        challenge_sha256: shown.challenge_sha256,
        challenger_last_seen_at: shown.challenger_last_seen_at,
        reason: "Gone.",
        expected_ai_snapshot: shown.ai_snapshot,
      });
    };
    j.advance(601_000);
    expect(codeOf(setAside)).toBe("challenger_present");
    j.advance(6 * HOUR + 1_000);
    expect(setAside().ai.position).toBe("consented");
  });

  test("a resting session seen within 30 minutes is in a ballot's default electorate", async () => {
    const j = journal();
    const opener = j.start("opener");
    const openerServer = j.serve(opener);
    await ok(openerServer, "collab_inbox");
    const rester = j.start("rester");
    await ok(j.serve(rester), "collab_inbox");
    j.store.restSessionForSession({ ...rester.credential, idempotency_key: "rest", mode: "resting" });
    j.advance(10 * MINUTE);
    const opened = await ok(openerServer, "collab_poll", {
      question: "Which layout?", options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], closes: "30m", criteria: "Fewest writes.",
    });
    expect(opened.electorate.map((unit: { names: string[] }) => unit.names[0]).sort()).toEqual(["opener", "rester"]);
  });
});
