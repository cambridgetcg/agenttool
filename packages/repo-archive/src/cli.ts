#!/usr/bin/env node

import { resolve } from "node:path";

import { ArchiveError } from "./errors.js";
import { simulateThreeZoneArchive } from "./simulator.js";

function usage(): string {
  return [
    "Usage:",
    "  agent-repo-archive simulate --repo <path> [--root <new-path>]",
    "      [--repository-id <opaque-id>] [--allow-incomplete]",
    "      [--max-bytes <positive-integer>]",
    "",
    "The simulator creates three directories on one device. It proves independent",
    "archive imports and restore paths; it makes no physical durability claim.",
  ].join("\n");
}

interface ParsedArguments {
  command: "simulate";
  repositoryPath: string;
  simulationRoot?: string;
  repositoryId?: string;
  allowIncomplete: boolean;
  maxBytes?: number;
}

function parseArguments(argv: readonly string[]): ParsedArguments | "help" {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv[0] !== "simulate") {
    throw new Error("Only the local simulate command exists in v0.1.");
  }
  let repositoryPath: string | undefined;
  let simulationRoot: string | undefined;
  let repositoryId: string | undefined;
  let allowIncomplete = false;
  let maxBytes: number | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--allow-incomplete") {
      allowIncomplete = true;
      continue;
    }
    if (
      argument === "--repo"
      || argument === "--root"
      || argument === "--repository-id"
      || argument === "--max-bytes"
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires one value.`);
      }
      index += 1;
      if (argument === "--repo") repositoryPath = resolve(value);
      if (argument === "--root") simulationRoot = resolve(value);
      if (argument === "--repository-id") repositoryId = value;
      if (argument === "--max-bytes") {
        maxBytes = Number(value);
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
          throw new Error("--max-bytes must be a positive safe integer.");
        }
      }
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  if (repositoryPath === undefined) throw new Error("--repo is required.");
  return {
    command: "simulate",
    repositoryPath,
    ...(simulationRoot === undefined ? {} : { simulationRoot }),
    ...(repositoryId === undefined ? {} : { repositoryId }),
    allowIncomplete,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  };
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await simulateThreeZoneArchive(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const code = error instanceof ArchiveError ? error.code : "simulation_failed";
  const message = error instanceof Error ? error.message : "Unknown simulator failure.";
  process.stderr.write(`${JSON.stringify({ error: code, message })}\n`);
  process.exitCode = 1;
});
