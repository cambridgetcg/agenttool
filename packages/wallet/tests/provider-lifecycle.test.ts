import { describe, expect, test } from "bun:test";

import {
  WalletProtocolError,
  applyBroadcastResult,
  assertIntentWithinCapabilityStatic,
  assertSignedPayloadMatchesRequest,
  base64UrlEncode,
  createSigningRequest,
  mayBroadcast,
  mayInvokeSigner,
  reconcileSubmissionUnknown,
  reconcileSigningUnknown,
  sha256BytesId,
  transitionOperation,
  validateSignerDescription,
  type OperationState,
  type SignedPayload,
} from "../src/index.js";
import { receiptAuthority, signedBundle } from "./fixtures.js";

const T0 = "2026-07-21T10:02:00.000Z";

describe("non-exportable provider boundary", () => {
  test("accepts only a closed non-exportable signer descriptor", () => {
    const descriptor = validateSignerDescription({
      signer_key_id: receiptAuthority.key.key_id,
      algorithm: "secp256k1",
      provider: "fixture-hsm",
      exportable: false,
    });
    expect(descriptor.exportable).toBe(false);
    expect(() => validateSignerDescription({ ...descriptor, private_key: "never" }))
      .toThrow(WalletProtocolError);
    expect(() => validateSignerDescription({ ...descriptor, exportable: true }))
      .toThrow(/non-exportable/i);

    let exportableReads = 0;
    expect(() => validateSignerDescription({
      signer_key_id: receiptAuthority.key.key_id,
      algorithm: "secp256k1",
      provider: "fixture-hsm",
      get exportable() {
        exportableReads += 1;
        return exportableReads === 1 ? false : true;
      },
    })).toThrow(/data properties/i);
    expect(exportableReads).toBe(0);
  });

  test("binds signer output to exact request, key and payload hashes", async () => {
    const bundle = await signedBundle();
    const authorization = assertIntentWithinCapabilityStatic({
      ...bundle,
      context: {
        now: T0,
        usage: { revocation_nonce: 0, intent_count: 0, spent: [], host_verified_approval_ids: [] },
      },
    });
    const unsignedBytes = new Uint8Array([1, 2, 3]);
    const request = createSigningRequest({
      request_id: "99999999-9999-4999-8999-999999999999",
      authorization,
      signer_key_id: receiptAuthority.key.key_id,
      unsigned_payload: unsignedBytes,
    });
    unsignedBytes[0] = 255;
    expect(request.unsigned_payload_b64u).toBe(base64UrlEncode(new Uint8Array([1, 2, 3])));
    const signedBytes = new Uint8Array([4, 5, 6]);
    const result: SignedPayload = {
      request_id: request.request_id,
      signer_key_id: request.signer_key_id,
      unsigned_payload_hash: request.unsigned_payload_hash,
      signed_payload_b64u: base64UrlEncode(signedBytes),
      signed_payload_hash: sha256BytesId(signedBytes),
      operation_id: "0xfixture",
    };
    expect(assertSignedPayloadMatchesRequest(request, result).signed_payload_hash)
      .toBe(result.signed_payload_hash);
    expect(() => assertSignedPayloadMatchesRequest(request, {
      ...result,
      unsigned_payload_hash: `sha256:${"0".repeat(64)}`,
    })).toThrow(/exact request/i);
    expect(() => assertSignedPayloadMatchesRequest(request, {
      ...result,
      private_key: "must-never-cross",
    } as unknown as SignedPayload)).toThrow(/exactly/i);
    let payloadReads = 0;
    expect(() => assertSignedPayloadMatchesRequest(request, {
      request_id: result.request_id,
      signer_key_id: result.signer_key_id,
      unsigned_payload_hash: result.unsigned_payload_hash,
      get signed_payload_b64u() {
        payloadReads += 1;
        return payloadReads === 1 ? result.signed_payload_b64u : "AA";
      },
      signed_payload_hash: result.signed_payload_hash,
      operation_id: result.operation_id,
    } as SignedPayload)).toThrow(/data properties/i);
    expect(payloadReads).toBe(0);
    expect(() => createSigningRequest({
      request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authorization: structuredClone(authorization),
      signer_key_id: receiptAuthority.key.key_id,
      unsigned_payload: new Uint8Array([1]),
    })).toThrow(/returned by assertIntentWithinCapabilityStatic/i);

    let authorizationReads = 0;
    expect(() => createSigningRequest({
      request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      get authorization() {
        authorizationReads += 1;
        return authorizationReads === 1
          ? authorization
          : { ...authorization, wallet_id: "forged-wallet" };
      },
      signer_key_id: receiptAuthority.key.key_id,
      unsigned_payload: new Uint8Array([1]),
    })).toThrow(/data properties/i);
    expect(authorizationReads).toBe(0);

    let unsignedPayloadReads = 0;
    expect(() => createSigningRequest({
      request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authorization,
      signer_key_id: receiptAuthority.key.key_id,
      get unsigned_payload() {
        unsignedPayloadReads += 1;
        return unsignedPayloadReads === 1
          ? new Uint8Array([1, 2, 3])
          : new Uint8Array([4, 5, 6]);
      },
    })).toThrow(/data properties/i);
    expect(unsignedPayloadReads).toBe(0);
  });
});

describe("single-submit lifecycle", () => {
  const reserved: OperationState = { status: "reserved", updated_at: T0, operation_id: null };

  test("allows one forward signing and broadcast path", () => {
    expect(mayInvokeSigner(reserved)).toBe(true);
    const signing = transitionOperation(reserved, "signing", "2026-07-21T10:02:01.000Z");
    const signed = transitionOperation(signing, "signed", "2026-07-21T10:02:02.000Z");
    expect(mayBroadcast(signed)).toBe(true);
    const submitting = transitionOperation(signed, "submitting", "2026-07-21T10:02:03.000Z");
    const submitted = applyBroadcastResult(submitting, {
      status: "accepted",
      operation_id: "0xfixture",
    }, "2026-07-21T10:02:04.000Z");
    expect(submitted).toMatchObject({ status: "submitted", operation_id: "0xfixture" });
  });

  test("ambiguous submit never becomes retryable after absent or unavailable lookup", () => {
    const signing = transitionOperation(reserved, "signing", "2026-07-21T10:02:01.000Z");
    const signed = transitionOperation(signing, "signed", "2026-07-21T10:02:02.000Z");
    const submitting = transitionOperation(signed, "submitting", "2026-07-21T10:02:03.000Z");
    const unknown = applyBroadcastResult(submitting, {
      status: "ambiguous",
      operation_id: null,
    }, "2026-07-21T10:02:04.000Z");
    expect(unknown.status).toBe("submission_unknown");
    expect(mayBroadcast(unknown)).toBe(false);
    expect(reconcileSubmissionUnknown(unknown, { status: "absent" }, "2026-07-21T10:02:05.000Z"))
      .toBe(unknown);
    expect(reconcileSubmissionUnknown(unknown, {
      status: "unavailable",
      code: "rpc_timeout",
    }, "2026-07-21T10:02:06.000Z")).toBe(unknown);
  });

  test("signer uncertainty cannot invoke a second signer call", () => {
    const signing = transitionOperation(reserved, "signing", "2026-07-21T10:02:01.000Z");
    const unknown = transitionOperation(signing, "signing_unknown", "2026-07-21T10:02:02.000Z");
    expect(mayInvokeSigner(unknown)).toBe(false);
    expect(() => transitionOperation(unknown, "signing", "2026-07-21T10:02:03.000Z"))
      .toThrow(/cannot transition/i);
    expect(() => transitionOperation(unknown, "signed", "2026-07-21T10:02:03.000Z"))
      .toThrow(/cannot transition/i);
    expect(() => transitionOperation(unknown, "rejected_pre_submit", "2026-07-21T10:02:03.000Z"))
      .toThrow(/cannot transition/i);
  });

  test("submission uncertainty resolves through a positively identified submission", () => {
    const unknown: OperationState = {
      status: "submission_unknown",
      updated_at: "2026-07-21T10:02:04.000Z",
      operation_id: null,
    };
    expect(() => transitionOperation(
      unknown,
      "submitted",
      "2026-07-21T10:02:05.000Z",
      "0xfixture",
    )).toThrow(/cannot transition/i);
    expect(() => transitionOperation(
      unknown,
      "confirmed",
      "2026-07-21T10:02:05.000Z",
      "0xfixture",
    )).toThrow(/cannot transition/i);
    expect(reconcileSubmissionUnknown(unknown, {
      status: "found",
      operation_id: "0xfixture",
      confirmed: true,
    }, "2026-07-21T10:02:05.000Z")).toMatchObject({
      status: "confirmed",
      operation_id: "0xfixture",
    });
  });

  test("signer uncertainty resolves only with a recovered exact payload", async () => {
    const bundle = await signedBundle();
    const authorization = assertIntentWithinCapabilityStatic({
      ...bundle,
      context: {
        now: T0,
        usage: { revocation_nonce: 0, intent_count: 0, spent: [], host_verified_approval_ids: [] },
      },
    });
    const request = createSigningRequest({
      request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authorization,
      signer_key_id: receiptAuthority.key.key_id,
      unsigned_payload: new Uint8Array([1, 2, 3]),
    });
    const signedBytes = new Uint8Array([4, 5, 6]);
    const payload: SignedPayload = {
      request_id: request.request_id,
      signer_key_id: request.signer_key_id,
      unsigned_payload_hash: request.unsigned_payload_hash,
      signed_payload_b64u: base64UrlEncode(signedBytes),
      signed_payload_hash: sha256BytesId(signedBytes),
      operation_id: "signer-operation-fixture",
    };
    const signing = transitionOperation(reserved, "signing", "2026-07-21T10:02:01.000Z");
    const unknown = transitionOperation(signing, "signing_unknown", "2026-07-21T10:02:02.000Z");
    expect(reconcileSigningUnknown(unknown, request, { status: "absent" }, "2026-07-21T10:02:03.000Z"))
      .toBe(unknown);
    expect(reconcileSigningUnknown(unknown, request, {
      status: "found",
      payload,
    }, "2026-07-21T10:02:03.000Z").status).toBe("signed");
    expect(() => reconcileSigningUnknown(unknown, request, {
      status: "found",
      payload: { ...payload, request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    }, "2026-07-21T10:02:03.000Z")).toThrow(/exact request/i);
  });

  test("forbids backward state and operation-id replacement", () => {
    const submitted: OperationState = {
      status: "submitted",
      updated_at: "2026-07-21T10:03:00.000Z",
      operation_id: "0xone",
    };
    expect(() => transitionOperation(submitted, "signed", "2026-07-21T10:03:01.000Z"))
      .toThrow(/cannot transition/i);
    expect(() => transitionOperation(submitted, "confirmed", "2026-07-21T10:03:01.000Z", "0xtwo"))
      .toThrow(/immutable/i);
  });
});
