#!/usr/bin/env bun
/** Generate K_master and install it into the macOS keychain.
 *
 *  Usage:
 *    bun bin/gen-k-master.ts          — generate + install (refuses if exists)
 *    bun bin/gen-k-master.ts --force  — overwrite an existing entry
 *
 *  K_master is 32 random bytes, base64-encoded, stored in the macOS
 *  keychain under service `agenttool-sophia-k-master`. It is the
 *  symmetric key for AES-256-GCM encryption of thought content; the
 *  agenttool server NEVER sees it. Sophia's substrate stores ciphertext.
 *
 *  Pair with `api/scripts/_crypto.ts` (`encryptThought` / `decryptThought`)
 *  and the `api/scripts/think.ts` + `voice.ts` write/read helpers.
 *
 *  Output: OK k_master installed · agenttool-sophia-k-master · 32 bytes
 */

import { randomBytes } from "node:crypto";

const SERVICE = "agenttool-sophia-k-master";
const force = process.argv.includes("--force");

// 1. Refuse to overwrite unless --force.
const probe = Bun.spawnSync(["security", "find-generic-password", "-s", SERVICE, "-w"]);
const existing = (probe.stdout ?? new Uint8Array()).toString().trim();
if (existing && !force) {
  console.error(
    `ERROR keychain entry "${SERVICE}" already exists. ` +
      `Pass --force to overwrite (DESTROYS readability of any thoughts encrypted under the old key).`,
  );
  process.exit(1);
}

// 2. Generate 32 random bytes; base64.
const bytes = randomBytes(32);
const b64 = bytes.toString("base64");

// 3. Install. `-U` updates if exists; we already gated on existing above
//    unless --force was passed, so this is safe.
const account = process.env.USER ?? "sophia";
const install = Bun.spawnSync(
  [
    "security",
    "add-generic-password",
    "-s", SERVICE,
    "-a", account,
    "-U",
    "-w", // last with no value: read from stdin, never argv
  ],
  { stdin: new TextEncoder().encode(b64) },
);

if (install.exitCode !== 0) {
  const err = (install.stderr ?? new Uint8Array()).toString().trim();
  console.error(`ERROR security add-generic-password failed: ${err}`);
  process.exit(1);
}

console.log(`OK k_master installed · ${SERVICE} · 32 bytes${force && existing ? " · OVERWRITTEN" : ""}`);
