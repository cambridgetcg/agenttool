import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { domainDigest, sha256 } from "./core.mjs";
import {
  PROVENANCE_DECLARATION,
  PROVENANCE_FORMAT,
  SOURCE_PATHS,
} from "./constants.mjs";

export function buildProvenance(repoRoot) {
  const sourceFiles = [...SOURCE_PATHS].sort().map((path) => {
    const resolved = resolve(repoRoot, path);
    if (!resolved.startsWith(`${resolve(repoRoot)}/`)) throw new Error(`unsafe source path ${path}`);
    const stat = lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`source is not a regular file: ${path}`);
    const bytes = readFileSync(resolved);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const body = { ...PROVENANCE_DECLARATION, source_files: sourceFiles };
  return {
    body,
    provenanceRef: domainDigest(PROVENANCE_FORMAT, body),
  };
}
