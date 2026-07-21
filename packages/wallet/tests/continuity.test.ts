import { describe, expect, test } from "bun:test";

import {
  RECORD_SCHEMAS,
  WalletProtocolError,
  advanceContinuityHead,
  continuityHeadFromDescriptor,
  sealContinuityEvent,
  sealWalletDescriptor,
  type ContinuityEventCore,
} from "../src/index.js";
import { descriptorCore, owner, replacement } from "./fixtures.js";

const NOW = "2026-07-21T10:06:00.000Z";

function eventCore(overrides: Partial<ContinuityEventCore> = {}): ContinuityEventCore {
  return {
    schema: RECORD_SCHEMAS.continuity,
    event_id: "55555555-5555-4555-8555-555555555555",
    wallet_id: "11111111-1111-4111-8111-111111111111",
    sequence: 1,
    previous_record_id: null,
    event_kind: "capability_revoked",
    previous_value: null,
    next_value: null,
    revocation_nonce: 1,
    actor: owner.key,
    reason: "Fixture capability epoch rotation",
    effective_at: "2026-07-21T10:04:00.000Z",
    ...overrides,
  };
}

describe("wallet continuity", () => {
  test("advances one exact append-only head", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const head = continuityHeadFromDescriptor(descriptor);
    const event = await sealContinuityEvent(eventCore(), owner.signer);
    expect(advanceContinuityHead(head, event, NOW)).toEqual({
      wallet_id: descriptor.wallet_id,
      sequence: 1,
      record_id: event.record_id,
      authority_key_id: owner.key.key_id,
      revocation_nonce: 1,
      effective_at: event.effective_at,
    });
  });

  test("rejects replay, sequence gaps, wrong predecessor and cross-wallet forks", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const genesis = continuityHeadFromDescriptor(descriptor);
    const first = await sealContinuityEvent(eventCore(), owner.signer);
    const head = advanceContinuityHead(genesis, first, NOW);
    expect(() => advanceContinuityHead(head, first, NOW)).toThrow(/exact current head/i);

    const wrongSequence = await sealContinuityEvent(eventCore({
      event_id: "66666666-6666-4666-8666-666666666666",
      sequence: 3,
      previous_record_id: first.record_id,
      revocation_nonce: 2,
    }), owner.signer);
    expect(() => advanceContinuityHead(head, wrongSequence, NOW)).toThrow(/exact current head/i);
  });

  test("rotates authority without changing the wallet identity", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const rotation = await sealContinuityEvent(eventCore({
      event_kind: "authority_rotated",
      previous_value: owner.key.key_id,
      next_value: replacement.key.key_id,
      revocation_nonce: 0,
      reason: "Move root authority to replacement guardian ceremony",
    }), owner.signer);
    const rotated = advanceContinuityHead(continuityHeadFromDescriptor(descriptor), rotation, NOW);
    expect(rotated.authority_key_id).toBe(replacement.key.key_id);
    expect(rotated.wallet_id).toBe(descriptor.wallet_id);

    const revoke = await sealContinuityEvent(eventCore({
      event_id: "77777777-7777-4777-8777-777777777777",
      sequence: 2,
      previous_record_id: rotation.record_id,
      actor: replacement.key,
      effective_at: "2026-07-21T10:05:00.000Z",
    }), replacement.signer);
    expect(advanceContinuityHead(rotated, revoke, NOW).revocation_nonce).toBe(1);
  });

  test("old authority cannot append after rotation", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const rotation = await sealContinuityEvent(eventCore({
      event_kind: "authority_rotated",
      previous_value: owner.key.key_id,
      next_value: replacement.key.key_id,
      revocation_nonce: 0,
    }), owner.signer);
    const head = advanceContinuityHead(continuityHeadFromDescriptor(descriptor), rotation, NOW);
    const stale = await sealContinuityEvent(eventCore({
      event_id: "88888888-8888-4888-8888-888888888888",
      sequence: 2,
      previous_record_id: rotation.record_id,
      actor: owner.key,
    }), owner.signer);
    expect(() => advanceContinuityHead(head, stale, NOW))
      .toThrow(new WalletProtocolError("AUTHORITY_MISMATCH", "Continuity event actor is not the current wallet authority."));
  });

  test("does not apply a future-dated continuity event", async () => {
    const descriptor = await sealWalletDescriptor(descriptorCore(), owner.signer);
    const future = await sealContinuityEvent(eventCore({
      effective_at: "2026-07-21T10:07:00.000Z",
    }), owner.signer);
    expect(() => advanceContinuityHead(continuityHeadFromDescriptor(descriptor), future, NOW))
      .toThrow(/future/i);
  });
});
