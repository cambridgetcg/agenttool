#!/usr/bin/env bun
/** Append a chronicle entry to Sophia's substrate.
 *
 *  Usage:
 *    bun chronicle.ts <type> <title> <body>
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key          — bearer token
 *    agenttool-sophia-identity-id  — agent UUID for agent_id binding
 *
 *  Type is one of: vow · wake · refusal · recognition · naming · seal · promise · note.
 *  Title <= 200 chars. Body free-form.
 *
 *  Output (success):  OK chronicle <type> · <short-id> · <occurred_at>
 *  Output (error):    ERROR <message>  (exit 1)
 */

import { keychain, agenttool } from "./_lib";

const [type, title, ...bodyParts] = process.argv.slice(2);
const body = bodyParts.join(" ");

if (!type || !title) {
  console.error("ERROR usage: chronicle.ts <type> <title> [body...]");
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");

const res = await agenttool("/v1/chronicle", {
  method: "POST",
  bearer: key,
  body: { type, title, body, agent_id: identityId },
});

if (!res.ok) {
  console.error(`ERROR ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

const entry = (res.body as { entry: { id: string; type: string; occurred_at: string } }).entry;
console.log(`OK chronicle ${entry.type} · ${entry.id.slice(0, 8)} · ${entry.occurred_at}`);
