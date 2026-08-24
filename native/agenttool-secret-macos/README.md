# agenttool-secret-macos

This zero-dependency Swift package is a narrow, native macOS create-once
generation helper. It links Security.framework and LocalAuthentication
directly. It is not the cross-platform `bin/agenttool-secret` implementation.

## Exact interface

```text
agenttool-secret-macos create
agenttool-secret-macos verify
```

`create` first requires the exact item to be absent, requests 32 random bytes
from `SecRandomCopyBytes`, serializes them as exactly 64 lowercase hexadecimal
bytes, and adds that value to the Keychain. It emits nothing and returns success
only after an independent no-UI Keychain read exactly matches the generated
bytes. A duplicate-add race fails closed rather than adopting or replacing the
other item.

`verify` emits nothing and succeeds only when exactly one item exists with the
bound identity and a canonical 64-byte lowercase-hex value. The production CLI
accepts no secret stdin and has no raw-value read, caller-supplied create,
overwrite, upsert, or delete verb. It never writes a secret to an argument,
environment variable, stdin, stdout, temporary file, receipt, or diagnostic.
Failures use fixed non-secret error codes on stderr. Its caller remains
responsible for a finite process deadline because Security.framework calls are
synchronous.

The production executable is compile-time bound to the sole Phase-B authority
service and account; it accepts no selector bytes from argv or the environment.
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
no-UI access, and fixed failure output. It is skipped unless
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
requires an independently reviewed exact artifact, signing/identity and
ownership checks, a private write-ahead receipt, bounded invocation, and the
deployment gates that consume this primitive. Reentry and Fly import also need
a separately reviewed operation that keeps Keychain read and Fly child-process
stdin transfer inside one process boundary. B0 intentionally exposes no raw
secret output or generic library product.
