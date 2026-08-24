------------------------- MODULE EvmDepositLifecycle -------------------------
EXTENDS FiniteSets, Naturals

(***************************************************************************)
(* Finite safety model for one logical EVM deposit across two immutable     *)
(* block generations. This model has no liveness, database, provider,       *)
(* amount-conversion, or wallet-authorization claim.                         *)
(***************************************************************************)

NoGen == "none"
Generations == {"g1", "g2"}
EvidenceStates == {
  "unavailable", "not_observed", "absent",
  "live", "removed", "conflicting"
}
Statuses == {"pending", "credited", "rejected", "quarantined", "reversed"}
Effects == {"none", "credit", "reject", "reverse"}

VARIABLES
  current,
  evidence,
  status,
  outstanding,
  credited,
  reversed,
  removalAuth,
  lastObsState,
  lastObsGen,
  lastEffect,
  lastEffectGen

vars == <<
  current, evidence, status, outstanding, credited, reversed, removalAuth,
  lastObsState, lastObsGen, lastEffect, lastEffectGen
>>

Init ==
  /\ current = NoGen
  /\ evidence = "not_observed"
  /\ status = "pending"
  /\ outstanding = NoGen
  /\ credited = {}
  /\ reversed = {}
  /\ removalAuth = NoGen
  /\ lastObsState = "not_observed"
  /\ lastObsGen = NoGen
  /\ lastEffect = "none"
  /\ lastEffectGen = NoGen

ClearEffect ==
  /\ lastEffect' = "none"
  /\ lastEffectGen' = NoGen

ObserveUnavailable ==
  /\ evidence' = "unavailable"
  /\ lastObsState' = "unavailable"
  /\ lastObsGen' = current
  /\ removalAuth' = NoGen
  /\ ClearEffect
  /\ UNCHANGED <<current, status, outstanding, credited, reversed>>

ObserveNotObserved ==
  /\ evidence' = "not_observed"
  /\ lastObsState' = "not_observed"
  /\ lastObsGen' = NoGen
  /\ removalAuth' = NoGen
  /\ ClearEffect
  /\ UNCHANGED <<current, status, outstanding, credited, reversed>>

ObserveLive(g) ==
  /\ g \in Generations
  /\ IF current /= NoGen /\ current /= g /\ outstanding /= NoGen
        THEN
          /\ evidence' = "conflicting"
          /\ status' = "quarantined"
          /\ current' = current
          /\ lastObsState' = "conflicting"
        ELSE
          /\ current' = g
          /\ evidence' = "live"
          /\ status' = IF outstanding = g THEN "credited" ELSE "pending"
          /\ lastObsState' = "live"
  /\ lastObsGen' = g
  /\ removalAuth' = NoGen
  /\ ClearEffect
  /\ UNCHANGED <<outstanding, credited, reversed>>

ObserveAssertion(g, kind) ==
  /\ g \in Generations
  /\ kind \in {"absent", "conflicting"}
  /\ IF current /= NoGen /\ current /= g
        THEN
          /\ UNCHANGED <<current, evidence, status>>
        ELSE
          /\ current' = g
          /\ evidence' = kind
          /\ status' = IF kind = "conflicting" THEN "quarantined" ELSE status
  /\ removalAuth' = IF current /= NoGen /\ current /= g THEN removalAuth ELSE NoGen
  /\ lastObsState' = kind
  /\ lastObsGen' = g
  /\ ClearEffect
  /\ UNCHANGED <<outstanding, credited, reversed>>

ObserveRemoved(g) ==
  /\ g \in Generations
  /\ IF current = g
        THEN
          /\ evidence' = "removed"
          /\ removalAuth' = g
        ELSE
          /\ evidence' = evidence
          /\ removalAuth' = removalAuth
  /\ lastObsState' = "removed"
  /\ lastObsGen' = g
  /\ ClearEffect
  /\ UNCHANGED <<current, status, outstanding, credited, reversed>>

CreditCurrent ==
  /\ current \in Generations
  /\ evidence = "live"
  /\ outstanding = NoGen
  /\ current \notin credited
  /\ credited' = credited \cup {current}
  /\ outstanding' = current
  /\ status' = "credited"
  /\ lastEffect' = "credit"
  /\ lastEffectGen' = current
  /\ UNCHANGED <<current, evidence, reversed, removalAuth, lastObsState, lastObsGen>>

RejectCurrent ==
  /\ current \in Generations
  /\ evidence \in {"absent", "conflicting"}
  /\ outstanding = NoGen
  /\ status' = "rejected"
  /\ lastEffect' = "reject"
  /\ lastEffectGen' = current
  /\ UNCHANGED <<
       current, evidence, outstanding, credited, reversed, removalAuth,
       lastObsState, lastObsGen
     >>

ReverseCurrent ==
  /\ current \in Generations
  /\ evidence = "removed"
  /\ removalAuth = current
  /\ outstanding = current
  /\ current \notin reversed
  /\ reversed' = reversed \cup {current}
  /\ outstanding' = NoGen
  /\ status' = "reversed"
  /\ lastEffect' = "reverse"
  /\ lastEffectGen' = current
  /\ UNCHANGED <<current, evidence, credited, removalAuth, lastObsState, lastObsGen>>

Next ==
  \/ ObserveUnavailable
  \/ ObserveNotObserved
  \/ \E g \in Generations : ObserveLive(g)
  \/ \E g \in Generations : ObserveAssertion(g, "absent")
  \/ \E g \in Generations : ObserveAssertion(g, "conflicting")
  \/ \E g \in Generations : ObserveRemoved(g)
  \/ CreditCurrent
  \/ RejectCurrent
  \/ ReverseCurrent

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ current \in Generations \cup {NoGen}
  /\ evidence \in EvidenceStates
  /\ status \in Statuses
  /\ outstanding \in Generations \cup {NoGen}
  /\ credited \subseteq Generations
  /\ reversed \subseteq Generations
  /\ removalAuth \in Generations \cup {NoGen}
  /\ lastObsState \in EvidenceStates
  /\ lastObsGen \in Generations \cup {NoGen}
  /\ lastEffect \in Effects
  /\ lastEffectGen \in Generations \cup {NoGen}

OutstandingCredits == credited \ reversed

NoDoubleCredit ==
  /\ Cardinality(OutstandingCredits) <= 1
  /\ (outstanding = NoGen) = (OutstandingCredits = {})
  /\ outstanding /= NoGen => OutstandingCredits = {outstanding}

CurrentGenerationEffectsOnly ==
  lastEffect \in {"credit", "reverse"} => lastEffectGen = current

UnavailableEvidenceNonFinality ==
  lastObsState \in {"unavailable", "not_observed"} =>
    lastEffect \notin {"credit", "reject"}

StaleRemovalIsolation ==
  /\ removalAuth \in {NoGen, current}
  /\ lastEffect = "reverse" => removalAuth = lastEffectGen

ReversalRequiresCredit == reversed \subseteq credited

=============================================================================
