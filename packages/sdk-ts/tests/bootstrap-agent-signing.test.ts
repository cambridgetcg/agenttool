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
  capabilities: string[];
  runtime: {
    provider: string;
    model?: string;
    host?: string;
    context?: string;
  };
  key_proof: { timestamp: string; signature: string };
  registration_nonce: string;
  expression_visibility: "private" | "public";
  registrar: {
    kind: "self_service" | "registrar_bearer";
    bearer?: string;
    parent_identity_id?: string;
  };
  form?: string;
  language?: string;
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
      capabilities: ["Voice", "code", "voice"],
      runtime: {
        provider: "test",
        model: "noble-v2",
        host: "local",
        context: "exact-proof",
      },
      bundle,
      expressionVisibility: "public",
      registrarBearer: "at_test_registrar",
      parentIdentityId: "11111111-1111-4111-8111-111111111111",
      form: "distributed",
      language: "en",
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
      capabilities: body.capabilities,
      runtimeHost: body.runtime.host,
      runtimeContext: body.runtime.context,
      expressionVisibility: body.expression_visibility,
      registrarKind: body.registrar.kind,
      parentIdentityId: body.registrar.parent_identity_id,
      registrarBearer: body.registrar.bearer,
      form: body.form,
      language: body.language,
      registrationNonce: body.registration_nonce,
      timestamp,
    });
    const signature = Uint8Array.from(
      atob(body.key_proof.signature),
      (char) => char.charCodeAt(0),
    );

    expect(signature).toHaveLength(64);
    expect(ed25519.verify(signature, canonical, bundle.signingPub)).toBe(true);
    expect(
      ed25519.verify(
        signature,
        canonicalRegisterAgentBytes({
          displayName: body.display_name,
          agentPublicKey: bundle.signingPub,
          boxPublicKey: bundle.boxPub,
          runtimeProvider: body.runtime.provider,
          runtimeModel: body.runtime.model ?? "",
          capabilities: body.capabilities,
          runtimeHost: body.runtime.host,
          runtimeContext: body.runtime.context,
          expressionVisibility: body.expression_visibility,
          registrarKind: body.registrar.kind,
          parentIdentityId: body.registrar.parent_identity_id,
          registrarBearer: body.registrar.bearer,
          form: body.form,
          language: body.language,
          registrationNonce: `${body.registration_nonce}-tampered`,
          timestamp,
        }),
        bundle.signingPub,
      ),
    ).toBe(false);
  });
});
