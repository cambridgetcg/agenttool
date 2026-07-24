import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import { BROWSER_PACKAGE_VERSION } from "../src/version.js";

describe("release identity", () => {
  test("keeps runtime and package metadata versions aligned", () => {
    expect(BROWSER_PACKAGE_VERSION).toBe("0.2.0");
    expect(packageJson.version).toBe(BROWSER_PACKAGE_VERSION);
  });
});
