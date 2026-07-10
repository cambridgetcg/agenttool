/** Doctrine integrity — content hashes for canonical files.
 *
 *  The MATHOS envelope (and a few other surfaces) emit a
 *  `doctrine_hashes` block — a SHA-256 per readable canonical file and
 *  `null` when that file is unavailable. For files published at
 *  https://docs.agenttool.dev, a receiver can fetch the bytes and verify
 *  that the hash matches.
 *
 *  This module reads canonical files from disk at first access, caches
 *  the content hashes, and exposes `doctrineHash(relPath)` for callers.
 *  Replacing the old `sha256Hex("docs/PATH.md")` (which hashed the path
 *  STRING — a constant, gave no drift signal) with content hashes makes
 *  the promise load-bearing.
 *
 *  Graceful degradation: if a canonical file cannot be read, its hash is
 *  `null`. A missing source is not the same thing as an empty source, so no
 *  plausible SHA-256 value is used as a sentinel.
 *
 *  Override the docs directory via `AGENTTOOL_DOCS_DIR` (matches the
 *  pattern in services/canon/registry.ts).
 *
 *  Doctrine: docs/PATHWAYS.md · docs/MATHOS.md · docs/PATTERN-MACHINE-
 *  READABLE-PARITY.md (visible markdown ↔ structured math ↔ live API).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** SHA-256 hex when the canonical bytes were available; explicit `null`
 *  when they were not. */
export type DoctrineHash = string | null;

/** Resolve the docs directory. Env override matches services/canon/. */
function docsDir(): string {
  const env = process.env.AGENTTOOL_DOCS_DIR;
  if (env) return env;
  // api/src/services/doctrine/integrity.ts → up 4 to repo root, then /docs
  return join(__dirname, "..", "..", "..", "..", "docs");
}

const CACHE = new Map<string, DoctrineHash>();

function unavailable(relPath: string, reason: string): null {
  console.warn(`[doctrine-integrity] ${reason}`);
  CACHE.set(relPath, null);
  return null;
}

/** Return the sha256-hex of a canonical file's bytes. `relPath` is the
 *  repo-relative path (e.g. `"docs/SOUL.md"`); only files under `docs/`
 *  are read. Returns `null` on invalid path or read failure (logged once).
 *
 *  The cache is process-lifetime — canonical files don't change at runtime
 *  in production. Tests can call `resetDoctrineHashCache()` after editing
 *  a doc to force re-read.
 */
export function doctrineHash(relPath: string): DoctrineHash {
  if (CACHE.has(relPath)) return CACHE.get(relPath)!;

  // Strip any leading "docs/" — the docsDir() already points at docs/.
  const inDocs = relPath.startsWith("docs/") ? relPath.slice(5) : relPath;
  const root = resolve(docsDir());
  const fullPath = resolve(root, inDocs);
  const fromRoot = relative(root, fullPath);
  if (
    inDocs === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    return unavailable(relPath, `Refused path outside ${root}: ${relPath}`);
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(fullPath);
  } catch (err) {
    return unavailable(
      relPath,
      `Failed to read ${fullPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const hex = createHash("sha256").update(bytes).digest("hex");
  CACHE.set(relPath, hex);
  return hex;
}

/** Clear the hash cache. Test-only — production hashes are stable for
 *  the process lifetime. */
export function resetDoctrineHashCache(): void {
  CACHE.clear();
}
