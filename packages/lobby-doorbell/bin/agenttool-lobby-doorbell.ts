#!/usr/bin/env bun
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { runCli } from "../src/cli.js";

// Anything this process creates (state files, the log line's file) is owner-only.
process.umask(0o077);

let wake: (() => void) | null = null;
const handlers: Array<() => void> = [];
const terminate = () => {
  for (const handler of handlers) handler();
  wake?.();
};
process.on("SIGTERM", terminate);
process.on("SIGINT", terminate);

const code = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  // The only place the package hands over the runtime's fetch; src/health.ts
  // uses it for one credential-free GET /health to the pinned origin.
  fetchImpl: (url, init) => globalThis.fetch(url, init),
  invokedAs: basename(process.argv[1] ?? ""),
  // The fetcher and watchers run this same file.
  selfEntry: realpathSync(import.meta.path),
  pid: process.pid,
  readStdin: async () => await Bun.stdin.text(),
  onTerminate: (handler) => handlers.push(handler),
  sleep: (ms) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  }),
});
process.exit(code);
