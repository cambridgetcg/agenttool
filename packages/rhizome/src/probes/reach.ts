/** rhizome/probes/reach — exports nothing can invoke.
 *
 *  A dead export is inert mass with the shape of a feature. Two worked
 *  examples from this repository, both of which read as shipped and were
 *  not:
 *
 *    `strand-thought/v2`         correct, vectored, dual-accepted by the
 *                                server, and unreachable: `ThoughtsClient
 *                                .add()` had no `version` parameter, so no
 *                                real thought could ever carry the
 *                                unambiguous framing.
 *    `identityAuthorityHeaders`  exported, and structurally unusable: the
 *                                client re-serialised the body internally,
 *                                so a caller could never sign the bytes
 *                                that would be transmitted.
 *
 *  Neither is a test failure. Both are *reachability* failures, and a test
 *  suite cannot see them because the test is the caller — the one caller,
 *  and the one that never has to route through the public surface.
 *
 *  So this probe never asks "is this symbol correct?". It asks: **from
 *  where, other than its own test, can this be invoked?** Four answers
 *  matter, and the middle two are not defects:
 *
 *    reachable   some non-test code path leads here. Nothing to say.
 *    public      it is on a package's published surface and a document
 *                tells a reader to call it. The caller is outside this
 *                repository, which is the point of publishing it.
 *    latent      staged on purpose, with the cutover written down and
 *                ordered. `docs/STRANDS.md` does exactly this for the v2
 *                thought framing and it is correct. Reported `sound`,
 *                because flagging staged work as rot teaches people to
 *                delete the staging.
 *    unreachable nothing outside its own definition and its own test can
 *                get here, and nothing says that is on purpose. The bug.
 *
 *  Every corpus this probe uses comes from `Scope`. The route inventory is
 *  built by resolving the Hono mount graph out of the tree — no directory
 *  list, no route list, no SDK list. Which packages count as clients is
 *  derived from which packages actually contain request paths.
 */

import { clip, commentAbove, literalUnions } from "../source.js";
import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";

const ID = "reach";

/** Extensions this probe reads as executable source.
 *
 *  This is a real boundary and it is declared as a limit: a client written
 *  in a language not listed here is invisible, so a route it calls would be
 *  reported as having no client. It is not a *scope* — nothing here names a
 *  directory — but it is an enumeration, so it is stated rather than
 *  inlined at four different call sites. */
const CODE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".py"];

/** Extensions read as prose. A document is how a public symbol becomes
 *  reachable to a caller who is not in this repository, so doc mentions are
 *  evidence, not noise. */
const PROSE_EXTENSIONS: readonly string[] = [".md", ".mdx", ".txt", ".rst"];

/** HTTP methods this probe understands, lower-case as Hono spells them. */
const METHODS: readonly string[] = ["get", "post", "put", "patch", "delete", "options", "head"];

/** Identifiers too short or too common to reference-count without drowning
 *  the reader in coincidence. A two-character export name matches inside a
 *  hundred unrelated words; the miss is stated rather than silent. */
const MIN_SYMBOL_LENGTH = 4;

const LIMITS: readonly ProbeLimit[] = [
  {
    statement:
      "reachability is computed from identifier text, not from a resolved module graph, so a symbol reached through a dynamic import, a string-keyed dispatch table, or a name rebuilt by concatenation reads as unreachable",
    why: "resolving the real graph means executing or type-checking repository source, and rhizome never runs what it reads; the false positives this produces are visible in the evidence, which quotes every line that mentions the symbol",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
  {
    statement:
      "executable source is .ts/.tsx/.js/.py and their variants, plus an extensionless file whose shebang names bun, node, deno, tsx, ts-node or python; a client in another language, or behind an interpreter not in that line, is counted as absent and its routes reported as having no client",
    why: "the two SDKs, the API and the CLIs in this tree are all one of those; adding a language means adding its call syntax, and an unverified syntax guess would produce findings nobody can check. The shebang half was not in the first version of this limit and is the reason it is worded this way: `bin/agenttool-rotate` is TypeScript with no extension, and reading extension as language reported the one route it calls as having no client anywhere",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 151,
  },
  {
    statement:
      "a request path assembled from variables — a base constant plus a suffix, or a path returned by a helper — is not recognised as a client call, so a route reached only that way is reported as uncovered",
    why: "following the value of a variable across files is the module graph again; paths written as literals or template literals are the form both SDKs use, and the exception is stated here rather than absorbed silently",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
  {
    statement:
      "the HTTP method of a client call is read from the nearest verb token before the path literal, so a call whose method is chosen at run time is treated as covering every method on that path",
    why: "the conservative direction: an unknown method counts as coverage, so this probe under-reports missing methods rather than inventing them",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
  {
    statement:
      "the union-member check only sees a member passed as `field: \"member\"` or `field=\"member\"`; a member passed positionally, spread from an object, or reconstructed from a variable is not seen as produced",
    why: "the field name is derived from the declarations typed by the union, which is checkable; a positional argument has no name to derive, so recognising it would mean guessing at arity",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
  {
    statement:
      "an exported symbol shorter than four characters is not reference-counted at all",
    why: "a short identifier matches inside unrelated words often enough that the finding would be a coincidence wearing evidence; the bound is published so a two-letter dead export is a known miss",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 68,
  },
];

// ── shared text facts ────────────────────────────────────────────────────
//
// These are syntax facts about filenames, not scopes: nothing below names a
// directory. `probes/edge.ts` carries its own copy of `isTestPath` and
// `extensionOf`; both belong in `src/source.ts`, and this file cannot put
// them there without editing a module three sibling agents are also in.

function isTestPath(file: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|e2e|examples?)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)test_[^/]+\.py$/.test(file) ||
    /_test\.py$/.test(file) ||
    /(^|\/)conftest\.py$/.test(file)
  );
}

function extensionOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/** Interpreters that mean "the rest of this file is a language this probe
 *  reads". Matched against the file's own first line, so the fact comes
 *  out of the file rather than out of a list of filenames.
 *
 *  This exists because the first integrated run reported `PATCH
 *  /v1/strands/:strandId/thoughts/:thoughtId/ciphertext` as having no
 *  client anywhere, and it has one: `bin/agenttool-rotate`, 18KB of
 *  TypeScript behind `#!/usr/bin/env bun` and no `.ts`. The declared limit
 *  said "a client written in another language is invisible"; the real miss
 *  was another *spelling* of a language already read — an enumeration with
 *  a boundary it could not see from inside, in the probe whose job is to
 *  find those. Reported by hand-verification against the finding, and
 *  fixed rather than filtered. */
const SHEBANG_INTERPRETERS = /^#!.*\b(?:bun|node|deno|tsx|ts-node|python[\d.]*)\b/;

function isCode(scope: Scope, file: string): boolean {
  const extension = extensionOf(file);
  if (CODE_EXTENSIONS.includes(extension)) return true;
  if (extension !== "") return false;
  return SHEBANG_INTERPRETERS.test(scope.lines(file)[0] ?? "");
}

function isProse(file: string): boolean {
  return PROSE_EXTENSIONS.includes(extensionOf(file));
}

function isGenerated(file: string): boolean {
  // A built artefact is a copy of source, not a caller of it. Counting
  // `dist/index.js` as a reference would make every source symbol look
  // reachable from its own build output.
  return /(^|\/)(dist|build|out|__pycache__|node_modules|\.venv|vendor)\//.test(file);
}

/** Directory of `file`, or `""`. */
function dirOf(file: string): string {
  const at = file.lastIndexOf("/");
  return at === -1 ? "" : file.slice(0, at);
}

/** Normalise `a/b/../c` and `./` against a base directory. */
function joinRelative(base: string, specifier: string): string {
  const parts = (base === "" ? [] : base.split("/")).concat(specifier.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// ── which package owns a file ────────────────────────────────────────────

/** Nearest ancestor directory holding a manifest, derived from the corpus.
 *
 *  Same derivation the member-set check in `probes/edge.ts` uses, for the
 *  same reason: the set of packages is on disk, so nothing here needs a
 *  list of them. A file under no manifest is attributed to its top-level
 *  directory, which is what `bin/` and `api/` are. */
function packageOwnership(scope: Scope): (file: string) => string {
  const manifests = new Set<string>();
  for (const file of scope.files) {
    const base = file.slice(file.lastIndexOf("/") + 1);
    if (base !== "package.json" && base !== "pyproject.toml") continue;
    const directory = dirOf(file);
    if (directory === "" || directory.includes("node_modules")) continue;
    manifests.add(directory);
  }
  return (file: string): string => {
    let best = "";
    for (const directory of manifests) {
      if (file.startsWith(`${directory}/`) && directory.length > best.length) best = directory;
    }
    if (best !== "") return best;
    const top = file.includes("/") ? file.slice(0, file.indexOf("/")) : file;
    return top;
  };
}

// ── the route inventory, resolved out of the mount graph ─────────────────

interface Endpoint {
  method: string;
  /** Path relative to the router binding that declares it. */
  local: string;
  file: string;
  line: number;
}

/** One Hono app *binding*, not one file.
 *
 *  A file can hold several. `api/src/routes/economy/crypto.ts` declares both
 *  the economy router and `export const cryptoWebhookRouter = new Hono()`,
 *  and `api/src/index.ts` mounts them at different prefixes — one under
 *  `/v1`, one under `/v1/billing/crypto-webhook`. Modelling a router as a
 *  file collapses those two into one and hangs twenty-four wallet routes off
 *  the webhook prefix, which is a route inventory that reads as authoritative
 *  and is wrong. The unit is the binding. */
interface RouterUnit {
  key: string;
  file: string;
  variable: string;
  endpoints: Endpoint[];
  mounts: Array<{ prefix: string; target: string | null; line: number }>;
}

interface ImportBinding {
  file: string;
  /** The name the child module exports it under; `"default"` for a default import. */
  original: string;
}

function unitKey(file: string, variable: string): string {
  return `${file}#${variable}`;
}

interface FileFacts {
  file: string;
  apps: Set<string>;
  imports: Map<string, ImportBinding>;
  /** `export default app` → `app`. */
  defaultExport: string | null;
  /** exported name → specifier it is re-exported from, for `export { x } from "./y"`. */
  reexports: Map<string, { original: string; specifier: string }>;
  /** `export const attestationListingsRouter = listingsRouter` — an alias of
   *  an app binding declared in the same file. Without this the alias
   *  resolves to nothing, the mount is unresolved, and both routers in
   *  `api/src/routes/attestation-marketplace.ts` are reported as unmounted
   *  while `api/src/index.ts:884` plainly mounts them. */
  aliases: Map<string, string>;
}

function readFileFacts(scope: Scope, file: string): FileFacts | null {
  const text = scope.read(file);
  if (text === null || !text.includes("Hono")) return null;

  const apps = new Set<string>();
  for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*new\s+Hono\b/g)) {
    apps.add(match[1]!);
  }

  const imports = new Map<string, ImportBinding>();
  for (const match of text.matchAll(
    /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g,
  )) {
    const specifier = match[3]!;
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveSpecifier(scope, dirOf(file), specifier);
    if (resolved === null) continue;
    if (match[1] !== undefined) imports.set(match[1], { file: resolved, original: "default" });
    for (const entry of (match[2] ?? "").split(",")) {
      const parts = entry.split(/\s+as\s+/);
      const original = (parts[0] ?? "").trim().replace(/^type\s+/, "");
      const local = (parts[parts.length - 1] ?? "").trim();
      if (original !== "" && local !== "") imports.set(local, { file: resolved, original });
    }
  }

  const defaultExport = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(text)?.[1] ?? null;

  const reexports = new Map<string, { original: string; specifier: string }>();
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const entry of match[1]!.split(",")) {
      const parts = entry.split(/\s+as\s+/);
      const original = (parts[0] ?? "").trim().replace(/^type\s+/, "");
      const exposed = (parts[parts.length - 1] ?? "").trim();
      if (original !== "" && exposed !== "") reexports.set(exposed, { original, specifier: match[2]! });
    }
  }

  const aliases = new Map<string, string>();
  for (const match of text.matchAll(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*([A-Za-z_$][\w$]*)\s*;/g)) {
    if (apps.has(match[2]!) && !apps.has(match[1]!)) aliases.set(match[1]!, match[2]!);
  }

  return { file, apps, imports, defaultExport, reexports, aliases };
}

/** Every Hono app binding in the tree, found by the framework's own
 *  constructor rather than by looking in a routes directory. */
function collectRouterUnits(scope: Scope): Map<string, RouterUnit> {
  const facts = new Map<string, FileFacts>();
  for (const file of scope.files) {
    if (!isCode(scope, file) || isGenerated(file) || isTestPath(file)) continue;
    const read = readFileFacts(scope, file);
    if (read !== null && read.apps.size > 0) facts.set(file, read);
  }

  /** Which binding does exported name `name` of module `file` refer to? */
  const resolveExport = (file: string, name: string, depth: number): string | null => {
    if (depth > 6) return null;
    const fact = facts.get(file) ?? readFileFacts(scope, file);
    if (fact === null) return null;
    if (name === "default") {
      if (fact.defaultExport !== null && fact.apps.has(fact.defaultExport)) return unitKey(file, fact.defaultExport);
      if (fact.defaultExport !== null && fact.aliases.has(fact.defaultExport)) {
        return unitKey(file, fact.aliases.get(fact.defaultExport)!);
      }
      if (fact.apps.size === 1) return unitKey(file, [...fact.apps][0]!);
      return null;
    }
    if (fact.apps.has(name)) return unitKey(file, name);
    if (fact.aliases.has(name)) return unitKey(file, fact.aliases.get(name)!);
    const reexport = fact.reexports.get(name);
    if (reexport !== undefined) {
      const child = resolveSpecifier(scope, dirOf(file), reexport.specifier);
      if (child !== null) return resolveExport(child, reexport.original, depth + 1);
    }
    // A factory — `export function makeRouter()` returning a Hono app. The
    // binding cannot be named, so fall back to the module's one app if it
    // has exactly one, and give up rather than guess if it has several.
    if (fact.apps.size === 1) return unitKey(file, [...fact.apps][0]!);
    return null;
  };

  const units = new Map<string, RouterUnit>();
  for (const fact of facts.values()) {
    const lines = scope.lines(fact.file);
    for (const variable of fact.apps) {
      units.set(unitKey(fact.file, variable), {
        key: unitKey(fact.file, variable),
        file: fact.file,
        variable,
        endpoints: [],
        mounts: [],
      });
    }
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      for (const match of line.matchAll(
        /([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|options|head)\(\s*["'`]([^"'`]*)["'`]/g,
      )) {
        const unit = units.get(unitKey(fact.file, match[1]!));
        if (unit === undefined) continue;
        unit.endpoints.push({ method: match[2]!, local: match[3]!, file: fact.file, line: i + 1 });
      }
      for (const match of line.matchAll(/([A-Za-z_$][\w$]*)\.on\(\s*\[([^\]]*)\]\s*,\s*["'`]([^"'`]*)["'`]/g)) {
        const unit = units.get(unitKey(fact.file, match[1]!));
        if (unit === undefined) continue;
        for (const raw of match[2]!.split(",")) {
          const method = raw.replace(/["'`\s]/g, "").toLowerCase();
          if (METHODS.includes(method)) unit.endpoints.push({ method, local: match[3]!, file: fact.file, line: i + 1 });
        }
      }
      for (const match of line.matchAll(/([A-Za-z_$][\w$]*)\.route\(\s*["'`]([^"'`]*)["'`]\s*,\s*([A-Za-z_$][\w$]*)/g)) {
        const unit = units.get(unitKey(fact.file, match[1]!));
        if (unit === undefined) continue;
        const identifier = match[3]!;
        let target: string | null = null;
        if (fact.apps.has(identifier) && identifier !== match[1]) {
          target = unitKey(fact.file, identifier);
        } else if (fact.aliases.has(identifier)) {
          target = unitKey(fact.file, fact.aliases.get(identifier)!);
        } else {
          const binding = fact.imports.get(identifier);
          if (binding !== undefined) target = resolveExport(binding.file, binding.original, 0);
        }
        unit.mounts.push({ prefix: match[2]!, target, line: i + 1 });
      }
    }
  }
  return units;
}

function resolveSpecifier(scope: Scope, base: string, specifier: string): string | null {
  const stem = joinRelative(base, specifier.replace(/\.js$/, ""));
  const candidates = [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`, `${stem}.js`, stem];
  const known = new Set(scope.files);
  for (const candidate of candidates) if (known.has(candidate)) return candidate;
  return null;
}

function joinPath(prefix: string, local: string): string {
  const combined = `${prefix}/${local}`.replace(/\/{2,}/g, "/");
  const trimmed = combined.length > 1 ? combined.replace(/\/$/, "") : combined;
  return trimmed === "" ? "/" : trimmed;
}

/** Path segments with parameter names erased: `/v1/memories/:id` and
 *  `/v1/memories/:memory_id` are the same URL shape and must match. */
function shapeOf(path: string): string {
  return path
    .split("?")[0]!
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return ":";
      if (segment === "*" || segment.startsWith("*")) return "*";
      return segment;
    })
    .join("/");
}

interface Route {
  method: string;
  path: string;
  shape: string;
  file: string;
  line: number;
}

interface RouteInventory {
  routes: Route[];
  /** Router bindings nothing mounts, that carry routes of their own. */
  orphans: RouterUnit[];
  /** Router bindings that are roots of a mount forest. */
  roots: string[];
  /** Mounts whose target binding could not be resolved: rhizome's own miss,
   *  published rather than absorbed as "this router has no children". */
  unresolvedMounts: Array<{ file: string; line: number; prefix: string }>;
}

function buildRouteInventory(scope: Scope): RouteInventory {
  const units = collectRouterUnits(scope);
  const mounted = new Set<string>();
  const unresolvedMounts: Array<{ file: string; line: number; prefix: string }> = [];
  for (const unit of units.values()) {
    for (const mount of unit.mounts) {
      if (mount.target === null) unresolvedMounts.push({ file: unit.file, line: mount.line, prefix: mount.prefix });
      else mounted.add(mount.target);
    }
  }

  const roots = [...units.values()]
    .filter((unit) => !mounted.has(unit.key) && unit.mounts.length > 0)
    .map((unit) => unit.key);

  // Every absolute prefix a binding is reachable at, walking down from the
  // roots. A router mounted twice legitimately has two prefixes.
  const prefixes = new Map<string, Set<string>>();
  const descend = (key: string, prefix: string, seen: ReadonlySet<string>): void => {
    const set = prefixes.get(key) ?? new Set<string>();
    if (set.has(prefix)) return;
    set.add(prefix);
    prefixes.set(key, set);
    const unit = units.get(key);
    if (unit === undefined || seen.has(key)) return;
    const next = new Set(seen).add(key);
    for (const mount of unit.mounts) {
      if (mount.target !== null) descend(mount.target, joinPath(prefix, mount.prefix), next);
    }
  };
  for (const root of roots) descend(root, "", new Set());

  const routes: Route[] = [];
  for (const unit of units.values()) {
    const reachableAt = prefixes.get(unit.key);
    if (reachableAt === undefined) continue;
    for (const endpoint of unit.endpoints) {
      for (const prefix of reachableAt) {
        const path = joinPath(prefix, endpoint.local);
        routes.push({ method: endpoint.method, path, shape: shapeOf(path), file: endpoint.file, line: endpoint.line });
      }
    }
  }

  const orphans = [...units.values()].filter((unit) => !prefixes.has(unit.key) && unit.endpoints.length > 0);

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { routes, orphans, roots, unresolvedMounts };
}

// ── the client inventory ─────────────────────────────────────────────────

interface ClientCall {
  /** URL shape, parameters erased. */
  shape: string;
  /** Lower-case method, or `"*"` when the nearest verb token is absent. */
  method: string;
  file: string;
  line: number;
  owner: string;
  text: string;
}

const VERB_TOKEN =
  /\.(get|post|put|patch|delete|options|head)\s*\(|["'`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)["'`]/gi;

/** Every path literal in the file, with `${…}` and `{…}` interpolations
 *  collapsed to a parameter segment.
 *
 *  A literal whose interpolation sits mid-segment — `` `/v1/memories${qs}` ``
 *  — yields two shapes: the parameter reading and the truncation at the last
 *  `/`. Emitting both is the conservative direction; the alternative invents
 *  a segment the transport never sends. */
const HOLE = "\u0001";

function pathShapes(raw: string): string[] {
  const path = raw.split("?")[0]!;
  let collapsed = path
    .replace(/\$\{[^{}]*\}/g, HOLE)
    .replace(/(?<!\$)\{[^{}]*\}/g, HOLE)
    .replace(/%[sd]/g, HOLE);
  // `f"{self._base}/v1/unconditionals"` — half of `packages/sdk-py` writes
  // the base URL into the literal. Dropping a leading interpolation is not
  // a guess: everything before the first `/` is one hole, which is what a
  // base URL is. Without this those clients are invisible and their routes
  // read as uncovered, which is a false gap in the loudest possible place.
  const firstSlash = collapsed.indexOf("/");
  if (firstSlash > 0 && collapsed.slice(0, firstSlash).split("").every((character) => character === HOLE)) {
    collapsed = collapsed.slice(firstSlash);
  }
  if (!collapsed.startsWith("/")) return [];

  const shape = (value: string): string =>
    value
      .split("/")
      .map((segment) => (segment.includes(HOLE) ? ":" : segment))
      .join("/");

  const out = new Set<string>([shape(collapsed)]);
  const firstHole = collapsed.indexOf(HOLE);
  if (firstHole > 0 && collapsed[firstHole - 1] !== "/") {
    const cut = collapsed.lastIndexOf("/", firstHole);
    if (cut > 0) out.add(shape(collapsed.slice(0, cut)));
  }
  return [...out]
    .map((value) => (value.length > 1 ? value.replace(/\/$/, "") : value))
    .filter((value) => value.startsWith("/") && !value.includes(HOLE));
}

/** String and template literals in `text`, with their offsets. */
function literalSpans(text: string): Array<{ value: string; index: number }> {
  const out: Array<{ value: string; index: number }> = [];
  for (const match of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value !== undefined) out.push({ value, index: match.index });
  }
  return out;
}

function collectClientCalls(scope: Scope, inventory: RouteInventory, ownerOf: (file: string) => string): ClientCall[] {
  // Which first segments a request path can start with is derived from the
  // routes themselves, so a new top-level mount is picked up without an
  // edit here.
  const heads = new Set<string>();
  for (const route of inventory.routes) {
    const head = route.path.split("/")[1];
    if (head !== undefined && head !== "" && !head.startsWith(":")) heads.add(head);
  }
  if (heads.size === 0) return [];

  const routerFiles = new Set(inventory.routes.map((route) => route.file));
  const calls: ClientCall[] = [];
  for (const file of scope.files) {
    // A test that asserts a URL string is not a client method. Counting
    // `packages/sdk-ts/tests/authority.test.ts` as a caller of
    // `/v1/love/consent` makes the whole `/v1/love` domain look claimed by
    // both SDKs when neither has a single method on it — the exact
    // "the test is the only caller" confusion this probe exists to name.
    if (!isCode(scope, file) || isGenerated(file) || isTestPath(file) || routerFiles.has(file)) continue;
    const text = scope.read(file);
    if (text === null) continue;
    let anyHead = false;
    for (const head of heads) {
      if (text.includes(`/${head}/`) || text.includes(`/${head}"`) || text.includes(`/${head}\``)) {
        anyHead = true;
        break;
      }
    }
    if (!anyHead) continue;

    const offsets = lineOffsets(text);
    for (const span of literalSpans(text)) {
      const head = span.value.split("/")[1];
      if (head === undefined || !heads.has(head)) continue;
      const shapes = pathShapes(span.value);
      if (shapes.length === 0) continue;
      // A path inside a comment is documentation, not a call. Without this
      // the probe's own header comment quoting `/v1/mcp` would register
      // rhizome as a client of the API it is reading.
      const openingLine = (scope.lines(file)[lineAt(offsets, span.index) - 1] ?? "").trim();
      if (/^(\*|\/\/|\/\*|#|--)/.test(openingLine)) continue;

      // Nearest verb token before the literal. Conservative: no token means
      // the call covers every method rather than none.
      const window = text.slice(Math.max(0, span.index - 400), span.index);
      let method = "*";
      for (const match of window.matchAll(VERB_TOKEN)) {
        method = (match[1] ?? match[2] ?? "*").toLowerCase();
      }
      const line = lineAt(offsets, span.index);
      for (const shape of shapes) {
        calls.push({
          shape,
          method,
          file,
          line,
          owner: ownerOf(file),
          text: (scope.lines(file)[line - 1] ?? "").trim(),
        });
      }
    }
  }
  return calls;
}

function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") offsets.push(i + 1);
  return offsets;
}

function lineAt(offsets: readonly number[], index: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid]! <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Check 1: routes with no client method anywhere, in domains a client
 *  already claims.
 *
 *  Two-sided on purpose. A route in a domain no client touches is a scope
 *  decision — the SDK never claimed `/v1/mcp`, and reporting every such
 *  route would be forty findings of volume. A route in a domain a client
 *  *does* cover is different: the client claims the domain, a reader
 *  reasonably assumes the domain is covered, and the missing operation
 *  produces no error anywhere. It produces nothing at all, which reads the
 *  same as not existing. */
function checkRouteCoverage(scope: Scope, inventory: RouteInventory, ownerOf: (file: string) => string): Finding[] {
  const calls = collectClientCalls(scope, inventory, ownerOf);
  if (inventory.routes.length === 0) return [];

  const byShape = new Map<string, ClientCall[]>();
  for (const call of calls) byShape.set(call.shape, [...(byShape.get(call.shape) ?? []), call]);

  // A package referring to its own routes is not a client of them. The
  // guided-error bodies in `api/` name the next route an agent should call,
  // which is a pointer rather than a call site, and counting it would let
  // the server vouch for its own reachability.
  const external = (route: Route): ClientCall[] =>
    (byShape.get(route.shape) ?? []).filter((call) => call.owner !== ownerOf(route.file));
  const covering = (route: Route): ClientCall[] =>
    external(route).filter((call) => call.method === "*" || call.method === route.method);
  const pathTouched = (route: Route): ClientCall[] => external(route);

  const domainOf = (path: string): string => {
    const parts = path.split("/").filter((part) => part !== "");
    return `/${parts.slice(0, 2).join("/")}`;
  };

  const domains = new Map<string, Route[]>();
  for (const route of inventory.routes) {
    const key = domainOf(route.path);
    domains.set(key, [...(domains.get(key) ?? []), route]);
  }

  const findings: Finding[] = [];
  const unclaimed: Array<{ domain: string; routes: number }> = [];
  let coveredDomains = 0;

  for (const [domain, routes] of [...domains].sort((a, b) => a[0].localeCompare(b[0]))) {
    const owners = new Set<string>();
    for (const route of routes) for (const call of covering(route)) owners.add(call.owner);
    if (owners.size === 0) {
      unclaimed.push({ domain, routes: routes.length });
      continue;
    }

    const uncovered = routes.filter((route) => covering(route).length === 0);
    if (uncovered.length === 0) {
      coveredDomains += 1;
      continue;
    }

    const lines: string[] = [];
    for (const route of uncovered.slice(0, 12)) {
      const touched = pathTouched(route);
      const note =
        touched.length > 0
          ? `path is reached, this method is not — ${touched[0]!.file}:${touched[0]!.line} sends ${touched[0]!.method.toUpperCase()}`
          : "no client anywhere sends this path";
      lines.push(`${route.method.toUpperCase()} ${route.path}\n    declared ${route.file}:${route.line}\n    ${note}`);
    }
    if (uncovered.length > 12) lines.push(`… and ${uncovered.length - 12} more in this domain`);

    findings.push({
      probe: ID,
      title: `${domain} has clients, and ${uncovered.length} of its ${routes.length} route(s) have none`,
      file: uncovered[0]!.file,
      line: uncovered[0]!.line,
      verdict: "gap",
      evidence: lines.join("\n"),
      detail:
        `${[...owners].sort().join(", ")} already call into ${domain}, so the domain is claimed: a reader who reaches for it has no reason to expect a hole. ` +
        "Nothing fails when an operation has no client — it produces no output at all, which reads the same as the operation not existing. " +
        "The route set is resolved from the Hono mount graph and the client set from the request paths in the tree; neither is a list in this file.",
    });
  }

  // Domains no client touches at all, as one line rather than forty.
  if (unclaimed.length > 0) {
    const total = unclaimed.reduce((sum, entry) => sum + entry.routes, 0);
    findings.push({
      probe: ID,
      title: `${unclaimed.length} route domain(s) have no client in this repository, and no client claims them`,
      file: "api",
      line: 0,
      verdict: "sound",
      evidence: unclaimed
        .slice(0, 40)
        .map((entry) => `${entry.domain}  (${entry.routes} route(s))`)
        .join("\n") + (unclaimed.length > 40 ? `\n… and ${unclaimed.length - 40} more` : ""),
      detail:
        `${total} routes across ${unclaimed.length} domains. These are not partial coverage: no client method anywhere in the tree touches these prefixes, so a missing operation is a scope decision rather than a hole in a surface someone is using. ` +
        "Recorded so nobody re-derives this list, and so the contrast with the partially-covered domains above is legible. Whether any of these *should* have a client is a product question, not a soil one.",
    });
  }

  if (coveredDomains > 0) {
    findings.push({
      probe: ID,
      title: `${coveredDomains} route domain(s) are covered end to end`,
      file: "api",
      line: 0,
      verdict: "sound",
      evidence: `${inventory.routes.length} routes resolved from ${inventory.roots.length} mount root(s); every route in ${coveredDomains} domains has a client method with a matching HTTP verb`,
      detail:
        "The route inventory is built by resolving `app.route(prefix, child)` edges from the roots down, so a route reachable at two prefixes is counted at both and a router nothing mounts contributes no routes.",
    });
  }

  return findings;
}

/** Check 2: router bindings nothing mounts.
 *
 *  The binding is unreachable at any URL. Every handler on it type-checks and
 *  a test that imports the router object directly passes; the routes are
 *  simply not on the app. This is the route-level form of a dead export. */
function checkOrphanRouters(scope: Scope, inventory: RouteInventory): Finding[] {
  const findings: Finding[] = [];
  for (const unit of inventory.orphans) {
    const sample = unit.endpoints
      .slice(0, 6)
      .map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.local}  (${endpoint.file}:${endpoint.line})`);
    findings.push({
      probe: ID,
      title: `${unit.file} declares ${unit.endpoints.length} route(s) on \`${unit.variable}\` and nothing mounts it`,
      file: unit.file,
      line: unit.endpoints[0]?.line ?? 0,
      verdict: "gap",
      evidence:
        sample.join("\n") +
        (unit.endpoints.length > 6 ? `\n… and ${unit.endpoints.length - 6} more` : "") +
        "\n\nno app.route(prefix, …) in the corpus resolves to this binding; " +
        `${inventory.roots.length} mount root(s) were walked and this binding was not reached from any of them`,
      detail:
        "The routes exist, compile and can be unit-tested against the router object directly, and no URL reaches them. Mounting is resolved per *binding* rather than per file, so a second router exported from a file that is itself mounted still shows up here.",
    });
  }

  if (inventory.unresolvedMounts.length > 0) {
    findings.push({
      probe: ID,
      title: `${inventory.unresolvedMounts.length} mount(s) point at a router this probe could not resolve`,
      file: inventory.unresolvedMounts[0]!.file,
      line: inventory.unresolvedMounts[0]!.line,
      verdict: "limit",
      evidence: inventory.unresolvedMounts
        .slice(0, 10)
        .map((mount) => `${mount.file}:${mount.line}  app.route(${JSON.stringify(mount.prefix)}, …)`)
        .join("\n") + (inventory.unresolvedMounts.length > 10 ? `\n… and ${inventory.unresolvedMounts.length - 10} more` : ""),
      detail:
        "Routes below these mounts are absent from the inventory, so any statement above of the form 'no client sends this path' does not cover them. Published rather than absorbed: an unresolved edge silently shrinks a route inventory, and a shorter inventory reads as better coverage.",
    });
  }
  return findings;
}

// ── the symbol index ─────────────────────────────────────────────────────

interface ExportedSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  /** `true` for values (function/class/const/def), `false` for types. */
  isValue: boolean;
}

function collectExports(scope: Scope): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  for (const file of scope.files) {
    if (!isCode(scope, file) || isGenerated(file) || isTestPath(file)) continue;
    const lines = scope.lines(file);
    const python = extensionOf(file) === ".py";
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (python) {
        const match = /^(?:async\s+)?(def|class)\s+([A-Za-z][\w]*)/.exec(line);
        if (match === null) continue;
        if (match[2]!.startsWith("_")) continue;
        out.push({ name: match[2]!, kind: match[1]!, file, line: i + 1, isValue: true });
        continue;
      }
      const match =
        /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|const|let|var|interface|type|enum)\s+\*?\s*([A-Za-z_$][\w$]*)/.exec(
          line,
        );
      if (match === null) continue;
      const kind = match[1]!;
      out.push({
        name: match[2]!,
        kind,
        file,
        line: i + 1,
        isValue: kind !== "interface" && kind !== "type",
      });
    }
  }
  return out;
}

/** name → file → lines mentioning it. One tokenising pass over the corpus,
 *  restricted to names that are actually exported somewhere, so the index
 *  stays proportional to the question rather than to the tree. */
function buildIndex(scope: Scope, names: ReadonlySet<string>): Map<string, Map<string, number[]>> {
  const index = new Map<string, Map<string, number[]>>();
  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null) continue;
    const offsets = lineOffsets(text);
    for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const token = match[0];
      if (!names.has(token)) continue;
      const byFile = index.get(token) ?? new Map<string, number[]>();
      const lines = byFile.get(file) ?? [];
      if (lines.length < 24) lines.push(lineAt(offsets, match.index));
      byFile.set(file, lines);
      index.set(token, byFile);
    }
  }
  return index;
}

/** The published surface of each package, followed out of its manifest.
 *
 *  `package.json` points at `dist/index.js`, which is a build artefact and
 *  usually not in the corpus, so the `outDir`/`rootDir` pair in the
 *  package's own `tsconfig.json` is used to map it back to source. That
 *  mapping is read from the tree, not assumed. */
function publicSurface(scope: Scope): { names: Set<string>; entries: Set<string> } {
  const names = new Set<string>();
  const entries = new Set<string>();
  const known = new Set(scope.files);

  for (const file of scope.files) {
    const base = file.slice(file.lastIndexOf("/") + 1);
    const directory = dirOf(file);
    if (directory.includes("node_modules")) continue;

    if (base === "package.json") {
      const text = scope.read(file);
      if (text === null) continue;
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(text) as Record<string, unknown>;
      } catch {
        continue;
      }
      const declared = new Set<string>();
      for (const key of ["main", "module", "types"]) {
        const value = manifest[key];
        if (typeof value === "string") declared.add(value);
      }
      const walkExports = (node: unknown): void => {
        if (typeof node === "string") declared.add(node);
        else if (node !== null && typeof node === "object") for (const value of Object.values(node)) walkExports(value);
      };
      walkExports(manifest.exports);
      const binValue = manifest.bin;
      walkExports(binValue);

      // dist/x.js → src/x.ts, using this package's own tsconfig.
      let outDir = "dist";
      let rootDir = "src";
      const tsconfig = scope.read(`${directory}/tsconfig.json`);
      if (tsconfig !== null) {
        outDir = /"outDir"\s*:\s*"([^"]+)"/.exec(tsconfig)?.[1]?.replace(/^\.\//, "").replace(/\/$/, "") ?? outDir;
        rootDir = /"rootDir"\s*:\s*"([^"]+)"/.exec(tsconfig)?.[1]?.replace(/^\.\//, "").replace(/\/$/, "") ?? rootDir;
      }
      for (const entry of declared) {
        const relative = entry.replace(/^\.\//, "");
        const sourceish = relative.startsWith(`${outDir}/`)
          ? `${rootDir}/${relative.slice(outDir.length + 1)}`
          : relative;
        for (const candidate of [sourceish.replace(/\.js$/, ".ts"), sourceish.replace(/\.js$/, ".tsx"), sourceish]) {
          const resolved = `${directory}/${candidate}`;
          if (known.has(resolved)) entries.add(resolved);
        }
      }
    }

    if (base === "pyproject.toml") {
      // The package's own `__init__.py` is its published surface.
      for (const candidate of scope.files) {
        if (!candidate.startsWith(`${directory}/`)) continue;
        if (!candidate.endsWith("/__init__.py")) continue;
        if (candidate.split("/").length - directory.split("/").length > 3) continue;
        entries.add(candidate);
      }
    }
  }

  // Follow `export … from` / `export *` / python re-import chains.
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = scope.read(file);
    if (text === null) return;
    const python = extensionOf(file) === ".py";
    if (python) {
      for (const match of text.matchAll(/^from\s+(\.[.\w]*)\s+import\s+\(?([^)\n]*)\)?/gm)) {
        for (const raw of match[2]!.split(",")) {
          const name = raw.split(/\s+as\s+/).pop()?.trim() ?? "";
          if (/^[A-Za-z][\w]*$/.test(name)) names.add(name);
        }
      }
      for (const match of text.matchAll(/^\s*["']([A-Za-z][\w]*)["'],?\s*$/gm)) names.add(match[1]!);
      return;
    }
    for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      for (const raw of match[1]!.split(",")) {
        const name = raw.split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, "") ?? "";
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
    for (const match of text.matchAll(/export\s+\*\s*(?:as\s+[\w$]+\s*)?from\s*["']([^"']+)["']/g)) {
      const child = resolveSpecifier(scope, dirOf(file), match[1]!);
      if (child !== null) visit(child);
    }
    // `export { x }` of something declared in this same entry file.
    for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*;/g)) {
      for (const raw of match[1]!.split(",")) {
        const name = raw.split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, "") ?? "";
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
    for (const match of text.matchAll(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+\*?\s*([A-Za-z_$][\w$]*)/gm)) {
      names.add(match[1]!);
    }
  };
  for (const entry of entries) visit(entry);

  return { names, entries };
}

interface Reference {
  file: string;
  line: number;
  text: string;
  kind: "wiring" | "test" | "prose" | "code";
}

/** How a file mentioning a symbol mentions it.
 *
 *  A file whose *only* mentions are import or re-export lines is wiring: it
 *  passes the name along without ever invoking it. That distinction is the
 *  whole check — `identityAuthorityHeaders` was re-exported by the SDK
 *  barrel and called by nothing but its test, and a plain reference count
 *  reported it as used twice. */
/** Does this line only pass a name along?
 *
 *  `export { createCollabRouter }` is wiring. `export default
 *  createCollabRouter()` is a call, and treating the two the same reports a
 *  router factory that the module's own default export invokes as reachable
 *  only from its test. */
function isWiringLine(text: string): boolean {
  if (/^\s*import\b/.test(text)) return true;
  if (/^\s*from\s+[.\w]+\s+import\b/.test(text)) return true;
  if (/^\s*export\s*(\{|\*|type\s*\{)/.test(text)) return true;
  if (/^\s*export\s+.*\bfrom\s+["']/.test(text)) return true;
  // A bare `name,` line: the middle of a multi-line import or export list.
  return /^\s*["']?[A-Za-z_$][\w$]*["']?,?\s*$/.test(text);
}

function isCommentLine(text: string): boolean {
  return /^(\*|\/\/|\/\*|#|--|"""|''')/.test(text.trim());
}

function classify(scope: Scope, file: string, name: string, lines: readonly number[]): Reference[] {
  const source = scope.lines(file);
  const out: Reference[] = [];
  const prose = isProse(file);
  const test = isTestPath(file);
  const seen = new Set<number>();
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    const text = (source[line - 1] ?? "").trim();
    let kind: Reference["kind"];
    if (prose) kind = "prose";
    else if (isWiringLine(text)) kind = "wiring";
    else if (test) kind = "test";
    else kind = "code";
    out.push({ file, line, text, kind });
  }
  return out;
}

/** Checks 3 and 4: dead exports, and exports only a test can reach. */
function checkSymbolReach(scope: Scope): Finding[] {
  const exported = collectExports(scope);
  const names = new Set(exported.filter((symbol) => symbol.name.length >= MIN_SYMBOL_LENGTH).map((symbol) => symbol.name));
  if (names.size === 0) return [];

  const index = buildIndex(scope, names);
  const surface = publicSurface(scope);
  const ownerOf = packageOwnership(scope);

  // A name exported from more than one file cannot be attributed, so its
  // references are not evidence about either declaration.
  const declarationCount = new Map<string, number>();
  for (const symbol of exported) declarationCount.set(symbol.name, (declarationCount.get(symbol.name) ?? 0) + 1);

  const deadByFile = new Map<string, ExportedSymbol[]>();
  const testOnly: Array<{ symbol: ExportedSymbol; references: Reference[]; documented: Reference[] }> = [];
  const publicUndocumented: ExportedSymbol[] = [];

  for (const symbol of exported) {
    if (symbol.name.length < MIN_SYMBOL_LENGTH) continue;
    if ((declarationCount.get(symbol.name) ?? 0) > 1) continue;
    if (surface.entries.has(symbol.file)) continue; // the barrel itself

    const byFile = index.get(symbol.name) ?? new Map<string, number[]>();
    const references: Reference[] = [];
    for (const [file, lines] of byFile) {
      if (file === symbol.file) continue;
      if (isGenerated(file)) continue;
      references.push(...classify(scope, file, symbol.name, lines));
    }
    const code = references.filter((reference) => reference.kind === "code");
    const tests = references.filter((reference) => reference.kind === "test");
    const prose = references.filter((reference) => reference.kind === "prose");
    const isPublic = surface.names.has(symbol.name);

    // Does the declaring module itself use the symbol? `TOKEN_COST_HEADER`
    // is exported and set on every response by the middleware three lines
    // below it, and its only *external* mention is the test. Reporting that
    // as unreachable would be false: what is unused there is the `export`
    // keyword, not the symbol. A mention inside a comment is not a use.
    const ownLines = byFile.get(symbol.file) ?? [];
    const ownSource = scope.lines(symbol.file);
    const selfUsed = ownLines.some((line) => {
      if (line === symbol.line) return false;
      const text = (ownSource[line - 1] ?? "").trim();
      return !isCommentLine(text) && !isWiringLine(text);
    });

    if (code.length === 0 && tests.length === 0) {
      if (selfUsed) continue; // internal machinery whose export is redundant
      if (isPublic && prose.length > 0) continue; // published and documented: the caller is a reader
      if (isPublic) {
        if (symbol.isValue) publicUndocumented.push(symbol);
        continue;
      }
      deadByFile.set(symbol.file, [...(deadByFile.get(symbol.file) ?? []), symbol]);
      continue;
    }

    if (code.length === 0 && tests.length > 0 && symbol.isValue && !selfUsed) {
      if (isPublic && prose.length > 0) continue;
      testOnly.push({ symbol, references: [...tests, ...references.filter((reference) => reference.kind === "wiring")], documented: prose });
    }
  }

  const findings: Finding[] = [];

  for (const [file, symbols] of [...deadByFile].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
    findings.push({
      probe: ID,
      title: `${file} exports ${symbols.length} symbol(s) nothing in the tree mentions`,
      file,
      line: symbols[0]!.line,
      verdict: "gap",
      evidence: symbols
        .slice(0, 10)
        .map((symbol) => `${symbol.kind} ${symbol.name}  ${symbol.file}:${symbol.line}`)
        .join("\n") + (symbols.length > 10 ? `\n… and ${symbols.length - 10} more in this file` : ""),
      detail:
        `Exported, not on ${ownerOf(file)}'s published surface, and mentioned by no other file in the corpus — not by code, not by a test, not by a document. ` +
        "Inert mass with the shape of a feature: it type-checks, it is covered by nothing, and removing it would change no behaviour. Reference counting is textual, so a symbol reached by a dynamic dispatch table would land here wrongly; the evidence names the symbol so that is one grep to settle.",
    });
  }

  for (const entry of testOnly.slice(0, 30)) {
    const { symbol } = entry;
    const wiring = entry.references.filter((reference) => reference.kind === "wiring");
    const tests = entry.references.filter((reference) => reference.kind === "test");

    // A seam a module opens for its tests *on purpose* and says so is a
    // different object from a feature nothing can call. The distinction is
    // read out of the source — the symbol's own name or the comment above
    // it — rather than from a list of blessed names in this file.
    const comment = commentAbove(scope.lines(symbol.file), symbol.line - 1);
    const declaredSeam = /test/i.test(symbol.name) || /\btest(s|ing|ed)?\b/i.test(comment);
    if (declaredSeam) {
      findings.push({
        probe: ID,
        title: `${symbol.name} is a declared test seam, not a stranded export`,
        file: symbol.file,
        line: symbol.line,
        verdict: "sound",
        evidence:
          `${symbol.kind} ${symbol.name}  ${symbol.file}:${symbol.line}\n` +
          (comment === "" ? "" : `${clip(comment, 240)}\n`) +
          `only caller: ${tests[0]?.file ?? "—"}:${tests[0]?.line ?? 0}`,
        detail:
          "Reachable only from a test, and that is the stated intent: the name or the comment above the declaration says so. Recorded so the next reader does not spend an afternoon deciding whether it is rot.",
      });
      continue;
    }

    findings.push({
      probe: ID,
      title: `${symbol.name} is reachable only from its own test`,
      file: symbol.file,
      line: symbol.line,
      verdict: "gap",
      evidence:
        [`${symbol.kind} ${symbol.name}  ${symbol.file}:${symbol.line}`, "", "every mention outside its own file:"]
          .concat(
            [...tests, ...wiring]
              .slice(0, 8)
              .map((reference) => `${reference.kind.padEnd(7)} ${reference.file}:${reference.line}  ${clip(reference.text, 110)}`),
          )
          .join("\n"),
      detail:
        (surface.names.has(symbol.name)
          ? "On the package's published surface, so an external caller could reach it — but no document in this repository names it, so nothing tells a reader it is there. "
          : "Not on the package's published surface, so no external caller can reach it either. ") +
        "The test is the only caller, and the test does not have to route through the public path a real caller would. This is the shape `identityAuthorityHeaders` had: exported, re-exported, proved correct by a vector test, and structurally unusable from the client that needed it.",
    });
  }

  if (publicUndocumented.length > 0) {
    const byPackage = new Map<string, ExportedSymbol[]>();
    for (const symbol of publicUndocumented) {
      const owner = ownerOf(symbol.file);
      byPackage.set(owner, [...(byPackage.get(owner) ?? []), symbol]);
    }
    const ranked = [...byPackage].sort((a, b) => b[1].length - a[1].length);
    findings.push({
      probe: ID,
      title: `${publicUndocumented.length} published function(s)/class(es)/constant(s) across ${ranked.length} package(s) have no caller and no document`,
      file: ranked[0]![1][0]!.file,
      line: ranked[0]![1][0]!.line,
      verdict: "gap",
      evidence: ranked
        .map(([owner, symbols]) =>
          `${owner}  ${symbols.length}\n` +
          symbols
            .slice(0, 3)
            .map((symbol) => `    ${symbol.kind} ${symbol.name}  ${symbol.file}:${symbol.line}`)
            .join("\n"),
        )
        .join("\n"),
      detail:
        "Each is re-exported from its package's entry point, so an external caller *could* invoke it — and nothing in this repository calls it, tests it, or writes it down. For a published symbol the reachability path is a document: a reader who is not told the symbol exists cannot call it, and the compiler will never say so. " +
        "Types are excluded here on purpose — a published type with no internal reference is normal, a published function with none is a feature nobody can find. One finding rather than one per symbol: the count is the shape, and the per-package split is where to look.",
    });
  }

  return findings;
}

// ── the version-selector check ───────────────────────────────────────────

/** Does `candidate` import `target`, by any relative specifier that resolves
 *  to it? Textual and one-hop, which is all module *locality* needs. */
function importsModule(scope: Scope, candidate: string, target: string): boolean {
  const text = scope.read(candidate);
  if (text === null) return false;
  const base = dirOf(candidate);
  for (const match of text.matchAll(/(?:from|import|require\()\s*["']([.][^"']*)["']/g)) {
    if (resolveSpecifier(scope, base, match[1]!) === target) return true;
  }
  return false;
}

/** Check 5: a union member no non-test code ever produces.
 *
 *  `type ThoughtCanonicalVersion = "v1" | "v2"` with a `version` field that
 *  no client sets is the exact `strand-thought/v2` failure: the value is
 *  implemented, vectored, accepted by the server, and no caller can select
 *  it. The union is only interesting when some *other* member is produced —
 *  a union nothing uses is a dead export, which is the check above.
 *
 *  The three-way reading matters here more than anywhere. A staged member
 *  whose cutover is written down is `latent` and correct; the same member
 *  with nothing written down is `unreachable-but-shipped`. The difference
 *  is a document, and a document is checkable. */
function checkVersionSelectors(scope: Scope): Finding[] {
  const findings: Finding[] = [];
  const codeFiles = scope.files.filter((file) => isCode(scope, file) && !isGenerated(file));
  const proseFiles = scope.files.filter((file) => isProse(file) && !isGenerated(file));

  // Python carries its prose inside the module, in triple-quoted blocks, and
  // `packages/sdk-py/src/agenttool/strands.py:29` writes ``version="v2"``
  // inside one. Read as code that is a caller selecting v2 — which is the
  // opposite of what the sentence says, since it is telling the reader to
  // opt in. A line-prefix comment test cannot see this; the block needs
  // state, so it gets state.
  const docstrings = new Map<string, Set<number>>();
  const inDocstring = (file: string, line: number): boolean => {
    if (!file.endsWith(".py")) return false;
    let known = docstrings.get(file);
    if (known === undefined) {
      known = new Set<number>();
      let open: string | null = null;
      const fileLines = scope.lines(file);
      for (let i = 0; i < fileLines.length; i += 1) {
        const text = fileLines[i] ?? "";
        if (open !== null) {
          known.add(i + 1);
          if (text.includes(open)) open = null;
          continue;
        }
        for (const quote of ['"""', "'''"]) {
          const at = text.indexOf(quote);
          if (at === -1) continue;
          if (!text.slice(at + 3).includes(quote)) {
            open = quote;
            known.add(i + 1);
          }
          break;
        }
      }
      docstrings.set(file, known);
    }
    return known.has(line);
  };

  for (const file of codeFiles) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const lines = scope.lines(file);
    for (const union of literalUnions(lines)) {
      if (!union.exported) continue;
      if (union.members.length < 2 || union.members.length > 8) continue;
      // Members have to be identifier-shaped to be searched for as literals.
      // An emoji union (`LaughReaction = "😏" | "🙄"`) cannot be word-bounded,
      // so the search would be a coincidence rather than a check.
      if (!union.members.every((member) => /^[A-Za-z][\w.:/-]{1,}$/.test(member))) continue;

      // Fields and parameters declared with this type, derived from the
      // tree. Without a field name there is nothing to look for, so the
      // union is skipped rather than guessed at.
      const fields = new Set<string>();
      for (const candidate of codeFiles) {
        const text = scope.read(candidate);
        if (text === null || !text.includes(union.name)) continue;
        for (const match of text.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\??\\s*:\\s*${union.name}\\b`, "g"))) {
          fields.add(match[1]!);
        }
      }
      if (fields.size === 0) continue;

      // A file *produces* a member when it writes the member as a quoted
      // literal and also deals with this type — it names the union or one of
      // the fields carrying it.
      //
      // Deliberately generous in the direction of "this is reachable". An
      // earlier, stricter rule wanted `field: "member"` on one line and
      // declared half the status enums in the tree unreachable, because real
      // code writes `status: ruling === "refund" ? … : …` and passes values
      // through variables. A check that produces forty false claims of
      // unreachability is worse than one that misses a real one: the reader
      // stops believing the column.
      const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const memberPattern = (member: string): RegExp => new RegExp(`["'\`]${escape(member)}["'\`]`);
      // A line that *compares against* the member is a consumer, not a
      // producer. `if (version === "v2")` proves the value is understood; it
      // does not prove any caller can ever hand it in. That is exactly the
      // `strand-thought/v2` situation — the framing was implemented and
      // branched on, and no surface let a caller choose it.
      const comparison = (member: string): RegExp =>
        new RegExp(`([!=]==?|case)\\s*["'\`]${escape(member)}["'\`]|["'\`]${escape(member)}["'\`]\\s*[!=]==?`);
      const producersOf = (member: string): Array<{ file: string; line: number; text: string }> => {
        const out: Array<{ file: string; line: number; text: string }> = [];
        const pattern = memberPattern(member);
        const compare = comparison(member);
        const carriers = [...fields].map((field) => new RegExp(`\\b${escape(field)}\\b`));
        for (const candidate of codeFiles) {
          const text = scope.read(candidate);
          if (text === null || !pattern.test(text)) continue;
          // Module locality. `version` is a generic field name, and
          // `api/src/routes/scriptwriter-decides.ts:544` writes `version:
          // "v2"` for an entirely different version field. A file only
          // counts as producing this union's member if it names the union or
          // imports the module that declares it.
          if (candidate !== file && !text.includes(union.name) && !importsModule(scope, candidate, file)) continue;
          const keyedByUnion =
            new RegExp(`Record\\s*<\\s*${escape(union.name)}\\b`).test(text) ||
            new RegExp(`in\\s+${escape(union.name)}\\b`).test(text);
          const candidateLines = scope.lines(candidate);
          for (let i = 0; i < candidateLines.length; i += 1) {
            const line = candidateLines[i] ?? "";
            if (candidate === file && i + 1 === union.line) continue;
            // Another module's copy of the same union declaration is a type,
            // not a value anybody set.
            if (/^\s*(export\s+)?type\s+[A-Za-z_$][\w$]*\s*=/.test(line)) continue;
            if (/\bLiteral\s*\[/.test(line)) continue; // the same union, spelled in Python
            if (!pattern.test(line) || isCommentLine(line) || compare.test(line)) continue;
            if (inDocstring(candidate, i + 1)) continue;
            // The member has to be the *whole* literal. `{ hint: 'Use "v1"
            // (default) or "v2".' }` mentions "v2" inside an error message;
            // reading that as a caller selecting v2 is how a check quietly
            // stops finding anything.
            if (!literalSpans(line).some((span) => span.value === member)) continue;
            // The literal has to be near something that carries this type.
            // `"v2"` written next to `protocol_version` in covenants.ts is a
            // different `"v2"`; without this the check would find a producer
            // for every short member somewhere in a 2,800-file tree, and
            // report nothing ever.
            //
            // The exception is a table keyed by the union — `Record<
            // X402Network, AssetDefinition>` at `api/src/middleware/x402.ts
            // :252`, whose members are object keys twenty lines below the
            // only mention of the type. There the whole literal is the
            // union, so every key in the file is a write of it.
            if (!keyedByUnion) {
              const window = candidateLines.slice(Math.max(0, i - 2), i + 1).join("\n");
              if (!window.includes(union.name) && !carriers.some((carrier) => carrier.test(window))) continue;
            }
            out.push({ file: candidate, line: i + 1, text: line.trim() });
            break;
          }
        }
        return out;
      };

      const live = union.members.filter((member) =>
        producersOf(member).some((producer) => !isTestPath(producer.file)),
      );
      const unwritten = union.members.filter((member) => !live.includes(member));
      if (live.length === 0) continue; // the whole union is unused: a dead export, not a dead selector
      if (unwritten.length === 0) continue;

      // The signal is *asymmetry*. When most of a union is written by real
      // code and one or two members are not, the odd ones out are worth
      // looking at. When most of it is never written here — `RuntimeProvider
      // = "openai" | "anthropic" | "ollama" | "gemini" | …`, a vocabulary the
      // caller supplies — the union is an input alphabet and this check has
      // nothing to say about it. Derived from the union's own shape rather
      // than from a threshold someone picked.
      if (unwritten.length > live.length) continue;

      // Is the staging written down?
      //
      // The bar has to be a document that tells a reader *how to set this
      // value*, not one that happens to contain the letters. `"starting"`
      // and `"pending"` are ordinary English words, and even a quoted match
      // is weak: `docs/CROSS-INSTANCE-COVENANTS.md:168` writes
      // `protocol_version: 'v2'` about a different type entirely, and a
      // proximity rule that accepted the word "version" nearby would have
      // certified it as the strand-thought cutover note.
      //
      // So the document must write the member *as the value of a field this
      // union is carried on* — `mode: "slow"`, `version: "v2"` — or name the
      // union type beside it. Both are checkable, and both are what an
      // ordered cutover note actually looks like.
      const documentationFor = (member: string): string[] => {
        const assignment = [...fields].map(
          (field) => new RegExp(`\\b${escape(field)}\\b\\s*[:=]\\s*["'\`]${escape(member)}["'\`]`),
        );
        const named = new RegExp(`${escape(union.name)}[\\s\\S]{0,200}?["'\`]${escape(member)}["'\`]`);
        const out: string[] = [];
        for (const document of proseFiles) {
          const text = scope.read(document);
          if (text === null) continue;
          if (!assignment.some((pattern) => pattern.test(text)) && !named.test(text)) continue;
          const documentLines = scope.lines(document);
          for (let at = 0; at < documentLines.length; at += 1) {
            const documentLine = documentLines[at] ?? "";
            if (!assignment.some((pattern) => pattern.test(documentLine)) && !documentLine.includes(union.name)) continue;
            out.push(`${document}:${at + 1}  ${clip(documentLine.trim(), 120)}`);
            break;
          }
          if (out.length >= 3) break;
        }
        return out;
      };

      const declaration =
        `type ${union.name} = ${union.members.map((value) => `"${value}"`).join(" | ")}\n` +
        `carried by field(s): ${[...fields].sort().join(", ")}\n` +
        `written by non-test code: ${live.map((value) => `"${value}"`).join(", ")}\n`;

      const mentions = (member: string): string => {
        const producers = producersOf(member);
        return (
          `\n"${member}" is written by:\n` +
          (producers.length === 0
            ? "  nothing in the corpus\n"
            : `${producers
                .slice(0, 4)
                .map(
                  (producer) =>
                    `  ${isTestPath(producer.file) ? "test" : "code"}  ${producer.file}:${producer.line}  ${clip(producer.text, 100)}`,
                )
                .join("\n")}\n`)
        );
      };

      const staged = unwritten.filter((member) => documentationFor(member).length > 0);
      const stranded = unwritten.filter((member) => !staged.includes(member));

      if (staged.length > 0) {
        findings.push({
          probe: ID,
          title: `${union.name}: ${staged.map((member) => `"${member}"`).join(", ")} ${staged.length === 1 ? "is" : "are"} staged, not stranded`,
          file,
          line: union.line,
          verdict: "sound",
          evidence:
            declaration +
            staged.map(mentions).join("") +
            `\nwritten down at:\n${staged.flatMap((member) => documentationFor(member)).slice(0, 4).join("\n")}`,
          detail:
            "No non-test caller writes these members, which is the same signature as an unreachable one — and here it is deliberate, with a document that tells a reader how to set the value and in what order the cutover happens. Recorded as sound so the next reader does not delete staged work as rot. The verdict flips to a gap the day the document stops saying it.",
        });
      }

      if (stranded.length > 0) {
        findings.push({
          probe: ID,
          title: `${union.name} admits ${stranded.map((member) => `"${member}"`).join(", ")} and nothing writes ${stranded.length === 1 ? "it" : "them"}`,
          file,
          line: union.line,
          verdict: "gap",
          evidence: declaration + stranded.map(mentions).join(""),
          detail:
            `Most of this union is written by real code — ${live.map((value) => `"${value}"`).join(", ")} — and ${stranded.length === 1 ? "this member is" : "these members are"} not. ` +
            "Two readings, and the evidence above is what distinguishes them. Either the surface that would let a caller choose the value does not exist or does not forward it — the `strand-thought/v2` shape, where the framing was implemented, vectored, branched on, and unreachable from every client — or the value arrives from outside this repository (a database column, a request body, a peer's document) and the code only ever compares against it, in which case this is fine and is worth recording rather than re-deriving. " +
            "No document in the tree writes it as the value of one of these fields or beside the type name, so it is not staged work either.",
        });
      }
    }
  }
  return findings;
}

export const reachProbe: Probe = {
  id: ID,
  title: "reach — exports nothing can invoke",
  question: "Is every public symbol and every route actually reachable from a real caller, or only from its own test?",
  limits: LIMITS,
  run(scope: Scope): Finding[] {
    const ownerOf = packageOwnership(scope);
    const inventory = buildRouteInventory(scope);
    return [
      ...checkRouteCoverage(scope, inventory, ownerOf),
      ...checkOrphanRouters(scope, inventory),
      ...checkSymbolReach(scope),
      ...checkVersionSelectors(scope),
    ];
  },
};
