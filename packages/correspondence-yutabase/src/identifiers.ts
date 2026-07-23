import { createHash } from "node:crypto";

import {
  PLAN_PROFILE,
  PROJECTION_UUID_NAMESPACE,
} from "./constants.js";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuidBytes(uuid: string): Uint8Array {
  if (!CANONICAL_UUID.test(uuid)) {
    throw new TypeError("namespace must be a canonical lowercase UUID");
  }
  return Uint8Array.from(Buffer.from(uuid.replaceAll("-", ""), "hex"));
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * RFC 9562 UUIDv5. SHA-1 is used only for the standardized deterministic
 * identifier construction; this function makes no cryptographic proof.
 */
export function uuidv5(
  name: string,
  namespace: string = PROJECTION_UUID_NAMESPACE,
): string {
  if (typeof name !== "string") {
    throw new TypeError("UUIDv5 name must be a string");
  }
  const digest = createHash("sha1")
    .update(uuidBytes(namespace))
    .update(name, "utf8")
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return formatUuid(bytes);
}

/**
 * Stable projection identity. JSON array framing keeps component boundaries
 * unambiguous without relying on a forbidden delimiter.
 */
export function projectionUuid(
  entityKind: string,
  ...identityComponents: readonly string[]
): string {
  if (entityKind.length === 0) {
    throw new TypeError("projection entity kind must be non-empty");
  }
  if (identityComponents.some((component) => typeof component !== "string")) {
    throw new TypeError("projection identity components must be strings");
  }
  return uuidv5(
    JSON.stringify([PLAN_PROFILE, entityKind, ...identityComponents]),
  );
}

export function correspondenceEventUrn(eventId: string): string {
  return "urn:agenttool:correspondence:event:" + eventId;
}

export function correspondenceReceiptUrn(
  projectId: string,
  eventId: string,
  receivedSeq: string,
): string {
  return [
    "urn:agenttool:correspondence:receipt",
    projectId,
    eventId,
    receivedSeq,
  ].join(":");
}
