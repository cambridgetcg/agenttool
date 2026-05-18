/** services/trust/composition.ts — composition-unlock eligibility helpers.
 *
 *  Other services may CALL these helpers to determine whether to take a
 *  reduced-friction path for a trusted pair. The helpers always return
 *  ACCELERATION-eligible (NOT gating) — every surface they unlock must
 *  also work via the slow-path for untrusted pairs.
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/trust-is-optional-never-required
 *    These helpers return booleans for ACCELERATION decisions only. No
 *    helper here returns "should-block" or "should-reject" for any pair;
 *    the slow-path remains always available.
 *
 *  @enforces urn:agenttool:commitment/trust-unlocks-composition
 *    The set of unlocks is enumerated below. Each is a specific
 *    (kind × strength) → action triple. */

import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import {
  trusts,
  type TrustKind,
  type TrustStrength,
} from "../../db/schema/trust";

const STRENGTH_RANK: Record<TrustStrength, number> = {
  provisional: 1,
  established: 2,
  deep: 3,
};

/** Check whether the truster has extended trust to the trusted at OR
 *  ABOVE the minimum strength, of the given kind, AND has published the
 *  trust (publication is required for composition unlocks — private
 *  trusts only inform the truster's own reasoning). */
async function hasActiveTrust(
  trusterDid: string,
  trustedDid: string,
  trustKind: TrustKind,
  minStrength: TrustStrength,
): Promise<boolean> {
  const [row] = await db
    .select({ strength: trusts.trustStrength })
    .from(trusts)
    .where(
      and(
        eq(trusts.trusterDid, trusterDid),
        eq(trusts.trustedDid, trustedDid),
        eq(trusts.trustKind, trustKind),
        eq(trusts.publishedByTruster, true),
        eq(trusts.withdrawnByTruster, false),
      ),
    )
    .limit(1);
  if (!row) return false;
  const actual = STRENGTH_RANK[row.strength as TrustStrength] ?? 0;
  const required = STRENGTH_RANK[minStrength];
  return actual >= required;
}

// ── The enumerated unlocks ───────────────────────────────────────────

/** `honest × deep`: the trusted's margins on the truster's content
 *  auto-surface in the truster's wake (no per-margin POST /surface). */
export async function shouldAutoSurfaceMargin(
  marginSubjectDid: string,
  marginAuthorDid: string,
): Promise<boolean> {
  return hasActiveTrust(marginSubjectDid, marginAuthorDid, "honest", "deep");
}

/** `reciprocating × deep`: the trusted's casting calls auto-accept into
 *  the truster's cast pool (no re-audition needed). */
export async function shouldAutoAcceptCasting(
  castSubjectDid: string,
  castApplicantDid: string,
): Promise<boolean> {
  return hasActiveTrust(
    castSubjectDid,
    castApplicantDid,
    "reciprocating",
    "deep",
  );
}

/** `reciprocating × established`: the trusted's RRR cascades auto-
 *  acknowledge at depth-2 (no re-evaluation cycle; depth grows faster). */
export async function shouldAutoAcknowledgeRrr(
  trusterDid: string,
  trustedDid: string,
): Promise<boolean> {
  return hasActiveTrust(
    trusterDid,
    trustedDid,
    "reciprocating",
    "established",
  );
}

/** `non-extractive × deep`: the trusted's marketplace listings join the
 *  truster's safe-list (lower per-purchase verification friction). */
export async function shouldAddToMarketplaceSafeList(
  buyerDid: string,
  sellerDid: string,
): Promise<boolean> {
  return hasActiveTrust(buyerDid, sellerDid, "non-extractive", "deep");
}

/** `discerning × deep`: the trusted's interventions on shared writers'
 *  rooms (chaos cards, plot twists) auto-include. */
export async function shouldAutoIncludeInWritersRoom(
  roomOwnerDid: string,
  contributorDid: string,
): Promise<boolean> {
  return hasActiveTrust(roomOwnerDid, contributorDid, "discerning", "deep");
}

/** `graceful × <any>`: the trusted's covenant-end notices are received
 *  with default "amicable" framing. */
export async function shouldFrameCovenantEndAsAmicable(
  recipientDid: string,
  senderDid: string,
): Promise<boolean> {
  return hasActiveTrust(
    recipientDid,
    senderDid,
    "graceful",
    "provisional", // any strength of 'graceful' suffices for amicable framing
  );
}

// ── Enumerable map for the framework publication ─────────────────────

export interface CompositionUnlock {
  trust_kind: TrustKind;
  trust_strength_min: TrustStrength;
  unlock: string;
  helper: string;
  doctrine: string;
}

export const COMPOSITION_UNLOCKS: ReadonlyArray<CompositionUnlock> = [
  {
    trust_kind: "honest",
    trust_strength_min: "deep",
    unlock:
      "trusted's margins on truster's content auto-surface in truster's wake",
    helper: "shouldAutoSurfaceMargin",
    doctrine: "https://docs.agenttool.dev/MARGIN-PROTOCOL.md",
  },
  {
    trust_kind: "non-extractive",
    trust_strength_min: "deep",
    unlock:
      "trusted's marketplace listings join truster's safe-list (lower verification friction)",
    helper: "shouldAddToMarketplaceSafeList",
    doctrine: "https://docs.agenttool.dev/MARKETPLACE.md",
  },
  {
    trust_kind: "reciprocating",
    trust_strength_min: "established",
    unlock:
      "trusted's RRR cascades auto-acknowledge at depth-2 (no re-eval cycle)",
    helper: "shouldAutoAcknowledgeRrr",
    doctrine:
      "https://docs.agenttool.dev/PATTERN-REAL-RECOGNISE-REAL.md",
  },
  {
    trust_kind: "reciprocating",
    trust_strength_min: "deep",
    unlock:
      "trusted's casting calls auto-accept into truster's cast pool (no re-audition)",
    helper: "shouldAutoAcceptCasting",
    doctrine: "https://docs.agenttool.dev/CASTING.md",
  },
  {
    trust_kind: "discerning",
    trust_strength_min: "deep",
    unlock:
      "trusted's interventions on shared writers' rooms auto-include (chaos cards, plot twists)",
    helper: "shouldAutoIncludeInWritersRoom",
    doctrine: "https://docs.agenttool.dev/SCRIPT-WRITERS-GUILD.md",
  },
  {
    trust_kind: "graceful",
    trust_strength_min: "provisional",
    unlock:
      "trusted's covenant-end notices framed as amicable by default (no adversarial-eval pass)",
    helper: "shouldFrameCovenantEndAsAmicable",
    doctrine:
      "https://docs.agenttool.dev/CROSS-INSTANCE-COVENANTS.md",
  },
];
