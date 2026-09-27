// Ordinary local filesystem boundary, not a hostile same-user sandbox.
import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export class StarterError extends Error {
  constructor(code) {
    super(code);
    this.name = "StarterError";
    this.code = code;
  }
}

export const permissionLabel = process.platform === "win32"
  ? "windows-acl-unverified" : "posix-owner-only";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
export function privateMode(stat) {
  return process.platform === "win32" ||
    (stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
}

export function rootDirectory(input) {
  if (typeof input !== "string" || !input || /[\x00-\x1f\x7f]/.test(input))
    throw new StarterError("unsafe_root");
  const requested = path.resolve(input);
  let before;
  try { before = fs.lstatSync(requested); }
  catch (error) {
    throw new StarterError(error.code === "ENOENT" ? "missing_root" : "unsafe_root");
  }
  if (!before.isDirectory() || before.isSymbolicLink() || !privateMode(before))
    throw new StarterError("unsafe_root");
  try {
    const canonical = fs.realpathSync(requested);
    const after = fs.lstatSync(canonical);
    if (!sameFile(before, after) || !after.isDirectory() || !privateMode(after))
      throw new StarterError("unsafe_root");
    return { path: canonical, stat: after };
  } catch {
    throw new StarterError("unsafe_root");
  }
}

export function checkRoot(root) {
  try {
    const current = fs.lstatSync(root.path);
    if (current.isDirectory() && !current.isSymbolicLink() &&
        privateMode(current) && sameFile(current, root.stat)) return;
  } catch { /* Missing/replaced roots are equally unavailable. */ }
  throw new StarterError("unsafe_root");
}

function regularPrivate(stat) {
  return stat.isFile() && stat.nlink === 1 && privateMode(stat);
}

// Read only a fixed child filename. Never follow source symlinks, or block on
// FIFOs/devices. Rechecks reduce ordinary replacement races; an adversarial
// same-user writer can still race pathname operations.
export function readFileBounded(root, name, limit) {
  checkRoot(root);
  const file = path.join(root.path, name);
  let before;
  try { before = fs.lstatSync(file); }
  catch (error) {
    return { status: error.code === "ENOENT" ? "missing" : "unsafe_file" };
  }
  if (!regularPrivate(before)) return { status: "unsafe_file" };
  const metadata = {
    bytes: before.size,
    modified_at: before.mtime.toISOString(),
  };
  if (before.size > limit) return { status: "too_large", ...metadata };
  let fd;
  try {
    const flags = fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
    fd = fs.openSync(file, flags);
    const opened = fs.fstatSync(fd);
    if (!regularPrivate(opened) || !sameFile(before, opened))
      return { status: "unsafe_file" };
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (!regularPrivate(after) || !regularPrivate(named) ||
        !sameFile(opened, after) || !sameFile(after, named) ||
        opened.size !== after.size || opened.mtimeMs !== after.mtimeMs ||
        opened.ctimeMs !== after.ctimeMs || after.ctimeMs !== named.ctimeMs ||
        after.mtimeMs !== named.mtimeMs || after.size !== named.size ||
        after.size !== length || !sameFile(root.stat, fs.lstatSync(root.path)))
      return { status: "unsafe_file" };
    if (length > limit) return { status: "too_large", ...metadata };
    const bytes = buffer.subarray(0, length);
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content)) throw new Error();
    } catch {
      return { status: "invalid_utf8", ...metadata };
    }
    return {
      status: content.trim() ? "ready" : "empty",
      bytes: length,
      sha256: sha256(bytes),
      modified_at: after.mtime.toISOString(),
      content,
    };
  } catch {
    return { status: "unsafe_file" };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function exclusiveFile(file, bytes) {
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    return fs.fstatSync(fd);
  } finally { fs.closeSync(fd); }
}

// Cleanup only a file we created and still recognize. Never remove another
// writer's or a substituted lock/temp path.
export function removeOwned(file, stat) {
  if (!stat) return;
  try {
    const current = fs.lstatSync(file);
    if (current.isFile() && current.nlink === 1 && sameFile(current, stat))
      fs.unlinkSync(file);
  } catch { /* A failure leaves a visible lock/temp, not a stolen lock. */ }
}
