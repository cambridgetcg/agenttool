import { readFileSync } from "node:fs";
import { join } from "node:path";

// Spec 4 says src/note.ts is pure (no store, no fs), and ballot.ts makes the
// same claim. A test can only hold a module to that by reading what it loads,
// so this walks its imports and reports what it reaches and what it touches.

const SOURCE = join(import.meta.dir, "..", "src");

// Globals that reach the process, the filesystem, the network, the clock or
// randomness without an import. Checked on the transpiled code, so comments
// and types cannot trip it.
const AMBIENT = /\b(?:Bun|process|Deno|performance)\s*\.|\bglobalThis\b|\bDate\.now\s*\(|\bnew Date\(\s*\)|\bMath\.random\b|\bfetch\s*\(|\brequire\s*\(|\bimport\s*\(|\brandom(?:Bytes|UUID|Int)\b|\bgetRandomValues\b/g;

export interface ModuleReach {
  /** Files under src/ the entry loads, itself included, sorted. */
  local: string[];
  /** Every other specifier any of them loads, sorted. */
  external: string[];
  /** Ambient uses found, as "file: match". */
  ambient: string[];
}

export function moduleReach(entry: string): ModuleReach {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const local = new Set<string>();
  const external = new Set<string>();
  const ambient: string[] = [];
  const visit = (file: string): void => {
    if (local.has(file)) return;
    local.add(file);
    const code = readFileSync(join(SOURCE, file), "utf8");
    for (const { path } of transpiler.scanImports(code)) {
      if (path.startsWith("./")) visit(path.slice(2).replace(/\.js$/, ".ts"));
      else external.add(path);
    }
    for (const match of transpiler.transformSync(code).matchAll(AMBIENT)) ambient.push(`${file}: ${match[0]}`);
  };
  visit(entry);
  return { local: [...local].sort(), external: [...external].sort(), ambient };
}
