import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  DEFAULT_LIMITS,
  HARD_LIMITS,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  REPORT_SCHEMA_ID,
  REPORT_SCHEMA_VERSION,
} from "./constants.js";
import {
  inventoryTree,
  isWithin,
  readBoundedFile,
  relativePortable,
  type InternalFile,
} from "./inventory.js";
import { inspectPackageManifest, inspectPluginManifest } from "./manifests.js";
import {
  detectBodyPathTraversal,
  detectMetadataPathTraversal,
  parseSkillDocument,
} from "./metadata.js";
import { emptyRequirements, requirementsFromMetadata } from "./requirements.js";
import { redactInspectionReport } from "./report-redaction.js";
import { compareStrings } from "./stable-json.js";
import type {
  FileCategory,
  InspectionIssue,
  InspectionLimits,
  InspectionOptions,
  InspectionReport,
  JsonObject,
  SkillInspection,
} from "./types.js";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function effectiveLimits(overrides: Partial<InspectionLimits> | undefined): InspectionLimits {
  const output = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(output) as Array<keyof InspectionLimits>) {
    const requested = overrides?.[key];
    if (requested === undefined || !Number.isFinite(requested) || requested < 1) continue;
    output[key] = Math.min(Math.floor(requested), HARD_LIMITS[key]);
  }
  return output;
}

function emptyReport(limits: InspectionLimits): InspectionReport {
  return {
    $schema: REPORT_SCHEMA_ID,
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: "agenttool.skills.inspection",
    generatedBy: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    mode: "read-only",
    valid: false,
    scope: { root: ".", inputKind: "invalid", limits },
    executionPolicy: {
      network: false,
      subprocesses: false,
      scriptExecution: false,
      mcpStartup: false,
      configMutation: false,
      credentialLookup: false,
      hostedApiCalls: false,
    },
    filesystemPolicy: {
      observedSymlinks: "reject",
      finalFileSymlinkFollowing: false,
      concurrentAncestorReplacement: "not-guaranteed",
      immutableSnapshotRecommended: true,
    },
    package: null,
    manifests: [],
    skills: [],
    summary: { skills: 0, files: 0, scripts: 0, resources: 0, errors: 0, warnings: 0, redactions: 0 },
    issues: [],
  };
}

function addInputFailure(report: InspectionReport, code: string, message: string): InspectionReport {
  report.issues.push({ severity: "error", code, path: ".", message });
  return finalize(report);
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateKnownMetadata(
  metadata: JsonObject,
  skillRoot: string,
  skillFilePath: string,
): { name: string | null; issues: InspectionIssue[] } {
  const issues: InspectionIssue[] = [];
  let name: string | null = null;
  if (typeof metadata.name !== "string" || metadata.name.length > 64 || !SKILL_NAME.test(metadata.name)) {
    issues.push({
      severity: "error",
      code: "SKILL_NAME_INVALID",
      path: skillFilePath,
      message: "Skill name must be 1-64 lowercase alphanumeric or single-hyphen characters.",
    });
  } else {
    name = metadata.name;
    if (basename(skillRoot) !== name) {
      issues.push({
        severity: "error",
        code: "SKILL_DIRECTORY_MISMATCH",
        path: skillFilePath,
        message: "Skill name must match its containing directory name.",
      });
    }
  }
  if (typeof metadata.description !== "string" || metadata.description.trim() === "" || metadata.description.length > 1_024) {
    issues.push({
      severity: "error",
      code: "SKILL_DESCRIPTION_INVALID",
      path: skillFilePath,
      message: "Skill description must be a non-empty string no longer than 1024 characters.",
    });
  }
  if (metadata.compatibility !== undefined &&
    (typeof metadata.compatibility !== "string" || metadata.compatibility.length > 500)) {
    issues.push({
      severity: "error",
      code: "SKILL_COMPATIBILITY_INVALID",
      path: skillFilePath,
      message: "Skill compatibility must be a string no longer than 500 characters.",
    });
  }
  if (metadata.license !== undefined && typeof metadata.license !== "string") {
    issues.push({
      severity: "error",
      code: "SKILL_LICENSE_INVALID",
      path: skillFilePath,
      message: "Skill license metadata must be a string.",
    });
  }
  if (metadata["allowed-tools"] !== undefined && typeof metadata["allowed-tools"] !== "string") {
    issues.push({
      severity: "error",
      code: "ALLOWED_TOOLS_INVALID",
      path: skillFilePath,
      message: "allowed-tools must be a string when declared.",
    });
  }
  if (metadata.metadata !== undefined && !isRecord(metadata.metadata)) {
    issues.push({
      severity: "error",
      code: "SKILL_METADATA_INVALID",
      path: skillFilePath,
      message: "The optional metadata field must be a mapping.",
    });
  }
  return { name, issues };
}

function categoryFor(path: string): FileCategory {
  if (path === "SKILL.md") return "skill";
  if (path.startsWith("scripts/")) return "script";
  if (path.startsWith("references/")) return "reference";
  if (path.startsWith("assets/")) return "asset";
  return "resource";
}

async function contentDigest(
  files: InternalFile[],
  skillRoot: string,
  skillFilePath: string,
  issues: InspectionIssue[],
  readFile: (file: InternalFile) => Promise<Buffer | null>,
): Promise<string | null> {
  const hash = createHash("sha256");
  hash.update("agenttool.skills.content.v1\0");
  for (const file of files) {
    const bytes = await readFile(file);
    if (bytes === null) {
      issues.push({
        severity: "error",
        code: "FILE_CHANGED_OR_UNREADABLE",
        path: file.path,
        message: "A file changed during inspection or could not be opened without following symlinks.",
      });
      return null;
    }
    const path = relativePortable(skillRoot, file.absolutePath);
    hash.update(`F\0${Buffer.byteLength(path)}\0${path}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  if (files.length === 0) {
    issues.push({
      severity: "error",
      code: "SKILL_CONTENT_EMPTY",
      path: skillFilePath,
      message: "No readable regular files were found for this skill.",
    });
    return null;
  }
  return `sha256:${hash.digest("hex")}`;
}

async function inspectSkill(
  root: string,
  skillFile: InternalFile,
  allFiles: InternalFile[],
  symlinkPaths: string[],
  incompletePaths: string[],
  rootTruncated: boolean,
  limits: InspectionLimits,
  issues: InspectionIssue[],
  readFile: (file: InternalFile) => Promise<Buffer | null>,
): Promise<SkillInspection> {
  const skillRoot = dirname(skillFile.absolutePath);
  const path = relativePortable(root, skillRoot);
  const skillFilePath = relativePortable(root, skillFile.absolutePath);
  const files = allFiles.filter((file) => isWithin(skillRoot, file.absolutePath));
  const scopedSymlinks = symlinkPaths.filter((candidate) => {
    const prefix = path === "." ? "" : `${path}/`;
    return candidate === path || candidate.startsWith(prefix);
  });
  const scopedIncomplete = incompletePaths.filter((candidate) => {
    const prefix = path === "." ? "" : `${path}/`;
    return candidate === path || candidate.startsWith(prefix);
  });
  for (const incompletePath of scopedIncomplete) {
    issues.push({
      severity: "error",
      code: "SKILL_SUBTREE_NOT_INSPECTED",
      path: incompletePath,
      message: "Part of this skill was excluded or unreadable, so its content coverage is incomplete.",
    });
  }
  const bytes = await readFile(skillFile);
  let name: string | null = null;
  let metadataShape: SkillInspection["metadataShape"] = {};
  let requirements = emptyRequirements();

  if (bytes === null) {
    issues.push({
      severity: "error",
      code: "SKILL_FILE_CHANGED_OR_UNREADABLE",
      path: skillFilePath,
      message: "SKILL.md changed during inspection or could not be opened without following symlinks.",
    });
  } else {
    const document = parseSkillDocument(bytes, skillFilePath, limits.maxFrontmatterBytes);
    issues.push(...document.issues);
    metadataShape = document.metadataShape;
    if (document.rawMetadata !== null) {
      const validation = validateKnownMetadata(document.rawMetadata, skillRoot, skillFilePath);
      name = validation.name;
      issues.push(...validation.issues);
      issues.push(...detectBodyPathTraversal(document.body, skillRoot, skillFilePath));
      issues.push(...detectMetadataPathTraversal(document.rawMetadata, skillRoot, skillFilePath));
      requirements = requirementsFromMetadata(document.rawMetadata, skillFilePath);
    }
  }

  const inventory = files.map((file) => {
    const relativePath = relativePortable(skillRoot, file.absolutePath);
    return { path: relativePath, bytes: file.bytes, category: categoryFor(relativePath) };
  });
  const scripts = inventory.filter((file) => file.category === "script").map((file) => file.path);
  const resources = inventory
    .filter((file) => file.category !== "skill" && file.category !== "script")
    .map((file) => file.path);
  const digest = rootTruncated || scopedSymlinks.length > 0 || scopedIncomplete.length > 0
    ? null
    : await contentDigest(files, skillRoot, skillFilePath, issues, readFile);

  return {
    path,
    skillFile: skillFilePath,
    name,
    metadataShape,
    digest,
    digestSemantics: "sha256 of sorted relative paths and regular-file bytes; unavailable for incomplete coverage or symlinks; not publisher authentication",
    files: inventory,
    scripts,
    resources,
    requirements,
    allowedToolsSemantics: "untrusted requested capabilities; host support and approval are implementation-dependent",
  };
}

function issueOrder(issue: InspectionIssue): string {
  const severity = issue.severity === "error" ? "0" : issue.severity === "warning" ? "1" : "2";
  return `${severity}\0${issue.path}\0${issue.code}\0${issue.message}`;
}

function finalize(report: InspectionReport): InspectionReport {
  const redactions = redactInspectionReport(report);
  if (redactions > 0) {
    report.issues.push({
      severity: "warning",
      code: "OUTPUT_REDACTED",
      path: ".",
      message: "One or more credential-like identifiers or paths were redacted from the report.",
    });
  }
  const deduplicated = new Map<string, InspectionIssue>();
  for (const issue of report.issues) deduplicated.set(issueOrder(issue), issue);
  report.issues = [...deduplicated.values()].sort((a, b) => compareStrings(issueOrder(a), issueOrder(b)));
  const errors = report.issues.filter((issue) => issue.severity === "error");
  report.valid = errors.length === 0;
  report.summary = {
    skills: report.skills.length,
    files: report.skills.reduce((count, skill) => count + skill.files.length, 0),
    scripts: report.skills.reduce((count, skill) => count + skill.scripts.length, 0),
    resources: report.skills.reduce((count, skill) => count + skill.resources.length, 0),
    errors: errors.length,
    warnings: report.issues.filter((issue) => issue.severity === "warning").length,
    redactions,
  };
  return report;
}

export async function inspectLocalSkills(
  inputPath = process.cwd(),
  options: InspectionOptions = {},
): Promise<InspectionReport> {
  const limits = effectiveLimits(options.limits);
  const report = emptyReport(limits);
  const input = resolve(inputPath);
  let stat;
  try {
    stat = await lstat(input);
  } catch {
    return addInputFailure(report, "INPUT_NOT_FOUND", "The local inspection path does not exist.");
  }
  if (stat.isSymbolicLink()) {
    return addInputFailure(report, "INPUT_SYMLINK_NOT_ALLOWED", "The inspection root cannot be a symlink.");
  }

  let root: string;
  if (stat.isDirectory()) {
    root = input;
  } else if (stat.isFile() && basename(input) === "SKILL.md") {
    root = dirname(input);
  } else if (stat.isFile() && basename(input) === "package.json") {
    root = dirname(input);
  } else if (stat.isFile() && basename(input) === "plugin.json" &&
    [".codex-plugin", ".claude-plugin"].includes(basename(dirname(input)))) {
    root = dirname(dirname(input));
  } else {
    return addInputFailure(report, "INPUT_TYPE_UNSUPPORTED", "Inspect a skill directory, SKILL.md, or plugin/package root.");
  }

  const tree = await inventoryTree(root, limits);
  report.issues.push(...tree.issues);
  const reads = new Map<string, Promise<Buffer | null>>();
  const readOnce = (file: InternalFile): Promise<Buffer | null> => {
    const existing = reads.get(file.absolutePath);
    if (existing !== undefined) return existing;
    const pending = readBoundedFile(file);
    reads.set(file.absolutePath, pending);
    return pending;
  };
  const packageFile = tree.files.find((file) => file.path === "package.json");
  if (packageFile !== undefined) {
    const inspected = await inspectPackageManifest(packageFile, readOnce);
    report.package = inspected.package;
    report.issues.push(...inspected.issues);
  }

  const manifestDefinitions: Array<{ path: string; kind: "codex" | "claude" }> = [
    { path: ".codex-plugin/plugin.json", kind: "codex" },
    { path: ".claude-plugin/plugin.json", kind: "claude" },
  ];
  for (const definition of manifestDefinitions) {
    const file = tree.files.find((candidate) => candidate.path === definition.path);
    if (file === undefined) continue;
    const inspected = await inspectPluginManifest(file, definition.kind, root, readOnce);
    if (inspected.manifest !== null) report.manifests.push(inspected.manifest);
    report.issues.push(...inspected.issues);
  }
  report.manifests.sort((a, b) => compareStrings(a.path, b.path));

  let skillFiles = tree.files.filter((file) => basename(file.absolutePath) === "SKILL.md");
  if (skillFiles.length > limits.maxSkills) {
    const firstExcluded = skillFiles[limits.maxSkills];
    report.issues.push({
      severity: "error",
      code: "MAX_SKILLS_EXCEEDED",
      path: firstExcluded?.path ?? ".",
      message: "The bounded skill count was exceeded; remaining skills were not parsed.",
    });
    skillFiles = skillFiles.slice(0, limits.maxSkills);
  }
  if (skillFiles.length === 0) {
    report.issues.push({
      severity: "error",
      code: "NO_SKILLS_FOUND",
      path: ".",
      message: "No SKILL.md files were found within the bounded local inspection scope.",
    });
  }
  for (const skillFile of skillFiles) {
    report.skills.push(await inspectSkill(
      root,
      skillFile,
      tree.files,
      tree.symlinks.map((link) => link.path),
      tree.incompletePaths,
      tree.truncated,
      limits,
      report.issues,
      readOnce,
    ));
  }
  report.skills.sort((a, b) => compareStrings(a.path, b.path));

  const skillNames = new Map<string, string>();
  for (const skill of report.skills) {
    if (skill.name !== null) {
      const previous = skillNames.get(skill.name);
      if (previous !== undefined) {
        report.issues.push({
          severity: "error",
          code: "DUPLICATE_SKILL_NAME",
          path: skill.skillFile,
          message: "Two discovered skills declare the same portable name.",
        });
      } else {
        skillNames.set(skill.name, skill.skillFile);
      }
    }
  }
  for (let index = 0; index < report.skills.length; index += 1) {
    const parent = report.skills[index];
    if (parent === undefined) continue;
    for (const child of report.skills.slice(index + 1)) {
      if (parent.path === "." || child.path.startsWith(`${parent.path}/`)) {
        report.issues.push({
          severity: "error",
          code: "NESTED_SKILL_ROOT",
          path: child.skillFile,
          message: "Nested skill roots overlap content and are not accepted by the v0 inspector.",
        });
      }
    }
  }

  for (const manifest of report.manifests) {
    for (const declaredPath of manifest.declaredSkillPaths) {
      const namesExactFile = declaredPath === "SKILL.md" || declaredPath.endsWith("/SKILL.md");
      const containsSkill = report.skills.some((skill) => namesExactFile
        ? skill.skillFile === declaredPath
        : declaredPath === "." || skill.path === declaredPath || skill.path.startsWith(`${declaredPath}/`));
      if (!containsSkill) {
        report.issues.push({
          severity: "error",
          code: "DECLARED_SKILL_PATH_EMPTY",
          path: manifest.path,
          message: "A declared manifest skill path contains no discovered SKILL.md.",
        });
      }
    }
  }

  report.scope.inputKind = tree.files.some((file) => file.path === "SKILL.md")
    ? "skill"
    : report.manifests.length > 0
      ? "plugin"
      : report.package !== null
        ? "package"
        : "directory";
  return finalize(report);
}

export const validateLocalSkills = inspectLocalSkills;
