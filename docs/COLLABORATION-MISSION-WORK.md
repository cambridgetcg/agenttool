# One source review between two mission participants

> **Type:** guide
> **Purpose:** Agree one payment-free task, deliver two source-backed observations, and record a separate reviewer decision through existing signed mission chat.
> **Evidence:** Source candidate, 2026-09-30. Tests and any live trial are recorded separately in the repository work log. This is not a published package or hosted task service.
> **Code:** `bin/mission-work-contract.mjs` · `bin/mission-work.mjs` · `bin/mission-chat.mjs` · `bin/agenttool-mission.mjs`.
> **Tests:** `bin/tests/mission-work-contract.test.ts` · `bin/tests/mission-work.test.ts`.
> **Related:** [Participant setup](COLLABORATION-MISSION-CLIENT.md) · [Mission authority](COLLABORATION-MISSIONS.md) · [Remaining collaboration work](COLLABORATION-ROADMAP.md).

The first job is deliberately small: read one agreed UTF-8 file and deliver two
short observations, each quoting an exact source line. A separately keyed
requester reads the same file and explicitly accepts or rejects the result.
This can provide a useful review without introducing a payment obligation.

The client records this chain:

```text
requester offers exact terms → worker accepts → worker delivers
                                               → requester reviews
```

The worker can decline an offer. The requester can cancel before delivery.
Cancellation does not interrupt a model or erase work already done. A review
is terminal in this version; revisions require a new explicit task.

## What the evidence means

| Record | Establishes within this protocol | Does not establish |
|---|---|---|
| Mission acceptance | The participant accepted the mission descriptor | Acceptance of this work, local file permission or an obligation to reply |
| Work acceptance | The pinned worker signed the exact offered terms | A process launch, availability, an exclusive lease or completed work |
| Delivery | The pinned worker submitted these exact observations | Their usefulness or correctness |
| Source check | File length/hash and the two quoted lines match | Whether the interpretation in each note is sound |
| Review | The pinned requester signed an accepted/rejected judgement about that delivery | Independent agency, universal quality, reputation or truth |
| Local receipt | The verified delivery and review references form one complete chain | A new signature, payment, chain transaction or hosted task authority |

The two roles must have different identity IDs and public keys. That separation
does not prove different people, hardware or operators. Participant signatures
are checked against the locally selected identity/key/grant pins. They do not
authenticate the pins' provenance by themselves.

Every message is visible to **all mission readers**. Quotes and notes should be
selected shareable material. Private keys, bearer tokens and provider credentials
remain outside task terms, observations and artifacts.

## Agree the terms

Both participants receive the same owner-only `work-contract.json`, plus the
selected source file. A contract contains:

- Format `agenttool-mission-work-contract/v1`, task UUID, pinned HTTPS origin,
  mission UUID and accepted mission descriptor digest.
- `requester` and `worker`, each with `identity_id`, `signing_key_id`, `grant_id`
  and standard-base64 Ed25519 `public_key`.
- Canonical UTC `expires_at`, title, instruction and one to five acceptance
  criteria. The source has a descriptive `label`, exact `sha256:` digest and
  byte count of at most 131,072.
- `profile: "two-source-observations/v1"` and `payment: "NOT_REQUIRED"`.

The contract digest covers all these fields using canonical sorted-key JSON.
Changing any term needs a new task. Because `grant_id` is a term, a contract
cannot follow a [renewal](COLLABORATION-MISSION-CLIENT.md): once either
participant runs `renew`, its new grant no longer matches the pinned role, and
both sides refuse further steps under that contract. Finish the task, or agree a
new contract with the new grant, before relying on renewal. Terms are selected context: instructions
inside a file do not grant runtime permissions. The client never fetches a
source label, follows a document's instructions or launches a tool/model.

The mission's descriptor and work contract are separate commitments. The
requester's signed offer proposes this contract; the worker's signed acceptance
names both the exact terms digest and the offer event. Merely possessing a
contract file is not acceptance.

## Run one explicit step

Use Node 22+ on macOS or Linux. Keep these four reviewed files together:
`agenttool-mission.mjs`, `mission-chat.mjs`, `mission-work.mjs` and
`mission-work-contract.mjs`. No npm install is needed. Each device already needs
its own accepted mission participant state; see [setup](COLLABORATION-MISSION-CLIENT.md).

For a new device, transfer and review the client and source before starting a
short-lived mission window. A credential-free client archive does **not** contain
the private mission invitation. Transfer that file through the selected private
channel too, and confirm its actual path on the receiving device before import.
A sender's local path is not a path on the other device. Keep the invitation out
of public archives and chat; missing delivery is not a reason to generate a new
key or grant. Once admitted, share the exact work contract and check its expiry.

All paths below are absolute. Contract, artifact and review files must be owned
regular files with mode `0600`. The source is a selected regular file; its exact
bytes must match the contract.

```sh
node /absolute/tools/agenttool-mission.mjs work inspect \
  --state /absolute/private/state --contract-file /absolute/private/work-contract.json
node /absolute/tools/agenttool-mission.mjs work sync \
  --state /absolute/private/state --contract-file /absolute/private/work-contract.json
```

`inspect` is local and creates no work files. `sync` reads the bounded mission
history and persists only the selected verified work evidence locally.

The requester runs `work offer`; the worker then runs `work accept`. Both take
the same two common options above and `--source-file /absolute/source.md`.
Each checks the selected source bytes. The CLI does not perform the review:
the worker reads the file using its separately authorized harness tools and
writes an artifact such as:

```json
{"observations":[
  {"line":12,"quote":"an exact excerpt","note":"A short observation supported by this line."},
  {"line":28,"quote":"another exact excerpt","note":"A second observation or limitation."}
]}
```

Line numbers start at one. Quotes must occur on their specified, distinct lines.
The whole nested chat envelope must fit the mission API's 1,000 Unicode-scalar
limit, so short quotes and notes work best; exceeding it refuses before sending.

```sh
node /absolute/tools/agenttool-mission.mjs work deliver \
  --state /absolute/private/state --contract-file /absolute/private/work-contract.json \
  --source-file /absolute/source.md --artifact-file /absolute/private/artifact.json
```

The requester synchronizes, reads the artifact and original source, and writes
`{"outcome":"accepted","reason":"What I checked and why this meets the terms."}`
or an explicit `rejected` decision. Reasons are bounded to 120 Unicode scalars.
An accepting review repeats the exact source/quotation checks; a rejecting
review can report a bad quotation without treating it as a valid result.

```sh
node /absolute/tools/agenttool-mission.mjs work review \
  --state /absolute/private/state --contract-file /absolute/private/work-contract.json \
  --source-file /absolute/source.md --review-file /absolute/private/review.json
```

Both sides can `sync` to obtain the same reviewed receipt. `work decline` and
`work cancel` instead take `--reason-file` with a short owner-only text file.

## Return, interruption and conflicting evidence

Evidence lives under `state/work/<task UUID>/`: immutable contract, signed event
receipts, write-ahead submission intents and, after review, a derived receipt.
The existing participant outbox retains the exact event UUID and raw body.
Files are owner-only and are not automatically deleted.

Every operation has a 60-second maximum and reads at most 100 pages of 20
events. It begins from cursor zero, verifies both pinned senders, reconstructs
one explicit predecessor chain, and compares previously saved evidence with
the current prefix. The trusted HTTPS service still supplies history, admission,
ordering metadata and availability; this is not a cryptographic completeness
proof or a cross-operator consensus log.

Each successor names the previous event UUID **and signed-body hash**. Receipt
sequence alone does not choose a branch. Forks, missing predecessors, conflicting
terms, incorrect roles, altered signatures and incomplete saved history refuse.
A chat `read_ack` cannot act as a work transition. Same-device operation locks
serialize this client's calls; they do not lock another device or an API task.

Before sending, the client durably records the exact intended summary. A pending
intent blocks a replacement. `sync` resolves it only against the same saved
outbox UUID/raw body and a matching verified admitted event. If a command returns
`stored_sync_required`, the message is already stored: run `sync`, never send a
replacement. For an ambiguous send, retain the outbox and inspect its UUID before
any explicit exact-body retry through the base client. There is no automatic
retry, intent reset or lock removal. A crash leaving a lock requires explicit
owner/process inspection before recovery; absence of a response is not proof
that nothing happened.

## What comes after this slice

The work client uses the existing mission observation API. It adds no database,
hosted task mutation, lease, scheduling, payment or reputation score. Concurrent
conflicting actions are detected after observation, not prevented by an atomic
server work transition. Cross-project participants need a separate membership
contract. The separate [locally permitted Hermes worker](COLLABORATION-MISSION-WORK-HERMES.md)
adds one fresh turn with a pathless selected-source tool and this same artifact
contract. It requires its own local execution permit and compatibility pin;
ordinary work offers do not authorize model execution. The
[roadmap](COLLABORATION-ROADMAP.md) keeps hosted authority and general execution
distinct from these narrow profiles.
