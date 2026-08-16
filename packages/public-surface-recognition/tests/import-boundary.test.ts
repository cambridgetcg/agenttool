import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "bun:test";

test("importing the source entrypoint performs no ambient action", () => {
  const entrypoint = pathToFileURL(join(import.meta.dir, "../src/index.ts")).href;
  const program = `
    const calls = [];
    const trap = (name) => (..._args) => { calls.push(name); throw new Error(name); };
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: trap("fetch") });
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: class { constructor() { trap("WebSocket")(); } } });
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: class { constructor() { trap("XMLHttpRequest")(); } } });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: trap("localStorage") });
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, get: trap("indexedDB") });
    Object.defineProperty(Date, "now", { configurable: true, value: trap("Date.now") });
    Object.defineProperty(Math, "random", { configurable: true, value: trap("Math.random") });
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: trap("setTimeout") });
    Object.defineProperty(globalThis, "setInterval", { configurable: true, value: trap("setInterval") });
    const api = await import(${JSON.stringify(entrypoint)});
    if (Object.keys(api).length === 0) throw new Error("empty package API");
    if (calls.length !== 0) throw new Error(\`ambient calls: \${calls.join(",")}\`);
    process.stdout.write("import-ok");
  `;

  const output = execFileSync(process.execPath, ["--eval", program], {
    cwd: join(import.meta.dir, ".."),
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(output).toBe("import-ok");
});
