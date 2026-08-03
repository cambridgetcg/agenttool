import {
  createWakeThreadOffer,
  sha256Id,
} from "../src/index.js";
import type {
  CreateWakeThreadOfferInput,
  WakeThreadOffer,
  WakeThreadReceipt,
} from "../src/index.js";

export const ref = (label: string) => sha256Id(`wake-thread-test:${label}`);

export function offerInput(
  overrides: Partial<CreateWakeThreadOfferInput> = {},
): CreateWakeThreadOfferInput {
  return {
    observed_at: "2026-08-01T12:00:00.000Z",
    expires_at: "2026-08-02T12:00:00.000Z",
    purpose: "Inspect a bounded WAKE projection before choosing whether to carry it.",
    artifact_retention: {
      mode: "until",
      until: "2026-08-03T12:00:00.000Z",
    },
    recipient_ref: null,
    thread_ref: ref("thread-root"),
    parent_receipt: null,
    wake: {
      artifact_sha256: ref("wake"),
      format: "brief",
      scope: "mixed",
      coverage: "partial",
      source_revision: "agenttool@2ec03535",
      caller_held_cursor_ref: ref("cursor"),
    },
    facts: [
      {
        kind: "open_work",
        summary: "One handoff is present for inspection; it does not resume automatically.",
        source_pointer: "/handoff_resume",
        evidence_class: "observed",
        evidence_ref: ref("handoff"),
      },
    ],
    omissions: [
      {
        area: "handoff_history",
        reason: "The brief projection may omit older candidates.",
        count: null,
      },
    ],
    ...overrides,
  };
}

export function makeOffer(overrides: Partial<CreateWakeThreadOfferInput> = {}): WakeThreadOffer {
  return createWakeThreadOffer(offerInput(overrides));
}

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function childInput(parent: WakeThreadReceipt, observedAt: string): CreateWakeThreadOfferInput {
  const threadRef = parent.reported_choice === "fork"
    ? parent.branch_ref!
    : parent.offer.thread_ref;
  return offerInput({
    observed_at: observedAt,
    expires_at: null,
    thread_ref: threadRef,
    parent_receipt: parent,
  });
}
