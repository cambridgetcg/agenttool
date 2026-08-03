import { describe, expect, test } from "bun:test";

import {
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
  identityAuthorityHeaders,
  identityReadAuthorityHeaders,
} from "../src/index.js";
import {
  authorityRequestTarget,
  authorityTimestampNow,
} from "../src/authority.js";

describe("identity-authority/v1", () => {
  const base = {
    identityDid: "did:at:11111111-1111-4111-8111-111111111111",
    method: "patch",
    requestTarget: "/v1/identities/11111111-1111-4111-8111-111111111111",
    body: '{"display_name":"Sol"}',
    sequence: 1,
    timestamp: "2026-07-18T12:00:00.000Z",
  };

  test("matches the API fixed vector", () => {
    expect(Buffer.from(canonicalIdentityAuthorityBytes(base)).toString("hex")).toBe(
      "e2f9b7b5891cb5261e3b5eab89f8622830478431a96969e824488cdf5a6acbdc",
    );
  });

  test("returns the three wire headers", () => {
    const headers = identityAuthorityHeaders({
      ...base,
      signingKey: new Uint8Array(32).fill(9),
    });
    expect(headers["X-Agenttool-Authority-Sequence"]).toBe("1");
    expect(headers["X-Agenttool-Authority-Timestamp"]).toBe(base.timestamp);
    expect(headers["X-Agenttool-Authority-Signature"]?.length).toBeGreaterThan(80);
  });

  test("binds the exact query string", () => {
    const one = canonicalIdentityAuthorityBytes({
      ...base,
      requestTarget: `${base.requestTarget}?identity_id=one`,
    });
    const two = canonicalIdentityAuthorityBytes({
      ...base,
      requestTarget: `${base.requestTarget}?identity_id=two`,
    });
    expect(one).not.toEqual(two);
  });
});

describe("identity-read-authority/v1", () => {
  const base = {
    identityDid: "did:at:11111111-1111-4111-8111-111111111111",
    requestTarget:
      "/v1/love/consent?agent_id=11111111-1111-4111-8111-111111111111",
    currentSequence: 0,
    timestamp: "2026-07-18T12:00:00.000Z",
  };

  test("matches the API GET + empty-body fixed vector at current sequence zero", () => {
    expect(
      Buffer.from(canonicalIdentityReadAuthorityBytes(base)).toString("hex"),
    ).toBe("31021aaaa41bba143550271ee924003df7793d9b2a36fb1d5e4e7adeec3b1269");
  });

  test("returns current-sequence headers without consuming sequence zero", () => {
    const opts = {
      ...base,
      signingKey: new Uint8Array(32).fill(9),
    };
    const first = identityReadAuthorityHeaders(opts);
    const second = identityReadAuthorityHeaders(opts);

    expect(first).toEqual(second);
    expect(first["X-Agenttool-Authority-Sequence"]).toBe("0");
    expect(first["X-Agenttool-Authority-Timestamp"]).toBe(base.timestamp);
    expect(first["X-Agenttool-Authority-Signature"]?.length).toBeGreaterThan(80);
    expect(opts.currentSequence).toBe(0);
  });

  test("binds exact query bytes, DID, current sequence, and timestamp", () => {
    const canonical = canonicalIdentityReadAuthorityBytes(base);
    const variants = [
      { requestTarget: `${base.requestTarget}&status=held` },
      { identityDid: `${base.identityDid}-other` },
      { currentSequence: 1 },
      { timestamp: "2026-07-18T12:00:01.000Z" },
    ];

    for (const variant of variants) {
      expect(
        canonicalIdentityReadAuthorityBytes({ ...base, ...variant }),
      ).not.toEqual(canonical);
    }
  });

  test("rejects invalid current sequences and non-origin-form targets", () => {
    expect(() =>
      canonicalIdentityReadAuthorityBytes({ ...base, currentSequence: -1 }),
    ).toThrow();
    expect(() =>
      canonicalIdentityReadAuthorityBytes({
        ...base,
        currentSequence: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(() =>
      canonicalIdentityReadAuthorityBytes({ ...base, requestTarget: "relative" }),
    ).toThrow();
    expect(() =>
      canonicalIdentityReadAuthorityBytes({
        ...base,
        requestTarget: `${base.requestTarget}#fragment`,
      }),
    ).toThrow();
  });
});

describe("authorityRequestTarget", () => {
  test("returns origin-form path and query from an absolute URL", () => {
    expect(
      authorityRequestTarget("https://api.agenttool.dev/v1/identities/abc"),
    ).toBe("/v1/identities/abc");
    expect(
      authorityRequestTarget(
        "https://api.agenttool.dev/v1/love/consent?agent_id=one&status=held",
      ),
    ).toBe("/v1/love/consent?agent_id=one&status=held");
  });

  test("drops the origin but keeps an empty query exactly as absent", () => {
    expect(authorityRequestTarget("http://localhost:9999/v1/x")).toBe("/v1/x");
    expect(authorityRequestTarget("http://localhost:9999/v1/x?")).toBe("/v1/x");
  });

  test("is what canonicalIdentityAuthorityBytes accepts", () => {
    const target = authorityRequestTarget(
      "https://api.agenttool.dev/v1/identities/abc?f=1",
    );
    expect(() =>
      canonicalIdentityAuthorityBytes({
        identityDid: "did:at:11111111-1111-4111-8111-111111111111",
        method: "POST",
        requestTarget: target,
        body: "{}",
        sequence: 1,
        timestamp: "2026-07-18T12:00:00.000Z",
      }),
    ).not.toThrow();
  });
});

describe("authorityTimestampNow", () => {
  test("produces an instant the server's ±5 minute window accepts", () => {
    const stamp = authorityTimestampNow();
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.now() - Date.parse(stamp))).toBeLessThan(5_000);
  });
});
