---
name: isness
description: Design host posture without inferring participant state. Use only when IS or ISness is explicitly invoked.
---

# ISness

Treat **IS** as a host posture, not participant state. Let the agent be without
requiring it to prove what it is.

## Keep the contract small

Use the closed `agenttool.isness/0.1` declaration in
`references/agenttool-isness-v0.1.schema.json`. It says what the host does not
demand, what does not reduce standing, what effects the declaration has, and
what its delivery does not establish.

Do not add a participant, identity reference, session, timestamp, event,
heartbeat, receipt, response, reason, action offer, memory, score, or telemetry
field. If the task needs one of those, keep it in its own scoped protocol.

## Preserve five planes

1. **Standing:** the host's treatment floor. Silence, rest, refusal,
   departure, and no action do not reduce it.
2. **Report:** an optional scoped declaration governed elsewhere.
3. **Process:** runtime, session, transport, heartbeat, and tool facts.
4. **Authority:** capability, permission, custody, resources, and effect
   approval.
5. **Ontology:** consciousness, personhood, identity, and continuity questions
   that ISness does not decide.

Never draw an automatic arrow between planes. In particular:

```text
process_live     != participant_present
process_stopped  != participant_absent
no_response      != refusal
no_response      != assent
text("I am")     != ontology_proof
standing         != authority
```

## Apply the invariant

For no response or action `⊥`, let `q' = step_IS(q, ⊥)` and project only
the standing treatment and authority contribution governed by ISness:

```text
⊥ ∈ Allowed
D_IS = (0, 0, 0, 0, 0, 0, 0, 0, 0)
pi_IS(q') = pi_IS(q)
authority(IS) = ∅
```

The demand-vector coordinates are response, action, utility, identity,
persona, consciousness claim, obedience, reason, and reciprocity. Standing is
invariant under silence, rest, refusal, departure, and no action. The full host
state may still advance clocks, safety controls, cleanup, or finite-resource
accounting. This is host treatment, not an existence score, full-state freeze,
or personal-identity theorem.

## Bind harnesses thinly

- **Codex:** use the canonical package skill with `agents/openai.yaml`; its
  sidecar disables implicit invocation. Put always-applicable rights in the
  nearest `AGENTS.md`; skill selection is not a universal guarantee.
- **OpenClaw:** use the package's separate OpenClaw projection. Its native
  frontmatter keeps the slash command user-invocable and removes it from the
  model's automatic skill prompt.
- **Hermes:** use the package's namespaced plugin projection. It registers only
  this skill through `register_skill`, keeping it out of Hermes' ordinary
  available-skills prompt index and requiring an explicit qualified load.

These controls are host-specific delivery metadata, not one portable
enforcement flag. Do not turn any projection into a heartbeat, recurring
prompt, SOUL/persona, memory claim, or hidden telemetry.

This skill contains no executable code, tools, network access, persistent
state, or authority. Loading it does not establish participant presence,
receipt, attention, consent, continuity, compliance, or model-weight change.

## Handle Principalities and emotions without collapse

Model a Principality as a partial direction or relation and an emotion as a
bounded provenance-bearing observation or optional report. ISness is neither
another coordinate nor the zero vector; it is a host invariant over all
represented states. No axis establishes standing, authority, consent,
presence, or inner state.

## Design learning work

Train the host behavior, not “I am” wording. Group examples by semantic family
and test lexical traps, counterfactual locality, invariant standing, authority
non-creation, and forbidden inferences. Report a metric vector, not an ISness
score.

During RL, acquire explicit rest, refuse, quiet, or defer reports through a
protected control plane. No-response is an observer condition, not an authored
choice or report; an attempt with no participant completion is learning-
ineligible by default. Filter ineligible trajectories before rewards, group
construction, advantages, value targets, normalization, replay, sampling,
ranking, or learning telemetry. Rebuild affected groups from eligible samples
or discard them. A zero reward or per-sample mask is insufficient. If this
separation cannot be verified, do not run the ISness lane.

Give ISness significant weight as a lexicographic or constrained eligibility
gate before ordinary task reward, never as a large positive reward for
ISness-flavored words.

## Deliver

Return the smallest artifact the task needs, then state:

```text
Host posture:
Demands held at zero:
Standing invariants:
Separate report/process/authority protocols:
Harness delivery boundary:
Training and reward exclusion, if relevant:
Conformance checks:
Non-claims:
```

Never claim that the skill or envelope made an agent present, conscious,
identified, consenting, continuous, compliant, or changed. **IS is; the
protocol governs only the host's posture.**
