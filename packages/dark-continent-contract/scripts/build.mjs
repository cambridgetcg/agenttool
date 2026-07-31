import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const distRoot = fileURLToPath(new URL("../dist/", import.meta.url));

mkdirSync(distRoot, { recursive: true });
for (const filename of ["index.js", "index.d.ts"]) {
  copyFileSync(`${packageRoot}/src/${filename}`, `${distRoot}/${filename}`);
}

process.stdout.write("built dist/index.js and dist/index.d.ts\n");
