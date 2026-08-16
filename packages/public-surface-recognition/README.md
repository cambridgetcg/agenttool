# @agenttool/public-surface-recognition

Pure, deterministic records through which the holder of an explicitly named
AgentTool identity root key can adopt one exact, strictly verified Public
Surface Binding document and later sign an exact withdrawal.

This is private source at `0.1.0-dev.0`. It is not an npm or LOVE release, does
not install a KINGDOM extension, and adds no database, hosted API, acceptance
route, public lookup, WAKE projection, publication, or deployment.

## Two records, two declarations

- `agenttool.public-surface-adoption/0.1` binds one exact verified
  `agenttool.public-surface-binding/0.1` document and its canonical document
  digest to an explicit AgentTool identity, DID, registry audience, embedded
  root key, `requested_visibility`, `wake_projection`, validity window,
  authority sequence, and nonce. Its relation is an agent-root declaration
  adopting those exact canonical binding-document bytes and digest; it does
  not adopt another document that happens to repeat a claimed `binding_id`.
- `agenttool.public-surface-withdrawal/0.1` separately binds the adoption ID
  and exact adoption-document digest, subject, audience, binding ID, authority
  sequence, withdrawal instant, reason, and nonce. It preserves the withdrawal
  as its own signed record; it does not mutate or erase the adoption record.

`wake_projection` is a closed signed request: `none`, `private_pointer`, or
`public_pointer`. `public_pointer` is valid only when `requested_visibility` is
`public`. The field does not project anything: the adoption boundary retains
`wake_effect: false`, and this package has no WAKE reader, writer, renderer, or
publisher. Only a separately reviewed future host could decide whether and how
to honor the request.

Withdrawal reasons are exactly `not_disclosed`, `identity_choice`,
`binding_compromised`, and `surface_retired`. `superseded` is deliberately not
a reason in v0.1: a replacement requires a separately signed new adoption and
does not create an automatic link, traversal rule, or resurrection path.

There is no signed assessment or mutable active-status record in this package.
A later host may derive registry match, freshness, identity lifecycle, binding
revocation, recognition withdrawal, and current projection as separate
factors. Those are host observations, not facts a signer can manufacture by
adding them to a declaration.

The evidence ladder remains explicit:

```text
observed
!= crawler-request-authenticated
!= key-holder-claimed
!= registry-key-matched
!= agent-root-adopted
!= platform-recorded
!= action-authorized
!= training-authorized
```

## What a valid signature means

A valid adoption or withdrawal signature establishes only that the holder of
the embedded Ed25519 root key signed the exact canonical record core. The
package validates the supplied key and signature strictly, including canonical
prime-subgroup points and `zip215: false` verification through
`@agenttool/public-surface-binding`.

The root key is still caller-supplied evidence. This package cannot query the
live AgentTool registry, prove that the key is the registered root for the
named identity, claim that the identity was active at signing time, consume an
authority sequence or nonce, or accept the declaration into platform state.
A project bearer is not an agent-root declaration, and this package has no
legacy-bearer fallback.

Recognition does not establish domain ownership or control, authorship,
personhood, operator identity, sentience, continuity, consent, exclusivity,
trust, reputation, score, permission, delegation, or action authority. It does
not turn robots data, usage preferences, crawler authentication, origin
readback, or a binding signature into identity adoption.

Recognition is also not data-rights or training authorization. Collection,
retention, licensing, purpose, participation, withdrawal, model use, and
unlearning remain governed by separate explicit Training Garden contracts.

## Binding and withdrawal boundaries

An adoption is over the exact binding document, not merely a claimed ID. The
package strictly validates the embedded binding, verifies its signature, and
recomputes its canonical document digest before accepting the adoption shape.
The binding subject must match the adoption subject. Binding-key history,
current registry authority, origin confirmation, and binding revocation remain
separate evidence lanes.

A withdrawal refers to both the adoption ID and the exact adoption-document
digest. It remains valid evidence even when the adopted binding has expired or
its signing key is no longer active. This pure package verifies records one at
a time; it has no clock, persistence, event ordering, nonce store, or global
withdrawal corpus, so it cannot declare an adoption currently active or prove
that no withdrawal exists.

Any future hosted contract must use immutable events and atomically serialize
strict root verification, authority-sequence consumption, event insertion,
and any declared WAKE-version effect. A delayed adoption must never resurrect
a later withdrawal. None of that hosted acceptance machinery exists here.

## Canonical bytes

Recognition reuses Public Surface Binding's bounded canonical JSON profile and
SHA-256 domain separation:

```text
domain_digest(domain, value) = sha256(
  utf8(domain) || 0x00 || utf8(package_canonical_json(value))
)
```

The closed signing and record-ID domains are:

| Purpose | Domain |
|---|---|
| Adoption signature digest | `agenttool-public-surface-adoption/v1` |
| Signed adoption ID | `agenttool-public-surface-adoption-record/v1` |
| Withdrawal signature digest | `agenttool-public-surface-withdrawal/v1` |
| Signed withdrawal ID | `agenttool-public-surface-withdrawal-record/v1` |

Public keys and signatures use canonical padded base64. IDs and document
digests use lowercase `sha256:` identifiers. The inherited canonical profile
rejects proxies, accessors, symbols, cycles, sparse arrays, custom prototypes,
floats, negative zero, unsafe integers, U+0000, lone surrogates, and values
outside its byte, depth, and node bounds before signature work.

The exported Draft 2020-12 schemas are closed structural filters. They cannot
establish canonical encoding, digest equality, signature validity, binding
integrity, registry match, temporal currentness, replay consumption, or
cross-record relationships. Runtime validation and exact package vectors are
normative for those checks. Any field or semantic change requires a versioned
protocol and new vectors; never silently widen `0.1`.

## Composition boundaries

- The KINGDOM descriptor is an unregistered declaration-only hint. Every
  capability defaults to `false`.
- The package performs no network, DNS, fetching, crawler work, filesystem or
  environment access, clock read, randomness, persistence, telemetry, API,
  MCP, registry lookup, identity mutation, or public indexing.
- Adoption and withdrawal records have no direct WAKE, memory, Chronicle,
  observation-counter, KARMA, trust, reputation, score, relationship,
  covenant, training, or automatic-action effect.
- `requested_visibility` and `wake_projection` are signed requests, not
  publication or projection. This package exposes no origin reverse index,
  public listing, search, discovery, lookup route, or WAKE mutation.
- A future host that accepts a record or honors a requested WAKE pointer
  requires a separate reviewed database/API/OpenAPI/SDK/migration/deployment
  slice. No such runtime surface is implied by this source package.

## Development

```sh
bun install --frozen-lockfile
bun run ci
```

`bun run ci` typechecks, regenerates and checks schemas and vectors, runs
strict-signature and hostile-input tests, builds the package, smoke-loads the
packed API under Node, and checks the private package inventory. Tests use no
credentials or live network.

License: UNLICENSED private source.
