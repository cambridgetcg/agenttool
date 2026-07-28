import { describe, expect, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";

import { strictEd25519Verify } from "../src/index.js";
import manifest from "../package.json" with { type: "json" };

// @noble/ed25519 2.2.3 has no `Point` export; it arrived in 2.3.0 as an alias
// of `ExtendedPoint`. The old declared range therefore admitted installs that
// could neither seal nor verify any Wallet record.
describe("curve dependency contract", () => {
  test("the declared range cannot resolve a build without the Point API", () => {
    const range = manifest.dependencies["@noble/ed25519"];
    expect(Bun.semver.satisfies("2.2.3", range)).toBe(false);
    expect(Bun.semver.satisfies("2.3.0", range)).toBe(true);
  });

  test("the installed build exposes the Point API this package calls", () => {
    expect(typeof ed25519.Point?.fromHex).toBe("function");
  });

  test("a malformed point is a rejected signature, not a runtime fault", () => {
    expect(strictEd25519Verify(
      new Uint8Array(64).fill(0xff),
      new Uint8Array(8),
      new Uint8Array(32).fill(0xff),
    )).toBe(false);
  });
});
