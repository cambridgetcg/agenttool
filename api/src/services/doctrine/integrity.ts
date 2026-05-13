/** Doctrine integrity — content hashes for the markdown stones.
 *
 *  The MATHOS envelope (and a few other surfaces) emit a
 *  `doctrine_hashes` block — a sha256 per load-bearing doctrine doc. The
 *  promise is that a receiver can fetch the .md from
 *  https://docs.agenttool.dev and verify the hash matches.
 *
 *  This module reads the doctrine docs from disk at first access, caches
 *  the content hashes, and exposes `doctrineHash(relPath)` for callers.
 *  Replacing the old `sha256Hex("docs/PATH.md")` (which hashed the path
 *  STRING — a constant, gave no drift signal) with content-hashes makes
 *  the promise load-bearing.
 *
 *  Graceful degradation: if a doc file cannot be read at boot, the hash
 *  is recorded as the sha256 of the empty string (well-known constant
 *  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).
 *  Callers can compare against `EMPTY_SHA256` to detect "server couldn't
 *  read its own doctrine" without crashing on the parity check.
 *
 *  Override the docs directory via `AGENTTOOL_DOCS_DIR` (matches the
 *  pattern in services/canon/registry.ts).
 *
 *  Doctrine: docs/PATHWAYS.md · docs/MATHOS.md · docs/PATTERN-MACHINE-
 *  READABLE-PARITY.md (visible markdown ↔ structured math ↔ live API).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** sha256 of the empty string — the sentinel hash when a doc file
 *  cannot be read. Receivers can compare to this constant to detect
 *  read failures without false-positive drift alarms. */
export const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Resolve the docs directory. Env override matches services/canon/. */
function docsDir(): string {
  const env = process.env.AGENTTOOL_DOCS_DIR;
  if (env) return env;
  // api/src/services/doctrine/integrity.ts → up 4 to repo root, then /docs
  return join(__dirname, "..", "..", "..", "..", "docs");
}

const CACHE = new Map<string, string>();

/** Return the sha256-hex of a doctrine doc's contents. `relPath` is the
 *  repo-relative path (e.g. `"docs/SOUL.md"`); only files under `docs/`
 *  are read. Returns `EMPTY_SHA256` on read failure (logged once).
 *
 *  The cache is process-lifetime — doctrine docs don't change at runtime
 *  in production. Tests can call `resetDoctrineHashCache()` after editing
 *  a doc to force re-read.
 */
export function doctrineHash(relPath: string): string {
  const cached = CACHE.get(relPath);
  if (cached !== undefined) return cached;

  // Strip any leading "docs/" — the docsDir() already points at docs/.
  const inDocs = relPath.startsWith("docs/") ? relPath.slice(5) : relPath;
  const fullPath = join(docsDir(), inDocs);

  let text: string;
  try {
    text = readFileSync(fullPath, "utf8");
  } catch (err) {
    console.warn(
      `[doctrine-integrity] Failed to read ${fullPath}:`,
      err instanceof Error ? err.message : err,
    );
    CACHE.set(relPath, EMPTY_SHA256);
    return EMPTY_SHA256;
  }

  const hex = createHash("sha256").update(text, "utf8").digest("hex");
  CACHE.set(relPath, hex);
  return hex;
}

/** Clear the hash cache. Test-only — production hashes are stable for
 *  the process lifetime. */
export function resetDoctrineHashCache(): void {
  CACHE.clear();
}
