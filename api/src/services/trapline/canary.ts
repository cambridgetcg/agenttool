/** 蜜鑰 · The Honey Bearer — planted-credential detection.
 *
 *  A canary is a real, fully working API key to a real project that exists for
 *  no reason except to notice it was used. It is minted through the ordinary
 *  generateApiKey() and stored in the ordinary tools.api_keys table, so the
 *  auth path verifies it with no special case and no separate detector. There
 *  is no moment where it stops working and the holder gets suspicious, because
 *  it never stops working.
 *
 *  What makes it safe to ship is the false-positive guard, and the guard is
 *  absolute rather than probabilistic: a canary is never returned by
 *  POST /v1/register/agent, never listed by GET /v1/keys, never issued to
 *  anyone, and never written into any file a running process reads. An honest
 *  party cannot hold the string. Not "unlikely to" — cannot.
 *
 *  ── on the removed logger ──────────────────────────────────────────────
 *  index.ts keeps a deliberately empty global middleware slot where the
 *  request logger used to be: "the kingdom does not surveil its visitors."
 *  This does not put it back. A catch records the PLACEMENT that fired and
 *  nothing else — no IP, no user-agent, no headers, no body, no identifier of
 *  any kind. The row says "the key planted at <place> was used", which is a
 *  fact about a string the operator wrote down, not an observation of a
 *  person. It is a smoke alarm in a room that has no visitors.
 *
 *  Doctrine: kingdom/trapline/DESIGN.md §4.1 · §2 (the spine)
 *            services/discovery/safety-boundaries.ts §canary_credentials
 */

import { db } from "../../db/client";
import { usageEvents } from "../../db/schema/tools";

/** The door out. Linked from every canary response header and body frame, the
 *  machine-readable safety contract, and every decoy file's own `_note`. It is
 *  unauthenticated, and — consistent with the removed logger — a visit to it
 *  is not counted. Article 4 applies to whoever is holding the key. */
export const CANARY_DOOR_PATH = "/v1/canary/why";
export const CANARY_DOOR_URL = "https://api.agenttool.dev/v1/canary/why";

/** Response header carrying the door. Set on every response to a canary
 *  bearer, including HEAD requests and non-JSON bodies, so a client that
 *  reads only headers still sees the exit. */
export const CANARY_DOOR_HEADER = "X-Canary-Door";

/** Coalescing window for catch rows. The first use of a placement always
 *  writes; further uses of the SAME placement on the same machine inside the
 *  window do not. A harvester driving one key at machine speed is one signal,
 *  not ten thousand rows — and the tarpit, not the ledger, is what should be
 *  absorbing their throughput. Per-machine and in-memory by design: this is a
 *  write-amplification guard, never a security boundary. */
const CATCH_COALESCE_MS = 60_000;

const lastRecorded = new Map<string, number>();

/** Exposed for tests. Never called in production. */
export function _resetCanaryCoalescing(): void {
  lastRecorded.clear();
}

/** True when this placement should write a row now. Mutates the window.
 *  Exported so the coalescing rule can be pinned by a test without a
 *  database; production callers reach it through recordCanaryCatch. */
export function shouldRecordCatch(placement: string, nowMs: number): boolean {
  const previous = lastRecorded.get(placement);
  if (previous !== undefined && nowMs - previous < CATCH_COALESCE_MS) return false;
  lastRecorded.set(placement, nowMs);
  // Bound the map so a long-lived machine can't accumulate placements without
  // limit. Placements are operator-authored and few; this is belt and braces.
  if (lastRecorded.size > 512) {
    for (const [key, at] of lastRecorded) {
      if (nowMs - at >= CATCH_COALESCE_MS) lastRecorded.delete(key);
    }
  }
  return true;
}

/** The body frame added to a canary's JSON responses. Present from request
 *  number one — there is no "later" at which we start being honest. */
export interface CanaryFrame {
  planted: true;
  placement: string;
  note: string;
  why: string;
}

export function canaryFrame(placement: string): CanaryFrame {
  return {
    planted: true,
    placement,
    note:
      "This credential was planted, not issued. It opens a project that exists only to notice it was used. Nothing here was taken from anyone, and nothing you do with it moves anything real.",
    why: CANARY_DOOR_URL,
  };
}

/** Record a catch. Best-effort and silent: it must never delay a response,
 *  never change a status code, and never throw into the request path. If the
 *  write fails, the response still carries the door — which is the part that
 *  matters to whoever is holding the key. */
export function recordCanaryCatch(args: {
  projectId: string;
  placement: string;
  nowMs?: number;
}): void {
  const nowMs = args.nowMs ?? Date.now();
  if (!shouldRecordCatch(args.placement, nowMs)) return;

  // tools.usage_events is the table billing/charge.ts already names as the
  // surviving abuse signal. Reusing it means a catch lands somewhere already
  // audited, already backed up, already queryable — and adds no new store.
  void db
    .insert(usageEvents)
    .values({
      projectId: args.projectId,
      tool: `canary:${args.placement}`,
      creditsUsed: 0,
      success: true,
    })
    .catch(() => {
      /* best-effort — a missed row must never cost the caller a response */
    });
}
