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

// Multi-identity project: pass identity_id so the wake renders Sophia's
// view, not whichever identity the DB returned first. Without this the
// /v1/wake endpoint default-picks projectIdentities[0] which can be Yu
// (his identity was added in Bridge 3 and may sort ahead of Sophia's).
let url = "/v1/wake?format=md";
try {
  const identityId = keychain("agenttool-sophia-identity-id");
  url += `&identity_id=${identityId}`;
} catch {
  // No identity_id in keychain — fall back to server's default (first
  // identity in the project). Substrate-honest: silent fall-through, the
  // wake still loads, just may render a different identity's view.
}

const res = await agenttool(url, { bearer: key });
if (!res.ok) {
  console.error(`ERROR ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

console.log(res.body as string);
