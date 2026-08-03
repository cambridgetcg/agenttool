/** rhizome/probes/reach/routes — what URLs actually exist.
 *
 *  The previous version of this scanner read route mounts out of lines of
 *  text. Three things followed from that, all of them found by hand and
 *  none of them by the probe:
 *
 *   - `api/src/routes/public/index.ts:88` heads a prose block with
 *     `REMOVED:` and lists twenty-one deliberately-deleted mounts. The
 *     scanner counted them as live.
 *   - the one `limit` the probe published — "11 mounts point at a router
 *     this probe could not resolve" — was eleven comment lines, nine of
 *     them module-header docs of the form `*  Mounted in api/src/index.ts
 *     as: app.route("/v1", economyRouter)`. Eleven false limits.
 *   - twelve real routes were structurally invisible, because a router
 *     produced by a factory (`export default createHomeRouter()`) or by a
 *     chained constructor (`new Hono().get(…)`) has no line matching the
 *     pattern.
 *
 *  A comment is not code and a name is not a binding. So mounts and
 *  endpoints are read from the parsed program and resolved through the
 *  checker: `app.route("/v1/home", homeRouter)` follows `homeRouter` to
 *  the `export default createHomeRouter()`, into the factory, to the
 *  `return app`, to the `new Hono()` that produced it.
 *
 *  Even that is a model of the router rather than the router. The router
 *  itself can be *asked*, by importing the app's own entry module and
 *  reading `app.routes` — which is how the delta above was measured in
 *  the first place. Doing so runs repository code, which rhizome does not
 *  do without being told to, so it lives behind `RHIZOME_EXECUTE=1` and
 *  the two inventories are reconciled and the difference published.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isTestPath } from "./paths.js";
import type { Ts, TsProject, TsProjects } from "./ts-project.js";
import type { Scope } from "../../types.js";

/** HTTP methods this probe understands, lower-case as Hono spells them. */
export const METHODS: readonly string[] = ["get", "post", "put", "patch", "delete", "options", "head"];

/** The environment variable that lets rhizome run repository code.
 *
 *  Same shape as `pretend`'s `RHIZOME_MUTATE`: off by default, declared
 *  in the probe's limits, and named in the report either way. Importing
 *  an API entry module executes its module-level initialisation — which
 *  for this repository means database and cache clients attempting to
 *  connect. That is real egress, so it is never in the default path. */
export const EXECUTE_ENV = "RHIZOME_EXECUTE";

export interface Endpoint {
  method: string;
  /** Path relative to the binding that declares it. */
  local: string;
  file: string;
  line: number;
}

/** One Hono app *binding*, not one file.
 *
 *  A file can hold several. `api/src/routes/economy/crypto.ts` declares
 *  both the economy router and `export const cryptoWebhookRouter = new
 *  Hono()`, mounted at different prefixes. Modelling a router as a file
 *  collapses those and hangs twenty-four wallet routes off the webhook
 *  prefix — a route inventory that reads as authoritative and is wrong. */
export interface RouterUnit {
  id: number;
  file: string;
  variable: string;
  line: number;
  endpoints: Endpoint[];
  mounts: Array<{ prefix: string; target: number; line: number }>;
}

export interface Route {
  method: string;
  path: string;
  shape: string;
  file: string;
  line: number;
  /** The mount root this route hangs off, as `file#binding`. A tree can
   *  hold more than one app — `api` and `packages/scriptwriter` are two —
   *  and reconciling one app's inventory against another app's router
   *  would report every route of the second as invented. */
  roots: string[];
}

export interface ExecutedInventory {
  /** `"GET /v1/wake"`, as the router itself reports them. */
  routes: readonly string[];
  /** Entry modules that were imported to obtain them. */
  entries: readonly string[];
}

export interface RouteInventory {
  routes: Route[];
  /** Bindings nothing mounts, that carry routes of their own. */
  orphans: RouterUnit[];
  /** Root bindings of the mount forest, as `file#binding`. */
  roots: string[];
  /** `app.route(prefix, X)` calls where X could not be resolved to a
   *  binding. Every entry is a parsed call expression — never a comment,
   *  never a line of prose. */
  unresolvedMounts: Array<{ file: string; line: number; prefix: string; text: string }>;
  /** Present only when the router was executed. */
  executed: ExecutedInventory | null;
  /** Why the router was not executed, when it was not. */
  executionNote: string;
  /** Set when the TypeScript compiler could not be loaded: no inventory
   *  was built at all, and every route-shaped check is skipped. */
  unavailable: string | null;
}

function joinPath(prefix: string, local: string): string {
  const combined = `${prefix}/${local}`.replace(/\/{2,}/g, "/");
  const trimmed = combined.length > 1 ? combined.replace(/\/$/, "") : combined;
  return trimmed === "" ? "/" : trimmed;
}

/** Path segments with parameter names erased: `/v1/memories/:id` and
 *  `/v1/memories/:memory_id` are the same URL shape and must match. */
export function shapeOf(path: string): string {
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

function isHonoConstruction(ts: Ts, node: import("typescript").NewExpression): boolean {
  const callee = node.expression;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name.getText() : callee.getText();
  return name.split("<")[0] === "Hono";
}

/** Resolve the router graph out of the parsed programs. */
export function resolveRouteGraph(
  scope: Scope,
  projects: TsProjects,
  publishedEntries: ReadonlySet<string>,
): RouteInventory {
  const ts = projects.api;
  if (ts === null) {
    return {
      routes: [],
      orphans: [],
      roots: [],
      unresolvedMounts: [],
      executed: null,
      executionNote: "",
      unavailable: projects.unavailable ?? "the TypeScript compiler was not loaded",
    };
  }

  // Which projects hold routers is derived: the corpus is asked which
  // files mention the framework's constructor, and each of those files is
  // attributed to the project that compiles it.
  const bearing = new Set<string>();
  for (const file of scope.files) {
    if (!/\.(ts|tsx|mts|cts)$/.test(file) || isTestPath(file)) continue;
    const text = scope.read(file);
    if (text === null || !text.includes("new Hono")) continue;
    const project = projects.forFile(file);
    if (project !== null && project.sources.has(file)) bearing.add(project.directory);
  }

  const units: RouterUnit[] = [];
  const unresolvedMounts: RouteInventory["unresolvedMounts"] = [];
  const orphans: RouterUnit[] = [];
  const roots: string[] = [];
  const routes: Route[] = [];

  for (const directory of [...bearing].sort()) {
    const project = projects.forDirectory(directory);
    if (project === null) continue;
    const resolved = resolveProject(ts, scope, project, units.length, publishedEntries);
    units.push(...resolved.units);
    unresolvedMounts.push(...resolved.unresolvedMounts);
    orphans.push(...resolved.orphans);
    roots.push(...resolved.roots);
    routes.push(...resolved.routes);
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return {
    routes,
    orphans,
    roots,
    unresolvedMounts,
    executed: null,
    executionNote: "",
    unavailable: null,
  };
}

interface ProjectRoutes {
  units: RouterUnit[];
  unresolvedMounts: RouteInventory["unresolvedMounts"];
  orphans: RouterUnit[];
  roots: string[];
  routes: Route[];
  /** Absolute entry file(s) to execute for ground truth. */
  entryFiles: string[];
}

function resolveProject(
  ts: Ts,
  scope: Scope,
  project: TsProject,
  idOffset: number,
  publishedEntries: ReadonlySet<string>,
): ProjectRoutes {
  const checker = project.checker;
  const corpus = new Set(scope.files);
  const sources: Array<[string, import("typescript").SourceFile]> = [];
  for (const [relative, source] of project.sources) {
    if (!corpus.has(relative) || isTestPath(relative)) continue;
    sources.push([relative, source]);
  }

  const units: RouterUnit[] = [];
  const bySymbol = new Map<import("typescript").Symbol, number>();
  const byNode = new Map<import("typescript").Node, number>();

  const aliased = (symbol: import("typescript").Symbol | undefined): import("typescript").Symbol | undefined => {
    if (symbol === undefined) return undefined;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      try {
        return checker.getAliasedSymbol(symbol);
      } catch {
        return symbol;
      }
    }
    return symbol;
  };

  // ── every Hono binding, found by the framework's own constructor ────
  for (const [relative, source] of sources) {
    if (!source.getFullText().includes("new Hono")) continue;
    ts.forEachChild(source, function visit(node): void {
      if (ts.isNewExpression(node) && isHonoConstruction(ts, node)) {
        const id = idOffset + units.length;
        // `new Hono().get(…).post(…)` — the binding is at the end of the
        // chain, not at the constructor, and *every* link in the chain is
        // the same app: `.post("/reset")` is called on the value returned
        // by `.get("/")`, so unless each link is registered the second
        // route hangs off nothing and vanishes.
        let end: import("typescript").Node = node;
        byNode.set(end, id);
        while (
          end.parent !== undefined &&
          (ts.isPropertyAccessExpression(end.parent) ||
            (ts.isCallExpression(end.parent) && end.parent.expression === end))
        ) {
          end = end.parent;
          byNode.set(end, id);
        }
        const holder = end.parent;
        let variable = "(anonymous)";
        let symbol: import("typescript").Symbol | undefined;
        if (holder !== undefined && (ts.isVariableDeclaration(holder) || ts.isPropertyDeclaration(holder))) {
          symbol = checker.getSymbolAtLocation(holder.name);
          variable = holder.name.getText();
        }
        units.push({
          id,
          file: relative,
          variable,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          endpoints: [],
          mounts: [],
        });
        if (symbol !== undefined && !bySymbol.has(symbol)) bySymbol.set(symbol, id);
      }
      ts.forEachChild(node, visit);
    });
  }

  const unitAt = (id: number): RouterUnit | undefined => units[id - idOffset];

  // ── resolving an expression to a binding ────────────────────────────
  //
  // Three shapes exist in this tree and all three are followed:
  //   `export default app`                    an identifier
  //   `export default createHomeRouter()`     a factory call
  //   `new Hono().get("/")`                   a chained constructor
  const fromExpression = (node: import("typescript").Node | undefined, depth: number): number | undefined => {
    if (node === undefined || depth > 8) return undefined;
    const known = byNode.get(node);
    if (known !== undefined) return known;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      return fromExpression(node.expression, depth + 1);
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      return fromSymbol(aliased(checker.getSymbolAtLocation(node)), depth + 1);
    }
    if (ts.isCallExpression(node)) {
      const callee = aliased(checker.getSymbolAtLocation(node.expression));
      for (const declaration of callee?.getDeclarations() ?? []) {
        const body =
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer !== undefined &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
            ? declaration.initializer
            : declaration;
        const found = fromFunction(body, depth + 1);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  const fromSymbol = (
    symbol: import("typescript").Symbol | undefined,
    depth: number,
  ): number | undefined => {
    if (symbol === undefined || depth > 8) return undefined;
    const known = bySymbol.get(symbol);
    if (known !== undefined) return known;
    for (const declaration of symbol.getDeclarations() ?? []) {
      if (
        (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) &&
        declaration.initializer !== undefined
      ) {
        const found = fromExpression(declaration.initializer, depth + 1);
        if (found !== undefined) return found;
      }
      if (ts.isExportAssignment(declaration)) {
        const found = fromExpression(declaration.expression, depth + 1);
        if (found !== undefined) return found;
      }
      if (ts.isExportSpecifier(declaration)) {
        const found = fromSymbol(
          aliased(checker.getSymbolAtLocation(declaration.propertyName ?? declaration.name)),
          depth + 1,
        );
        if (found !== undefined) return found;
      }
      const found = fromFunction(declaration, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const fromFunction = (node: import("typescript").Node, depth: number): number | undefined => {
    if (depth > 8) return undefined;
    if (
      !ts.isFunctionDeclaration(node) &&
      !ts.isArrowFunction(node) &&
      !ts.isFunctionExpression(node) &&
      !ts.isMethodDeclaration(node)
    ) {
      return undefined;
    }
    const body = node.body;
    if (body === undefined) return undefined;
    if (!ts.isBlock(body)) return fromExpression(body, depth + 1);
    let returned: number | undefined;
    const declaredInside: number[] = [];
    ts.forEachChild(body, function visit(child): void {
      if (returned !== undefined) return;
      if (ts.isReturnStatement(child) && child.expression !== undefined) {
        const found = fromExpression(child.expression, depth + 1);
        if (found !== undefined) {
          returned = found;
          return;
        }
      }
      const own = byNode.get(child);
      if (own !== undefined) declaredInside.push(own);
      ts.forEachChild(child, visit);
    });
    if (returned !== undefined) return returned;
    const unique = [...new Set(declaredInside)];
    // A factory with exactly one app in it can only be returning that
    // one. Two is ambiguous, and a guess there hangs a whole subtree off
    // the wrong prefix, so it is left unresolved and published as such.
    return unique.length === 1 ? unique[0] : undefined;
  };

  // ── endpoints and mounts ────────────────────────────────────────────
  const unresolvedMounts: RouteInventory["unresolvedMounts"] = [];
  for (const [relative, source] of sources) {
    const text = source.getFullText();
    if (!text.includes(".route(") && !METHODS.some((method) => text.includes(`.${method}(`)) && !text.includes(".on(")) {
      continue;
    }
    ts.forEachChild(source, function visit(node): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const member = node.expression.name.getText();
        if (member === "route" || member === "on" || METHODS.includes(member)) {
          const receiver = fromExpression(node.expression.expression, 0);
          if (receiver !== undefined) {
            const unit = unitAt(receiver);
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            const first = node.arguments[0];
            if (unit !== undefined) {
              if (METHODS.includes(member) && first !== undefined && ts.isStringLiteralLike(first)) {
                unit.endpoints.push({ method: member, local: first.text, file: relative, line });
              } else if (member === "on" && first !== undefined) {
                const methods: string[] = [];
                if (ts.isArrayLiteralExpression(first)) {
                  for (const element of first.elements) {
                    if (ts.isStringLiteralLike(element)) methods.push(element.text.toLowerCase());
                  }
                } else if (ts.isStringLiteralLike(first)) {
                  methods.push(first.text.toLowerCase());
                }
                const paths: string[] = [];
                const second = node.arguments[1];
                if (second !== undefined && ts.isStringLiteralLike(second)) paths.push(second.text);
                else if (second !== undefined && ts.isArrayLiteralExpression(second)) {
                  for (const element of second.elements) {
                    if (ts.isStringLiteralLike(element)) paths.push(element.text);
                  }
                }
                for (const method of methods) {
                  if (!METHODS.includes(method)) continue;
                  for (const path of paths) unit.endpoints.push({ method, local: path, file: relative, line });
                }
              } else if (member === "route" && first !== undefined && ts.isStringLiteralLike(first)) {
                const target = fromExpression(node.arguments[1], 0);
                if (target !== undefined) unit.mounts.push({ prefix: first.text, target, line });
                else {
                  unresolvedMounts.push({
                    file: relative,
                    line,
                    prefix: first.text,
                    text: (scope.lines(relative)[line - 1] ?? node.getText()).trim(),
                  });
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    });
  }

  // ── which bindings a caller outside the package can get hold of ────
  //
  // `packages/scriptwriter/src/server.ts` declares twenty-five routes on
  // an app that nothing mounts, and it is not stranded: `buildServer()`
  // returns it and the package entry re-exports `buildServer`. A caller
  // holds the app and serves it. Without following the entry modules'
  // exports through the same resolver the mounts use, that binding reads
  // as twenty-five unreachable routes, which is a false gap in the
  // loudest possible place.
  const published = new Set<number>();
  for (const entry of publishedEntries) {
    const source = project.sources.get(entry);
    if (source === undefined) continue;
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const found = fromSymbol(aliased(exported), 0);
      if (found !== undefined) published.add(found);
    }
  }

  // ── walk the forest ─────────────────────────────────────────────────
  const mounted = new Set<number>();
  for (const unit of units) for (const mount of unit.mounts) mounted.add(mount.target);
  const rootUnits = units.filter(
    (unit) => !mounted.has(unit.id) && (unit.mounts.length > 0 || published.has(unit.id)),
  );

  const prefixes = new Map<number, Map<string, Set<string>>>();
  const descend = (id: number, root: string, prefix: string, seen: ReadonlySet<number>): void => {
    const byPrefix = prefixes.get(id) ?? new Map<string, Set<string>>();
    prefixes.set(id, byPrefix);
    const roots = byPrefix.get(prefix) ?? new Set<string>();
    const known = roots.has(root);
    roots.add(root);
    byPrefix.set(prefix, roots);
    if (known || seen.has(id)) return;
    const unit = unitAt(id);
    if (unit === undefined) return;
    const next = new Set(seen).add(id);
    for (const mount of unit.mounts) descend(mount.target, root, joinPath(prefix, mount.prefix), next);
  };
  for (const unit of rootUnits) descend(unit.id, `${unit.file}#${unit.variable}`, "", new Set());

  const routes: Route[] = [];
  for (const unit of units) {
    const reachableAt = prefixes.get(unit.id);
    if (reachableAt === undefined) continue;
    for (const endpoint of unit.endpoints) {
      for (const [prefix, roots] of reachableAt) {
        const path = joinPath(prefix, endpoint.local);
        routes.push({
          method: endpoint.method,
          path,
          shape: shapeOf(path),
          file: endpoint.file,
          line: endpoint.line,
          roots: [...roots].sort(),
        });
      }
    }
  }

  return {
    units,
    unresolvedMounts,
    orphans: units.filter((unit) => !prefixes.has(unit.id) && unit.endpoints.length > 0),
    roots: rootUnits.map((unit) => `${unit.file}#${unit.variable}`),
    routes,
    entryFiles: rootUnits.map((unit) => unit.file),
  };
}

/** Ask the router itself.
 *
 *  Imports the app's own entry module in a subprocess and reads
 *  `app.routes` — the same thing the framework matches requests against,
 *  so nothing is inferred. This runs repository code: module-level
 *  initialisation in this tree opens database and cache clients, which is
 *  real egress, so it happens only when `RHIZOME_EXECUTE=1` is set and
 *  the report says so either way. */
export function executeRouter(scope: Scope, entryFile: string): { routes: string[] | null; note: string } {
  if (process.env[EXECUTE_ENV] !== "1") {
    return {
      routes: null,
      note: `not executed: ${EXECUTE_ENV} is not set, so the inventory below is resolved from the mount graph rather than read off the running router`,
    };
  }
  const absolute = `${scope.root}/${entryFile}`;
  if (!existsSync(absolute)) return { routes: null, note: `not executed: ${entryFile} is not on disk` };

  const shadow = mkdtempSync(join(tmpdir(), "rhizome-reach-"));
  try {
    const outputPath = join(shadow, "routes.json");
    const script = join(shadow, "enumerate.ts");
    // Written outside the checkout, imports the entry by absolute path so
    // the entry's own dependencies resolve from its own node_modules.
    writeFileSync(
      script,
      [
        `import { writeFileSync } from "node:fs";`,
        `const out = ${JSON.stringify(outputPath)};`,
        `const target = ${JSON.stringify(absolute)};`,
        `try {`,
        `  const mod = await import(target);`,
        `  let app = null;`,
        `  for (const value of [mod.default, ...Object.values(mod)]) {`,
        `    if (value && typeof value === "object" && Array.isArray(value.routes) && typeof value.fetch === "function") { app = value; break; }`,
        `  }`,
        `  if (app === null) writeFileSync(out, JSON.stringify({ ok: false, reason: "no exported object with .routes and .fetch" }));`,
        `  else writeFileSync(out, JSON.stringify({ ok: true, routes: app.routes.map((r) => ({ method: r.method, path: r.path })) }));`,
        `} catch (error) {`,
        `  writeFileSync(out, JSON.stringify({ ok: false, reason: String(error && error.message ? error.message : error) }));`,
        `}`,
        `process.exit(0);`,
      ].join("\n"),
      "utf8",
    );

    const runner = /bun/.test(process.execPath) ? process.execPath : "bun";
    const result = spawnSync(runner, [script], {
      cwd: shadow,
      encoding: "utf8",
      timeout: 180_000,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, [EXECUTE_ENV]: "0" },
    });
    if (!existsSync(outputPath)) {
      const stderr = (result.stderr ?? "").trim().split("\n").slice(-3).join(" · ");
      return { routes: null, note: `not executed: ${runner} produced no inventory for ${entryFile}${stderr === "" ? "" : ` — ${stderr}`}` };
    }
    const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as
      | { ok: true; routes: Array<{ method: string; path: string }> }
      | { ok: false; reason: string };
    if (!parsed.ok) return { routes: null, note: `not executed: ${entryFile} — ${parsed.reason}` };
    const seen = new Set<string>();
    for (const route of parsed.routes) {
      // `ALL` is middleware, not an endpoint.
      if (route.method === "ALL") continue;
      seen.add(`${route.method.toUpperCase()} ${route.path}`);
    }
    return {
      routes: [...seen].sort(),
      note: `executed: imported ${entryFile} and read ${seen.size} method/path pairs off the router it exports`,
    };
  } catch (error) {
    return { routes: null, note: `not executed: ${entryFile} — ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    rmSync(shadow, { recursive: true, force: true });
  }
}

/** Build the inventory, and reconcile it against the router when the
 *  router is allowed to run. */
export function buildRouteInventory(
  scope: Scope,
  projects: TsProjects,
  publishedEntries: ReadonlySet<string>,
): RouteInventory {
  const inventory = resolveRouteGraph(scope, projects, publishedEntries);
  if (inventory.unavailable !== null) return inventory;

  // Every root of the mount forest is executed, not a chosen one: which
  // modules are entry points is derived from the graph, and picking one
  // would be an enumeration with an edge it could not see from inside.
  const entries = [...new Set(inventory.roots.map((root) => root.split("#")[0] ?? "").filter((file) => file !== ""))]
    .sort();
  if (entries.length === 0) {
    return { ...inventory, executionNote: "not executed: the mount graph has no root to execute" };
  }

  const routes = new Set<string>();
  const notes: string[] = [];
  const executedEntries: string[] = [];
  for (const entry of entries) {
    const attempt = executeRouter(scope, entry);
    notes.push(attempt.note);
    if (attempt.routes === null) continue;
    executedEntries.push(entry);
    for (const route of attempt.routes) routes.add(route);
  }

  return {
    ...inventory,
    executed:
      executedEntries.length === 0 ? null : { routes: [...routes].sort(), entries: executedEntries },
    executionNote: notes.join("\n"),
  };
}

/** Routes the router has and the resolver does not, and the reverse.
 *
 *  Restricted to the roots that were actually executed. This tree holds
 *  two apps — `api/src/index.ts` and the one `packages/scriptwriter`
 *  hands to its caller — and comparing the union of both against one of
 *  their routers reported the other's twenty-five routes as invented. */
export function reconcile(inventory: RouteInventory): {
  missedByResolver: string[];
  notOnRouter: string[];
  comparedRoots: string[];
} {
  if (inventory.executed === null) return { missedByResolver: [], notOnRouter: [], comparedRoots: [] };
  const executedRoots = new Set(
    inventory.roots.filter((root) => inventory.executed?.entries.includes(root.split("#")[0] ?? "") === true),
  );
  const truth = new Set(inventory.executed.routes);
  const resolved = new Set(
    inventory.routes
      .filter((route) => route.roots.some((root) => executedRoots.has(root)))
      .map((route) => `${route.method.toUpperCase()} ${route.path}`),
  );
  return {
    missedByResolver: [...truth].filter((route) => !resolved.has(route)).sort(),
    notOnRouter: [...resolved].filter((route) => !truth.has(route)).sort(),
    comparedRoots: [...executedRoots].sort(),
  };
}
