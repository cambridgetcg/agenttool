import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { SKIPPED_DIRECTORIES } from "./constants.js";
import type { InspectionIssue, InspectionLimits } from "./types.js";
import { compareStrings } from "./stable-json.js";

export interface InternalFile {
  absolutePath: string;
  path: string;
  bytes: number;
  device: number;
  inode: number;
  mtimeMs: number;
  ctimeMs: number;
  readableWithinLimits: boolean;
}

export type InternalFileReader = (file: InternalFile) => Promise<Buffer | null>;

export interface InternalSymlink {
  path: string;
  escapes: boolean;
}

export interface InventoryResult {
  files: InternalFile[];
  symlinks: InternalSymlink[];
  incompletePaths: string[];
  issues: InspectionIssue[];
  truncated: boolean;
}

function portablePath(path: string): string {
  return path.split(sep).join("/") || ".";
}

export function relativePortable(root: string, path: string): string {
  return portablePath(relative(root, path));
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export async function inventoryTree(root: string, limits: InspectionLimits): Promise<InventoryResult> {
  const files: InternalFile[] = [];
  const symlinks: InternalSymlink[] = [];
  const incompletePaths: string[] = [];
  const issues: InspectionIssue[] = [];
  let entries = 0;
  let totalBytes = 0;
  let truncated = false;

  async function walk(directory: string, depth: number): Promise<void> {
    if (truncated) return;
    if (depth > limits.maxDepth) {
      issues.push({
        severity: "error",
        code: "MAX_DEPTH_EXCEEDED",
        path: relativePortable(root, directory),
        message: "The bounded inspection depth was exceeded; this subtree was not read.",
      });
      truncated = true;
      return;
    }

    let names: string[];
    try {
      names = (await readdir(directory)).sort(compareStrings);
    } catch {
      incompletePaths.push(relativePortable(root, directory));
      issues.push({
        severity: "error",
        code: "DIRECTORY_UNREADABLE",
        path: relativePortable(root, directory),
        message: "A directory could not be read.",
      });
      return;
    }

    for (const name of names) {
      if (truncated) return;
      entries += 1;
      const absolutePath = resolve(directory, name);
      const path = relativePortable(root, absolutePath);
      if (entries > limits.maxEntries) {
        issues.push({
          severity: "error",
          code: "MAX_ENTRIES_EXCEEDED",
          path,
          message: "The bounded inspection entry limit was exceeded; remaining entries were not read.",
        });
        truncated = true;
        return;
      }

      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch {
        incompletePaths.push(path);
        issues.push({
          severity: "error",
          code: "ENTRY_UNREADABLE",
          path,
          message: "An entry could not be inspected.",
        });
        continue;
      }

      if (stat.isSymbolicLink()) {
        let escapes = false;
        try {
          const target = await readlink(absolutePath);
          escapes = !isWithin(root, resolve(directory, target));
        } catch {
          // The static issue below is intentionally independent of raw OS errors.
        }
        symlinks.push({ path, escapes });
        issues.push({
          severity: "error",
          code: escapes ? "SYMLINK_ESCAPE" : "SYMLINK_NOT_ALLOWED",
          path,
          message: escapes
            ? "A symlink resolves outside the inspection root; symlinks are never followed."
            : "Symlinks are not accepted by the v0 inspector and are never followed.",
        });
        continue;
      }

      if (stat.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(name)) incompletePaths.push(path);
        else await walk(absolutePath, depth + 1);
        continue;
      }

      if (!stat.isFile()) {
        incompletePaths.push(path);
        issues.push({
          severity: "error",
          code: "UNSUPPORTED_FILE_TYPE",
          path,
          message: "Only regular files and directories can be inspected.",
        });
        continue;
      }

      const withinFileLimit = stat.size <= limits.maxFileBytes;
      const withinTotalLimit = totalBytes + stat.size <= limits.maxTotalBytes;
      files.push({
        absolutePath,
        path,
        bytes: stat.size,
        device: stat.dev,
        inode: stat.ino,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        readableWithinLimits: withinFileLimit && withinTotalLimit,
      });

      if (!withinFileLimit) {
        issues.push({
          severity: "error",
          code: "MAX_FILE_BYTES_EXCEEDED",
          path,
          message: "A file exceeds the bounded per-file byte limit and was not read.",
        });
      }
      if (!withinTotalLimit) {
        issues.push({
          severity: "error",
          code: "MAX_TOTAL_BYTES_EXCEEDED",
          path,
          message: "The bounded total byte limit was exceeded; remaining entries were not read.",
        });
        truncated = true;
        return;
      }
      totalBytes += stat.size;
    }
  }

  await walk(root, 0);
  files.sort((a, b) => compareStrings(a.path, b.path));
  symlinks.sort((a, b) => compareStrings(a.path, b.path));
  incompletePaths.sort(compareStrings);
  return { files, symlinks, incompletePaths, issues, truncated };
}

export async function readBoundedFile(file: InternalFile): Promise<Buffer | null> {
  if (!file.readableWithinLimits) return null;
  let handle;
  try {
    handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!sameObservedFile(file, before)) {
      return null;
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    return sameObservedFile(file, after) ? bytes : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function sameObservedFile(
  file: InternalFile,
  current: Stats,
): boolean {
  return current.isFile() &&
    current.dev === file.device &&
    current.ino === file.inode &&
    current.size === file.bytes &&
    current.mtimeMs === file.mtimeMs &&
    current.ctimeMs === file.ctimeMs;
}
