import { describe, expect, test } from "bun:test";

import {
  PROJECTION_POLICY_URN,
  correspondenceReceiptUrn,
  planCorrespondenceRecord,
} from "../src/index.js";
import {
  ARTIFACT_DIGEST,
  EVENT_ID,
  PARENT_EVENT_ID,
  PROJECT_ID,
  SECOND_PARENT_EVENT_ID,
  makeRecord,
} from "./fixtures.js";

const OPTIONS = {
  claimant: "service:correspondence-projector/run-42",
} as const;

function relationsWith(
  plan: ReturnType<typeof planCorrespondenceRecord>,
  word: string,
) {
  return plan.relations.filter((relation) => relation.word === word);
}

describe("planCorrespondenceRecord", () => {
  test("is deterministic for the same structural record", () => {
    const record = makeRecord();
    const first = planCorrespondenceRecord(record, OPTIONS);
    const second = planCorrespondenceRecord(record, OPTIONS);
    const cloned = planCorrespondenceRecord(structuredClone(record), OPTIONS);

    expect(second).toEqual(first);
    expect(cloned).toEqual(first);
    expect(first.cards.map((card) => card.address.id)).toEqual(
      second.cards.map((card) => card.address.id),
    );
    expect(first.relations.map((relation) => relation.id)).toEqual(
      second.relations.map((relation) => relation.id),
    );
  });

  test("marks copied cards cached and derived relations computed", () => {
    const plan = planCorrespondenceRecord(makeRecord(), OPTIONS);

    expect(plan.cards.length).toBe(6);
    expect(plan.relations.length).toBe(5);
    expect(plan.cards.every((card) => card.claim.how === "cached")).toBe(true);
    expect(plan.relations.every((relation) => relation.claim.how === "computed")).toBe(true);
    for (const relation of plan.relations) {
      expect(relation.claim.src).toContain(plan.source_event_urn);
      expect(relation.claim.src).toContain(PROJECTION_POLICY_URN);
    }
    expect(relationsWith(plan, "names_receipt")[0]?.claim.src).toEqual([
      plan.source_event_urn,
      correspondenceReceiptUrn(PROJECT_ID, EVENT_ID, "42"),
      PROJECTION_POLICY_URN,
    ]);
  });

  test("creates reference cards and depends_on threads for every parent", () => {
    const plan = planCorrespondenceRecord(
      makeRecord({
        parents: [PARENT_EVENT_ID, SECOND_PARENT_EVENT_ID],
        missingParents: [SECOND_PARENT_EVENT_ID],
      }),
      OPTIONS,
    );

    const references = plan.cards.filter(
      (card) =>
        card.address.deck === "events" &&
        card.fields.materialization === "reference_only",
    );
    expect(references.map((card) => card.fields.source_event_id)).toEqual([
      PARENT_EVENT_ID,
      SECOND_PARENT_EVENT_ID,
    ]);

    const dependencies = relationsWith(plan, "depends_on");
    expect(dependencies).toHaveLength(2);
    expect(new Set(dependencies.map((relation) => relation.to.ref))).toEqual(
      new Set(references.map((card) => card.address.ref)),
    );
  });

  test("maps acknowledgement targets without collapsing receipt semantics", () => {
    const plan = planCorrespondenceRecord(
      makeRecord({
        kind: "ack.applied",
        parents: [PARENT_EVENT_ID],
        body: {
          target_event_id: PARENT_EVENT_ID,
          result_revision: "b".repeat(40),
          detail: "private acknowledgement detail",
        },
      }),
      OPTIONS,
    );

    expect(relationsWith(plan, "depends_on")).toHaveLength(1);
    const [acknowledgement] = relationsWith(plan, "acknowledges");
    expect(acknowledgement).toBeDefined();
    expect(acknowledgement!.to.deck).toBe("events");
    expect(relationsWith(plan, "names_receipt")).toHaveLength(1);
    expect(
      plan.cards.filter((card) => card.address.deck === "receipts"),
    ).toHaveLength(1);
  });

  test("maps artifact identity but omits locator and event payload", () => {
    const plan = planCorrespondenceRecord(
      makeRecord({
        kind: "artifact.offer",
        body: {
          artifact: {
            kind: "git_patch",
            digest: ARTIFACT_DIGEST,
            locator: "https://private.example/secret.patch",
          },
          summary: "private artifact summary",
        },
      }),
      OPTIONS,
    );

    const artifactCards = plan.cards.filter(
      (card) => card.address.deck === "artifacts",
    );
    expect(artifactCards).toHaveLength(1);
    expect(artifactCards[0]!.fields).toEqual({
      artifact_kind: "git_patch",
      digest: ARTIFACT_DIGEST,
    });
    const [offer] = relationsWith(plan, "offers_artifact");
    expect(offer).toBeDefined();
    expect(offer!.to.ref).toBe(artifactCards[0]!.address.ref);
  });

  test("scopes project-local entities while content-addressing source events", () => {
    const plan = planCorrespondenceRecord(makeRecord(), OPTIONS);
    const event = plan.cards.find((card) => card.address.deck === "events");
    const identity = plan.cards.find((card) => card.address.deck === "identities");

    expect(event?.fields.source_event_id).toBe(EVENT_ID);
    expect(identity?.fields).toEqual({
      project_id: PROJECT_ID,
      source_identity_id: "22222222-2222-4222-8222-222222222222",
    });
  });

  test("uses the executing projector claimant without changing stable IDs", () => {
    const record = makeRecord();
    const first = planCorrespondenceRecord(record, OPTIONS);
    const second = planCorrespondenceRecord(record, {
      claimant: "service:correspondence-projector/run-43",
    });

    expect(first.cards.map((item) => item.address.id)).toEqual(
      second.cards.map((item) => item.address.id),
    );
    expect(first.relations.map((item) => item.id)).toEqual(
      second.relations.map((item) => item.id),
    );
    expect(first.cards.every((item) => item.claim.by === OPTIONS.claimant)).toBe(true);
    expect(second.relations.every(
      (item) => item.claim.by === "service:correspondence-projector/run-43",
    )).toBe(true);
  });

  test("keeps mutable lineage reconciliation out of immutable event cards", () => {
    const pending = planCorrespondenceRecord(
      makeRecord({
        parents: [PARENT_EVENT_ID],
        missingParents: [PARENT_EVENT_ID],
        lineageStatus: "pending",
      }),
      OPTIONS,
    );
    const reconciled = planCorrespondenceRecord(
      makeRecord({
        parents: [PARENT_EVENT_ID],
        missingParents: [],
        lineageStatus: "valid",
      }),
      OPTIONS,
    );

    expect(reconciled).toEqual(pending);
  });
});
