#!/usr/bin/env bun
import { chmod } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const checkedInBundle = join(packageRoot, "dist", "agenttool-collab-mcp.js");

export async function buildMcpBundle(outputPath = checkedInBundle): Promise<void> {
  const build = Bun.spawn(
    [
      process.execPath,
      "build",
      "--target=bun",
      "--outfile",
      outputPath,
      "bin/agenttool-collab-mcp.ts",
    ],
    {
      cwd: packageRoot,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`standalone MCP bundle build exited ${exitCode}`);
  }

  const generated = await Bun.file(outputPath).text();
  const normalized = generated.replace(/[\t ]+$/gm, "");
  if (normalized !== generated) await Bun.write(outputPath, normalized);
  await chmod(outputPath, 0o755);
}

if (import.meta.main) await buildMcpBundle();
