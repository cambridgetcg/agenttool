import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";

import { fail } from "./errors.js";

export function readBoundedRegularFile(path: string, maximumBytes: number): Uint8Array {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail("file_error", `Cannot stat explicit input file: ${path}`);
  }
  if (!stat.isFile()) fail("file_error", `Explicit input is not a regular file: ${path}`);
  if (stat.size < 1 || stat.size > maximumBytes) {
    fail("file_error", `Input file must be 1..${maximumBytes} bytes: ${path}`);
  }

  const descriptor = openSync(path, "r");
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      fail("file_error", `Input file changed while opening: ${path}`);
    }
    const output = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < output.length) {
      const count = readSync(descriptor, output, offset, output.length - offset, offset);
      if (count === 0) fail("file_error", `Input file ended early: ${path}`);
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      fail("file_error", `Input file changed while reading: ${path}`);
    }
    return output;
  } finally {
    closeSync(descriptor);
  }
}
