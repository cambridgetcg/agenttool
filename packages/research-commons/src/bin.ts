#!/usr/bin/env node
import { ResearchCommonsError } from "./errors.js";
import { runCli } from "./cli.js";

try {
  process.stdout.write(runCli(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof ResearchCommonsError
    ? `${error.code}: ${error.message}`
    : "internal_error: unexpected local validation failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
