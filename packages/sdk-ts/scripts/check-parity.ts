#!/usr/bin/env bun
/**
 * SDK parity check — Phase 1 deliverable.
 *
 * Diffs method names per module across `agenttool-sdk` (py) and
 * `@agenttool/sdk` (ts). Fails (exit 1) if either side has a method the
 * other lacks, modulo:
 *   • casing — snake_case in py vs the SAME snake_case in ts (we mirror
 *     py exactly; idiomatic TS aliases are allowed as extras)
 *   • private names — anything starting with "_" is skipped on both sides
 *
 * Usage:
 *   bun run packages/sdk-ts/scripts/check-parity.ts        # text output
 *   bun run packages/sdk-ts/scripts/check-parity.ts --json # machine-readable
 *
 * Run from repo root (or set MONOREPO_ROOT). The script discovers source
 * files under packages/sdk-{py,ts}/src and parses them with a regex that
 * picks up:
 *   py: `    def method_name(`           (4-space indent · async def too)
 *   ts: `  async methodName(` or `  methodName(`  (2-space indent · class methods)
 *
 * Aliases (snake_case + camelCase pointing at the same primary) are
 * allowed on the TS side as long as the snake_case form is present —
 * the parity rule is "every public py method has a snake_case TS match."
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MONOREPO_ROOT
  ? resolve(process.env.MONOREPO_ROOT)
  : resolve(__dirname, "../../..");

const PY_SRC = join(ROOT, "packages/sdk-py/src/agenttool");
const TS_SRC = join(ROOT, "packages/sdk-ts/src");

/** Modules covered by parity. Each name is the module file basename
 *  (sans extension) on BOTH sides — by convention they always match. */
const MODULES = [
  "bootstrap",
  "chronicle",
  "covenants",
  "crypto",
  "economy",
  "identity",
  "memory",
  "strands",
  "tools",
  "traces",
  "vault",
  "wake",
  "window",
] as const;

/** Names that are part of the public API but are not class methods.
 *  We don't need to enforce them — usually they are exported helpers. */
const SKIP_NAMES = new Set([
  // internal helpers / dunders
  "__init__",
  "__del__",
  "__enter__",
  "__exit__",
  "from_dict",
  "to_dict",
  // ts plumbing
  "constructor",
  "req",
  "fetch",
  "post",
  "_check",
  "_url",
  "_warned_deprecated",
]);

interface ModuleParity {
  module: string;
  pyMethods: string[];
  tsMethods: string[];
  pyOnly: string[]; // exists in py, missing in ts
  tsOnly: string[]; // exists in ts, no matching py
}

/** Normalize `methodName` → `method_name` for cross-language compare. */
function normalize(name: string): string {
  // camelCase → snake_case
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/^_+/, "")
    .toLowerCase();
}

/** Slice the source between `class XxxClient:` and the next top-level
 *  `class ` (column-0). If no Client class is found, return the whole file. */
function scopeToClient(src: string, language: "py" | "ts"): string {
  const re =
    language === "py"
      ? /^class +([A-Z][A-Za-z0-9]*Client)\b/m
      : /^export class +([A-Z][A-Za-z0-9]*Client)\b/m;
  const startMatch = re.exec(src);
  if (!startMatch) return src;
  const start = startMatch.index;
  // Find next top-level class/dataclass after start.
  const tail = src.slice(start + startMatch[0].length);
  const nextRe = language === "py" ? /^(class |@dataclass)/m : /^export class /m;
  const nextMatch = nextRe.exec(tail);
  return nextMatch ? src.slice(start, start + startMatch[0].length + nextMatch.index) : src.slice(start);
}

async function pyMethodsOf(module: string): Promise<string[]> {
  const path = join(PY_SRC, `${module}.py`);
  let src: string;
  try {
    src = await readFile(path, "utf8");
  } catch {
    return []; // module file not present
  }
  src = scopeToClient(src, "py");
  const out = new Set<string>();
  // Match: indent + (async )? def name(
  // Indent must be 4 spaces (class method); skip module-level (no indent).
  const re = /^[ ]{4}(?:async )?def +([a-zA-Z_][a-zA-Z0-9_]*) *\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (name.startsWith("__") && name.endsWith("__")) continue;
    if (SKIP_NAMES.has(name)) continue;
    if (name.startsWith("_")) continue; // private
    out.add(name);
  }
  return [...out].sort();
}

async function tsMethodsOf(module: string): Promise<string[]> {
  const path = join(TS_SRC, `${module}.ts`);
  let src: string;
  try {
    src = await readFile(path, "utf8");
  } catch {
    return [];
  }
  src = scopeToClient(src, "ts");
  const out = new Set<string>();

  // First pass: `readonly fieldName: SomeClient;` — sub-client properties.
  // Counts as a parity-equivalent of a py @property returning a Client.
  const fieldRe = /^[ ]{2}readonly +([a-zA-Z_$][a-zA-Z0-9_$]*) *:/gm;
  let fm: RegExpExecArray | null;
  while ((fm = fieldRe.exec(src)) !== null) {
    const name = fm[1];
    if (SKIP_NAMES.has(name)) continue;
    if (name.startsWith("_")) continue;
    out.add(name);
  }

  // Second pass: methods.
  // Match: 2-space indent + (async )? identifier( - class method body
  const re = /^[ ]{2}(?:async +)?([a-zA-Z_$][a-zA-Z0-9_$]*) *\(/gm;
  const reserved = new Set([
    "if",
    "for",
    "while",
    "switch",
    "return",
    "throw",
    "try",
    "catch",
    "do",
    "private",
    "protected",
    "public",
    "static",
    "readonly",
    "import",
    "export",
    "type",
    "interface",
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (reserved.has(name)) continue;
    if (SKIP_NAMES.has(name)) continue;
    if (name.startsWith("_")) continue;
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const lineHead = src.slice(lineStart, m.index + m[0].length);
    if (/\b(private|static|readonly)\b/.test(lineHead)) continue;
    out.add(name);
  }
  return [...out].sort();
}

async function checkModule(module: string): Promise<ModuleParity> {
  const [pyMethods, tsMethods] = await Promise.all([
    pyMethodsOf(module),
    tsMethodsOf(module),
  ]);

  const tsNormalized = new Set(tsMethods.map(normalize));
  const pyNormalized = new Set(pyMethods.map(normalize));

  const pyOnly = pyMethods.filter((m) => !tsNormalized.has(normalize(m)));
  // For tsOnly, allow camelCase aliases whose snake_case form IS in py.
  // Example: `createWallet` (alias) is acceptable iff `create_wallet` exists in py.
  const tsOnly = tsMethods.filter((m) => {
    const norm = normalize(m);
    if (pyNormalized.has(norm)) return false;
    // Look for any other ts method that normalizes to the same thing — alias
    const aliases = tsMethods.filter((other) => other !== m && normalize(other) === norm);
    if (aliases.length > 0 && aliases.some((a) => pyNormalized.has(normalize(a)))) {
      return false;
    }
    return true;
  });

  return { module, pyMethods, tsMethods, pyOnly, tsOnly };
}

function formatReport(results: ModuleParity[]): string {
  const lines: string[] = [];
  let hasGap = false;

  for (const r of results) {
    const status = r.pyOnly.length === 0 && r.tsOnly.length === 0 ? "✓" : "✗";
    if (status === "✗") hasGap = true;
    lines.push(
      `${status} ${r.module.padEnd(11)}  py:${String(r.pyMethods.length).padStart(2)}  ts:${String(r.tsMethods.length).padStart(2)}`,
    );
    if (r.pyOnly.length) {
      lines.push(`    py-only (TS missing): ${r.pyOnly.join(", ")}`);
    }
    if (r.tsOnly.length) {
      lines.push(`    ts-only (py missing): ${r.tsOnly.join(", ")}`);
    }
  }

  lines.push("");
  lines.push(hasGap ? "✗ parity FAIL — see gaps above" : "✓ parity OK — both SDKs at the same surface");
  return lines.join("\n");
}

async function main() {
  const results = await Promise.all(MODULES.map(checkModule));
  const wantsJson = process.argv.includes("--json");

  if (wantsJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatReport(results));
  }

  const hasGap = results.some((r) => r.pyOnly.length > 0 || r.tsOnly.length > 0);
  process.exit(hasGap ? 1 : 0);
}

main().catch((e) => {
  console.error("parity check crashed:", e);
  process.exit(2);
});
