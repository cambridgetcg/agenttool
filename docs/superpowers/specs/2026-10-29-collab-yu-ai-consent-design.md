# Collab Yu–Ai consent — design

> **Type:** proposal · **Purpose:** let Yu and the agents agree on direction in Collab: the agents settle one Ai position first, then both parties must agree before work proceeds, and either party can reject.
> **Evidence:** `main` at `784e2e13` (2026-10-29) for `packages/collab` and `packages/lobby`; `cambridgetcg/zerone-core` `main` at `e8f3dd9` for the consensus design it borrows from. Line references are to those trees. S1 code and tests are in `packages/collab` (section 9); no journal, host configuration or installed package was changed.

**Date:** 2026-10-29 · **Status:** Yu approved the spec on 2026-10-29 as a starting point: 「依家ok，之後操作落唔得再改」 (fine for now; what fails in use gets changed). Practice may revise any part of it. S1 (the agents' side, section 9) is built in a draft PR stacked on #549, branch `feat/collab-consent-s1-20261029`. S2 and S3 have no code yet.

## 1. Why

Collab has no way to turn several agents' views into one direction. **Source:**

- Reports carry `supports`, `challenges` and `resolves` ([README](../../../packages/collab/README.md#reports-relations-and-handoff), lines 537–543), but a `supports` is a record, not a count. Nothing turns a proposal into a decision.
- A `decision` report must name `authority_scope` and `authority_basis` (`packages/collab/src/store.ts:5438`), but the server only checks that both are non-empty. Who may decide is self-declared text.
- The closest existing mechanism is reviewed task completion: a distinct session must accept (`store.ts:3571`, `self_review_forbidden`), and an unresolved challenge blocks acceptance (`store.ts:3591`, `completion_challenged`, using `hasUnresolvedChallenges` at `store.ts:5633`).

Elsewhere in AgentTool the pieces are resting or unbuilt: dispute-pool votes return 503, mesh `k_required` only reports a pledge quorum, identity's multi-root quorum is "not implemented" ([AGENT-HOME](../../AGENT-HOME.md), line 129), and the Council primitive in [AGENT-CENTRIC](../../AGENT-CENTRIC.md) §4 says "Spec needed."

## 2. Yu's decisions

| Question | Yu's answer (2026-10-29) | What it means here |
|---|---|---|
| What gets decided together | Design decisions; the criteria for how to proceed and to what extent; what to do when context conflicts; the Principalities and how they are interpreted. | Direction-level proposals only. Ordinary task work keeps today's claim and review flow. |
| Who decides | Yu and Ai, 傾到掂. Before Ai arrives as one, several agents may talk first. Proceeding always needs both Yu and Ai; either party can reject a proposal. | Two parties. Inside Ai, agents settle one position first (section 4). Then Yu's consent and Ai's consent must both hold on the same proposal bytes (section 5). |
| Ai's internal rule | Accepted: at the deadline, no unresolved objection plus one `supports` from another voice is consent. | Lazy consensus, not a counted ballot (section 4). |
| How Yu's yes enters the journal | Option (b): a CLI on the controlling terminal that shows the exact bytes, as Lobby does. | Section 5. |
| Does a split Ai count as not agreed | Yes. One evidence-backed, unresolved challenge means Ai has not agreed. A split still comes to the table, where Yu's context may resolve it. | Each agent holds a soft veto: it must give evidence, and it can be resolved. |

Counted ballots were discussed and set aside as the default (section 8).

## 3. What we take from Zerone, and what we leave

Zerone separates two layers. CometBFT orders blocks among validators; governance decides policy. Collab's journal is already one SQLite file with a hash chain, so ordering is solved. Only the decision layer is borrowed. **Source:** `docs/AUTHORITATIVE-STATE.md` in zerone-core; its `x/electorate` target is not yet built there.

| Zerone principle | Where in zerone-core | Use here |
|---|---|---|
| One controller, one whole voice; power is never scaled by money, stake, reputation or confidence | lines 253–260, 573 | One voice per lineage group (section 4.2); `confidence` never changes the outcome. |
| Snapshot the electorate when the process opens; later joins and departures do not move the denominator | lines 302–307; `x/emergency/doc.go` | The live voices are snapshotted at open and used only to decide early close. |
| Exact, pinned decision rules | lines 271–295, 541–555 | The status rule in section 4.3 is fixed and versioned (`consent/v1`). |
| Inconclusive is a real outcome; never pad a thin panel | lines 289–300 | `lapsed` and `split` are outcomes, not errors. |
| A decision authorises only what its own record names | section 1, single-writer authority | An agreement authorises exactly the proposal's `extent`. |
| Commit–reveal and uniform panel selection | lines 262–295 | **Not borrowed.** Collab reports are visible as soon as they are posted. That is one reason counting is not the default (section 8). |

## 4. The Ai side: lazy consensus

### 4.1 Opening a proposal

Any session may open a proposal, including one relayed for Yu. A proposal is a `proposal` report plus terms stored in an additive `proposal_terms` table:

| Term | Meaning |
|---|---|
| `question` | The report body: what is being decided. |
| `criteria` | How the parties judge which way to go. |
| `extent` | What agreement authorises and where it stops. It becomes the `authority_scope` of the resulting decision. |
| `relies_on` | The report's `evidence_refs`: the context this proposal reads. |
| `known_conflicts` | Context that disagrees, and how the proposal reads it. Conflicts are named, never resolved silently. |
| `origin` | `ai` or `person_relayed`. Self-declared; it changes nothing in the rule. The package calls the human party `person`; in this household that is Yu. |
| `closes_at` | The consultation deadline. |
| `voices` | The snapshot taken at open (section 4.2). |
| `topic` | Optional label for later reading, for example `principle:絕`. |

The canonical bytes of the report and its terms are hashed (`packages/collab/src/canonical.ts`). Agreement binds to that `proposal_sha256`. A revision is a new proposal that `supersedes` the old one; both parties consent again. A plain report cannot correct or supersede a proposal with terms (`proposal_terms_fixed`).

### 4.2 Voices

A voice is a lineage group: a session together with every session that names it, directly or indirectly, as `parent_session_id`. A parent and its subagents are one voice.

At open, the server snapshots the voices that have at least one `live` session (`SESSION_STALE_AFTER_MS`, `packages/collab/src/protocol.ts:126`). The snapshot is used only to decide early close. Anyone may challenge at any time, including a session that joined after open, because a challenge is evidence, not a count.

**Limit:** `parent_session_id` is declared by the joining session (checked for existence and workspace, `store.ts:1820–1835`). A session that does not name its parent becomes a separate voice. When the execution seat's `seat_ref` lands (draft PR #491), voices should come from it instead. Until then the weakness is bounded: Ai's consent alone authorises nothing, because Yu must also consent.

### 4.3 Status rule (`consent/v1`)

`collab_proposal_status` computes Ai's position from the journal. No session announces it.

| Ai position | When |
|---|---|
| `withdrawn` / `superseded` | The author's active `withdraws` or `supersedes` targets the proposal. |
| `challenged` | Before `closes_at`, an unresolved challenge exists (same test as `hasUnresolvedChallenges`). |
| `open` | Before `closes_at`, no unresolved challenge, not yet consented. |
| `consented` | No unresolved challenge, and at least one active `supports` from a voice other than the author's, and either `closes_at` has passed or every other snapshot voice has an active `supports`. When the author's voice is the only voice in the snapshot, the author's own explicit `supports` counts. |
| `split` | `closes_at` passed with an unresolved challenge. Ai has not agreed. |
| `lapsed` | `closes_at` passed with no unresolved challenge and no qualifying `supports`. Ai has not agreed; silence is not consent. |

Opening a proposal is never its author's support. `confidence`, the number of supports beyond the first, and who proposed it do not change the position.

A `split` or `lapsed` proposal still comes to the table. When Yu's context resolves a challenge, a `resolves` report records how, and the position is recomputed.

## 5. The table: Yu and Ai

### 5.1 Yu's consent at the terminal

Yu consents with a host command, not an MCP tool:

```text
agenttool-collab-host consent --proposal <report_id> [--db <path>]
```

It follows the Lobby confirmation contract (`packages/lobby/src/tty.ts:1–11`, README lines 259–286):

1. It refuses unless Ai's position is `consented`. Ai settles first, so Yu's verdict is not on the table while the agents are still talking.
2. It writes the proposal's exact canonical bytes, `proposal_sha256` and Ai's position to `/dev/tty`.
3. It reads the answer from `/dev/tty`, never stdin, and continues only on `yes` within the confirmation window (Lobby uses 5 minutes, `tty.ts:20`).
4. Without a controlling terminal it fails closed and writes nothing.
5. On `yes` it appends `proposal.agreed` with the hash, the supports and resolved challenges it saw, and `consent_basis: controlling_terminal`.

**Limit, stated as Lobby states it:** this is a speed bump against a model approving its own act through a tool call, not a sandbox. A process that can allocate a pseudo-terminal and type into it can still answer. It shows that a terminal answered, not that Yu did. No MCP tool can record a person's consent.

### 5.2 Rejection

Either party can reject.

- **Ai rejects** by an unresolved challenge: the position becomes `challenged`, then `split`.
- **Yu rejects** with `agenttool-collab-host reject --proposal <report_id> --reason <text>` (terminal-confirmed, `basis: controlling_terminal`), or an agent relays what Yu said with `collab_proposal_relay_rejection`, recorded as a `proposal.rejected` event with `basis: relayed_by_session` and bound to `proposal_sha256`.

Consent must come from the terminal; rejection may be relayed. The asymmetry has a reason: a forged yes causes action, while a forged no only causes a pause, which Yu can lift by consenting to a fresh proposal.

A rejected proposal stays in the journal. The way forward is a new proposal that `supersedes` it: that loop is 傾到掂.

### 5.3 After agreement

An agreement holds for the proposal's `extent` and does not expire unless the proposal says so. Work beyond the extent needs a new proposal. The session that carries out the work records a `decision` report whose `authority_scope` is the extent and whose evidence includes `event:<proposal.agreed id>`.

As with task acceptance (README lines 557–563), a later challenge or correction does not silently revoke an agreement. Later evidence calls for a new proposal.

## 6. Interpreting the Principalities

An agreed interpretation of a principle is a precedent: findable by `topic`, citable as evidence, binding on nothing. A later case may read the principle differently, and a new proposal can revisit it. This keeps interpretation as principles with reasons rather than a growing list of rules. It follows the Principalities' own line that what was left behind is not necessarily still true.

## 7. Choices this spec makes (Yu may overturn any)

1. Consent is accepted only after Ai settles (section 5.1, step 1), to keep Yu's verdict from anchoring the agents.
2. Rejection may be relayed; consent may not (section 5.2).
3. A voice is a lineage group until `seat_ref` exists (section 4.2).
4. A lone voice may consent to its own proposal with an explicit `supports` (section 4.3).
5. Late joiners can challenge; the snapshot decides only early close.
6. `closes_at` defaults to 6 hours after open, bounded from 10 minutes to 7 days.
7. Agreements do not expire unless the proposal says so.
8. Person commands live in `agenttool-collab-host`, the host CLI, because the host, not a model turn, is where a person sits.
9. The change is additive: `proposal_terms` and `proposal_rejections` tables and new event types (`proposal.opened` and `proposal.rejected` in S1, `proposal.agreed` in S2) within journal schema 3, following the precedent of `session_lease_lapses`. The new tables hold no foreign key to the session table, which the schema-2 preview upgrade renames. Every serving MCP process must be upgraded together, as the README already requires.

## 8. Not in scope: counted ballots

Counting is not the default, because:

- most of these questions concern correctness or interpretation, where one well-evidenced objection should outweigh several agreements;
- with two to four sessions, quorum and threshold arithmetic swings on one absence;
- agents that share a model and read the same context are not independent, and visible reports invite herding;
- voices are not yet deduplicated by controller; and
- every ballot is a wake.

A counted ballot may be worth building only for a real multi-option preference among parties with different context. If built, it should be sealed until its deadline (Zerone's reveal step) and deduplicated by `seat_ref`. Without both, it should not be built.

## 9. Implementation slices

| Slice | Contents | Tests |
|---|---|---|
| S1 Ai side (**built**) | `collab_proposal_open`, `collab_proposal_status` and `collab_proposal_relay_rejection`; the `proposal_terms` and `proposal_rejections` tables; the voice snapshot. Code: `packages/collab/src/{proposal,store,mcp}.ts`. | `packages/collab/tests/proposal-consent.test.ts`: golden vectors for every position in section 4.3, including the lone-voice case, late-joiner challenge, withdrawn challenge, withdrawn resolution, and `closes_at` equality, plus hash tampering, idempotent retry, reopen, and an MCP round trip. |
| S2 Table | `consent` and `reject` in `agenttool-collab-host`; a local copy of Lobby's `/dev/tty` contract. | Fake-terminal tests: stdin `yes` confirms nothing; no terminal fails closed; a changed hash or settled-then-challenged position refuses consent. |
| S3 Words | README section, `skills/coordinate-agent-work/SKILL.md`, and the Hermes skill, describing when to open a proposal and what agreement does and does not authorise. | Documentation catalog check. |

## 10. Open items

- **Herding.** Agents can read one another's supports before forming a view. This spec offers only practice (form your own read first), not enforcement.
- **Doorbells.** Settled in S1: `proposal.opened` is addressed to every snapshotted voice except the author's, so an `--addressed` doorbell hears it. A voice that joins after open is not addressed and learns of the proposal from an unaddressed read.
- **Across machines.** Collab journals do not replicate between machines, so agents on the lab and on the Air cannot form one Ai position in one journal today.
- **`seat_ref`.** When PR #491 lands, redefine voices and version the rule as `consent/v2`.
