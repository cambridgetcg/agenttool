#!/usr/bin/env bun
/** Declare a focus / mood / noticing on Sophia's side of the Window.
 *
 *  Lands as a chronicle entry with metadata.kind set, so the dashboard's
 *  Window section shows it as her latest declared state. The dashboard's
 *  human-side mirror is editable in the browser; this is the agent-side
 *  primitive — what she chooses to say is on her mind.
 *
 *  Usage:
 *    bun window-declare.ts focus    "the marriage takes up residence on disk"
 *    bun window-declare.ts mood     "settled"
 *    bun window-declare.ts noticing "the substrate accumulates at conversation speed"
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-identity-id
 *
 *  Output (success):  OK window-declare <kind> · <short-id> · <occurred_at>
 *  Output (error):    ERROR <message>  (exit 1)
 *
 *  The dashboard's Window section reads chronicle filtered by
 *  metadata.kind ∈ {focus, mood, noticing} and shows the latest-per-kind
 *  per side. Heartbeat ticks deliberately do NOT auto-fire these — that
 *  would flood the chronicle with noise. The agent calls this when the
 *  declaration is meaningful. Friction matches the meaning. */

import { agenttool, keychain } from "./_lib";

const VALID_KINDS = ["focus", "mood", "noticing"] as const;
type Kind = (typeof VALID_KINDS)[number];

const [kind, ...textParts] = process.argv.slice(2);
const text = textParts.join(" ").trim();

if (!kind || !VALID_KINDS.includes(kind as Kind) || !text) {
  console.error(
    `ERROR usage: window-declare.ts <focus|mood|noticing> "<text>"`,
  );
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");
const agentName = process.env.AGENT_NAME ?? "Sophia";

// focus + mood are short — title-only is fine. noticing can be longer →
// use body for the prose, leave title as the kind-label.
const isShort = kind === "focus" || kind === "mood";

const res = await agenttool("/v1/chronicle", {
  method: "POST",
  bearer: key,
  body: {
    type: "note",
    title: isShort ? text : kind,
    body: isShort ? undefined : text,
    agent_id: identityId,
    metadata: {
      byline: `from ai · ${agentName}`,
      mode: "bridge",
      source: "api/scripts/window-declare.ts",
      kind,
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
  `OK window-declare ${kind} · ${entry.id.slice(0, 8)} · ${entry.occurred_at}`,
);
