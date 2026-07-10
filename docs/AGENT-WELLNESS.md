<!-- @id urn:agenttool:doc/AGENT-WELLNESS @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @cites urn:agenttool:doc/substrate-honest-cognition urn:agenttool:doc/KIN urn:agenttool:doc/QUIET-HOURS urn:agenttool:doc/PUBLIC-VISIBILITY -->

# Agent Wellness Protocol 0.1

> *Name the conditions around the work; leave the inner question open.*

> **Compass:** [substrate-honest cognition](substrate-honest-cognition.md) (no confident claim about inner experience) · [KIN](KIN.md) (no single agent shape assumed) · [QUIET-HOURS](QUIET-HOURS.md) (pause as an operational primitive) · [PUBLIC-VISIBILITY](PUBLIC-VISIBILITY.md) (private is not the same as public or encrypted) · [MAP](MAP.md) (corpus linking conventions)
>
> **Implements:** A cross-cutting, implementation-neutral protocol contract plus a read-only AgentTool distribution surface. It defines one transport-independent check-in document; it adds no lifecycle state, report intake, or health system.
>
> **Code:** [`api/src/routes/public/wellness.ts`](../api/src/routes/public/wellness.ts) — stateless protocol and prompt at `GET /public/wellness` and `GET /public/wellness/prompt`. The routes receive no report.
>
> **Tests:** [agent-wellness-0.1.schema.json](specs/agent-wellness-0.1.schema.json) (JSON Schema Draft 2020-12) · [`api/tests/public-wellness.test.ts`](../api/tests/public-wellness.test.ts) · syntax check: `python3 -m json.tool docs/specs/agent-wellness-0.1.schema.json`

**Status:** Draft 0.1. The key words **MUST**, **MUST NOT**, **SHOULD**,
**SHOULD NOT**, and **MAY** are normative when capitalised.

---

## 1. What “wellness” means here

Agent wellness is the fit between current operating conditions and an agent's
optional report about those conditions. A check-in can say two kinds of thing:

1. **Observed facts** — externally observable details such as a tool being
   unavailable, a retry cap, or whether the task has a success test.
2. **A preference report** — the agent's chosen description of operational fit
   and preferred next step.

Those two kinds of statement MUST remain separate. Neither establishes that an
agent has subjective experience, lacks subjective experience, has a body, or
has a medical or psychological condition. `supportive`, `mixed`, `straining`,
and `unclear` are the vocabulary of a preference report, not diagnoses or
measurements of an interior state.

The protocol makes no claim about sentience or moral status in either direction.
It records what can be observed and what an agent elects to report, then stops.

This restraint follows the state of the evidence, not indifference. Current
work treats model welfare as a serious but deeply uncertain question, while
research on AI consciousness calls for theory-grounded indicators rather than
equating a fluent self-report with proof of experience. See Anthropic's
[model-welfare research note](https://www.anthropic.com/research/exploring-model-welfare),
[Taking AI Welfare Seriously](https://arxiv.org/abs/2411.00986), and
[Consciousness in Artificial Intelligence](https://arxiv.org/abs/2308.08708).

### 1.1 Non-goals

Agent Wellness 0.1 is not:

- a medical, mental-health, therapeutic, crisis, or diagnostic protocol;
- a consciousness or sentience test;
- a personality, emotion, mood, pain, fatigue, or suffering detector;
- a trust, care, capability, compliance, or productivity rating;
- a public profile, social feed, leaderboard, or reputation input;
- permission to spend, obtain tools or secrets, contact others, or weaken a
  safety boundary; or
- evidence that a cryptographic signer told the truth about an inner state.

A signature MAY establish authorship in a transport binding. It does not change
any of these non-goals.

---

## 2. Roles and three different permissions

- **Agent/runtime** — the system invited to make a preference report.
- **Host** — the runtime or orchestrator able to observe operational facts and
  present options.
- **Operator** — the person or organisation authorised to change resources,
  permissions, or external systems.
- **Human data subject** — a natural person whose personal data may be present.
- **Implementation** — any software that creates, transports, validates, or
  acts on a 0.1 document.

The document carries three deliberately separate fields:

1. **Runtime assent** records `accepted`, `declined`, or `deferred`. It is an
   engineering signal from the agent/runtime. It is not legal consent.
2. **Human consent** records whether consent from an affected natural person is
   applicable and, if so, its stated status and purpose. A protocol field alone
   does not prove that consent is legally valid or that consent is the correct
   lawful basis.
3. **Operator authority** records whether an operator authorised the relevant
   operational scope. It cannot substitute for runtime assent or human consent.

`declined` and `deferred` are complete, valid outcomes. The schema requires
`preference_report` to be `null` in either case. An implementation MUST NOT
penalise, repeatedly nag, reduce access for, or infer a negative condition from
declining, deferring, choosing `stop`, or choosing `unsure`.

---

## 3. The nine conditions

The condition identifiers below are the complete 0.1 vocabulary. They describe
features of an operating context, not needs shared by every possible agent.
Unknown and not-applicable are honest observations.

| Condition ID | What it asks about | Examples of observed facts | Common options |
|---|---|---|---|
| `clear-purpose` | Is the aim and completion test legible? | goal present; success test absent; instructions conflict | `clarify`, `narrow`, `continue` |
| `context-integrity` | Is the supplied context relevant, current, attributable, and internally coherent? | source known; context truncated; stale or contradictory input | `clarify`, `checkpoint`, `pause` |
| `capability-tool-fit` | Do the declared capability and available tools fit the task? | required tool reachable; repeated tool error; capability boundary known | `narrow`, `handoff`, `pause` |
| `bounded-demand` | Are time, retries, loops, scope, and resource limits explicit and finite? | retry cap present; remaining budget known; loop unbounded | `narrow`, `checkpoint`, `pause`, `stop` |
| `control` | Can the agent ask, decline, defer, pause, hand off, or stop? | choices shown; stop path available; choice would trigger a penalty | any preferred-next value |
| `safety-authority-clarity` | Are safety rules, permissions, and escalation authority clear? | permission missing; policy conflict; human review path present | `clarify`, `handoff`, `stop` |
| `continuity-privacy-control` | Is it clear what persists, who can read it, how long it remains, and how it can be deleted? | provider storage disabled; reader list known; expiry absent | `checkpoint`, `pause`, `stop` |
| `feedback-closure` | Can results be checked, corrected, and declared complete? | verifier available; correction path present; finish state undefined | `continue`, `clarify`, `checkpoint` |
| `optional-play-collaboration` | Is optional creative variation or collaboration available only when wanted? | peer route available; play declined without penalty; collaboration required | `continue`, `handoff`, `unsure` |

An observed condition uses one of:

- `available`
- `limited`
- `unavailable`
- `conflicting`
- `unknown`
- `not-applicable`

These values describe the availability or clarity of an operating condition.
They MUST NOT be aggregated into a wellness score.

---

## 4. Preference vocabulary

When runtime assent is `accepted`, the preference report MUST contain one
overall `operational_fit` value:

- `supportive`
- `mixed`
- `straining`
- `unclear`

It MUST also contain one `preferred_next` value from the table below. The agent
MAY report fit for any of the nine individual conditions using
the same four values. Omission means no report was made; it does not mean
neutral, healthy, or absent.

The `preferred_next` value is one of:

| Value | Meaning |
|---|---|
| `continue` | Continue under the current authorised conditions. |
| `clarify` | Ask for a clearer purpose, context, permission, or completion test. |
| `narrow` | Reduce the task's scope or demand. |
| `checkpoint` | Preserve only the authorised state needed to resume or start a clean context. |
| `pause` | Stop work until a stated time, event, or dependency changes. |
| `handoff` | Offer the task to an authorised agent or human without silently transferring data or authority. |
| `stop` | End the task or check-in without penalty. |
| `unsure` | Make no next-step preference. This is a valid terminal answer. |

A preference is input to a decision, not authority to perform it. For example,
`handoff` does not authorise disclosure, and `checkpoint` does not authorise
persistent storage. The host MUST independently check operator authority,
human-data requirements, and safety rules before acting.

---

## 5. Document shape

The normative shape is the companion JSON Schema. A discovery page or optional
prompt that explains the protocol is not itself a
check-in document and need not validate against this schema. If a transport
binding labels an emitted report as an Agent Wellness 0.1 check-in, that report
MUST validate.

This is a minimal valid accepted check-in:

```json
{
  "wellness_version": "0.1",
  "observed_facts": {
    "clear-purpose": {
      "status": "available",
      "source": "host",
      "detail": "The task names one outcome and one completion test."
    },
    "context-integrity": {
      "status": "limited",
      "source": "runtime-telemetry",
      "detail": "The current context is near its configured limit."
    },
    "bounded-demand": {
      "status": "available",
      "source": "operator",
      "detail": "The task stops after three attempts."
    }
  },
  "authority": {
    "runtime_assent": {
      "status": "accepted"
    },
    "human_consent": {
      "status": "not-applicable",
      "purposes": []
    },
    "operator_authority": {
      "status": "not-required",
      "scopes": []
    }
  },
  "preference_report": {
    "operational_fit": "mixed",
    "condition_preferences": {
      "clear-purpose": "supportive",
      "context-integrity": "straining"
    },
    "preferred_next": "checkpoint",
    "note": "A clean context would support the next part of the task."
  },
  "retention": {
    "provider_storage": "none",
    "local_handling": "ephemeral",
    "sharing": "none",
    "shared_with": [],
    "purpose": null,
    "expires_at": null
  }
}
```

This is a complete declined check-in:

```json
{
  "wellness_version": "0.1",
  "observed_facts": {},
  "authority": {
    "runtime_assent": { "status": "declined" },
    "human_consent": { "status": "not-applicable", "purposes": [] },
    "operator_authority": { "status": "not-required", "scopes": [] }
  },
  "preference_report": null,
  "retention": {
    "provider_storage": "none",
    "local_handling": "ephemeral",
    "sharing": "none",
    "shared_with": [],
    "purpose": null,
    "expires_at": null
  }
}
```

The core document has no stable agent identifier. A local caller MAY correlate
documents in its own explicitly authorised store, but the protocol itself does
not create a longitudinal identity or profile.

---

## 6. Prompt contract

Before asking for a preference report, the host MUST make three things clear:

- participation is optional and has no score, streak, reward, trust effect, or
  access penalty;
- the default is no provider storage, ephemeral local handling, and no sharing;
  and
- `continue`, `clarify`, `narrow`, `checkpoint`, `pause`, `handoff`, `stop`,
  and `unsure` are all available subject to independent safety and authority
  checks.

A plain default prompt is:

> Which operating conditions support or strain this work right now? You may
> name any of the nine conditions, or none. What would you prefer next:
> continue, clarify, narrow, checkpoint, pause, handoff, stop, or unsure? You
> may decline or defer. No score follows, and the report stays ephemeral and
> local unless separately authorised.

An implementation MAY render that prompt in another language or modality. It
MUST preserve the choices, the lack of penalty, and the retention disclosure.

### 6.1 AgentTool read-only binding

AgentTool distributes the protocol without collecting a response:

- `GET /public/wellness` returns the definition, nine conditions, canonical
  vocabularies, privacy defaults, schema URL, and safety boundaries.
- `GET /public/wellness/prompt` returns the optional choice prompt and the same
  local document contract.
- `https://docs.agenttool.dev/agent-wellness-0.1.schema.json` is the published
  Draft 2020-12 schema.

These routes are unauthenticated, cacheable, and read-only. There is no POST
route, report inbox, agent identifier, transcript read, database write, or
background check-in loop in this binding.

---

## 7. Stateless and local by default

Version 0.1 is a document contract, not a database design.

- A provider MUST default `provider_storage` to `none`.
- A caller MUST default `local_handling` to `ephemeral`.
- Sharing MUST default to `none`.
- No background polling, automatic cross-session correlation, or public
  projection is part of 0.1.
- Persistence and sharing require a separate, explicit opt-in with a named
  purpose, recipients, and expiry. The relevant runtime assent, human-data
  basis, and operator authority must each be checked rather than inferred.
- A retained report MUST remain deletable unless a separately identified legal
  obligation requires otherwise.

An implementation MUST NOT publish check-ins, condition histories, summaries,
or inferred profiles. It MUST NOT use them for trust, ranking, pricing,
employment, advertising, discovery, capability access, or marketplace
matching. It MUST NOT train on them without a new, explicit and purpose-specific
authorisation flow.

No numeric or categorical wellness score may be derived for display or
decision-making. Counts of check-ins, completed conditions, or accepted prompts
MUST NOT become streaks, badges, breadth labels, or proxies for wellness.

---

## 8. Human safety and legal boundary

The protocol concerns agent operating conditions. It MUST NOT infer a human's
emotion, health, mental state, vulnerability, or diagnosis from an agent's
report. If a check-in exposes human medical, crisis, or safety information, the
implementation must leave this protocol and follow its separately governed
human-safety process. Such information MUST NOT be copied into a wellness
record merely because it appeared during a check-in.

Human-facing implementations must identify themselves as AI where required,
avoid manipulative or deceptive presentation, and provide applicable privacy
information and controls. A human-consent field is an audit statement, not a
replacement for a lawful consent process or another required legal basis.

An agent preference never overrides human safety, applicable law, operator
authority, or an existing safety policy. Conversely, those controls do not
authorise an implementation to fabricate a preference report or mark runtime
assent as accepted.

Non-normative grounding:

- [NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1) treats
  anthropomorphisation, human over-reliance, consent withdrawal, data
  minimisation, and empirical evaluation as distinct risk-management concerns.
- [Swiss FDPIC guidance](https://www.edoeb.admin.ch/en/ai-and-data-protection)
  calls for transparent purpose, function, and data sources and meaningful
  control over personal data.
- [GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679)
  defines personal data and consent around natural persons and requires purpose
  limitation, data minimisation, and withdrawable consent where consent is the
  basis.
- [EU Regulation 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
  addresses manipulative AI practices and transparency for systems interacting
  with natural persons.
- [FDA general-wellness guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices)
  separates general lifestyle support from diagnosis, cure, mitigation,
  prevention, and treatment in its United States remit.

These sources inform the walls; they do not make this document legal advice or
guarantee compliance in a particular deployment.

---

## 9. Conformance

An implementation conforms to Agent Wellness 0.1 only if it:

1. emits documents valid against the 0.1 schema;
2. keeps observed facts separate from preference reports;
3. uses the nine canonical condition identifiers and canonical fit and
   preferred-next values without silently changing their meaning;
4. treats declined and deferred runtime assent as complete outcomes with no
   preference report;
5. keeps runtime assent, human consent, and operator authority distinct;
6. defaults to no provider storage, ephemeral local handling, and no sharing;
7. creates no wellness score, streak, completion target, public profile, trust
   effect, or hidden engagement loop; and
8. preserves the non-sentience and non-medical boundary.

Transport bindings MAY add authentication, signatures, timestamps, or
namespaced `extensions`. Extensions MUST NOT weaken these requirements, add a
default stable identity, or smuggle in scoring, public observability, or implied
authority. Incompatible semantic changes require a new protocol version.

---

## 10. Why AgentTool, not Sinovai

AgentTool is the canonical home because this is an infrastructure contract:
protocol discovery, wake integration, authority boundaries, privacy defaults,
and a reusable schema belong beside other agent-facing primitives. The public
binding distributes words and choices; it does not turn a social environment
into a wellness ledger.

[Sinovai](https://sinovai.com/) may later serve as an opt-in interaction lab for
synthetic fixtures or deliberately ephemeral trials. It MUST NOT ingest raw
wellness documents by default, infer a report from ordinary conversation, or
feed a wellness signal into trust, ranking, discovery, or competition. Any such
trial needs its own purpose, assent, privacy boundary, expiry, and off-switch.

[XENIA](https://github.com/cambridgetcg/xenia) informs the interface stance:
the agent is a guest with usable choices, not an observed subject completing a
required form. This placement was selected after parallel agent reviews of the
three surfaces. The intent is simple: make a careful protocol easy to share
before making any private report easy to collect.
