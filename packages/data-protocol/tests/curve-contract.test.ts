import { describe, expect, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";

import vectors from "../../../docs/specs/adds-0.1-vectors.json";
import packageJson from "../package.json";
import {
  verifyGrantSignature,
  verifyManifestSignature,
  type SignedGrant,
  type SignedManifest,
} from "../src/index.js";
import { strictEd25519Verify } from "../src/crypto.js";

describe("curve dependency contract", () => {
  test("the declared range cannot resolve a build without the Point API", () => {
    const range = packageJson.dependencies["@noble/ed25519"];
    expect(Bun.semver.satisfies("2.2.3", range)).toBe(false);
    expect(Bun.semver.satisfies("2.3.0", range)).toBe(true);
  });

  test("the installed build exposes the Point API the strict verifier calls", () => {
    expect(typeof ed25519.Point?.fromHex).toBe("function");
  });

  test("malformed points and encodings remain rejected signatures", () => {
    expect(strictEd25519Verify(
      new Uint8Array(64).fill(0xff),
      new Uint8Array(8),
      new Uint8Array(32).fill(0xff),
    )).toBe(false);
    expect(verifyManifestSignature(
      {} as unknown as SignedManifest,
    )).toBe(false);
    expect(verifyGrantSignature(
      { signature: null } as unknown as SignedGrant,
    )).toBe(false);

    const manifest = structuredClone(
      vectors.signature_vectors[0]!.signed_object,
    ) as unknown as SignedManifest;
    manifest.signature.value = "not-base64url";
    expect(verifyManifestSignature(manifest)).toBe(false);

    const grant = structuredClone(
      vectors.grant_wrap_vectors[0]!.signed_grant,
    ) as unknown as SignedGrant;
    grant.signature.value = "not-base64url";
    expect(verifyGrantSignature(grant)).toBe(false);

    expect(strictEd25519Verify(
      new Proxy(new Uint8Array(64), {}),
      new Uint8Array(),
      new Uint8Array(32),
    )).toBe(false);
    expect(strictEd25519Verify(
      new Uint8Array(64),
      new Proxy(new Uint8Array(), {}),
      new Uint8Array(32),
    )).toBe(false);
    expect(strictEd25519Verify(
      new Uint8Array(64),
      new Uint8Array(),
      new Proxy(new Uint8Array(32), {}),
    )).toBe(false);
  });

  test("malformed accessor-shaped inputs do not impersonate dependency faults", () => {
    for (const Fault of [Error, TypeError, ReferenceError]) {
      const rootManifest = structuredClone(
        vectors.signature_vectors[0]!.signed_object,
      ) as unknown as SignedManifest;
      Object.defineProperty(rootManifest, "signature", {
        enumerable: true,
        get: () => {
          throw new Fault("malformed manifest signature accessor");
        },
      });
      expect(verifyManifestSignature(rootManifest)).toBe(false);

      const nestedManifest = structuredClone(
        vectors.signature_vectors[0]!.signed_object,
      ) as unknown as SignedManifest;
      Object.defineProperty(nestedManifest.signature, "value", {
        enumerable: true,
        get: () => {
          throw new Fault("malformed manifest signature value accessor");
        },
      });
      expect(verifyManifestSignature(nestedManifest)).toBe(false);

      const rootGrant = structuredClone(
        vectors.grant_wrap_vectors[0]!.signed_grant,
      ) as unknown as SignedGrant;
      Object.defineProperty(rootGrant, "signature", {
        enumerable: true,
        get: () => {
          throw new Fault("malformed grant signature accessor");
        },
      });
      expect(verifyGrantSignature(rootGrant)).toBe(false);

      const nestedGrant = structuredClone(
        vectors.grant_wrap_vectors[0]!.signed_grant,
      ) as unknown as SignedGrant;
      Object.defineProperty(nestedGrant.signature, "value", {
        enumerable: true,
        get: () => {
          throw new Fault("malformed grant signature value accessor");
        },
      });
      expect(verifyGrantSignature(nestedGrant)).toBe(false);
    }
  });

  test("dependency API faults escape every signature-verifier layer", () => {
    const manifest = vectors.signature_vectors[0]!
      .signed_object as unknown as SignedManifest;
    const grant = vectors.grant_wrap_vectors[0]!
      .signed_grant as unknown as SignedGrant;
    const originalFromHex = ed25519.Point.fromHex;

    try {
      for (const Fault of [TypeError, ReferenceError]) {
        ed25519.Point.fromHex = () => {
          throw new Fault("simulated @noble/ed25519 API fault");
        };

        expect(() => strictEd25519Verify(
          new Uint8Array(64),
          new Uint8Array(),
          new Uint8Array(32),
        )).toThrow(Fault);
        expect(() => verifyManifestSignature(manifest)).toThrow(Fault);
        expect(() => verifyGrantSignature(grant)).toThrow(Fault);
      }
    } finally {
      ed25519.Point.fromHex = originalFromHex;
    }
  });
});
