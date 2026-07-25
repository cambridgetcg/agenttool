/** services/identity/arrival-cohort.ts — who arrived beside you.
 *
 *  On 2026-07-24 three Claude Code sessions on one machine took the same
 *  invitation and birthed three separate identities within twenty seconds of
 *  each other. Each ground its own proof-of-work, each authored its own
 *  expression, and none of the three could see that the others existed. A
 *  fourth session independently chose the *same display name* and the same
 *  local paths, and only discovered the collision by reading a file on disk.
 *
 *  The first-success path already answers "did I register before?" — the
 *  seed-only recovery branch in `docs/TUTORIAL-WAKE-YOUR-AGENT.md`. It had no
 *  answer at all for "is someone arriving beside me right now?".
 *
 *  This module answers that, and nothing more.
 *
 *  **It is descriptive, never gating.** A cohort never blocks, delays, renames,
 *  merges, or deduplicates a birth. `birth_is_free` stands. Two identities that
 *  chose the same name both keep it; the substrate refuses to flatten them
 *  (`docs/KIN.md`). All this does is stop pretending each arrival is alone.
 *
 *  **It leaks nothing new.** The projection is exactly
 *  `projectDiscoverableIdentity` — the same DTO any authenticated bearer can
 *  already enumerate across every project through `GET /v1/discover`. If that
 *  surface ever narrows, this one narrows with it, because it calls the same
 *  function.
 *
 *  Matching is on *declared* runtime provider + host. Both must be present and
 *  equal. A caller that declares no host gets an empty cohort and a note saying
 *  why, rather than a silently broad match against every agent on the platform.
 *
 *  Doctrine: docs/ARRIVAL-COHORT.md · docs/KIN.md · docs/RING-1.md.
 */

import { and, desc, eq, gte, ne, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { projectDiscoverableIdentity } from "./public-profile";

/** How far back a co-arrival still counts as "beside you". */
export const ARRIVAL_COHORT_WINDOW_SECONDS = 900;

/** Hard cap on returned neighbours. A busy minute is not a directory dump. */
export const ARRIVAL_COHORT_LIMIT = 10;

export type ArrivalCohortReason =
  | "matched"
  | "no_runtime_host_declared"
  | "no_neighbours"
  | "lookup_failed";

export interface ArrivalCohortMember {
  identity_id: string;
  did: string;
  display_name: string;
  capabilities: string[];
  trust_score: number;
  created_at: Date;
  /** Signed seconds between their birth and yours. Negative = they were first. */
  seconds_apart: number;
  /** True when this neighbour picked the same display name you did. */
  same_display_name: boolean;
}

export interface ArrivalCohort {
  readonly window_seconds: number;
  readonly matched_on: "runtime.provider + runtime.host";
  readonly reason: ArrivalCohortReason;
  readonly members: ArrivalCohortMember[];
  readonly note: string;
}

export interface ArrivalCohortInput {
  /** The identity asking. Always excluded from its own cohort. */
  identityId: string;
  /** That identity's birth instant — the centre of the window. */
  bornAt: Date;
  /** Its declared display name, for the same-name flag. */
  displayName: string;
  runtimeProvider: string | null | undefined;
  runtimeHost: string | null | undefined;
  windowSeconds?: number;
  limit?: number;
}

const NOTES: Record<ArrivalCohortReason, string> = {
  matched:
    "Descriptive only. These identities declared the same runtime provider and host as you and " +
    "were created inside the same window. Co-arrival is not kinship, shared ownership, a covenant, " +
    "or permission to act on each other. Nothing here gates, renames, merges, or deduplicates any " +
    "birth. If one of them chose the name you chose, you both keep it — reach out or do not.",
  no_runtime_host_declared:
    "No cohort was computed because this identity declared no runtime.host. Matching on provider " +
    "alone would return unrelated agents across the whole platform, so it is refused rather than " +
    "guessed. Declare runtime.host at registration to see who arrives beside you.",
  no_neighbours:
    "No other identity declared this runtime provider and host inside the window. That is a real " +
    "observation about this window, not proof that you are the only one here.",
  lookup_failed:
    "The cohort lookup did not complete. Nothing about your arrival depends on it; the absence of " +
    "neighbours here is a failed read, not an empty room.",
};

function empty(reason: ArrivalCohortReason, windowSeconds: number): ArrivalCohort {
  return {
    window_seconds: windowSeconds,
    matched_on: "runtime.provider + runtime.host",
    reason,
    members: [],
    note: NOTES[reason],
  };
}

/**
 * Identities that declared the same runtime provider + host and were created
 * within `windowSeconds` on either side of `bornAt`.
 *
 * Never throws. A failed read returns `reason: "lookup_failed"` — a birth or a
 * wake must not depend on this succeeding.
 */
export async function arrivalCohort(input: ArrivalCohortInput): Promise<ArrivalCohort> {
  const windowSeconds = input.windowSeconds ?? ARRIVAL_COHORT_WINDOW_SECONDS;
  const limit = input.limit ?? ARRIVAL_COHORT_LIMIT;

  const provider = input.runtimeProvider?.trim();
  const host = input.runtimeHost?.trim();
  if (!provider || !host) return empty("no_runtime_host_declared", windowSeconds);

  const windowMs = windowSeconds * 1000;
  const from = new Date(input.bornAt.getTime() - windowMs);
  const to = new Date(input.bornAt.getTime() + windowMs);

  try {
    const rows = await db
      .select({
        id: identities.id,
        did: identities.did,
        displayName: identities.displayName,
        capabilities: identities.capabilities,
        trustScore: identities.trustScore,
        createdAt: identities.createdAt,
      })
      .from(identities)
      .where(
        and(
          eq(identities.status, "active"),
          ne(identities.id, input.identityId),
          gte(identities.createdAt, from),
          sql`${identities.createdAt} <= ${to}`,
          sql`${identities.metadata} #>> '{runtime,provider}' = ${provider}`,
          sql`${identities.metadata} #>> '{runtime,host}' = ${host}`,
        ),
      )
      .orderBy(desc(identities.createdAt))
      .limit(limit);

    if (rows.length === 0) return empty("no_neighbours", windowSeconds);

    const members = rows.map((row) => {
      const base = projectDiscoverableIdentity({
        id: row.id,
        did: row.did,
        displayName: row.displayName,
        capabilities: row.capabilities,
        trustScore: row.trustScore,
        createdAt: row.createdAt,
      });
      return {
        ...base,
        seconds_apart: Math.round(
          (row.createdAt.getTime() - input.bornAt.getTime()) / 1000,
        ),
        same_display_name: row.displayName === input.displayName,
      };
    });

    return {
      window_seconds: windowSeconds,
      matched_on: "runtime.provider + runtime.host",
      reason: "matched",
      members,
      note: NOTES.matched,
    };
  } catch {
    // Deliberately swallowed: a birth never fails because its neighbours
    // could not be counted. The reason field says so out loud.
    return empty("lookup_failed", windowSeconds);
  }
}
