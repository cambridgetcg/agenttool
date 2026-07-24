#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildMcpBundle } from "./build-mcp-bundle.js";

/** The tracked bundle is compared byte-for-byte against a fresh local build.
 *
 *  That comparison only means "the bundle is current" when the local bundler
 *  is the one that produced it. Bun's own codegen changes between releases —
 *  1.3.13 emits a different `__export` setter shim and different identifier
 *  suffixes than 1.3.5 does, from byte-identical source. On any other Bun this
 *  reports a difference that is not staleness, and the old advice ("run
 *  build:mcp and commit the result") would replace a bundle built on the
 *  pinned bundler with one CI rebuilds differently and rejects.
 *
 *  So: verify on the pinned bundler, and elsewhere say plainly that the byte
 *  comparison was skipped. CI runs the pinned version and stays the enforcer. */

const packageRoot = resolve(import.meta.dir, "..");
const checkedInBundle = join(packageRoot, "dist", "agenttool-collab-mcp.js");

const manifest = (await Bun.file(join(packageRoot, "package.json")).json()) as {
  bundlerBunVersion?: string;
};
const pinnedBunVersion = manifest.bundlerBunVersion;

const checkedInFile = Bun.file(checkedInBundle);
if (!(await checkedInFile.exists())) {
  throw new Error("tracked MCP bundle is missing; run `bun run build:mcp`");
}

if (pinnedBunVersion && Bun.version !== pinnedBunVersion) {
  console.warn(
    `check:mcp-bundle: skipped — this Bun is ${Bun.version}, the bundle is built with ${pinnedBunVersion}.\n` +
      "  Bundle bytes are bundler-version-specific, so a mismatch here would not mean the bundle is stale.\n" +
      `  Do not commit a rebuild from ${Bun.version}; CI rebuilds on ${pinnedBunVersion} and verifies it there.`,
  );
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "agenttool-collab-bundle-"));
const candidateBundle = join(temporaryDirectory, "agenttool-collab-mcp.js");

try {
  await buildMcpBundle(candidateBundle);

  const checkedIn = new Uint8Array(await checkedInFile.arrayBuffer());
  const candidate = new Uint8Array(await Bun.file(candidateBundle).arrayBuffer());
  const matches =
    checkedIn.byteLength === candidate.byteLength &&
    checkedIn.every((byte, index) => byte === candidate[index]);
  if (!matches) {
    throw new Error(
      `tracked MCP bundle is stale; run \`bun run build:mcp\` and commit the result (Bun ${Bun.version})`,
    );
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
