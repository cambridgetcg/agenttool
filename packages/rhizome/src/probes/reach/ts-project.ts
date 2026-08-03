/** rhizome/probes/reach/ts-project — real TypeScript programs, derived.
 *
 *  Reachability cannot be answered by matching identifier text. The
 *  previous version of this probe tried, and the proof that it does not
 *  work is that removing the `version` parameter from `ThoughtsClient
 *  .add()` — the exact bug the probe was written to find — changed its
 *  output by zero bytes. A name is not a binding; only a resolver knows
 *  which declaration an identifier means.
 *
 *  So this module builds real `ts.Program`s and hands out the checker.
 *
 *  Two properties matter and are held here rather than left implicit:
 *
 *  1. **Nothing is hard-coded.** Which projects exist is read out of the
 *     corpus: a directory holding both `tsconfig.json` and `package.json`
 *     is a project. No package list, no directory list.
 *  2. **`typescript` is not a runtime dependency of rhizome.** It is a
 *     devDependency, it is imported dynamically, and when it cannot be
 *     resolved every analysis that needs it degrades to a stated `limit`
 *     rather than to a quietly shorter run. `unavailable` carries the
 *     reason verbatim.
 */

import type { Scope } from "../../types.js";

export type Ts = typeof import("typescript");

export interface TsProject {
  /** Repo-relative directory holding the `tsconfig.json`, e.g. `api`. */
  directory: string;
  program: import("typescript").Program;
  checker: import("typescript").TypeChecker;
  /** Repo-relative POSIX path → the program's source file. */
  sources: Map<string, import("typescript").SourceFile>;
  /** Absolute compiler path → repo-relative POSIX, or `null` when the
   *  file lives outside the repository (a dependency's `.d.ts`). */
  relativeOf(fileName: string): string | null;
}

/** Absolute path → repo-relative POSIX, or `null` when outside the root. */
function relativeTo(root: string, absolute: string): string | null {
  const normalisedRoot = root.endsWith("/") ? root : `${root}/`;
  const normalised = absolute.split("\\").join("/");
  if (!normalised.startsWith(normalisedRoot)) return null;
  return normalised.slice(normalisedRoot.length);
}

/** Every TypeScript project in the corpus, built on demand.
 *
 *  Programs are built lazily and cached: constructing one for `api` is
 *  about a second, and a run that touches three packages should not pay
 *  for fifteen. */
export class TsProjects {
  /** Non-null when `typescript` could not be loaded; the verbatim reason. */
  readonly unavailable: string | null;

  private readonly ts: Ts | null;
  private readonly root: string;
  /** Repo-relative project directories, longest first so the *nearest*
   *  enclosing project wins for a nested package. */
  private readonly directories: readonly string[];
  private readonly built = new Map<string, TsProject | null>();

  private constructor(ts: Ts | null, unavailable: string | null, root: string, directories: readonly string[]) {
    this.ts = ts;
    this.unavailable = unavailable;
    this.root = root;
    this.directories = directories;
  }

  static async open(scope: Scope): Promise<TsProjects> {
    let ts: Ts | null = null;
    let unavailable: string | null = null;
    try {
      ts = (await import("typescript")) as unknown as Ts;
      // A namespace import of a CJS module can arrive wrapped in `default`.
      const wrapped = (ts as unknown as { default?: Ts }).default;
      if (wrapped !== undefined && typeof (ts as { createProgram?: unknown }).createProgram !== "function") {
        ts = wrapped;
      }
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
    }

    // Which projects exist is read out of the corpus, never listed.
    const manifests = new Set<string>();
    const configs = new Set<string>();
    for (const file of scope.files) {
      if (file.includes("node_modules/")) continue;
      const at = file.lastIndexOf("/");
      const directory = at === -1 ? "" : file.slice(0, at);
      const base = file.slice(at + 1);
      if (base === "package.json") manifests.add(directory);
      if (base === "tsconfig.json") configs.add(directory);
    }
    const directories = [...configs]
      .filter((directory) => directory !== "" && manifests.has(directory))
      .sort((a, b) => b.length - a.length);

    return new TsProjects(ts, unavailable, scope.root, directories);
  }

  /** The compiler namespace, or `null` when it could not be loaded. */
  get api(): Ts | null {
    return this.ts;
  }

  /** Repo-relative project directories, nearest-first. */
  get projectDirectories(): readonly string[] {
    return this.directories;
  }

  /** The project that owns `file` (repo-relative), building it on first ask. */
  forFile(file: string): TsProject | null {
    for (const directory of this.directories) {
      if (file.startsWith(`${directory}/`)) return this.forDirectory(directory);
    }
    return null;
  }

  forDirectory(directory: string): TsProject | null {
    const cached = this.built.get(directory);
    if (cached !== undefined) return cached;
    const project = this.build(directory);
    this.built.set(directory, project);
    return project;
  }

  private build(directory: string): TsProject | null {
    const ts = this.ts;
    if (ts === null) return null;
    const absolute = `${this.root}/${directory}`;
    let project: TsProject | null = null;
    try {
      const configPath = `${absolute}/tsconfig.json`;
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      if (config.error !== undefined) return null;
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, absolute);
      if (parsed.fileNames.length === 0) return null;
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: {
          ...parsed.options,
          noEmit: true,
          skipLibCheck: true,
          skipDefaultLibCheck: true,
          declaration: false,
          declarationMap: false,
          sourceMap: false,
          incremental: false,
          composite: false,
        },
      });
      const sources = new Map<string, import("typescript").SourceFile>();
      for (const source of program.getSourceFiles()) {
        if (source.isDeclarationFile) continue;
        const relative = relativeTo(this.root, source.fileName);
        if (relative !== null) sources.set(relative, source);
      }
      const root = this.root;
      project = {
        directory,
        program,
        checker: program.getTypeChecker(),
        sources,
        relativeOf: (fileName: string): string | null => relativeTo(root, fileName),
      };
    } catch {
      project = null;
    }
    return project;
  }

  /** Repo-relative path of a source file the compiler resolved. */
  relativeOf(fileName: string): string | null {
    return relativeTo(this.root, fileName);
  }
}
