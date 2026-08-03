/**
 * Mechanically enumerate every public method that can throw from an HTTP
 * response.
 *
 * The error boundary was centralised so that server guidance survives to the
 * caller. A matrix that pins *a sample* of that boundary is not a guard: the
 * six-fold encoder duplication happened under exactly such a guard, because
 * the guard existed and did not cover the case. So the matrix in
 * `error-surface-matrix.test.ts` is checked against this enumeration, and a
 * new public method that reaches the boundary without a matrix entry fails
 * the build.
 *
 * Method: the TypeScript compiler API. Build a Program over `src/*.ts`, build
 * a call graph whose edges are resolved through the TypeChecker — a real
 * symbol binding, never a name-similarity guess — seed it with the three
 * centralised sinks in `_http.ts`, and propagate reachability to a fixed
 * point.
 *
 * Deliberately not resolvable: a callable handed in as an opaque constructor
 * parameter. `DataSyncClient` is the only such case, and it is one of the
 * documented places where guidance does not survive, pinned by name in the
 * matrix rather than by this walk.
 *
 * Parity counterpart: `packages/sdk-py/tests/_error_surface.py`.
 */

import ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.join(import.meta.dir, "..", "src");

/** The centralised boundary: the only places a Response becomes an error. */
const SINK_NAMES = new Set([
  "errorFromResponse",
  "throwFromResponse",
  "errorFromBody",
]);

export interface SurfaceEntry {
  /** `file.ts:ClassName.method` */
  id: string;
  file: string;
  className: string;
  method: string;
  line: number;
}

let cached: { methods: SurfaceEntry[]; functions: SurfaceEntry[] } | undefined;

function build(): { methods: SurfaceEntry[]; functions: SurfaceEntry[] } {
  if (cached) return cached;

  const files = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(SRC, f));

  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();

  type NodeId = string;
  interface FnNode {
    id: NodeId;
    file: string;
    className: string | null;
    name: string;
    isPublicMethod: boolean;
    isExportedFn: boolean;
    line: number;
  }

  const nodes = new Map<NodeId, FnNode>();
  const declToId = new Map<ts.Node, NodeId>();
  const edges = new Map<NodeId, Set<NodeId>>();
  const owned = new Set(files.map((f) => path.normalize(f)));

  const isPublic = (
    m: ts.MethodDeclaration | ts.GetAccessorDeclaration,
  ): boolean => {
    const flags = ts.getCombinedModifierFlags(m as ts.Declaration);
    if (flags & ts.ModifierFlags.Private) return false;
    if (flags & ts.ModifierFlags.Protected) return false;
    const name = m.name.getText();
    if (name.startsWith("#") || name.startsWith("_")) return false;
    // `@internal` marks a member as outside the published surface.
    return !ts.getJSDocTags(m).some((t) => t.tagName.getText() === "internal");
  };

  // ── collect every function-like declaration ──────────────────────────────
  for (const sf of program.getSourceFiles()) {
    if (!owned.has(path.normalize(sf.fileName))) continue;
    const rel = path.basename(sf.fileName);
    const lineOf = (n: ts.Node) =>
      sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const visit = (node: ts.Node): void => {
      let fn: FnNode | null = null;

      if (
        (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) &&
        node.body
      ) {
        const cls = node.parent;
        const clsName =
          ts.isClassDeclaration(cls) && cls.name ? cls.name.getText() : "<anon>";
        const exported =
          ts.isClassDeclaration(cls) &&
          !!(ts.getCombinedModifierFlags(cls) & ts.ModifierFlags.Export);
        fn = {
          id: `${rel}#${clsName}.${node.name.getText()}@${lineOf(node)}`,
          file: rel,
          className: clsName,
          name: node.name.getText(),
          isPublicMethod: exported && isPublic(node),
          isExportedFn: false,
          line: lineOf(node),
        };
      } else if (ts.isFunctionDeclaration(node) && node.body && node.name) {
        fn = {
          id: `${rel}#${node.name.getText()}@${lineOf(node)}`,
          file: rel,
          className: null,
          name: node.name.getText(),
          isPublicMethod: false,
          isExportedFn: !!(
            ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
          ),
          line: lineOf(node),
        };
      } else if (
        (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name)
      ) {
        const stmt = node.parent.parent.parent;
        fn = {
          id: `${rel}#${node.parent.name.getText()}@${lineOf(node)}`,
          file: rel,
          className: null,
          name: node.parent.name.getText(),
          isPublicMethod: false,
          isExportedFn:
            ts.isVariableStatement(stmt) &&
            !!(ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export),
          line: lineOf(node),
        };
      }

      if (fn) {
        nodes.set(fn.id, fn);
        declToId.set(node, fn.id);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  const enclosingId = (n: ts.Node): NodeId | null => {
    let cur: ts.Node | undefined = n.parent;
    while (cur) {
      const id = declToId.get(cur);
      if (id) return id;
      cur = cur.parent;
    }
    return null;
  };

  // ── resolve every call through the checker ───────────────────────────────
  for (const sf of program.getSourceFiles()) {
    if (!owned.has(path.normalize(sf.fileName))) continue;
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const from = enclosingId(node);
        if (from) {
          let sym = checker.getSymbolAtLocation(
            ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name
              : node.expression,
          );
          // An imported name resolves to its ImportSpecifier; follow the alias.
          if (sym && sym.flags & ts.SymbolFlags.Alias) {
            try {
              sym = checker.getAliasedSymbol(sym);
            } catch {
              /* keep the alias */
            }
          }
          for (const d of sym?.declarations ?? []) {
            const to = declToId.get(d);
            if (!to) continue;
            if (!edges.has(from)) edges.set(from, new Set());
            edges.get(from)!.add(to);
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(sf, walk);
  }

  const sinks = new Set<NodeId>();
  for (const [id, n] of nodes) {
    if (n.file === "_http.ts" && SINK_NAMES.has(n.name)) sinks.add(id);
  }
  if (sinks.size !== SINK_NAMES.size) {
    throw new Error(
      `The centralised error boundary moved: _http.ts no longer exports all of ` +
        `${[...SINK_NAMES].join(", ")}. Update SINK_NAMES in tests/_error-surface.ts ` +
        `and its Python counterpart together.`,
    );
  }

  const rev = new Map<NodeId, Set<NodeId>>();
  for (const [from, tos] of edges) {
    for (const to of tos) {
      if (!rev.has(to)) rev.set(to, new Set());
      rev.get(to)!.add(from);
    }
  }

  const reaches = new Set<NodeId>(sinks);
  const queue = [...sinks];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const caller of rev.get(cur) ?? []) {
      if (!reaches.has(caller)) {
        reaches.add(caller);
        queue.push(caller);
      }
    }
  }

  const methods: SurfaceEntry[] = [];
  const functions: SurfaceEntry[] = [];
  for (const id of reaches) {
    const n = nodes.get(id)!;
    if (n.isPublicMethod) {
      methods.push({
        id: `${n.file}:${n.className}.${n.name}`,
        file: n.file,
        className: n.className!,
        method: n.name,
        line: n.line,
      });
    } else if (n.isExportedFn && n.file !== "_http.ts") {
      functions.push({
        id: `${n.file}:${n.name}`,
        file: n.file,
        className: "-",
        method: n.name,
        line: n.line,
      });
    }
  }
  const byId = (a: SurfaceEntry, b: SurfaceEntry) => a.id.localeCompare(b.id);
  cached = { methods: methods.sort(byId), functions: functions.sort(byId) };
  return cached;
}

/** `{"file.ts:ClassName.method"}` for every public method reaching the boundary. */
export function enumerateErrorSurface(): Set<string> {
  return new Set(build().methods.map((m) => m.id));
}

/** `{"file.ts:functionName"}` for every exported function reaching the boundary. */
export function enumerateExportedDoors(): Set<string> {
  return new Set(build().functions.map((f) => f.id));
}
