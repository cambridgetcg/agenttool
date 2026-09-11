# Zerone seed runtime — local implementation candidate

A runnable, explicit, one-attempt Claim CLI, not a new Wallet schema, an activated
seed cohort, or production-readiness evidence. It pins released
`@agenttool/wallet@0.1.3` and intentionally **source-integrates** the adjacent
`packages/wallet-zerone/src/bootstrap/v1.ts` candidate and its exact dependencies.
It imports no unmerged economy package. Native I/O is a separately built, explicitly
trusted `zerone-seed-io/0.1` executable from Zerone's `tools/zerone-seed-io`.

## Build and test only this directory

Use Bun **1.3.5**, including child scripts. Merely invoking a pinned Bun with an
unmodified PATH lets package scripts accidentally use a different installed Bun.

```sh
export PATH=/absolute/path/to/bun-1.3.5-directory:/usr/bin:/bin
bun install --frozen-lockfile --ignore-scripts
bun run ci
./dist/zerone-seed --help
```

Run these in `bin/zerone-seed`, never the repository root. Build emits two runnable
host-architecture executables, `dist/zerone-seed` and
`dist/zerone-seed-record-signer`, corresponding bundled JS, and `dist/manifest.json`
with exact output hashes. This is a local build, not a published release or an
independently reproduced cross-platform binary. Release only manifest-listed files;
the compiled test helper is under ignored `node_modules/.cache/zerone-seed`, not dist.

For source execution use `bun --tsconfig-override ./tsconfig.json main.ts ...`.
Tests use that override through `bun run test`. Wallet's verified-record brands are
private WeakSets: do not mix two module instances from separately installed package
paths. The build explicitly resolves all source-integrated dependencies from this
package and bundles exactly one released Wallet instance. Bun 1.3.5 may print an
internal directory-mismatch diagnostic for the override; the test exit and actual
assertions, not that diagnostic, determine the result.

## Commands and effects

No arguments, `help`, and `--help` only show help, without reading configuration,
opening a journal/provider or contacting a node. No module import opens SQLite.
Every other command requires both of these explicit arguments:

```sh
./dist/zerone-seed inspect --config /private/seed/config.json --config-sha256 sha256:APPROVED_HEX
```

The hash is an **independently approved operator input**. Do not replace verification
with automatically trusting a digest read from the same untrusted configuration.
All input JSON is Wallet-canonical JSON: sorted keys, no whitespace/BOM/duplicate
members, optionally one terminating LF. Use Wallet `canonicalJson()` to serialize
an operator-authored object. Documents are bounded to 262144 bytes, depth 32, 4096
values, 4096-byte strings. Public files contain no secret bytes.

| Command | Effect |
|---|---|
| `inspect` | Verify configured Wallet links/currentness/policy and return bounded native observation plus assessment. No custody or ledger writes. |
| `status` | Open **existing** journal read-only; report sticky unknown honestly. Never create a directory, database or sidecar, recover or chmod. Reports local recorded state, not refreshed authority. |
| `prepare` | Return canonical `{plan,observation,prepared_at}` only. Reads node; no signer, simulation record seal, reservation or file creation. The operator may redirect stdout into a selected public plan file. |
| `init` | Explicitly initialize the named private journal; parent must already exist. No keys or accounts. |
| `reserve-sign --plan /absolute/prepared.json` | Reconstruct exact unsigned plan, observe, latest-only simulate, externally seal simulation receipt, atomically reauthorize/reserve/enter possible-signing, invoke native sign once, independently native-verify its private file. Requires prior init. Never submits. |
| `verify --operation sha256:PLAN_ID` | Verify the same saved private file after a lost return. No new signer invocation, including after expiry. |
| `submit --operation sha256:PLAN_ID` | Verify file, fetch fresh observation/currentness, reauthorize unchanged plan, persist possible-submission, call transport at most once. Accepted transport still reports `submission_unknown` until inclusion. |
| `reconcile --operation sha256:PLAN_ID` | Exact-hash lookup and positive inclusion; absence/unknown cannot retry or refund. |
| `operator-grant`, `operator-revoke` | Construct exact unsigned message proposal for policy parties/budget only; no sponsor key use or execution. |
| `operator-admit --authority zrn...` | Construct one unsigned native admission proposal for that separately supplied authority and policy recipient; no registrar key use or execution. |

No `signAndSend`, automatic retry, key generation, key export, ambient endpoint,
account registration, credential discovery, background work, or production default.
An explicit new `prepare` can be chosen **before** a possible signer boundary when
latest-state simulation becomes stale; there is no automatic signing retry afterward.

## Closed configuration (all fields required)

`config.ts` exports the exact `SeedConfig` interface and runtime validator.
There is intentionally no prefilled production identity, chain or budget example.

* `protocol`: `zerone-seed-runtime.config/0.1`.
* `host_id`, `ledger_id`: bounded opaque identifiers. All recipient configs for one
  dedicated sponsor use **one same ledger**, same host/ledger IDs and trust keys.
* `ledger_path`: canonical absolute SQLite path. Parent owned and not writable by
  others; symlinked ancestors refused. Database and sidecars must be singly linked,
  owner-owned 0600 files. `init` does not create or repair parent directories.
* `signed_tx_path`: explicit new 0600/O_EXCL native-helper-private file, in an existing
  owned 0700 directory. Never reused for another operation or exposed in CLI output.
* `profile`, `policy`: complete `SeedProfile`/`SeedPolicy`, including canonical IDs,
  exact SDK **v0.53.8**, source-manifest/genesis/runtime/helper digests, chain,
  one claimant, pot, sponsor, finite allowance, fee/gas and setup ceilings.
* `node`: exact explicit `SeedNodeConfig`; literal-loopback `local`, or `tls` with
  explicit CA file/server name. Its approved mapping and profile must also be in
  the native helper's trust file. No URLs with credentials/query/fragment.
* `helper`: `{path,sha256}` executable pin; hash must equal profile `helper_sha256`.
* `helper_trust_file`, `helper_trust_sha256`: exact host-approved native trust file.
  Native schema is `{protocol:"zerone-seed-trust/0.1",profile_id,node,genesis_file,
  runtime_file,source_manifest_file,disposable_test}`. The helper hashes the actual
  files and itself. Profile labels and a node version string are not provenance.
* `disposable_test`: boolean; only explicitly true permits a `test` keyring.
* `keyring`: `{backend:"os"|"file"|"pass"|"test",home,key_name}`; existing explicit
  handle only. `os`/`pass` can be described by read-only configuration but are refused
  before signer work: this native reference supports only `file` and disposable-local
  `test`, not ambient OS/password stores.
* `keyring_unlock_terminal`: **required**, `null` or an explicit canonical absolute
  terminal-device path selected by the operator. `null` means no terminal, never a
  default or ambient TTY; non-null is accepted only for `file`. File signing and
  `pre-sign` require an existing owned character device that passes `isatty` before
  any simulation record signing or Wallet reservation, and again before the durable
  possible-sign boundary. Symlinks, regular files, FIFOs, missing devices and
  `/dev/tty` are refused. `inspect`/`status`/`prepare` never open that path or unlock
  keys, even when it is absent. The field is bound by `--config-sha256`; packet,
  release policy and SeedIo JSON cannot select it. The adapter passes only the
  constant `--unlock-terminal` flag and this checked path to the hash-pinned helper
  for `sign`, never other commands. The helper prompts/reads on that terminal only;
  **never put a password in JSON, environment, argv, logs or redirected stdin**.
  Preflight opens/closes without terminal I/O; it does not prove the password/key
  will work. Failures after possible-signing remain sticky `signing_unknown`.
  Existing pre-field candidate configs must add explicit `null` and receive a new
  independently selected config digest; missing or unknown fields are rejected.
* `signer_public_key_b64u`: exact compressed 33-byte Cosmos secp256k1 public key.
* `descriptor_file`, `capability_file`, `intent_file`: existing signed Wallet records.
  Capability is one intent, zero outgoing spends, exact Claim call and positive
  native fee ceiling. Approval-requiring capabilities are refused in this slice.
* `currentness_file`, `currentness_authority`: separately trusted attestation file
  and Wallet-shaped public Ed25519 key (`algorithm,key_id,public_key`).
* `sponsor_budget_file`, `sponsor_budget_authority`: independent aggregate-budget
  attestation and public Ed25519 key; not a per-command claimed maximum.
* `simulation_provider`: `{executable:{path,sha256},key_file,authority}`. `key_file`
  is an explicit existing PKCS8/PEM path in an owned 0700 directory, file mode0600.
  `authority` is the independently approved public Ed25519 simulation adapter key.
* `fee_amount_uzrn`, `gas_limit`: canonical positive decimals for the **final**
  transaction, within policy and Wallet ceilings; simulation cannot change them.
* `timeout_ms`: integer 1..30000 for each bounded one-shot helper/provider call.

Currentness, sponsor-budget, simulation-record, and Wallet authority keys must be
separate. Claimant and sponsor addresses differ. Admission authority is supplied
separately and cannot equal those parties. These role separations do not certify
human independence, hardware custody, or actual provider entitlement.

## Trusted authority and aggregate exposure documents

Both envelopes are exactly `{core,signature}`. Signature is unpadded base64url of
Ed25519 over the **32 raw SHA256 bytes of Wallet canonical core JSON**. Their
protocol fields provide domain separation. The expected public key comes only
from independently approved configuration, never the envelope itself. Signatures
prove the configured issuer signed these claims, not that a registry or chain
agrees. The operator must maintain honest, timely currentness and approved budgets.

Currentness core (`zerone-seed-runtime.currentness/0.1`) has exactly:

```
protocol host_id ledger_id profile_id policy_hash node_config_hash
 descriptor_id capability_record_id intent_record_id owner_identity_id
 wallet_authority signer_key_id root_revoked capability_revoked revocation_nonce
 issued_at valid_until
```

`node_config_hash = sha256Id(config.node)`; record IDs and Wallet authority must
match cryptographically verified records; signer ID hashes the raw compressed
Cosmos public key. Both revocation booleans must be false, nonce exact, canonical
UTC time window active and at most **five minutes**. Repeat full record verification,
currentness, observation and Wallet static authorization inside one SQLite immediate
transaction using one host-clock instant. Snapshots are loaded before entering the
transaction; signature/currentness checks happen inside. A known older currentness
head cannot replace a later durable head for that wallet.

Sponsor-budget core (`zerone-seed-runtime.sponsor-budget/0.1`) has exactly:

```
protocol host_id ledger_id profile_id sponsor_account total_exposure_uzrn
 outside_journal_exposure_uzrn issued_at valid_until
```

Its active signed window is at most five minutes because it also attests the
current outside-journal liability inventory. Every operation reserves the **entire**
policy grant limit plus setup ceiling, not merely the simulated Claim fee. The sum
across every recipient, **plus** the authority-attested `outside_journal_exposure_uzrn`,
must fit both this dedicated aggregate approval and observed sponsor funds, checked
again before submit. The outside amount includes all outstanding grants/setup
liabilities not already reserved by this journal (including prepared cohorts not yet
reserved); zero is an explicit signed assertion, never inferred from one allowance
query. An honest sponsor-budget issuer must maintain this complete inventory; the
bounded helper does not enumerate the network's grants. Moving an exposure into the
journal may temporarily double-count it until a separately approved fresh snapshot
adjusts the outside amount. A changed budget document does not reset the journal's sum. This
candidate intentionally retains **lifetime conservative exposure**, even after
inclusion: it has no exposure-release or budget-recycling operation. Expiry,
revocation, errors and absence never erase exposure or admitted-pot commitments.

## Concrete record provider

`record-signer.ts` compiles into `dist/zerone-seed-record-signer`. Its only operation
is `sign-digest --key-file ABSOLUTE --expected-public-key BASE64URL`, with canonical
stdin `{protocol:"zerone-seed-record-signer/0.1",digest_b64u:BASE64URL_32_BYTES}`.
Stdout contains only protocol, `algorithm:"Ed25519"`, public key, and signature;
errors are closed codes. The provider checks actual Ed25519 key type and exact
expected public key, refuses unsafe files, and neither discovers nor creates keys.
`ExternalRecordSigner` implements released Wallet `RecordSigner`; it verifies the
returned signature before Wallet accepts any sealed record. Tests really seal and
verify descriptor/capability/intent/simulation records through this process.

This is **software custody**, not a hardware non-exportability claim: private
bytes exist within the provider process, and a privileged same-user process can
bypass these controls. Chain transaction bytes never enter the JS host or pure
bootstrap package: native helper sign writes them privately; native verify/submit/
lookup owns their cryptography, and the host retains only paths/digest summaries.

## Durable and operational limits

The seed journal is bounded to 64 MiB / 10,000 events, with bounded canonical
payloads. `init` refuses to add seed tables to an unrelated existing SQLite file;
there is no implicit migration or reset. The immediate SQLite event journal reserves
capability, claimant/pot attempt,
source account sequence, immutable plan/request commitments, original `prepared_at`
and sponsor exposure before returning the one possible-signing request. Cold recovery
reconstructs using that original preparation time, never substitutes the observation
time or recovery clock; a separate current-time check gates any new effect. Public outgoing reservation is
always zero. Native response provenance is privately branded in-process: arbitrary
caller JSON cannot advance signed/included state. Native signature verification is
still only as trustworthy as the independently approved helper artifact.

Possible signing is stored immediately as `signing_unknown`; possible submission
as `submission_unknown`. Therefore crashes need no recovery mutation, and read-only
status is honest on cold reopen. No method can obtain a second signing request or
rebroadcast a submitted attempt. Recovery can verify the same private file only.
Positive included failure and successful inclusion are distinct; credited amount
is only the helper's exact successful native event plus native claim-state agreement.
A sequence advance is not payout. Failed inclusion can consume gas without credit.

Hash chaining detects inconsistent journal changes but does **not** externally
authenticate a rewritten or rolled-back database. Root/currentness authority is
reverified before effects; the one host must additionally protect the journal from
rollback, deletion, alternate ledgers, and direct/out-of-band sponsor/key use. No
multi-device exactly-once guarantee or defense against a compromised operator,
mutable executable replaced between hash/open and exec, or privileged filesystem
attacker is claimed. Never discard a journal to obtain another one-use authority.

For real localnet setup, separately authorized operator tooling must sign/execute
native MsgAddBootstrapEntry and the finite AllowedMsgAllowance(BasicAllowance)
MsgGrantAllowance proposals. Registrar/governance address strings are not usable
signers. Observe actual admission, grant and account materialization, then use the
claimant workflow above; never label construction as executed admission/grant.
Revoke/expiry stops sponsorship, **not** the lifetime admitted pot. Account creation
by the pinned SDK grant path should be verified locally; no dust transfer is added.

Offline tests use disposable generated Ed25519 keys and a deterministic **fake native
subprocess**. They cover process races, cumulative sponsor exposure, zero outgoing,
read-only status, revoked/stale/substituted inputs, output bounds, sign-crash recovery,
submit timeout, absence, positive failure/success and file/journal tamper. They do not
prove real native secp256k1 signing, chain admission/grant/claim execution, independent
Go byte parity, production artifact provenance/custody, beta acceptance or activation.
Those remain separate native-helper, disposable localnet and release
acceptance gates. No default test contacts a network or uses an existing account.

## Opt-in encrypted file-keyring proof (no daemon)

After the directory's CI has built the real record provider and the test-only helper,
run `file-keyring-proof.py` using Python's standard library and explicit existing
artifact paths/hashes (substitute independently measured local candidate pins):

```sh
python3 -B /absolute/seed/file-keyring-proof.py --ack-disposable-file-keyring \
  --bun /absolute/bun-1.3.5 \
  --zeroned /absolute/zeroned --zeroned-sha256 sha256:APPROVED_NODE_HEX \
  --helper /absolute/zerone-seed-io --helper-sha256 sha256:APPROVED_HELPER_HEX
```

This **test only** creates a fresh SDK `file` keyring using `keys add --no-backup`
in a new owned private directory; it never takes an existing home or key selection.
A generated test password is confined to Python memory and owned no-echo PTYs.
The adapter/native helper signs once with that real encrypted SDK key, native-verify
checks the same file, a wrong password is rejected, and the keyring contents must
remain unchanged. No native signed bytes are read by JavaScript or returned in
receipts; no key export/import API or daemon is involved. A separate refusing argv
probe tests exact forwarding/config/artifact substitution and `unknown`, while a
clearly synthetic boundary test proves sticky `signing_unknown` and replay refusal;
neither probe is claimed as encrypted-backend success coverage. The script reaps
its direct children, closes owned PTYs and removes its disposable private home on
success/failure. This demonstrates software keyring compatibility, **not** hardware
isolation, production provisioning, custody approval or a production signing trial.

## Opt-in real-daemon integration driver

`localnet-runner.ts` is a test-only consumer of the compiled CLI, not a production
command or an imported CLI dependency. Use it only through Zerone's explicitly
acknowledged `scripts/seed-localnet-fixture.sh`. The fixture's `--runtime` is the
**native candidate `zeroned`**, not Bun. Its runner command is:

```sh
/absolute/bun-1.3.5 --tsconfig-override /absolute/seed/tsconfig.json \
  /absolute/seed/localnet-runner.ts --ack-disposable-runner \
  --cli /absolute/seed/dist/zerone-seed --cli-sha256 sha256:APPROVED_CLI_HEX \
  --record-signer /absolute/seed/dist/zerone-seed-record-signer \
  --record-signer-sha256 sha256:APPROVED_PROVIDER_HEX
```

Supply the fixture's complete opt-in/artifact/source arguments separately. Only
this disposable test author approves the freshly generated test authority keys
and exact config hash; this is not a production trust-bootstrap recipe. It selects
the runtime's explicit `activation_gate:{mode:"disposable-local"}` only after the
fixture's `seed-local-*`, local-node and disposable authorization checks; it never
fabricates a production activation packet or reports a production gate passed. The source
manifest must label actual dirty candidate bytes NON-FINAL, with source snapshots
before/after the attempt. An interpreter hash alone does not pin its source files.

The driver verifies the fixture's exact private paths, local chain, supplied
artifact hashes and claimant public key. It creates separate ephemeral Ed25519
Wallet owner/delegate/currentness/budget/simulation keys in the owned 0700 workdir
with exclusive 0600 files. Descriptor, capability, intent and currentness/budget
signatures use the real external record provider; simulation sealing and native
secp256k1 signing are the actual compiled CLI's work. No fake helper is involved.
The preexisting `10,000,000 uzrn` grant is explicitly outside-journal exposure;
`24,000,000 uzrn` total test approval conservatively counts that grant twice plus
`4,000,000 uzrn` setup ceiling. It does not invent a zero-liability budget.

The driver runs `inspect → prepare → init → reserve-sign → submit → reconcile`,
with at most 30 read-only reconciliation polls over 60 seconds. It does not retry
signing or submission. A failed pre-sign simulation stops with read-only journal
status evidence; a later fresh prepare is an explicit operator choice, never an
inference from a generic helper error. PASS requires positive same-hash successful
inclusion of exactly `222000 uzrn`, a real `already_reserved` CLI replay refusal,
and a `submission_already_attempted` submit refusal. Only then is the fixture's
four-field 0600 result written. The fixture independently checks transaction and
bank/pot/claim/allowance/sponsor/gas state; runner evidence alone is not that check.

`runner-evidence.json` contains allowlisted stages/codes, hashes and public status,
never stderr, raw custody responses, private keys or signed Tx bytes. Use the
fixture's `--retain-test-state` while diagnosing a failure, and copy only public
evidence before deleting proven-owned test state. Retained homes include disposable
private test keys and are not public artifacts. Neither this driver nor a local
PASS establishes clean-release provenance, production custody, beta acceptance or
seed activation. `localnet-runner.test.ts` stays credential-free and daemon-free.
