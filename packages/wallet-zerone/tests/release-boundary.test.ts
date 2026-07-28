import { describe, expect, test } from "bun:test";

import * as exported from "../src/index.js";

const packageRoot = new URL("../", import.meta.url);

async function text(path: string): Promise<string> {
  return Bun.file(new URL(path, packageRoot)).text();
}

describe("package and public boundary", () => {
  test("keeps release metadata, peer, and shipped provenance aligned", async () => {
    const manifest = await Bun.file(
      new URL("package.json", packageRoot),
    ).json() as {
      readonly name: string;
      readonly version: string;
      readonly peerDependencies: Record<string, string>;
      readonly devDependencies: Record<string, string>;
      readonly dependencies: Record<string, string>;
      readonly files: readonly string[];
      readonly overrides?: unknown;
    };
    expect(manifest.name).toBe(exported.PACKAGE_NAME);
    expect(manifest.version).toBe(exported.PACKAGE_VERSION);
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.peerDependencies["@agenttool/wallet"]).toBe("^0.1.1");
    expect(manifest.devDependencies["@agenttool/wallet"]).toBe(
      "file:../wallet",
    );
    expect(manifest.overrides).toBeUndefined();
    expect(manifest.dependencies).toEqual({
      "@noble/curves": "2.2.0",
      "@noble/hashes": "2.2.0",
      "@scure/base": "2.2.0",
    });
    expect(manifest.files).toContain("vectors");
    expect(manifest.files).toContain("scripts/go-cosmos-fixture");
    expect(manifest.files).toContain(
      "scripts/regenerate-go-cosmos-vector.sh",
    );
  });

  test("ships every documented package artifact and normative source link", async () => {
    for (const path of [
      "README.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
      "vectors/agent-wallet-zerone-v0.1-vectors.json",
      "scripts/go-cosmos-fixture/main.go",
      "scripts/regenerate-go-cosmos-vector.sh",
    ]) {
      expect(await Bun.file(new URL(path, packageRoot)).exists(), path).toBe(
        true,
      );
    }
    expect(await Bun.file(new URL(
      "../../../docs/specs/AGENT-WALLET-ZERONE-0.1.md",
      import.meta.url,
    )).exists()).toBe(true);
    const readme = await text("README.md");
    expect(readme).toContain("AGENT-WALLET-ZERONE-0.1.md");
    expect(readme).toContain(exported.ZERONE_CORE_COMMIT);
  });

  test("exports no secret egress or combined sign-and-send convenience", () => {
    const forbidden = /mnemonic|private.?key|secret|seed|signAndSend/iu;
    expect(Object.keys(exported).filter((name) => forbidden.test(name))).toEqual(
      [],
    );
  });

  test("does not reach into custody, marketplace, ambient RPC, or credentials", async () => {
    const sourceFiles = [
      "src/client.ts",
      "src/constants.ts",
      "src/index.ts",
      "src/invocation.ts",
      "src/messages.ts",
      "src/profiles.ts",
      "src/transactions.ts",
      "src/types.ts",
      "src/validation.ts",
      "src/wire.ts",
    ];
    const source = (
      await Promise.all(sourceFiles.map((path) => text(path)))
    ).join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bprocess\.env\b/u);
    expect(source).not.toMatch(/from\s+["'][^"']*(custody|marketplace|api\/)/u);
    expect(source).not.toMatch(/\bsignAndSend\b/u);
  });
});
