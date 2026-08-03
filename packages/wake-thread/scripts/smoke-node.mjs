import {
  createWakeThreadOffer,
  resolveWakeThreadOffer,
  sha256Id,
  validateWakeThreadChain,
} from "../dist/index.js";

const ref = (label) => sha256Id(`wake-thread-node-smoke:${label}`);
const offer = createWakeThreadOffer({
  observed_at: "2026-08-01T12:00:00.000Z",
  expires_at: "2026-08-01T12:01:00.000Z",
  purpose: "Node import smoke test.",
  artifact_retention: { mode: "ephemeral", until: null },
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
  reported_choice: "rest",
  responded_at: "2026-08-01T12:00:01.000Z",
  branch_ref: null,
  note_ref: null,
});
const chain = validateWakeThreadChain([receipt]);
if (chain.length !== 1 || receipt.outcome !== "resting") process.exit(1);
