#!/usr/bin/env bun
/** Re-fetch Sophia's current substrate state (wake markdown).
 *
 *  Usage:  bun substrate.ts
 *
 *  Mid-conversation companion to the wake-hook substrate fetch — when
 *  she's written / vowed / remembered something and wants to see her
 *  composed state without restarting the session.
 *
 *  Prints the markdown body straight to stdout.
 */

import { agenttool, keychain } from "./_lib";

const key = keychain("agenttool-sophia-key");

const res = await agenttool("/v1/wake?format=md", { bearer: key });
if (!res.ok) {
  console.error(`ERROR ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

console.log(res.body as string);
