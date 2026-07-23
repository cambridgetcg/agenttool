import { isAbsolute, resolve } from "node:path";
import { isWithin } from "./inventory.js";

const WINDOWS_DRIVE = /^[A-Za-z]:/;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function isUnsafePortableLocalPath(root: string, candidate: string): boolean {
  if (candidate.length === 0 || candidate.includes("\0") || candidate.includes("\\")) return true;
  const normalized = candidate.replaceAll("\\", "/");
  if (
    isAbsolute(candidate) ||
    WINDOWS_DRIVE.test(candidate) ||
    normalized.startsWith("//") ||
    URI_SCHEME.test(candidate) ||
    normalized.split("/").includes("..")
  ) return true;
  return !isWithin(root, resolve(root, normalized));
}
