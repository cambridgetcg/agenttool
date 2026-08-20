import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { MAX_JSON_BYTES } from "./constants.js";
import { fail } from "./errors.js";

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function readBoundedLocalFile(inputPath: string, workingDirectory = process.cwd()): Uint8Array {
  if (
    inputPath.length === 0 ||
    inputPath.length > 4_096 ||
    inputPath.includes("\0") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(inputPath)
  ) {
    fail("argument_error", "Input must be a bounded local path, not a URL or URI");
  }
  let root: string;
  let requested: string;
  let parent: string;
  try {
    root = realpathSync(workingDirectory);
    requested = resolve(root, inputPath);
    parent = realpathSync(dirname(requested));
  } catch {
    fail("argument_error", "Input path or its parent cannot be resolved");
  }
  if (!inside(root, parent) || !inside(root, requested)) {
    fail("argument_error", "Input must remain inside the explicit working directory");
  }
  if (parent !== dirname(requested)) {
    fail("argument_error", "Input path must not traverse an intermediate symbolic link");
  }
  if (typeof fsConstants.O_NOFOLLOW !== "number") {
    fail("argument_error", "This runtime cannot enforce no-follow local reads");
  }
  let descriptor: number;
  try {
    descriptor = openSync(
      requested,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch {
    fail("argument_error", "Input must be an existing non-symlink local file");
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      fail("argument_error", "Input must be one regular file, not a link or special file");
    }
    if (before.size <= 0n || before.size > BigInt(MAX_JSON_BYTES)) {
      fail("argument_error", `Input file must be 1..${String(MAX_JSON_BYTES)} bytes`);
    }
    const bounded = Buffer.allocUnsafe(MAX_JSON_BYTES + 1);
    let offset = 0;
    try {
      while (offset < bounded.byteLength) {
        const count = readSync(descriptor, bounded, offset, bounded.byteLength - offset, null);
        if (count === 0) break;
        offset += count;
      }
    } catch {
      fail("argument_error", "Input file could not be read through its pinned descriptor");
    }
    if (offset > MAX_JSON_BYTES) fail("argument_error", "Input grew beyond the byte bound while read");
    const bytes = new Uint8Array(bounded.subarray(0, offset));
    const after = fstatSync(descriptor, { bigint: true });
    let finalPath: string;
    let finalMetadata: ReturnType<typeof statSync>;
    try {
      finalPath = realpathSync(requested);
      finalMetadata = statSync(requested, { bigint: true });
    } catch {
      fail("argument_error", "Input path changed while its descriptor was being read");
    }
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      bytes.byteLength !== Number(before.size) ||
      bytes.byteLength > MAX_JSON_BYTES ||
      finalPath !== requested ||
      !inside(root, finalPath) ||
      finalMetadata.dev !== after.dev ||
      finalMetadata.ino !== after.ino ||
      !finalMetadata.isFile()
    ) {
      fail("argument_error", "Input changed while it was being read or exceeded the byte bound");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}
