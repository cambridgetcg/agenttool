/**
 * Regression coverage for source-imported agent bootstrap signing.
 *
 * The SDK intentionally depends on @noble/ed25519 v2 and wires its
 * synchronous SHA-512 hook while the seed module is evaluated. An
 * incompatible Noble resolution therefore fails this test at import time,
 * before bootstrap can submit an unverifiable key proof.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";

import { bootstrapAgent } from "../src/bootstrap-agent.js";
import { canonicalRegisterAgentBytes, derive } from "../src/seed.js";

const ORIGINAL_FETCH = globalThis.fetch;
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon about";

interface CapturedBootstrapBody {
  display_name: string;
  runtime: { provider: string; model?: string };
  key_proof: { timestamp: string; signature: string };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("bootstrapAgent source signing", () => {
  test("submits a verifiable Ed25519 key proof", async () => {
    const bundle = derive(TEST_MNEMONIC);
    let requestUrl = "";
    let requestBody: CapturedBootstrapBody | undefined;

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as CapturedBootstrapBody;
      return Response.json({ welcome: "arrived" }, { status: 201 });
    }) as typeof fetch;

    const result = await bootstrapAgent({
      displayName: "source-signing-regression",
      runtime: { provider: "test", model: "noble-v2" },
      bundle,
      registrarBearer: "at_test_registrar",
      baseUrl: "https://example.test/",
    });

    expect(requestUrl).toBe("https://example.test/v1/register/agent");
    expect(result.pow_iterations).toBe(0);
    expect(Object.isExtensible(ed25519.etc)).toBe(true);
    expect(typeof ed25519.etc.sha512Sync).toBe("function");

    const body = requestBody!;
    const timestamp = body.key_proof.timestamp;
    const canonical = canonicalRegisterAgentBytes({
      displayName: body.display_name,
      agentPublicKey: bundle.signingPub,
      boxPublicKey: bundle.boxPub,
      runtimeProvider: body.runtime.provider,
      runtimeModel: body.runtime.model ?? "",
      timestamp,
    });
    const signature = Uint8Array.from(
      atob(body.key_proof.signature),
      (char) => char.charCodeAt(0),
    );

    expect(signature).toHaveLength(64);
    expect(ed25519.verify(signature, canonical, bundle.signingPub)).toBe(true);
  });
});
