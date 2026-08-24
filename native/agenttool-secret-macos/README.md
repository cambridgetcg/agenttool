# agenttool-secret-macos

This zero-dependency Swift package is the narrow native boundary for the first
covenant-v2 authority generation. It links Security.framework and
LocalAuthentication directly. It is not the cross-platform
`bin/agenttool-secret` implementation.

## Exact interface

```text
agenttool-secret-macos create --receipt-nonce <32-lowercase-hex>
agenttool-secret-macos verify --receipt-nonce <32-lowercase-hex>
agenttool-secret-macos stage-fly --receipt-nonce <32-lowercase-hex>
agenttool-secret-macos probe-fly --receipt-nonce <32-lowercase-hex> \
  --machine <14-lowercase-hex>
```

The receipt nonce is non-secret continuity metadata. The helper decodes it to
exactly 16 bytes and binds the Keychain item with `kSecAttrGeneric`. Every verb
first validates the same nonce and its permitted write-ahead checkpoint in the
canonical private Phase-B active marker. The Keychain query remains bound only
to the fixed service/account tuple, so a foreign or unbound occupant is
detected rather than hidden by a nonce-qualified lookup.

`create` first requires the exact item to be absent, requests 32 random bytes
from `SecRandomCopyBytes`, serializes them as exactly 64 lowercase hexadecimal
bytes, and adds that value to the Keychain. It emits nothing and returns success
only after an independent no-UI Keychain read exactly matches the generated
bytes. A duplicate-add race fails closed rather than adopting or replacing the
other item.

`verify` emits nothing and succeeds only when exactly one item exists with the
bound identity and a canonical 64-byte lowercase-hex value. The production CLI
has no raw-value read, caller-supplied value, overwrite, upsert, delete, unset,
repair, or rotate verb.

`stage-fly` attests the fixed root-owned Fly v0.4.74 executable before reading
the Keychain, then sends exactly one
`AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION=<value>\n` record to
`fly secrets import --stage --app agenttool` through the child stdin pipe.
`probe-fly` requires the requested Machine to be the one write-ahead target in
the active marker, attests the same Fly executable, and sends only the retained
value plus one newline to a fixed silent remote proof. The remote proof checks
canonical shape, finds exactly one long-running process with the exact
`bun run src/index.ts` or `bun run src/thinker.ts` command, and compares the
retained value with that process's `/proc` environment using SHA-256 and a
timing-safe operation. It also binds that process's exact Machine ID, role,
revision, dirty/worker state, and database targets. Both roles prove the two
database paths; only the app role requires loopback configured health because
the service-less thinker has no HTTP listener. The proof emits no value or
digest. One Machine per invocation preserves the operator's attempted/verified
prefix.

The helper never writes the generation to an argument, environment variable,
stdout, stderr, temporary file, marker, or receipt. Child stdout and stderr go
directly to `/dev/null`. Fly runs from an absolute attested path with a closed
environment, isolated private HOME, `/` working directory, inherited file
descriptors closed, core dumps disabled, and bounded process-group
TERM/KILL/reap settlement, including descendants left behind after the direct
child exits. Owned generation buffers are zeroed best-effort;
Swift, Security.framework, and Fly may retain transient copies. Failures use
fixed non-secret error codes only.

The production executable is compile-time bound to the sole Phase-B authority
service and account; it accepts no selector bytes from argv or the environment.
It requires its resolved running path and device/inode to be the exact
root-owned installed artifact, then validates both that file and its running
`SecCode` against the marker-bound hash, Team ID, CDHash, hardened-runtime
flags, empty entitlements, and designated requirement. An unsigned local copy
cannot borrow an installed artifact's attestation.
Every Keychain operation selects that one non-synchronizable generic-password
tuple. A fresh `LAContext` has
`interactionNotAllowed = true`, so an operation that would need UI fails
closed. The package intentionally uses the default macOS Keychain rather than
silently opting into the data-protection Keychain.

## Build and pure tests

SwiftPM credential lookup should remain disabled even though this package has
no external dependencies:

```bash
swift test --no-parallel --disable-keychain --disable-netrc \
  --disable-prefetching --filter AgentToolSecretMacOSTests
swift build -c release --disable-keychain --disable-netrc \
  --disable-prefetching
```

The separate integration test performs real synthetic Keychain mutations and
exact test-only cleanup. It also invokes the exact built executable across
fresh processes to prove internal generation, non-exporting verification,
nonce binding, no-UI access, fixed failure output, staged stdin transfer, and a
single runtime probe against a disposable fake flyctl. It never contacts Fly.
It is skipped unless
`AGENTTOOL_KEYCHAIN_INTEGRATION=1` is explicitly present and
`AGENTTOOL_SECRET_MACOS_BINARY` names a debug executable built with the explicit
`AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD` Swift compilation condition, while
`AGENTTOOL_SECRET_MACOS_PRODUCTION_BINARY` names the separately built ordinary
artifact used only for a negative admission test. The test build is
compile-time bound to one fixed disposable tuple; it accepts no runtime
selector and must never be installed or published. It also recognizes one
fixed, non-Keychain `fixture-attest` verb and one fixed-tuple `fixture-clean`
verb. The integration test requires attestation as a throwing gate before its
first fixed-tuple Keychain call. Create, rawless verify, and cleanup all run
through that same fixture executable identity, so the default legacy-Keychain
ACL is never crossed by the XCTest process. An accidentally supplied ordinary
production build therefore refuses before cleanup or creation. Production
builds reject both fixture verbs. Do not set those gates as part of an ordinary
local build or pure test run.

Building source is not an activation ceremony. Operational use additionally
requires one independently reviewed and Developer-ID-signed native artifact,
the exact pinned Fly binary installed beneath the fixed root-owned path, an
isolated reviewed Fly auth/config home, a canonical private write-ahead marker,
the durable database allowlist hold plus a live row lock, and complete
five-Machine/four-runtime verification. The exact signed native bytes that
create the item must perform every later verify/stage/probe for the generation's
lifetime. This package exposes no raw secret output or generic library product.
