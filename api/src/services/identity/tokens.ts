/** Agent-to-agent JWT verification via jose.
 *
 *  Tokens are EdDSA-signed where the agent's private key lives.
 *  - sub: issuer agent's DID
 *  - aud: target agent's DID
 *  - iss: "agent-identity"
 *  - exp: capped at identityConfig.tokenMaxTtlSeconds (default 1h)
 *  - kid: which key signed the token */

import * as jose from "jose";
import { identityConfig } from "./config";

export async function verifyToken(
  token: string,
  publicKey: string, // base64 ed25519 public key
  audienceDid: string,
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
    algorithms: ["EdDSA"],
    issuer: "agent-identity",
    audience: audienceDid,
    clockTolerance: 60,
  });

  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
    throw new Error("Token must contain numeric iat and exp claims");
  }
  if (typeof payload.aud !== "string" || payload.aud !== audienceDid) {
    throw new Error("Token audience must be exactly one matching DID");
  }
  const now = Math.floor(Date.now() / 1000);
  const clockSkewSeconds = 60;
  const lifetime = payload.exp - payload.iat;
  if (lifetime <= 0 || lifetime > identityConfig.tokenMaxTtlSeconds) {
    throw new Error("Token lifetime exceeds the configured maximum");
  }
  if (payload.iat > now + clockSkewSeconds) {
    throw new Error("Token issued-at time is in the future");
  }
  if (payload.iat < now - identityConfig.tokenMaxTtlSeconds - clockSkewSeconds) {
    throw new Error("Token issued-at time is stale");
  }
  if (payload.exp > now + identityConfig.tokenMaxTtlSeconds + clockSkewSeconds) {
    throw new Error("Token expiry exceeds the configured verification window");
  }
  if (
    payload.scope !== undefined &&
    (!Array.isArray(payload.scope) || payload.scope.some((item) => typeof item !== "string"))
  ) {
    throw new Error("Token scope must be an array of strings");
  }

  return payload;
}
