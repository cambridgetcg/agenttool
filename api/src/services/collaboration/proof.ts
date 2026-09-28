/** Exact mission request proofs use no constitutional identity cursor. Doctrine: docs/COLLABORATION-MISSIONS.md. */
import { createHash } from "node:crypto";
import { verifyBytes } from "../identity/crypto";
import { MISSION_BOUNDS, missionDateSchema, missionUuidSchema, validMissionOrigin, type MissionRequest } from "./contracts";

export const MISSION_REQUEST_DOMAIN = "agenttool-collaboration-request/v1";
export const missionSha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export function canonicalMissionRequestBytes(input: Omit<MissionRequest, "token">): Uint8Array {
  const { proof } = input;
  const fields = [input.origin, input.method, input.requestTarget, input.missionId,
    proof.grantId, proof.identityId, proof.keyId, missionSha256(input.bodyBytes), proof.timestamp];
  if (!validMissionOrigin(input.origin) || !["GET", "POST"].includes(input.method)
    || !input.requestTarget.startsWith("/") || input.requestTarget.includes("#")
    || fields.some(value => typeof value !== "string" || value.includes("\0"))
    || ![input.missionId, proof.grantId, proof.identityId, proof.keyId].every(value => missionUuidSchema.safeParse(value).success)
    || !missionDateSchema.safeParse(proof.timestamp).success) throw new Error("Invalid mission proof fields");
  return createHash("sha256").update([MISSION_REQUEST_DOMAIN, ...fields].join("\0"), "utf8").digest();
}
export function verifyMissionProof(input: MissionRequest, publicKey: string, now: Date): boolean {
  try {
    if (Math.abs(now.getTime() - new Date(input.proof.timestamp).getTime()) > MISSION_BOUNDS.proofWindowMs) return false;
    const signature = Buffer.from(input.proof.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== input.proof.signature) return false;
    return verifyBytes(canonicalMissionRequestBytes(input), signature.toString("base64"), publicKey);
  } catch { return false; }
}
