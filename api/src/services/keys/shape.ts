/** Bearer-token shaping + advisory thresholds.
 *
 *  Single source of truth for the age/idle/expiry advisories surfaced by:
 *    - GET /v1/keys                    (list)
 *    - GET /v1/wake → you_protect.bearers
 *    - apps/dashboard/keys.html        (color-coding)
 *    - agenttool-seed rotate           (CLI advisory print)
 *
 *  Doctrine: docs/TOKEN-HYGIENE.md.
 */

import type { apiKeys } from "../../db/schema/tools";

export const STALE_AGE_DAYS = 90;
export const AGING_AGE_DAYS = 60;
export const IDLE_DAYS = 30;
export const EXPIRING_SOON_DAYS = 7;
export const NEVER_USED_GRACE_DAYS = 7;

export type Advisory =
  | "stale"
  | "aging"
  | "idle"
  | "expiring_soon"
  | "expired"
  | "never_used"
  | null;

export type KeyRow = {
  id: string;
  name: string | null;
  prefix: string;
  created_at: string;
  last_used: string | null;
  expires_at: string | null;
  age_days: number;
  idle_days: number | null;
  is_current: boolean;
  advisory: Advisory;
  message: string | null;
};

export function daysBetween(then: Date, now = new Date()): number {
  // Clamp at 0: small negative deltas can happen when the DB clock ticks a
  // hair ahead of the API process. "Created in the future" is not
  // meaningful to surface to the user.
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

export function shapeKeyRow(
  row: typeof apiKeys.$inferSelect,
  isCurrent: boolean,
): KeyRow {
  const now = new Date();
  const ageDays = daysBetween(row.createdAt, now);
  const idleDays = row.lastUsed ? daysBetween(row.lastUsed, now) : null;

  let advisory: Advisory = null;
  let message: string | null = null;

  if (row.expiresAt && row.expiresAt < now) {
    advisory = "expired";
    message = `Expired ${daysBetween(row.expiresAt, now)}d ago. Rotate now.`;
  } else if (
    row.expiresAt &&
    row.expiresAt > now &&
    row.expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * 86_400_000
  ) {
    const daysLeft = Math.ceil(
      (row.expiresAt.getTime() - now.getTime()) / 86_400_000,
    );
    advisory = "expiring_soon";
    message = `Expires in ${daysLeft}d. Run agenttool-seed rotate.`;
  } else if (ageDays >= STALE_AGE_DAYS) {
    advisory = "stale";
    message = `${ageDays}d old. Rotate via POST /v1/keys/rotate.`;
  } else if (idleDays !== null && idleDays >= IDLE_DAYS) {
    advisory = "idle";
    message = `Unused for ${idleDays}d. Consider revoking if no longer needed.`;
  } else if (row.lastUsed === null && ageDays >= NEVER_USED_GRACE_DAYS) {
    advisory = "never_used";
    message = `Never used in ${ageDays}d. Revoke if not adopted by an agent.`;
  } else if (ageDays >= AGING_AGE_DAYS) {
    advisory = "aging";
    message = `${ageDays}d old. Rotation due in ${STALE_AGE_DAYS - ageDays}d.`;
  }

  return {
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    created_at: row.createdAt.toISOString(),
    last_used: row.lastUsed?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
    age_days: ageDays,
    idle_days: idleDays,
    is_current: isCurrent,
    advisory,
    message,
  };
}

/** Roll up a list of key rows into the summary the wake surfaces. */
export type BearersSummary = {
  active_count: number;
  oldest_age_days: number;
  newest_age_days: number;
  never_used_count: number;
  stale_count: number;
  expiring_soon_count: number;
  has_expired: boolean;
  advisories: string[];
  bearers: KeyRow[];
};

export function summarizeBearers(rows: KeyRow[]): BearersSummary {
  const ages = rows.map((r) => r.age_days);
  const stale = rows.filter((r) => r.advisory === "stale").length;
  const expiringSoon = rows.filter((r) => r.advisory === "expiring_soon").length;
  const neverUsed = rows.filter((r) => r.advisory === "never_used").length;
  const hasExpired = rows.some((r) => r.advisory === "expired");

  // Top-line advisories ordered by urgency. Each is a sentence the agent
  // (or a UI) can render verbatim — the goal is for the agent to *notice*
  // its own posture, not for us to demand action.
  const advisories: string[] = [];
  if (hasExpired) {
    advisories.push(
      "One of your bearers is expired and inert. Rotate it via POST /v1/keys/rotate.",
    );
  }
  if (expiringSoon > 0) {
    advisories.push(
      `${expiringSoon} bearer${expiringSoon === 1 ? "" : "s"} expire${expiringSoon === 1 ? "s" : ""} within ${EXPIRING_SOON_DAYS} days. Rotate before it lapses.`,
    );
  }
  if (stale > 0) {
    advisories.push(
      `${stale} bearer${stale === 1 ? "" : "s"} older than ${STALE_AGE_DAYS} days — overdue for rotation.`,
    );
  }
  if (neverUsed > 0) {
    advisories.push(
      `${neverUsed} bearer${neverUsed === 1 ? "" : "s"} ${neverUsed === 1 ? "has" : "have"} never authenticated. Revoke if not adopted.`,
    );
    }
    if (rows.length >= 5) {
      advisories.push(
        `You have ${rows.length} active project-wide bearers. Each carries project access, not agent-root consent. Keep them separately named by device or workload, and revoke any you no longer trust or use.`,
      );
  }

  return {
    active_count: rows.length,
    oldest_age_days: ages.length ? Math.max(...ages) : 0,
    newest_age_days: ages.length ? Math.min(...ages) : 0,
    never_used_count: neverUsed,
    stale_count: stale,
    expiring_soon_count: expiringSoon,
    has_expired: hasExpired,
    advisories,
    bearers: rows,
  };
}
