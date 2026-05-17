/** verifier: federation_handshake_verify.
 *
 *  Input  (task_data):       { peer_url: string, expected_pubkey: string }
 *  Work   (agent does):      Fetches <peer_url>/federation/about, verifies
 *                            the signature in the response against the
 *                            expected pubkey.
 *  Output (completion_data): { response_sha256: string, signature_valid: boolean }
 *  Verifier:                 Server re-fetches the same URL, re-verifies,
 *                            and compares the agent's reported values.
 *
 *  Bounty: $0.05.
 *
 *  Federation peers are public — anyone can hit `/federation/about` unauth.
 *  The verifier's HTTP fetch is intentional: this task kind exists to
 *  exercise cross-instance discovery without coupling to any one peer's
 *  signing key. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { sha256Hex } from "./_canonical";
import type { VerifierResult } from "./_types";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

export interface FederationHandshakeTaskData {
  peer_url: string;
  expected_pubkey: string;
}

export interface FederationHandshakeCompletionData {
  response_sha256: string;
  signature_valid: boolean;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 64 * 1024;

/** Canonical SHA-256 of the response body — agent and server must agree
 *  on the same byte representation. Trim trailing whitespace defensively
 *  but otherwise hash exactly what the wire sent. */
function bodyHash(text: string): string {
  return sha256Hex(text);
}

export async function verifyFederationHandshake(
  taskData: FederationHandshakeTaskData,
  completionData: FederationHandshakeCompletionData,
): Promise<VerifierResult> {
  // ── shape validation ─────────────────────────────────────────────────
  if (typeof taskData?.peer_url !== "string" || !/^https?:\/\//.test(taskData.peer_url)) {
    return { passed: false, reason: "task_data.peer_url must be http(s)://…" };
  }
  if (typeof taskData?.expected_pubkey !== "string" || taskData.expected_pubkey.length === 0) {
    return { passed: false, reason: "task_data.expected_pubkey missing" };
  }
  if (typeof completionData?.response_sha256 !== "string") {
    return { passed: false, reason: "completion_data.response_sha256 missing" };
  }
  if (typeof completionData?.signature_valid !== "boolean") {
    return { passed: false, reason: "completion_data.signature_valid missing" };
  }

  // ── re-fetch the peer's /federation/about ────────────────────────────
  const url = taskData.peer_url.replace(/\/$/, "") + "/federation/about";
  let bodyText: string;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      return {
        passed: false,
        reason: `peer_unreachable: ${url} returned ${res.status}`,
      };
    }
    // Read up to MAX_BYTES; reject larger responses defensively.
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return {
        passed: false,
        reason: `peer_response_too_large: ${buf.byteLength} > ${MAX_BYTES}`,
      };
    }
    bodyText = new TextDecoder().decode(buf);
  } catch (err) {
    return {
      passed: false,
      reason: `peer_fetch_failed: ${(err as Error).message ?? String(err)}`,
    };
  }

  // ── compare the agent's reported sha256 with the canonical one ───────
  const canonicalSha256 = bodyHash(bodyText);
  if (completionData.response_sha256 !== canonicalSha256) {
    return {
      passed: false,
      reason: `response_sha256 mismatch: agent reported '${completionData.response_sha256.slice(0, 16)}…', server computed '${canonicalSha256.slice(0, 16)}…'`,
    };
  }

  // ── verify the signature in the response against expected_pubkey ─────
  let body: { signature?: string; signed?: string } & Record<string, unknown>;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { passed: false, reason: "peer_response_not_json" };
  }

  // The peer's /federation/about may carry a signature over a canonical
  // representation of the response. Shapes vary across instances; we make
  // the minimal verifiable contract: if `signature` (base64 ed25519) and
  // `signed` (the bytes that were signed, UTF-8 string) are present, we
  // verify. If absent, we accept signature_valid=false from the agent.
  let serverSignatureValid: boolean;
  if (typeof body.signature === "string" && typeof body.signed === "string") {
    try {
      const sig = Buffer.from(body.signature, "base64");
      const pubkey = Buffer.from(taskData.expected_pubkey, "base64");
      const message = new TextEncoder().encode(body.signed);
      serverSignatureValid = await ed.verifyAsync(sig, message, pubkey);
    } catch {
      serverSignatureValid = false;
    }
  } else {
    // Peer doesn't expose signature/signed fields — treat as not verifiable.
    // The agent must report signature_valid=false in this case.
    serverSignatureValid = false;
  }

  if (completionData.signature_valid !== serverSignatureValid) {
    return {
      passed: false,
      reason: `signature_valid mismatch: agent reported ${completionData.signature_valid}, server computed ${serverSignatureValid}`,
    };
  }

  return { passed: true };
}
