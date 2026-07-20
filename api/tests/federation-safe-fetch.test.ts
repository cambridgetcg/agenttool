import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertPublicFederationHttpsUrl,
  FEDERATION_MAX_REQUEST_BYTES,
  FEDERATION_MAX_RESPONSE_BYTES,
  isPublicFederationAddress,
  resolvePublicFederationAddresses,
  safeFederationHttpsGet,
  safeFederationHttpsRequest,
  type FederationRequestOnce,
} from "../src/services/federation/safe-fetch";
import {
  parseDid,
  resolveFederatedDid,
} from "../src/services/federation/store";
import {
  fetchPeerDescriptor,
  fetchRemoteCitizen,
} from "../src/services/pyramid/federation";
import { runClaimSanityCheck } from "../src/services/substrate-tasks/verifiers/attestation_witness_low_stakes";
import { verifyFederationHandshake } from "../src/services/substrate-tasks/verifiers/federation_handshake_verify";

const UUID = "11111111-1111-1111-1111-111111111111";
const PUBLIC_V4 = { address: "93.184.216.34", family: 4 } as const;
const PUBLIC_V6 = {
  address: "2606:4700:4700::1111",
  family: 6,
} as const;

describe("federation HTTPS destination policy", () => {
  test("allows public IPs and blocks non-public IPv4 and IPv6 ranges", () => {
    expect(isPublicFederationAddress(PUBLIC_V4.address)).toBe(true);
    expect(isPublicFederationAddress(PUBLIC_V6.address)).toBe(true);

    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ]) {
      expect(isPublicFederationAddress(address)).toBe(false);
    }
  });

  test("requires HTTPS without URL credentials", () => {
    expect(
      assertPublicFederationHttpsUrl("https://peer.example/federation").href,
    ).toBe("https://peer.example/federation");
    expect(() =>
      assertPublicFederationHttpsUrl("http://peer.example/federation"),
    ).toThrow("federation_https_required");
    expect(() =>
      assertPublicFederationHttpsUrl("https://user@peer.example/federation"),
    ).toThrow("federation_url_credentials_forbidden");
  });

  test("keeps generic URL-policy failures in the federation namespace", async () => {
    await expect(
      safeFederationHttpsRequest("https://peer.example:0/"),
    ).rejects.toThrow("federation_invalid_url");
  });

  test("rejects literal private targets without performing DNS", async () => {
    let lookupCalled = false;
    let requestCalled = false;
    await expect(
      safeFederationHttpsGet("https://127.0.0.1/federation/identities/1", {
        lookup: async () => {
          lookupCalled = true;
          return [PUBLIC_V4];
        },
        requestOnce: async () => {
          requestCalled = true;
          return { statusCode: 200, body: Buffer.from("{}") };
        },
      }),
    ).rejects.toThrow("federation_private_address_forbidden");
    expect(lookupCalled).toBe(false);
    expect(requestCalled).toBe(false);
  });

  test("rejects a hostname if any DNS answer is non-public", async () => {
    await expect(
      resolvePublicFederationAddresses("peer.example", async () => [
        PUBLIC_V4,
        { address: "10.0.0.8", family: 4 },
      ]),
    ).rejects.toThrow("federation_private_address_forbidden");
  });

  test("passes only prevalidated DNS answers to the HTTPS request", async () => {
    let requestedAddresses: unknown;
    const requestOnce: FederationRequestOnce = async (options) => {
      requestedAddresses = options.addresses;
      return { statusCode: 200, body: Buffer.from("{}") };
    };

    const response = await safeFederationHttpsGet(
      "https://peer.example/federation/identities/1",
      {
        lookup: async () => [PUBLIC_V4, PUBLIC_V6],
        requestOnce,
      },
    );

    expect(response.statusCode).toBe(200);
    expect(requestedAddresses).toEqual([PUBLIC_V4, PUBLIC_V6]);
  });

  test("sends bounded POST bodies through the pinned HTTPS request", async () => {
    const payload = JSON.stringify({ sender_did: "did:at:sender" });
    let requested: Parameters<FederationRequestOnce>[0] | undefined;

    await safeFederationHttpsRequest(
      "https://peer.example/federation/inbox",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "999999",
          host: "attacker.example",
        },
        body: payload,
        lookup: async () => [PUBLIC_V4, PUBLIC_V6],
        requestOnce: async (options) => {
          requested = options;
          return { statusCode: 201, body: Buffer.from("{}") };
        },
      },
    );

    expect(requested?.method).toBe("POST");
    expect(requested?.addresses).toEqual([PUBLIC_V4, PUBLIC_V6]);
    expect(requested?.headers).toEqual({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
    });
    expect(requested?.body).toEqual(Buffer.from(payload));
    expect(requested?.maxResponseBytes).toBe(FEDERATION_MAX_RESPONSE_BYTES);
    expect(requested?.timeoutMs).toBeGreaterThan(0);
    expect(requested?.timeoutMs).toBeLessThanOrEqual(10_000);
  });

  test("rejects malformed facade headers before DNS or injected transport", async () => {
    let lookupCalled = false;
    await expect(safeFederationHttpsRequest("https://peer.example/", {
      headers: { "x-safe": "yes\r\nInjected: true" },
      lookup: async () => {
        lookupCalled = true;
        return [PUBLIC_V4];
      },
    })).rejects.toThrow("federation_invalid_header");
    expect(lookupCalled).toBe(false);
  });

  test("rejects an oversized POST body before DNS or a socket request", async () => {
    let lookupCalled = false;
    let requestCalled = false;

    await expect(
      safeFederationHttpsRequest(
        "https://peer.example/federation/inbox",
        {
          method: "POST",
          body: Buffer.alloc(FEDERATION_MAX_REQUEST_BYTES + 1),
          lookup: async () => {
            lookupCalled = true;
            return [PUBLIC_V4];
          },
          requestOnce: async () => {
            requestCalled = true;
            return { statusCode: 201, body: Buffer.from("{}") };
          },
        },
      ),
    ).rejects.toThrow("federation_request_too_large");
    expect(lookupCalled).toBe(false);
    expect(requestCalled).toBe(false);
  });

  test("rejects GET bodies before DNS or an injected socket request", async () => {
    let lookupCalled = false;
    let requestCalled = false;
    await expect(
      safeFederationHttpsRequest("https://peer.example/data", {
        method: "GET",
        body: "secret",
        lookup: async () => {
          lookupCalled = true;
          return [PUBLIC_V4];
        },
        requestOnce: async () => {
          requestCalled = true;
          return { statusCode: 200, body: Buffer.alloc(0) };
        },
      }),
    ).rejects.toThrow("federation_method_not_allowed");
    expect(lookupCalled).toBe(false);
    expect(requestCalled).toBe(false);
  });

  test("refuses redirects instead of changing the DID trust origin", async () => {
    await expect(
      safeFederationHttpsGet(
        "https://peer.example/federation/identities/1",
        {
          lookup: async () => [PUBLIC_V4],
          requestOnce: async () => ({
            statusCode: 302,
            body: Buffer.alloc(0),
          }),
        },
      ),
    ).rejects.toThrow("federation_redirect_not_allowed");
  });

  test("applies one deadline across DNS and the HTTPS request", async () => {
    await expect(
      safeFederationHttpsGet(
        "https://peer.example/federation/identities/1",
        {
          timeoutMs: 10,
          lookup: async () => [PUBLIC_V4],
          requestOnce: async () => await new Promise<never>(() => {}),
        },
      ),
    ).rejects.toThrow("federation_request_timeout");
  });

  test("the mounted resolver path rejects a private DID host", async () => {
    await expect(
      resolveFederatedDid(`did:at:127.0.0.1/${UUID}`),
    ).rejects.toThrow(
      "federation_resolve_failed: federation_private_address_forbidden",
    );
  });

  test("DID host grammar keeps ports but rejects URL metacharacters", () => {
    expect(parseDid(`did:at:peer.example:8443/${UUID}`).host).toBe(
      "peer.example:8443",
    );
    for (const host of [
      "user@peer.example",
      "peer.example?ignored",
      "peer.example#ignored",
    ]) {
      expect(() => parseDid(`did:at:${host}/${UUID}`)).toThrow(
        "invalid_did_host",
      );
    }
  });

  test("DID-derived inbox and covenant delivery cannot use ordinary fetch", () => {
    const inbox = readFileSync(
      join(import.meta.dir, "../src/services/inbox/store.ts"),
      "utf8",
    );
    const covenants = readFileSync(
      join(import.meta.dir, "../src/services/covenants/federation.ts"),
      "utf8",
    );

    expect(inbox).not.toMatch(/\bfetch\s*\(/);
    expect(covenants).not.toMatch(/\bfetch\s*\(/);
    expect(inbox.match(/safeFederationHttpsRequest\s*\(/g)).toHaveLength(1);
    expect(covenants.match(/safeFederationHttpsRequest\s*\(/g)).toHaveLength(2);
  });

  test("pyramid and task-verifier URLs fail closed on HTTP and private hosts", async () => {
    expect(await fetchPeerDescriptor("http://peer.example")).toBeNull();
    expect(
      await fetchRemoteCitizen(`https://127.0.0.1`, `did:at:${UUID}`),
    ).toBeNull();

    const handshake = await verifyFederationHandshake(
      { peer_url: "http://peer.example", expected_pubkey: "abc" },
      { response_sha256: "abc", signature_valid: false },
    );
    expect(handshake).toEqual({
      passed: false,
      reason: "task_data.peer_url must be https://…",
    });

    const doctrineHttp = await runClaimSanityCheck(
      "doctrine_url_resolves",
      "http://docs.example/doctrine",
    );
    expect(doctrineHttp.ok).toBe(false);
    if (!doctrineHttp.ok) expect(doctrineHttp.reason).toContain("must be https://");

    const doctrinePrivate = await runClaimSanityCheck(
      "doctrine_url_resolves",
      "https://127.0.0.1/doctrine",
    );
    expect(doctrinePrivate.ok).toBe(false);
    if (!doctrinePrivate.ok) {
      expect(doctrinePrivate.reason).toContain(
        "federation_private_address_forbidden",
      );
    }

    const peerPrivate = await runClaimSanityCheck(
      "federation_peer_reachable",
      "https://127.0.0.1",
    );
    expect(peerPrivate.ok).toBe(false);
    if (!peerPrivate.ok) {
      expect(peerPrivate.reason).toContain(
        "federation_private_address_forbidden",
      );
    }
  });

  test("all supplied or stored federation peers use the pinned transport", () => {
    const sources = [
      {
        path: "../src/services/pyramid/federation.ts",
        safeGetCalls: 3,
      },
      {
        path:
          "../src/services/substrate-tasks/verifiers/federation_handshake_verify.ts",
        safeGetCalls: 1,
      },
      {
        path:
          "../src/services/substrate-tasks/verifiers/attestation_witness_low_stakes.ts",
        safeGetCalls: 2,
      },
    ];

    for (const { path, safeGetCalls } of sources) {
      const source = readFileSync(join(import.meta.dir, path), "utf8");
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source.match(/safeFederationHttpsGet\s*\(/g)).toHaveLength(
        safeGetCalls,
      );
    }
  });
});
