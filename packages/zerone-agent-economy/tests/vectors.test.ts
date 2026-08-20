import { describe, expect, test } from "bun:test";

import { buildVector } from "../scripts/vectors.js";

describe("deterministic vectors", () => {
  test("match checked-in identity, receipt, nullifier, and protobuf bytes", async () => {
    const expected = await Bun.file(new URL(
      "../vectors/zerone-agent-economy-v0.1-vectors.json",
      import.meta.url,
    )).json();
    expect(buildVector()).toEqual(expected);
  });
});
