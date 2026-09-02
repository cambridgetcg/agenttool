import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

if (packageJson.private !== true || packageJson.license !== "UNLICENSED") {
  throw new Error("creation-claim package must remain private and UNLICENSED");
}
for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "publishConfig", "bin"]) {
  if (packageJson[key] !== undefined) throw new Error(`forbidden package surface: ${key}`);
}
for (const hook of ["preinstall", "install", "postinstall", "prepack", "publish", "postpublish"]) {
  if (packageJson.scripts?.[hook] !== undefined) throw new Error(`forbidden lifecycle hook: ${hook}`);
}
const source = (await readdir(new URL("src/", root)))
  .filter((name) => name.endsWith(".ts"))
  .sort()
  .map(async (name) => readFile(new URL(`src/${name}`, root), "utf8"));
const combined = (await Promise.all(source)).join("\n");
const imports = [...combined.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
for (const specifier of imports) {
  if (!(specifier.startsWith("./") || specifier === "node:crypto" || specifier === "node:util/types")) {
    throw new Error(`runtime import escapes the pure boundary: ${specifier}`);
  }
}
if (/process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/iu.test(combined)) {
  throw new Error("ambient I/O, time, randomness, or execution surface found in runtime source");
}

const packed = JSON.parse(execFileSync(
  "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: fileURLToPath(root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
));
if (!Array.isArray(packed) || packed.length !== 1 || !Array.isArray(packed[0]?.files)) {
  throw new Error("npm pack dry-run did not return one inspectable inventory");
}
const packedPaths = packed[0].files.map((entry) => entry.path);
for (const path of packedPaths) {
  if (!(
    path === "package.json"
    || path === "README.md"
    || path === "CLAUDE.md"
    || path.startsWith("dist/")
    || path.startsWith("schema/")
    || path.startsWith("vectors/")
  )) throw new Error(`unexpected packed path: ${path}`);
}
for (const required of [
  "package.json",
  "README.md",
  "CLAUDE.md",
  "dist/index.js",
  "dist/index.d.ts",
  "vectors/agenttool-zerone-creation-claim-v0.1.json",
]) {
  if (!packedPaths.includes(required)) throw new Error(`required packed path is absent: ${required}`);
}
if (packed[0].bundled?.length !== 0) throw new Error("private source-only package must bundle no dependencies");
