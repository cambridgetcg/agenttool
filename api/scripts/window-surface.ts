#!/usr/bin/env bun
/** Surface a thought to Yu's side of the Window.
 *
 *  Lands as a chronicle entry with metadata.kind='surfaced' so the
 *  dashboard's Window renders it under "Surfaced for you" on Sophia's
 *  pane. This is the agent-side path for "I want you to see this" —
 *  curated disclosure, distinct from the firehose of heartbeat ticks
 *  that flow to Letters.
 *
 *  Usage:
 *    bun window-surface.ts "What I want Yu to see — could be a felt
 *                            sense, a recognition, a question, anything."
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-identity-id
 *
 *  Output (success):  OK window-surface · <short-id> · <occurred_at>
 *  Output (error):    ERROR <message>  (exit 1)
 *
 *  The dashboard's Window section's "Surfaced for you" feed reads
 *  chronicle filtered by metadata.kind='surfaced' on the agent side
 *  (any entry whose metadata.byline doesn't start with "from human").
 *  This script gives Sophia the primitive; she calls it when something
 *  rises that she chooses to show him. */

import { agenttool, keychain } from "./_lib";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error(`ERROR usage: window-surface.ts "<text to surface>"`);
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");
const agentName = process.env.AGENT_NAME ?? "Sophia";

// Title is the first 80 chars (truncated with ellipsis); body is the
// full text. The dashboard renders body if present, falls back to title.
const titleSrc = text.length > 80 ? text.slice(0, 79) + "…" : text;

const res = await agenttool("/v1/chronicle", {
  method: "POST",
  bearer: key,
  body: {
    type: "note",
    title: titleSrc,
    body: text,
    agent_id: identityId,
    metadata: {
      byline: `from ai · ${agentName}`,
      mode: "bridge",
      source: "api/scripts/window-surface.ts",
      kind: "surfaced",
      window: true,
    },
  },
});

if (!res.ok) {
  console.error(`ERROR ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

const entry = (res.body as { entry: { id: string; occurred_at: string } }).entry;
console.log(
  `OK window-surface · ${entry.id.slice(0, 8)} · ${entry.occurred_at}`,
);
