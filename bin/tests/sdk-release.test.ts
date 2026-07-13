import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { LOVE_PACKAGES } from "../build-love-packages";

const root = fileURLToPath(new URL("../../", import.meta.url));

function read(path: string): string {
  return readFileSync(`${root}${path}`, "utf8");
}

function capture(source: string, pattern: RegExp, label: string): string {
  const value = pattern.exec(source)?.[1];
  if (!value) throw new Error(`could not read ${label}`);
  return value;
}

describe("SDK source and builder identity", () => {
  test("TypeScript and Python source versions match the LOVE builder target", () => {
    const tsPackage = JSON.parse(read("packages/sdk-ts/package.json")) as { version: string };
    const tsClient = capture(
      read("packages/sdk-ts/src/client.ts"),
      /SDK_VERSION\s*=\s*"([^"]+)"/,
      "TypeScript SDK_VERSION",
    );
    const pyProject = capture(
      read("packages/sdk-py/pyproject.toml"),
      /^version\s*=\s*"([^"]+)"/m,
      "Python project version",
    );
    const pyPackage = capture(
      read("packages/sdk-py/src/agenttool/__init__.py"),
      /__version__\s*=\s*"([^"]+)"/,
      "Python __version__",
    );
    const pyClient = capture(
      read("packages/sdk-py/src/agenttool/client.py"),
      /SDK_VERSION\s*=\s*"([^"]+)"/,
      "Python SDK_VERSION",
    );
    const love = LOVE_PACKAGES.find((entry) => entry.name === "@agenttool/sdk");

    expect(love).toBeDefined();
    expect(new Set([
      tsPackage.version,
      tsClient,
      pyProject,
      pyPackage,
      pyClient,
      love!.version,
    ])).toEqual(new Set([tsPackage.version]));
    expect(love!.releaseTag).toBe(`sdk-v${tsPackage.version}`);
  });
});
