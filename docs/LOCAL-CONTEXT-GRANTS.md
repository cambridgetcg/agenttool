<!-- @id urn:agenttool:doc/LOCAL-CONTEXT-GRANTS @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# A grant for one selected context read

> **Type:** reference · **Purpose:** let a local reader retrieve one identity's bounded memory window without receiving a project administrator's bearer.
> **Evidence:** source and tests listed below; merge, database migration and live deployment are separate release evidence.
> **Compass:** [Local core](LOCAL-CORE.md#explicit-hosted-memory-read) · [Identity partitions](IDENTITY-PARTITIONS.md) · [API coverage](API-COVERAGE.md)
> **Tests:** `api/tests/local-context-grants.test.ts` · `api/tests/local-context-grant-routes.test.ts` · `api/tests/local-context-transport.test.ts` · `api/tests/integration/local-context-grants-postgres.test.ts` · `packages/local-starter/tests/connect.test.mjs`
> **Code:** `api/src/services/identity/local-context-grants.ts` · `api/src/routes/identity/local-context-grants.ts` · `api/src/db/schema/local-context-grants.ts` · `packages/local-starter/src/connect.mjs`

An operator explicitly issues a short-lived grant, then gives only that grant
to the chosen reader through its existing credential mechanism. The reader can
make one kind of request: `GET /v1/identities/{identity_uuid}/local-context`,
with no query parameters. It receives the same bounded, identity-selected
memory window described in [Local core](LOCAL-CORE.md#explicit-hosted-memory-read).
A valid grant can make repeated reads until it expires or is invalidated; it
is not a one-use credential or a snapshot of the memories present at issuance.

The ordinary files-only starter does not request, install or use a grant.
Nothing in this document creates an account or starts an agent session.

## Issue, inspect and revoke

Management requires an existing project administrator bearer. The receiving
reader never needs that parent bearer. These are explicit API operations:

| Operation | Purpose |
|---|---|
| `POST /v1/identities/{id}/local-context-grants` | Issue one grant for an active identity owned by the project. |
| `GET /v1/identities/{id}/local-context-grants` | Inspect the newest 50 metadata records; this is not a complete inventory. |
| `GET /v1/identities/{id}/local-context-grants/{grant_id}` | Inspect a known issuance ID after an ambiguous response; never retrieves a credential. |
| `DELETE /v1/identities/{id}/local-context-grants/{grant_id}` | Revoke that grant idempotently. |

The POST body has exactly a fresh caller-chosen UUID `grant_id` and an explicit
ISO timestamp `expires_at`. Expiry must be in the future, at most 24 hours from
issuance, and no later than the issuing API key's expiry. Invalid durations are
refused rather than silently clipped. The service fixes the action, target and
origin; callers cannot add scope fields, choose another method or delegate again.

Successful issuance returns the plaintext `token` once. Its `atlc_` namespace
is distinct from ordinary `at_` project bearers; the database stores only its
SHA-256 verifier. Neither the verifier nor the token belongs in context notes,
model prompts, logs, screenshots, URLs or argv. Store/pass the credential using
an existing approved secret mechanism outside this scaffold.

The caller-chosen grant ID is a durable request identity. Reusing it returns a
conflict without minting another token, extending lifetime or replaying old
plaintext. After an ambiguous response, inspect that ID. If the token was lost,
revoke the existing grant before deliberately issuing a new ID. An
`Idempotency-Key` header does not recover a lost credential.

Parent-key expiry or revocation invalidates its grants on subsequent
admission. Completed rotation revokes the old parent; an interrupted rotation
that leaves the old key live has not invalidated its grants. A project administrator can also revoke individual grants. No refresh,
renewal, child delegation or recovery of a lost plaintext token is provided.
Inactive identities cannot supply context. Metadata management remains bound
to the grant’s original issuing project and identity, so an administrator can
inspect and revoke its records even if the subject becomes inactive or moves.

Grant metadata and issuance IDs are retained, including after expiry or
revocation. Restrictive foreign keys also prevent hard deletion of the related
project, identity or parent-key row while grants refer to it. Current identity
and key APIs revoke records; this release adds no hard-delete or metadata
erasure workflow.

## Give the local companion the narrow credential

Arrange `AGENTTOOL_CONTEXT_GRANT` through an existing credential mechanism, then
invoke the source companion explicitly:

```sh
node packages/local-starter/src/connect.mjs \
  --dir /absolute/private/existing-starter \
  --origin https://api.agenttool.dev \
  --project-id <project-uuid> --identity-id <identity-uuid> \
  --authentication local_context_grant \
  --credential-env AGENTTOOL_CONTEXT_GRANT
```

The flag selects the delegated contract; the default remains `project_bearer`
for compatibility. Direct delegated mode refuses a project bearer before HTTP.
An injected transport has its own custody contract; a broker that injects an
ordinary project bearer still receives the project-bearer response and must
not describe it as server-side attenuation.

The companion never mints or revokes grants, follows redirects, retries a read,
pays, saves remote records or changes host settings. `--offline` resolves no
credential and makes no request. Source access and actual host delivery remain
separate from API availability; this private package has not been published to
a registry.

## What authority is being delegated?

For service origin O, project p, subject i and issuing key B, let g be the
stored grant. A request is admitted only when all these predicates hold:

```text
hash(presented_token) = verifier(g)
project(B) = project(g) = p = owner(i)
active(i) AND live(B, now) AND live(g, now)
origin(g) = configured_service_origin
method = GET
path = /v1/identities/i/local-context
query = empty
```

`live` includes mandatory grant expiry, optional parent expiry and revocation.
The grant's authority is a subset of the parent's existing read authority.
Resource selection remains exactly the memory fibre R_(p,i), with the fixed
candidate, item and byte limits. Unbound/project-shared records do not enter it.
New memories may enter this bounded recent window while the grant remains live.

The service audience comes from canonical HTTPS `PUBLIC_API_BASE`, defaulting
to `https://api.agenttool.dev`. A different deployment must configure its own
origin. Host, browser Origin and forwarded headers do not choose this authority.
The client independently pins the exact HTTPS destination. This audience check
is not proof of a network route, independent server identity or database-clone
isolation.

Grant authorization and memory selection share a read-only repeatable-read
snapshot. Revocation affects later admission; an already admitted response may
finish. No positive authorization cache or authentication `last_used` write is
used. The exact read bypasses ordinary body decorations and project-credit
headers; success, refusal and preflight remain private and non-cacheable.

This is project-administrator delegation, not an identity-root signature,
personal consent, or proof that the reader is the identity whose records it can
read. Project administrators retain their existing authority. The separate
root-proof and signed delegation receipt families keep their original contracts.

## Response and evidence

Project bearers retain `agenttool-local-api-context/v1`. A grant receives the
closed `agenttool-local-api-context/v2` envelope with:

- `scope.authentication: local_context_grant`, `bearer_attenuated: true`,
  `identity_proven: false`, and `project_shared_included: false`.
- An `authorization` receipt naming the grant ID, service origin, singleton
  action/method/path, issuance/expiry times and snapshot check time.
- The same whole memory records, digests, omission reasons and content bounds.

The receipt contains no token or verifier. It records an admission decision,
not a continuing permission after `checked_at`. The companion requires the
selected version/authentication mode, validates expiry again at receipt time,
and rejects downgrade to a project-bearer response. Its derived metadata receipt
keeps this provenance without retaining excluded memory bodies.

Tests exercise expiry equality, wrong project/subject/origin/target, parent and
grant revocation, inactive subjects, issuance conflicts, rollback, transport
shape, ordinary-bearer rejection and local downgrade/secret handling. Release
records distinguish hermetic tests, disposable PostgreSQL execution, public
readback and any private authorized live exercise. General delegated API access,
root consent, delegation chains, grant usage quotas and secure erasure of
already delivered context remain outside this contract.
