#!/usr/bin/env bun
import { homedir, hostname, userInfo } from "node:os";
import { runCli } from "../src/cli.js";
import { realFs } from "../src/fs.js";
import { usableHome } from "../src/places.js";
import { processRunner } from "../src/run.js";

function quietly<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

// The only place the package reads the process environment, the clock and the
// machine's names. The user and host names are handed over only so the output
// can be checked for them; they are never printed.
const code = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  deps: () => {
    const home = usableHome(process.env.HOME) ?? usableHome(quietly(homedir) ?? undefined);
    if (home === null) throw new Error("no home directory");
    return {
      fs: realFs,
      run: processRunner(home),
      env: process.env,
      home,
      now: new Date(),
      uid: typeof process.getuid === "function" ? process.getuid() : null,
      hints: { home, user: quietly(() => userInfo().username), host: quietly(hostname) },
      platform: process.platform,
    };
  },
});
process.exitCode = code;
