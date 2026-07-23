import { relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { readBoundedFile } from "./inventory.js";
import { normalizeRequirements } from "./requirements.js";
import { isUnsafePortableLocalPath } from "./path-safety.js";
import type {
  CredentialRequirement,
  InspectionIssue,
  PackageInspection,
  PluginManifestInspection,
} from "./types.js";
import type { InternalFile, InternalFileReader } from "./inventory.js";
import { compareStrings } from "./stable-json.js";

const SAFE_SYMBOL = /^[A-Za-z][A-Za-z0-9_.:/-]{0,127}$/;
const SAFE_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,213}$/;
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const SAFE_CONSTRAINT = /^[0-9A-Za-z.*<>=~^| +_-]{1,100}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonWithinComplexity(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > 4_096 || current.depth > 32) return false;
    if (current.value === null || typeof current.value !== "object") continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

async function readJson(
  file: InternalFile,
  readFile: InternalFileReader,
): Promise<Record<string, unknown> | null> {
  if (!file.readableWithinLimits) return null;
  try {
    const bytes = await readFile(file);
    if (bytes === null) return null;
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const document = parseDocument(source, {
      prettyErrors: false,
      schema: "json",
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) return null;
    const parsed: unknown = JSON.parse(source);
    return isRecord(parsed) && jsonWithinComplexity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeIdentity(
  value: unknown,
  pattern: RegExp,
  path: string,
  issues: InspectionIssue[],
): string | null {
  if (value === undefined) return null;
  if (typeof value === "string" && pattern.test(value)) return value;
  issues.push({
    severity: "warning",
    code: "MANIFEST_IDENTITY_REDACTED",
    path,
    message: "A manifest identity field was not a safe portable identifier and was omitted.",
  });
  return null;
}

function literalDeclared(value: unknown): boolean {
  return typeof value !== "string" || !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);
}

function inspectMcpServers(
  value: unknown,
  path: string,
  issues: InspectionIssue[],
): PluginManifestInspection["mcpServers"] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    issues.push({
      severity: "error",
      code: "MCP_SERVERS_INVALID",
      path,
      message: "The mcpServers declaration must be a mapping.",
    });
    return [];
  }

  const servers: PluginManifestInspection["mcpServers"] = [];
  for (const name of Object.keys(value).sort()) {
    if (!SAFE_SYMBOL.test(name)) {
      issues.push({
        severity: "warning",
        code: "MCP_SERVER_NAME_REDACTED",
        path,
        message: "A non-symbolic MCP server name was omitted from the report.",
      });
      continue;
    }
    const declaration = value[name];
    const credentialBindings: CredentialRequirement[] = [];
    if (isRecord(declaration) && declaration.env !== undefined) {
      if (isRecord(declaration.env)) {
        for (const envName of Object.keys(declaration.env).sort()) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(envName)) {
            issues.push({
              severity: "warning",
              code: "CREDENTIAL_NAME_REDACTED",
              path,
              message: "A non-symbolic credential binding name was omitted from the report.",
            });
            continue;
          }
          credentialBindings.push({
            name: envName,
            source: `${path}#mcpServers.${name}.env`,
            literalDeclared: literalDeclared(declaration.env[envName]),
          });
        }
      } else {
        issues.push({
          severity: "error",
          code: "MCP_ENV_INVALID",
          path,
          message: "An MCP env declaration must be a mapping of symbolic names to bindings.",
        });
      }
    }
    servers.push({ name, credentialBindings });
  }
  return servers;
}

function declaredSkillPaths(
  value: unknown,
  root: string,
  manifestPath: string,
  issues: InspectionIssue[],
): string[] {
  if (value === undefined) return [];
  const candidates = typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  if ((Array.isArray(value) && candidates.length !== value.length) || candidates.length === 0) {
    issues.push({
      severity: "error",
      code: "SKILL_PATHS_INVALID",
      path: manifestPath,
      message: "Manifest skill paths must be a string or an array of strings.",
    });
  }

  const accepted: string[] = [];
  for (const candidate of candidates) {
    const declaredDestination = resolve(root, candidate);
    if (isUnsafePortableLocalPath(root, candidate)) {
      issues.push({
        severity: "error",
        code: "MANIFEST_PATH_TRAVERSAL",
        path: manifestPath,
        message: "A declared skill path contains traversal or escapes the package root.",
      });
      continue;
    }
    const relativePath = declaredDestination === root
      ? "."
      : relative(root, declaredDestination).split(sep).join("/").replace(/\/$/, "");
    accepted.push(relativePath || ".");
  }
  return [...new Set(accepted)].sort(compareStrings);
}

export async function inspectPluginManifest(
  file: InternalFile,
  kind: "codex" | "claude",
  root: string,
  readFile: InternalFileReader = readBoundedFile,
): Promise<{ manifest: PluginManifestInspection | null; issues: InspectionIssue[] }> {
  const issues: InspectionIssue[] = [];
  const parsed = await readJson(file, readFile);
  if (parsed === null) {
    issues.push({
      severity: "error",
      code: "PLUGIN_MANIFEST_INVALID",
      path: file.path,
      message: "The plugin manifest is not a readable UTF-8 JSON object.",
    });
    return { manifest: null, issues };
  }
  return {
    manifest: {
      kind,
      path: file.path,
      name: safeIdentity(parsed.name, SAFE_PACKAGE_NAME, file.path, issues),
      version: safeIdentity(parsed.version, SAFE_VERSION, file.path, issues),
      declaredSkillPaths: declaredSkillPaths(parsed.skills, root, file.path, issues),
      mcpServers: inspectMcpServers(parsed.mcpServers, file.path, issues),
    },
    issues,
  };
}

export async function inspectPackageManifest(
  file: InternalFile,
  readFile: InternalFileReader = readBoundedFile,
): Promise<{ package: PackageInspection | null; issues: InspectionIssue[] }> {
  const issues: InspectionIssue[] = [];
  const parsed = await readJson(file, readFile);
  if (parsed === null) {
    issues.push({
      severity: "error",
      code: "PACKAGE_MANIFEST_INVALID",
      path: file.path,
      message: "package.json is not a readable UTF-8 JSON object.",
    });
    return { package: null, issues };
  }
  const runtimes: PackageInspection["runtimes"] = [];
  if (parsed.engines !== undefined) {
    if (isRecord(parsed.engines)) {
      for (const name of Object.keys(parsed.engines).sort()) {
        if (!SAFE_SYMBOL.test(name)) continue;
        const rawConstraint = parsed.engines[name];
        const constraint = typeof rawConstraint === "string" && SAFE_CONSTRAINT.test(rawConstraint)
          ? rawConstraint
          : undefined;
        if (rawConstraint !== undefined && constraint === undefined) {
          issues.push({
            severity: "warning",
            code: "RUNTIME_CONSTRAINT_REDACTED",
            path: file.path,
            message: "A non-portable runtime constraint was omitted from the report.",
          });
        }
        runtimes.push({ name, ...(constraint === undefined ? {} : { constraint }), source: `${file.path}#engines` });
      }
    } else {
      issues.push({
        severity: "warning",
        code: "PACKAGE_ENGINES_INVALID",
        path: file.path,
        message: "package.json engines must be a mapping to declare runtime requirements.",
      });
    }
  }
  return {
    package: {
      path: "package.json",
      name: safeIdentity(parsed.name, SAFE_PACKAGE_NAME, file.path, issues),
      version: safeIdentity(parsed.version, SAFE_VERSION, file.path, issues),
      runtimes: normalizeRequirements({ tools: [], mcpServers: [], runtimes, credentials: [] }).runtimes,
    },
    issues,
  };
}
