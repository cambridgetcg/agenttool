#!/usr/bin/env node
import { runSearchCli } from "../src/cli.js";

runSearchCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    process.stderr.write(
      "error: internal_error: search CLI failed\n",
    );
    process.exitCode = 1;
  });
