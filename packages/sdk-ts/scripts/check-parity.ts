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
 *   ts: `  async methodName(`, `  async *methodName(`, or `  methodName(`
 *       (2-space indent · class methods)
 *
 * Aliases (snake_case + camelCase pointing at the same primary) are
 * allowed on the TS side as long as the snake_case form is present —
 * the parity rule is "every public py method has a snake_case TS match."
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MONOREPO_ROOT
  ? resolve(process.env.MONOREPO_ROOT)
  : resolve(__dirname, "../../..");

const PY_SRC = join(ROOT, "packages/sdk-py/src/agenttool");
const TS_SRC = join(ROOT, "packages/sdk-ts/src");

interface ParityTarget {
  /** Source basename in packages/sdk-ts/src. */
  tsModule: string;
  /** Source basename in packages/sdk-py/src/agenttool. */
  pyModule: string;
  /** Stable label rendered in parity reports. */
  reportName: string;
  /** Client class inspected in both languages. */
  className: string;
  /** Whether this class is exposed directly on the AgentTool client. */
  topLevel: boolean;
}

function target(module: string, className: string, reportName = module): ParityTarget {
  return {
    tsModule: module,
    pyModule: module,
    reportName,
    className,
    topLevel: true,
  };
}

function splitTarget(
  tsModule: string,
  pyModule: string,
  className: string,
  reportName: string,
): ParityTarget {
  return { tsModule, pyModule, reportName, className, topLevel: true };
}

function nestedTarget(
  module: string,
  className: string,
  reportName: string,
): ParityTarget {
  return {
    tsModule: module,
    pyModule: module,
    reportName,
    className,
    topLevel: false,
  };
}

/** Every client namespace reachable from AgentTool, including nested clients.
 *  Keep filename differences explicit: they are language conventions, not
 *  missing modules. */
const TARGETS: ParityTarget[] = [
  splitTarget("at-rest", "at_rest", "AtRestClient", "at_rest"),
  target("bootstrap", "BootstrapClient"),
  target("chronicle", "ChronicleClient"),
  target("collect", "CollectClient"),
  target("covenants", "CovenantsClient"),
  target("crypto", "CryptoClient"),
  target("data", "DataClient"),
  splitTarget(
    "dark-continent",
    "dark_continent",
    "DarkContinentClient",
    "dark_continent",
  ),
  target("economy", "EconomyClient"),
  target("handoff", "HandoffClient"),
  target("grace", "GraceClient"),
  target("identity", "IdentityClient"),
  target("inbox", "InboxClient"),
  target("love", "LoveClient"),
  target("memory", "MemoryClient"),
  target("nen", "NenClient"),
  target("runtime", "RuntimeClient"),
  target("strands", "StrandsClient"),
  target("tools", "ToolsClient"),
  target("traces", "TracesClient"),
  target("vault", "VaultClient"),
  target("wake", "WakeClient"),
  target("window", "WindowClient"),

  // Nested namespaces share a source file with their parent. Listing each
  // class prevents parent-property parity from hiding method drift within it.
  nestedTarget("data", "DataSyncClient", "data.sync"),
  nestedTarget("identity", "ExpressionClient", "identity.expression"),
  nestedTarget("identity", "BoxKeysClient", "identity.box_keys"),
  nestedTarget("seed", "SeedClient", "crypto.seed"),
  nestedTarget("strands", "ThoughtsClient", "strands.thoughts"),
];

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
 *  `class ` (column-0). A missing class is a structural parity failure. */
export function scopeToClient(
  src: string,
  language: "py" | "ts",
  className: string,
  sourceLabel = `${language} source`,
): string {
  const classPattern = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    language === "py"
      ? `^class +${classPattern}\\b`
      : `^export class +${classPattern}\\b`,
    "m",
  );
  const startMatch = re.exec(src);
  if (!startMatch) {
    throw new Error(
      `Required ${language === "py" ? "Python" : "TypeScript"} class ${className} was not found in ${sourceLabel}`,
    );
  }
  const start = startMatch.index;
  // Find next top-level class/dataclass after start.
  const tail = src.slice(start + startMatch[0].length);
  const nextRe =
    language === "py" ? /^(class |@dataclass)/m : /^(?:export )?class /m;
  const nextMatch = nextRe.exec(tail);
  return nextMatch
    ? src.slice(start, start + startMatch[0].length + nextMatch.index)
    : src.slice(start);
}

/** Read a source file whose absence would otherwise look like an empty API. */
export async function readRequiredSource(
  path: string,
  description: string,
): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Required ${description} is missing or unreadable: ${path} (${reason})`,
    );
  }
}

/** Discover the client namespaces actually exposed by AgentTool. */
export function topLevelNamespacesOf(
  src: string,
  language: "py" | "ts",
  sourceLabel = `${language} AgentTool source`,
): string[] {
  const scoped = scopeToClient(src, language, "AgentTool", sourceLabel);
  const namespaces = new Set<string>();
  const re =
    language === "py"
      ? /^[ ]{4}@property\r?\n[ ]{4}def +([a-zA-Z_][a-zA-Z0-9_]*)\(self\) *-> *[a-zA-Z_][a-zA-Z0-9_]*Client\s*:/gm
      : /^[ ]{2}get +([a-zA-Z_$][a-zA-Z0-9_$]*)\(\)\s*:\s*[a-zA-Z_$][a-zA-Z0-9_$]*Client\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scoped)) !== null) {
    namespaces.add(normalize(match[1]));
  }
  return [...namespaces].sort();
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((name) => !right.has(name)).sort();
}

/** Require configured parity targets and both public clients to name the same APIs. */
export function validateTopLevelNamespaceCoverage(
  configuredNames: readonly string[],
  tsNamespaces: readonly string[],
  pyNamespaces: readonly string[],
): void {
  const configured = new Set(configuredNames.map(normalize));
  const ts = new Set(tsNamespaces.map(normalize));
  const py = new Set(pyNamespaces.map(normalize));
  const issues: string[] = [];

  const comparisons: Array<[string, string[]]> = [
    ["configured targets absent from TypeScript AgentTool", difference(configured, ts)],
    ["TypeScript AgentTool namespaces missing parity targets", difference(ts, configured)],
    ["configured targets absent from Python AgentTool", difference(configured, py)],
    ["Python AgentTool namespaces missing parity targets", difference(py, configured)],
  ];
  for (const [label, names] of comparisons) {
    if (names.length > 0) issues.push(`${label}: ${names.join(", ")}`);
  }

  if (issues.length > 0) {
    throw new Error(
      `Top-level AgentTool namespace inventory mismatch:\n- ${issues.join("\n- ")}`,
    );
  }
}

async function validateConfiguredTopLevelTargets(): Promise<void> {
  const tsPath = join(TS_SRC, "client.ts");
  const pyPath = join(PY_SRC, "client.py");
  const [tsSource, pySource] = await Promise.all([
    readRequiredSource(tsPath, "TypeScript AgentTool client source"),
    readRequiredSource(pyPath, "Python AgentTool client source"),
  ]);
  validateTopLevelNamespaceCoverage(
    TARGETS.filter((entry) => entry.topLevel).map((entry) => entry.reportName),
    topLevelNamespacesOf(tsSource, "ts", tsPath),
    topLevelNamespacesOf(pySource, "py", pyPath),
  );
}

async function pyMethodsOf(target: ParityTarget): Promise<string[]> {
  const path = join(PY_SRC, `${target.pyModule}.py`);
  let src = await readRequiredSource(
    path,
    `Python source for ${target.reportName}`,
  );
  src = scopeToClient(src, "py", target.className, path);
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

async function tsMethodsOf(target: ParityTarget): Promise<string[]> {
  const path = join(TS_SRC, `${target.tsModule}.ts`);
  let src = await readRequiredSource(
    path,
    `TypeScript source for ${target.reportName}`,
  );
  src = scopeToClient(src, "ts", target.className, path);
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
  // Match ordinary and generator methods. The optional `*` is significant:
  // async generators such as WakeClient.voice are public methods too.
  const re = /^[ ]{2}(?:async +)?(?:\* *)?([a-zA-Z_$][a-zA-Z0-9_$]*) *\(/gm;
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

async function checkModule(target: ParityTarget): Promise<ModuleParity> {
  const [pyMethods, tsMethods] = await Promise.all([
    pyMethodsOf(target),
    tsMethodsOf(target),
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

  return { module: target.reportName, pyMethods, tsMethods, pyOnly, tsOnly };
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
  await validateConfiguredTopLevelTargets();
  const results = await Promise.all(TARGETS.map(checkModule));
  const wantsJson = process.argv.includes("--json");

  if (wantsJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatReport(results));
  }

  const hasGap = results.some((r) => r.pyOnly.length > 0 || r.tsOnly.length > 0);
  process.exit(hasGap ? 1 : 0);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`parity check failed structurally: ${message}`);
    process.exit(2);
  });
}
