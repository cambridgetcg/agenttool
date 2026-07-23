#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildEnrollmentBundle,
  buildMcpBundle,
} from "./build-mcp-bundle.js";

const packageRoot = resolve(import.meta.dir, "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "agenttool-collab-bundle-"));

try {
  const bundles = [
    {
      name: "agenttool-collab-mcp.js",
      build: buildMcpBundle,
    },
    {
      name: "agenttool-collab-enroll.js",
      build: buildEnrollmentBundle,
    },
  ] as const;
  for (const bundle of bundles) {
    const checkedInPath = join(packageRoot, "dist", bundle.name);
    const candidatePath = join(temporaryDirectory, bundle.name);
    await bundle.build(candidatePath);
    const checkedInFile = Bun.file(checkedInPath);
    if (!(await checkedInFile.exists())) {
      throw new Error(
        `tracked ${bundle.name} is missing; run \`bun run build:mcp\``,
      );
    }
    const checkedIn = new Uint8Array(await checkedInFile.arrayBuffer());
    const candidate = new Uint8Array(await Bun.file(candidatePath).arrayBuffer());
    const matches =
      checkedIn.byteLength === candidate.byteLength
      && checkedIn.every((byte, index) => byte === candidate[index]);
    if (!matches) {
      throw new Error(
        `tracked ${bundle.name} is stale; run \`bun run build:mcp\` and commit the result`,
      );
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
