import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import { BROWSER_PACKAGE_VERSION } from "../src/version.js";

describe("release identity", () => {
  test("keeps runtime and package metadata versions aligned", () => {
    expect(BROWSER_PACKAGE_VERSION).toBe("0.5.0");
    expect(packageJson.version).toBe(BROWSER_PACKAGE_VERSION);
    expect(packageJson.dependencies).toMatchObject({
      "@modelcontextprotocol/server": "2.0.0",
      "playwright-core": "1.59.1",
      zod: "4.4.3",
    });
    expect(packageJson.exports["./protocol"]).toEqual({
      types: "./dist/src/protocol.d.ts",
      import: "./dist/src/protocol.js",
    });
  });
});
