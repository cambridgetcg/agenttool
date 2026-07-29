import { describe, expect, test } from "bun:test";
import { copyAndWipeSecretChunk } from "../src/secret-buffers.js";

describe("secret-bearing stream buffers", () => {
  test("copies an incoming stream chunk and immediately wipes the original", () => {
    const original = Buffer.from("obvious-test-sentinel");
    const copy = copyAndWipeSecretChunk(original);

    expect(original.every((byte) => byte === 0)).toBe(true);
    expect(copy.toString("utf8")).toBe("obvious-test-sentinel");
    copy.fill(0);
  });
});
