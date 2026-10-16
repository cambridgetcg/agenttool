#!/usr/bin/env bun
import { runCli } from "../src/cli.js";
import { MacKeychainStore } from "../src/keychain.js";
import { confirmOnTty, showOnTty, terminalAvailable } from "../src/tty.js";

// Anything this process creates is owner-only, including SQLite sidecars.
process.umask(0o077);

const code = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  confirm: (request) => confirmOnTty(request),
  showOnTty: (text) => showOnTty(text),
  // Consequential fleet acts plan only when a controlling terminal exists.
  hasTerminal: () => terminalAvailable(),
  // The only place the package hands over the runtime's fetch. Every request
  // goes to the pinned origin through src/hosted.ts; the MCP server never gets it.
  fetchImpl: (url, init) => globalThis.fetch(url, init),
  // The hub's project bearer and door key: the macOS login Keychain, read by
  // this CLI only through /usr/bin/security (src/keychain.ts).
  keychain: new MacKeychainStore(),
});
process.exit(code);
