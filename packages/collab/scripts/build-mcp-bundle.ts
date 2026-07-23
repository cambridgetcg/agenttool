#!/usr/bin/env bun
import { chmod } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const checkedInBundle = join(packageRoot, "dist", "agenttool-collab-mcp.js");
const checkedInEnrollmentBundle = join(
  packageRoot,
  "dist",
  "agenttool-collab-enroll.js",
);

export async function buildMcpBundle(outputPath = checkedInBundle): Promise<void> {
  await buildBundle("bin/agenttool-collab-mcp.ts", outputPath);
}

export async function buildEnrollmentBundle(
  outputPath = checkedInEnrollmentBundle,
): Promise<void> {
  await buildBundle("bin/agenttool-collab-enroll.ts", outputPath);
}

async function buildBundle(entryPoint: string, outputPath: string): Promise<void> {
  const build = Bun.spawn(
    [
      process.execPath,
      "build",
      "--target=bun",
      "--outfile",
      outputPath,
      entryPoint,
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

if (import.meta.main) {
  await buildMcpBundle();
  await buildEnrollmentBundle();
}
