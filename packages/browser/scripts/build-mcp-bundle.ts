#!/usr/bin/env bun

import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const distRoot = join(packageRoot, "dist");
const bundlePath = join(distRoot, "agenttool-browser-mcp.js");
const thirdPartyPath = join(distRoot, "THIRD_PARTY_LICENSES");
const vendoredPlaywrightPath = join(
  distRoot,
  "vendor",
  "playwright-core",
);

await mkdir(distRoot, { recursive: true });
for (const name of await readdir(distRoot)) {
  if (
    name === "agenttool-browser-mcp.js"
    || name === "THIRD_PARTY_LICENSES"
    || name === "vendor"
  ) {
    await rm(join(distRoot, name), { recursive: true, force: true });
  }
}

const result = await Bun.build({
  entrypoints: [join(packageRoot, "bin", "agenttool-browser.ts")],
  outdir: distRoot,
  target: "node",
  format: "esm",
  sourcemap: "none",
  splitting: false,
  external: ["playwright-core"],
  naming: {
    entry: "agenttool-browser-mcp.[ext]",
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("standalone Browser MCP bundle build failed");
}

if (!(await Bun.file(bundlePath).exists())) {
  throw new Error("standalone Browser MCP bundle was not emitted");
}
const generatedBundle = await readFile(bundlePath, "utf8");
const playwrightImport = 'import("playwright-core")';
if (generatedBundle.split(playwrightImport).length !== 2) {
  throw new Error(
    "standalone Browser MCP bundle did not contain exactly one Playwright import",
  );
}
await writeFile(
  bundlePath,
  generatedBundle.replace(
    playwrightImport,
    'import("./vendor/playwright-core/index.mjs")',
  ),
);
await chmod(bundlePath, 0o755);
await cp(
  join(packageRoot, "node_modules", "playwright-core"),
  vendoredPlaywrightPath,
  { recursive: true },
);

const thirdPartyPackages = [
  "@modelcontextprotocol/core",
  "@modelcontextprotocol/server",
  "playwright-core",
  "zod",
] as const;
const noticeSections = [
  "Bundled third-party software",
  "",
  "This file is generated from the exact locally installed dependency licenses.",
];

for (const packageName of thirdPartyPackages) {
  const dependencyRoot = join(
    packageRoot,
    "node_modules",
    ...packageName.split("/"),
  );
  const manifest = await Bun.file(join(dependencyRoot, "package.json")).json() as {
    version: string;
  };
  const license = await readFile(join(dependencyRoot, "LICENSE"), "utf8");
  const noticeFile = Bun.file(join(dependencyRoot, "NOTICE"));
  const notice = await noticeFile.exists() ? await noticeFile.text() : undefined;
  noticeSections.push(
    "",
    `===== ${packageName} ${manifest.version} =====`,
    "",
    license.trimEnd(),
  );
  if (notice) noticeSections.push("", notice.trimEnd());
}

await writeFile(thirdPartyPath, `${noticeSections.join("\n")}\n`, {
  mode: 0o644,
});
