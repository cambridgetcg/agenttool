/** rhizome/gitignore — ignore rules derived from the tree, not declared.
 *
 *  The filesystem derivation of the repository scope must skip the same
 *  things git skips, and it must learn them the same way git does: by
 *  reading `.gitignore` files as it walks. A hard-coded `SKIP_DIRS` here
 *  would make rhizome's own scope exactly the construct rhizome exists to
 *  find.
 *
 *  This is a deliberately partial reimplementation of gitignore matching.
 *  Its correctness is not asserted, it is *checked*: the git derivation
 *  and the filesystem derivation are compared file by file, and every
 *  disagreement is reported. If a pattern form is mishandled, the miss
 *  shows up in the report as a disagreement rather than as silence.
 */

/** One compiled ignore pattern, bound to the directory it was read from. */
export interface IgnoreRule {
  /** Repo-relative directory the owning `.gitignore` sits in. `""` = root. */
  base: string;
  /** Original line, kept for evidence. */
  source: string;
  negated: boolean;
  /** Pattern only matches directories (trailing `/`). */
  directoryOnly: boolean;
  /** Anchored patterns match a path relative to `base`; unanchored ones
   *  match any path segment tail, which is git's basename behaviour. */
  anchored: boolean;
  regex: RegExp;
}

function escapeLiteral(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/** Translate a gitignore glob to a regex over a `/`-joined path.
 *
 *  Handles `**`, `*`, `?` and `[...]` classes. Anything else is literal. */
function globToRegex(glob: string, anchored: boolean): RegExp {
  let out = anchored ? "^" : "^(?:.*/)?";
  let i = 0;
  while (i < glob.length) {
    const char = glob[i]!;
    if (char === "*") {
      const doubled = glob[i + 1] === "*";
      if (doubled) {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (char === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close > i) {
        out += glob.slice(i, close + 1);
        i = close + 1;
        continue;
      }
      out += "\\[";
      i += 1;
      continue;
    }
    out += escapeLiteral(char);
    i += 1;
  }
  // A rule matches the path it names and everything beneath it.
  out += "(?:/.*)?$";
  return new RegExp(out);
}

/** Compile one `.gitignore` file's contents into rules bound to `base`. */
export function compileIgnoreFile(base: string, text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split("\n")) {
    const source = raw.replace(/\r$/, "");
    let line = source.trim();
    if (line === "" || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    let directoryOnly = false;
    if (line.endsWith("/")) {
      directoryOnly = true;
      line = line.slice(0, -1);
    }
    if (line === "") continue;
    let anchored = line.includes("/");
    if (line.startsWith("/")) {
      line = line.slice(1);
      anchored = true;
    }
    rules.push({
      base,
      source,
      negated,
      directoryOnly,
      anchored,
      regex: globToRegex(line, anchored),
    });
  }
  return rules;
}

/** Last matching rule wins, which is git's precedence.
 *
 *  `path` is repo-relative POSIX. Rules whose `base` does not prefix the
 *  path do not apply. */
export function isIgnored(path: string, isDirectory: boolean, rules: readonly IgnoreRule[]): IgnoreRule | null {
  let decision: IgnoreRule | null = null;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    const prefix = rule.base === "" ? "" : `${rule.base}/`;
    if (prefix !== "" && !path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (relative === "") continue;
    if (rule.regex.test(relative)) decision = rule;
  }
  if (decision === null) return null;
  return decision.negated ? null : decision;
}
