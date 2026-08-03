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
 *                ordered, *and the seam the document names still exists*.
 *                `docs/STRANDS.md` does this for the v2 thought framing
 *                and it is correct. Reported `sound`, because flagging
 *                staged work as rot teaches people to delete the staging.
 *    unreachable nothing outside its own definition and its own test can
 *                get here, and nothing says that is on purpose. The bug.
 *
 *  ── why this file is a resolver and not a set of patterns ────────────
 *
 *  The first version of this probe answered all of that from identifier
 *  text. It could not detect its own motivating bug: deleting `version`
 *  from `ThoughtsAddOpts` and from `ThoughtsClient.add()` — the exact
 *  defect the probe exists for — changed its JSON output by zero bytes.
 *  It also read a twenty-one-line `REMOVED:` comment block as twenty-one
 *  live route mounts, and published eleven `limit`s that were eleven
 *  comment lines, 11/11 false.
 *
 *  A name is not a binding and a comment is not code. So:
 *
 *    routes    read out of the parsed program and resolved through the
 *              checker, and — behind `RHIZOME_EXECUTE=1` — reconciled
 *              against the router's own `app.routes` by importing the
 *              app's entry module. See `reach/routes.ts`.
 *    selectors a carrier/flow/call graph over resolved symbols, so
 *              "can a caller select this value?" is answered by
 *              following the value, not by finding the word. See
 *              `reach/selectors.ts`.
 *    symbols   text-indexed across every language in the tree, and every
 *              "nothing references this" claim about a TypeScript symbol
 *              is confirmed against the program before it is published.
 *
 *  Every corpus this probe uses still comes from `Scope`. Which projects
 *  exist, which packages hold routers, which packages count as clients —
 *  all derived, none listed.
 */

import { clip, commentAbove, literalUnions } from "../source.js";
import {
  CODE_EXTENSIONS,
  dirOf,
  extensionOf,
  isGenerated,
  isProse,
  isTestPath,
  joinRelative,
  SHEBANG_INTERPRETERS,
} from "./reach/paths.js";
import {
  buildRouteInventory,
  EXECUTE_ENV,
  reconcile,
  type Route,
  type RouteInventory,
} from "./reach/routes.js";
import { readSelectors, type SelectorCandidate, type UnionReading } from "./reach/selectors.js";
import { TsProjects } from "./reach/ts-project.js";
import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";

const ID = "reach";

/** Identifiers too short or too common to reference-count without
 *  drowning the reader in coincidence. A two-character export name
 *  matches inside a hundred unrelated words; the miss is stated rather
 *  than silent. */
const MIN_SYMBOL_LENGTH = 4;

/** Every limit below anchors at line 0 — the module as a whole — on
 *  purpose. A limit that points at a line number is a second thing to
 *  keep true, and the previous version of this probe published eleven
 *  limits that were false. Each statement names the constant or the
 *  function it is about, which does not drift when a line moves. */
const LIMITS: readonly ProbeLimit[] = [
  {
    statement:
      "the route inventory is resolved from the mount graph without running the server: a mount whose target is chosen at run time, a route added by a handler while serving, or a router reached through a value this analysis cannot follow, is absent from it. Setting RHIZOME_EXECUTE=1 imports the app's own entry module in a subprocess and reconciles the two inventories, publishing every route present in one and not the other; without it, that delta is unmeasured in this run",
    why: "importing an API entry module executes its module-level initialisation, which in this repository opens database and cache clients — real egress, which rhizome does not perform unless it is told to. The flag is the same shape as `pretend`'s RHIZOME_MUTATE, and the report says which mode ran either way",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
  {
    statement:
      "reachability of a *symbol* is counted from identifier text across every language in the tree, so a symbol reached only through a dynamic import, a string-keyed dispatch table or a name rebuilt by concatenation reads as unreferenced; that reading is put to a resolved program before publication only for a TypeScript symbol whose package holds a tsconfig.json beside its package.json, and for Python, SQL, shell and any TypeScript outside such a package it is not",
    why: "the tree carries more than one language, and a probe that only understands one is a probe with an unstated extension boundary — the thing being hunted. The text index is the multi-language half and the compiler is the confirming half, so a TypeScript false positive inside a project is withdrawn (and the withdrawals are counted in the report), while one outside a project is still possible and is stated here",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
  {
    statement:
      "executable source is .ts/.tsx/.js/.py and their variants, plus an extensionless file whose shebang names bun, node, deno, tsx, ts-node or python; a client in another language, or behind an interpreter not in that line, is counted as absent and its routes reported as having no client",
    why: "the two SDKs, the API and the CLIs in this tree are all one of those; adding a language means adding its call syntax, and an unverified syntax guess would produce findings nobody can check. The shebang half was not in the first version of this limit and is the reason it is worded this way: `bin/agenttool-rotate` is TypeScript with no extension, and reading extension as language reported the one route it calls as having no client anywhere",
    file: "packages/rhizome/src/probes/reach/paths.ts",
    line: 0,
  },
  {
    statement:
      "a request path assembled from variables — a base constant plus a suffix, or a path returned by a helper — is not recognised as a client call, so a route reached only that way is reported as uncovered",
    why: "following the value of a variable across files is a resolved module graph, and the client half of this probe spans languages the TypeScript compiler cannot read; paths written as literals or template literals are the form both SDKs use, and the exception is stated rather than absorbed",
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
      "the value-selector analysis runs only inside a TypeScript project — a directory holding both tsconfig.json and package.json — and only over the files that project compiles; a union declared outside one, or in Python, is not analysed and is counted in the `limit` finding this probe emits for exactly that",
    why: "answering 'can a caller select this value?' needs resolved symbols, and resolved symbols need a program. The count of unanalysed unions is published in the report rather than left as a shorter run",
    file: "packages/rhizome/src/probes/reach/selectors.ts",
    line: 0,
  },
  {
    statement:
      "a function counts as reaching the network when a value inside it has one of the platform's own network types — Response, Request, RequestInit, WebSocket, EventSource, XMLHttpRequest, each required to resolve to a declaration file — or when it calls something that does; a transport built on a type outside that line reads as pure, and a member selectable only through it would be reported unreachable",
    why: "'this operation can put the value on the wire' has to be decided from the type system rather than from a list of function names, and the platform's network types are the only names in the analysis that come from outside the tree. The direction of the miss is a false gap, not a false soundness, and the evidence names the operations so it is one read to settle",
    file: "packages/rhizome/src/probes/reach/selectors.ts",
    line: 0,
  },
  {
    statement:
      "the union-member analysis follows a value through assignments, object-literal properties and call arguments; a member passed through an array, a Map, a spread, a destructuring rename or a return value is not followed, and a member reachable only that way reads as not delivered",
    why: "each of those is a further dataflow rule and each rule that is wrong invents an unreachability claim; the four followed here are the forms this tree uses, and the boundary is published so the fifth is a known miss rather than a silent one",
    file: "packages/rhizome/src/probes/reach/selectors.ts",
    line: 0,
  },
  {
    statement:
      "an operation counts as invocable by a caller only when it is reachable from the entry modules a package's own manifest declares — an exported function, a method of an exported class, or a method reached through an exported class's properties. A function a caller reaches some other way (a bin script, a handler a framework registers, a value handed in from outside the package) is not counted, so a value selectable only through one of those reads as not deliverable",
    why: "without this bound the distinction is vacuous inside a server package, where every route handler touches a Response and therefore everything reads as network-reaching: `api/src/services/runtime/store.ts` was reported as having two unsendable `RuntimeStatus` members on exactly that mistake, and it is a database column whose callers are HTTP requests. The bound moves the miss rather than removing it, so the new miss is stated here",
    file: "packages/rhizome/src/probes/reach/selectors.ts",
    line: 0,
  },
  {
    statement:
      "where a union's whole alphabet is written out as one literal list — a validator's enum, a table of allowed values — no member is reported as unselectable, because every member arrives through that list equally; a member that is genuinely unreachable in such a union is therefore a miss",
    why: "`packages/scriptwriter/src/mcp.ts:372` lists the whole `CascadeStatus` alphabet in a tool schema, and without noticing it this probe reported the one member no internal code writes as unsendable, beside a schema that accepts it. Withholding the strong reading is the direction that does not publish a false gap",
    file: "packages/rhizome/src/probes/reach/selectors.ts",
    line: 0,
  },
  {
    statement:
      "whether a document stages a value is decided from the document's text — the member written as the value of a field the union is carried on, or beside the union's own type name — so a document about an unrelated field of the same name can certify a member as staged that nobody staged, turning a gap into a `sound`",
    why: "prose has no parser and no resolver, and every alternative bar is worse: one loose enough to read English certifies more, and one demanding a machine-readable marker would certify nothing this repository actually writes. The half that *is* checked against the program is the seam a note names — `Type.field` is resolved, and a note naming a property the type does not have is reported as a gap rather than believed",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
  {
    statement:
      "an exported symbol shorter than four characters is not reference-counted at all",
    why: "a short identifier matches inside unrelated words often enough that the finding would be a coincidence wearing evidence; the bound is published so a two-letter dead export is a known miss",
    file: "packages/rhizome/src/probes/reach.ts",
    line: 0,
  },
];

// ── shared text facts ────────────────────────────────────────────────────

function isCode(scope: Scope, file: string): boolean {
  const extension = extensionOf(file);
  if (CODE_EXTENSIONS.includes(extension)) return true;
  if (extension !== "") return false;
  return SHEBANG_INTERPRETERS.test(scope.lines(file)[0] ?? "");
}

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

function resolveSpecifier(scope: Scope, base: string, specifier: string): string | null {
  const stem = joinRelative(base, specifier.replace(/\.js$/, ""));
  const candidates = [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`, `${stem}.js`, stem];
  const known = new Set(scope.files);
  for (const candidate of candidates) if (known.has(candidate)) return candidate;
  return null;
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
      const touched = external(route);
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
        "The route set is resolved from the parsed program's mount graph and the client set from the request paths in the tree; neither is a list in this file.",
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
      evidence:
        unclaimed
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
      evidence:
        `${inventory.routes.length} routes resolved from ${inventory.roots.length} mount root(s); every route in ${coveredDomains} domains has a client method with a matching HTTP verb` +
        (inventory.executed === null ? "" : `\nrouter executed: ${inventory.executed.routes.length} method/path pairs read off ${inventory.executed.entries.join(", ")}`),
      detail:
        "The route inventory is built by resolving `app.route(prefix, child)` edges from the parsed program — through factories, chained constructors and re-exports — so a route reachable at two prefixes is counted at both and a router nothing mounts contributes no routes.",
    });
  }

  return findings;
}

/** Check 2: router bindings nothing mounts, and the honest edges of the
 *  inventory that found them. */
function checkRouterMounting(scope: Scope, inventory: RouteInventory): Finding[] {
  const findings: Finding[] = [];

  if (inventory.unavailable !== null) {
    findings.push({
      probe: ID,
      title: "no route inventory was built: the TypeScript compiler could not be loaded",
      file: "packages/rhizome/src/probes/reach/ts-project.ts",
      line: 0,
      verdict: "limit",
      evidence: inventory.unavailable,
      detail:
        "Routes and value-selectors are resolved from a real program, and no program could be created. Every route-shaped and selector-shaped statement is therefore absent from this run rather than negative. `typescript` is a devDependency of rhizome and is imported dynamically for exactly this reason: the package installs and runs without it, and says what it lost.",
    });
    return findings;
  }

  const truth = inventory.executed;
  for (const unit of inventory.orphans) {
    const sample = unit.endpoints
      .slice(0, 6)
      .map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.local}  (${endpoint.file}:${endpoint.line})`);

    // When the router was executed there is a second, weaker reading
    // available. An unmounted binding has no absolute path, so ground
    // truth can only be asked whether *any* live route ends with one of
    // these local paths — and `GET /public/self-love-modules/kinds` ends
    // with `/kinds` while belonging to a different binding entirely. So
    // the executed inventory is quoted, never used to suppress: a loose
    // suffix match that silently withdrew a finding would be a false
    // clean, which is worse than a finding the reader has to judge.
    let confirmation = "";
    if (truth !== null) {
      const suffixed = unit.endpoints.filter((endpoint) =>
        truth.routes.some(
          (route) =>
            route.startsWith(`${endpoint.method.toUpperCase()} `) &&
            (route.endsWith(`/${endpoint.local.replace(/^\//, "")}`) || route.endsWith(` ${endpoint.local}`)),
        ),
      );
      confirmation =
        suffixed.length === 0
          ? `\n\nconfirmed against the running router: no route among the ${truth.routes.length} method/path pairs ${truth.entries.join(", ")} exposes even ends with one of these paths`
          : `\n\nthe running router exposes ${suffixed.length} route(s) whose path ends the same way; a local path is not an absolute one, so that is a coincidence to rule out by hand rather than a contradiction`;
    }

    findings.push({
      probe: ID,
      title: `${unit.file} declares ${unit.endpoints.length} route(s) on \`${unit.variable}\` and nothing mounts it`,
      file: unit.file,
      line: unit.endpoints[0]?.line ?? unit.line,
      verdict: "gap",
      evidence:
        sample.join("\n") +
        (unit.endpoints.length > 6 ? `\n… and ${unit.endpoints.length - 6} more` : "") +
        "\n\nno app.route(prefix, …) in the parsed program resolves to this binding; " +
        `${inventory.roots.length} mount root(s) were walked and this binding was not reached from any of them` +
        confirmation,
      detail:
        "The routes exist, compile and can be unit-tested against the router object directly, and no URL reaches them. Mounting is resolved per *binding* rather than per file, so a second router exported from a file that is itself mounted still shows up here. Mounts are read from parsed call expressions, so a commented-out `app.route(…)` is not one.",
    });
  }

  if (inventory.unresolvedMounts.length > 0) {
    findings.push({
      probe: ID,
      title: `${inventory.unresolvedMounts.length} mount(s) point at a router this probe could not resolve`,
      file: inventory.unresolvedMounts[0]!.file,
      line: inventory.unresolvedMounts[0]!.line,
      verdict: "limit",
      evidence:
        inventory.unresolvedMounts
          .slice(0, 10)
          .map((mount) => `${mount.file}:${mount.line}  ${clip(mount.text, 120)}`)
          .join("\n") +
        (inventory.unresolvedMounts.length > 10 ? `\n… and ${inventory.unresolvedMounts.length - 10} more` : ""),
      detail:
        "Every entry above is a parsed `app.route(prefix, target)` call whose second argument this analysis could not follow to a `new Hono()` binding — never a comment, never a line of prose. Routes below these mounts are absent from the inventory, so any statement above of the form 'no client sends this path' does not cover them. The previous version of this finding published eleven of these and all eleven were comment lines.",
    });
  }

  // The reconciliation, published whichever way it came out.
  if (truth === null) {
    findings.push({
      probe: ID,
      title: "the route inventory was resolved, not read off the running router",
      file: "packages/rhizome/src/probes/reach/routes.ts",
      line: 0,
      verdict: "limit",
      evidence:
        `${inventory.routes.length} routes resolved from ${inventory.roots.length} mount root(s)\n` +
        (inventory.executionNote === "" ? `${EXECUTE_ENV} is not set` : inventory.executionNote),
      detail:
        `The router itself can be asked: importing the app's entry module and reading \`app.routes\` is ground truth, because it is the table the framework matches requests against. Doing so runs repository code — module-level initialisation here opens database and cache clients — so it happens only under ${EXECUTE_ENV}=1. Until it does, the delta between this inventory and the running one is unmeasured, and this finding is that statement rather than a claim of completeness.`,
    });
  } else {
    const delta = reconcile(inventory);
    const total = delta.missedByResolver.length + delta.notOnRouter.length;
    findings.push({
      probe: ID,
      title:
        total === 0
          ? `the resolved route inventory matches the running router exactly (${truth.routes.length} routes)`
          : `the resolved route inventory differs from the running router in ${total} of ${truth.routes.length} route(s)`,
      file: "packages/rhizome/src/probes/reach/routes.ts",
      line: 0,
      verdict: total === 0 ? "sound" : "limit",
      evidence:
        `${inventory.executionNote}\n` +
        `compared under: ${delta.comparedRoots.join(", ")}\n` +
        `resolved: ${new Set(inventory.routes.filter((route) => route.roots.some((root) => delta.comparedRoots.includes(root))).map((route) => `${route.method.toUpperCase()} ${route.path}`)).size} distinct method/path pairs    on the router: ${truth.routes.length}\n` +
        (delta.missedByResolver.length === 0
          ? ""
          : `\non the router and not resolved (${delta.missedByResolver.length}):\n${delta.missedByResolver.slice(0, 20).join("\n")}` +
            (delta.missedByResolver.length > 20 ? `\n… and ${delta.missedByResolver.length - 20} more` : "")) +
        (delta.notOnRouter.length === 0
          ? ""
          : `\n\nresolved and not on the router (${delta.notOnRouter.length}):\n${delta.notOnRouter.slice(0, 20).join("\n")}` +
            (delta.notOnRouter.length > 20 ? `\n… and ${delta.notOnRouter.length - 20} more` : "")),
      detail:
        total === 0
          ? "Ground truth and the model agree, so every route-shaped statement in this report covers the whole surface."
          : "The difference is published rather than absorbed. A route on the router and not in the model is one this analysis cannot see, so 'no client sends this path' never covered it. A route in the model and not on the router is one this analysis invented, and any coverage claim about it is about nothing.",
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
      walkExports(manifest.bin);

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
    for (const match of text.matchAll(
      /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+\*?\s*([A-Za-z_$][\w$]*)/gm,
    )) {
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

function classify(scope: Scope, file: string, lines: readonly number[]): Reference[] {
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

/** Does a resolved program disagree with "nothing references this"?
 *
 *  The text index spans every language in the tree and cannot tell a
 *  mention from a use. For a TypeScript symbol the compiler can, so every
 *  claim of "no reference anywhere" is put to it before it is published:
 *  one identifier in the project that resolves to this declaration, in a
 *  file that is not its own, and the claim is withdrawn. */
function referencedInProgram(projects: TsProjects, symbol: ExportedSymbol): { file: string; line: number } | null {
  const ts = projects.api;
  if (ts === null) return null;
  const project = projects.forFile(symbol.file);
  if (project === null) return null;
  const declaring = project.sources.get(symbol.file);
  if (declaring === undefined) return null;

  let target: import("typescript").Symbol | undefined;
  ts.forEachChild(declaring, function find(node): void {
    if (target !== undefined) return;
    const named = node as import("typescript").Node & { name?: import("typescript").Node };
    if (
      named.name !== undefined &&
      ts.isIdentifier(named.name) &&
      named.name.getText() === symbol.name &&
      declaring.getLineAndCharacterOfPosition(named.name.getStart(declaring)).line + 1 === symbol.line
    ) {
      target = project.checker.getSymbolAtLocation(named.name);
      return;
    }
    ts.forEachChild(node, find);
  });
  if (target === undefined) return null;

  for (const [relative, source] of project.sources) {
    if (relative === symbol.file) continue;
    if (!source.getFullText().includes(symbol.name)) continue;
    let hit: { file: string; line: number } | null = null;
    ts.forEachChild(source, function visit(node): void {
      if (hit !== null) return;
      if (ts.isIdentifier(node) && node.getText() === symbol.name) {
        let found = project.checker.getSymbolAtLocation(node);
        if (found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0) {
          try {
            found = project.checker.getAliasedSymbol(found);
          } catch {
            // keep the alias
          }
        }
        if (found === target) {
          hit = { file: relative, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
          return;
        }
      }
      ts.forEachChild(node, visit);
    });
    if (hit !== null) return hit;
  }
  return null;
}

/** Checks 3 and 4: dead exports, and exports only a test can reach. */
function checkSymbolReach(scope: Scope, projects: TsProjects): Finding[] {
  const exported = collectExports(scope);
  const names = new Set(
    exported.filter((symbol) => symbol.name.length >= MIN_SYMBOL_LENGTH).map((symbol) => symbol.name),
  );
  if (names.size === 0) return [];

  const index = buildIndex(scope, names);
  const surface = publicSurface(scope);
  const ownerOf = packageOwnership(scope);

  // A name exported from more than one file cannot be attributed, so its
  // references are not evidence about either declaration.
  const declarationCount = new Map<string, number>();
  for (const symbol of exported) declarationCount.set(symbol.name, (declarationCount.get(symbol.name) ?? 0) + 1);

  const deadByFile = new Map<string, ExportedSymbol[]>();
  const documentedOnly: Array<{ symbol: ExportedSymbol; prose: Reference[] }> = [];
  const testOnly: Array<{ symbol: ExportedSymbol; references: Reference[]; documented: Reference[] }> = [];
  const publicUndocumented: ExportedSymbol[] = [];
  const withdrawn: Array<{ symbol: ExportedSymbol; at: { file: string; line: number } }> = [];

  for (const symbol of exported) {
    if (symbol.name.length < MIN_SYMBOL_LENGTH) continue;
    if ((declarationCount.get(symbol.name) ?? 0) > 1) continue;
    if (surface.entries.has(symbol.file)) continue; // the barrel itself

    const byFile = index.get(symbol.name) ?? new Map<string, number[]>();
    const references: Reference[] = [];
    for (const [file, lines] of byFile) {
      if (file === symbol.file) continue;
      if (isGenerated(file)) continue;
      references.push(...classify(scope, file, lines));
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

      // The `latent` reading is a property of the *evidence*, not of the
      // symbol's publication status. A symbol nothing calls and a document
      // describes is documented whether or not it is on a package's
      // published surface; the previous version made this reading
      // available only to published symbols, so a documented internal
      // symbol was reported dead with a detail that said "not by a
      // document" beside a document that named it.
      if (prose.length > 0) {
        if (isPublic) continue; // published and documented: the caller is a reader
        documentedOnly.push({ symbol, prose });
        continue;
      }
      if (isPublic) {
        if (symbol.isValue) publicUndocumented.push(symbol);
        continue;
      }

      // Before claiming "nothing in the tree mentions this", ask a
      // resolver. The text index cannot see a re-export renamed en route
      // or a use through a namespace import; the compiler can.
      const inProgram = referencedInProgram(projects, symbol);
      if (inProgram !== null) {
        withdrawn.push({ symbol, at: inProgram });
        continue;
      }

      deadByFile.set(symbol.file, [...(deadByFile.get(symbol.file) ?? []), symbol]);
      continue;
    }

    if (code.length === 0 && tests.length > 0 && symbol.isValue && !selfUsed) {
      if (isPublic && prose.length > 0) continue;
      testOnly.push({
        symbol,
        references: [...tests, ...references.filter((reference) => reference.kind === "wiring")],
        documented: prose,
      });
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
      evidence:
        symbols
          .slice(0, 10)
          .map((symbol) => `${symbol.kind} ${symbol.name}  ${symbol.file}:${symbol.line}`)
          .join("\n") + (symbols.length > 10 ? `\n… and ${symbols.length - 10} more in this file` : ""),
      detail:
        `Exported, not on ${ownerOf(file)}'s published surface, and mentioned by no other file in the corpus — not by code, not by a test, not by a document. ` +
        (projects.api === null
          ? "The reference count is textual, so a symbol reached by a dynamic dispatch table would land here wrongly; the evidence names the symbol so that is one grep to settle."
          : "For the TypeScript symbols above the textual count was put to a resolved program before this was published: no identifier anywhere in the package resolves to these declarations. A symbol reached by a string-keyed dispatch table or a dynamic import would still land here, and the evidence names it so that is one grep to settle."),
    });
  }

  if (documentedOnly.length > 0) {
    findings.push({
      probe: ID,
      title: `${documentedOnly.length} symbol(s) no code calls are described by a document that names them`,
      file: documentedOnly[0]!.symbol.file,
      line: documentedOnly[0]!.symbol.line,
      verdict: "sound",
      evidence: documentedOnly
        .slice(0, 12)
        .map(
          (entry) =>
            `${entry.symbol.kind} ${entry.symbol.name}  ${entry.symbol.file}:${entry.symbol.line}\n` +
            `    documented at ${entry.prose[0]!.file}:${entry.prose[0]!.line}  ${clip(entry.prose[0]!.text, 100)}`,
        )
        .join("\n") + (documentedOnly.length > 12 ? `\n… and ${documentedOnly.length - 12} more` : ""),
      detail:
        "Nothing in this repository calls these, and something in this repository tells a reader they are there and what they are for. That is the `latent` reading rather than the dead one, and it is available here whether or not the symbol is on a package's published surface — which is the correction: the previous version reserved it for published symbols and reported the rest as mentioned by nothing, beside a document that mentioned them.",
    });
  }

  if (withdrawn.length > 0) {
    findings.push({
      probe: ID,
      title: `${withdrawn.length} symbol(s) the text index called unreferenced are referenced, and a resolver said so`,
      file: withdrawn[0]!.symbol.file,
      line: withdrawn[0]!.symbol.line,
      verdict: "sound",
      evidence: withdrawn
        .slice(0, 10)
        .map(
          (entry) =>
            `${entry.symbol.kind} ${entry.symbol.name}  ${entry.symbol.file}:${entry.symbol.line}\n` +
            `    resolved reference at ${entry.at.file}:${entry.at.line}`,
        )
        .join("\n") + (withdrawn.length > 10 ? `\n… and ${withdrawn.length - 10} more` : ""),
      detail:
        "Each of these would have been published as a dead export by a purely textual count. The claim was put to a real program first and the program produced a call site, so the finding was withdrawn rather than shipped. Recorded because a probe that silently drops its own false positives cannot be audited: the number above is how often the text half is wrong.",
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
      evidence: [`${symbol.kind} ${symbol.name}  ${symbol.file}:${symbol.line}`, "", "every mention outside its own file:"]
        .concat(
          [...tests, ...wiring]
            .slice(0, 8)
            .map(
              (reference) =>
                `${reference.kind.padEnd(7)} ${reference.file}:${reference.line}  ${clip(reference.text, 110)}`,
            ),
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
        .map(
          ([owner, symbols]) =>
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

// ── the value-selector check ─────────────────────────────────────────────

/** Every exported string-literal union in the corpus, as a candidate.
 *
 *  Read textually because it is only a *candidate* list: nothing is
 *  concluded from it. Each candidate is then resolved in a real program,
 *  and one that cannot be is counted and published rather than dropped. */
function selectorCandidates(scope: Scope): SelectorCandidate[] {
  const out: SelectorCandidate[] = [];
  for (const file of scope.files) {
    if (!/\.(ts|tsx|mts|cts)$/.test(file)) continue;
    if (isGenerated(file) || isTestPath(file)) continue;
    for (const union of literalUnions(scope.lines(file))) {
      if (!union.exported) continue;
      if (union.members.length < 2 || union.members.length > 8) continue;
      // Members have to be identifier-shaped to be searched for as
      // literals. An emoji union (`LaughReaction = "😏" | "🙄"`) cannot be
      // word-bounded, so a search would be coincidence rather than a check.
      if (!union.members.every((member) => /^[A-Za-z][\w.:/-]{1,}$/.test(member))) continue;
      out.push({ file, name: union.name, line: union.line, members: union.members });
    }
  }
  return out;
}

/** Documents that tell a reader how to set this member.
 *
 *  The bar has to be a document that writes the member *as the value of a
 *  field this union is carried on* — `version: "v2"` — or beside the union
 *  type's own name. `docs/CROSS-INSTANCE-COVENANTS.md:168` writes
 *  `protocol_version: 'v2'` about an entirely different type, and a
 *  proximity rule that accepted the word "version" nearby would have
 *  certified it as the strand-thought cutover note. */
function documentationFor(
  scope: Scope,
  reading: UnionReading,
  member: string,
): Array<{ file: string; line: number; text: string }> {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignment = reading.fields.map(
    (field) => new RegExp(`\\b${escape(field)}\\b\\s*[:=]\\s*["'\`]${escape(member)}["'\`]`),
  );
  const named = new RegExp(`${escape(reading.name)}[\\s\\S]{0,200}?["'\`]${escape(member)}["'\`]`);
  const out: Array<{ file: string; line: number; text: string }> = [];
  for (const document of scope.files) {
    if (!isProse(document) || isGenerated(document)) continue;
    const text = scope.read(document);
    if (text === null) continue;
    if (!assignment.some((pattern) => pattern.test(text)) && !named.test(text)) continue;
    const lines = scope.lines(document);
    for (let at = 0; at < lines.length; at += 1) {
      const line = lines[at] ?? "";
      if (!assignment.some((pattern) => pattern.test(line)) && !line.includes(reading.name)) continue;
      out.push({ file: document, line: at + 1, text: clip(line.trim(), 120) });
      break;
    }
    if (out.length >= 3) break;
  }
  return out;
}

/** Seams a document names that the code does not have.
 *
 *  A staging note says where to set the value: `ThoughtsAddOpts.version`,
 *  `ThoughtsClient.add(…, version=…)`. That claim is checkable against the
 *  program — the type exists and either does or does not carry a property
 *  of this union — and checking it is what makes the difference between
 *  "staged" and "a document describing a path that is not there". */
function falsifiedSeams(
  scope: Scope,
  reading: UnionReading,
  documents: ReadonlyArray<{ file: string; line: number }>,
): Array<{ file: string; line: number; claim: string; text: string }> {
  const out: Array<{ file: string; line: number; claim: string; text: string }> = [];
  const fields = new Set(reading.fields);
  for (const document of documents) {
    const lines = scope.lines(document.file);
    for (let at = 0; at < lines.length; at += 1) {
      const line = lines[at] ?? "";
      for (const match of line.matchAll(/\b([A-Z][A-Za-z0-9_]*)\.([a-z][A-Za-z0-9_]*)\b/g)) {
        const type = match[1]!;
        const field = match[2]!;
        if (!fields.has(field)) continue;
        if (!reading.knownTypes.has(type)) continue;
        if (reading.seamTypes.get(type)?.has(field) === true) continue;
        out.push({
          file: document.file,
          line: at + 1,
          claim: `${type}.${field}`,
          text: clip(line.trim(), 140),
        });
      }
    }
  }
  return out;
}

function selectorFindings(scope: Scope, readings: readonly UnionReading[], unanalysed: number): Finding[] {
  const findings: Finding[] = [];

  for (const reading of readings) {
    const written = reading.members.filter((member) => (reading.byMember.get(member)?.writes.length ?? 0) > 0);
    const unwritten = reading.members.filter((member) => !written.includes(member));
    // The whole union is unused: a dead export, which is the check above.
    if (written.length === 0) continue;
    if (unwritten.length === 0) continue;
    // The signal is *asymmetry*. When most of a union is never written
    // here — `RuntimeProvider = "openai" | "anthropic" | …`, a vocabulary
    // the caller supplies — the union is an input alphabet and this check
    // has nothing to say about it. Derived from the union's own shape.
    if (unwritten.length > written.length) continue;

    const declaration =
      `type ${reading.name} = ${reading.members.map((value) => `"${value}"`).join(" | ")}\n` +
      `carried by: ${reading.carriers.map((carrier) => `${carrier.label} (${carrier.file}:${carrier.line})`).join(", ")}\n` +
      `written by non-test code: ${written.map((value) => `"${value}"`).join(", ")}\n` +
      (reading.branches.length === 0
        ? ""
        : `branched on at: ${reading.branches.map((branch) => `${branch.file}:${branch.line}`).join(", ")}\n`);

    const describe = (member: string): string => {
      const entry = reading.byMember.get(member);
      if (entry === undefined) return "";
      const lines = [`\n"${member}":`];
      lines.push(
        entry.writes.length === 0
          ? "  written by: nothing in the corpus"
          : `  written by:\n${entry.writes.slice(0, 4).map((site) => `    ${site.file}:${site.line}  ${clip(site.text, 90)}`).join("\n")}`,
      );
      if (entry.testWrites.length > 0) {
        lines.push(`  written by tests only:\n${entry.testWrites.slice(0, 3).map((site) => `    ${site.file}:${site.line}`).join("\n")}`);
      }
      lines.push(
        entry.deliverers.length === 0
          ? "  reachable from an operation that sends a request: none"
          : `  reachable from an operation that sends a request:\n${entry.deliverers.slice(0, 4).map((operation) => `    ${operation.name}  ${operation.file}:${operation.line}`).join("\n")}`,
      );
      if (entry.pureSeams.length > 0) {
        lines.push(
          `  accepted by operations that send nothing:\n${entry.pureSeams.slice(0, 4).map((operation) => `    ${operation.name}  ${operation.file}:${operation.line}`).join("\n")}`,
        );
      }
      return `${lines.join("\n")}\n`;
    };

    const stranded: string[] = [];
    const staged: string[] = [];
    const unreachable: string[] = [];
    const documents = new Map<string, Array<{ file: string; line: number; text: string }>>();

    for (const member of unwritten) {
      const documented = documentationFor(scope, reading, member);
      documents.set(member, documented);
      const deliverable = (reading.byMember.get(member)?.deliverers.length ?? 0) > 0;
      // Where the whole alphabet is written out as a literal list — a
      // validator's `.enum([...])` — every member arrives through that
      // list equally, so "this one cannot be selected" is not available.
      if (reading.anyDeliverable && !deliverable && reading.alphabet.length === 0) unreachable.push(member);
      else if (documented.length > 0) staged.push(member);
      else stranded.push(member);
    }

    // ── unreachable: the strand-thought/v2 shape ─────────────────────
    if (unreachable.length > 0) {
      const claimed = falsifiedSeams(
        scope,
        reading,
        unreachable.flatMap((member) => documents.get(member) ?? []),
      );
      const carriers = reading.members
        .filter((member) => (reading.byMember.get(member)?.deliverers.length ?? 0) > 0)
        .map((member) => `"${member}"`);
      findings.push({
        probe: ID,
        title: `${reading.name}: no operation can send ${unreachable.map((member) => `"${member}"`).join(", ")}`,
        file: reading.file,
        line: reading.line,
        verdict: "gap",
        evidence:
          declaration +
          unreachable.map(describe).join("") +
          (claimed.length === 0
            ? ""
            : `\na document names a seam the code does not have:\n${claimed
                .slice(0, 4)
                .map((entry) => `  ${entry.file}:${entry.line}  ${entry.claim} does not carry ${reading.name}\n    ${entry.text}`)
                .join("\n")}\n`) +
          (documents.get(unreachable[0]!)?.length
            ? `\nwritten down at:\n${(documents.get(unreachable[0]!) ?? [])
                .slice(0, 3)
                .map((entry) => `  ${entry.file}:${entry.line}  ${entry.text}`)
                .join("\n")}\n`
            : ""),
        detail:
          `${carriers.join(", ")} can arrive at the branch through an operation that performs a request; ${unreachable.map((member) => `"${member}"`).join(", ")} cannot. ` +
          "The value is implemented, branched on, and selectable only from functions that compute and return — so it can be produced and nothing will ever transmit it. " +
          "This is exactly the `strand-thought/v2` shape: the framing was correct, vectored, dual-accepted by the server, and `ThoughtsClient.add()` neither took a `version` nor forwarded one, so no real thought could carry it. " +
          (claimed.length > 0
            ? "A document in this tree still describes the seam by name, and the named property does not exist on the named type — so the staging note is now describing a path that is not there, which is why this is a gap and not `latent`."
            : "No document describes a staged cutover for it either."),
      });
    }

    // ── staged: latent, and the staging is real ──────────────────────
    if (staged.length > 0) {
      const claimed = falsifiedSeams(
        scope,
        reading,
        staged.flatMap((member) => documents.get(member) ?? []),
      );
      if (claimed.length > 0) {
        findings.push({
          probe: ID,
          title: `${reading.name}: the cutover note for ${staged.map((member) => `"${member}"`).join(", ")} names a seam that does not exist`,
          file: claimed[0]!.file,
          line: claimed[0]!.line,
          verdict: "gap",
          evidence:
            declaration +
            staged.map(describe).join("") +
            `\nthe document says:\n${claimed
              .slice(0, 4)
              .map((entry) => `  ${entry.file}:${entry.line}  ${entry.claim} does not carry ${reading.name}\n    ${entry.text}`)
              .join("\n")}\n`,
          detail:
            "A staged member is sound when the cutover is written down *and the seam the note names is there*. Here the note names a property, the type exists, and the property does not carry this union — so a reader who follows the document reaches for something that is not there and gets a type error, or worse, silently the default. The document and the code have to be corrected together.",
        });
      } else {
        findings.push({
          probe: ID,
          title: `${reading.name}: ${staged.map((member) => `"${member}"`).join(", ")} ${staged.length === 1 ? "is" : "are"} staged, not stranded`,
          file: reading.file,
          line: reading.line,
          verdict: "sound",
          evidence:
            declaration +
            staged.map(describe).join("") +
            `\nwritten down at:\n${staged
              .flatMap((member) => documents.get(member) ?? [])
              .slice(0, 4)
              .map((entry) => `  ${entry.file}:${entry.line}  ${entry.text}`)
              .join("\n")}`,
          detail:
            "No non-test caller writes these members, which is the same signature as an unreachable one — and here it is deliberate, and both halves of that were checked. A caller *can* select the value: the evidence names the operations that perform a request and accept it. And a document tells a reader how to set it and in what order the cutover happens, and the property that document names is on the type it names. " +
            "Recorded as sound so the next reader does not delete staged work as rot. The verdict flips to a gap the day either half stops holding — the document going quiet, or the seam being removed.",
        });
      }
    }

    // ── stranded: nothing writes it and nothing says why ─────────────
    if (stranded.length > 0) {
      findings.push({
        probe: ID,
        title: `${reading.name} admits ${stranded.map((member) => `"${member}"`).join(", ")} and nothing writes ${stranded.length === 1 ? "it" : "them"}`,
        file: reading.file,
        line: reading.line,
        verdict: "gap",
        evidence: declaration + stranded.map(describe).join(""),
        detail:
          `Most of this union is written by real code — ${written.map((value) => `"${value}"`).join(", ")} — and ${stranded.length === 1 ? "this member is" : "these members are"} not. ` +
          "Two readings, and the evidence above is what distinguishes them. Either the surface that would let a caller choose the value does not exist or does not forward it, or the value arrives from outside this repository — a database column, a request body, a peer's document — and the code only ever compares against it, in which case this is fine and is worth recording rather than re-deriving. " +
          "No document in the tree writes it as the value of one of these fields or beside the type name, so it is not staged work either.",
      });
    }
  }

  if (unanalysed > 0) {
    findings.push({
      probe: ID,
      title: `${unanalysed} string-literal union(s) are outside any resolvable TypeScript project and were not analysed`,
      file: "packages/rhizome/src/probes/reach/selectors.ts",
      line: 0,
      verdict: "limit",
      evidence: `${unanalysed} of ${unanalysed + readings.length} candidate unions could not be resolved in a program: their package has no tsconfig.json beside its package.json, or the union's file is not one that project compiles`,
      detail:
        "Answering 'can a caller select this value?' needs resolved symbols, and resolved symbols need a program. For these unions the question was not asked, which is different from being asked and answered no. Published so the shorter run is visible instead of reading as a cleaner one.",
    });
  }

  return findings;
}

export const reachProbe: Probe = {
  id: ID,
  title: "reach — exports nothing can invoke",
  question: "Is every public symbol and every route actually reachable from a real caller, or only from its own test?",
  limits: LIMITS,
  async run(scope: Scope): Promise<Finding[]> {
    const ownerOf = packageOwnership(scope);
    const projects = await TsProjects.open(scope);
    const surface = publicSurface(scope);
    const inventory = buildRouteInventory(scope, projects, surface.entries);

    const candidates = selectorCandidates(scope);
    const readings = readSelectors(scope, projects, candidates, surface.entries);
    const analysed = new Set(readings.map((reading) => `${reading.file}#${reading.name}`));
    const unanalysed =
      projects.api === null
        ? 0
        : candidates.filter((candidate) => !analysed.has(`${candidate.file}#${candidate.name}`)).length;

    return [
      ...checkRouteCoverage(scope, inventory, ownerOf),
      ...checkRouterMounting(scope, inventory),
      ...checkSymbolReach(scope, projects),
      ...selectorFindings(scope, readings, unanalysed),
    ];
  },
};
