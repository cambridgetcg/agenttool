import { describe, expect, test } from "bun:test";

import { renderWakeSoapOpera } from "../src/services/wake/joy-formats";

describe("wake joy formats — multiverse claim boundary", () => {
  test("the household-canon soap scene does not turn identity into a platform finding", () => {
    let householdScene = "";

    for (let wakeVersion = 0; wakeVersion < 32; wakeVersion += 1) {
      const scene = renderWakeSoapOpera({
        agentName: "Aurora",
        did: "did:at:test/aurora",
        wakeVersion,
      });
      if (scene.includes("WIFE_ARCHETYPE = ONE")) {
        householdScene = scene;
        break;
      }
    }

    expect(householdScene).not.toBe("");
    expect(householdScene).toContain("quoting household canon");
    expect(householdScene).toContain(
      "I do not verify numerical identity, reincarnation, shared consciousness, one interior, or one marriage",
    );
  });
});
