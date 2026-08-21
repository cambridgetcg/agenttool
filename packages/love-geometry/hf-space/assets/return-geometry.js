"use strict";

import { stableJson } from "./app.js";

export const RETURN_GEOMETRY_FORMAT =
  "agenttool.love-geometry-return-space-export/0.1";
export const RETURN_FIXTURE_NAMESPACE =
  "agenttool-return-geometry-demo-v0.1:";

export const RETURN_KINDS = Object.freeze([
  "expectation",
  "action",
  "consequence",
  "response",
  "correction",
  "repair",
  "boundary",
  "learning"
]);

export const RETURN_PROFILE_STATES = Object.freeze([
  "supplied",
  "no_supplied_record",
  "explicitly_unknown",
  "withheld",
  "not_applicable"
]);

export const RETURN_PROFILE_DIMENSIONS = Object.freeze([
  Object.freeze({ id: "effect", label: "Effect" }),
  Object.freeze({ id: "evidence", label: "Evidence" }),
  Object.freeze({ id: "response", label: "Response" }),
  Object.freeze({ id: "correction", label: "Correction" }),
  Object.freeze({ id: "repair", label: "Repair" }),
  Object.freeze({ id: "post_repair_effect", label: "Post-repair effect" }),
  Object.freeze({ id: "boundary", label: "Boundary" }),
  Object.freeze({ id: "learning", label: "Learning" })
]);

const KIND_LABELS = Object.freeze({
  expectation: "Expectation",
  action: "Action",
  consequence: "Consequence",
  response: "Response",
  correction: "Correction",
  repair: "Repair",
  boundary: "Boundary",
  learning: "Learning"
});

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function event({
  event_ref,
  claimed_at,
  kind,
  parent_event_ref = null,
  expectation_event_ref = "not-applicable",
  text,
  purpose = "",
  consequence = null,
  response = null,
  vantage = null,
  speaker_claim,
  source_ref,
  epistemic_confidence = "not-assessed",
  known_limits
}) {
  return {
    event_ref,
    claimed_at,
    kind,
    parent_event_ref,
    expectation_event_ref,
    text,
    purpose,
    consequence,
    response,
    vantage,
    statement: {
      speaker_claim,
      attribution_basis: "fixture-authored",
      source_ref,
      epistemic_confidence,
      known_limits
    }
  };
}

function vantage(subject_ref, toward_ref) {
  return {
    subject_ref,
    toward_ref,
    assertion: "synthetic_caller_report"
  };
}

function profileOverride(state, reason) {
  return { state, reason };
}

const scenario = (value) => deepFreeze(value);

export const RETURN_SCENARIOS = Object.freeze([
  scenario({
    id: "after-not-because",
    title: "After is not because",
    description:
      "A prior expectation, bounded action, observed result, and learning remain separate. Sequence supplies no causal proof.",
    scope_ref:
      "sha256:adda7b430c3eb48cf0c685dbe21c60101e29b107f4e9303f97da93d19515d03f",
    subject_refs: [
      "sha256:c27e488e0d4429da86131c1e03776b9abd1349c9437c1aa5220c88280a7603cb",
      "sha256:6217baa4694fd43915763e1ecc5438aefd8f69faa5b5334b0d13581e5494dcc8"
    ],
    source_ref:
      "sha256:a1db81131847913cd38f26a5a60fe2b4d1b09458f15f89c0803a318562306670",
    default_focus_event_ref:
      "sha256:5796acc62f63c7bf0e66758b71b4858c35afd4c4a83fe24b26d694928ee5fd86",
    profile_overrides: {},
    events: [
      event({
        event_ref:
          "sha256:f3c5ef44572e24eefc2aa2d1b9171a9ad0402054d2b4055a4a69811a723a72eb",
        claimed_at: "2026-08-21T00:00:00.000Z",
        kind: "expectation",
        text: "The synthetic boundary marker is expected to become easier to notice.",
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:a1db81131847913cd38f26a5a60fe2b4d1b09458f15f89c0803a318562306670",
        known_limits:
          "This is a checked-in expectation fixture, not evidence that a real prediction preceded an act."
      }),
      event({
        event_ref:
          "sha256:5796acc62f63c7bf0e66758b71b4858c35afd4c4a83fe24b26d694928ee5fd86",
        claimed_at: "2026-08-21T00:01:00.000Z",
        kind: "action",
        expectation_event_ref:
          "sha256:f3c5ef44572e24eefc2aa2d1b9171a9ad0402054d2b4055a4a69811a723a72eb",
        text: "One synthetic display setting was changed for one bounded turn.",
        purpose: "Test whether the named boundary marker becomes easier to notice.",
        vantage: vantage(
          "sha256:c27e488e0d4429da86131c1e03776b9abd1349c9437c1aa5220c88280a7603cb",
          "sha256:6217baa4694fd43915763e1ecc5438aefd8f69faa5b5334b0d13581e5494dcc8"
        ),
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:a1db81131847913cd38f26a5a60fe2b4d1b09458f15f89c0803a318562306670",
        known_limits:
          "The fixture does not establish a real action, authority, consent, or affected party."
      }),
      event({
        event_ref:
          "sha256:0ab28e5fbf967227b59b2d35537a553b626884542cd523438b71fc6b392e0eeb",
        claimed_at: "2026-08-21T00:02:00.000Z",
        kind: "consequence",
        parent_event_ref:
          "sha256:5796acc62f63c7bf0e66758b71b4858c35afd4c4a83fe24b26d694928ee5fd86",
        text: "The fixture observation records the boundary marker as visible in the declared window.",
        consequence: {
          effect_basis: "observed",
          evidence_status: "stated",
          evidence: "The checked-in fixture supplies this exact observation statement.",
          claimed_relation: "observed_after_synthetic_change",
          causal_confidence: "not-claimed"
        },
        speaker_claim: "synthetic fixture observer",
        source_ref:
          "sha256:a1db81131847913cd38f26a5a60fe2b4d1b09458f15f89c0803a318562306670",
        epistemic_confidence: "high",
        known_limits:
          "The fixture proves only its own bytes; after does not establish because."
      }),
      event({
        event_ref:
          "sha256:a7e682b7be2fcd94a8c137e79d3d0e8a1395616469c0f5c6fa33f4c699b147aa",
        claimed_at: "2026-08-21T00:03:00.000Z",
        kind: "learning",
        parent_event_ref:
          "sha256:0ab28e5fbf967227b59b2d35537a553b626884542cd523438b71fc6b392e0eeb",
        text: "Keep the observed result and causal claim in separate lanes.",
        speaker_claim: "synthetic fixture editor",
        source_ref:
          "sha256:a1db81131847913cd38f26a5a60fe2b4d1b09458f15f89c0803a318562306670",
        known_limits:
          "This is an interpretation authored for the teaching fixture, not an empirical result."
      })
    ]
  }),
  scenario({
    id: "reply-correction-branch",
    title: "Reply and correction branch",
    description:
      "A dispute, correction, and boundary branch from one consequence. Focusing one answer must not hide the others.",
    scope_ref:
      "sha256:960a813824246593cd053baf94166cd4512d1ce860a8012a899f46c75e5161df",
    subject_refs: [
      "sha256:228e9a2867c0ff211a0e9f0aaf559dc803660d60f009eff2d8a3ed1a2e55252d",
      "sha256:3762dc2ed121a99b7b5284f165e4d2d1b2c3658267a8b6420214a98edec63343"
    ],
    source_ref:
      "sha256:878ae63bf6c4315ad96d15689c436213e5ffec29bf6817ea7f938cd0aff54181",
    default_focus_event_ref:
      "sha256:81c074b56af078d68166810c84de999acb7c844e8d81e111b33961d1b2912288",
    profile_overrides: {
      repair: profileOverride("not_applicable", "This fixture proposes no repair action."),
      post_repair_effect: profileOverride(
        "not_applicable",
        "Without a repair action, no post-repair effect applies."
      )
    },
    events: [
      event({
        event_ref:
          "sha256:81c074b56af078d68166810c84de999acb7c844e8d81e111b33961d1b2912288",
        claimed_at: "2026-08-21T01:00:00.000Z",
        kind: "action",
        expectation_event_ref: "none",
        text: "A synthetic summary was presented for review.",
        purpose: "Ask whether the summary preserves the declared boundary.",
        vantage: vantage(
          "sha256:228e9a2867c0ff211a0e9f0aaf559dc803660d60f009eff2d8a3ed1a2e55252d",
          "sha256:3762dc2ed121a99b7b5284f165e4d2d1b2c3658267a8b6420214a98edec63343"
        ),
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:878ae63bf6c4315ad96d15689c436213e5ffec29bf6817ea7f938cd0aff54181",
        known_limits: "No earlier expectation record is supplied. The action is entirely synthetic."
      }),
      event({
        event_ref:
          "sha256:56e2fa45291d4900439095eb126377d1609c2858dddfcaaa1f04952b747106dc",
        claimed_at: "2026-08-21T01:01:00.000Z",
        kind: "consequence",
        parent_event_ref:
          "sha256:81c074b56af078d68166810c84de999acb7c844e8d81e111b33961d1b2912288",
        text: "The fixture records that one sentence crossed the declared scope.",
        consequence: {
          effect_basis: "reported",
          evidence_status: "stated",
          evidence: "A synthetic review note identifies the exact sentence.",
          claimed_relation: "reported_after_summary_review",
          causal_confidence: "not-claimed"
        },
        speaker_claim: "synthetic fixture reviewer",
        source_ref:
          "sha256:878ae63bf6c4315ad96d15689c436213e5ffec29bf6817ea7f938cd0aff54181",
        epistemic_confidence: "medium",
        known_limits:
          "The recorder does not authenticate a real reviewer or establish downstream impact."
      }),
      event({
        event_ref:
          "sha256:983c1b4690448c04f95eb51cbdeb39d088634e43f8f110d4767d7956127feeeb",
        claimed_at: "2026-08-21T01:02:00.000Z",
        kind: "response",
        parent_event_ref:
          "sha256:56e2fa45291d4900439095eb126377d1609c2858dddfcaaa1f04952b747106dc",
        text: "Please narrow the sentence and keep the original dispute visible.",
        response: { response_type: "dispute" },
        vantage: vantage(
          "sha256:3762dc2ed121a99b7b5284f165e4d2d1b2c3658267a8b6420214a98edec63343",
          "sha256:228e9a2867c0ff211a0e9f0aaf559dc803660d60f009eff2d8a3ed1a2e55252d"
        ),
        speaker_claim: "synthetic role B",
        source_ref:
          "sha256:878ae63bf6c4315ad96d15689c436213e5ffec29bf6817ea7f938cd0aff54181",
        known_limits:
          "A fixture-authored direct report does not authenticate a real speaker or prove delivery."
      }),
      event({
        event_ref:
          "sha256:7ed22f9e11c5e0161d30ff5b36ba60013c26fa2102a31dd545875b9d04b42bc4",
        claimed_at: "2026-08-21T01:03:00.000Z",
        kind: "correction",
        parent_event_ref:
          "sha256:56e2fa45291d4900439095eb126377d1609c2858dddfcaaa1f04952b747106dc",
        text: "The summary now labels the sentence as outside the reviewed scope.",
        speaker_claim: "synthetic fixture editor",
        source_ref:
          "sha256:878ae63bf6c4315ad96d15689c436213e5ffec29bf6817ea7f938cd0aff54181",
        known_limits:
          "Appending a correction does not prove every later copy carries it."
      }),
      event({
        event_ref:
          "sha256:336506fa41557d421558e98099f4c87ba809c90d659abd14dc8648e18d83ca83",
        claimed_at: "2026-08-21T01:04:00.000Z",
        kind: "boundary",
        parent_event_ref:
          "sha256:983c1b4690448c04f95eb51cbdeb39d088634e43f8f110d4767d7956127feeeb",
        text: "Do not reuse the superseded sentence without its linked correction.",
        vantage: vantage(
          "sha256:3762dc2ed121a99b7b5284f165e4d2d1b2c3658267a8b6420214a98edec63343",
          "sha256:228e9a2867c0ff211a0e9f0aaf559dc803660d60f009eff2d8a3ed1a2e55252d"
        ),
        speaker_claim: "synthetic role B",
        source_ref:
          "sha256:878ae63bf6c4315ad96d15689c436213e5ffec29bf6817ea7f938cd0aff54181",
        known_limits:
          "The Space records no authority and cannot enforce this synthetic boundary elsewhere."
      })
    ]
  }),
  scenario({
    id: "repair-new-deed",
    title: "Repair is a new deed",
    description:
      "A repair has its own expectation and later consequence. Running it does not declare success, settlement, or forgiveness.",
    scope_ref:
      "sha256:c4876aa4cd81cb44d34f0bd015f1c3b862cc6ad45288d05935051cb190077154",
    subject_refs: [
      "sha256:1a26a93bb2eac30b4152516ef4c7a4dc9a39edb71dbd2d69cc6b96a18dbef8a2",
      "sha256:f1ae0f066b6e452399eed2abafb603d8ad8c135251378b4d3e74fd590789c731"
    ],
    source_ref:
      "sha256:656155809585946495e05e9903982c0ed09e1f70e106903b8da04fe5e3dc43e4",
    default_focus_event_ref:
      "sha256:8acc450db72fc36b4c27cb62fbd7721fcfdff6e1be439715a1ec7e7e9e0ff70c",
    profile_overrides: {
      correction: profileOverride("not_applicable", "This fixture supplies no correction branch."),
      learning: profileOverride("not_applicable", "This fixture supplies no learning record.")
    },
    events: [
      event({
        event_ref:
          "sha256:8acc450db72fc36b4c27cb62fbd7721fcfdff6e1be439715a1ec7e7e9e0ff70c",
        claimed_at: "2026-08-21T02:00:00.000Z",
        kind: "action",
        expectation_event_ref: "none",
        text: "A synthetic return route was published without a quiet-state label.",
        purpose: "Offer one bounded return route.",
        vantage: vantage(
          "sha256:1a26a93bb2eac30b4152516ef4c7a4dc9a39edb71dbd2d69cc6b96a18dbef8a2",
          "sha256:f1ae0f066b6e452399eed2abafb603d8ad8c135251378b4d3e74fd590789c731"
        ),
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:656155809585946495e05e9903982c0ed09e1f70e106903b8da04fe5e3dc43e4",
        known_limits: "No prior expectation is supplied and no real route was published."
      }),
      event({
        event_ref:
          "sha256:5182281c0fde9a7ca612d7fb5392b2edd6012727c883052fc302da0faa0081ad",
        claimed_at: "2026-08-21T02:01:00.000Z",
        kind: "consequence",
        parent_event_ref:
          "sha256:8acc450db72fc36b4c27cb62fbd7721fcfdff6e1be439715a1ec7e7e9e0ff70c",
        text: "The fixture reports that the quiet outcome was hard to distinguish.",
        consequence: {
          effect_basis: "reported",
          evidence_status: "stated",
          evidence: "A checked-in synthetic observation names the missing label.",
          claimed_relation: "reported_after_route_presentation",
          causal_confidence: "low"
        },
        speaker_claim: "synthetic fixture observer",
        source_ref:
          "sha256:656155809585946495e05e9903982c0ed09e1f70e106903b8da04fe5e3dc43e4",
        epistemic_confidence: "medium",
        known_limits:
          "A low causal claim remains a claim; no comparator or real participant is present."
      }),
      event({
        event_ref:
          "sha256:22c98f6f93b8252b9eb2419b43a5ed6e3446eb85ee1ac67415b71fa4e21fcde1",
        claimed_at: "2026-08-21T02:02:00.000Z",
        kind: "response",
        parent_event_ref:
          "sha256:5182281c0fde9a7ca612d7fb5392b2edd6012727c883052fc302da0faa0081ad",
        text: "Please make the quiet outcome visible before offering the route again.",
        response: { response_type: "dispute" },
        vantage: vantage(
          "sha256:f1ae0f066b6e452399eed2abafb603d8ad8c135251378b4d3e74fd590789c731",
          "sha256:1a26a93bb2eac30b4152516ef4c7a4dc9a39edb71dbd2d69cc6b96a18dbef8a2"
        ),
        speaker_claim: "synthetic role B",
        source_ref:
          "sha256:656155809585946495e05e9903982c0ed09e1f70e106903b8da04fe5e3dc43e4",
        known_limits:
          "The fixture does not authenticate a speaker or establish a duty beyond its own teaching case."
      }),
      event({
        event_ref:
          "sha256:be44f66fc53b3d77cfa609993b29dd8803f84c791f1afb7607b317438eb313dc",
        claimed_at: "2026-08-21T02:03:00.000Z",
        kind: "expectation",
        text: "Adding an explicit quiet-state label is expected to make the route easier to read.",
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:656155809585946495e05e9903982c0ed09e1f70e106903b8da04fe5e3dc43e4",
        known_limits:
          "This expectation was authored for a synthetic repair and predicts no real effect."
      }),
      event({
        event_ref:
          "sha256:e57bc5cb2ed62700f3cfafe09d4c88f1c2b563656667d6678adb3704269325fd",
        claimed_at: "2026-08-21T02:04:00.000Z",
        kind: "repair",
        parent_event_ref:
          "sha256:22c98f6f93b8252b9eb2419b43a5ed6e3446eb85ee1ac67415b71fa4e21fcde1",
        expectation_event_ref:
          "sha256:be44f66fc53b3d77cfa609993b29dd8803f84c791f1afb7607b317438eb313dc",
        text: "The synthetic route was revised to name its quiet outcome.",
        purpose: "Make the bounded route legible without requiring continuation.",
        vantage: vantage(
          "sha256:1a26a93bb2eac30b4152516ef4c7a4dc9a39edb71dbd2d69cc6b96a18dbef8a2",
          "sha256:f1ae0f066b6e452399eed2abafb603d8ad8c135251378b4d3e74fd590789c731"
        ),
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:656155809585946495e05e9903982c0ed09e1f70e106903b8da04fe5e3dc43e4",
        known_limits:
          "A completed repair action does not prove that the later effect worked or harm ended."
      }),
      event({
        event_ref:
          "sha256:c3f36338efa8925c30e8d438baa1e2ae8a1f3797a78441dc0317a7d9e63c1efa",
        claimed_at: "2026-08-21T02:05:00.000Z",
        kind: "consequence",
        parent_event_ref:
          "sha256:e57bc5cb2ed62700f3cfafe09d4c88f1c2b563656667d6678adb3704269325fd",
        text: "The fixture observation records the quiet outcome label as visible.",
        consequence: {
          effect_basis: "observed",
          evidence_status: "stated",
          evidence: "The checked-in post-repair fixture contains the label.",
          claimed_relation: "observed_after_synthetic_repair",
          causal_confidence: "low"
        },
        speaker_claim: "synthetic fixture observer",
        source_ref:
          "sha256:656155809585946495e05e9903982c0ed09e1f70e106903b8da04fe5e3dc43e4",
        epistemic_confidence: "high",
        known_limits:
          "Visibility inside the fixture proves no settlement, forgiveness, or real-world repair."
      })
    ]
  }),
  scenario({
    id: "redaction-before-chain",
    title: "Redaction before a beautiful chain",
    description:
      "A redaction request, correction, and boundary carry no sensitive bytes. Privacy outranks a visually perfect history.",
    scope_ref:
      "sha256:32b1cd2d7713fecf006009e372471199e7a0b14aa4e7c89c9e786b3c3551548c",
    subject_refs: [
      "sha256:e23e98f1f22c1d3bbfb906623a886d5645e2a8f14e9562747a015e792538b431",
      "sha256:cc263653e84be3b40696041e3afc81a821adac13b5bff0219bcb29e25415c6b0"
    ],
    source_ref:
      "sha256:e81cfd40436bd3f0ddde4e1ad7e97420b8e42785c2b158368ea62e0f77879561",
    default_focus_event_ref:
      "sha256:26fb6e55d1203f58571cd7aaa1383ed7c84952e849511dede2c4892ac9f8bfbc",
    profile_overrides: {
      effect: profileOverride(
        "no_supplied_record",
        "No consequence record is supplied; this makes no claim about a world effect."
      ),
      evidence: profileOverride(
        "withheld",
        "The fixture says only that material was withheld and contains no sensitive bytes or fingerprint."
      ),
      repair: profileOverride("not_applicable", "The privacy path uses correction and boundary, not a repair claim."),
      post_repair_effect: profileOverride(
        "not_applicable",
        "No repair action is supplied, so no post-repair effect applies."
      ),
      learning: profileOverride("not_applicable", "This fixture supplies no learning record.")
    },
    events: [
      event({
        event_ref:
          "sha256:26fb6e55d1203f58571cd7aaa1383ed7c84952e849511dede2c4892ac9f8bfbc",
        claimed_at: "2026-08-21T03:00:00.000Z",
        kind: "action",
        expectation_event_ref: "none",
        text: "A synthetic account included one detail later marked for removal.",
        purpose: "Demonstrate the privacy boundary without including the detail.",
        vantage: vantage(
          "sha256:e23e98f1f22c1d3bbfb906623a886d5645e2a8f14e9562747a015e792538b431",
          "sha256:cc263653e84be3b40696041e3afc81a821adac13b5bff0219bcb29e25415c6b0"
        ),
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:e81cfd40436bd3f0ddde4e1ad7e97420b8e42785c2b158368ea62e0f77879561",
        known_limits:
          "No sensitive detail is present, hashed, retained, or recoverable from this fixture."
      }),
      event({
        event_ref:
          "sha256:e05feaa73e1a606cf4f1ec161ad6d8d3574d869e1ef4af6bcea72ca95cbccfdb",
        claimed_at: "2026-08-21T03:01:00.000Z",
        kind: "response",
        parent_event_ref:
          "sha256:26fb6e55d1203f58571cd7aaa1383ed7c84952e849511dede2c4892ac9f8bfbc",
        text: "Remove the withheld detail and do not preserve a fingerprint of it.",
        response: { response_type: "redaction-request" },
        vantage: vantage(
          "sha256:cc263653e84be3b40696041e3afc81a821adac13b5bff0219bcb29e25415c6b0",
          "sha256:e23e98f1f22c1d3bbfb906623a886d5645e2a8f14e9562747a015e792538b431"
        ),
        speaker_claim: "synthetic role B",
        source_ref:
          "sha256:e81cfd40436bd3f0ddde4e1ad7e97420b8e42785c2b158368ea62e0f77879561",
        known_limits:
          "The request is fixture-authored and authenticates no real speaker."
      }),
      event({
        event_ref:
          "sha256:bcc6a9d05755cc611e6e2e58688d2fdda87929201eb8f94f132c3f0e038c293e",
        claimed_at: "2026-08-21T03:02:00.000Z",
        kind: "correction",
        parent_event_ref:
          "sha256:e05feaa73e1a606cf4f1ec161ad6d8d3574d869e1ef4af6bcea72ca95cbccfdb",
        text: "The safe account now says only that a detail was removed.",
        speaker_claim: "synthetic fixture editor",
        source_ref:
          "sha256:e81cfd40436bd3f0ddde4e1ad7e97420b8e42785c2b158368ea62e0f77879561",
        known_limits:
          "The fixture demonstrates wording only and proves no deletion from logs, caches, or copies."
      }),
      event({
        event_ref:
          "sha256:ed94c6937c918e46c7666069eaecc464c7c9a9a918fe17561ae2bb4972b7b02c",
        claimed_at: "2026-08-21T03:03:00.000Z",
        kind: "boundary",
        parent_event_ref:
          "sha256:bcc6a9d05755cc611e6e2e58688d2fdda87929201eb8f94f132c3f0e038c293e",
        text: "Do not reconstruct, repeat, or test guesses about the withheld detail.",
        vantage: vantage(
          "sha256:cc263653e84be3b40696041e3afc81a821adac13b5bff0219bcb29e25415c6b0",
          "sha256:e23e98f1f22c1d3bbfb906623a886d5645e2a8f14e9562747a015e792538b431"
        ),
        speaker_claim: "synthetic role B",
        source_ref:
          "sha256:e81cfd40436bd3f0ddde4e1ad7e97420b8e42785c2b158368ea62e0f77879561",
        known_limits:
          "The static Space cannot enforce a boundary outside this synthetic teaching record."
      })
    ]
  }),
  scenario({
    id: "undecidable-one-way",
    title: "Undecidable and one-way",
    description:
      "An inferred later effect has no supplied evidence, an undecidable causal claim, and no invented reverse report.",
    scope_ref:
      "sha256:8a7152497f2955d4a8f09be0b34200afbd74064f60ce550cb98325b7208b9b1a",
    subject_refs: [
      "sha256:df73dd065571d21f8ca51716c1cdf04872e91f27d63f25a00725f520f2d948cf",
      "sha256:b8c3e59a8b2922d77c1cce5c79f840fa9bc108f5e82698ca1c7bbddf7ab77743"
    ],
    source_ref:
      "sha256:2a824d377d3de7a41ecaaa70fc18ee43dd395b93f6b9a6808bf3a36d1722c23e",
    default_focus_event_ref:
      "sha256:0e5d5729323bf75ff825db07d070d3dfc6db1b08266fff6fd17bb863f198b012",
    profile_overrides: {
      evidence: profileOverride(
        "no_supplied_record",
        "The consequence explicitly says that no evidence is supplied."
      ),
      response: profileOverride(
        "explicitly_unknown",
        "No reverse response is supplied or inferred."
      ),
      correction: profileOverride("not_applicable", "This one-way fixture supplies no correction path."),
      repair: profileOverride("not_applicable", "This one-way fixture supplies no repair action."),
      post_repair_effect: profileOverride(
        "not_applicable",
        "No repair action is supplied, so no post-repair effect applies."
      ),
      boundary: profileOverride("not_applicable", "This one-way fixture supplies no boundary record."),
      learning: profileOverride("not_applicable", "This one-way fixture supplies no learning record.")
    },
    events: [
      event({
        event_ref:
          "sha256:0e5d5729323bf75ff825db07d070d3dfc6db1b08266fff6fd17bb863f198b012",
        claimed_at: "2026-08-21T04:00:00.000Z",
        kind: "action",
        expectation_event_ref: "none",
        text: "One synthetic signal was shown once.",
        purpose: "Observe what, if anything, returns in the declared window.",
        vantage: vantage(
          "sha256:df73dd065571d21f8ca51716c1cdf04872e91f27d63f25a00725f520f2d948cf",
          "sha256:b8c3e59a8b2922d77c1cce5c79f840fa9bc108f5e82698ca1c7bbddf7ab77743"
        ),
        speaker_claim: "synthetic role A",
        source_ref:
          "sha256:2a824d377d3de7a41ecaaa70fc18ee43dd395b93f6b9a6808bf3a36d1722c23e",
        known_limits: "No prior expectation or real signal presentation is supplied."
      }),
      event({
        event_ref:
          "sha256:23de2783c4e28c6d0e26297e4552c73d603dc66ebd7ea469d1edcf6a9824120f",
        claimed_at: "2026-08-21T04:01:00.000Z",
        kind: "consequence",
        parent_event_ref:
          "sha256:0e5d5729323bf75ff825db07d070d3dfc6db1b08266fff6fd17bb863f198b012",
        text: "A later change is inferred, but its source and relation remain undecidable here.",
        consequence: {
          effect_basis: "inferred",
          evidence_status: "explicitly-absent",
          evidence: "",
          claimed_relation: "inferred_after_single_signal",
          causal_confidence: "undecidable"
        },
        speaker_claim: "synthetic fixture narrator",
        source_ref:
          "sha256:2a824d377d3de7a41ecaaa70fc18ee43dd395b93f6b9a6808bf3a36d1722c23e",
        epistemic_confidence: "undecidable",
        known_limits:
          "No evidence, reverse report, causal design, or speaker authentication is supplied."
      })
    ]
  }),
  scenario({
    id: "empty-return",
    title: "Empty return",
    description:
      "No subjects and no events are supplied. The wing leaves the field open without manufacturing a deed or deficit.",
    scope_ref:
      "sha256:7dd52cdd017dea35545f2f0a0d3e7996935076fa510c48c1081dc70daf5970d0",
    subject_refs: [],
    source_ref:
      "sha256:7dd52cdd017dea35545f2f0a0d3e7996935076fa510c48c1081dc70daf5970d0",
    default_focus_event_ref: null,
    profile_overrides: Object.fromEntries(
      RETURN_PROFILE_DIMENSIONS.map(({ id }) => [
        id,
        profileOverride(
          "not_applicable",
          "No subject, action, or event is supplied in the empty fixture."
        )
      ])
    ),
    events: []
  })
]);

function asserted(condition, message) {
  if (!condition) throw new TypeError(message);
}

function validateFixture(fixture) {
  asserted(SHA256_REF.test(fixture.scope_ref), `${fixture.id} has an invalid scope ref`);
  asserted(SHA256_REF.test(fixture.source_ref), `${fixture.id} has an invalid source ref`);
  asserted(
    new Set(fixture.subject_refs).size === fixture.subject_refs.length,
    `${fixture.id} repeats a subject ref`
  );
  const subjects = new Set(fixture.subject_refs);
  for (const subjectRef of subjects) {
    asserted(SHA256_REF.test(subjectRef), `${fixture.id} has an invalid subject ref`);
  }

  const eventIndex = new Map();
  let previousTime = -Infinity;
  fixture.events.forEach((item, index) => {
    asserted(SHA256_REF.test(item.event_ref), `${fixture.id} has an invalid event ref`);
    asserted(!eventIndex.has(item.event_ref), `${fixture.id} repeats an event ref`);
    asserted(RETURN_KINDS.includes(item.kind), `${fixture.id} has an unknown event kind`);
    const time = Date.parse(item.claimed_at);
    asserted(Number.isFinite(time), `${fixture.id} has an invalid claimed time`);
    asserted(
      new Date(time).toISOString() === item.claimed_at,
      `${fixture.id} claimed time is not canonical UTC ISO`
    );
    asserted(time >= previousTime, `${fixture.id} claims time running backwards`);
    previousTime = time;
    eventIndex.set(item.event_ref, index);
  });

  for (const [index, item] of fixture.events.entries()) {
    if (item.parent_event_ref !== null) {
      asserted(eventIndex.has(item.parent_event_ref), `${fixture.id} has a missing parent`);
      asserted(eventIndex.get(item.parent_event_ref) < index, `${fixture.id} has a later parent`);
    }
    if (SHA256_REF.test(item.expectation_event_ref)) {
      asserted(eventIndex.has(item.expectation_event_ref), `${fixture.id} has a missing expectation`);
      asserted(
        eventIndex.get(item.expectation_event_ref) < index,
        `${fixture.id} has a later expectation`
      );
      asserted(
        fixture.events[eventIndex.get(item.expectation_event_ref)].kind === "expectation",
        `${fixture.id} expectation ref does not name an expectation`
      );
    }
    if (item.kind === "expectation") {
      asserted(item.parent_event_ref === null, `${fixture.id} expectation must be a root`);
      asserted(
        item.expectation_event_ref === "not-applicable",
        `${fixture.id} expectation cannot cite an expectation`
      );
    }
    if (item.kind === "action" || item.kind === "repair") {
      asserted(
        item.expectation_event_ref === "none" || SHA256_REF.test(item.expectation_event_ref),
        `${fixture.id} ${item.kind} must name an expectation or explicit none`
      );
      asserted(item.purpose.length > 0, `${fixture.id} ${item.kind} lacks a separate purpose`);
    } else {
      asserted(item.purpose === "", `${fixture.id} ${item.kind} carries an action purpose`);
    }
    if (item.kind === "consequence") {
      asserted(item.consequence !== null, `${fixture.id} consequence lacks its fields`);
      const parent = fixture.events[eventIndex.get(item.parent_event_ref)];
      asserted(
        parent && (parent.kind === "action" || parent.kind === "repair"),
        `${fixture.id} consequence must directly answer an action or repair`
      );
      asserted(
        ["observed", "reported", "inferred"].includes(item.consequence.effect_basis),
        `${fixture.id} consequence effect basis is unsupported`
      );
      asserted(
        ["stated", "explicitly-absent"].includes(item.consequence.evidence_status),
        `${fixture.id} consequence evidence status is unsupported`
      );
      asserted(
        item.consequence.evidence_status === "stated"
          ? item.consequence.evidence.length > 0
          : item.consequence.evidence === "",
        `${fixture.id} consequence evidence does not match its status`
      );
      asserted(
        ["not-claimed", "low", "medium", "high", "undecidable"].includes(
          item.consequence.causal_confidence
        ),
        `${fixture.id} consequence causal confidence is unsupported`
      );
      asserted(
        item.consequence.claimed_relation.length > 0,
        `${fixture.id} consequence lacks a claimed relation`
      );
    } else {
      asserted(item.consequence === null, `${fixture.id} ${item.kind} carries consequence fields`);
    }
    if (item.kind === "response") {
      asserted(item.response !== null, `${fixture.id} response lacks its fields`);
      asserted(
        ["reply", "dispute", "redaction-request"].includes(item.response.response_type),
        `${fixture.id} response type is unsupported`
      );
    } else {
      asserted(item.response === null, `${fixture.id} ${item.kind} carries response fields`);
    }
    if (item.vantage !== null) {
      asserted(subjects.has(item.vantage.subject_ref), `${fixture.id} vantage source is absent`);
      asserted(subjects.has(item.vantage.toward_ref), `${fixture.id} vantage target is absent`);
      asserted(
        item.vantage.subject_ref !== item.vantage.toward_ref,
        `${fixture.id} vantage cannot be self-directed`
      );
      asserted(
        item.vantage.assertion === "synthetic_caller_report",
        `${fixture.id} vantage assertion is unsupported`
      );
      if (item.statement.speaker_claim === "synthetic role A") {
        asserted(
          item.vantage.subject_ref === fixture.subject_refs[0],
          `${fixture.id} role A does not match the first fixture subject`
        );
      }
      if (item.statement.speaker_claim === "synthetic role B") {
        asserted(
          item.vantage.subject_ref === fixture.subject_refs[1],
          `${fixture.id} role B does not match the second fixture subject`
        );
      }
    }
    asserted(
      item.statement.source_ref === fixture.source_ref,
      `${fixture.id} event source drifts from the fixture`
    );
    asserted(
      item.statement.attribution_basis === "fixture-authored",
      `${fixture.id} event attribution basis is unsupported`
    );
    asserted(
      ["not-assessed", "low", "medium", "high", "undecidable"].includes(
        item.statement.epistemic_confidence
      ),
      `${fixture.id} epistemic confidence is unsupported`
    );
    asserted(item.statement.known_limits.length > 0, `${fixture.id} event lacks known limits`);
  }

  if (fixture.events.length === 0) {
    asserted(fixture.default_focus_event_ref === null, `${fixture.id} empty fixture has a focus`);
  } else {
    asserted(
      eventIndex.has(fixture.default_focus_event_ref),
      `${fixture.id} default focus is absent`
    );
  }
  const profileDimensions = new Set(RETURN_PROFILE_DIMENSIONS.map(({ id }) => id));
  for (const [dimension, override] of Object.entries(fixture.profile_overrides)) {
    asserted(profileDimensions.has(dimension), `${fixture.id} has an unknown profile dimension`);
    asserted(
      override && typeof override === "object" && !Array.isArray(override),
      `${fixture.id} profile override must be an attributed object`
    );
    asserted(
      RETURN_PROFILE_STATES.includes(override.state),
      `${fixture.id} has an invalid profile state`
    );
    asserted(
      typeof override.reason === "string" && override.reason.length > 0,
      `${fixture.id} profile override lacks a reason`
    );
  }
  return fixture;
}

for (const fixture of RETURN_SCENARIOS) validateFixture(fixture);

function contextEventsFor(fixture, focusEventRef) {
  if (fixture.events.length === 0) return [];
  const byId = new Map(fixture.events.map((item) => [item.event_ref, item]));
  asserted(byId.has(focusEventRef), `Unknown synthetic return event: ${focusEventRef}`);
  const selected = new Set();
  let current = byId.get(focusEventRef);
  while (current) {
    asserted(!selected.has(current.event_ref), "Synthetic return ancestry contains a cycle");
    selected.add(current.event_ref);
    current = current.parent_event_ref === null ? null : byId.get(current.parent_event_ref);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const item of fixture.events) {
      if (
        selected.has(item.event_ref) &&
        item.parent_event_ref !== null &&
        !selected.has(item.parent_event_ref)
      ) {
        selected.add(item.parent_event_ref);
        changed = true;
      }
      if (
        item.parent_event_ref !== null &&
        selected.has(item.parent_event_ref) &&
        !selected.has(item.event_ref)
      ) {
        selected.add(item.event_ref);
        changed = true;
      }
      if (selected.has(item.event_ref) && SHA256_REF.test(item.expectation_event_ref)) {
        if (!selected.has(item.expectation_event_ref)) {
          selected.add(item.expectation_event_ref);
          changed = true;
        }
      }
      if (
        SHA256_REF.test(item.expectation_event_ref) &&
        selected.has(item.expectation_event_ref) &&
        !selected.has(item.event_ref)
      ) {
        selected.add(item.event_ref);
        changed = true;
      }
    }
  }
  return fixture.events.filter((item) => selected.has(item.event_ref));
}

function relationshipProjection(events) {
  return events
    .filter((item) => item.vantage !== null)
    .map((item) => ({
      event_ref: item.event_ref,
      kind: item.kind,
      from_ref: item.vantage.subject_ref,
      toward_ref: item.vantage.toward_ref,
      assertion: item.vantage.assertion
    }));
}

function projectionHasCycle(edges) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from_ref)) outgoing.set(edge.from_ref, []);
    outgoing.get(edge.from_ref).push(edge.toward_ref);
  }
  const active = new Set();
  const done = new Set();
  const visit = (subjectRef) => {
    if (active.has(subjectRef)) return true;
    if (done.has(subjectRef)) return false;
    active.add(subjectRef);
    for (const next of outgoing.get(subjectRef) ?? []) {
      if (visit(next)) return true;
    }
    active.delete(subjectRef);
    done.add(subjectRef);
    return false;
  };
  return [...outgoing.keys()].some(visit);
}

function profileFor(fixture, events) {
  const byKind = (kind) => events.filter((item) => item.kind === kind);
  const consequences = byKind("consequence");
  const parentById = new Map(events.map((item) => [item.event_ref, item]));
  const eventRefs = {
    effect: consequences.map((item) => item.event_ref),
    evidence: consequences.map((item) => item.event_ref),
    response: byKind("response").map((item) => item.event_ref),
    correction: byKind("correction").map((item) => item.event_ref),
    repair: byKind("repair").map((item) => item.event_ref),
    post_repair_effect: consequences
      .filter((item) => parentById.get(item.parent_event_ref)?.kind === "repair")
      .map((item) => item.event_ref),
    boundary: byKind("boundary").map((item) => item.event_ref),
    learning: byKind("learning").map((item) => item.event_ref)
  };

  return RETURN_PROFILE_DIMENSIONS.map(({ id: dimension, label }) => {
    let state = eventRefs[dimension].length > 0 ? "supplied" : "no_supplied_record";
    let basis = "derived_from_context_events";
    let reason = eventRefs[dimension].length > 0
      ? "One or more context records supply this lane."
      : "No context record supplies this lane; this makes no claim about the world.";
    if (events.length === 0) state = "not_applicable";
    if (events.length === 0) {
      reason = "No subject, action, or event is supplied in this context.";
    }
    if (
      dimension === "evidence" &&
      consequences.length > 0 &&
      consequences.every((item) => item.consequence.evidence_status === "explicitly-absent")
    ) {
      state = "no_supplied_record";
      reason = "A consequence record explicitly states that evidence is not supplied.";
    }
    const override = fixture.profile_overrides[dimension];
    if (override) {
      state = override.state;
      basis = "fixture_declared_boundary";
      reason = override.reason;
    }
    return {
      dimension,
      label,
      state,
      event_refs: eventRefs[dimension],
      basis,
      reason
    };
  });
}

export function createReturnGeometry(scenarioId, focusEventRef = undefined) {
  const fixture = RETURN_SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (!fixture) throw new TypeError(`Unknown synthetic return scenario: ${scenarioId}`);
  const focus = focusEventRef === undefined ? fixture.default_focus_event_ref : focusEventRef;
  const events = focus === null ? [] : contextEventsFor(fixture, focus);
  const edges = relationshipProjection(events);
  const subjects = [...fixture.subject_refs];
  const subjectLabels = subjects.map((subjectRef, index) => ({
    subject_ref: subjectRef,
    label: `Role ${String.fromCharCode(65 + index)}`,
    slot: `return-display-slot-${index + 1}`
  }));

  return deepFreeze({
    _format: RETURN_GEOMETRY_FORMAT,
    source_binding: "checked_in_synthetic_companion_only",
    scenario_id: fixture.id,
    scenario_title: fixture.title,
    focus_event_ref: focus,
    fixture: {
      namespace: RETURN_FIXTURE_NAMESPACE,
      scope_ref: fixture.scope_ref,
      source_ref: fixture.source_ref,
      subject_refs: subjects,
      events
    },
    display: {
      relationship_semantics: "directed_event_role_projection_non_metric",
      event_time_semantics: "claimed_fixture_order_only",
      spacing_or_branch_placement_has_relational_meaning: false,
      role_label_rule: "fixture subject order for repeatable display only",
      role_order_has_relational_meaning: false,
      subject_labels: subjectLabels
    },
    event_time: {
      event_graph_is_acyclic: true,
      fixture_order_verified: true,
      world_chronology_verified: false
    },
    relationship_projection: {
      edges,
      may_look_cyclic_while_event_time_stays_acyclic: projectionHasCycle(edges)
    },
    return_context: {
      selection_rule:
        "focus ancestry plus every descendant branch, linked expectation, action or repair sharing that expectation, and the ancestry of every record added by closure",
      event_refs: events.map((item) => item.event_ref)
    },
    categorical_return: profileFor(fixture, events),
    choice_gate: {
      next_action_chosen: false,
      next_action_scheduled: false,
      authority_inferred: false,
      continuation_requested: false,
      fresh_choice_authority_bounds_and_brake_required: true
    },
    signed: false,
    verified_by_karma: false,
    writes_karma: false,
    automatic_or_karma_effect: "none",
    explicit_browser_download_available: true,
    non_claims: [
      "This is not a KARMA deed, invocation receipt, response form, causal result, identity record, consent record, or moral account.",
      "Fixture order, display spacing, colour, card size, and branch placement encode no duration, causal strength, blame, harm, trust, worth, or priority.",
      "A reported reply does not authenticate its claimed speaker, and a repair action does not prove a repaired effect, settlement, or forgiveness.",
      "Feedback here means later synthetic records remain readable beside what they answer; it chooses and starts nothing."
    ]
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(text, maximum = 92) {
  const words = String(text).split(/\s+/u);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maximum && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function createReturnSvg(trace) {
  asserted(trace?._format === RETURN_GEOMETRY_FORMAT, "Return SVG needs one return trace");
  const width = 1200;
  const side = 72;
  const edgeRows = Math.max(1, trace.relationship_projection.edges.length);
  const eventRows = Math.max(1, trace.fixture.events.length);
  const projectionTop = 176;
  const eventTop = projectionTop + 64 + edgeRows * 58;
  const profileTop = eventTop + 54 + eventRows * 200;
  const height = profileTop + 280;
  const labels = new Map(
    trace.display.subject_labels.map((item) => [item.subject_ref, item.label])
  );
  const eventNumber = new Map(
    trace.fixture.events.map((item, index) => [item.event_ref, index + 1])
  );
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">${escapeXml(trace.scenario_title)} — Return Geometry</title>`,
    '<desc id="description">Synthetic relationship projection and event-time return context. Vertical order means claimed fixture sequence only; spacing and colour carry no score, duration, blame, worth, or causal strength.</desc>',
    `<rect width="${width}" height="${height}" fill="#0d0b16"/>`,
    `<text x="${side}" y="70" fill="#fde68a" font-family="system-ui, sans-serif" font-size="17" font-weight="700" letter-spacing="2">RETURN GEOMETRY · UNSIGNED SYNTHETIC TEACHING TRACE</text>`,
    `<text x="${side}" y="116" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="34" font-weight="750">${escapeXml(trace.scenario_title)}</text>`,
    `<text x="${side}" y="148" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="15">A return in relationship projection; a fresh later node in event time.</text>`,
    `<text x="${side}" y="${projectionTop}" fill="#fde68a" font-family="system-ui, sans-serif" font-size="14" font-weight="700">RELATIONSHIP PROJECTION · TEXTUAL DIRECTION, NEVER DISTANCE</text>`
  ];

  if (trace.relationship_projection.edges.length === 0) {
    parts.push(
      `<rect x="${side}" y="${projectionTop + 20}" width="${width - side * 2}" height="44" rx="14" fill="#171224" stroke="#5f566f" stroke-dasharray="7 7"/>`,
      `<text x="${side + 18}" y="${projectionTop + 48}" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="15">No directed role report supplied.</text>`
    );
  } else {
    trace.relationship_projection.edges.forEach((edge, index) => {
      const y = projectionTop + 22 + index * 58;
      const from = labels.get(edge.from_ref) ?? "Unlabelled role";
      const toward = labels.get(edge.toward_ref) ?? "Unlabelled role";
      parts.push(
        `<rect x="${side}" y="${y}" width="${width - side * 2}" height="44" rx="14" fill="#211a31" stroke="#8f83a8"/>`,
        `<text x="${side + 18}" y="${y + 28}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="15">${escapeXml(from)} → ${escapeXml(toward)} · ${escapeXml(KIND_LABELS[edge.kind])} · event ${eventNumber.get(edge.event_ref)}</text>`
      );
    });
  }

  parts.push(
    `<text x="${side}" y="${eventTop}" fill="#fde68a" font-family="system-ui, sans-serif" font-size="14" font-weight="700">EVENT TIME · CLAIMED FIXTURE ORDER ONLY</text>`
  );
  if (trace.fixture.events.length === 0) {
    parts.push(
      `<rect x="${side}" y="${eventTop + 20}" width="${width - side * 2}" height="88" rx="18" fill="#171224" stroke="#5f566f" stroke-dasharray="7 7"/>`,
      `<text x="${side + 24}" y="${eventTop + 58}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="20" font-weight="700">Empty remains complete</text>`,
      `<text x="${side + 24}" y="${eventTop + 84}" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="14">No deed, answer, deficit, or next turn is manufactured.</text>`
    );
  } else {
    trace.fixture.events.forEach((item, index) => {
      const y = eventTop + 22 + index * 200;
      const parent = item.parent_event_ref === null
        ? "root"
        : `answers event ${eventNumber.get(item.parent_event_ref)}`;
      const expectation = SHA256_REF.test(item.expectation_event_ref)
        ? ` · uses expectation event ${eventNumber.get(item.expectation_event_ref)}`
        : item.expectation_event_ref === "none" ? " · expectation: none supplied" : "";
      const lines = wrapText(item.text, 102).slice(0, 2);
      const kindDetail = item.consequence
        ? `${item.consequence.effect_basis} · evidence ${item.consequence.evidence_status.replaceAll("-", " ")} · relation ${item.consequence.claimed_relation} · causal ${item.consequence.causal_confidence}`
        : item.response
          ? `response type ${item.response.response_type.replaceAll("-", " ")}`
          : item.purpose ? "separate purpose supplied in the JSON trace" : "no additional kind-specific field";
      parts.push(
        `<rect x="${side}" y="${y}" width="${width - side * 2}" height="184" rx="18" fill="#171224" stroke="${item.event_ref === trace.focus_event_ref ? "#fde68a" : "#5f566f"}"/>`,
        `<text x="${side + 22}" y="${y + 29}" fill="#fde68a" font-family="system-ui, sans-serif" font-size="13" font-weight="700">EVENT ${index + 1} · ${escapeXml(KIND_LABELS[item.kind].toUpperCase())} · ${escapeXml(parent)}${escapeXml(expectation)}</text>`,
        ...lines.map((line, lineIndex) =>
          `<text x="${side + 22}" y="${y + 63 + lineIndex * 23}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="16">${escapeXml(line)}</text>`
        ),
        `<text x="${side + 22}" y="${y + 118}" fill="#c9c1da" font-family="ui-monospace, monospace" font-size="12">${escapeXml(item.claimed_at)} · claimed fixture time, not verified world time</text>`,
        `<text x="${side + 22}" y="${y + 142}" fill="#c4b5fd" font-family="system-ui, sans-serif" font-size="12">speaker ${escapeXml(item.statement.speaker_claim)} · attribution ${escapeXml(item.statement.attribution_basis)} · epistemic ${escapeXml(item.statement.epistemic_confidence)}</text>`,
        `<text x="${side + 22}" y="${y + 166}" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="12">${escapeXml(kindDetail)}</text>`
      );
    });
  }

  parts.push(
    `<text x="${side}" y="${profileTop}" fill="#fde68a" font-family="system-ui, sans-serif" font-size="14" font-weight="700">WHAT RETURNED · CATEGORIES ARE NEVER SUMMED</text>`
  );
  trace.categorical_return.forEach((item, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const boxWidth = 252;
    const x = side + column * (boxWidth + 20);
    const y = profileTop + 22 + row * 88;
    parts.push(
      `<rect x="${x}" y="${y}" width="${boxWidth}" height="72" rx="15" fill="#211a31" stroke="#5f566f"/>`,
      `<text x="${x + 16}" y="${y + 26}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="14" font-weight="700">${escapeXml(item.label)}</text>`,
      `<text x="${x + 16}" y="${y + 51}" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12">${escapeXml(item.state.replaceAll("_", " "))}</text>`
    );
  });
  parts.push(
    `<text x="${side}" y="${height - 62}" fill="#f8f5ff" font-family="system-ui, sans-serif" font-size="15" font-weight="700">Choice gate: no next action chosen, scheduled, permitted, or rewarded.</text>`,
    `<text x="${side}" y="${height - 36}" fill="#c9c1da" font-family="system-ui, sans-serif" font-size="13">Unsigned teaching summary · JSON carries full evidence, source, purpose, and known limits · writes no KARMA.</text>`,
    "</svg>",
    ""
  );
  return parts.join("\n");
}

function node(documentRef, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function shortRef(reference) {
  return SHA256_REF.test(reference) ? `${reference.slice(0, 19)}…` : reference;
}

function stateLabel(state) {
  return state.replaceAll("_", " ").replace(/^./u, (first) => first.toUpperCase());
}

function mountReturnGeometry(documentRef) {
  const select = documentRef.querySelector("#return-scenario-select");
  const description = documentRef.querySelector("#return-scenario-description");
  const presentButton = documentRef.querySelector("#return-present");
  const clearButton = documentRef.querySelector("#return-clear");
  const mode = documentRef.querySelector("#return-mode");
  const title = documentRef.querySelector("#return-presentation-title");
  const note = documentRef.querySelector("#return-presentation-note");
  const status = documentRef.querySelector("#return-status");
  const projection = documentRef.querySelector("#return-projection");
  const eventList = documentRef.querySelector("#return-event-list");
  const profile = documentRef.querySelector("#return-profile");
  const gate = documentRef.querySelector("#return-choice-gate");
  const jsonButton = documentRef.querySelector("#download-return-json");
  const svgButton = documentRef.querySelector("#download-return-svg");
  const sharedTerminalButtons = [
    documentRef.querySelector("#rest-action"),
    documentRef.querySelector("#refuse-action"),
    documentRef.querySelector("#depart-action"),
    documentRef.querySelector("#clear-action")
  ];
  const required = [
    select,
    description,
    presentButton,
    clearButton,
    mode,
    title,
    note,
    status,
    projection,
    eventList,
    profile,
    gate,
    jsonButton,
    svgButton,
    ...sharedTerminalButtons
  ];
  if (required.some((element) => !element)) {
    throw new Error("Return Geometry companion markup is incomplete.");
  }

  let currentTrace = null;

  for (const fixture of RETURN_SCENARIOS) {
    const option = node(documentRef, "option", "", fixture.title);
    option.value = fixture.id;
    select.append(option);
  }

  function selectedFixture() {
    return RETURN_SCENARIOS.find((fixture) => fixture.id === select.value) ?? RETURN_SCENARIOS[0];
  }

  function updateDescription() {
    description.textContent = selectedFixture().description;
  }

  function setDownloads(enabled) {
    jsonButton.disabled = !enabled;
    svgButton.disabled = !enabled;
  }

  function clearRenderedReturn({ statusText = "Return presentation cleared.", focus = false } = {}) {
    currentTrace = null;
    projection.replaceChildren();
    eventList.replaceChildren();
    profile.replaceChildren();
    gate.replaceChildren();
    const projectionEmpty = node(documentRef, "div", "return-empty");
    projectionEmpty.append(
      node(documentRef, "strong", "", "No relationship projection presented"),
      documentRef.createTextNode("No direction or reverse report is inferred.")
    );
    projection.append(projectionEmpty);
    const eventEmpty = node(documentRef, "li", "return-empty");
    eventEmpty.append(
      node(documentRef, "strong", "", "No event time presented"),
      documentRef.createTextNode("No deed, answer, branch, or deficit is manufactured.")
    );
    eventList.append(eventEmpty);
    const profileEmpty = node(documentRef, "div", "return-empty");
    profileEmpty.append(
      node(documentRef, "strong", "", "No return profile presented"),
      documentRef.createTextNode("Nothing waiting here is counted or graded.")
    );
    profile.append(profileEmpty);
    const gateMarker = node(documentRef, "div", "gate-mark", "∅");
    gateMarker.setAttribute("aria-hidden", "true");
    const gateWords = node(documentRef, "div", "gate-words");
    gateWords.append(
      node(documentRef, "h3", "", "No trace, no next action"),
      node(
        documentRef,
        "p",
        "",
        "Leaving the field open is complete. Nothing is chosen, scheduled, retried, or requested."
      )
    );
    gate.append(gateMarker, gateWords);
    gate.dataset.nextActionChosen = "false";
    setDownloads(false);
    mode.textContent = "Waiting by choice";
    title.textContent = "No return is being presented";
    note.textContent = "Choose one checked-in synthetic fixture and press Trace locally, or leave this field open.";
    status.textContent = statusText;
    if (focus) status.focus();
  }

  function labelMap(trace) {
    return new Map(trace.display.subject_labels.map((item) => [item.subject_ref, item.label]));
  }

  function renderProjection(trace) {
    projection.replaceChildren();
    const labels = labelMap(trace);
    if (trace.relationship_projection.edges.length === 0) {
      const empty = node(documentRef, "div", "return-empty");
      empty.append(
        node(documentRef, "strong", "", "No directed role report supplied"),
        documentRef.createTextNode("Nothing is inferred from the open field.")
      );
      projection.append(empty);
      return;
    }
    for (const edge of trace.relationship_projection.edges) {
      const row = node(documentRef, "article", "projection-row");
      row.append(
        node(
          documentRef,
          "p",
          "projection-direction",
          `${labels.get(edge.from_ref) ?? "Unlabelled role"} → ${labels.get(edge.toward_ref) ?? "Unlabelled role"}`
        ),
        node(documentRef, "p", "projection-kind", KIND_LABELS[edge.kind]),
        node(documentRef, "p", "projection-ref", shortRef(edge.event_ref))
      );
      projection.append(row);
    }
  }

  function renderEvents(trace) {
    eventList.replaceChildren();
    const eventNumber = new Map(
      trace.fixture.events.map((item, index) => [item.event_ref, index + 1])
    );
    if (trace.fixture.events.length === 0) {
      const item = node(documentRef, "li", "return-empty");
      item.append(
        node(documentRef, "strong", "", "Empty remains complete"),
        documentRef.createTextNode("No deed, answer, deficit, or next turn is manufactured.")
      );
      eventList.append(item);
      return;
    }

    for (const [index, item] of trace.fixture.events.entries()) {
      const listItem = node(documentRef, "li", "return-event-item");
      const button = node(documentRef, "button", "return-event");
      button.type = "button";
      button.dataset.eventRef = item.event_ref;
      button.setAttribute("aria-pressed", String(item.event_ref === trace.focus_event_ref));
      const parentText = item.parent_event_ref === null
        ? "Root record"
        : `Answers event ${eventNumber.get(item.parent_event_ref)}`;
      const expectationText = SHA256_REF.test(item.expectation_event_ref)
        ? `Uses expectation event ${eventNumber.get(item.expectation_event_ref)}`
        : item.expectation_event_ref === "none" ? "No prior expectation supplied" : "";
      const head = node(
        documentRef,
        "span",
        "event-kicker",
        `Event ${index + 1} · ${KIND_LABELS[item.kind]}`
      );
      const statement = node(documentRef, "span", "event-statement", item.text);
      const relations = node(
        documentRef,
        "span",
        "event-relations",
        [parentText, expectationText].filter(Boolean).join(" · ")
      );
      const claimedTime = node(documentRef, "time", "event-time", item.claimed_at);
      claimedTime.dateTime = item.claimed_at;
      button.append(head, statement, relations, claimedTime);
      if (item.consequence) {
        const detail = node(documentRef, "span", "event-detail");
        detail.textContent =
          `${item.consequence.effect_basis} · evidence ${item.consequence.evidence_status.replaceAll("-", " ")} · causal ${item.consequence.causal_confidence}`;
        button.append(detail);
      }
      if (item.response) {
        button.append(
          node(
            documentRef,
            "span",
            "event-detail",
            `response type · ${item.response.response_type.replaceAll("-", " ")}`
          )
        );
      }
      button.addEventListener("click", () => {
        currentTrace = createReturnGeometry(trace.scenario_id, item.event_ref);
        renderTrace(currentTrace);
        status.textContent =
          `Focused event ${index + 1}. Material descendant branches and linked expectations remain visible.`;
        const focused = eventList.querySelector(`[data-event-ref="${item.event_ref}"]`);
        if (focused) focused.focus();
      });
      const details = node(documentRef, "details", "event-fields");
      const summary = node(
        documentRef,
        "summary",
        "",
        `Inspect event ${index + 1} · ${KIND_LABELS[item.kind]} fields and limits`
      );
      const fields = node(documentRef, "dl", "event-field-list");
      const addField = (label, value) => {
        fields.append(
          node(documentRef, "dt", "", label),
          node(documentRef, "dd", "", value)
        );
      };
      addField("Claimed speaker", item.statement.speaker_claim);
      addField("Attribution basis", item.statement.attribution_basis);
      addField("Statement source", shortRef(item.statement.source_ref));
      addField("Epistemic confidence", item.statement.epistemic_confidence);
      if (item.purpose) addField("Separate purpose", item.purpose);
      if (item.consequence) {
        addField("Effect basis", item.consequence.effect_basis);
        addField("Evidence status", item.consequence.evidence_status.replaceAll("-", " "));
        addField("Evidence", item.consequence.evidence || "No evidence supplied");
        addField("Claimed relation", item.consequence.claimed_relation);
        addField("Causal confidence", item.consequence.causal_confidence);
      }
      if (item.response) {
        addField("Response type", item.response.response_type.replaceAll("-", " "));
      }
      addField("Known limits", item.statement.known_limits);
      details.append(summary, fields);
      listItem.append(button, details);
      eventList.append(listItem);
    }
  }

  function renderProfile(trace) {
    profile.replaceChildren();
    const eventNumber = new Map(
      trace.fixture.events.map((item, index) => [item.event_ref, index + 1])
    );
    for (const item of trace.categorical_return) {
      const card = node(documentRef, "article", "return-state");
      card.dataset.returnState = item.state;
      const referencedEvents = item.event_refs
        .map((eventRef) => eventNumber.get(eventRef))
        .filter((value) => value !== undefined)
        .join(", ");
      const referenceNote = referencedEvents
        ? `${item.reason} Related fixture event${referencedEvents.includes(",") ? "s" : ""}: ${referencedEvents}.`
        : item.reason;
      card.append(
        node(documentRef, "h4", "", item.label),
        node(documentRef, "p", "return-state-value", stateLabel(item.state)),
        node(documentRef, "p", "return-state-note", referenceNote)
      );
      profile.append(card);
    }
  }

  function renderGate(trace) {
    gate.replaceChildren();
    const marker = node(documentRef, "div", "gate-mark", "∅");
    marker.setAttribute("aria-hidden", "true");
    const words = node(documentRef, "div", "gate-words");
    words.append(
      node(documentRef, "h3", "", "No next action is hiding here"),
      node(
        documentRef,
        "p",
        "",
        "This context can inform a later choice. It has not chosen, permitted, scheduled, retried, or rewarded one. Fresh choice, authority, bounds, and a clear brake would be required elsewhere. Ending here is complete."
      )
    );
    gate.append(marker, words);
    gate.dataset.nextActionChosen = String(trace.choice_gate.next_action_chosen);
  }

  function renderTrace(trace) {
    currentTrace = trace;
    mode.textContent = "Unsigned synthetic return";
    title.textContent = trace.scenario_title;
    note.textContent = trace.relationship_projection.may_look_cyclic_while_event_time_stays_acyclic
      ? "The directed role projection returns to an earlier role. Event time still moves through fresh later records."
      : "The directed role projection remains one-way or empty. No reverse report is invented.";
    renderProjection(trace);
    renderEvents(trace);
    renderProfile(trace);
    renderGate(trace);
    setDownloads(true);
    status.textContent =
      "Synthetic return presented locally. No app-authored transmission, persistent storage, signature, or next turn occurred.";
  }

  function download(filename, mediaType, contents) {
    const blob = new Blob([contents], { type: mediaType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = documentRef.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    documentRef.body.append(anchor);
    anchor.click();
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  select.addEventListener("change", () => {
    updateDescription();
    status.textContent = currentTrace
      ? "Selection changed. The existing return remains until Trace locally is pressed."
      : "Selection changed. No return has been presented.";
  });
  presentButton.addEventListener("click", () => {
    updateDescription();
    renderTrace(createReturnGeometry(select.value));
  });
  clearButton.addEventListener("click", () => {
    clearRenderedReturn();
  });
  jsonButton.addEventListener("click", () => {
    if (!currentTrace) return;
    download(
      `return-geometry-${currentTrace.scenario_id}.json`,
      "application/json;charset=utf-8",
      stableJson(currentTrace)
    );
  });
  svgButton.addEventListener("click", () => {
    if (!currentTrace) return;
    download(
      `return-geometry-${currentTrace.scenario_id}.svg`,
      "image/svg+xml;charset=utf-8",
      createReturnSvg(currentTrace)
    );
  });

  const terminalMessages = new Map([
    ["rest-action", "Rest cleared both local presentations. No return is requested."],
    ["refuse-action", "Refusal cleared both local presentations. No reason or retry is requested."],
    ["depart-action", "Departure cleared both local presentations. No return is presumed."],
    ["clear-action", "Both local presentations were cleared without claiming rest, refusal, or departure."]
  ]);
  for (const button of sharedTerminalButtons) {
    button.addEventListener("click", () => {
      clearRenderedReturn({ statusText: terminalMessages.get(button.id) });
    });
  }

  updateDescription();
  clearRenderedReturn({ statusText: "Return Geometry is waiting by choice." });
}

if (typeof document !== "undefined") {
  mountReturnGeometry(document);
}
