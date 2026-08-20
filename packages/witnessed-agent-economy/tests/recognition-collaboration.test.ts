import { describe, expect, test } from "bun:test";

import {
  collaborationEventHash,
  projectCollaborationCheckpoint,
  projectPublicRecognitionAdoption,
  projectPublicRecognitionWithdrawal,
  type CollaborationJournalEventSource,
} from "../src/index.js";
import { digest } from "./fixtures.js";

interface RecognitionVectors {
  adoption: { record: unknown };
  withdrawal: { record: unknown };
}

async function recognitionVectors(): Promise<RecognitionVectors> {
  return Bun.file(new URL(
    "../../public-surface-recognition/vectors/agenttool-public-surface-recognition-v0.1-vectors.json",
    import.meta.url,
  )).json() as Promise<RecognitionVectors>;
}

describe("public recognition projections", () => {
  test("binds exact root-signed adoption and withdrawal authority documents", async () => {
    const vectors = await recognitionVectors();
    const adopt = projectPublicRecognitionAdoption(vectors.adoption.record);
    expect(adopt.visibility).toBe("PUBLIC");
    expect(adopt.authority_sequence).toBe("17");
    const withdraw = projectPublicRecognitionWithdrawal({
      adoption: vectors.adoption.record,
      withdrawal: vectors.withdrawal.record,
      adoption_commitment: digest("a"),
    });
    expect(withdraw).toMatchObject({
      recognition_ref: adopt.recognition_ref,
      surface_digest: adopt.surface_digest,
      registry_digest: adopt.registry_digest,
      adoption_commitment: digest("a"),
      authority_sequence: "18",
      visibility: "PUBLIC",
    });
    expect(withdraw.withdrawal_document_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(withdraw.reason_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  test("rejects tampered or non-public source records", async () => {
    const vectors = await recognitionVectors();
    expect(() => projectPublicRecognitionAdoption({
      ...(vectors.adoption.record as Record<string, unknown>),
      requested_visibility: "private",
    })).toThrow();
    expect(() => projectPublicRecognitionWithdrawal({
      adoption: vectors.adoption.record,
      withdrawal: {
        ...(vectors.withdrawal.record as Record<string, unknown>),
        reason: "operator_request",
      },
      adoption_commitment: digest("a"),
    })).toThrow();
  });
});

function event(
  sequence: number,
  previous: string,
  actor: string,
  sessionId: string | null,
  workspaceId = "ws_111111111111111111111111",
  epochId = "epoch_11111111-1111-4111-8111-111111111111",
): CollaborationJournalEventSource {
  const candidate: CollaborationJournalEventSource = {
    workspace_id: workspaceId,
    epoch_id: epochId,
    sequence,
    id: `event-${sequence}`,
    protocol: "agenttool.collab/0.2",
    type: "task.updated",
    entity_id: `task-${sequence}`,
    actor,
    session_id: sessionId,
    occurred_at: `2026-08-20T10:0${sequence}:00.000Z`,
    payload_json: JSON.stringify({ status: sequence === 1 ? "claimed" : "completed" }),
    prev_hash: previous,
    hash: "0".repeat(64),
  };
  return { ...candidate, hash: collaborationEventHash(candidate) };
}

function collaborationProjection(options: {
  key?: string;
  workspace?: string;
  epoch?: string;
  actor?: string;
  session?: string | null;
} = {}) {
  const workspace = options.workspace ?? "ws_111111111111111111111111";
  const epoch = options.epoch ?? "epoch_11111111-1111-4111-8111-111111111111";
  const first = event(
    1,
    "0".repeat(64),
    options.actor ?? "agent-alpha",
    options.session === undefined ? "session-alpha" : options.session,
    workspace,
    epoch,
  );
  const second = event(2, first.hash, "agent-beta", "session-beta", workspace, epoch);
  return projectCollaborationCheckpoint({
    workspace: {
      id: workspace,
      epoch_id: epoch,
      event_head_sequence: 2,
      event_head_hash: second.hash,
    },
    events: [first, second],
    participant_blinding_key_hex: options.key ?? "ab".repeat(32),
  });
}

describe("pure collaboration journal checkpoint", () => {
  test("recomputes the complete append-only head and opaque participant set", () => {
    const first = event(1, "0".repeat(64), "agent-alpha", "session-alpha");
    const second = event(2, first.hash, "agent-beta", "session-beta");
    const projection = projectCollaborationCheckpoint({
      workspace: {
        id: first.workspace_id,
        epoch_id: first.epoch_id,
        event_head_sequence: 2,
        event_head_hash: second.hash,
      },
      events: [first, second],
      participant_blinding_key_hex: "ab".repeat(32),
    });
    expect(projection).toMatchObject({
      event_head_sequence: "2",
      event_head_hash: `sha256:${second.hash}`,
      event_count: "2",
    });
    expect(projection.workspace_ref).toMatch(/^[0-9a-f]{64}$/u);
    expect(projection.epoch_ref).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(projection.participant_set_root).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  test("pins the five-component blinded participant-set privacy contract", () => {
    const projection = collaborationProjection();
    expect(projection.participant_set_root)
      .toBe("sha256:a6acbc9bc1673168e790db3ad9bc0755e4cd109f8f47bffef72a3f45f110f96b");
    expect(JSON.stringify(projection)).not.toContain("ab".repeat(32));

    for (const changed of [
      collaborationProjection({ key: "ac".repeat(32) }),
      collaborationProjection({ workspace: "ws_222222222222222222222222" }),
      collaborationProjection({ epoch: "epoch_22222222-2222-4222-8222-222222222222" }),
      collaborationProjection({ actor: "agent-gamma" }),
      collaborationProjection({ session: "session-gamma" }),
    ]) {
      expect(changed.participant_set_root).not.toBe(projection.participant_set_root);
    }
    // Same privacy domain, key and participant set is deliberately a stable
    // commitment and therefore linkable; callers must scope/rotate keys.
    expect(collaborationProjection().participant_set_root).toBe(projection.participant_set_root);

    const base = {
      workspace: {
        id: "ws_111111111111111111111111",
        epoch_id: "epoch_11111111-1111-4111-8111-111111111111",
        event_head_sequence: 0,
        event_head_hash: "0".repeat(64),
      },
      events: [],
    };
    expect(() => projectCollaborationCheckpoint(base as never)).toThrow();
    for (const key of ["ab".repeat(31), "ab".repeat(33)]) {
      expect(() => projectCollaborationCheckpoint({
        ...base,
        participant_blinding_key_hex: key,
      })).toThrow(/64 (?:lowercase hexadecimal|UTF-8 bytes)/u);
    }
  });

  test("rejects gaps, tampering and incomplete journal prefixes", () => {
    const first = event(1, "0".repeat(64), "agent-alpha", "session-alpha");
    const second = event(2, first.hash, "agent-beta", "session-beta");
    const workspace = {
      id: first.workspace_id,
      epoch_id: first.epoch_id,
      event_head_sequence: 2,
      event_head_hash: second.hash,
    };
    expect(() => projectCollaborationCheckpoint({
      workspace,
      events: [second],
      participant_blinding_key_hex: "ab".repeat(32),
    })).toThrow(/length/u);
    expect(() => projectCollaborationCheckpoint({
      workspace,
      events: [first, { ...second, actor: "tampered" }],
      participant_blinding_key_hex: "ab".repeat(32),
    })).toThrow(/verified journal prefix/u);
  });
});
