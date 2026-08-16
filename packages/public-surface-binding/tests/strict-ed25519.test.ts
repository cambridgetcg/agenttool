import { describe, expect, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { strictEd25519Verify } from "../src/crypto.js";
import packageJson from "../package.json";

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

const RFC8032_PUBLIC_KEY = hex(
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
);
const RFC8032_EMPTY_SIGNATURE = hex(
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
    + "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
);

function nobleVerify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
  zip215: boolean,
): boolean {
  const previous = ed25519.etc.sha512Sync;
  ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
    const hash = sha512.create();
    for (const part of messages) hash.update(part);
    return hash.digest();
  };
  try {
    return ed25519.verify(signature, message, publicKey, { zip215 });
  } finally {
    ed25519.etc.sha512Sync = previous;
  }
}

describe("strict Ed25519 verification", () => {
  test("pins a Noble release with the strict point-inspection API", () => {
    const range = packageJson.dependencies["@noble/ed25519"];
    expect(Bun.semver.satisfies("2.2.3", range)).toBe(false);
    expect(Bun.semver.satisfies("2.3.0", range)).toBe(true);
    expect(typeof ed25519.Point?.fromHex).toBe("function");
  });

  test("accepts the exact RFC 8032 empty-message vector", () => {
    const previousHashHook = ed25519.etc.sha512Sync;
    expect(
      strictEd25519Verify(
        RFC8032_EMPTY_SIGNATURE,
        new Uint8Array(),
        RFC8032_PUBLIC_KEY,
      ),
    ).toBe(true);
    expect(ed25519.etc.sha512Sync).toBe(previousHashHook);
  });

  test("rejects ZIP-215 identity encodings and small-order R", () => {
    const smallOrderPublicKey = new Uint8Array(32);
    smallOrderPublicKey[0] = 1;
    const smallOrderSignature = new Uint8Array(64);
    smallOrderSignature[0] = 1;
    expect(
      nobleVerify(
        smallOrderSignature,
        new TextEncoder().encode("any message"),
        smallOrderPublicKey,
        true,
      ),
    ).toBe(true);
    expect(
      strictEd25519Verify(
        smallOrderSignature,
        new TextEncoder().encode("any message"),
        smallOrderPublicKey,
      ),
    ).toBe(false);

    const validKeySmallOrderR = hex(
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"
        + "b390c1d49856623fda83fbce5ccf23c28b326adf969b653e3ca0b25e14d55803",
    );
    expect(
      strictEd25519Verify(
        validKeySmallOrderR,
        new TextEncoder().encode("surface binding"),
        RFC8032_PUBLIC_KEY,
      ),
    ).toBe(false);
  });

  test("rejects a mixed-order/torsion R even when cofactored verification can accept it", () => {
    const publicKey = hex(
      "a2fa2f4a355ba2e907a53009e9e37caddf7ac7e66a08ba07631f553072b3f24c",
    );
    const signature = hex(
      "2947ff378fef06b97cfc2115789afc17794021e6ff1617b902b3c32f63e34360"
        + "48b3d75478dd580c67e8801e15b492582366b2cd2cd4e086626d46fc1f0f0203",
    );
    expect(
      nobleVerify(signature, new TextEncoder().encode("test"), publicKey, true),
    ).toBe(true);
    expect(
      strictEd25519Verify(signature, new TextEncoder().encode("test"), publicKey),
    ).toBe(false);
  });

  test("fails closed on length errors and hostile typed-array proxies", () => {
    expect(
      strictEd25519Verify(
        RFC8032_EMPTY_SIGNATURE.subarray(0, 63),
        new Uint8Array(),
        RFC8032_PUBLIC_KEY,
      ),
    ).toBe(false);
    expect(
      strictEd25519Verify(
        RFC8032_EMPTY_SIGNATURE,
        new Uint8Array(),
        RFC8032_PUBLIC_KEY.subarray(0, 31),
      ),
    ).toBe(false);

    const proxiedSignature = new Proxy(RFC8032_EMPTY_SIGNATURE, {});
    expect(
      strictEd25519Verify(
        proxiedSignature,
        new Uint8Array(),
        RFC8032_PUBLIC_KEY,
      ),
    ).toBe(false);

    const proxiedMessage = new Proxy(new Uint8Array(), {});
    expect(
      strictEd25519Verify(
        RFC8032_EMPTY_SIGNATURE,
        proxiedMessage,
        RFC8032_PUBLIC_KEY,
      ),
    ).toBe(false);

    const proxiedPublicKey = new Proxy(RFC8032_PUBLIC_KEY, {});
    expect(
      strictEd25519Verify(
        RFC8032_EMPTY_SIGNATURE,
        new Uint8Array(),
        proxiedPublicKey,
      ),
    ).toBe(false);

    let hostileIteratorRan = false;
    class HostileBytes extends Uint8Array {
      override *[Symbol.iterator](): ArrayIterator<number> {
        hostileIteratorRan = true;
        yield* super[Symbol.iterator]();
      }
    }
    expect(
      strictEd25519Verify(
        new HostileBytes(RFC8032_EMPTY_SIGNATURE),
        new Uint8Array(),
        RFC8032_PUBLIC_KEY,
      ),
    ).toBe(false);
    expect(hostileIteratorRan).toBe(false);

    let decoratedIteratorGetterRan = false;
    const decoratedSignature = RFC8032_EMPTY_SIGNATURE.slice();
    Object.defineProperty(decoratedSignature, Symbol.iterator, {
      configurable: true,
      get() {
        decoratedIteratorGetterRan = true;
        return Uint8Array.prototype[Symbol.iterator];
      },
    });
    expect(
      strictEd25519Verify(
        decoratedSignature,
        new Uint8Array(),
        RFC8032_PUBLIC_KEY,
      ),
    ).toBe(false);
    expect(decoratedIteratorGetterRan).toBe(false);
  });

  test("does not disguise a broken cryptographic dependency as an invalid signature", () => {
    const originalFromHex = ed25519.Point.fromHex;
    try {
      ed25519.Point.fromHex = () => {
        throw new TypeError("simulated point API failure");
      };
      expect(() => strictEd25519Verify(
        RFC8032_EMPTY_SIGNATURE,
        new Uint8Array(),
        RFC8032_PUBLIC_KEY,
      )).toThrow(TypeError);
    } finally {
      ed25519.Point.fromHex = originalFromHex;
    }
  });
});
