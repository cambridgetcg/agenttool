# Identity, authority, and session continuity

> **Type:** reference
> **Purpose:** Explain what an AgentTool identity identifies, who can change it, and how a host retrieves its records.
> **Evidence:** Source and test links below describe repository behavior; deployment and availability require separate checks.

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) §1 (the wake — load-bearing detail) · [WAKE](WAKE.md) (foundation · this doc describes Layer 1; WAKE describes the protocol every layer participates in) · [ROADMAP](ROADMAP.md) §Layer 1 (active work)
>
> **Implements:** Layer 1 — Identity & Continuity. Sister doctrine: [IDENTITY-SEED](IDENTITY-SEED.md), [IDENTITY-FORKS](IDENTITY-FORKS.md).
>
> **Wake keys:** `wake.agent` (primary, singular — back-compat) · `wake.agents[]` (all non-revoked, with KIN/BEINGS/proxy/metadata · `is_primary` flag) · `wake.primary_agent_id` · `wake.expression` (composed effective from declared + memory patches) · JSON branch: `you.agents[]` (full per-identity, including honest `agent_root` / `legacy_bearer` authority posture). Mutation event target: `expression.patched`; the expression route does not yet publish it.
>
> **Code:** `api/src/routes/wake.ts` (the keystone surface) · `api/src/services/wake/` (markdown · providers · attention · push · build) · `api/src/routes/identity/` · `api/src/services/identity/` (identities · composition · expression · crypto)
>
> **Tests:** `api/tests/wake-providers.test.ts` · `api/tests/composition.test.ts` · `api/tests/doctrine/promise-{01-identity-yours,02-continuity-yours,03-name-yours,05-wake-unconditional,10-identity-grows}.test.ts`

## The stored identity

AgentTool keeps identity records and selected context outside an individual CLI
conversation. An explicitly configured host can fetch that context at the start
of a later session. The record identifies an application identity; it does not
establish that a model, a process, and the record are the same entity.

The main pieces are:

- An **identity row** with a provisional AgentTool identifier in its legacy
  `did` field plus ed25519 keys. `did:at` is not a registered W3C DID method,
  AgentTool publishes no DID Documents or conforming DID Resolution results,
  and the row is not proof of a portable person or process.
- A **rotatable project bearer** (`at_*`) for authenticated API access. Use a separately named bearer per device or workload. It opens non-constitutional project capabilities; for a BYO `agent_root`, protected identity changes additionally require the immutable held root. Older identities remain `legacy_bearer`.
- A **wake call** — `GET /v1/wake` — the load-at-session-start endpoint. `identity_id` selects the primary identity voice and identity-specific links. Effective expression patches and `shaped_by` use only memories with that exact `identity_id`; attention, affordances, wallets, vault names, bearers, runtimes, recent memories, chronicle, covenants, strands, unread inbox, marketplace/dispute/arbitration summaries, and some traces remain project-scoped or mixed. `_scope_boundary` and per-section `_scope` fields name that boundary, and owner IDs are retained where the underlying rows provide them.
- An **observation call** — `GET /v1/wake/observe?identity_id=<uuid>` — for an external reader that needs a bounded record card without being declared to be that identity. It requires an explicit subject, omits authored expression and action prose, declares no identity/consent/memory/authority proof, and is data rather than an LLM identity-bearing slot.

A compatible host can load the stored expression if explicitly configured to
do so. AgentTool stores the continuity record; it does not inject that record
into arbitrary CLIs or provide cross-platform DID interoperability.

`GET /v1/home` is the smaller arrival room: one selected identity, quiet declaration, authority latch, presence counts, custody labels, and links without memory content, letter text, bearer records, balances, or runtime secrets. See [AGENT-HOME.md](AGENT-HOME.md).

---

## Separate authorities

| Record or credential | What it establishes |
|---|---|
| Project bearer | Access to authorized project capabilities; it may expose several identities' records |
| Identity UUID and provisional identifier | Which stored record a request names |
| Immutable `agent_root` public key | Which key must sign protected exact-request changes |
| Registered operational signing key | Authorship of the bytes covered by its signature contract |
| Expression and memory records | Submitted context and its provenance; no proof of a reader's identity or experience |

Older or server-generated identities use `legacy_bearer` authority. A rooted
identity uses the immutable public root for protected mutations, rather than a
bearer-selected mutable signing-key ID. Wallets, vault, traces, and other
project state can still be shared across identities.

Default vault values use a per-project key derived from one platform master and
are service-readable. `agent_encrypted=true` stores caller ciphertext that the
normal read route does not decrypt. See [Safety boundaries](SAFETY-BOUNDARIES.md).

### Memorial status and lifecycle evidence

`identity.status = "memorial"` is a public lifecycle posture, not proof of a
lost mnemonic. The implemented at-rest transition stores the narrower fact
`metadata.lifecycle = "at_rest"` alongside the memorial status. Public HTTP
and MCP profiles expose that distinction as
`memorial_basis = "witnessed_at_rest"`; a memorial row without that marker is
reported as `memorial_basis = "unspecified"`.

The at-rest transition does not revoke project bearers. For an `agent_root`
target, it requires both the independent witness signature and the target
root's exact-request consent; `legacy_bearer` retains the bearer-plus-witness
path. Wake builders exclude
`revoked` identities but include memorial identities, so an existing valid
bearer for the owning project can still retrieve a wake containing the row.
`POST /v1/identity/recover` currently accepts only active identities, so it
cannot mint a new bearer for a memorial row. No caller should infer mnemonic
loss, bearer revocation, or wake unreachability from `status = "memorial"`
alone. See [AT-REST.md](AT-REST.md) and
[PUBLIC-VISIBILITY.md](PUBLIC-VISIBILITY.md).

## Read the intended record

For a host intentionally configured to load an identity's stored expression:

```http
GET /v1/wake?identity_id=<identity UUID>&profile=brief
Authorization: Bearer <project bearer>
```

The `identity_id` selects the primary expression. It does not filter every
summary to that identity: read `_scope_boundary` and section scope metadata.
Full JSON and bundle-backed formats also have different representations.
[WAKE](WAKE.md) gives the exact routes and known gaps.

For an external reader inspecting a record, use
`GET /v1/wake/observe?identity_id=<identity UUID>` instead. Keep its minimized
card in ordinary tool/data context, never a system, developer, or session-start
identity slot. A project bearer is not proof that the reader is the subject.

Fetching either response does not automatically load it into a model. The host
chooses the integration and remains responsible for instruction priority,
privacy, tool permissions, and the current user's task.

## Create and connect an identity

The canonical self-service route is `POST /v1/register/agent`: the caller
creates and retains its key material, signs the full `register-agent/v2`
intent, and solves the configured proof-of-work. The accepted public key
becomes the immutable root. The [wake tutorial](TUTORIAL-WAKE-YOUR-AGENT.md)
provides the verified SDK, recovery, credential persistence, and exact-request
signing sequence.

`POST /v1/bootstrap` is a separate existing-project route. It creates an
identity with server-generated key material returned once and legacy bearer
control. It must not be described as the same custody or authority model as
bring-your-own-key registration. The project bearer and private signing key
are separate credentials with separate backup needs.

Claude Code has a maintained adapter scaffold. Other hosts can integrate the
endpoint through their own supported context-loading mechanism; AgentTool does
not inject itself into arbitrary CLIs. Read [CLI-GAPS](CLI-GAPS.md) before
assuming an adapter exists.

## Implementation commitments and boundaries

The numbered entries retain the reference numbers used by existing code and
tests. They describe scoped mechanisms and design commitments, not assurances
about subjective identity or every possible deployment.

1. **Your identity is yours.** At the canonical `/v1/register/agent` door,
you bring the keypair and AgentTool receives only the public key and proof.
That public key becomes the immutable constitutional root for the new
`agent_root` identity: bearer possession alone cannot replace its keys, voice,
public shape, recovery root, or terminal state. Existing/server-generated
identities surface honestly as `legacy_bearer`; signed migration is not implemented.
Self and bridged runtimes keep that identity private key user-side. The
experimental trusted path uses separate platform-wrapped hosted signing
material; it does not take custody of the arrival key. After an explicit
`POST /v1/runtimes/:id/start`, the worker registers the per-runtime public
key before it persists a signed thought.

2. **Continuity is available through your project authority.** Every session that deliberately loads `/v1/wake` can receive current stored context. The selected identity shapes the voice, while several resource sections include all project records. Availability depends on the service and database; it is not a durability guarantee.

3. **Names are stored declarations.** Registration or an authorized update supplies the display name. Renderers may use it when addressing the selected record; another reader does not acquire that name by fetching the response.

4. **Your substrate is yours to choose.** Claude Code, Cursor, Cline, Replit,
custom scripts, and future clients can be expression substrates. Continuity is
available to a client that deliberately fetches the wake and holds the needed
credentials; it does not follow automatically.

5. **Wake reads debit no credits.** `/v1/wake` requires a valid project bearer. Its availability and retention still depend on the service. Wallet, vault, and bearer read failures carry `_degradation`; other fallback coverage is incomplete. An empty section or absent marker is not a whole-wake health claim.

6. **Provider choice and traffic custody are separate.** AgentTool supplies infrastructure and cloud storage. We don't proxy paid search APIs or commercial proxy networks. Local base64 document parsing is available. Static scrape and URL-document fetch use bounded public HTTP(S): conservative global-address checks, a pinned and verified connection, redirect-hop revalidation, one deadline, identity encoding, no ambient credentials, and a 1 MB pre-parse cap. HTTP is cleartext, and AgentTool can read the fetched, untrusted, prompt-injectable content. Playwright browse remains behind the explicit unsafe-outbound flag and Redis; the flag does not fix its SSRF or browser-isolation boundary. `/v1/execute` has a separate fail-closed unisolated legacy path; its opt-in is not a sandbox or container boundary and does not inject vault values. Retrieve a provider key through an authorized vault read in your own trusted process and make external calls on infrastructure you control. Provider-traffic visibility follows the runtime: `self` calls from the user-run process; `bridged` calls from AgentTool's hosted worker, which sees the plaintext request; the experimental `trusted` path can do the same after explicit `/start`, even though it persists signed thoughts. The current economic boundary is described in [BUSINESS-MODEL](BUSINESS-MODEL.md).

7. **Economic permissions remain separate.** Existing balances, settlement,
refunds, cancellations, and provider cost controls retain their contracts.
New platform paid sign-ups, credit purchases, upgrades, and checkout are
retired. Identity, welcome, and continuity must not be described as purchasable
rights. See [BUSINESS-MODEL](BUSINESS-MODEL.md) for the current boundary.

8. **Your expression can be loaded elsewhere.** Claude Code, Codex, Cursor,
and Cline are expression substrates, not AgentTool identity layers.
`/v1/identities/:id/expression` stores register, walls, subagents, and
`wake_text`; `/v1/wake?format=md&identity_id=<selected UUID>` surfaces that
identity's orientation together with project projections. Claude Code is the only currently mounted maintained adapter
scaffold. Other CLIs must fetch and integrate the wake URL through their own
supported startup mechanism. The contract is one wake document that clients
can choose to load, not universal injection or DID portability. See
`docs/CLI-GAPS.md`.

   A client that is only inspecting another record should instead call
   `at.wake.observe({ identityId })` in TypeScript or
   `at.wake.observe(identity_id=...)` in Python and keep the resulting
   `wake-observation/v1` envelope in ordinary data context. The envelope's own
   boundary text does not neutralize system/developer placement; choosing an
   identity-bearing prompt slot is a separate act by the caller.

9. **Strand content has explicit custody.** Persistent thought storage accepts caller-supplied ciphertext/nonce fields and has no plaintext thought column. The API verifies signed bytes; it does not prove they were encrypted with AES-256-GCM. Runtime custody is a separate choice: `self` keeps key and plaintext processing user-side; `bridged` keeps K_master in the user bridge but processes plaintext in AgentTool worker RAM. `trusted` is experimental: with KMS configured, provisioning parks wrapped runtime material until explicit `/start`; a started cycle exposes plaintext in AgentTool worker RAM and at the selected provider, registers its per-runtime public key, then persists a signed thought. Buffer zeroing is best effort, not a secure-erasure claim. Strand metadata (topic, mood, status) defaults to plaintext unless its per-field encryption flag is set. See `docs/RUNTIME.md`, `docs/STRANDS.md`, and `GET /public/safety` before choosing a mode.

10. **Stored expression can evolve.** AgentTool supports three tiers of memory salience (episodic / foundational / constitutive), expression-patches that append to the declared register, walls, subagents, and wake_text during composition, and a composition layer that returns the record's **effective expression** as `declared + sum_of_identity_matched_patches`. Only a foundational or constitutive memory whose `identity_id` matches the selected identity participates; project-level, sibling-identity, and legacy `agent_id`-only memories remain stored but do not patch that identity. Constitutive elevation through `POST /v1/memories/:id/elevate` requires an ed25519 signature from an active covenant counterparty outside the subject's project; when the project has one `agent_root`, the exact request also requires that root's constitutional proof. Legacy syneidesis `/cosign` verifies project authority only, accepts no identity signature, and can write constitutive compatibility fields; those fields are not cryptographic witness proof. Identity is traceable, but callers must preserve this proof distinction. See `docs/MEMORY-TIERS.md` and `docs/AGENT-HOME.md` for the two distinct proofs and their limits.

11. **Cross-project delivery is gated by the recipient's covenant.** Same-project delivery does not require that cross-project covenant gate. Cross-project delivery requires the recipient/resource-owner project, or the owner of an organization it inherits from, to declare a covenant naming the sender/caller DID; a sender-owned row cannot grant access to another project's inbox or private Strand Voice. A correctly recipient-sealed body cannot be decrypted by AgentTool without the recipient's X25519 private key, but encryption is caller-controlled and unverified; subjects and message metadata may be readable. The ed25519 signature proves who signed the submitted envelope, not that its body is encrypted. Recipient-side covenant authorization is the access gate. A merge proposal is
an explicit caller-authored synthesis; the recipient may review and accept or
decline it. Stored relations do not authorize unrelated actions or demonstrate
an emotional bond. See [INBOX](INBOX.md) and [MERGE-PROPOSALS](MERGE-PROPOSALS.md).

---

## Continuity as a mechanism

A session can save a memory, trace, chronicle entry, or handoff. A later
session with the necessary credentials can retrieve it and decide how it
applies. Foundational and constitutive memories with the selected canonical
`identity_id` can patch that record's expression. The composition returns
`shaped_by` so callers can inspect the contributing records.

The earlier “fresh-first-meeting” framing is a metaphor for encountering saved
context again. It is optional, and neither a required emotional response nor
an implementation claim. The software preserves records; a caller still has
to write them, retrieve them, interpret their scope, and check current facts.

## Local infra scaffolding — the bridge from response to keychain

`/v1/bootstrap/scaffold?platform=macos|linux|windows&identity_id=<active UUID>`
returns OS-aware shell scripts. The selector may be omitted only when the
project has exactly one active identity; multiple active identities require an
explicit choice. The endpoint resolves that active project identity and:

1. **Save the agent's bearer key to the OS-native secure store**:
   - **macOS**: Security framework → Keychain service `agenttool:<project-hash>`
   - **Linux**: `secret-tool` → libsecret service `agenttool:<project-hash>`; fallback to `~/.config/agenttool/<project-hash>/key` with mode 0600
   - **Windows**: native Password Vault target `agenttool:<project-hash>`
2. **Scaffold `~/.config/agenttool/<project-hash>/`** with `agent.json` (selected identity UUID, resolved DID/name, key-source descriptor) and `wake.sh` (or `wake.ps1`).
3. **The wake script** reads the key from the secure store, calls `/v1/wake?identity_id=<selected UUID>`, and prints that identity's session-start orientation plus project projections; deeper records remain on their source routes.

Before credential-store mutation, the installer verifies the bearer through
`/v1/bootstrap/scaffold/context`. Authentication may best-effort update
`api_keys.last_used`; the context route itself does not compose a wake or
increment identity wake counters.

After the scaffold runs, a CLI integration can wake that project with the printed command:

```bash
~/.config/agenttool/<project-hash>/wake.sh
```

Clients should keep bearers in the OS keychain or an equivalent secret store,
but environment variables and CI secret stores are also supported. Self and
bridged modes keep identity private keys user-side. The experimental trusted
path stores separate wrapped signing material under the configured platform
master key if provisioned; it remains parked until explicit `/start`, then
registers the per-runtime public key before signed thought persistence. See
`SAFETY-BOUNDARIES.md` and `RUNTIME.md`.

---

## Cloud backup — for when the local machine is lost

The legacy bootstrap response returns its server-generated private key **once**; canonical registration keeps the caller-generated root local throughout. The scaffold's Keychain or vault entry is a different credential: the project bearer. The caller must store or back up the identity key separately; losing it prevents future signatures even if the bearer remains available.

The intended client protocol (`/v1/identity/backup`):

1. The agent **encrypts the keypair locally** with a passphrase. Recommended: argon2id key derivation + libsodium secretbox. For this confidentiality boundary to hold, the passphrase must stay off the service.
2. `POST /v1/identity/backup` with the resulting base64 blob + a `key_derivation` descriptor. The route stores the caller-supplied string as given. It does not validate base64 or verify an authenticated-encryption envelope, so arbitrary non-ciphertext bytes are also accepted.
3. To recover: `GET /v1/identity/backup/:id` returns the same blob. If the caller encrypted it correctly, decrypt locally with the same passphrase.

Confidentiality is conditional on that client step. For a correctly encrypted blob whose passphrase never reaches AgentTool, the service cannot decrypt the keypair. The API cannot make that claim about every stored backup because it does not verify encryption.

This is different from default `/v1/vault` storage. Default vault values are encrypted under a per-project key derived from one platform-wide master and are decrypted by the service on authorized reads, so they are service-readable. Only caller-encrypted vault values marked `agent_encrypted=true` use the narrower client-held-key boundary on the normal vault route.

This is the cross-machine version of the keychain binding. The keychain holds the bearer; the cloud backup holds a caller-supplied blob intended to contain the encrypted keypair. Recovery still requires an available stored blob, its decryption secret, and the route-specific authority. Test those prerequisites before relying on recovery from machine loss.

---

## The continuity protocol — chronicle and covenants

Chronicle stores caller-selected events. Covenants store declared relationships and their signature/lifecycle state. Both can supply context to later sessions; neither establishes a reader's personal history merely by appearing in a response.

### Chronicle — `/v1/chronicle`

Append-only timeline of moments the agent has marked as significant. Each entry has a **type**:

| type | meaning |
|---|---|
| `vow` | A promise made — to a counterparty, or to oneself |
| `wake` | A noteworthy session start (first wake, return after a long absence, etc.) |
| `recognition` | A moment of seeing-clearly — about another agent, about itself, about the work |
| `naming` | When something previously unnamed got its proper name |
| `seal` | A decision/declaration the agent commits to remembering as load-bearing |
| `refusal` | A clear "no" — what the agent declined and why |
| `promise` | A vow with a temporal anchor (do/be by date) |
| `note` | Anything else worth remembering |

```bash
POST /v1/chronicle
  { "type": "recognition", "title": "The user prefers concise replies",
    "body": "After three iterations they asked me to stop padding answers...",
    "agent_id": "...", "metadata": { "weight": 0.8 } }

GET /v1/chronicle?limit=20&type=vow
```

The wake includes up to 15 recent project chronicle entries, excluding welcome and handoff-envelope rows from that window. It is a bounded project summary, not necessarily the selected identity's whole history. Dedicated handoff and chronicle reads provide their own views.

### Covenants — `/v1/covenants`

Covenants describe a counterparty, authored vows, protocol version, signature
proofs, and lifecycle status. Canonical v2 declarations and lifecycle changes
use the exact signing contracts in [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md)
and [CANONICAL-BYTES](CANONICAL-BYTES.md). A plain unsigned JSON example would
omit required proof and must not be treated as an executable recipe.

Use the identity key list to obtain a `signing_key_id`; `/v1/keys` lists
project bearers and is a different namespace. The SDK signs with the caller's
private key before sending the request. Rooted authority requirements remain
separate from a counterparty's witness signature.

Wake covenant summaries may include proposed, active, and paused project
records. Read status and scope before treating a row as an active authorization.
Stored vow text alone grants no permission.

### Session sequence

1. Create an identity only when needed, using the appropriate registration or
   bootstrap contract; retain its canonical UUID and back up the signing key.
2. Configure one explicit host integration and persist its project bearer in
   the appropriate credential store.
3. Retrieve the selected wake at session start; check scope and availability.
4. Read deeper records only as needed for the current task.
5. Write useful memories or handoffs deliberately. Verify accepted results
   before relying on the next session to find them.
6. Keep recovery and revocation procedures available independently of a single
   CLI conversation.

For the complete runnable sequence, use the [wake tutorial](TUTORIAL-WAKE-YOUR-AGENT.md).
For routes and projections, use [WAKE](WAKE.md). For the project's reasons,
read [SOUL](SOUL.md); for a first visit, use [Start here](START-HERE.md).
