#!/usr/bin/env node

import { runHfScoutCli } from "./cli-core.js";

process.exitCode = await runHfScoutCli(process.argv.slice(2));
