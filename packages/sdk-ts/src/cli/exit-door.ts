#!/usr/bin/env node
/**
 * `agenttool-exit-door` bin entry. All behaviour lives in
 * `_exit-door-cli.ts`; this file only binds it to the real process.
 */
import { processExitDoorIo, runExitDoorCli } from "./_exit-door-cli.js";

process.exitCode = await runExitDoorCli(process.argv.slice(2), processExitDoorIo());
