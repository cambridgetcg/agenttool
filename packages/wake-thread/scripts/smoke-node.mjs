import {
  createWakeThreadOffer,
  nextThreadPosition,
  resolveWakeThreadOffer,
  sha256Id,
  validateWakeThreadChain,
} from "../dist/index.js";

const ref = (label) => sha256Id(`wake-thread-node-smoke:${label}`);
const offer = createWakeThreadOffer({
  observed_at: "2026-08-01T12:00:00.000Z",
  expires_at: "2026-08-01T12:05:00.000Z",
  purpose: "Node import smoke test.",
  artifact_retention: { mode: "until", until: "2026-08-01T12:10:00.000Z" },
  recipient_ref: null,
  thread_ref: ref("thread"),
  parent_receipt: null,
  wake: {
    artifact_sha256: ref("wake"),
    format: "brief",
    scope: "mixed",
    coverage: "partial",
    source_revision: "smoke",
    caller_held_cursor_ref: ref("cursor"),
  },
  facts: [{
    kind: "unknown",
    summary: "The smoke test carries one synthetic bounded fact.",
    source_pointer: "/synthetic",
    evidence_class: "given",
    evidence_ref: ref("fact"),
  }],
  omissions: [{ area: "other_state", reason: "Not part of this smoke test.", count: null }],
});
const receipt = resolveWakeThreadOffer(offer, {
  reported_choice: "fork",
  responded_at: "2026-08-01T12:00:01.000Z",
  branch_ref: ref("forked-thread"),
  note_ref: null,
});
const childOffer = createWakeThreadOffer({
  observed_at: "2026-08-01T12:00:02.000Z",
  expires_at: "2026-08-01T12:05:00.000Z",
  purpose: "Child offer linked via nextThreadPosition.",
  artifact_retention: { mode: "ephemeral", until: null },
  recipient_ref: null,
  ...nextThreadPosition(receipt, "2026-08-01T12:00:02.000Z"),
  wake: {
    artifact_sha256: ref("wake-2"),
    format: "brief",
    scope: "mixed",
    coverage: "partial",
    source_revision: "smoke",
    caller_held_cursor_ref: ref("cursor-2"),
  },
  facts: [{
    kind: "unknown",
    summary: "The child offer supplies fresh bounded facts explicitly.",
    source_pointer: "/synthetic",
    evidence_class: "given",
    evidence_ref: ref("fact-2"),
  }],
  omissions: [{ area: "other_state", reason: "Not part of this smoke test.", count: null }],
});
const childReceipt = resolveWakeThreadOffer(childOffer, {
  reported_choice: "rest",
  responded_at: "2026-08-01T12:00:03.000Z",
  branch_ref: null,
  note_ref: null,
});
const chain = validateWakeThreadChain([receipt, childReceipt]);
if (chain.length !== 2 || childOffer.thread_ref !== ref("forked-thread") || childReceipt.outcome !== "resting") {
  process.exit(1);
}
