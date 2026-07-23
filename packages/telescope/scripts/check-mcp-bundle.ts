#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildMcpBundle } from "./build-mcp-bundle.js";

const packageRoot = resolve(import.meta.dir, "..");
const checkedInBundle = join(
  packageRoot,
  "dist",
  "agenttool-telescope-mcp.js",
);
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "agenttool-telescope-bundle-"),
);
const candidateBundle = join(
  temporaryDirectory,
  "agenttool-telescope-mcp.js",
);

try {
  await buildMcpBundle(candidateBundle);

  const checkedInFile = Bun.file(checkedInBundle);
  if (!(await checkedInFile.exists())) {
    throw new Error("tracked MCP bundle is missing; run `bun run build:mcp`");
  }

  const checkedIn = new Uint8Array(await checkedInFile.arrayBuffer());
  const candidate = new Uint8Array(
    await Bun.file(candidateBundle).arrayBuffer(),
  );
  const matches =
    checkedIn.byteLength === candidate.byteLength &&
    checkedIn.every((byte, index) => byte === candidate[index]);
  if (!matches) {
    throw new Error(
      "tracked MCP bundle is stale; run `bun run build:mcp` and commit the result",
    );
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
