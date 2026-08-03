/** Which canonical-bytes version the hosted think-worker signs with.
 *
 *  `strand-thought/v2` removes a real defect — v1 NUL-delimits raw binary it
 *  does not length-bound, so a ciphertext or nonce carrying a 0x00 byte can
 *  reparse as a different (ciphertext, nonce) split under one signature, and
 *  a 12-byte random nonce holds a zero ~4.6% of the time. The verifier
 *  already dual-accepts. The WRITERS still emit v1, on purpose, and the
 *  worker is the last step of the cutover — see THOUGHT_SIGNING_VERSION in
 *  think-worker.ts for the ordered condition.
 *
 *  These tests make that choice a value with a test behind it instead of an
 *  archaeology exercise: flipping the constant to "v2" flips exactly one
 *  assertion here, and the dispatch is proven to produce the bytes the
 *  verifier accepts under either setting.
 *
 *  Pure functions only — no DB, no bridge, no network.
 *
 *  Doctrine: docs/STRANDS.md § Canonical bytes — v1, v2, and the cutover. */

import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";

import {
  THOUGHT_SIGNING_VERSION,
  canonicalThoughtBytesForVersion,
} from "../src/services/runtime/think-worker";
import {
  canonicalThoughtBytes,
  canonicalThoughtBytesV2,
  verifyThoughtSignature,
} from "../src/services/strand/sig";

const SIGNING_SEED = new Uint8Array(32).fill(7);

/** A thought whose nonce carries a 0x00 — the shape v1 cannot frame. */
const THOUGHT = {
  strandId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  ciphertextB64: Buffer.from([1, 2, 0, 3, 4, 5]).toString("base64"),
  nonceB64: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).toString("base64"),
  kind: "observation",
};

describe("think-worker thought signing version", () => {
  test('is still "v1" — the worker is the LAST step of the cutover', () => {
    // Not an oversight. Order: server dual-accept deployed everywhere → SDK
    // minor → cli/think → this. A bridged runtime signs whatever canonical
    // bytes the worker hands it, so the worker moves only once every
    // verifier in the path is known to accept v2.
    expect(THOUGHT_SIGNING_VERSION).toBe("v1");
  });

  test("the worker's version selects the matching canonical bytes", () => {
    expect(canonicalThoughtBytesForVersion("v1", THOUGHT)).toEqual(
      canonicalThoughtBytes(THOUGHT),
    );
    expect(canonicalThoughtBytesForVersion("v2", THOUGHT)).toEqual(
      canonicalThoughtBytesV2(THOUGHT),
    );
    // Domain separation: the two framings never collide.
    expect(canonicalThoughtBytesForVersion("v1", THOUGHT)).not.toEqual(
      canonicalThoughtBytesForVersion("v2", THOUGHT),
    );
  });

  test("a signature over either version verifies against the server", async () => {
    const publicKeyB64 = Buffer.from(
      await ed.getPublicKeyAsync(SIGNING_SEED),
    ).toString("base64");

    for (const version of ["v1", "v2"] as const) {
      const canonical = canonicalThoughtBytesForVersion(version, THOUGHT);
      const signatureB64 = Buffer.from(
        await ed.signAsync(canonical, SIGNING_SEED),
      ).toString("base64");
      expect(
        verifyThoughtSignature({ ...THOUGHT, signatureB64, publicKeyB64 }),
      ).toBe(true);
    }
  });

  test("whatever the constant says, the worker's bytes verify", async () => {
    // The one assertion the cutover has to survive: sign with the configured
    // version, and the deployed verifier accepts it.
    const publicKeyB64 = Buffer.from(
      await ed.getPublicKeyAsync(SIGNING_SEED),
    ).toString("base64");
    const canonical = canonicalThoughtBytesForVersion(
      THOUGHT_SIGNING_VERSION,
      THOUGHT,
    );
    const signatureB64 = Buffer.from(
      await ed.signAsync(canonical, SIGNING_SEED),
    ).toString("base64");

    expect(
      verifyThoughtSignature({ ...THOUGHT, signatureB64, publicKeyB64 }),
    ).toBe(true);
  });
});
