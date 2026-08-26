import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "../../api/node_modules/typescript/lib/typescript.js";

declare const Bun: any;

export const BRIDGE_PACK_DIRECTIVE = "// deno-fmt-ignore-file";
export const BRIDGE_PACK_MAX_COLUMNS = 240;
export const BRIDGE_PACK_MAX_LINE_ENTRIES = 10_000;

interface LeafToken {
  kind: number;
  start: number;
  end: number;
  text: string;
}

interface ParsedSource {
  sourceFile: any;
  leaves: LeafToken[];
  comments: Array<{ kind: number; pos: number; end: number; text: string }>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseSource(
  source: string,
  scriptKind = ts.ScriptKind.TS,
): ParsedSource {
  const sourceFile = ts.createSourceFile(
    scriptKind === ts.ScriptKind.TS ? "bridge.ts" : "bridge.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const parseDiagnostics = (sourceFile as typeof sourceFile & {
    readonly parseDiagnostics: readonly unknown[];
  }).parseDiagnostics;
  if (!Array.isArray(parseDiagnostics) || parseDiagnostics.length !== 0) {
    throw new Error("bridge_pack_parse");
  }
  const leaves: LeafToken[] = [];
  const commentByPosition = new Map<
    number,
    { kind: number; pos: number; end: number; text: string }
  >();
  const recordComments = (position: number): void => {
    for (
      const range of [
        ...(ts.getLeadingCommentRanges(source, position) ?? []),
        ...(ts.getTrailingCommentRanges(source, position) ?? []),
      ]
    ) {
      commentByPosition.set(range.pos, {
        ...range,
        text: source.slice(range.pos, range.end),
      });
    }
  };
  const visit = (node: any): void => {
    recordComments(node.pos);
    recordComments(node.end);
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) {
        const start = node.getStart(sourceFile, false);
        leaves.push({
          kind: node.kind,
          start,
          end: node.end,
          text: source.slice(start, node.end),
        });
      }
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sourceFile);
  return {
    sourceFile,
    leaves,
    comments: [...commentByPosition.values()].sort((left, right) =>
      left.pos - right.pos
    ),
  };
}

function leafDigest(leaves: readonly LeafToken[]): string {
  const hash = createHash("sha256");
  for (const leaf of leaves) {
    hash.update(String(leaf.kind)).update("\0").update(leaf.text).update("\0");
  }
  return hash.digest("hex");
}

function astShapeDigest(node: any, sourceFile: any): string {
  const hash = createHash("sha256");
  const visit = (value: any): void => {
    const children = value.getChildren(sourceFile);
    hash.update(String(value.kind)).update("(");
    for (const child of children) visit(child);
    hash.update(")");
  };
  visit(node);
  return hash.digest("hex");
}

function withoutPackDirective(source: string): string {
  const exact = `#!/usr/bin/env bun\n${BRIDGE_PACK_DIRECTIVE}\n`;
  return source.startsWith(exact)
    ? `#!/usr/bin/env bun\n${source.slice(exact.length)}`
    : source;
}

function semanticFacts(source: string) {
  const semantic = withoutPackDirective(source);
  const parsed = parseSource(semantic);
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
  const emitted = String(transpiler.transformSync(semantic));
  const canonicalEmitted = String(new Bun.Transpiler({
    loader: "ts",
    target: "bun",
    minifyWhitespace: true,
  }).transformSync(semantic));
  const emittedParsed = parseSource(emitted, ts.ScriptKind.JS);
  const scan = transpiler.scan(semantic);
  return {
    leafCount: parsed.leaves.length,
    leafSHA256: leafDigest(parsed.leaves),
    astShapeSHA256: astShapeDigest(parsed.sourceFile, parsed.sourceFile),
    comments: parsed.comments.map((comment) => comment.text),
    emitted,
    canonicalEmitted,
    emittedLeafCount: emittedParsed.leaves.length,
    emittedLeafSHA256: leafDigest(emittedParsed.leaves),
    imports: scan.imports.map((entry: any) => ({
      kind: entry.kind,
      path: entry.path,
    })),
    exports: [...scan.exports],
    topLevelKinds: parsed.sourceFile.statements.map((statement: any) =>
      statement.kind
    ),
  };
}

function protectedNewlines(source: string, parsed: ParsedSource): Set<number> {
  const protectedPositions = new Set<number>();
  const protectRange = (start: number, end: number): void => {
    for (
      let cursor = source.indexOf("\n", start);
      cursor >= 0 && cursor < end;
      cursor = source.indexOf("\n", cursor + 1)
    ) {
      protectedPositions.add(cursor);
    }
  };
  for (const leaf of parsed.leaves) protectRange(leaf.start, leaf.end);
  for (const comment of parsed.comments) {
    protectRange(comment.pos, comment.end);
    if (
      comment.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
      source[comment.end] === "\n"
    ) {
      protectedPositions.add(comment.end);
    }
  }
  const selfPinDeclarations = [...source.matchAll(
    /const BRIDGE_NORMALIZED_SHA256 =\n  "[0-9a-f]{64}";/g,
  )];
  if (
    selfPinDeclarations.length !== 1 ||
    selfPinDeclarations[0]!.index === undefined
  ) {
    throw new Error("bridge_pack_self_pin_contract");
  }
  const selfPinDeclaration = selfPinDeclarations[0]!;
  const selfPinNewline = selfPinDeclaration[0].indexOf("\n");
  if (selfPinNewline < 0) throw new Error("bridge_pack_self_pin_contract");
  protectedPositions.add(selfPinDeclaration.index! + selfPinNewline);
  return protectedPositions;
}

function safeJoin(left: string, right: string): boolean {
  const before = left.trimEnd();
  const after = right.trimStart();
  if (before.length === 0 || after.length === 0) return false;
  if (before.startsWith("#!") || before.includes("//")) return false;
  if (after === BRIDGE_PACK_DIRECTIVE || after.startsWith("#!")) return false;
  if (/^(?:return|throw|yield|break|continue)$/.test(before)) return false;
  return /(?:[,([{=?:]|\|\||&&|=>)$/.test(before) ||
    /^(?:[)\]}]|\.|,|&&|\|\||\?|:|else\b|catch\b|finally\b)/.test(after);
}

export function packMaintenanceBridgeSource(source: string): string {
  if (!source.startsWith("#!/usr/bin/env bun\n") || source.includes("\r")) {
    throw new Error("bridge_pack_source");
  }
  const input = source.startsWith(
      `#!/usr/bin/env bun\n${BRIDGE_PACK_DIRECTIVE}\n`,
    )
    ? source
    : source.replace(
      "#!/usr/bin/env bun\n",
      `#!/usr/bin/env bun\n${BRIDGE_PACK_DIRECTIVE}\n`,
    );
  const parsed = parseSource(input);
  const protectedPositions = protectedNewlines(input, parsed);
  const sourceLines = input.split("\n");
  const packed: string[] = [];
  let offset = 0;
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index]!;
    const newlineBefore = index === 0 ? -1 : offset - 1;
    const joined = packed.length === 0
      ? line
      : `${packed.at(-1)!} ${line.trimStart()}`;
    if (
      index > 0 && !protectedPositions.has(newlineBefore) &&
      joined.length <= BRIDGE_PACK_MAX_COLUMNS &&
      safeJoin(packed.at(-1)!, line)
    ) {
      packed[packed.length - 1] = joined;
    } else {
      packed.push(line);
    }
    offset += line.length + 1;
  }
  const output = packed.join("\n");
  const before = semanticFacts(source);
  const after = semanticFacts(output);
  const semanticDrift = [
    ["leaf_count", before.leafCount === after.leafCount],
    ["leaf_sha256", before.leafSHA256 === after.leafSHA256],
    ["ast_shape", before.astShapeSHA256 === after.astShapeSHA256],
    ["emit", before.canonicalEmitted === after.canonicalEmitted],
    ["emit_leaf_count", before.emittedLeafCount === after.emittedLeafCount],
    ["emit_leaf_sha256", before.emittedLeafSHA256 === after.emittedLeafSHA256],
    [
      "comments",
      JSON.stringify(before.comments) === JSON.stringify(after.comments),
    ],
    [
      "imports",
      JSON.stringify(before.imports) === JSON.stringify(after.imports),
    ],
    [
      "exports",
      JSON.stringify(before.exports) === JSON.stringify(after.exports),
    ],
    [
      "top_level",
      JSON.stringify(before.topLevelKinds) ===
        JSON.stringify(after.topLevelKinds),
    ],
  ].filter(([, equal]) => !equal).map(([name]) => name);
  if (semanticDrift.length > 0) {
    throw new Error(`bridge_pack_semantics:${semanticDrift.join(",")}`);
  }
  const lineEntries = output.split("\n").length;
  const longestLine = Math.max(
    ...output.split("\n").map((line) => line.length),
  );
  if (
    lineEntries > BRIDGE_PACK_MAX_LINE_ENTRIES || longestLine > 320 ||
    Buffer.byteLength(output) >= 512 * 1024
  ) {
    throw new Error("bridge_pack_bounds");
  }
  return output;
}

export function maintenanceBridgePackFacts(source: string) {
  const semantic = semanticFacts(source);
  const lines = source.split("\n");
  return Object.freeze({
    rawSHA256: sha256(source),
    byteCount: Buffer.byteLength(source),
    lineEntries: lines.length,
    longestLine: Math.max(...lines.map((line) => line.length)),
    leafCount: semantic.leafCount,
    leafSHA256: semantic.leafSHA256,
    astShapeSHA256: semantic.astShapeSHA256,
    emittedLeafCount: semantic.emittedLeafCount,
    emittedLeafSHA256: semantic.emittedLeafSHA256,
    imports: semantic.imports,
    exports: semantic.exports,
    topLevelKinds: semantic.topLevelKinds,
  });
}

if (import.meta.main) {
  const [operation, path] = process.argv.slice(2);
  if (operation !== "--write" || typeof path !== "string") {
    throw new Error(
      "usage: phase-b-refence-maintenance-line-pack.ts --write <path>",
    );
  }
  const before = readFileSync(path, "utf8");
  const after = packMaintenanceBridgeSource(before);
  if (after !== before) writeFileSync(path, after);
}
