/** rhizome/probes/reach/selectors — can a caller select this value at all?
 *
 *  `strand-thought/v2` is the worked example and the reason this module is
 *  a resolver rather than a regular expression. The framing was correct,
 *  vectored, branched on by the server and dual-accepted by it — and no
 *  thought could ever be written with it, because `ThoughtsClient.add()`
 *  did not take a `version` and did not forward one. Every text-shaped
 *  test of that situation passes: the union is declared, the member is
 *  quoted in several files, a document describes the cutover in order.
 *  Nothing about the *text* changes when the seam is removed — which was
 *  demonstrated: the previous implementation of this check produced
 *  byte-identical output across exactly that deletion.
 *
 *  So the question asked here is not "is the member mentioned?" but:
 *
 *      Is there an operation, invocable by a caller, which can carry
 *      this member to the branch that acts on it?
 *
 *  Answering it needs three graphs, all built from resolved symbols:
 *
 *    carriers    every declaration whose type is the union. Found by
 *                resolving type references to the alias symbol, so an
 *                imported or re-exported spelling is the same node.
 *    flow        which carrier feeds which. `signThought({ version:
 *                opts.version })` is an edge from `ThoughtsAddOpts
 *                .version` to `CanonicalThoughtOpts.version`, resolved
 *                through the contextual type, not through the words.
 *    calls       which function calls which, and which functions touch
 *                the platform's network types.
 *
 *  A member is **deliverable** when some function that reaches the
 *  network either accepts a carrier in its own signature that flows into
 *  a branch on the union, or writes the member itself inside its own call
 *  graph — which is what a default is. A member that is *selectable*
 *  (some pure function will accept it) and not deliverable is precisely
 *  the `strand-thought/v2` shape: the bytes can be computed and nothing
 *  will ever send them.
 */

import { isTestPath } from "./paths.js";
import type { Ts, TsProject, TsProjects } from "./ts-project.js";
import type { Scope } from "../../types.js";

/** Ambient platform types whose appearance inside a function means that
 *  function touches the network.
 *
 *  An enumeration, declared as a probe limit. It is not a *scope* —
 *  nothing here names a file, directory or package — and the names are
 *  the platform's own: each must resolve to a symbol declared in a
 *  `.d.ts`, so a local `class Response` does not qualify. A transport
 *  built on a name outside this line reads as pure, and a pure function
 *  is never a deliverer, so the miss costs a false "unreachable" — which
 *  is why the limit is published with the evidence that would settle it. */
const NETWORK_TYPES: ReadonlySet<string> = new Set([
  "Response",
  "Request",
  "RequestInit",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
]);

/** Depth bounds. A chain longer than these reads as not reaching, which
 *  is the direction that reports a gap rather than inventing soundness.
 *  Published as a limit. */
const MAX_FLOW_DEPTH = 16;
const MAX_CALL_DEPTH = 16;

/** Rounds of carrier discovery. Round 1 finds declarations annotated with
 *  the union. Each further round resolves the identifiers named by the
 *  carriers found so far, which discovers the locals the value flows into
 *  — `const version = opts.version ?? "v1"` is not annotated and cannot
 *  be known in advance. The loop stops early when nothing new appears. */
const DISCOVERY_ROUNDS = 4;

export interface Site {
  file: string;
  line: number;
  text: string;
}

export interface Operation extends Site {
  name: string;
  /** The function reaches one of the platform's network types. */
  network: boolean;
}

export interface MemberReading {
  member: string;
  /** Non-test code that writes this member into a carrier of the union. */
  writes: Site[];
  /** Test code that writes it. Evidence, never coverage. */
  testWrites: Site[];
  /** Network-reaching operations through which this member can arrive. */
  deliverers: Operation[];
  /** Operations that accept the union and never send anything. */
  pureSeams: Operation[];
}

export interface UnionReading {
  name: string;
  file: string;
  line: number;
  members: string[];
  /** Declarations typed by the union, as `Owner.field`. */
  carriers: Array<Site & { label: string }>;
  /** Field names carrying the union — the reader's handle on it. */
  fields: string[];
  /** Branch sites: `version === "v2"`, `case "v2":`. */
  branches: Site[];
  byMember: Map<string, MemberReading>;
  /** True when at least one member is deliverable. Only then does
   *  "not deliverable" say anything about the members that are not. */
  anyDeliverable: boolean;
  /** Places where the whole alphabet is written out as a literal list —
   *  a validator's `.enum([...])`, a table of allowed values. Where that
   *  happens the members are symmetric by construction and "this one
   *  cannot be selected" is not a claim this analysis can make. */
  alphabet: Site[];
  /** Named type → the properties it actually has that carry this union.
   *  A document that stages a member by naming `Type.field` is checked
   *  against this, so a cutover note describing a seam that no longer
   *  exists is caught rather than believed. */
  seamTypes: Map<string, Set<string>>;
  /** Every named type in this project, so a document naming a type that
   *  exists-but-lacks-the-field is distinguishable from one naming a type
   *  that does not exist. */
  knownTypes: Set<string>;
}

interface CarrierNode {
  symbol: import("typescript").Symbol;
  label: string;
  site: Site;
}

interface FunctionNode {
  declaration: import("typescript").SignatureDeclaration;
  name: string;
  site: Site;
  calls: Set<import("typescript").SignatureDeclaration>;
  ownNetwork: boolean;
  network: boolean;
}

type FunctionLike = import("typescript").SignatureDeclaration;

function siteOf(
  scope: Scope,
  relative: string,
  source: import("typescript").SourceFile,
  position: number,
): Site {
  const line = source.getLineAndCharacterOfPosition(position).line + 1;
  return { file: relative, line, text: (scope.lines(relative)[line - 1] ?? "").trim() };
}

/** Resolve through import aliases so `import type { X } from "./y"` and
 *  the declaration of `X` are one node in every graph here. */
function resolveAlias(
  ts: Ts,
  checker: import("typescript").TypeChecker,
  symbol: import("typescript").Symbol | undefined,
): import("typescript").Symbol | undefined {
  if (symbol === undefined) return undefined;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

function isFunctionLike(ts: Ts, node: import("typescript").Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function enclosingFunction(ts: Ts, node: import("typescript").Node): FunctionLike | null {
  let current: import("typescript").Node | undefined = node.parent;
  while (current !== undefined) {
    if (isFunctionLike(ts, current)) return current;
    current = current.parent;
  }
  return null;
}

function functionName(ts: Ts, declaration: FunctionLike): string {
  const named = declaration as { name?: import("typescript").Node };
  const own = named.name !== undefined ? named.name.getText() : "";
  const parent: import("typescript").Node | undefined = declaration.parent;
  if (parent !== undefined && ts.isClassDeclaration(parent) && parent.name !== undefined) {
    return `${parent.name.getText()}.${own === "" ? "constructor" : own}`;
  }
  if (own !== "") return own;
  if (parent !== undefined && (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))) {
    return parent.name.getText();
  }
  return "(anonymous)";
}

/** Does this type — or one level of its arguments or constituents — name
 *  a platform network type declared in a `.d.ts`? */
function isNetworkType(
  ts: Ts,
  checker: import("typescript").TypeChecker,
  type: import("typescript").Type,
): boolean {
  const seen = new Set<import("typescript").Type>();
  const walk = (candidate: import("typescript").Type, depth: number): boolean => {
    if (depth > 2 || seen.has(candidate)) return false;
    seen.add(candidate);
    const symbol = candidate.aliasSymbol ?? candidate.getSymbol();
    if (symbol !== undefined && NETWORK_TYPES.has(symbol.getName())) {
      const declarations = symbol.getDeclarations() ?? [];
      if (declarations.some((declaration) => declaration.getSourceFile().isDeclarationFile)) return true;
    }
    if (candidate.isUnionOrIntersection()) {
      for (const part of candidate.types) if (walk(part, depth + 1)) return true;
    }
    try {
      for (const argument of checker.getTypeArguments(candidate as import("typescript").TypeReference)) {
        if (walk(argument, depth + 1)) return true;
      }
    } catch {
      // Not a type reference. Nothing to descend into.
    }
    return false;
  };
  return walk(type, 0);
}

/** Every function in the project, with its call edges and whether it
 *  reaches the network. Built once per project and reused by every union
 *  declared in it. */
function buildCallGraph(
  ts: Ts,
  project: TsProject,
  scope: Scope,
  files: readonly string[],
): Map<FunctionLike, FunctionNode> {
  const checker = project.checker;
  const nodes = new Map<FunctionLike, FunctionNode>();

  const nodeFor = (declaration: FunctionLike): FunctionNode => {
    const existing = nodes.get(declaration);
    if (existing !== undefined) return existing;
    const source = declaration.getSourceFile();
    const relative = project.relativeOf(source.fileName) ?? source.fileName;
    const created: FunctionNode = {
      declaration,
      name: functionName(ts, declaration),
      site: siteOf(scope, relative, source, declaration.getStart(source)),
      calls: new Set(),
      ownNetwork: false,
      network: false,
    };
    nodes.set(declaration, created);
    return created;
  };

  const calleeDeclarations = (node: import("typescript").Node): FunctionLike[] => {
    const symbol = resolveAlias(ts, checker, checker.getSymbolAtLocation(node));
    const out: FunctionLike[] = [];
    for (const declaration of symbol?.getDeclarations() ?? []) {
      if (declaration.getSourceFile().isDeclarationFile) continue;
      if (isFunctionLike(ts, declaration)) out.push(declaration);
      else if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        const initializer = declaration.initializer;
        if (isFunctionLike(ts, initializer)) out.push(initializer);
      } else if (ts.isPropertyDeclaration(declaration) && declaration.initializer !== undefined) {
        const initializer = declaration.initializer;
        if (isFunctionLike(ts, initializer)) out.push(initializer);
      }
    }
    return out;
  };

  for (const relative of files) {
    const source = project.sources.get(relative);
    if (source === undefined) continue;
    const visit = (node: import("typescript").Node): void => {
      if (isFunctionLike(ts, node)) {
        nodeFor(node);
        // A function declared inline inside another is treated as called
        // by it. Callbacks are the ordinary case, and assuming they run
        // is the direction that reports fewer things unreachable.
        const outer = enclosingFunction(ts, node);
        if (outer !== null) nodeFor(outer).calls.add(node);
      }

      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const holder = enclosingFunction(ts, node);
        if (holder !== null) {
          for (const callee of calleeDeclarations(node.expression)) nodeFor(holder).calls.add(callee);
        }
      }

      // Network detection, bounded to the node kinds that carry a type
      // worth asking about, so the checker is not consulted for every
      // identifier in a six-hundred-file program.
      if (
        ts.isVariableDeclaration(node) ||
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isAwaitExpression(node) ||
        ts.isTypeReferenceNode(node)
      ) {
        const holder = enclosingFunction(ts, node);
        if (holder !== null) {
          const record = nodeFor(holder);
          if (!record.ownNetwork) {
            let type: import("typescript").Type | undefined;
            try {
              type = checker.getTypeAtLocation(node);
            } catch {
              type = undefined;
            }
            if (type !== undefined && isNetworkType(ts, checker, type)) record.ownNetwork = true;
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }

  const reaches = (declaration: FunctionLike, depth: number, seen: Set<FunctionLike>): boolean => {
    if (depth > MAX_CALL_DEPTH || seen.has(declaration)) return false;
    seen.add(declaration);
    const node = nodes.get(declaration);
    if (node === undefined) return false;
    if (node.ownNetwork) return true;
    for (const callee of node.calls) if (reaches(callee, depth + 1, seen)) return true;
    return false;
  };
  for (const node of nodes.values()) node.network = reaches(node.declaration, 0, new Set());
  return nodes;
}

/** Functions transitively called by a *published* network-reaching
 *  function. A literal written inside one of these is a literal a real
 *  request carries — which is what a default value is. */
function calledByNetwork(
  nodes: Map<FunctionLike, FunctionNode>,
  published: ReadonlySet<FunctionLike>,
): Set<FunctionLike> {
  const out = new Set<FunctionLike>();
  const descend = (declaration: FunctionLike, depth: number): void => {
    if (depth > MAX_CALL_DEPTH || out.has(declaration)) return;
    out.add(declaration);
    for (const callee of nodes.get(declaration)?.calls ?? []) descend(callee, depth + 1);
  };
  for (const node of nodes.values()) if (node.network && published.has(node.declaration)) descend(node.declaration, 0);
  return out;
}

/** Operations a caller outside this package can actually invoke.
 *
 *  Followed out of the entry modules the package's own manifest declares:
 *  every exported symbol, every method of an exported class, and — this
 *  is the one that matters — every method reachable through an exported
 *  class's properties. `at.strands.thoughts.add` is four hops from
 *  `AgentTool`, and it is the seam the whole `strand-thought/v2` question
 *  turns on.
 *
 *  Without this bound the distinction between "an operation can send this
 *  value" and "some function will accept it" is vacuous inside a server
 *  package, where every route handler touches a Response and therefore
 *  everything reads as network-reaching. `api/src/services/runtime/store
 *  .ts` was reported as having two unsendable `RuntimeStatus` members on
 *  exactly that mistake: it is a database column, its callers are HTTP
 *  requests, and no in-language caller selects it at all. */
function publishedOperations(
  ts: Ts,
  project: TsProject,
  entryFiles: readonly string[],
): Set<FunctionLike> {
  const checker = project.checker;
  const out = new Set<FunctionLike>();
  const seen = new Set<import("typescript").Symbol>();

  const expand = (symbol: import("typescript").Symbol | undefined, depth: number): void => {
    if (symbol === undefined || depth > 5) return;
    const target = resolveAlias(ts, checker, symbol);
    if (target === undefined || seen.has(target)) return;
    seen.add(target);
    let anchor: import("typescript").Declaration | undefined;
    for (const declaration of target.getDeclarations() ?? []) {
      anchor ??= declaration;
      if (declaration.getSourceFile().isDeclarationFile) continue;
      if (isFunctionLike(ts, declaration)) out.add(declaration);
      else if (
        (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) &&
        declaration.initializer !== undefined &&
        isFunctionLike(ts, declaration.initializer)
      ) {
        out.add(declaration.initializer);
      } else if (ts.isClassDeclaration(declaration)) {
        for (const member of declaration.members) {
          if (isFunctionLike(ts, member)) out.add(member);
        }
      }
    }
    if (anchor === undefined) return;
    const descend = (type: import("typescript").Type | undefined): void => {
      if (type === undefined) return;
      for (const property of checker.getPropertiesOfType(type)) expand(property, depth + 1);
      for (const signature of type.getCallSignatures()) {
        const declaration = signature.getDeclaration();
        if (declaration !== undefined && isFunctionLike(ts, declaration)) out.add(declaration);
      }
    };
    try {
      // For a class the *instance* type is what a caller holds, and a
      // client class is usually reached only as another class's property
      // — `WakeClient` is not exported from the SDK barrel at all; the
      // only way to it is `AgentTool.wake`, a getter. Taking the declared
      // instance type keeps that chain three hops instead of five.
      if ((target.flags & ts.SymbolFlags.Class) !== 0) descend(checker.getDeclaredTypeOfSymbol(target));
      const own = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(target, anchor));
      if (own.isUnion()) for (const part of own.types) descend(part);
      else descend(own);
    } catch {
      // A symbol whose type cannot be computed publishes nothing further.
    }
  };

  for (const entry of entryFiles) {
    const source = project.sources.get(entry);
    if (source === undefined) continue;
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) expand(exported, 0);
  }
  return out;
}

/** Where does the value at `node` end up? The symbol of the declaration
 *  it is assigned into, resolved through the contextual type rather than
 *  through the spelling of the property. */
function destinationOf(
  ts: Ts,
  checker: import("typescript").TypeChecker,
  node: import("typescript").Expression,
): import("typescript").Symbol | undefined {
  let current: import("typescript").Node = node;
  for (let step = 0; step < 8; step += 1) {
    const parent: import("typescript").Node | undefined = current.parent;
    if (parent === undefined) return undefined;

    // Shapes that pass a value along unchanged.
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isConditionalExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      current = parent;
      continue;
    }

    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      return checker.getSymbolAtLocation(parent.name);
    }
    if (ts.isPropertyDeclaration(parent) && parent.initializer === current) {
      return checker.getSymbolAtLocation(parent.name);
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === current
    ) {
      return checker.getSymbolAtLocation(parent.left);
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      const literal = parent.parent;
      if (literal !== undefined && ts.isObjectLiteralExpression(literal)) {
        const contextual = checker.getContextualType(literal);
        const property = contextual?.getProperty(parent.name.getText());
        if (property !== undefined) return property;
      }
      return checker.getSymbolAtLocation(parent.name);
    }
    if (ts.isShorthandPropertyAssignment(parent)) {
      const literal = parent.parent;
      if (literal !== undefined && ts.isObjectLiteralExpression(literal)) {
        const contextual = checker.getContextualType(literal);
        const property = contextual?.getProperty(parent.name.getText());
        if (property !== undefined) return property;
      }
      return undefined;
    }
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments !== undefined) {
      const index = parent.arguments.indexOf(current as import("typescript").Expression);
      if (index === -1) return undefined;
      let signature: import("typescript").Signature | undefined;
      try {
        signature = checker.getResolvedSignature(parent);
      } catch {
        signature = undefined;
      }
      const parameters = signature?.getParameters() ?? [];
      if (parameters.length === 0) return undefined;
      return parameters[Math.min(index, parameters.length - 1)];
    }
    return undefined;
  }
  return undefined;
}

/** The declaration a type annotation belongs to, when it is one this
 *  analysis can key on. */
function annotatedDeclaration(
  ts: Ts,
  node: import("typescript").Node,
): import("typescript").Declaration | null {
  const parent: import("typescript").Node | undefined = node.parent;
  if (parent === undefined) return null;
  if (
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isVariableDeclaration(parent)
  ) {
    return parent.type === node ? parent : null;
  }
  // `version?: U | undefined`, `U[]`, `(U)`, `readonly U[]`.
  if (
    ts.isUnionTypeNode(parent) ||
    ts.isArrayTypeNode(parent) ||
    ts.isParenthesizedTypeNode(parent) ||
    ts.isTypeOperatorNode(parent)
  ) {
    return annotatedDeclaration(ts, parent);
  }
  return null;
}

export interface SelectorCandidate {
  file: string;
  name: string;
  line: number;
  members: readonly string[];
}

/** Read every string-literal union a real program can resolve, and answer
 *  the reachability question for each of its members. */
export function readSelectors(
  scope: Scope,
  projects: TsProjects,
  candidates: readonly SelectorCandidate[],
  /** Repo-relative entry modules each package's own manifest declares.
   *  What a caller outside the package can reach starts here. */
  publishedEntries: ReadonlySet<string>,
): UnionReading[] {
  const ts = projects.api;
  if (ts === null) return [];

  const byDirectory = new Map<string, SelectorCandidate[]>();
  for (const candidate of candidates) {
    const project = projects.forFile(candidate.file);
    if (project === null || !project.sources.has(candidate.file)) continue;
    const list = byDirectory.get(project.directory) ?? [];
    list.push(candidate);
    byDirectory.set(project.directory, list);
  }

  const readings: UnionReading[] = [];
  for (const [directory, group] of byDirectory) {
    const project = projects.forDirectory(directory);
    if (project === null) continue;
    const corpus = new Set(scope.files);
    const files = [...project.sources.keys()].filter((file) => corpus.has(file) && !isTestPath(file));
    if (files.length === 0) continue;
    const calls = buildCallGraph(ts, project, scope, files);
    const entries = [...publishedEntries].filter((entry) => project.sources.has(entry));
    const published = publishedOperations(ts, project, entries);
    const networkCallees = calledByNetwork(calls, published);
    const knownTypes = collectTypeNames(ts, project, files);
    for (const candidate of group) {
      const reading = readUnion(ts, scope, project, files, calls, published, networkCallees, knownTypes, candidate);
      if (reading !== null) readings.push(reading);
    }
  }
  return readings;
}

/** Every interface/type-alias/class name declared in the project. */
function collectTypeNames(ts: Ts, project: TsProject, files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const relative of files) {
    const source = project.sources.get(relative);
    if (source === undefined) continue;
    ts.forEachChild(source, function visit(node): void {
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name !== undefined
      ) {
        out.add(node.name.getText());
      }
      ts.forEachChild(node, visit);
    });
  }
  return out;
}

function readUnion(
  ts: Ts,
  scope: Scope,
  project: TsProject,
  files: readonly string[],
  calls: Map<FunctionLike, FunctionNode>,
  published: ReadonlySet<FunctionLike>,
  networkCallees: Set<FunctionLike>,
  knownTypes: Set<string>,
  candidate: SelectorCandidate,
): UnionReading | null {
  const checker = project.checker;
  const declaringSource = project.sources.get(candidate.file);
  if (declaringSource === undefined) return null;

  let alias: import("typescript").TypeAliasDeclaration | undefined;
  ts.forEachChild(declaringSource, (node) => {
    if (alias === undefined && ts.isTypeAliasDeclaration(node) && node.name.getText() === candidate.name) {
      alias = node;
    }
  });
  if (alias === undefined) return null;
  const aliasSymbol = resolveAlias(ts, checker, checker.getSymbolAtLocation(alias.name));
  if (aliasSymbol === undefined) return null;

  const members = [...candidate.members];
  const memberSet = new Set(members);

  // ── carriers: declarations typed by the union ──────────────────────
  const carriers = new Map<import("typescript").Symbol, CarrierNode>();
  const seamTypes = new Map<string, Set<string>>();

  const declareCarrier = (
    symbol: import("typescript").Symbol | undefined,
    fallback: import("typescript").Node,
  ): void => {
    if (symbol === undefined || carriers.has(symbol)) return;
    const declaration = symbol.getDeclarations()?.[0] ?? fallback;
    const source = declaration.getSourceFile();
    if (source.isDeclarationFile) return;
    const relative = project.relativeOf(source.fileName);
    if (relative === null) return;

    let label = symbol.getName();
    const container: import("typescript").Node | undefined = declaration.parent;
    let ownerName: string | null = null;
    if (container !== undefined) {
      if (ts.isInterfaceDeclaration(container) && container.name !== undefined) {
        ownerName = container.name.getText();
      } else if (ts.isClassDeclaration(container) && container.name !== undefined) {
        ownerName = container.name.getText();
      } else if (ts.isTypeLiteralNode(container) && ts.isTypeAliasDeclaration(container.parent)) {
        ownerName = container.parent.name.getText();
      }
    }
    if (ownerName !== null) {
      label = `${ownerName}.${label}`;
      const known = seamTypes.get(ownerName) ?? new Set<string>();
      known.add(symbol.getName());
      seamTypes.set(ownerName, known);
    }
    carriers.set(symbol, {
      symbol,
      label,
      site: siteOf(scope, relative, source, declaration.getStart(source)),
    });
  };

  for (const relative of files) {
    const source = project.sources.get(relative);
    if (source === undefined) continue;
    if (!source.getFullText().includes(candidate.name)) continue;
    ts.forEachChild(source, function visit(node): void {
      if (ts.isTypeReferenceNode(node) && node.typeName.getText().split(".").pop() === candidate.name) {
        const referenced = resolveAlias(ts, checker, checker.getSymbolAtLocation(node.typeName));
        if (referenced === aliasSymbol) {
          const holder = annotatedDeclaration(ts, node);
          const named = holder as (import("typescript").Declaration & { name?: import("typescript").Node }) | null;
          if (named?.name !== undefined) declareCarrier(checker.getSymbolAtLocation(named.name), node);
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  if (carriers.size === 0) return null;

  // ── flow edges, literal writes, branch sites ───────────────────────
  const flow = new Map<import("typescript").Symbol, Set<import("typescript").Symbol>>();
  const writes = new Map<string, Site[]>();
  const testWrites = new Map<string, Site[]>();
  const writeHolders = new Map<string, Set<FunctionLike>>();
  const writeTargets = new Map<string, Set<import("typescript").Symbol>>();
  const branches: Site[] = [];
  const branchSymbols = new Set<import("typescript").Symbol>();
  const alphabet: Site[] = [];

  const addEdge = (from: import("typescript").Symbol, to: import("typescript").Symbol): void => {
    if (from === to) return;
    const set = flow.get(from) ?? new Set<import("typescript").Symbol>();
    set.add(to);
    flow.set(from, set);
  };

  const record = (
    bucket: Map<string, Site[]>,
    member: string,
    site: Site,
  ): void => {
    const list = bucket.get(member) ?? [];
    if (!list.some((entry) => entry.file === site.file && entry.line === site.line)) list.push(site);
    bucket.set(member, list);
  };

  // Tests write members too; that is evidence about the test, never
  // coverage of the surface, so both halves are collected and kept apart.
  const corpus = new Set(scope.files);
  const allFiles = [...project.sources.keys()].filter((file) => corpus.has(file));

  for (let round = 0; round < DISCOVERY_ROUNDS; round += 1) {
    const names = new Set<string>();
    for (const carrier of carriers.values()) names.add(carrier.symbol.getName());
    const before = carriers.size;

    for (const relative of allFiles) {
      const source = project.sources.get(relative);
      if (source === undefined) continue;
      const text = source.getFullText();
      let interesting = text.includes(candidate.name);
      if (!interesting) {
        for (const name of names) {
          if (text.includes(name)) {
            interesting = true;
            break;
          }
        }
      }
      if (!interesting) continue;
      const test = isTestPath(relative);

      ts.forEachChild(source, function visit(node): void {
        if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
          const leaf = ts.isPropertyAccessExpression(node) ? node.name : node;
          if (names.has(leaf.getText())) {
            const symbol = resolveAlias(ts, checker, checker.getSymbolAtLocation(leaf));
            if (symbol !== undefined && carriers.has(symbol)) {
              const destination = resolveAlias(
                ts,
                checker,
                destinationOf(ts, checker, node as import("typescript").Expression),
              );
              if (destination !== undefined && !test) {
                declareCarrier(destination, node);
                if (carriers.has(destination)) addEdge(symbol, destination);
              }
              const parent: import("typescript").Node | undefined = node.parent;
              if (
                parent !== undefined &&
                ts.isBinaryExpression(parent) &&
                (parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                  parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
                  parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
                  parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)
              ) {
                const other = parent.left === node ? parent.right : parent.left;
                if (ts.isStringLiteralLike(other) && memberSet.has(other.text) && !test) {
                  branchSymbols.add(symbol);
                  const site = siteOf(scope, relative, source, parent.getStart(source));
                  if (!branches.some((entry) => entry.file === site.file && entry.line === site.line)) {
                    branches.push(site);
                  }
                }
              }
              if (parent !== undefined && ts.isSwitchStatement(parent) && parent.expression === node && !test) {
                for (const clause of parent.caseBlock.clauses) {
                  if (
                    ts.isCaseClause(clause) &&
                    ts.isStringLiteralLike(clause.expression) &&
                    memberSet.has(clause.expression.text)
                  ) {
                    branchSymbols.add(symbol);
                    const site = siteOf(scope, relative, source, clause.getStart(source));
                    if (!branches.some((entry) => entry.file === site.file && entry.line === site.line)) {
                      branches.push(site);
                    }
                  }
                }
              }
            }
          }
        }

        if (ts.isStringLiteralLike(node) && memberSet.has(node.text)) {
          // `.enum(["active", "capped", "abandoned"])` — a validator that
          // lists the whole alphabet is a seam through which every member
          // arrives equally. `packages/scriptwriter/src/mcp.ts:372` does
          // exactly this, and without noticing it this analysis reported
          // the one member no internal code writes as unsendable, beside
          // a tool schema that accepts it.
          const list = node.parent;
          if (list !== undefined && ts.isArrayLiteralExpression(list) && !test) {
            const listed = new Set<string>();
            for (const element of list.elements) {
              if (ts.isStringLiteralLike(element)) listed.add(element.text);
            }
            if (members.every((member) => listed.has(member))) {
              const site = siteOf(scope, relative, source, list.getStart(source));
              if (!alphabet.some((entry) => entry.file === site.file && entry.line === site.line)) {
                alphabet.push(site);
              }
            }
          }
          const destination = resolveAlias(ts, checker, destinationOf(ts, checker, node));
          if (destination !== undefined && carriers.has(destination)) {
            const site = siteOf(scope, relative, source, node.getStart(source));
            record(test ? testWrites : writes, node.text, site);
            if (!test) {
              const holder = enclosingFunction(ts, node);
              if (holder !== null) {
                const holders = writeHolders.get(node.text) ?? new Set<FunctionLike>();
                holders.add(holder);
                writeHolders.set(node.text, holders);
              }
              const targets = writeTargets.get(node.text) ?? new Set<import("typescript").Symbol>();
              targets.add(destination);
              writeTargets.set(node.text, targets);
            }
          }
        }

        ts.forEachChild(node, visit);
      });
    }
    if (carriers.size === before && round > 0) break;
  }

  // ── reachability ───────────────────────────────────────────────────
  const reachesBranch = (start: import("typescript").Symbol): boolean => {
    const seen = new Set<import("typescript").Symbol>();
    const walk = (symbol: import("typescript").Symbol, depth: number): boolean => {
      if (depth > MAX_FLOW_DEPTH || seen.has(symbol)) return false;
      seen.add(symbol);
      if (branchSymbols.has(symbol)) return true;
      for (const next of flow.get(symbol) ?? []) if (walk(next, depth + 1)) return true;
      return false;
    };
    return walk(start, 0);
  };

  // Which operations expose a carrier in their own signature — directly
  // as a parameter, or as a property of a parameter's type. That is the
  // seam a caller can reach: `add(strandId, plaintext, opts)` where
  // `ThoughtsAddOpts` carries `version`.
  // `options?: WakeOptions` types the parameter `WakeOptions | undefined`,
  // and `getPropertiesOfType` on a union returns only the properties every
  // constituent has — which for a union with `undefined` in it is none. An
  // earlier version of this walk missed every optional options-bag in the
  // tree that way and reported six unions as having no seam at all. So the
  // constituents are walked, and one level of nested carrier with them.
  const carrierProperties = (
    type: import("typescript").Type,
    depth: number,
    seen: Set<import("typescript").Type>,
    out: import("typescript").Symbol[],
  ): void => {
    if (depth > 2 || seen.has(type)) return;
    seen.add(type);
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) carrierProperties(part, depth, seen, out);
      return;
    }
    for (const property of checker.getPropertiesOfType(type)) {
      const resolvedProperty = resolveAlias(ts, checker, property);
      if (resolvedProperty === undefined) continue;
      if (carriers.has(resolvedProperty)) {
        out.push(resolvedProperty);
        continue;
      }
      if (depth >= 2) continue;
      const declaration = resolvedProperty.getDeclarations()?.[0];
      if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) continue;
      try {
        carrierProperties(checker.getTypeOfSymbolAtLocation(resolvedProperty, declaration), depth + 1, seen, out);
      } catch {
        // A property whose type cannot be computed contributes nothing.
      }
    }
  };

  const seamCarriers = (declaration: FunctionLike): import("typescript").Symbol[] => {
    const out: import("typescript").Symbol[] = [];
    for (const parameter of declaration.parameters) {
      const own = checker.getSymbolAtLocation(parameter.name);
      if (own !== undefined && carriers.has(own)) out.push(own);
      let type: import("typescript").Type | undefined;
      try {
        type = checker.getNonNullableType(checker.getTypeAtLocation(parameter));
      } catch {
        type = undefined;
      }
      if (type === undefined) continue;
      carrierProperties(type, 1, new Set(), out);
    }
    return out;
  };

  const deliverers: Operation[] = [];
  const pureSeams: Operation[] = [];
  const addOperation = (bucket: Operation[], node: FunctionNode): void => {
    const operation: Operation = { ...node.site, name: node.name, network: node.network };
    if (!bucket.some((entry) => entry.file === operation.file && entry.line === operation.line)) {
      bucket.push(operation);
    }
  };
  for (const node of calls.values()) {
    if (isTestPath(node.site.file)) continue;
    // Only an operation a caller outside the package can invoke is a
    // seam. Inside a server package every route handler touches a
    // Response, so without this bound "an operation can send it" is true
    // of everything and says nothing.
    if (!published.has(node.declaration)) continue;
    const exposed = seamCarriers(node.declaration);
    if (exposed.length === 0) continue;
    if (!exposed.some((symbol) => reachesBranch(symbol))) continue;
    addOperation(node.network ? deliverers : pureSeams, node);
  }

  const byMember = new Map<string, MemberReading>();
  for (const member of members) {
    // A member written as a literal inside a function that a real request
    // runs through is deliverable even when no caller can choose it —
    // that is what a default is. `opts.version ?? "v1"` is exactly this.
    const defaults: Operation[] = [];
    const targetsBranch = [...(writeTargets.get(member) ?? [])].some((target) => reachesBranch(target));
    if (targetsBranch) {
      for (const holder of writeHolders.get(member) ?? []) {
        if (!networkCallees.has(holder)) continue;
        const node = calls.get(holder);
        if (node !== undefined) addOperation(defaults, node);
      }
    }
    byMember.set(member, {
      member,
      writes: writes.get(member) ?? [],
      testWrites: testWrites.get(member) ?? [],
      deliverers: [...deliverers, ...defaults.filter((entry) => !deliverers.some((seen) => seen.file === entry.file && seen.line === entry.line))],
      pureSeams,
    });
  }

  return {
    name: candidate.name,
    file: candidate.file,
    line: candidate.line,
    members,
    carriers: [...carriers.values()]
      .filter((carrier) => carrier.label.includes("."))
      .map((carrier) => ({ ...carrier.site, label: carrier.label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    fields: [...new Set([...carriers.values()].map((carrier) => carrier.symbol.getName()))].sort(),
    branches: branches.slice(0, 8),
    byMember,
    anyDeliverable: [...byMember.values()].some((reading) => reading.deliverers.length > 0),
    alphabet,
    seamTypes,
    knownTypes,
  };
}
