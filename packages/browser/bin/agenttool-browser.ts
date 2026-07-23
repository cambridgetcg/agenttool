#!/usr/bin/env node
import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(
      `error: internal_error: ${error instanceof Error ? error.message : "browser CLI failed"}\n`,
    );
    process.exitCode = 1;
  });
