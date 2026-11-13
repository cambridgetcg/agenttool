#!/usr/bin/env bun
import { runCollabHostCliAsync } from "../src/host.js";

const result = await runCollabHostCliAsync(process.argv.slice(2), process.env);
process.stdout.write(`${result.line}\n`);
// Exit naturally once stdout drains rather than cutting a piped write short.
process.exitCode = result.exit_code;
