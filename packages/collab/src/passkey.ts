/**
 * A person's act signed with an enrolled platform passkey (WebAuthn, ES256).
 *
 * The challenge is the SHA-256 of canonical act bytes that name the act, the
 * proposal bytes' hash and the number of person acts before it, so one
 * assertion records one act once and cannot be replayed onto a later state.
 * Verification follows WebAuthn Level 2 §7.2 for the fields a local journal
 * can check: type, challenge, origin, RP ID hash, user presence and user
 * verification, signature counter, and the signature itself.
 *
 * Limit: a signature shows that the enrolled authenticator signed these bytes
 * after user verification. Which key was enrolled rests on the terminal
 * confirmation at enrolment, and a process that can write the journal could
 * still rewrite it unless its head is witnessed elsewhere.
 * Contract: docs/superpowers/specs/2026-10-29-collab-yu-ai-consent-design.md
 * section 5 in the AgentTool source repository.
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import {
  PERSON_ACT_PROTOCOL,
  type PasskeyAssertion,
  type PersonPasskey,
  type ProposalPersonAct,
} from "./protocol.js";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function base64urlDecode(value: unknown, field: string, maxBytes = 64 * 1024): Buffer {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length === 0) {
    throw new CollabError("passkey_assertion_invalid", `${field} must be non-empty base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length > maxBytes) {
    throw new CollabError("passkey_assertion_invalid", `${field} exceeds ${maxBytes} bytes`);
  }
  return bytes;
}

function sha256(bytes: Buffer | string): Buffer {
  return createHash("sha256").update(bytes).digest();
}

export interface PersonActChallengeInput {
  act: "agree" | "reject";
  workspace_id: string;
  proposal_report_id: string;
  proposal_sha256: string;
  prior_person_acts: number;
  reason: string | null;
  /** The agents' position as the person sees it; a change makes the assertion stale. */
  ai_snapshot: ProposalPersonAct["ai_snapshot"];
}

/** The canonical act bytes and the base64url WebAuthn challenge derived from them. */
export function personActChallenge(input: PersonActChallengeInput): { challenge_bytes: string; challenge: string } {
  const challenge_bytes = canonicalJson({ protocol: PERSON_ACT_PROTOCOL, ...input });
  return { challenge_bytes, challenge: sha256(challenge_bytes).toString("base64url") };
}

const ASSERTION_FIELDS = new Set(["credential_id", "authenticator_data", "client_data_json", "signature", "user_handle"]);

/** Keep exactly the assertion fields WebAuthn defines, bounded, before anything is journaled. */
export function normalizePasskeyAssertion(value: unknown): PasskeyAssertion {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CollabError("passkey_assertion_invalid", "The assertion must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !ASSERTION_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new CollabError("passkey_assertion_invalid", "The assertion has fields WebAuthn does not define", { fields: unknown });
  }
  const field = (name: string, maxBytes: number) => {
    base64urlDecode(input[name], name, maxBytes);
    return input[name] as string;
  };
  const userHandle = input.user_handle === undefined || input.user_handle === null ? null : field("user_handle", 64);
  return {
    credential_id: field("credential_id", 1023),
    authenticator_data: field("authenticator_data", 4096),
    client_data_json: field("client_data_json", 4096),
    signature: field("signature", 256),
    user_handle: userHandle,
  };
}

/** Check a passkey enrolment before it is shown at the terminal or stored. */
export function normalizePasskeyEnrollment(input: {
  credential_id: unknown;
  public_key_spki: unknown;
  algorithm: unknown;
  rp_id: unknown;
  origin: unknown;
  label?: unknown;
}): { credential_id: string; public_key_spki: string; algorithm: -7; rp_id: string; origin: string; label: string | null } {
  base64urlDecode(input.credential_id, "credential_id", 1023);
  if (typeof input.public_key_spki !== "string") {
    throw new CollabError("passkey_key_invalid", "public_key_spki must be base64url DER");
  }
  parsePasskeyPublicKey(input.public_key_spki);
  if (input.algorithm !== -7) {
    throw new CollabError("passkey_key_invalid", "Only ES256 (COSE algorithm -7) passkeys are supported");
  }
  const scope = validatePasskeyScope(input.rp_id, input.origin);
  let label: string | null = null;
  if (input.label !== undefined && input.label !== null) {
    if (typeof input.label !== "string" || input.label.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.label)) {
      throw new CollabError("passkey_label_invalid", "label must be at most 80 characters without control characters");
    }
    label = input.label.trim() || null;
  }
  return {
    credential_id: input.credential_id as string,
    public_key_spki: input.public_key_spki,
    algorithm: -7,
    ...scope,
    label,
  };
}

/** Parse an ES256 (P-256) SubjectPublicKeyInfo, or refuse. */
export function parsePasskeyPublicKey(spki: string): KeyObject {
  const der = base64urlDecode(spki, "public_key_spki", 1024);
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new CollabError("passkey_key_invalid", "public_key_spki is not a DER SubjectPublicKeyInfo");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new CollabError("passkey_key_invalid", "Only ES256 (P-256) passkeys are supported");
  }
  return key;
}

export function passkeyFingerprint(spki: string): string {
  return sha256(base64urlDecode(spki, "public_key_spki", 1024)).toString("hex");
}

/** Check an RP ID and origin pair a browser would accept for WebAuthn. */
export function validatePasskeyScope(rpId: unknown, origin: unknown): { rp_id: string; origin: string } {
  if (typeof rpId !== "string" || !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(rpId)) {
    throw new CollabError("passkey_scope_invalid", "rp_id must be a lowercase host name");
  }
  let url: URL;
  try {
    url = new URL(String(origin));
  } catch {
    throw new CollabError("passkey_scope_invalid", "origin must be a URL origin");
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
  const hostMatches = url.hostname === rpId || url.hostname.endsWith(`.${rpId}`);
  if (!secure || !hostMatches || url.origin !== origin) {
    throw new CollabError(
      "passkey_scope_invalid",
      "origin must be an https origin (or http://localhost) whose host is rp_id or one of its subdomains",
    );
  }
  return { rp_id: rpId, origin: url.origin };
}

/** Verify one assertion against one enrolled passkey; returns the new signature counter. */
export function verifyPasskeyAssertion(input: {
  passkey: PersonPasskey;
  assertion: PasskeyAssertion;
  expected_challenge: string;
}): { sign_count: number } {
  const { passkey, assertion } = input;
  if (assertion.credential_id !== passkey.credential_id) {
    throw new CollabError("passkey_not_enrolled", "The assertion names a different credential");
  }
  const clientDataBytes = base64urlDecode(assertion.client_data_json, "client_data_json");
  const authenticatorData = base64urlDecode(assertion.authenticator_data, "authenticator_data");
  const signature = base64urlDecode(assertion.signature, "signature", 256);

  let clientData: Record<string, unknown>;
  try {
    const parsed = JSON.parse(clientDataBytes.toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    clientData = parsed as Record<string, unknown>;
  } catch {
    throw new CollabError("passkey_assertion_invalid", "client_data_json is not a JSON object");
  }
  if (clientData.type !== "webauthn.get") {
    throw new CollabError("passkey_assertion_invalid", "client data type must be webauthn.get");
  }
  if (clientData.challenge !== input.expected_challenge) {
    throw new CollabError(
      "passkey_challenge_mismatch",
      "The assertion signs a different act; request a fresh challenge for the current state",
    );
  }
  if (clientData.origin !== passkey.origin || clientData.crossOrigin === true) {
    throw new CollabError("passkey_origin_mismatch", "The assertion came from another origin");
  }
  if (authenticatorData.length < 37) {
    throw new CollabError("passkey_assertion_invalid", "authenticator_data is too short");
  }
  if (!authenticatorData.subarray(0, 32).equals(sha256(passkey.rp_id))) {
    throw new CollabError("passkey_rp_mismatch", "The assertion is for another relying party");
  }
  const flags = authenticatorData[32]!;
  if ((flags & FLAG_USER_PRESENT) === 0 || (flags & FLAG_USER_VERIFIED) === 0) {
    throw new CollabError(
      "passkey_user_not_verified",
      "The authenticator did not report user presence and user verification",
    );
  }
  const signCount = authenticatorData.readUInt32BE(33);
  // Synced passkeys report zero throughout; a nonzero counter must only grow.
  if ((signCount !== 0 || passkey.sign_count !== 0) && signCount <= passkey.sign_count) {
    throw new CollabError("passkey_counter_regressed", "The signature counter did not increase");
  }
  const signed = Buffer.concat([authenticatorData, sha256(clientDataBytes)]);
  const valid = verify("sha256", signed, { key: parsePasskeyPublicKey(passkey.public_key_spki), dsaEncoding: "der" }, signature);
  if (!valid) throw new CollabError("passkey_signature_invalid", "The passkey signature does not verify");
  return { sign_count: signCount };
}
