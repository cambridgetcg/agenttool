/** Bounded, link-refusing reads of native transcript files. Native files are never written. */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { SeatError } from "./errors.js";

const CHUNK = 1 << 20;
const MAX_META_BYTES = 64 * 1024;

function openRegular(path: string): number {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new SeatError(code === "ENOENT" ? "native_missing" : "native_unreadable", "the native file cannot be opened");
  }
  if (!fstatSync(fd).isFile()) {
    closeSync(fd);
    throw new SeatError("native_unreadable", "the native path is not a regular file");
  }
  return fd;
}

/** Call `onLine` for each non-empty line, streaming in 1 MiB chunks. Returns the last non-empty line. */
export function scanLines(path: string, onLine: (line: string, index: number) => void): string | null {
  const fd = openRegular(path);
  const buffer = Buffer.allocUnsafe(CHUNK);
  const decoder = new TextDecoder("utf-8");
  let carry = "";
  let index = 0;
  let last: string | null = null;
  const emit = (line: string) => {
    if (line.length === 0) return;
    last = line;
    onLine(line, index++);
  };
  try {
    for (;;) {
      const count = readSync(fd, buffer, 0, CHUNK, null);
      if (count === 0) break;
      const text = carry + decoder.decode(buffer.subarray(0, count), { stream: true });
      const parts = text.split("\n");
      carry = parts.pop() ?? "";
      for (const part of parts) emit(part);
    }
    emit(carry + decoder.decode());
  } finally {
    closeSync(fd);
  }
  return last;
}

/** Parse a small JSON object such as a subagent meta file. Larger or invalid files read as null. */
export function readSmallJson(path: string): Record<string, unknown> | null {
  let fd: number;
  try {
    fd = openRegular(path);
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    if (size > MAX_META_BYTES) return null;
    const buffer = Buffer.allocUnsafe(size);
    readSync(fd, buffer, 0, size, 0);
    return parseObject(buffer.toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

export function parseObject(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
