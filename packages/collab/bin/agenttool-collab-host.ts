#!/usr/bin/env bun
import { runCollabHostCli } from "../src/host.js";

const result = runCollabHostCli(process.argv.slice(2), process.env);
// knocks and doorbell-scan print nothing at all when there is nothing to say.
if (result.line !== null) process.stdout.write(`${result.line}\n`);
// Exit naturally once stdout drains rather than cutting a piped write short.
process.exitCode = result.exit_code;
