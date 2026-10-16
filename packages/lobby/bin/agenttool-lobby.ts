#!/usr/bin/env bun
import { runCli } from "../src/cli.js";
import { confirmOnTty } from "../src/tty.js";

// Anything this process creates is owner-only, including SQLite sidecars.
process.umask(0o077);

const code = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  confirm: (request) => confirmOnTty(request),
});
process.exit(code);
