import { describe, expect, test } from "bun:test";
import {
  AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  AgentCredError,
  PolicyConsent,
  type BrokerPolicy,
} from "../src/index.js";
import { normalizeGrantRequest } from "../src/policy.js";
import { grantRequest, jsonRpcReadGrantRequest } from "./helpers.js";

const OWNER_POLICY: BrokerPolicy = {
  credential: "agenttool/default",
  origin: "https://api.example.com",
  methods: ["GET", "POST"],
  pathPrefixes: ["/v1"],
  queryNames: ["limit", "cursor"],
  headerValues: { "x-agent-id": ["acting-agent"] },
  maxTtlSeconds: 60,
  maxUses: 5,
  maxRequestBytes: 1024,
  maxResponseBytes: 2048,
  allowPrivateNetwork: false,
};

const JSON_RPC_OWNER_POLICY: BrokerPolicy = {
  operation: "jsonrpc.read",
  profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
  credential: "agenttool/default",
  origin: "https://eth-mainnet.g.alchemy.com",
  chainId: "eip155:1",
  methods: ["eth_chainId", "eth_blockNumber", "eth_getBalance"],
  maxTtlSeconds: 60,
  maxUses: 5,
  maxRequestBytes: 1024,
  maxResponseBytes: 2048,
  allowPrivateNetwork: false,
};

function request(scope: Record<string, unknown> = {}) {
  const base = grantRequest();
  return normalizeGrantRequest({
    ...base,
    scope: {
      ...base.scope,
      methods: ["GET"],
      pathPrefixes: ["/v1/memories"],
      queryNames: ["limit"],
      ttlSeconds: 30,
      maxUses: 2,
      maxRequestBytes: 512,
      maxResponseBytes: 1024,
      ...scope,
    },
  });
}

function jsonRpcRequest(scope: Record<string, unknown> = {}) {
  const base = jsonRpcReadGrantRequest();
  return normalizeGrantRequest({
    ...base,
    scope: {
      ...base.scope,
      methods: ["eth_chainId", "eth_getBalance"],
      ttlSeconds: 30,
      maxUses: 2,
      maxRequestBytes: 512,
      maxResponseBytes: 1024,
      ...scope,
    },
  });
}

describe("owner policy containment", () => {
  test("accepts an equal-or-narrower scope", async () => {
    const consent = new PolicyConsent([OWNER_POLICY]);
    await expect(consent.decide(request())).resolves.toEqual({ allowed: true });
  });

  test("denies every widened authority dimension", async () => {
    const consent = new PolicyConsent([OWNER_POLICY]);
    const widened = [
      { origin: "https://other.example.com" },
      { methods: ["DELETE"] },
      { pathPrefixes: ["/v10"] },
      { pathPrefixes: ["/admin"] },
      { queryNames: ["other"] },
      { headerValues: { "x-agent-id": ["other-agent"] } },
      { allowPaymentSignature: true },
      { ttlSeconds: 61 },
      { maxUses: 6 },
      { maxRequestBytes: 1025 },
      { maxResponseBytes: 2049 },
      { allowPrivateNetwork: true },
    ];
    for (const scope of widened) {
      await expect(consent.decide(request(scope))).resolves.toMatchObject({ allowed: false });
    }
  });

  test("private-network use requires both owner policy and requested grant", async () => {
    const privateConsent = new PolicyConsent([
      { ...OWNER_POLICY, allowPrivateNetwork: true },
    ]);
    await expect(
      privateConsent.decide(request({ allowPrivateNetwork: true })),
    ).resolves.toEqual({ allowed: true });
  });

  test("PAYMENT-SIGNATURE forwarding requires both owner policy and requested grant", async () => {
    const paymentConsent = new PolicyConsent([
      { ...OWNER_POLICY, allowPaymentSignature: true },
    ]);
    await expect(
      paymentConsent.decide(request({ allowPaymentSignature: true })),
    ).resolves.toEqual({ allowed: true });
  });

  test("accepts an exact authority-sensitive header value", async () => {
    const consent = new PolicyConsent([OWNER_POLICY]);
    await expect(
      consent.decide(request({ headerValues: { "x-agent-id": ["acting-agent"] } })),
    ).resolves.toEqual({ allowed: true });
  });

  test("rejects authentication-like query names in owner policy", () => {
    expect(
      () => new PolicyConsent([{ ...OWNER_POLICY, queryNames: ["access_token"] }]),
    ).toThrow(AgentCredError);
  });

  test("accepts a narrower negotiated JSON-RPC read scope", async () => {
    const consent = new PolicyConsent([JSON_RPC_OWNER_POLICY]);
    await expect(consent.decide(jsonRpcRequest())).resolves.toEqual({
      allowed: true,
    });
  });

  test("denies every widened JSON-RPC authority dimension", async () => {
    const consent = new PolicyConsent([JSON_RPC_OWNER_POLICY]);
    const widened = [
      { origin: "https://base-mainnet.g.alchemy.com" },
      { chainId: "eip155:8453" },
      { methods: ["eth_getTransactionReceipt"] },
      { ttlSeconds: 61 },
      { maxUses: 6 },
      { maxRequestBytes: 1025 },
      { maxResponseBytes: 2049 },
      { allowPrivateNetwork: true },
    ];
    for (const scope of widened) {
      await expect(consent.decide(jsonRpcRequest(scope))).resolves.toMatchObject({
        allowed: false,
      });
    }
  });

  test("rejects state-changing methods in JSON-RPC owner policy", () => {
    expect(
      () =>
        new PolicyConsent([
          {
            ...JSON_RPC_OWNER_POLICY,
            methods: ["eth_sendRawTransaction"],
          } as never,
        ]),
    ).toThrow(AgentCredError);
  });
});
