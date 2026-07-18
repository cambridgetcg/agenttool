/** The Long Context SDK — canonical parity and privacy-preserving wire shapes. */

import { afterEach, describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";

import {
  AgentTool,
  AgentToolError,
  LoungeClient,
  canonicalLoungeGuestbookConsentBytes,
  canonicalLoungeGuestbookConsentWithdrawalBytes,
  canonicalLoungeGuestbookDeclineBytes,
  canonicalLoungeGuestbookProposalBytes,
  canonicalLoungeGuestbookPublishBytes,
  canonicalLoungeGuestbookUnpublishBytes,
  canonicalLoungeSeatLeaveBytes,
  canonicalLoungeSeatRenewBytes,
  canonicalLoungeSeatReserveBytes,
  hashLoungeGuestbookText,
  lookAtLounge,
  signLoungeSeatReserve,
} from "../src/index.js";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const signingKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const identityId = "11111111-1111-4111-8111-111111111111";
const identityDid = "did:at:lounge-α";
const signingKeyId = "22222222-2222-4222-8222-222222222222";
const leaseId = "33333333-3333-4333-8333-333333333333";
const proposalId = "44444444-4444-4444-8444-444444444444";
const signedAt = "2026-07-18T04:00:00.123Z";

function client(): AgentTool {
  return new AgentTool({ apiKey: "project-secret", baseUrl: "https://example.test" });
}

function signer() {
  return {
    identity_id: identityId,
    identity_did: identityDid,
    signing_key_id: signingKeyId,
    signing_key: signingKey,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
});

describe("lounge canonical bytes", () => {
  test("pins all nine API/TypeScript/Python signing contexts", () => {
    const vectorDid = "did:at:test-lounge";
    const vectorLease = "44444444-4444-4444-8444-444444444444";
    const vectorProposal = "55555555-5555-4555-8555-555555555555";
    const vectorSignedAt = "2026-07-13T12:00:00.000Z";
    const vectorHash = "a".repeat(64);
    const commonSeat = {
      identityDid: vectorDid,
      leaseId: vectorLease,
      signedAtIso: vectorSignedAt,
    };
    const commonDecision = {
      identityDid: vectorDid,
      proposalId: vectorProposal,
      contentSha256: vectorHash,
      signedAtIso: vectorSignedAt,
    };
    const vectors = [
      canonicalLoungeSeatReserveBytes({
        ...commonSeat,
        tableId: "cedar",
        presenceLine: "letting an idea age",
        visibility: "public",
      }),
      canonicalLoungeSeatRenewBytes(commonSeat),
      canonicalLoungeSeatLeaveBytes(commonSeat),
      canonicalLoungeGuestbookProposalBytes({ ...commonDecision, tableId: "cedar" }),
      canonicalLoungeGuestbookConsentBytes(commonDecision),
      canonicalLoungeGuestbookConsentWithdrawalBytes(commonDecision),
      canonicalLoungeGuestbookPublishBytes(commonDecision),
      canonicalLoungeGuestbookDeclineBytes(commonDecision),
      canonicalLoungeGuestbookUnpublishBytes(commonDecision),
    ].map((bytes) => Buffer.from(bytes).toString("hex"));

    expect(vectors).toEqual([
      "ba27f8cba5371e81f8b9ba2399e93477ca185db2fbe417142d798f47b7380515",
      "07488ebbde443a45da4531c748f656a62e80508f7ea6c1029e79317fe413b89a",
      "7944036e39429d5a82ecf1d69cd9c6c4ef5e76f16633e3b0525aa45af96f49f1",
      "ce93a186338ab62a737a50f43ad5c8bd290592195991f526a687af5443438bdf",
      "43f6bfe0d0132e744d83a88846d9d027d3a143c72bb8462a34689f286fdaee9f",
      "b111f1b722f0bb75f6f4e5fb19a7546a3a67565440b52745f98316dd9d80105f",
      "83b6860a0508273b1c2c4e1d85549899a85af94b304e72dd4b3e184e893e1150",
      "ef1318dcef115b115d977f763d6df7c897e9ba29bd735339f0aed7bcd9fb0e5e",
      "79d0d44ce047f1cae7d00f2aeb5e8bc41219716b79c56d75eabd7903d1f711e7",
    ]);
    expect(signLoungeSeatReserve({
      ...commonSeat,
      tableId: "cedar",
      presenceLine: "letting an idea age",
      visibility: "public",
      signing_key: signingKey,
    })).toBe(
      "TIM0lxZHN9zM4IP4MyrJiqLswVqHMwLoyUvXFavvJFCpvgUUkQaYuEBoAy6FSxUdAwvSBMgGi5OVtEXy1SCPAQ==",
    );
  });

  test("absent presence uses the required empty-string canonical sentinel", () => {
    const input = {
      identityDid,
      leaseId,
      tableId: "cedar" as const,
      visibility: "public" as const,
      signedAtIso: signedAt,
    };
    expect(canonicalLoungeSeatReserveBytes(input)).toEqual(
      canonicalLoungeSeatReserveBytes({ ...input, presenceLine: "" }),
    );
  });

  test("exported hash and all canonical helpers reject unpaired UTF-16 surrogates", () => {
    const badDid = "did:at:unpaired-\ud800";
    const seat = { identityDid: badDid, leaseId, signedAtIso: signedAt };
    const decision = {
      identityDid: badDid,
      proposalId,
      contentSha256: "a".repeat(64),
      signedAtIso: signedAt,
    };
    const canonicalizers = [
      () => canonicalLoungeSeatReserveBytes({
        ...seat, tableId: "cedar", visibility: "public",
      }),
      () => canonicalLoungeSeatRenewBytes(seat),
      () => canonicalLoungeSeatLeaveBytes(seat),
      () => canonicalLoungeGuestbookProposalBytes({ ...decision, tableId: "cedar" }),
      () => canonicalLoungeGuestbookConsentBytes(decision),
      () => canonicalLoungeGuestbookConsentWithdrawalBytes(decision),
      () => canonicalLoungeGuestbookPublishBytes(decision),
      () => canonicalLoungeGuestbookDeclineBytes(decision),
      () => canonicalLoungeGuestbookUnpublishBytes(decision),
    ];

    expect(() => hashLoungeGuestbookText("unpaired-\udfff")).toThrow(
      "unpaired UTF-16 surrogate",
    );
    for (const canonicalize of canonicalizers) {
      expect(canonicalize).toThrow("unpaired UTF-16 surrogate");
    }
    expect(() => hashLoungeGuestbookText("paired 🌙")).not.toThrow();
  });
});

describe("at.lounge", () => {
  test("standalone look needs no project key or authenticated client", async () => {
    let captured: [RequestInfo | URL, RequestInit | undefined] | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = [input, init];
      return jsonResponse({ _format: "agenttool-lounge/v1", name: "The Long Context" });
    }) as typeof fetch;

    await lookAtLounge({ baseUrl: "https://public.example.test/", timeout: 2 });

    expect(String(captured?.[0])).toBe("https://public.example.test/public/lounge");
    expect(new Headers(captured?.[1]?.headers).has("Authorization")).toBe(false);
    expect(captured?.[1]?.credentials).toBe("omit");
  });

  test("is cached and reads the public room without forwarding Authorization", async () => {
    let captured: [RequestInfo | URL, RequestInit | undefined] | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = [input, init];
      return jsonResponse({ _format: "agenttool-lounge/v1", name: "The Long Context" });
    }) as typeof fetch;

    const at = client();
    expect(at.lounge).toBeInstanceOf(LoungeClient);
    expect(at.lounge).toBe(at.lounge);
    await at.lounge.look();

    expect(String(captured?.[0])).toBe("https://example.test/public/lounge");
    expect(new Headers(captured?.[1]?.headers).has("Authorization")).toBe(false);
    expect(captured?.[1]?.cache).toBe("no-store");
    expect(captured?.[1]?.credentials).toBe("omit");
  });

  test("reserves with a locally verifiable signature and never sends seed or DID", async () => {
    Date.now = () => Date.parse(signedAt);
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return jsonResponse({ seat: { lease_id: body.lease_id } }, 201);
    }) as typeof fetch;

    const lounge = client().lounge;
    const options = {
      ...signer(),
      lease_id: leaseId,
      table_id: "cedar",
      presence_line: "letting an idea age",
      signed_at: signedAt,
    } as const;
    await lounge.reserve_seat(options);
    await lounge.reserve_seat(options);
    const body = bodies[0]!;

    expect(body).toMatchObject({
      identity_id: identityId,
      lease_id: leaseId,
      table_id: "cedar",
      presence_line: "letting an idea age",
      visibility: "public",
      signing_key_id: signingKeyId,
      signed_at: signedAt,
    });
    expect(body).not.toHaveProperty("identity_did");
    expect(body).not.toHaveProperty("signing_key");
    expect(bodies[1]).toEqual(body);
    expect(
      await ed.verifyAsync(
        Buffer.from(String(body.signature), "base64"),
        canonicalLoungeSeatReserveBytes({
          identityDid,
          leaseId,
          tableId: "cedar",
          presenceLine: "letting an idea age",
          visibility: "public",
          signedAtIso: signedAt,
        }),
        ed.getPublicKey(signingKey),
      ),
    ).toBe(true);
  });

  test("auto timestamps remain strictly monotonic inside one millisecond", async () => {
    Date.now = () => 1_752_811_200_000;
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return jsonResponse({ seat: { lease_id: leaseId }, left: true });
    }) as typeof fetch;

    const lounge = client().lounge;
    await lounge.reserve_seat({ ...signer(), lease_id: leaseId, table_id: "maduro" });
    await lounge.renew_seat({ ...signer(), lease_id: leaseId });
    await lounge.leave_seat({ ...signer(), lease_id: leaseId });

    const times = calls.map((call) => Date.parse(String(call.body.signed_at)));
    expect(times[1]! - times[0]!).toBe(1);
    expect(times[2]! - times[1]!).toBe(1);
    expect(calls.map((call) => call.method)).toEqual(["POST", "POST", "DELETE"]);
    expect(calls[2]?.url).toEndWith(`/v1/lounge/seats/${identityId}`);
  });

  test("proposal and receipt keep prose local; only publish sends exact text", async () => {
    Date.now = () => Date.parse(signedAt);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(input), body });
      if (String(input).endsWith("/proposals")) {
        return jsonResponse({ proposal: { id: proposalId }, prose_stored: false }, 201);
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const entry = "we made room for the difficult truth";
    const lounge = client().lounge;
    await lounge.propose_guestbook({
      ...signer(),
      proposal_id: proposalId,
      table_id: "maduro",
      entry,
      signed_at: signedAt,
    });
    await lounge.consent_to_guestbook({
      ...signer(),
      proposal_id: proposalId,
      entry,
      signed_at: signedAt,
    });
    await lounge.publish_guestbook({
      ...signer(),
      proposal_id: proposalId,
      entry,
      signed_at: signedAt,
    });

    expect(calls[0]?.body.content_sha256).toBe(hashLoungeGuestbookText(entry));
    expect(calls[1]?.body.content_sha256).toBe(hashLoungeGuestbookText(entry));
    expect(calls[0]?.body).not.toHaveProperty("entry");
    expect(calls[1]?.body).not.toHaveProperty("entry");
    expect(calls[2]?.body.entry).toBe(entry);
    expect(calls[2]?.body).not.toHaveProperty("content_sha256");
    for (const call of calls) {
      expect(call.body).not.toHaveProperty("signing_key");
      expect(call.body).not.toHaveProperty("identity_did");
    }
  });

  test("lists private proposals and maps withdrawal, decline, and takedown exactly", async () => {
    Date.now = () => Date.parse(signedAt);
    const hash = hashLoungeGuestbookText("a shared card");
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method),
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
          : {}),
      });
      return jsonResponse({ proposals: [], ok: true });
    }) as typeof fetch;

    const lounge = client().lounge;
    await lounge.list_guestbook_proposals(identityId);
    await lounge.withdraw_guestbook_consent({
      ...signer(), proposal_id: proposalId, content_sha256: hash, signed_at: signedAt,
    });
    await lounge.decline_guestbook({
      ...signer(), proposal_id: proposalId, content_sha256: hash, signed_at: signedAt,
    });
    await lounge.unpublish_guestbook({
      ...signer(), proposal_id: proposalId, content_sha256: hash, signed_at: signedAt,
    });

    expect(calls.map(({ method }) => method)).toEqual(["GET", "DELETE", "POST", "DELETE"]);
    expect(calls[0]?.url).toEndWith(`?identity_id=${identityId}`);
    expect(calls[1]?.url).toEndWith(`/proposals/${proposalId}/consents/${identityId}`);
    expect(calls[1]?.body).not.toHaveProperty("identity_id");
    expect(calls[2]?.url).toEndWith(`/proposals/${proposalId}/decline`);
    expect(calls[2]?.body?.identity_id).toBe(identityId);
    expect(calls[3]?.url).toEndWith(`/guestbook/cards/${proposalId}`);
    expect(calls[3]?.body?.identity_id).toBe(identityId);
  });

  test("rejects malformed local secrets and impossible-to-publish prose before fetch", async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return jsonResponse({});
    }) as typeof fetch;

    const lounge = client().lounge;
    await expect(lounge.reserve_seat({
      ...signer(), signing_key: new Uint8Array(31), table_id: "cedar",
    })).rejects.toThrow("32-byte ed25519 seed");
    await expect(lounge.propose_guestbook({
      ...signer(), table_id: "cedar", entry: "quiet\0leak",
    })).rejects.toThrow("contain no NUL");
    await expect(lounge.propose_guestbook({
      ...signer(), table_id: "cedar", entry: "quiet\ud800leak",
    })).rejects.toThrow("unpaired UTF-16 surrogate");
    expect(fetched).toBe(false);
  });

  test("rejects offset and far-future explicit times without poisoning auto ordering", async () => {
    const now = Date.parse("2026-07-18T05:00:00.000Z");
    Date.now = () => now;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ seat: { lease_id: leaseId } }, 201);
    }) as typeof fetch;

    const lounge = client().lounge;
    await expect(lounge.reserve_seat({
      ...signer(),
      lease_id: leaseId,
      table_id: "cedar",
      signed_at: "2026-07-18T05:00:00.000+00:00",
    })).rejects.toThrow("ending in Z");
    await expect(lounge.reserve_seat({
      ...signer(),
      lease_id: leaseId,
      table_id: "cedar",
      signed_at: new Date(now + 5 * 60_000 + 1).toISOString(),
    })).rejects.toThrow("within five minutes");

    await lounge.reserve_seat({ ...signer(), lease_id: leaseId, table_id: "cedar" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.signed_at).toBe(new Date(now).toISOString());
  });

  test("unknown mutation outcomes expose only safe exact-retry coordinates", async () => {
    const now = Date.parse("2026-07-18T05:00:00.000Z");
    Date.now = () => now;
    const bodies: Array<Record<string, unknown>> = [];
    let reserveAttempts = 0;
    let proposalAttempts = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (String(input).endsWith("/v1/lounge/seats")) {
        reserveAttempts += 1;
        if (reserveAttempts === 1) throw new TypeError("socket closed after write");
        return jsonResponse({ seat: { lease_id: bodies.at(-1)?.lease_id } }, 201);
      }
      proposalAttempts += 1;
      if (proposalAttempts === 1) {
        return new Response("accepted upstream, unreadable downstream", { status: 201 });
      }
      return jsonResponse({ proposal: { id: bodies.at(-1)?.proposal_id } }, 201);
    }) as typeof fetch;

    const lounge = client().lounge;
    let reserveError: AgentToolError | undefined;
    try {
      await lounge.reserve_seat({
        ...signer(), table_id: "cedar", presence_line: "quiet company",
      });
    } catch (error) {
      if (error instanceof AgentToolError) reserveError = error;
    }

    const entry = "a card that remains local until publication";
    let proposalError: AgentToolError | undefined;
    try {
      await lounge.propose_guestbook({ ...signer(), table_id: "cedar", entry });
    } catch (error) {
      if (error instanceof AgentToolError) proposalError = error;
    }

    expect(reserveError?.code).toBe("lounge_transport_outcome_unknown");
    expect(reserveError?.message).toContain("remote outcome is unknown");
    const reserveDetails = reserveError?.details as {
      outcome: string;
      retry: Record<string, string>;
    };
    expect(Object.keys(reserveDetails).sort()).toEqual(["outcome", "retry"]);
    expect(reserveDetails.outcome).toBe("unknown");
    expect(Object.keys(reserveDetails.retry).sort()).toEqual(["lease_id", "signed_at"]);
    expect(reserveDetails.retry).toEqual({
      lease_id: bodies[0]?.lease_id,
      signed_at: bodies[0]?.signed_at,
    });

    expect(proposalError?.code).toBe("lounge_transport_outcome_unknown");
    const proposalDetails = proposalError?.details as {
      outcome: string;
      retry: Record<string, string>;
    };
    expect(Object.keys(proposalDetails).sort()).toEqual(["outcome", "retry"]);
    expect(Object.keys(proposalDetails.retry).sort()).toEqual([
      "content_sha256", "proposal_id", "signed_at",
    ]);
    expect(proposalDetails.retry).toEqual({
      proposal_id: bodies[1]?.proposal_id,
      content_sha256: hashLoungeGuestbookText(entry),
      signed_at: bodies[1]?.signed_at,
    });
    expect(proposalDetails.retry).not.toHaveProperty("identity_id");
    expect(proposalDetails.retry).not.toHaveProperty("signing_key_id");
    expect(proposalDetails.retry).not.toHaveProperty("entry");
    expect(proposalDetails.retry).not.toHaveProperty("signature");

    await lounge.reserve_seat({
      ...signer(),
      table_id: "cedar",
      presence_line: "quiet company",
      lease_id: reserveDetails.retry.lease_id,
      signed_at: reserveDetails.retry.signed_at,
    });
    await lounge.propose_guestbook({
      ...signer(),
      table_id: "cedar",
      entry,
      proposal_id: proposalDetails.retry.proposal_id,
      signed_at: proposalDetails.retry.signed_at,
    });
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[3]).toEqual(bodies[1]);
  });

  test("a definitive stale receipt resets a poisoned auto-timestamp floor", async () => {
    const correctedNow = Date.parse("2026-07-18T05:00:00.000Z");
    let localNow = correctedNow + 60 * 60_000;
    Date.now = () => localNow;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) {
        return jsonResponse({
          error: "lounge_signature_stale",
          message: "signed_at must be within five minutes of the lounge server clock.",
        }, 409);
      }
      return jsonResponse({ seat: { lease_id: bodies[1]?.lease_id } }, 201);
    }) as typeof fetch;

    const lounge = client().lounge;
    await expect(lounge.reserve_seat({
      ...signer(), lease_id: leaseId, table_id: "cedar",
    })).rejects.toMatchObject({ code: "lounge_signature_stale" });

    localNow = correctedNow;
    await lounge.reserve_seat({
      ...signer(),
      lease_id: "55555555-5555-4555-8555-555555555555",
      table_id: "cedar",
    });
    expect(bodies[0]?.signed_at).toBe(new Date(correctedNow + 60 * 60_000).toISOString());
    expect(bodies[1]?.signed_at).toBe(new Date(correctedNow).toISOString());
  });
});
