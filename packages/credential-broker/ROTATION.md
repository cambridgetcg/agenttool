# Credential handoff and rotation

**Version:** `0.3.1` controller-plane design and macOS implementation.
Distribution availability remains separately verifiable.

`agentcred-control` standardizes how an operator places a provider credential
in macOS Keychain and rotates it without adding a secret-transfer operation to
`agentcred/0.1`. It ships beside the broker because it owns the same manifest
and lifecycle lock. It is not part of either AgentTool SDK or the agent wire.

The SDK can request a bounded broker operation. It cannot provision, reveal,
list, export, rotate, revoke, or delete credentials.

## Boundary

```text
provider dashboard / provider API
             |
             | operator copies a value once
             v
fixed macOS Keychain prompt ---> random slot A or B
                                      |
                         broker selects one reference
                              once at startup
                                      |
                                      v
                         bounded HTTPS operation

controller files: aliases, slot references, state, timestamps, evidence IDs
agent protocol:    no controller capability and no credential value
```

The controller:

- accepts the value only through `/usr/bin/security add-generic-password` with
  `-w` last and no value argument;
- has no value, password, token, prefix, stdin, environment-name,
  provider-action/Keychain URL, command, generic executable, reveal, or list
  option;
- writes owner-only manifests, locks, and closure archives, and reads the
  broker-written owner-only audit JSONL;
- invokes fixed Keychain operations; and
- requires an absolute manifest/config/archive path.

Its TTY check prevents accidental piping. It does **not** authenticate a human,
prove presence, record consent, or stop a same-user process from allocating a
pseudo-TTY. Use a Terminal that is not captured by an agent transcript.

macOS Keychain remains the secret store, but this preview invokes the common
`/usr/bin/security` executable. It does not provide a code-signed native helper
or a broker-exclusive ACL.

`--verify-origin` and `--verify-path` are persisted non-secret endpoint
metadata. Never put a credential in either: doing so would expose it in
process arguments and the manifest. Legacy key-in-path endpoints are not
supported lifecycle probes.

## What a generation means

A generation ID identifies one random, never-updated-by-the-controller
Keychain service reference. The broker resolves each configured
`active`/`candidate`/`previous` selector once while it holds the manifest lock.
A pointer cutover therefore requires a broker restart and cannot silently
change an issued grant.

A generation ID is **not** a digest or attestation of Keychain bytes. The
broker reads the selected item on each use, so an out-of-band same-user update
to that item is not detected. A non-secret `providerKeyId`, when supplied, must
be distinct across A/B, but the controller cannot prove that the two secret
values differ. Without a provider adapter that returns a bound key ID,
mistakenly pasting the old value into the new slot can pass both positive
probes and fail only when the old provider key is revoked.

## Verification profile

`init` records one immutable lifecycle-verification profile:

- exact canonical HTTPS origin;
- canonical, query-free path;
- read-only `GET` or `HEAD`;
- exact success status in `2xx`; and
- exact revoked status in `4xx`.

The path rejects backslashes, dot-segment normalization, encoded separators,
encoded dots, query strings, fragments, and controls. Candidate/active/previous
broker policies must cover the same origin, method, and path with no query
allowlist.

Evidence is accepted only from a completed broker audit event and binds:

- audit ID and timestamp;
- broker alias;
- selected slot generation;
- verification-profile hash; and
- exact observed status.

Broker evidence must be fresh (at most five minutes) at activation, rollback,
or a revocation boundary. The exact configured revoked status is accepted
only in the two explicitly documented negative-proof positions. Any result
proves only the bounded HTTP observation. It establishes authentication or
revocation only if the operator chose an endpoint whose documented semantics
require and identify this credential. Audit JSONL and operator evidence IDs
are mutable same-user metadata, not independent attestation.

JSON-RPC grants remain supported by the separate
`agentcred.evm-jsonrpc-read/0.1` agent profile, but they are not lifecycle
evidence. Rotation verification is deliberately HTTP `GET`/`HEAD` only.

## A/B lifecycle

The implemented state machine is:

```text
provider issues replacement (manual)
  -> provisioning
  -> staged
  -> verified_new
  -> cutover
  -> draining
  -> revocation_pending       # durable no-rollback boundary
  -> revoked_old
  -> verified_revoked
  -> deleting_previous
  -> closed
```

Crash-recovery and alternate branches are:

```text
provisioning --recover-stage [exact item present]--> staged
provisioning --resume-stage [exact item present or fixed native prompt]--> staged

cutover/draining --fresh old proof + reason--> rolled_back

provisioning/staged/verified_new/rolled_back
  -> candidate_revocation_pending
  -> deleting_candidate
  -> aborted or rolled_back closure
```

`planned` and provider `issued` remain external steps because no provider
administration adapter ships. `drain`, provider revocation, and rollback reason
IDs are non-secret operator attestations. They do not inspect a deployment or
call a provider.

The routine phases mean:

| Phase | Durable meaning |
|---|---|
| `provisioning` | Slot identity is committed before the Keychain prompt. A crash cannot orphan an unreferenced controller-created item. |
| `staged` | The Keychain item exists. Presence does not prove its contents. |
| `verified_new` | Fresh exact positive broker evidence is bound to the candidate slot. |
| `cutover` | The manifest selects the candidate; a restarted broker uses it. |
| `draining` | An operator supplied a consumer-drain evidence ID. |
| `revocation_pending` | Fresh exact new-slot success and exact old-slot success or configured revoked status exist; rollback is now forbidden before the remote revoke. |
| `revoked_old` | The operator attested provider revocation. A fresh active-slot success may also be recorded, but is not a forward-progress gate. |
| `verified_revoked` | Exact old-slot revoked status was observed after provider revocation. Post-revocation active success is recorded when available. |
| `deleting_previous` | Local old-item deletion intent is durable and retryable. |
| closed | The old item is absent and a sanitized closure receipt is retained. |

`status` reports active and candidate `expiresAt` metadata as
`valid`/`expired`, including while idle. This reflects the operator-supplied
timestamp, not a live provider query or guaranteed provider expiry.

## Initialize and map one credential

Create the owner-only directories first, then run:

```sh
agentcred-control init \
  --manifest "$HOME/.config/agentcred/credentials/service.json" \
  --credential service/default \
  --provider service \
  --purpose bounded-api \
  --environment local \
  --account "$USER" \
  --auth bearer \
  --verify-operation http.fetch \
  --verify-origin https://api.example.com \
  --verify-path /v1/whoami \
  --verify-method GET \
  --verify-success-status 200 \
  --verify-revoked-status 401
```

For custom-header authentication use `--auth header --header-name NAME`.
Managed auth has no arbitrary prefix field.

Map three broker aliases to the same absolute manifest:

- normal alias with `selection: "active"`;
- candidate alias with `selection: "candidate"`; and
- previous alias with `selection: "previous"`.

Only lifecycle-safe selectors materialize. Candidate is available only while
`staged`/`verified_new`. Previous is available only during
`cutover`/`draining` and again during `revoked_old` for the negative probe.
Rollback, pending-revocation, verified, and deletion states quarantine it.

## First handoff

1. Create a narrowly scoped provider credential manually.
2. Stop every broker process using the manifest.
3. Run `stage` against the candidate mapping. Enter the value only in the
   native prompt.
4. Start the broker, perform the exact candidate probe, and retain its audit
   ID.
5. Stop the broker and run `verify-new`.
6. Run `activate` within five minutes.
7. Restart the broker on the active mapping.

With no predecessor, activation immediately creates a `bootstrapped` closure.

If staging ends ambiguously, the durable phase remains `provisioning`:

```sh
agentcred-control recover-stage \
  --config /absolute/path/config.json \
  --credential service/default/candidate
```

Recovery advances only when the exact Keychain item exists and its metadata
expiry/overlap target remains valid. It never prompts or creates an item, so
its absent-item behavior remains compatible with the explicit provider-cleanup
and candidate-abort procedure.

If the prompt was cancelled before item creation, and the same intended
provider-issued value remains available, use the distinct explicit resume:

```sh
agentcred-control resume-stage \
  --config /absolute/path/config.json \
  --credential service/default/candidate
```

Resume is valid only in `provisioning`. It holds the lifecycle lock, checks
expiry/overlap before inspection, and inspects only the committed random
service plus manifest account. If that exact item exists it reconciles without
prompting. If absent, it reads the clock again and rechecks both time bounds
immediately before invoking the same fixed native macOS Keychain prompt. It
then confirms the exact item, rechecks expiry/overlap, and advances to
`staged`. Initial `stage` applies the same fresh pre-prompt check after its
write-ahead `provisioning` save. There is no credential value, stdin/env
source, provider URL, or generic command argument. Resume does not call the
provider or prove which value was entered; when value identity is uncertain,
use provider cleanup and the abort flow instead.

If a staging controller was killed or crashed, confirm that its native prompt
has ended and that no surviving `/usr/bin/security add-generic-password` child
from that attempt remains before recovering the lock or resuming. The lock
tracks the controller PID only. It does not track or supervise that child
across a parent `SIGKILL` or crash. The fixed committed service/account and the
absence of `-U` mean a later controller will not update an already-created
item, but a surviving prompt can still race a new prompt and Keychain presence
does not prove value identity.

## Routine rotation

1. Issue a second provider credential with overlap. Give it a distinct
   non-secret provider key ID when the provider exposes one.
2. Stop the broker and `stage --overlap-deadline ISO`. If `--expires-at` is
   supplied it must be later than that target.
3. Probe candidate, stop the broker, and `verify-new`.
4. `activate`; restart the broker and verify real consumers on the active
   alias.
5. Stop the broker and record `drain --evidence NON_SECRET_ID`.
6. While the broker is running, collect fresh exact positive audit IDs for
   both `previous` and `active`. If the previous credential is already dead,
   its exact configured revoked-status event may replace its positive event.
7. Stop the broker and run `prepare-old-revoke` with both audit IDs,
   a non-secret intent ID, and `--confirm-no-rollback`.
8. Revoke the old provider credential in the provider dashboard/API.
9. Stop the broker and run `attest-old-revoked` with the non-secret provider
   receipt ID and explicit confirmation. Supplying a fresh active positive
   audit ID is recommended but optional.
10. Start a broker configured for the `previous` negative probe and collect
    its audit ID after revocation. An active positive probe is recommended but
    optional.
11. Stop the broker, run `verify-revoked`, then `close
    --confirm-delete-local`.

The `revocation_pending` record is written before step 8. A crash after the
remote action therefore cannot restore rollback authority. Local deletion is
also write-ahead and idempotent: a crash after Keychain deletion leaves
`deleting_previous`, and rerunning `close` reconciles it.

`overlapDeadline` is an operator target and status warning, not proof that a
provider key expires at that instant. Expiry does not block forward
revocation/cleanup, because that would prolong exposure. Rollback still
requires a currently working fresh previous-slot probe.

Once `revocation_pending` is durable, a replacement outage cannot erase the
provider-revocation fact or block exact old-negative verification and local
cleanup. Receipts expose `postRevocationActiveProof` as `recorded` or
`not_recorded`; this is mutable local historical metadata, not provider proof
or a live health guarantee.

## Rollback

Rollback is available only from `cutover` or `draining`, before
`revocation_pending`. It requires:

- an exact positive previous-slot audit event no more than five minutes old;
- the expected previous slot generation; and
- a distinct non-secret reason evidence ID.

The controller re-selects the predecessor and quarantines the candidate. It
does not revoke or delete the candidate. Finish with the candidate-abort flow.
Rollback cannot restore a remotely revoked credential.

## Cancel or clean a candidate

Cancellation deliberately separates the provider boundary from local
deletion:

1. `prepare-abort --evidence ID --confirm-candidate-revocation` writes
   `candidate_revocation_pending`.
2. Revoke the candidate in the provider dashboard/API.
3. `attest-candidate-revoked --evidence ID
   --confirm-provider-revoked` writes `deleting_candidate`.
4. `close-abort --confirm-delete-local` removes the local item and closes the
   receipt.

This path works from `provisioning`, `staged`, `verified_new`, or
`rolled_back`. A crash after local deletion is recovered by rerunning
`close-abort`.

## Lock recovery

Broker and controller use a cooperative owner-only lifecycle lock. There is no
automatic stale-lock deletion.

1. Stop all broker/controller processes for the manifest.
2. Run `lock-status --manifest PATH`.
3. Verify the recorded PID is absent.
4. Confirm that no native Keychain prompt and no surviving
   `/usr/bin/security add-generic-password` child from that controller remain.
   This is an operator check; the lock record cannot establish it.
5. Run `recover-lock --manifest PATH --nonce EXACT_NONCE
   --confirm-stale-lock`.

Recovery refuses a live PID, indeterminate liveness, changed inode, changed
record, or changed nonce. Node has no conditional unlink-by-inode primitive,
so this remains cooperative coordination, not a boundary against a malicious
same-user process. It also has no cross-crash child-process supervision. If an
old prompt may still be alive or the entered value is ambiguous, do not
recover-and-resume; clean up the provider candidate and follow the abort flow.

## Closure archives

The manifest retains at most eight complete closures. Staging fails at the
limit before any provider/Keychain side effect. While idle:

```sh
agentcred-control archive \
  --manifest /absolute/path/service.json \
  --archive /absolute/path/service-archive-001.json

agentcred-control verify-archive \
  --archive /absolute/path/service-archive-001.json \
  --manifest /absolute/path/service.json
```

Archive is written before compaction, so a crash can create a redundant copy
but cannot erase the only evidence. The manifest retains a metadata/profile
hash, cumulative count, terminal generation, time, rotation ID, and archive
digest anchor. For successive files, add `--previous-archive PATH` when
verifying the newer archive.

The digest detects accidental inconsistency; it is not a signature against the
same user who can rewrite both files.

## Emergency compromise

Containment-first revocation of an already compromised old credential is
still a manual provider incident procedure: the controller never calls the
provider. After a healthy replacement is staged, verified, activated, and
drained, the controller can reconcile an already-dead predecessor using a
fresh broker event with the profile's exact revoked status plus fresh active
success and explicit no-rollback confirmation. A timeout, network failure,
`5xx`, or arbitrary denial is not accepted as that proof.

If compromise is suspected:

1. revoke/disable the provider credential immediately;
2. stop affected consumers and the broker;
3. inspect provider/audit/deployment history;
4. issue a fresh independently scoped replacement; and
5. reconcile the manifest through the exact negative recovery path, or rebuild
   it under incident handling if the provider cannot expose the configured
   authentication-bound revoked status.

Do not falsely advance the routine state with fabricated evidence. No rollback
is safe after actual provider revocation. A future provider adapter may add a
separate durable emergency lifecycle.

## Provider guidance

Prefer workload identity or short-lived credentials over rotating long-lived
bearer values.

- **GitHub Actions:** prefer job-scoped `GITHUB_TOKEN` or OIDC, environment
  protection, and least permissions. Repository/environment secret updates
  affect later jobs; verify a new job before revoking an overlapping secret.
- **npm:** prefer trusted publishing with exact case-sensitive package,
  repository, workflow, and environment mapping plus `id-token: write`.
  Publishing should not depend on a long-lived npm token when OIDC works.
- **Vercel:** prefer OIDC for supported integrations. Environment-variable
  changes apply to new deployments, so update, deploy, verify the new
  deployment, drain old deployment URLs, then revoke.
- **Bright Data:** an IP allowlist limits which stable egress IP may use proxy
  credentials; it does not identify a Mac behind changing/NAT egress and does
  not remove the proxy password requirement. Confirm that the observed public
  IPv4 is stable before depending on it.
- **Alchemy:** app access keys, allowlists, expiry, and least privilege are
  provider-side controls. The AgentCred JSON-RPC read profile is not lifecycle
  evidence, and a legacy Alchemy key-in-URL path must never be placed in
  `--verify-path`. Until an authentication-bound key-free HTTP GET/HEAD probe
  or provider adapter exists, Alchemy rotation remains manual/unsupported by
  this controller verifier.

Provider documentation:

- [GitHub OIDC](https://docs.github.com/actions/concepts/security/openid-connect)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Vercel OIDC](https://vercel.com/docs/oidc)
- [Vercel secret rotation](https://vercel.com/docs/environment-variables/rotating-secrets)
- [Bright Data proxy security](https://docs.brightdata.com/general/account/security)
- [Alchemy key management](https://www.alchemy.com/docs/best-practices-for-key-security-and-management)

## Cross-device use

Keychain items, manifests, locks, and archives are local. They are not a
cross-device synchronization protocol. Prefer a separately scoped provider
credential per device, with independent manifests and revocation, so one
device can be disabled without breaking another.

## Guarantees and limits

This workflow keeps credential plaintext out of normal chat, SDK, repository,
manifest, receipt, and agent-wire state when operated as specified. It makes
local cutover, rollback, remote-action intent, cleanup, and recovery explicit.

It does not:

- make chat, clipboard, terminal capture, backups, or crash logs private;
- remove a value already pasted, logged, committed, or transmitted;
- prove secret-byte distinctness or provider key identity;
- prevent root, malware, or unrestricted same-user Keychain access;
- authenticate a human through `isTTY`;
- call, verify, or universally interpret provider administration APIs;
- make local JSONL/evidence/archive metadata tamper-proof;
- guarantee zero downtime or revocation propagation;
- turn an IP allowlist into device identity; or
- synchronize authority safely across devices.

The lifecycle follows the principles in the
[OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html):
minimize privilege and exposure, prefer dynamic credentials, rotate with
overlap where safe, verify before revocation, and retain auditable metadata.
That is design guidance, not certification of this preview.
