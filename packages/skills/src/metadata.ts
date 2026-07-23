import { parseDocument } from "yaml";
import { isUnsafePortableLocalPath } from "./path-safety.js";
import type { InspectionIssue, JsonObject, JsonValue, MetadataShape } from "./types.js";

export interface ParsedSkillDocument {
  rawMetadata: JsonObject | null;
  metadataShape: { [key: string]: MetadataShape };
  body: string;
  issues: InspectionIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const SENSITIVE_FIELD = /(?:password|passwd|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|access[-_]?key)/i;

function reportKey(key: string, index: number): string {
  if (["__proto__", "prototype", "constructor"].includes(key)) return `<dangerous-field-${index}>`;
  if (SENSITIVE_FIELD.test(key)) return `<sensitive-field-${index}>`;
  if (key.length > 128 || /[\u0000-\u001f\u007f]/.test(key)) return `<nonportable-field-${index}>`;
  return key;
}

function summarizeShape(value: unknown): MetadataShape {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) return { type: "array", items: value.map(summarizeShape) };
  if (isRecord(value)) {
    const fields: Record<string, MetadataShape> = {};
    Object.keys(value).sort().forEach((key, index) => {
      fields[reportKey(key, index)] = summarizeShape(value[key]);
    });
    return { type: "object", fields };
  }
  return { type: "string" };
}

function metadataWithinComplexity(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > 4_096 || current.depth > 32) return false;
    if (current.value === null || typeof current.value !== "object") continue;
    if (seen.has(current.value)) return false;
    seen.add(current.value);
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

function hasDangerousMetadataKey(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) return true;
      stack.push(child);
    }
  }
  return false;
}

function findFrontmatter(source: string): { yaml: string; body: string } | null {
  const withoutBom = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const lines = withoutBom.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line?.trim() === "---" || line?.trim() === "...") {
      return {
        yaml: lines.slice(1, index).join("\n"),
        body: lines.slice(index + 1).join("\n"),
      };
    }
  }
  return null;
}

function failure(path: string, code: string, message: string): ParsedSkillDocument {
  return {
    rawMetadata: null,
    metadataShape: {},
    body: "",
    issues: [{ severity: "error", code, path, message }],
  };
}

export function parseSkillDocument(
  bytes: Buffer,
  skillFilePath: string,
  maxFrontmatterBytes: number,
): ParsedSkillDocument {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure(skillFilePath, "SKILL_NOT_UTF8", "SKILL.md must be valid UTF-8.");
  }

  const frontmatter = findFrontmatter(source);
  if (frontmatter === null) {
    return failure(
      skillFilePath,
      "FRONTMATTER_MISSING",
      "SKILL.md must begin with closed YAML frontmatter.",
    );
  }
  if (Buffer.byteLength(frontmatter.yaml, "utf8") > maxFrontmatterBytes) {
    return failure(
      skillFilePath,
      "FRONTMATTER_TOO_LARGE",
      "Skill frontmatter exceeds the bounded metadata byte limit.",
    );
  }

  let parsed: unknown;
  try {
    const document = parseDocument(frontmatter.yaml, {
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) throw new Error("invalid");
    parsed = document.toJS({ maxAliasCount: 0 });
  } catch {
    return failure(
      skillFilePath,
      "FRONTMATTER_INVALID",
      "Skill frontmatter is not valid, unique-key YAML metadata.",
    );
  }
  if (!isRecord(parsed)) {
    return failure(
      skillFilePath,
      "FRONTMATTER_NOT_MAPPING",
      "Skill frontmatter must be a YAML mapping.",
    );
  }
  if (!metadataWithinComplexity(parsed)) {
    return failure(
      skillFilePath,
      "METADATA_COMPLEXITY_EXCEEDED",
      "Skill metadata exceeds the bounded nesting or collection limit.",
    );
  }

  if (hasDangerousMetadataKey(parsed)) {
    return failure(
      skillFilePath,
      "DANGEROUS_METADATA_KEY",
      "Skill metadata contains a prototype-sensitive key and was rejected.",
    );
  }

  const metadataShape: Record<string, MetadataShape> = {};
  Object.keys(parsed).sort().forEach((key, index) => {
    metadataShape[reportKey(key, index)] = summarizeShape(parsed[key]);
  });
  return {
    rawMetadata: parsed as JsonObject,
    metadataShape,
    body: frontmatter.body,
    issues: [],
  };
}

export function detectBodyPathTraversal(body: string, skillRoot: string, skillFilePath: string): InspectionIssue[] {
  const candidates: string[] = [];
  const inline = /!?\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+[^)]*)?\)/g;
  const definitions = /^\s*\[[^\]]+\]:\s*<?([^>\s]+)>?/gm;
  for (const match of body.matchAll(inline)) if (match[1]) candidates.push(match[1]);
  for (const match of body.matchAll(definitions)) if (match[1]) candidates.push(match[1]);

  for (const rawCandidate of candidates) {
    let candidate = rawCandidate;
    try {
      candidate = decodeURIComponent(rawCandidate);
    } catch {
      // An undecodable path is left as-is and cannot gain traversal semantics.
    }
    if (/^(?:https?|mailto|data):/i.test(candidate) || candidate.startsWith("#")) continue;
    if (isUnsafePortableLocalPath(skillRoot, candidate)) {
      return [{
        severity: "error",
        code: "RESOURCE_PATH_ESCAPE",
        path: skillFilePath,
        message: "SKILL.md declares a local resource path outside its skill directory.",
      }];
    }
  }
  return [];
}

export function detectMetadataPathTraversal(
  metadata: JsonObject,
  skillRoot: string,
  skillFilePath: string,
): InspectionIssue[] {
  let escaped = false;
  const pathKey = /^(?:path|paths|script|scripts|resource|resources|asset|assets)$/i;

  function inspect(value: JsonValue, key: string | null): void {
    if (escaped) return;
    if (key !== null && pathKey.test(key)) {
      const values = Array.isArray(value) ? value : [value];
      for (const candidate of values) {
        if (typeof candidate !== "string") continue;
        if (isUnsafePortableLocalPath(skillRoot, candidate)) {
          escaped = true;
          return;
        }
      }
    }
    if (Array.isArray(value)) value.forEach((item) => inspect(item, null));
    else if (value !== null && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) inspect(child, childKey);
    }
  }

  inspect(metadata, null);
  return escaped
    ? [{
        severity: "error",
        code: "METADATA_PATH_ESCAPE",
        path: skillFilePath,
        message: "Skill metadata declares a local path outside its skill directory.",
      }]
    : [];
}
