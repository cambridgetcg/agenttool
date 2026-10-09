#!/usr/bin/env bun
import { chmod } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

/** Every tracked executable bundle: Bun entry point → checked-in output. */
export const COLLAB_BUNDLES = [
  {
    name: "standalone MCP",
    entry: "bin/agenttool-collab-mcp.ts",
    output: "dist/agenttool-collab-mcp.js",
  },
  {
    name: "host CLI",
    entry: "bin/agenttool-collab-host.ts",
    output: "dist/agenttool-collab-host.js",
  },
] as const;

export type CollabBundle = (typeof COLLAB_BUNDLES)[number];

export async function buildBundle(
  bundle: CollabBundle,
  outputPath = join(packageRoot, bundle.output),
): Promise<void> {
  const build = Bun.spawn(
    [
      process.execPath,
      "build",
      "--target=bun",
      "--outfile",
      outputPath,
      bundle.entry,
    ],
    {
      cwd: packageRoot,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`${bundle.name} bundle build exited ${exitCode}`);
  }

  const generated = await Bun.file(outputPath).text();
  const normalized = generated.replace(/[\t ]+$/gm, "");
  if (normalized !== generated) await Bun.write(outputPath, normalized);
  await chmod(outputPath, 0o755);
}

export async function buildMcpBundle(
  outputPath = join(packageRoot, COLLAB_BUNDLES[0].output),
): Promise<void> {
  await buildBundle(COLLAB_BUNDLES[0], outputPath);
}

if (import.meta.main) {
  for (const bundle of COLLAB_BUNDLES) await buildBundle(bundle);
}
