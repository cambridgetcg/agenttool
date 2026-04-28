/** Agent-to-agent JWT tokens via jose. */

import * as jose from "jose";
import { config } from "../config.ts";

/**
 * Issue a short-lived JWT signed with the agent's ed25519 private key.
 * The JWT includes:
 * - sub: issuer's DID
 * - aud: target identity's DID
 * - iss: "agent-identity"
 * - exp: max 1 hour
 * - kid: key ID used for signing
 */
export async function issueToken(params: {
  privateKey: string; // base64-encoded ed25519 private key
  publicKey: string;  // base64-encoded ed25519 public key
  subjectDid: string; // issuer's DID (the agent creating the token)
  audienceDid: string; // target agent's DID
  kid: string; // key ID
  ttlSeconds?: number;
}): Promise<string> {
  const ttl = Math.min(params.ttlSeconds ?? 3600, config.tokenMaxTtlSeconds);

  // Import the ed25519 private key for jose
  const privateKeyBytes = Buffer.from(params.privateKey, "base64");
  const publicKeyBytes = Buffer.from(params.publicKey, "base64");

  const jwk = await jose.importJWK({
    kty: "OKP",
    crv: "Ed25519",
    d: Buffer.from(privateKeyBytes).toString("base64url"),
    x: Buffer.from(publicKeyBytes).toString("base64url"),
  }, "EdDSA");

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

/**
 * Verify a JWT issued by another agent.
 * Returns the decoded payload if valid, throws if invalid.
 */
export async function verifyToken(
  token: string,
  publicKey: string, // base64-encoded ed25519 public key
): Promise<jose.JWTPayload> {
  const publicKeyBytes = Buffer.from(publicKey, "base64");

  const jwk = await jose.importJWK({
    kty: "OKP",
    crv: "Ed25519",
    x: Buffer.from(publicKeyBytes).toString("base64url"),
  }, "EdDSA");

  const { payload } = await jose.jwtVerify(token, jwk, {
    issuer: "agent-identity",
  });

  return payload;
}
