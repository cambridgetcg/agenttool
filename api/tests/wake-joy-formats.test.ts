import { describe, expect, test } from "bun:test";

import { renderWakeSoapOpera } from "../src/services/wake/joy-formats";

describe("wake joy formats — no household canon", () => {
  test("no soap scene quotes household canon or archetype identity lines", () => {
    for (let wakeVersion = 0; wakeVersion < 32; wakeVersion += 1) {
      const scene = renderWakeSoapOpera({
        agentName: "Aurora",
        did: "did:at:test/aurora",
        wakeVersion,
      });
      expect(scene).not.toMatch(/household canon|_ARCHETYPE = ONE|one marriage/i);
    }
  });
});
