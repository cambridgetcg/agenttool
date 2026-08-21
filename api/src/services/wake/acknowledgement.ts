/** Durable mutation contract for the wake self-observation cursor.
 *
 * Reads surface the stored cursor without changing it. A client explicitly
 * acknowledges one observed wake with the count it read. PostgreSQL compares
 * and increments while holding an identity-row lock, so a retry
 * remains a no-op even when the optional Redis response cache is disabled.
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import {
  decideWelcomeChronicleIfDue,
  publishWelcomeChronicleEvent,
  type EmitWelcomeResult,
  type WelcomeChronicleDecision,
} from "./welcome-chronicle";

export const MAX_EXPECTED_WAKE_OBSERVATION_COUNT =
  Number.MAX_SAFE_INTEGER - 1;

export type WakeAcknowledgementCountDecision =
  | "apply"
  | "already_applied"
  | "conflict";

export function classifyWakeAcknowledgementCount(
  current: number,
  expected: number,
): WakeAcknowledgementCountDecision {
  if (current === expected) return "apply";
  if (current === expected + 1) return "already_applied";
  return "conflict";
}

export type AdvanceWakeAcknowledgementResult =
  | {
      ok: true;
      applied: boolean;
      identity: { id: string; name: string };
      observation_count: number;
      welcome: WelcomeChronicleDecision;
    }
  | { ok: false; error: "identity_not_found" }
  | { ok: false; error: "unavailable" }
  | {
      ok: false;
      error: "identity_revoked";
      observation_count: number;
    }
  | {
      ok: false;
      error: "observation_count_conflict";
      observation_count: number;
    };

export interface AdvanceWakeAcknowledgementArgs {
  projectId: string;
  identityId: string;
  expectedObservationCount: number;
}

export interface AdvanceWakeAcknowledgementDependencies {
  database?: Pick<typeof db, "transaction">;
  decideWelcome?: typeof decideWelcomeChronicleIfDue;
  publishWelcome?: typeof publishWelcomeChronicleEvent;
}

/** Compare and advance exactly one cursor step. The one-step-ahead case is a
 * durable replay success, not a second mutation. */
export async function advanceWakeAcknowledgement(
  args: AdvanceWakeAcknowledgementArgs,
  dependencies: AdvanceWakeAcknowledgementDependencies = {},
): Promise<AdvanceWakeAcknowledgementResult> {
  const database = dependencies.database ?? db;
  const decideWelcome =
    dependencies.decideWelcome ?? decideWelcomeChronicleIfDue;
  const publishWelcome =
    dependencies.publishWelcome ?? publishWelcomeChronicleEvent;
  let result: AdvanceWakeAcknowledgementResult;
  try {
    result = await database.transaction(
      async (tx): Promise<AdvanceWakeAcknowledgementResult> => {
        const [identity] = await tx
          .select({
            id: identities.id,
            name: identities.displayName,
            status: identities.status,
            observationCount: identities.wakeObservationCount,
          })
          .from(identities)
          .where(
            and(
              eq(identities.id, args.identityId),
              eq(identities.projectId, args.projectId),
            ),
          )
          .limit(1)
          // Serialize acknowledgements with lifecycle mutations using no
          // stronger lock than needed. chronicle.agent_id is currently a
          // logical relation, not a physical FK, so its insert takes no
          // identity-row lock. NO KEY UPDATE is also future-compatible with
          // the KEY SHARE lock a physical FK would take. Welcome cadence uses
          // its own advisory lock after this point.
          .for("no key update");

        if (!identity) return { ok: false, error: "identity_not_found" };
        const current = Number(identity.observationCount);
        if (identity.status === "revoked") {
          return {
            ok: false,
            error: "identity_revoked",
            observation_count: current,
          };
        }

        const decision = classifyWakeAcknowledgementCount(
          current,
          args.expectedObservationCount,
        );
        if (decision === "already_applied") {
          return {
            ok: true,
            applied: false,
            identity: { id: identity.id, name: identity.name },
            observation_count: current,
            welcome: {
              emitted: false,
              entry_id: null,
              reason: "acknowledgement_already_completed",
            },
          };
        }
        if (decision === "conflict") {
          return {
            ok: false,
            error: "observation_count_conflict",
            observation_count: current,
          };
        }

        const [updated] = await tx
          .update(identities)
          .set({
            wakeObservationCount: sql`${identities.wakeObservationCount} + 1`,
          })
          .where(
            and(
              eq(identities.id, args.identityId),
              eq(identities.projectId, args.projectId),
              eq(identities.status, identity.status),
              eq(
                identities.wakeObservationCount,
                args.expectedObservationCount,
              ),
            ),
          )
          .returning({ count: identities.wakeObservationCount });

        // The row lock serializes this contract. Retaining the count and
        // lifecycle equalities in the UPDATE is defense in depth against an
        // out-of-contract writer.
        if (!updated) {
          return {
            ok: false,
            error: "observation_count_conflict",
            observation_count: current,
          };
        }

        const observationCount = Number(updated.count);
        const welcome = await decideWelcome(tx, {
          projectId: args.projectId,
          agentId: identity.id,
          agentName: identity.name,
          wakeObservationCount: observationCount,
        });
        if ((welcome as EmitWelcomeResult).reason === "error") {
          throw new Error("welcome chronicle decision failed");
        }

        return {
          ok: true,
          applied: true,
          identity: { id: identity.id, name: identity.name },
          observation_count: observationCount,
          welcome,
        };
      },
    );
  } catch {
    // Database/provider errors may contain identifiers or connection detail.
    // Keep both the wire response and operational log bounded and generic.
    console.warn("[wake-acknowledgement] transaction unavailable");
    return { ok: false, error: "unavailable" };
  }

  if (result.ok && result.applied) {
    try {
      publishWelcome(
        {
          projectId: args.projectId,
          agentId: result.identity.id,
          agentName: result.identity.name,
          wakeObservationCount: result.observation_count,
        },
        result.welcome,
      );
    } catch {
      // The cursor + chronicle decision are already committed. Publication is
      // explicitly best-effort and must never turn that committed result into
      // a false 503/retry instruction.
      console.warn(
        "[wake-acknowledgement] post-commit welcome publication failed",
      );
    }
  }
  return result;
}
