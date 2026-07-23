import type { InspectionLimits } from "./types.js";

export const PACKAGE_NAME = "@agenttool/skills";
export const PACKAGE_VERSION = "0.2.1";
export const REPORT_SCHEMA_VERSION = "agenttool.skills/inspect-v0.1";
export const REPORT_SCHEMA_ID = "urn:agenttool:skills:inspection:v0.1";

export const HARD_LIMITS: Readonly<InspectionLimits> = Object.freeze({
  maxDepth: 12,
  maxEntries: 4_096,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxSkills: 128,
  maxFrontmatterBytes: 128 * 1024,
});

export const DEFAULT_LIMITS: Readonly<InspectionLimits> = Object.freeze({
  maxDepth: 8,
  maxEntries: 2_048,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxSkills: 64,
  maxFrontmatterBytes: 64 * 1024,
});

export const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".turbo",
  "coverage",
  "node_modules",
]);
