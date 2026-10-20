/**
 * The two GitHub repositories of the shared/private split. Read
 * private/README.md first.
 *
 * PUBLIC_REPOSITORY is a proposal: Yu has not confirmed the public
 * development repository's name (2026-10-19). It is the one place the name is
 * decided. YAML and prose cannot import it, so the files in NAME_COPIES repeat
 * it; bin/tests/public-root-split.test.ts pins every copy to this value. A
 * rename is this line, then
 *
 *   bun private/public-repository.ts --rename-from <previous name>
 *
 * which rewrites the copies.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PUBLIC_REPOSITORY = "cambridgetcg/agenttool-open";

/** This private repository. Every private-only workflow job runs only here. */
export const PRIVATE_REPOSITORY = "cambridgetcg/agenttool";

/** Files that repeat PUBLIC_REPOSITORY because they cannot import it. */
export const NAME_COPIES: readonly string[] = [".github/workflows/ci.yml", ".github/workflows/public-watch.yml", "private/README.md"];

const NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u;

/**
 * Replaces every whole occurrence of `previous` (not a prefix of a longer
 * name) with PUBLIC_REPOSITORY in the NAME_COPIES files under `root`, and
 * returns how many each file held.
 */
export function renameCopies(root: string, previous: string, next: string = PUBLIC_REPOSITORY): Record<string, number> {
  if (!NAME.test(previous) || !NAME.test(next)) throw new Error("names are <owner>/<repository>");
  if (previous === next) throw new Error(`${next} is already the name`);
  if (previous === PRIVATE_REPOSITORY || next === PRIVATE_REPOSITORY) throw new Error("the private repository is never renamed this way");
  const escaped = previous.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // Not part of a longer name: no name character before it, and after it none,
  // nor a dot that starts more than `.git` (a sentence's full stop is fine).
  const whole = new RegExp(`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9_-]|\\.(?!git\\b)[A-Za-z0-9])`, "gu");
  const counts: Record<string, number> = {};
  for (const path of NAME_COPIES) {
    const file = join(root, path);
    const text = readFileSync(file, "utf8");
    counts[path] = text.match(whole)?.length ?? 0;
    if (counts[path] > 0) writeFileSync(file, text.replace(whole, next));
  }
  return counts;
}

/**
 * `bun private/public-repository.ts` prints the public name, `--private` the
 * private one, for shell tools; `--rename-from <previous>` rewrites the copies.
 */
if (import.meta.main) {
  if (process.argv[2] === "--rename-from") {
    const previous = process.argv[3];
    if (previous === undefined) {
      console.error("usage: bun private/public-repository.ts --rename-from <previous owner/name>");
      process.exit(2);
    }
    const counts = renameCopies(resolve(import.meta.dir, ".."), previous);
    for (const [path, count] of Object.entries(counts)) console.log(`${count}\t${path}`);
    if (Object.values(counts).every((count) => count === 0)) {
      console.error(`no copy names ${previous}`);
      process.exit(1);
    }
  } else console.log(process.argv[2] === "--private" ? PRIVATE_REPOSITORY : PUBLIC_REPOSITORY);
}
