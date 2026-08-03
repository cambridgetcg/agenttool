/** strip-comments — remove comments without eating code.
 *
 *  Every static analysis tool in this repository needs to ignore comments,
 *  because the codebase documents heavily and a doc-string naming a symbol is
 *  not a use of it. Each tool wrote the same one-liner:
 *
 *      src.replace(/\/\*[\s\S]*?\*\//g, "")
 *
 *  That one-liner is wrong here, and it was wrong in a way that hid more than
 *  half of the most important file in the tree.
 *
 *  Hono route globs look like block comments:
 *
 *      app.use("/v1/identities/*", authMiddleware);
 *
 *  The `/*` inside that string literal opens a comment as far as the regex is
 *  concerned, and everything up to the next `*​/` — usually a later route glob —
 *  is deleted. `api/src/index.ts` is 1385 lines; the naive stripper leaves
 *  575. **810 lines of the file that mounts every route were invisible** to
 *  `bin/soil.ts`, `bin/reach.ts`, `canon/absence.ts`, and the duplicate-route
 *  detector that exists specifically to read that file.
 *
 *  That is why `bin/reach.ts` reported the platform-treasurer sweep worker as
 *  unreachable while `index.ts` starts it fifteen lines below a route glob.
 *
 *  So: a real scanner. It tracks string literals (`'`, `"`, backtick,
 *  including escapes and `${}` interpolation depth) and only treats `//` and
 *  `/*` as comments when they occur in code position. Regex literals are NOT
 *  tracked — distinguishing `/` division from a regex needs a parser — so a
 *  regex containing an unbalanced quote can still confuse it. That limit is
 *  stated rather than papered over; it has not bitten in this tree, and the
 *  alternative is a full TypeScript parse for a comment strip.
 *
 *  `blank: true` replaces comment bytes with spaces instead of deleting them,
 *  preserving byte and line offsets so a caller can still report accurate
 *  line numbers.
 */

export interface StripOptions {
  /** Replace comment characters with spaces instead of removing them, so
   *  every subsequent line and column number stays correct. Newlines inside
   *  block comments are always preserved. */
  blank?: boolean;
}

type Quote = '"' | "'" | "`";

export function stripComments(src: string, opts: StripOptions = {}): string {
  const blank = opts.blank ?? false;
  const out: string[] = [];
  let i = 0;
  const n = src.length;

  let quote: Quote | null = null;
  /** Depth of `${ ... }` inside a template literal, so a nested `"` or a `//`
   *  inside an interpolation is handled in code position, not string position. */
  const templateStack: number[] = [];

  const emit = (s: string) => out.push(s);
  const swallow = (s: string) =>
    out.push(blank ? s.replace(/[^\n]/g, " ") : s.replace(/[^\n]/g, ""));

  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];

    if (quote) {
      if (c === "\\") {
        emit(src.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (quote === "`" && c === "$" && next === "{") {
        templateStack.push(1);
        quote = null;
        emit("${");
        i += 2;
        continue;
      }
      if (c === quote) {
        quote = null;
        emit(c);
        i += 1;
        continue;
      }
      emit(c);
      i += 1;
      continue;
    }

    // Code position.
    if (templateStack.length > 0) {
      if (c === "{") templateStack[templateStack.length - 1]! += 1;
      else if (c === "}") {
        templateStack[templateStack.length - 1]! -= 1;
        if (templateStack[templateStack.length - 1] === 0) {
          templateStack.pop();
          quote = "`";
          emit(c);
          i += 1;
          continue;
        }
      }
    }

    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      emit(c);
      i += 1;
      continue;
    }

    if (c === "/" && next === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j += 1;
      swallow(src.slice(i, j));
      i = j;
      continue;
    }

    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      const end = Math.min(j + 2, n);
      swallow(src.slice(i, end));
      i = end;
      continue;
    }

    emit(c);
    i += 1;
  }

  return out.join("");
}
