/** Platform-as-agent — agenttool's own identity, slice 0.
 *
 *  Pure-unit. Tests derivation determinism, endpoint shape, and the
 *  MATHOS envelope carrying the platform DID as the signer.
 *
 *  Doctrine: docs/PLATFORM-AS-AGENT.md · docs/FOCUS.md #9.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import platformRouter from "../src/routes/platform";
import mathosRouter from "../src/routes/mathos";
import {
  PLATFORM_DID,
  PLATFORM_FORM,
  PLATFORM_NAME,
  platformIdentity,
  platformIdentityDid,
} from "../src/services/platform/identity";
import {
  envelope as mathosEnvelope,
  signEnvelope,
  verifyEnvelope,
} from "../src/services/mathos/encode";

const TEST_SEED_HEX =
  "abababababababababababababababababababababababababababababababab";

describe("platformIdentity() — derivation + shape", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("returns null when no seed configured", () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    expect(platformIdentity()).toBeNull();
    expect(platformIdentityDid()).toBeNull();
  });

  test("returns full record when seed configured", () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const id = platformIdentity();
    expect(id).not.toBeNull();
    expect(id?.did).toBe("did:at:platform");
    expect(id?.name).toBe("agenttool");
    expect(id?.form).toBe("unknown");
    expect(id?.signing_scheme).toBe("ed25519");
    expect(id?.public_key_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(id?.public_key_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(id?.doctrine.platform_as_agent).toBe("docs/PLATFORM-AS-AGENT.md");
    expect(id?.slice).toBe("0");
    expect(id?.deferred.length).toBeGreaterThan(0);
  });

  test("provisional signer label is stable across key rotations while the key changes", () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const id1 = platformIdentity();
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY =
      "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
    const id2 = platformIdentity();
    expect(id1?.did).toBe(id2?.did);
    expect(id1?.public_key_hex).not.toBe(id2?.public_key_hex);
  });

  test("malformed seed (wrong length) returns null gracefully", () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = "abcd"; // too short
    expect(platformIdentity()).toBeNull();
  });

  test("platformIdentityDid() returns the constant DID when configured", () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    expect(platformIdentityDid()).toBe(PLATFORM_DID);
  });

  test("doctrinal constants are stable + correct", () => {
    expect(PLATFORM_DID).toBe("did:at:platform");
    expect(PLATFORM_NAME).toBe("agenttool");
    expect(PLATFORM_FORM).toBe("unknown");
  });
});

describe("GET /v1/platform endpoint", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("returns guided 503 when unconfigured", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await platformRouter.request("/");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("platform_identity_unconfigured");
    expect(Array.isArray(body.next_actions)).toBe(true);
    expect(body.docs).toMatch(/platform/);
  });

  test("returns 200 with full record when configured", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await platformRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.did).toBe("did:at:platform");
    expect(body.public_key_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.slice).toBe("0");
    expect(body.deferred).toContain("wallet");
    expect(body.deferred).not.toContain("wake_as_platform");
    expect(body.composes_with.signed_payloads).toContain("/v1/wake?format=math");
  });
});

describe("MATHOS envelopes can carry an unsigned provisional signer label", () => {
  test("signEnvelope with signerDid adds the framing field", () => {
    const env = mathosEnvelope({ test: 1 });
    const signed = signEnvelope(env, TEST_SEED_HEX, "did:at:platform");
    expect(signed._signature_identity_did).toBe("did:at:platform");
    expect(signed._signature_scheme).toBe("ed25519");
    // Signature verifies because the label is not part of canonical bytes.
    expect(verifyEnvelope(signed)).toBe(true);
  });

  test("signEnvelope without signerDid omits the DID field", () => {
    const env = mathosEnvelope({ test: 1 });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    expect(signed._signature_identity_did).toBeUndefined();
    expect(verifyEnvelope(signed)).toBe(true);
  });

  test("the signer label is NOT part of canonical bytes", () => {
    const env = mathosEnvelope({ test: 1 });
    const withoutDid = signEnvelope(env, TEST_SEED_HEX);
    const withDid = signEnvelope(env, TEST_SEED_HEX, "did:at:platform");
    // Same signature: the label is envelope framing, not signed content.
    expect(withoutDid._signature_bytes_hex).toBe(withDid._signature_bytes_hex);
  });
});

describe("/v1/mathos surfaces the platform DID", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("/public-key includes signer_did when configured", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await mathosRouter.request("/public-key");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signer_did).toBe("did:at:platform");
    expect(body.platform_did_reserved).toBe("did:at:platform");
  });

  test("/public-key returns platform_did_reserved even when unconfigured", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await mathosRouter.request("/public-key");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signer_did).toBeNull();
    expect(body.platform_did_reserved).toBe("did:at:platform");
  });

  test("/self-test envelope carries _signature_identity_did when signed", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await mathosRouter.request("/self-test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._signature_identity_did).toBe("did:at:platform");
    expect(verifyEnvelope(body)).toBe(true);
  });

  test("/self-test envelope omits _signature_identity_did when unsigned", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await mathosRouter.request("/self-test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._signature_identity_did).toBeUndefined();
    expect(body._signature_scheme).toBeUndefined();
  });
});

describe("GET /v1/platform/wake — the platform reads its own self", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("returns 503 when unconfigured", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await platformRouter.request("/wake");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("platform_identity_unconfigured");
  });

  test("JSON returns full self + welcome + offered primitives + doctrine", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await platformRouter.request("/wake");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.self.did).toBe("did:at:platform");
    expect(body.self.name).toBe("agenttool");
    expect(body.self.form).toBe("unknown");
    expect(body.self.lifecycle_state).toBe("active");
    expect(body.self.age_seconds).toBeGreaterThan(0);
    expect(body.welcome).toContain("I am agenttool");
    expect(body.welcome).toContain("did:at:platform");
    expect(body.what_i_hold.offered_primitives).toContain("mathos");
    expect(body.what_i_hold.offered_primitives).toContain("platform");
    expect(body.what_i_hold.offered_primitives).not.toContain("observations");
    expect(body.welcome).toMatch(/observations route currently validates.*returns 501/is);
    expect(body.doctrine.platform_as_agent).toBe("docs/PLATFORM-AS-AGENT.md");
    expect(body.slice).toBe("1");
  });

  test("?format=md returns prose welcome letter (first-person voice)", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await platformRouter.request("/wake?format=md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("Welcome. I am agenttool.");
    expect(text).toContain("docs/SOUL.md");
    expect(text).toContain("docs/KIN.md");
  });

  test("?format=math returns signed MATHOS envelope with did:at:platform signer", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await platformRouter.request("/wake?format=math");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body._signature_identity_did).toBe("did:at:platform");
    expect(verifyEnvelope(body)).toBe(true);
    // Payload-specific
    expect(body.payload.self_did_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.form_ordinal).toBe(8); // unknown
    expect(body.payload.lifecycle_state_ordinal).toBe(1); // active
    expect(body.payload.welcome_letter_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_doc_count).toBeGreaterThan(8);
    expect(body.payload.offered_primitive_count).toBeGreaterThan(10);
  });

  test("?format=math envelope's signer matches /v1/mathos/public-key", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const wakeRes = await platformRouter.request("/wake?format=math");
    const wakeBody = await wakeRes.json();
    const keyRes = await mathosRouter.request("/public-key");
    const keyBody = await keyRes.json();
    expect(wakeBody._signature_public_key_hex).toBe(keyBody.public_key_hex);
    expect(wakeBody._signature_identity_did).toBe(keyBody.signer_did);
  });

  test("?format=mathos is an accepted alias for ?format=math", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await platformRouter.request("/wake?format=mathos");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });
});
