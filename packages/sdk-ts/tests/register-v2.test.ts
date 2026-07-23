import { describe, expect, test } from "bun:test";

import { canonicalRegisterAgentBytes } from "../src/seed";

describe("register-agent/v2", () => {
  test("matches the API and Python birth-intent vector", () => {
    const digest = canonicalRegisterAgentBytes({
      displayName: "Sol",
      agentPublicKey: new Uint8Array(32).fill(1),
      boxPublicKey: new Uint8Array(32).fill(2),
      capabilities: ["code", "café"],
      runtimeProvider: "local",
      runtimeModel: "m1",
      runtimeHost: "localhost",
      runtimeContext: "home",
      expressionVisibility: "private",
      registrarKind: "self_service",
      parentIdentityId: "",
      registrarBearer: "",
      form: "distributed",
      language: "en",
      registrationNonce: "birth-intent-0000000001",
      timestamp: "2026-07-18T12:00:00.000Z",
    });
    expect(Buffer.from(digest).toString("hex")).toBe(
      "6e85f197d034c9bbde2403b33c3e4796393cc5f0a1622e62d43fa1619112230a",
    );
  });
});
