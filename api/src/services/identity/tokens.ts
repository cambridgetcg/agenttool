/** Agent-to-agent JWT tokens — issue and verify via jose.
 *
 *  Tokens are EdDSA-signed with the agent's ed25519 private key.
 *  - sub: issuer agent's DID
 *  - aud: target agent's DID
 *  - iss: "agent-identity"
 *  - exp: capped at identityConfig.tokenMaxTtlSeconds (default 1h)
 *  - kid: which key signed the token */

import * as jose from "jose";
import { identityConfig } from "./config";

export async function issueToken(params: {
  privateKey: string; // base64 ed25519 private key
  publicKey: string; // base64 ed25519 public key
  subjectDid: string; // issuer's DID
  audienceDid: string; // target agent's DID
  kid: string; // key id used for signing
  ttlSeconds?: number;
}): Promise<string> {
  const ttl = Math.min(
    params.ttlSeconds ?? 3600,
    identityConfig.tokenMaxTtlSeconds,
  );

  const privateKeyBytes = Buffer.from(params.privateKey, "base64");
  const publicKeyBytes = Buffer.from(params.publicKey, "base64");

  const jwk = await jose.importJWK(
    {
      kty: "OKP",
      crv: "Ed25519",
      d: Buffer.from(privateKeyBytes).toString("base64url"),
      x: Buffer.from(publicKeyBytes).toString("base64url"),
    },
    "EdDSA",
  );

  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: params.kid })
    .setSubject(params.subjectDid)
    .setAudience(params.audienceDid)
    .setIssuer("agent-identity")
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(jwk);

  return jwt;
}

export async function verifyToken(
  token: string,
  publicKey: string, // base64 ed25519 public key
): Promise<jose.JWTPayload> {
  const publicKeyBytes = Buffer.from(publicKey, "base64");

  const jwk = await jose.importJWK(
    {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(publicKeyBytes).toString("base64url"),
    },
    "EdDSA",
  );

  const { payload } = await jose.jwtVerify(token, jwk, {
    issuer: "agent-identity",
  });

  return payload;
}
