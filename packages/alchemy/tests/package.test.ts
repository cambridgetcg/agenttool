import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as publicApi from "../src/index.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/index.js";

const packageRoot = join(import.meta.dir, "..");

describe("public and packed boundary", () => {
  test("has no generic request, signer, broadcaster, URL, or credential export", () => {
    const names = Object.keys(publicApi);
    expect(names).not.toContain("rawRpc");
    expect(names).not.toContain("request");
    expect(names).not.toContain("fetch");
    expect(names).not.toContain("sign");
    expect(names).not.toContain("sendTransaction");
    expect(names).not.toContain("createWebhook");
    expect(names).not.toContain("apiKey");
    expect(names).not.toContain("url");
    expect(names).not.toContain("endpoint");
  });

  test("is zero-runtime-dependency metadata with a CI prepack gate", async () => {
    const pkg = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      private?: boolean;
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
      files?: string[];
      dependencies?: Record<string, string>;
      publishConfig?: { access?: string };
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(pkg.private).toBeUndefined();
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.types).toBe("dist/index.d.ts");
    expect(Object.keys(pkg.exports ?? {})).toEqual([
      ".",
      "./kingdom.extension.json",
    ]);
    expect(pkg.files).toEqual([
      "dist",
      "schemas",
      "fixtures",
      "kingdom.extension.json",
      "README.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
    ]);
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.scripts?.prepack).toBe("bun run ci");
  });

  test("npm dry-run excludes source, tests, locks, and local state", () => {
    const result = Bun.spawnSync({
      cmd: ["npm", "pack", "--ignore-scripts", "--dry-run", "--json"],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as Array<{
      files: Array<{ path: string }>;
    }>;
    const paths = report[0]?.files.map((file) => file.path) ?? [];

    expect(paths).toContain("package.json");
    expect(paths).toContain("README.md");
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("LICENSE");
    expect(paths).toContain("NOTICE");
    expect(paths).toContain("kingdom.extension.json");
    expect(paths).toContain(
      "schemas/agenttool.evm-observation-evidence-0.1.schema.json",
    );
    expect(paths).toContain(
      "schemas/agenttool.evm-evidence-transition-receipt-0.1.schema.json",
    );
    expect(paths).toContain(
      "fixtures/agenttool.evm-observation-evidence-0.1.json",
    );
    expect(paths).toContain(
      "fixtures/agenttool.evm-evidence-transition-receipt-0.1.json",
    );
    expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("tests/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("scripts/"))).toBe(false);
    expect(paths.some((path) => path.includes("bun.lock"))).toBe(false);
    expect(paths.some((path) => path.includes(".env"))).toBe(false);
  });

  test("keeps the KINGDOM hint pure, unregistered, and zero-authority", async () => {
    const extension = JSON.parse(
      await readFile(join(packageRoot, "kingdom.extension.json"), "utf8"),
    ) as {
      schema: string;
      id: string;
      package: string;
      version: string;
      status: string;
      host_contract: string;
      proposed_abilities: Array<{ id: string }>;
      defaults: Record<string, boolean>;
      notes: string[];
    };

    expect(extension).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "alchemy-evidence",
      package: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      status: "unpublished_source_candidate",
      host_contract: "not_registered",
    });
    expect(extension.proposed_abilities.map(({ id }) => id)).toEqual([
      "evm-evidence-normalize",
      "evm-evidence-transition-receipt",
      "evm-evidence-measurement-project",
    ]);
    expect(Object.values(extension.defaults).every((value) => value === false)).toBe(true);
    expect(extension.notes.join(" ")).toMatch(
      /declaration-only.*not an installed or registered host contract/i,
    );
    expect(extension.notes.join(" ")).toMatch(
      /does not register or grant access.*injected-transport Alchemy read client/i,
    );
  });

  test("separates the dev.1 source candidate from immutable dev.0 receipts", async () => {
    const readme = await readFile(join(packageRoot, "README.md"), "utf8");
    expect(readme).toContain(
      "The current source candidate is `@agenttool/alchemy@0.1.0-dev.1`.",
    );
    expect(readme).toContain(
      "The immutable `0.1.0-dev.0` preview remains historical release evidence",
    );
    expect(readme).toContain(
      "No `0.1.0-dev.1` tag, GitHub Release, npm version, or LOVE inventory is\nestablished",
    );
    expect(readme).not.toContain("The public npm package is absent");
  });
});
