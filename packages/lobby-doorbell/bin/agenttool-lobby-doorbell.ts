#!/usr/bin/env bun
import { basename } from "node:path";
import { runCli } from "../src/cli.js";

// Anything this process creates (the log line's file) is owner-only.
process.umask(0o077);

const code = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  // The only place the package hands over the runtime's fetch; src/health.ts
  // uses it for one credential-free GET /health to the pinned origin.
  fetchImpl: (url, init) => globalThis.fetch(url, init),
  invokedAs: basename(process.argv[1] ?? ""),
});
process.exit(code);
