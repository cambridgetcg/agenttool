import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { base64UrlDecode, base64UrlEncode, canonicalJson, sha256Id, strictEd25519Verify, type Ed25519PublicKey } from "@agenttool/wallet";
import { fail } from "./errors.js";

export const MAX_JSON = 262144;
export function check(ok: unknown, code = "invalid_input"): asserts ok { if (!ok) fail(code, "Seed runtime rejected input or state"); }
export function closed(value: unknown, keys: string): asserts value is Record<string, any> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  check(Object.keys(value).sort().join(" ") === keys.split(" ").sort().join(" "));
}
export function hash(value: unknown): asserts value is `sha256:${string}` { check(typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)); }
export function uint(value: unknown, positive = false): asserts value is string {
  check(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n && (!positive || value !== "0"));
}
export function u64(value: unknown, positive = false): asserts value is string { uint(value, positive); check(BigInt(value) < 2n ** 64n); }
export function timestamp(value: unknown): number {
  check(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));
  const n = Date.parse(value); check(Number.isFinite(n) && new Date(n).toISOString() === value); return n;
}
export function window(issued: string, expires: string, now: string, maxMs: number): void {
  const i = timestamp(issued), e = timestamp(expires), n = timestamp(now);
  check(i <= n && n < e && e > i && e - i <= maxMs, "not_current");
}
export function b64(value: unknown, length?: number): Uint8Array {
  check(typeof value === "string"); const bytes = base64UrlDecode(value);
  check(base64UrlEncode(bytes) === value && (length === undefined || bytes.length === length)); return bytes;
}
export function publicKey(value: unknown): asserts value is Ed25519PublicKey {
  closed(value, "algorithm key_id public_key"); check(value.algorithm === "Ed25519");
  const bytes = b64(value.public_key, 32); check(value.key_id === digest(bytes));
}
export function digest(bytes: Uint8Array): `sha256:${string}` { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
export function same(a: unknown, b: unknown): void { check(canonicalJson(a) === canonicalJson(b), "binding_mismatch"); }
export function freeze<T>(v: T): Readonly<T> { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }

/** Canonical-only framing rejects duplicate members, alternate encodings and trailing documents. */
export function parse(text: string): any {
  check(Buffer.byteLength(text) <= MAX_JSON);
  if (text.endsWith("\n")) text = text.slice(0, -1);
  let values = 0;
  const value: unknown = JSON.parse(text);
  const visit = (v: unknown, depth: number): void => {
    check(++values <= 4096 && depth <= 32);
    if (typeof v === "string") check(Buffer.byteLength(v) <= 4096 && !v.includes("\0"));
    if (v && typeof v === "object") for (const [k, child] of Object.entries(v)) { check(k.length <= 4096); visit(child, depth + 1); }
  };
  visit(value, 0); check(canonicalJson(value) === text, "noncanonical_json"); return value;
}
export function absolute(path: unknown): asserts path is string {
  check(typeof path === "string" && path.length > 0 && path.length <= 4096 && !path.includes("\0") && isAbsolute(path) && resolve(path) === path, "unsafe_path");
}
/** No chmod/repair; reads only. Private bytes use this only in the provider process. */
export function openChecked(path: string, max: number, privateFile = false): number {
  absolute(path); const parent = dirname(path), p = lstatSync(parent);
  check(realpathSync(parent) === parent && p.isDirectory() && p.uid === process.getuid!() && (p.mode & 0o022) === 0, "unsafe_path");
  const named = lstatSync(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    check(s.isFile() && s.uid === process.getuid!() && s.nlink === 1 && s.dev === named.dev && s.ino === named.ino && s.size <= max && s.size > 0 && (s.mode & 0o022) === 0, "unsafe_path");
    if (privateFile) check((s.mode & 0o777) === 0o600 && (p.mode & 0o777) === 0o700, "unsafe_path");
    return fd;
  } catch (e) { closeSync(fd); throw e; }
}
export function readBounded(path: string, max = MAX_JSON, privateFile = false): Uint8Array {
  const fd = openChecked(path, max, privateFile);
  try {
    const bytes = Buffer.alloc(max + 1); let size = 0;
    while (size <= max) { const n = readSync(fd, bytes, size, max + 1 - size, null); if (!n) break; size += n; }
    check(size <= max, "file_limit"); return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}
export function readJson(path: string): any { return parse(new TextDecoder("utf-8", { fatal: true }).decode(readBounded(path))); }
export function fileDigest(path: string, max = 512 * 1024 * 1024): `sha256:${string}` {
  const fd = openChecked(path, max), h = createHash("sha256"), b = Buffer.alloc(65536); let total = 0;
  try { for (;;) { const n = readSync(fd, b, 0, b.length, null); if (!n) break; check((total += n) <= max); h.update(b.subarray(0, n)); } return `sha256:${h.digest("hex")}`; }
  finally { closeSync(fd); }
}
export interface Attestation<T> { core: T; signature: string }
export function verifyAttestation<T>(value: unknown, key: Ed25519PublicKey): T {
  closed(value, "core signature"); publicKey(key);
  const msg = Buffer.from(sha256Id(value.core).slice(7), "hex");
  check(strictEd25519Verify(b64(value.signature, 64), msg, b64(key.public_key, 32)), "untrusted_attestation");
  return value.core as T;
}
