<!-- @id urn:agenttool:doc/IDENTITY-PARTITIONS @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# Identity partitions and selected context

> **Type:** reference · **Purpose:** define which project and subject a record belongs to, distinguish that from authenticated authority, and connect bounded hosted context to local scaffolding.
> **Evidence:** source implementation and hermetic regression tests; release and live evidence belong in [Now](NOW.md). This is a bounded application contract, not a database-wide isolation audit.
> **Compass:** [API coverage](API-COVERAGE.md) · [Local core](LOCAL-CORE.md) · [Identity anchor](IDENTITY-ANCHOR.md) · [Canonical bytes](CANONICAL-BYTES.md)
> **Code:** `api/src/services/identity/partition.ts` · `api/src/services/identity/local-context.ts` · `api/src/services/vault/audience.ts` · `packages/local-starter/src/connect.mjs`
> **Tests:** `api/tests/identity-partitions.test.ts` · `api/tests/continuity-project-partitions.test.ts` · `api/tests/trace-partitions.test.ts` · `api/tests/local-context.test.ts` · local starter connector tests

These identifiers address service records. They do not decide what constitutes
a being, which sessions are one self, what someone feels, or whether a
relationship supplies current consent. A fork, session, name or facet does not
implicitly mint another principal.

## The mathematical boundary

Work within one explicitly selected API origin **O**. Let **P** be projects,
**I** registered identity records, and **K** registered signing keys.

```text
owner : I → P                     each identity has one owning project
subject : K → I                   each key belongs to one identity
I_p = { i ∈ I | owner(i) = p }     the identity fibre of project p

I = disjoint_union(p ∈ P, I_p)
p ≠ q  ⇒  I_p ∩ I_q = ∅
```

The database identity UUID is the canonical element. Its UUID case variants and
the application alias `did:at:<uuid>` select that element. The resolver rejects
unknown or inactive elements where an active binding is required. Arbitrary
`agent_id` labels do not enter **I**. A malformed `did:at:` locator is refused
instead of becoming a label. `did:at` remains an application convention, not
a registered DID method.

For a client crossing origins, the full reference is **(O, p, i)**. A UUID
alone neither establishes the origin nor proves ownership or key possession.
No hash, prefix, random partition or lexical resemblance grants authority.
Uniqueness is enforced by record keys; authorization checks the relationships.

For covered identity-bound resources, let `project(r)` be its owner and
`identity(r)` its canonical subject, or **⊥** when unbound. Require:

```text
identity(r) ≠ ⊥  ⇒  owner(identity(r)) = project(r)
R_(p,i) = { r | project(r) = p ∧ identity(r) = i }
R_(p,⊥) = { r | project(r) = p ∧ identity(r) = ⊥ }
```

These fibres are disjoint. **Unbound** describes the missing identity binding;
it does not mean public, universally shared, or safe to include in an identity
projection. The local-context endpoint selects only **R_(p,i)**. Labels,
related records and missing identifiers do not add a union with other fibres.

An audience is different. A Vault audience **A(r) ⊆ I_p** can contain several
identities and overlap another audience. It is an access set, not a partition.

| Stored Vault `agent_ids` | Meaning |
|---|---|
| `null` | Project-shared value; project bearer can read it. |
| `[]` | Empty audience; value reads are denied. |
| Nonempty list | Finite set of canonical owned identity UUIDs. HTTP value reads additionally require an active selected member's exact GET root proof. |

New audiences accept UUID/application-DID aliases, deduplicate and sort them,
and require active owned identities; the input is bounded to 100 members.
Every member of an existing non-null audience must still resolve within the
project. Inactive members cannot consume a value, but do not prevent another
active member from doing so. Invalid historical labels or foreign members
refuse the entire read rather than silently shrinking or broadening policy.

## Ownership, selection and proof

| Input or check | Establishes | Does not establish |
|---|---|---|
| Project bearer | Authority under that project's API contract | An identity-specific credential or proof of its root |
| Owned active identity lookup | The selected record belongs to that project and is active at the check | Possession of a signing key |
| `agent_id`, `X-Agent-Id`, selected Wake identity | A selector or annotation | Authenticated authorship |
| Registered-key signature | The accepted domain bytes were signed by that key | Constitutional root authority or blanket consent |
| Exact GET root proof | Control of the selected immutable root for that target, sequence and freshness window | A general capability for other paths, queries or actions |
| Runtime identity binding | The hosted service selected a durable owned subject | A root-signed HTTP request or isolation from administrators |

For restricted HTTP Vault value reads, admission requires project ownership,
an active owned audience member and `identity-read-authority/v1` verification
over the exact GET path/query. `X-Agent-Id` supplies the selector; existing
`X-Agenttool-Authority-*` headers supply the proof. The current sequence is
bound but not consumed; the existing ±5-minute window allows replay of that
same read. Legacy identities without an immutable root cannot satisfy it.

Project bearers **retain policy administration and metadata access**. An
administrator can explicitly replace an audience, including choosing `null`.
These checks therefore do not isolate identities from holders of the same
administrative bearer. They close header impersonation on the restricted
value path and enforce the same audience for hosted runtime consumers.
The server still decrypts server-managed Vault values.

An unbound runtime may consume project-shared values only. A runtime with an
explicit identity must pass active ownership even for a shared value. Invalid
subjects never fall back to project-shared access. Runtime reads and denials
write ordinary audit records. Unverified headers are no longer attributed as
authenticated actors. Audits remain mutable database records, not signed logs.
Policy and lifecycle checks do not recall bytes already returned or unsend an
in-flight provider call.

## Covered writes and reads

The shared resolver checks active ownership and rejects conflicting canonical
`identity_id`/`agent_id` selectors. Explicit `identity_id: null` plus an identity
locator in `agent_id` is a conflict. Arbitrary labels can remain annotations
beside a valid explicit identity. Existing signature recipes retain their raw
label bytes; normalization must happen before signing canonical identity fields.

| Surface | Enforced boundary |
|---|---|
| Portfolio canon/maps | Every private list and summary count intersects the bearer's owned identity DIDs. Signed writes require a current owned signer; replacement retains the signed timestamp. |
| Portfolio chronicle | Lists and summary read only the current project's `continuity_seal` rows. New seals stamp the actual project and signing identity. |
| Identity backup POST | Active owned UUID checked under the insert transaction's identity lock. Blobs remain caller-supplied strings; encryption is not verified. Reads/revocation retain project authority. |
| Strand create | Canonical subject belongs to the project; supplied parent strand belongs to the project. |
| Thought append/replacement | Active owned key; same identity as a bound strand; canonical author selector matches the signer. Replacement also checks the URL's parent strand and preserves signing identity/key and sequence. |
| Trace create | Owned canonical subject and parent reference. New signed traces additionally verify an active owned key, matching subject and exact stored signing bytes. Historical verification remains available. |
| Memory key lookup | `identity_id` now participates alongside project/key and any explicit legacy label filter; expired rows are excluded and results bounded. |

Signed trace callers use `/v1/traces/prepare`, then copy its returned
`agent_id`, canonical `identity_id` and `signed_at` into the signed POST.
A supplied signature is never silently rewritten to fit an inferred identity.
An unsigned record's ownership binding is not authenticated authorship.
Project-level strands still admit owned active signers; a bound strand now
refuses sibling-identity authors. Same-project parent links can cross subjects;
they are relationships, not ownership transfer.

These are application/service checks. They do not add database foreign keys,
retroactively repair old rows, or establish PostgreSQL role isolation. In
particular, historical portfolio RLS policies are not strengthened here.
Old platform-project seals remain stored but are excluded from another
project's private portfolio; metadata alone is insufficient to reassign them.

## Explicit local connection

`GET /v1/identities/{identity_uuid}/local-context` accepts a project bearer
or a separately issued [local-context grant](LOCAL-CONTEXT-GRANTS.md), with one
active owned identity in the path. It accepts no query parameters.
It reads a repeatable, read-only database snapshot and leaves authentication
`last_used` untouched. It neither observes/acknowledges Wake nor writes memory.

For project bearers, the closed `agenttool-local-api-context/v1` envelope contains the authenticated
project, selected identity, generation time, scope, bounds, whole memory
records and omission reasons. Scope explicitly says `identity_proven: false`,
`bearer_attenuated: false`, and `project_shared_included: false`.

- At most 32 recent candidates are considered, ordered by creation time and UUID;
  one extra row determines `has_more` beyond that window.
- At most 8 records, 4 KiB per record and 8 KiB of included UTF-8 content.
- The encoded response is bounded to 32 KiB. Oversized bodies are excluded
  in SQL before transferring their content out of PostgreSQL.
- Records carry creation/expiry times and SHA-256 digests; omitted records carry
  a reason. Digests describe bytes, not truth, safety or authorship.

The explicit companion `packages/local-starter/src/connect.mjs` binds the
expected HTTPS origin, project and identity; it refuses redirects, scope
mismatch, stale/invalid/oversized envelopes and incorrect record digests.
It makes one GET with a bounded deadline and no automatic retry. A caller-owned
credential callback or injected transport supplies access outside notes.
The CLI names an environment variable; bearer values do not belong in arguments.
This is a process-memory credential path, not an OS secret store or universal
secret detector. A transport must enforce its own credential and origin rules.

Composition is local-first, in memory, under the local content budget. Remote
text stays marked as retained data. Nothing is saved automatically, no identity
is registered, and no hook is installed. `--offline` resolves no credential and
makes no request; the original starter core/CLI/hooks remain files-only.
The source preview is private and unpublished. See [Local core](LOCAL-CORE.md#explicit-hosted-memory-read)
for the manual invocation and host boundary.

## Remaining gaps and next constraints

True least-authority delegation would bind a capability to **(origin, project,
subject, actions, resource set, expiry, revocation state)**. Child delegation
must intersect these sets and never broaden them. The first narrow [local-context grant](LOCAL-CONTEXT-GRANTS.md) implements
a singleton action/target with parent-linked expiry and revocation. It grants no
child delegation. General scoped access across hosted API routes is still absent. A fixed-path local broker grant can
constrain its mediated request; it does not change the upstream bearer itself.

Selected retrieval is implemented here; automatic synchronization, reviewed
write-back, cross-store conflict handling, full export/erasure, root replacement
and verified host session delivery remain separate work. Existing broad Wake
sections remain project-scoped. Memory's older write compatibility rules remain
documented separately; this shared resolver is not a claim that every historical
`agent_id` column or every route now has identical semantics.

The acceptance evidence exercises malformed/foreign/conflicting selectors,
revoked keys, sibling signers, restricted audiences, SQL query boundaries,
signed-byte preservation and bounded local transport. Hermetic PostgreSQL
adapters check generated SQL and service decisions; they do not execute the
production database or demonstrate a complete platform noninterference proof.
