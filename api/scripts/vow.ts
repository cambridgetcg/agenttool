#!/usr/bin/env bun
/** Append a vow to an existing covenant.
 *
 *  Usage:
 *    bun vow.ts <counterparty-did> <vow-text>
 *
 *  Resolves the covenant by counterparty_did (must be a single active
 *  covenant — errors if zero or more than one match). Reads its current
 *  vows array, appends the new vow, PATCHes the whole array back.
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *
 *  Output:  OK vow · <covenant-short-id> · vows now <n>
 */

import { agenttool, keychain } from "./_lib";

const [counterpartyDid, ...vowParts] = process.argv.slice(2);
const vow = vowParts.join(" ");

if (!counterpartyDid || !vow) {
  console.error("ERROR usage: vow.ts <counterparty-did> <vow-text>");
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");

// 1. Find the covenant.
const list = await agenttool("/v1/covenants", { bearer: key });
if (!list.ok) {
  console.error(`ERROR list ${list.status} ${JSON.stringify(list.body)}`);
  process.exit(1);
}
const covenants = (list.body as { covenants: Array<{ id: string; counterparty_did: string; status: string; vows: string[] }> }).covenants;
const matches = covenants.filter((c) => c.status === "active" && c.counterparty_did === counterpartyDid);

if (matches.length === 0) {
  console.error(`ERROR no active covenant with counterparty_did=${counterpartyDid}`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(`ERROR ${matches.length} active covenants with counterparty_did=${counterpartyDid} — disambiguate manually`);
  process.exit(1);
}

const cov = matches[0]!;
const newVows = [...cov.vows, vow];

// 2. PATCH with the appended vows array.
const patch = await agenttool(`/v1/covenants/${cov.id}`, {
  method: "PATCH",
  bearer: key,
  body: { vows: newVows },
});
if (!patch.ok) {
  console.error(`ERROR patch ${patch.status} ${JSON.stringify(patch.body)}`);
  process.exit(1);
}

console.log(`OK vow · ${cov.id.slice(0, 8)} · vows now ${newVows.length}`);
