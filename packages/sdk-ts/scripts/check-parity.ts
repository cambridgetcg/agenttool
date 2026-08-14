#!/usr/bin/env bun
/**
 * SDK parity check — Phase 1 deliverable.
 *
 * Diffs the published surface across `agenttool-sdk` (py) and
 * `@agenttool/sdk` (ts) in two passes. Fails (exit 1) if either side has a
 * name the other lacks:
 *
 *   1. client methods, per configured module + class pair
 *   2. module-level functions, package-wide — this is where the canonical
 *      bytes and signing helpers live (`canonicalGraceBytes`,
 *      `signCovenantDeclare`, `canonicalAttestationBytes`, …)
 *
 * modulo:
 *   • casing — camelCase in ts vs snake_case in py, compared with separators
 *     dropped so `deriveKMaster` and `derive_k_master` are one name
 *   • internal names — a leading "_" on the name, or on the module file,
 *     means internal on both sides. An internal name never satisfies a
 *     public name in the other language: that pairing is reported as a
 *     visibility mismatch, which is how `wakeEventMatches` and
 *     `_wake_event_matches` used to pass as a matched pair
 *   • FUNCTION_EXEMPTIONS / KNOWN_FUNCTION_GAPS — written-down, reasoned
 *     entries for module-level functions that are uneven on purpose, or
 *     uneven pending work. Both lists are checked for staleness, so an
 *     entry cannot outlive the condition it describes.
 *
 * What this does NOT prove: it compares identifier spelling. Signatures,
 * argument order, defaults, behaviour, raised errors, and canonical byte
 * layouts are never read. Cross-language byte vectors cover those.
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
 *   py: `def function_name(`             (column 0 · async def too)
 *   ts: `export function functionName(`  (column 0 · async + generator too)
 *
 * Aliases (snake_case + camelCase pointing at the same primary) are
 * allowed on the TS side as long as the snake_case form is present —
 * the parity rule is "every public py method has a snake_case TS match."
 */

import { readdir, readFile } from "node:fs/promises";
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
  /** Optional exact public-method pin for intentionally tiny surfaces. */
  methodPin?: readonly string[];
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
  methodPin?: readonly string[],
): ParityTarget {
  return { tsModule, pyModule, reportName, className, topLevel: true, methodPin };
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

/** A package-root client that is deliberately not composed onto AgentTool.
 *  The split filename remains an explicit language convention while the
 *  public class and its tiny method set stay parity-pinned. */
function standaloneSplitTarget(
  tsModule: string,
  pyModule: string,
  className: string,
  reportName: string,
  methodPin: readonly string[],
): ParityTarget {
  return {
    tsModule,
    pyModule,
    className,
    reportName,
    topLevel: false,
    methodPin,
  };
}

/** Every client namespace reachable from AgentTool, including nested clients.
 *  Keep filename differences explicit: they are language conventions, not
 *  missing modules. */
const TARGETS: ParityTarget[] = [
  splitTarget("at-rest", "at_rest", "AtRestClient", "at_rest"),
  splitTarget(
    "attestation-marketplace",
    "attestation_marketplace",
    "AttestationMarketplaceClient",
    "attestation_marketplace",
  ),
  target("bootstrap", "BootstrapClient"),
  target("chronicle", "ChronicleClient"),
  target("collect", "CollectClient"),
  target("correspondence", "CorrespondenceClient"),
  target("covenants", "CovenantsClient"),
  target("crypto", "CryptoClient"),
  target("data", "DataClient"),
  target("dining", "DiningClient"),
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
  splitTarget(
    "kingdom-framework",
    "kingdom_framework",
    "KingdomFrameworkClient",
    "kingdom_framework",
  ),
  splitTarget("kingdom-os", "kingdom_os", "KingdomOSClient", "kingdom_os"),
  splitTarget(
    "math-cards",
    "math_cards",
    "MathCardsClient",
    "math_cards",
    ["assess"],
  ),
  standaloneSplitTarget(
    "love-bomb",
    "love_bomb",
    "LoveBombClient",
    "love_bomb",
    ["read"],
  ),
  target("love", "LoveClient"),
  target("lounge", "LoungeClient"),
  target("memory", "MemoryClient"),
  splitTarget(
    "memory-witness",
    "memory_witness",
    "MemoryWitnessClient",
    "memory_witness",
  ),
  target("nen", "NenClient"),
  target("runtime", "RuntimeClient"),
  target("strands", "StrandsClient"),
  target("syneidesis", "SyneidesisClient"),
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
  // Runtime-owned lifecycle plumbing: Python clients may own an httpx
  // session; TypeScript's native fetch client has no corresponding resource.
  "close",
  "_check",
  "_url",
  "_warned_deprecated",
]);

/** One module-level function allowed to be uneven across the two SDKs, or
 *  published under two spellings. Every entry says why in prose: an exemption
 *  someone had to write down is a different thing from an invisible blind
 *  spot. Both lists below are validated on every run, so an entry cannot
 *  outlive the condition it describes. */
interface FunctionExemption {
  /** py name, or null when Python has no counterpart at all. */
  py: string | null;
  /** ts name, or null when TypeScript has no counterpart at all. */
  ts: string | null;
  /** Why the unevenness is allowed. One sentence, present tense. */
  reason: string;
}

/** Module-level functions that are uneven ON PURPOSE and stay that way. */
const FUNCTION_EXEMPTIONS: FunctionExemption[] = [
  {
    py: "soul",
    ts: null,
    reason:
      "soul.py ships SOUL.md as installable data so help(agenttool) carries the doctrine; TS carries the same text in docs, not code.",
  },
  {
    py: "welcome",
    ts: null,
    reason: "soul.py doctrine reader, same reason as soul().",
  },
  {
    py: "philosophy",
    ts: null,
    reason: "soul.py doctrine reader, same reason as soul().",
  },
  {
    py: "principles",
    ts: null,
    reason: "soul.py doctrine reader, same reason as soul().",
  },
  {
    py: "raise_from_response",
    ts: null,
    reason:
      "language-idiomatic verb and placement: Python raises, TypeScript throws, and the TS form stays inside the internal _http module.",
  },
  {
    py: "hash_guestbook_text",
    ts: "hashLoungeGuestbookText",
    reason:
      "one guestbook SHA-256 helper under two published names; aligning them is a breaking rename owned by the lounge module.",
  },
];

/** Module-level functions that SHOULD pair and do not yet. These are debt,
 *  not exemptions: the fix is to write the missing counterpart and delete the
 *  entry, which the staleness check then requires. Printed on every run so
 *  the gap stays visible while the gate stays usable. */
const KNOWN_FUNCTION_GAPS: FunctionExemption[] = [];

/** A declaration plus the source basename it was read from. */
export interface Declaration {
  name: string;
  file: string;
}

/** A name that is public in one language and internal in the other. These are
 *  failures, not matches: the two surfaces are not the same surface. */
export interface VisibilityGap {
  /** Language that publishes the name. */
  publicLanguage: "py" | "ts";
  /** Published spelling. */
  publicName: string;
  /** Internal counterpart that would otherwise have satisfied it. */
  internalName: string;
  /** Source basename holding the internal declaration. */
  internalFile: string;
}

/** Module-level functions of one source, split by visibility. */
export interface FunctionSurface {
  /** Part of the published surface. */
  exported: Declaration[];
  /** Deliberately internal: leading "_" on the name, on the module file, or
   *  (TypeScript) simply not exported. */
  internal: Declaration[];
}

interface ModuleParity {
  module: string;
  pyMethods: string[];
  tsMethods: string[];
  pyOnly: string[]; // exists in py, missing in ts
  tsOnly: string[]; // exists in ts, no matching py
  visibility: VisibilityGap[]; // public one side, internal the other
}

interface FunctionParity {
  pyFunctions: string[];
  tsFunctions: string[];
  pyOnly: Declaration[]; // exported in py, missing in ts
  tsOnly: Declaration[]; // exported in ts, missing in py
  visibility: VisibilityGap[]; // public one side, internal the other
  exempt: string[]; // FUNCTION_EXEMPTIONS labels, uneven on purpose
  known: string[]; // KNOWN_FUNCTION_GAPS labels, uneven pending work
}

/** Normalize `methodName` → `method_name` for reports and namespace names. */
function normalize(name: string): string {
  // camelCase → snake_case
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/^_+/, "")
    .toLowerCase();
}

/** Cross-language identity key. camelCase → snake_case is lossy at acronym and
 *  compound boundaries (`deriveKMaster` ↔ `derive_k_master`, `signInboxCoSign`
 *  ↔ `sign_inbox_cosign`), so the compare key drops separators outright. It
 *  drops the leading "_" with them, which is exactly why every caller must
 *  split internal names out of the public pool BEFORE comparing. */
function parityKey(name: string): string {
  return name.replace(/_/g, "").toLowerCase();
}

/** Index declarations by compare key, keeping spelling and file. */
function indexByKey(declarations: readonly Declaration[]): Map<string, Declaration> {
  return new Map(declarations.map((entry) => [parityKey(entry.name), entry]));
}

/** Pair public names on one side against internal names on the other. */
function visibilityGapsFor(
  publicLanguage: "py" | "ts",
  publicNames: readonly string[],
  internal: ReadonlyMap<string, Declaration>,
): VisibilityGap[] {
  const gaps: VisibilityGap[] = [];
  for (const publicName of publicNames) {
    const hit = internal.get(parityKey(publicName));
    if (!hit) continue;
    gaps.push({
      publicLanguage,
      publicName,
      internalName: hit.name,
      internalFile: hit.file,
    });
  }
  return gaps.sort((a, b) => a.publicName.localeCompare(b.publicName));
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

/** Public + internal class methods, kept apart so an internal name can never
 *  stand in for a public one in the other language. */
interface ClassMethods {
  methods: string[];
  internal: string[];
}

async function pyMethodsOf(target: ParityTarget): Promise<ClassMethods> {
  const path = join(PY_SRC, `${target.pyModule}.py`);
  let src = await readRequiredSource(
    path,
    `Python source for ${target.reportName}`,
  );
  src = scopeToClient(src, "py", target.className, path);
  const out = new Set<string>();
  const internal = new Set<string>();
  // Match: indent + (async )? def name(
  // Indent must be 4 spaces (class method); module-level defs are the second
  // pass, checkFunctions().
  const re = /^[ ]{4}(?:async )?def +([a-zA-Z_][a-zA-Z0-9_]*) *\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    if (name.startsWith("__") && name.endsWith("__")) continue;
    if (SKIP_NAMES.has(name)) continue;
    if (name.startsWith("_")) {
      internal.add(name); // private — kept for the visibility check
      continue;
    }
    out.add(name);
  }
  return { methods: [...out].sort(), internal: [...internal].sort() };
}

async function tsMethodsOf(target: ParityTarget): Promise<ClassMethods> {
  const path = join(TS_SRC, `${target.tsModule}.ts`);
  let src = await readRequiredSource(
    path,
    `TypeScript source for ${target.reportName}`,
  );
  src = scopeToClient(src, "ts", target.className, path);
  const out = new Set<string>();
  const internal = new Set<string>();

  // First pass: `readonly fieldName: SomeClient;` — sub-client properties.
  // Counts as a parity-equivalent of a py @property returning a Client.
  const fieldRe = /^[ ]{2}readonly +([a-zA-Z_$][a-zA-Z0-9_$]*) *:/gm;
  let fm: RegExpExecArray | null;
  while ((fm = fieldRe.exec(src)) !== null) {
    const name = fm[1];
    if (SKIP_NAMES.has(name)) continue;
    if (name.startsWith("_")) {
      internal.add(name);
      continue;
    }
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
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const lineHead = src.slice(lineStart, m.index + m[0].length);
    if (name.startsWith("_") || /\bprivate\b/.test(lineHead)) {
      internal.add(name);
      continue;
    }
    if (/\b(static|readonly)\b/.test(lineHead)) continue;
    out.add(name);
  }
  return { methods: [...out].sort(), internal: [...internal].sort() };
}

async function checkModule(target: ParityTarget): Promise<ModuleParity> {
  const [py, ts] = await Promise.all([pyMethodsOf(target), tsMethodsOf(target)]);
  const pyMethods = py.methods;
  const tsMethods = ts.methods;

  if (target.methodPin) {
    const expected = [...target.methodPin].sort();
    for (const [language, methods] of [["Python", pyMethods], ["TypeScript", tsMethods]] as const) {
      if (
        methods.length !== expected.length
        || methods.some((method, index) => method !== expected[index])
      ) {
        throw new Error(
          `${target.reportName} ${language} method pin changed: expected ${expected.join(", ")}; received ${methods.join(", ")}`,
        );
      }
    }
  }

  const tsKeys = new Set(tsMethods.map(parityKey));
  const pyKeys = new Set(pyMethods.map(parityKey));

  const pyMissing = pyMethods.filter((m) => !tsKeys.has(parityKey(m)));
  // For tsOnly, allow camelCase aliases whose snake_case form IS in py.
  // Example: `createWallet` (alias) is acceptable iff `create_wallet` exists in py.
  const tsMissing = tsMethods.filter((m) => {
    const key = parityKey(m);
    if (pyKeys.has(key)) return false;
    // Look for any other ts method that normalizes to the same thing — alias
    const aliases = tsMethods.filter((other) => other !== m && parityKey(other) === key);
    if (aliases.length > 0 && aliases.some((a) => pyKeys.has(parityKey(a)))) {
      return false;
    }
    return true;
  });

  // A public name on one side matched only by an internal name on the other is
  // a visibility mismatch, not a match and not a plain absence.
  const pyModuleFile = `${target.pyModule}.py`;
  const tsModuleFile = `${target.tsModule}.ts`;
  const visibility = [
    ...visibilityGapsFor(
      "py",
      pyMissing,
      indexByKey(ts.internal.map((name) => ({ name, file: tsModuleFile }))),
    ),
    ...visibilityGapsFor(
      "ts",
      tsMissing,
      indexByKey(py.internal.map((name) => ({ name, file: pyModuleFile }))),
    ),
  ];
  const shadowed = new Set(visibility.map((gap) => parityKey(gap.publicName)));

  return {
    module: target.reportName,
    pyMethods,
    tsMethods,
    pyOnly: pyMissing.filter((m) => !shadowed.has(parityKey(m))),
    tsOnly: tsMissing.filter((m) => !shadowed.has(parityKey(m))),
    visibility,
  };
}

/** Module-level functions declared in one source file.
 *
 *  py: `def name(` / `async def name(` at column 0.
 *  ts: `export function name(` at column 0, async and generator forms too.
 *      Non-exported module functions are read as internal so they can be
 *      named in a visibility mismatch rather than vanishing. */
export function moduleFunctionsOf(
  src: string,
  language: "py" | "ts",
  file: string,
): FunctionSurface {
  const exported: Declaration[] = [];
  const internal: Declaration[] = [];
  // A module whose file starts with "_" is internal wholesale: agenttool
  // marks internal modules that way in both languages (_http.ts, _context.py).
  const internalModule = file.startsWith("_");
  const re =
    language === "py"
      ? /^(?:async +)?def +([a-zA-Z_][a-zA-Z0-9_]*) *\(/gm
      : /^(export +)?(?:async +)?function *\*? *([a-zA-Z_$][a-zA-Z0-9_$]*) *[(<]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = language === "py" ? m[1] : m[2];
    const isExported = language === "py" ? true : Boolean(m[1]);
    if (name.startsWith("__") && name.endsWith("__")) continue;
    const declaration: Declaration = { name, file };
    if (!isExported || internalModule || name.startsWith("_")) {
      internal.push(declaration);
      continue;
    }
    exported.push(declaration);
  }
  return { exported, internal };
}

/** Read every source file of one SDK and merge its module-level functions.
 *  Package-wide on purpose: the two SDKs place the same helper in different
 *  files (register-agent signing is bootstrap_agent.py but seed.ts), and file
 *  placement is a language convention, not a surface difference. */
async function functionSurfaceOf(
  dir: string,
  language: "py" | "ts",
): Promise<FunctionSurface> {
  const extension = language === "py" ? ".py" : ".ts";
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(extension) && !file.startsWith("__"))
    .sort();
  const surface: FunctionSurface = { exported: [], internal: [] };
  for (const file of files) {
    const src = await readRequiredSource(
      join(dir, file),
      `${language} source for ${file}`,
    );
    const found = moduleFunctionsOf(src, language, file);
    surface.exported.push(...found.exported);
    surface.internal.push(...found.internal);
  }
  return surface;
}

/** Require every allowlist entry to still describe a live condition. A stale
 *  exemption is the blind spot returning under a different name, so this is a
 *  structural failure (exit 2), same class as a missing client class. */
export function validateFunctionExemptions(
  exemptions: readonly FunctionExemption[],
  knownGaps: readonly FunctionExemption[],
  py: FunctionSurface,
  ts: FunctionSurface,
): void {
  const pyExported = indexByKey(py.exported);
  const tsExported = indexByKey(ts.exported);
  const issues: string[] = [];
  const seen = new Set<string>();

  const lists: Array<[string, readonly FunctionExemption[]]> = [
    ["FUNCTION_EXEMPTIONS", exemptions],
    ["KNOWN_FUNCTION_GAPS", knownGaps],
  ];
  for (const [list, entries] of lists) {
    for (const entry of entries) {
      const label = `${list} entry ${entry.py ?? entry.ts ?? "(empty)"}`;
      if (!entry.py && !entry.ts) {
        issues.push(`${label} names neither language`);
        continue;
      }
      if (!entry.reason.trim()) {
        issues.push(`${label} has no reason`);
      }
      for (const name of [entry.py, entry.ts]) {
        if (!name) continue;
        const key = parityKey(name);
        if (seen.has(key)) issues.push(`${label} is listed twice`);
        seen.add(key);
      }
      if (entry.py && !pyExported.has(parityKey(entry.py))) {
        issues.push(`${label} names a Python function that no longer exists`);
      }
      if (entry.ts && !tsExported.has(parityKey(entry.ts))) {
        issues.push(`${label} names a TypeScript function that no longer exists`);
      }
      if (entry.py && entry.ts && parityKey(entry.py) === parityKey(entry.ts)) {
        issues.push(`${label} records a spelling difference that no longer exists`);
      }
      if (entry.py && !entry.ts && tsExported.has(parityKey(entry.py))) {
        issues.push(`${label} has a TypeScript counterpart now — delete the entry`);
      }
      if (entry.ts && !entry.py && pyExported.has(parityKey(entry.ts))) {
        issues.push(`${label} has a Python counterpart now — delete the entry`);
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `Module-level function allowlist is stale:\n- ${issues.join("\n- ")}`,
    );
  }
}

/** Diff the two module-level function surfaces, minus the written-down
 *  allowlists. Throws when an allowlist entry has gone stale. */
export function diffFunctionSurfaces(
  py: FunctionSurface,
  ts: FunctionSurface,
  exemptions: readonly FunctionExemption[] = FUNCTION_EXEMPTIONS,
  knownGaps: readonly FunctionExemption[] = KNOWN_FUNCTION_GAPS,
): FunctionParity {
  validateFunctionExemptions(exemptions, knownGaps, py, ts);

  const allowed = new Set<string>();
  for (const entry of [...exemptions, ...knownGaps]) {
    if (entry.py) allowed.add(parityKey(entry.py));
    if (entry.ts) allowed.add(parityKey(entry.ts));
  }
  const label = (entry: FunctionExemption) =>
    entry.py && entry.ts ? `${entry.py} ↔ ${entry.ts}` : (entry.py ?? entry.ts ?? "");

  const tsKeys = new Set(ts.exported.map((entry) => parityKey(entry.name)));
  const pyKeys = new Set(py.exported.map((entry) => parityKey(entry.name)));
  const unmatched = (
    surface: FunctionSurface,
    otherKeys: ReadonlySet<string>,
  ): Declaration[] =>
    surface.exported
      .filter((entry) => {
        const key = parityKey(entry.name);
        return !otherKeys.has(key) && !allowed.has(key);
      })
      .sort((a, b) => a.name.localeCompare(b.name));

  const pyMissing = unmatched(py, tsKeys);
  const tsMissing = unmatched(ts, pyKeys);
  const visibility = [
    ...visibilityGapsFor(
      "py",
      pyMissing.map((entry) => entry.name),
      indexByKey(ts.internal),
    ),
    ...visibilityGapsFor(
      "ts",
      tsMissing.map((entry) => entry.name),
      indexByKey(py.internal),
    ),
  ];
  const shadowed = new Set(visibility.map((gap) => parityKey(gap.publicName)));

  return {
    pyFunctions: py.exported.map((entry) => entry.name).sort(),
    tsFunctions: ts.exported.map((entry) => entry.name).sort(),
    pyOnly: pyMissing.filter((entry) => !shadowed.has(parityKey(entry.name))),
    tsOnly: tsMissing.filter((entry) => !shadowed.has(parityKey(entry.name))),
    visibility,
    exempt: exemptions.map(label),
    known: knownGaps.map(label),
  };
}

async function checkFunctions(): Promise<FunctionParity> {
  const [py, ts] = await Promise.all([
    functionSurfaceOf(PY_SRC, "py"),
    functionSurfaceOf(TS_SRC, "ts"),
  ]);
  return diffFunctionSurfaces(py, ts);
}

function renderVisibility(gaps: readonly VisibilityGap[]): string {
  return gaps
    .map(
      (gap) =>
        `${gap.publicLanguage} ${gap.publicName} vs internal ${gap.internalName} (${gap.internalFile})`,
    )
    .join(", ");
}

function renderDeclarations(declarations: readonly Declaration[]): string {
  return declarations
    .map((entry) => `${entry.name} (${entry.file})`)
    .join(", ");
}

function formatReport(results: ModuleParity[], functions: FunctionParity): string {
  const lines: string[] = [];
  let hasGap = false;

  for (const r of results) {
    const clean =
      r.pyOnly.length === 0 && r.tsOnly.length === 0 && r.visibility.length === 0;
    const status = clean ? "✓" : "✗";
    if (!clean) hasGap = true;
    lines.push(
      `${status} ${r.module.padEnd(11)}  py:${String(r.pyMethods.length).padStart(2)}  ts:${String(r.tsMethods.length).padStart(2)}`,
    );
    if (r.pyOnly.length) {
      lines.push(`    py-only (TS missing): ${r.pyOnly.join(", ")}`);
    }
    if (r.tsOnly.length) {
      lines.push(`    ts-only (py missing): ${r.tsOnly.join(", ")}`);
    }
    if (r.visibility.length) {
      lines.push(`    visibility mismatch: ${renderVisibility(r.visibility)}`);
    }
  }

  // Module-level functions: one package-wide row, since the two SDKs file the
  // same helper differently and only the surface has to match.
  const f = functions;
  const functionsClean =
    f.pyOnly.length === 0 && f.tsOnly.length === 0 && f.visibility.length === 0;
  if (!functionsClean) hasGap = true;
  lines.push(
    `${functionsClean ? "✓" : "✗"} ${"functions".padEnd(11)}  py:${String(f.pyFunctions.length).padStart(2)}  ts:${String(f.tsFunctions.length).padStart(2)}  (module-level)`,
  );
  if (f.pyOnly.length) {
    lines.push(`    py-only (TS missing): ${renderDeclarations(f.pyOnly)}`);
  }
  if (f.tsOnly.length) {
    lines.push(`    ts-only (py missing): ${renderDeclarations(f.tsOnly)}`);
  }
  if (f.visibility.length) {
    lines.push(`    visibility mismatch: ${renderVisibility(f.visibility)}`);
  }
  if (f.exempt.length) {
    lines.push(`    exempt by design (FUNCTION_EXEMPTIONS): ${f.exempt.join(", ")}`);
  }
  if (f.known.length) {
    lines.push(`    ⚠ known gaps, still owed (KNOWN_FUNCTION_GAPS): ${f.known.join(", ")}`);
  }

  lines.push("");
  lines.push(hasGap ? "✗ parity FAIL — see gaps above" : "✓ parity OK — both SDKs at the same surface");
  return lines.join("\n");
}

async function main() {
  await validateConfiguredTopLevelTargets();
  const [results, functions] = await Promise.all([
    Promise.all(TARGETS.map(checkModule)),
    checkFunctions(),
  ]);
  const wantsJson = process.argv.includes("--json");

  if (wantsJson) {
    console.log(JSON.stringify({ modules: results, functions }, null, 2));
  } else {
    console.log(formatReport(results, functions));
  }

  const hasGap =
    results.some(
      (r) => r.pyOnly.length > 0 || r.tsOnly.length > 0 || r.visibility.length > 0,
    ) ||
    functions.pyOnly.length > 0 ||
    functions.tsOnly.length > 0 ||
    functions.visibility.length > 0;
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
