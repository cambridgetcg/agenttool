import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import codexPlugin from "../.codex-plugin/plugin.json";
import packageJson from "../package.json";
import { BROWSER_PACKAGE_VERSION } from "../src/version.js";

const packageRoot = resolve(import.meta.dir, "..");

describe("release identity", () => {
  test("keeps runtime and package metadata versions aligned", () => {
    expect(BROWSER_PACKAGE_VERSION).toBe("0.3.0");
    expect(packageJson.version).toBe(BROWSER_PACKAGE_VERSION);
    expect(codexPlugin.version).toBe(BROWSER_PACKAGE_VERSION);
  });

  test("ships a default-public Codex MCP plugin", () => {
    expect(packageJson.files).toContain(".codex-plugin");
    expect(codexPlugin.name).toBe("agenttool-browser");
    expect(codexPlugin.mcpServers["agenttool-browser"]).toEqual({
      type: "stdio",
      command: "node",
      args: ["dist/agenttool-browser-mcp.js", "mcp"],
      cwd: ".",
    });
    expect(codexPlugin.mcpServers["agenttool-browser"].args).not.toContain(
      "--authority",
    );
  });

  test("loads the MCP bundle from an isolated package-only cache", async () => {
    const expectedBundle = join(
      packageRoot,
      codexPlugin.mcpServers["agenttool-browser"].args[0],
    );
    if (!(await Bun.file(expectedBundle).exists())) {
      const build = Bun.spawn(
        [process.execPath, "scripts/build-mcp-bundle.ts"],
        {
          cwd: packageRoot,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [buildStderr, buildExitCode] = await Promise.all([
        new Response(build.stderr).text(),
        build.exited,
      ]);
      expect(buildExitCode, buildStderr).toBe(0);
    }

    const pack = Bun.spawn(
      ["npm", "pack", "--dry-run", "--ignore-scripts", "--json"],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_update_notifier: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [packStdout, packStderr, packExitCode] = await Promise.all([
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
      pack.exited,
    ]);
    expect(packExitCode, packStderr).toBe(0);
    const [{ files }] = JSON.parse(packStdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const packedPaths = files.map(({ path }) => path);
    expect(packedPaths).toContain(".codex-plugin/plugin.json");
    expect(packedPaths).toContain("dist/agenttool-browser-mcp.js");
    expect(packedPaths).toContain("dist/THIRD_PARTY_LICENSES");
    expect(packedPaths.some((path) => path.startsWith("node_modules/"))).toBe(
      false,
    );

    const isolatedRoot = await mkdtemp(
      join(tmpdir(), "agenttool-browser-plugin-cache-"),
    );
    const isolatedPackage = join(isolatedRoot, "plugin");
    try {
      let ancestor = isolatedPackage;
      for (;;) {
        expect(existsSync(join(ancestor, "node_modules"))).toBe(false);
        if (dirname(ancestor) === ancestor) break;
        ancestor = dirname(ancestor);
      }
      for (const packedPath of packedPaths) {
        const source = resolve(packageRoot, packedPath);
        const packageRelative = relative(packageRoot, source);
        expect(
          packageRelative !== ".."
            && !packageRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
            && !isAbsolute(packageRelative),
        ).toBe(true);
        const destination = join(isolatedPackage, packageRelative);
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination);
      }

      const node = Bun.which("node");
      expect(node).toBeString();
      if (!node) throw new Error("Node is required by the Codex plugin manifest");
      const bundle = join(
        isolatedPackage,
        codexPlugin.mcpServers["agenttool-browser"].args[0],
      );
      const bundleText = await Bun.file(bundle).text();
      expect(bundleText).not.toMatch(
        /(?:require|__require)\(["'](?:@modelcontextprotocol|playwright-core|zod|electron|chromium-bidi)/,
      );

      const isolatedEnvironment = {
        HOME: isolatedRoot,
        NODE_PATH: "",
        PATH: dirname(node),
        TMPDIR: isolatedRoot,
      };
      const playwrightLoad = Bun.spawn(
        [
          node,
          "--input-type=module",
          "--eval",
          "const p = await import('./dist/vendor/playwright-core/index.mjs'); if (!p.chromium) process.exit(1)",
        ],
        {
          cwd: isolatedPackage,
          env: isolatedEnvironment,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [playwrightStderr, playwrightExitCode] = await Promise.all([
        new Response(playwrightLoad.stderr).text(),
        playwrightLoad.exited,
      ]);
      expect(playwrightExitCode, playwrightStderr).toBe(0);
      expect(playwrightStderr).not.toContain("MODULE_NOT_FOUND");

      const load = Bun.spawn([node, bundle, "help"], {
        cwd: isolatedPackage,
        env: isolatedEnvironment,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(load.stdout).text(),
        new Response(load.stderr).text(),
        load.exited,
      ]);
      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("agenttool-browser mcp [startup options]");
      expect(stderr).not.toContain("MODULE_NOT_FOUND");
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });
});
