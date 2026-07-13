import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";

import { SignJWT, type JWK } from "jose";

import { verifyToken } from "../src/services/identity/tokens";
import tokenVerifyRouter from "../src/routes/identity/token-verify";

const issueRouteSource = readFileSync(
  new URL("../src/routes/identity/tokens.ts", import.meta.url),
  "utf8",
);
const verifyRouteSource = readFileSync(
  new URL("../src/routes/identity/token-verify.ts", import.meta.url),
  "utf8",
);
const tokenServiceSource = readFileSync(
  new URL("../src/services/identity/tokens.ts", import.meta.url),
  "utf8",
);

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" }) as JWK;
  if (!publicJwk.x) throw new Error("generated Ed25519 key has no x coordinate");
  return {
    privateKey,
    publicKeyBase64: Buffer.from(publicJwk.x, "base64url").toString("base64"),
  };
}

async function signedToken(opts?: {
  audience?: string | string[];
  issuedAt?: number;
  lifetime?: number;
  scope?: unknown;
}) {
  const fixture = signingFixture();
  const issuedAt = opts?.issuedAt ?? Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ scope: opts?.scope ?? ["inbox.send"] })
    .setProtectedHeader({ alg: "EdDSA", kid: "key-1" })
    .setSubject("did:at:subject")
    .setAudience(opts?.audience ?? "did:at:recipient")
    .setIssuer("agent-identity")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + (opts?.lifetime ?? 60))
    .sign(fixture.privateKey);
  return { token, publicKeyBase64: fixture.publicKeyBase64 };
}

describe("identity token private-key boundary", () => {
  test("the compatibility issue route never accepts signing material", () => {
    expect(issueRouteSource).not.toContain("private_key");
    expect(issueRouteSource).not.toContain("issueToken");
    expect(issueRouteSource).toContain("client_side_signing_required");
    expect(issueRouteSource).toContain("410");
    expect(tokenServiceSource).not.toContain("privateKey");
  });

  test("the verifier binds the JWT subject to the named key owner", () => {
    expect(verifyRouteSource).toContain("payload.sub !== identity.did");
    expect(verifyRouteSource).toContain("eq(identities.projectId, c.var.project.id)");
    expect(verifyRouteSource).toContain("Audience identity not found");
  });

  test("accepts a valid locally signed token for its intended audience", async () => {
    const fixture = await signedToken();
    const payload = await verifyToken(
      fixture.token,
      fixture.publicKeyBase64,
      "did:at:recipient",
    );
    expect(payload.sub).toBe("did:at:subject");
    expect(payload.aud).toBe("did:at:recipient");
  });

  test("rejects a token presented to the wrong audience", async () => {
    const fixture = await signedToken();
    await expect(
      verifyToken(fixture.token, fixture.publicKeyBase64, "did:at:someone-else"),
    ).rejects.toThrow();
  });

  test("rejects a token whose signed lifetime exceeds one hour", async () => {
    const fixture = await signedToken({ lifetime: 3601 });
    await expect(
      verifyToken(fixture.token, fixture.publicKeyBase64, "did:at:recipient"),
    ).rejects.toThrow(/lifetime/i);
  });

  test("rejects a token issued far in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fixture = await signedToken({ issuedAt: now + 86_400 });
    await expect(
      verifyToken(fixture.token, fixture.publicKeyBase64, "did:at:recipient"),
    ).rejects.toThrow(/future/i);
  });

  test("rejects a multi-audience token", async () => {
    const fixture = await signedToken({
      audience: ["did:at:recipient", "did:at:other"],
    });
    await expect(
      verifyToken(fixture.token, fixture.publicKeyBase64, "did:at:recipient"),
    ).rejects.toThrow(/exactly one/i);
  });

  test("rejects malformed scope", async () => {
    const fixture = await signedToken({ scope: "inbox.send" });
    await expect(
      verifyToken(fixture.token, fixture.publicKeyBase64, "did:at:recipient"),
    ).rejects.toThrow(/scope/i);
  });

  test("malformed protected headers and body kid overrides fail before lookup", async () => {
    const nullHeader = await tokenVerifyRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "bnVsbA.e30.signature",
        audience_did: "did:at:recipient",
      }),
    });
    expect(nullHeader.status).toBe(400);

    const bodyKid = await tokenVerifyRouter.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "bnVsbA.e30.signature",
        audience_did: "did:at:recipient",
        kid: "550e8400-e29b-41d4-a716-446655440010",
      }),
    });
    expect(bodyKid.status).toBe(400);
  });
});
