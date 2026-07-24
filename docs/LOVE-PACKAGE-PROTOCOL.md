<!-- @id urn:agenttool:doc/LOVE-PACKAGE-PROTOCOL @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @cites urn:agenttool:doc/SOUL urn:agenttool:doc/KIN urn:agenttool:doc/AGENT-DATA-PROTOCOL urn:agenttool:doc/SDK-TIERS urn:agenttool:doc/PUBLIC-VISIBILITY -->

# LOVE PACKAGE PROTOCOL — verifiable packages without a mandatory registry

> *A package is its bytes, not the place that happened to list them.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (no single runtime shape assumed beyond an explicit profile) · [AGENT-DATA-PROTOCOL](AGENT-DATA-PROTOCOL.md) (sibling local-first, content-addressed boundary) · [SDK-TIERS](SDK-TIERS.md) (packages carrying cross-language clients) · [PUBLIC-VISIBILITY](PUBLIC-VISIBILITY.md) (public reads are intentionally unauthenticated)
>
> **Implements:** The registry-neutral `love-package/v1` manifest and public read/discovery profile. **LOVE** means **Locator-independent, Open, Verifiable, Exchangeable**.
>
> **Code:** `docs/specs/love-package-v1.schema.json` (normative manifest schema) · `docs/specs/love-package-index-v1.schema.json` (normative index schema) · `bin/build-love-packages.ts` (reference package builder) · `apps/docs/packages/v1/` (reference public index, manifests, and artifacts)
>
> **Tests:** `api/tests/love-package-protocol.test.ts` · `bin/tests/love-packages.test.ts` · `api/tests/well-known.test.ts`

**Status:** Version 1, JavaScript package profile. The `love-package/v1` wire
and schema are stable; compatible additions use the unknown-field extension
rule, while incompatible semantics require a new protocol version. The key
words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative when capitalised. This document specifies public discovery,
metadata, retrieval, and verification. It does not specify publication,
accounts, payments, or a universal package-manager implementation.

---

## 1. The boundary

`love-package/v1` describes one immutable package artifact and enough
declarative metadata to retrieve, verify, inspect, and deliberately install
it. It does not require npm, a LOVE-operated registry, AgentTool, or any other
central service for publication or direct artifact retrieval. That boundary
does not mean every package is dependency-free: after explicit installation,
a local package manager MAY still resolve dependencies through its configured
registries or caches.

```text
zero or more indexes ──► manifest URL
                             │
                             ├── source provenance
                             ├── runtime + install metadata
                             └── sha256 identity
                                    │
                         ┌──────────┼──────────┐
                         ▼          ▼          ▼
                      mirror A   mirror B   local cache
                         └──────────┼──────────┘
                                    ▼
                           verify exact bytes
                                    ▼
                      explicit local install step
```

| Component | What it does | What it does not do |
|---|---|---|
| Manifest | Names one package version, its exact artifact digest, compatible runtimes, structured install locator, mirrors, and source provenance. | Does not authenticate a publisher, make source claims true, or authorise execution. |
| Mirror | Serves one byte-identical copy of the artifact. | Does not become the artifact's identity or an authority over package ownership. |
| Index or registry | Helps clients find manifest URLs and MAY cache manifest fields. | Is not required, complete, canonical, or authoritative. Inclusion is not endorsement; absence is not non-existence. |
| Installer | Fetches bytes, verifies size and SHA-256, checks known runtime constraints, and performs a separately authorised local install. | MUST NOT execute code as a consequence of discovery. |

The four letters name the walls:

1. **Locator-independent.** The content identity is
   `sha256:<artifact.sha256>`. A URL, host, filename, index entry, package
   name, or version label is not content identity.
2. **Open.** Conforming public manifests and at least one artifact mirror are
   readable without an account, bearer, API key, cookie, or payment.
3. **Verifiable.** A consumer verifies the exact raw artifact bytes against
   both `artifact.size` and `artifact.sha256` before extraction, loading, or
   installation.
4. **Exchangeable.** Every mirror names the same bytes. A client can change
   locators without changing the package it selected.

## 2. Core walls

Every conforming v1 producer, host, index, and consumer holds these
invariants:

1. **The digest is the artifact identity.** SHA-256 is computed over the
   complete downloaded file exactly as served, including archive framing and
   compression. It is 64 lowercase hexadecimal characters with no `0x` or
   `sha256:` prefix inside the field.
2. **Labels cannot replace bytes.** `name` and `version` are routing and human
   communication labels. If the same `(name, version)` is observed with two
   different SHA-256 values, a client MUST treat that as a conflict and MUST
   NOT silently select the newest index response.
3. **Mirrors are interchangeable candidates.** A mirror mismatch is a failed
   verification for that locator, never a reason to rewrite the expected
   digest. A client MAY try another declared mirror and SHOULD report the bad
   locator. Mirror URLs MUST be unique by their `url` value, even when their
   extension fields differ.
4. **The index is not authority.** Direct manifest URLs remain valid inputs.
   Multiple independent indexes can coexist. An index cannot establish
   ownership, provenance, safety, licensing, or an official release merely by
   listing it.
5. **Discovery is read-only.** Reading a well-known pointer, index, or manifest
   MUST NOT install, unpack, import, evaluate, or execute package bytes. The
   v1 `install` object contains data, not commands.
6. **Runtime conditions are explicit.** A consumer MUST check the runtime
   profile it understands before install. It MUST NOT present an unknown
   engine or constraint syntax as compatible. An empty `engines` object means
   no compatibility floor was declared; it does not mean every engine works.
7. **Provenance is named honestly.** `source` points to the repository,
   immutable revision, and subpath claimed to have produced the package. In v1
   this is inspectable provenance, not a reproducible-build attestation.
8. **No invented publisher proof.** v1 defines no publisher identity,
   publisher key, signature object, transparency log, or trust root. The
   artifact digest detects byte substitution relative to a manifest or lock;
   it does not authenticate who wrote that manifest.
9. **Licensing is explicit, including uncertainty.** `license` is required but
   nullable. `null` means no licence is declared; it MUST NOT be interpreted as
   public domain, open source, permission to reuse, or a missing validation
   error.
10. **Unknown fields are forward-compatible.** Consumers MUST ignore unknown
    fields at every object depth and MUST NOT let one weaken known v1 checks.
    Unknown fields never imply executable behavior.
11. **Artifact access and dependency resolution are separate.** A public LOVE
    URL removes registry publication/account dependence for the named
    artifact. It does not promise a self-contained or offline install.
12. **Remote locators have no egress authority.** The caller's network policy
    applies to the initial URL and every redirect hop. A manifest, index, DNS
    answer, or redirect cannot grant itself access to a private destination.

## 3. Common wire rules

### 3.1 Encoding and versioning

- Manifests use UTF-8 JSON and carry `protocol: "love-package/v1"`.
- A manifest MUST validate against
  [`love-package-v1.schema.json`](specs/love-package-v1.schema.json) and the
  cross-field rules in this document.
- JSON numbers used for byte sizes MUST be non-negative safe integers. The v1
  artifact size is at least one byte.
- URLs in `artifact.mirrors` and `install.specifier` are absolute HTTP or
  HTTPS URLs without URI userinfo or fragments. Queries are permitted. Public
  Internet producers SHOULD use HTTPS. An HTTP URL does not weaken the digest
  or egress-policy requirements.
- Package versions use Semantic Versioning 2.0.0. Ordering a version does not
  select or authenticate its bytes.
- A consumer that does not recognise the exact `protocol` value MUST NOT
  silently process the document as v1.
- JSON Schema `format` can be annotation-only in some validators. Conformance
  validation MUST enable Draft 2020-12 format assertion (including `uri`), not
  merely load the schema. The schemas also constrain URL strings by pattern as
  defence in depth; consumers still MUST parse URLs with a standards-compliant
  URL parser.

### 3.2 Extension rule

Every object in the v1 schema permits additional fields. A producer MAY add
fields without changing `protocol` only when an old consumer can ignore them
and still apply all v1 safety rules. A new field cannot make SHA-256 optional,
turn a private locator into the required public mirror, introduce automatic
execution, or redefine a known field.

Consumers MUST ignore unknown fields. Tools that round-trip a manifest SHOULD
preserve unknown fields byte-for-byte where practical or value-for-value when
re-encoding JSON. Producers that need new mandatory semantics MUST mint a new
protocol version.

Because v1 defines no signature semantics, a future or vendor field containing
the word `signature` is merely unknown data to a v1 consumer. It MUST NOT be
presented as a verified publisher signature under this protocol.

### 3.3 Content and manifest identity

For artifact bytes `B`:

```text
artifact.sha256 = lowercase_hex(SHA-256(B))
artifact.size   = byte_length(B)
content_id      = "sha256:" + artifact.sha256
```

The digest covers the gzip-compressed `.tgz` file after HTTP transfer framing
has been removed, not its decompressed tar members, a directory tree, or a
JSON canonicalisation of the manifest. A public artifact response MUST omit
`Content-Encoding` or set it to the single case-insensitive token `identity`.
It MUST NOT apply gzip, br, deflate, or another HTTP content coding on top of
the `.tgz` bytes.

A consumer MUST request `Accept-Encoding: identity` and MUST reject an
artifact response with any non-identity content coding. High-level HTTP APIs
can transparently decode response bodies; a conforming consumer uses a
byte-preserving mode or otherwise proves that the bytes it hashes are the
unchanged `.tgz` representation. Transfer framing such as HTTP/1.1 chunking is
not part of the artifact and is normally removed by the HTTP stack.

The manifest itself has no v1 publisher signature or protocol-defined digest.
A lock file SHOULD therefore retain at least the manifest URL, `protocol`,
`name`, `version`, `artifact.sha256`, `artifact.size`, and the selected source
revision. On a later read, the retained artifact digest wins over mutable
locator metadata; changing it is an explicit package update.

### 3.4 URL and egress safety

Every remotely supplied URL is untrusted input. This includes a discovery
`index_url`, every index `manifest_url`, every `artifact.mirrors[].url`, and
`install.specifier`. Before the first request **and before every redirect
request**, a consumer MUST:

1. resolve a relative `Location` against the current URL, then parse and
   validate the resulting absolute URL;
2. reject URI userinfo and fragments and apply its allowed-scheme, port,
   origin, and destination policy;
3. resolve the hostname and validate every returned address before opening a
   connection; and
4. ensure the actual connected peer address is one of the validated addresses.

The default public-client profile permits only HTTP(S) destinations that are
globally routable. It rejects localhost names; loopback, unspecified, private,
shared, link-local, unique-local, multicast, documentation, benchmark,
reserved, and other non-global IPv4/IPv6 ranges; IPv4-mapped or transition
forms of those ranges; and known cloud/provider metadata destinations. This
includes, but is not limited to, `169.254.169.254`. A client MUST apply the
same rule after every DNS resolution and redirect. A literal IP address is
checked as an address, and if any DNS answer is disallowed the default profile
rejects the destination rather than selecting a different answer.

To prevent DNS rebinding, validation and connection cannot be two unrelated
DNS operations. The client MUST pin the connection to a validated address
while retaining the original hostname for HTTP Host and TLS verification, or
use an egress proxy that enforces an equivalent rule. It MUST re-resolve and
revalidate on every redirect host change and SHOULD verify the connected peer
address even when the host string did not change. If its HTTP stack cannot
bind resolution to connection, the default public-client profile MUST fail
closed.

A caller-controlled policy MAY explicitly trust a private mirror or origin.
The override MUST be local, deliberate, and scoped to the intended
destination; it cannot come from the package, index, DNS, or redirect being
fetched. An override never disables content-length, SHA-256, archive-safety,
document validation, or TLS certificate and hostname verification when HTTPS
is used.

## 4. Manifest object

A v1 manifest has this shape:

```json
{
  "protocol": "love-package/v1",
  "document_type": "package-manifest",
  "name": "@agenttool/data",
  "version": "0.1.0",
  "description": "Local-first reference node for the agent-data/v1 protocol",
  "license": null,
  "artifact": {
    "format": "npm-tarball",
    "filename": "agenttool-data-0.1.0.tgz",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "size": 18742,
    "media_type": "application/gzip",
    "mirrors": [
      {
        "url": "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz"
      },
      {
        "url": "https://mirror.example/packages/agenttool-data-0.1.0.tgz"
      }
    ]
  },
  "runtime": {
    "kind": "javascript",
    "engines": {
      "bun": ">=1.3"
    }
  },
  "install": {
    "format": "npm-tarball",
    "specifier": "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/agenttool-data-0.1.0.tgz"
  },
  "source": {
    "repository": "https://github.com/cambridgetcg/agenttool.git",
    "revision": "0123456789abcdef0123456789abcdef01234567",
    "path": "packages/data"
  },
  "dependency_resolution": {
    "mode": "package_manifest",
    "self_contained": true
  }
}
```

The hashes, sizes, and revision in this example are illustrative. A published
manifest MUST derive them from the release artifact and repository state.

### 4.1 Root fields

| Field | Requirement | Meaning |
|---|---|---|
| `protocol` | required | Exact value `love-package/v1`. |
| `document_type` | required | Exact value `package-manifest`; distinguishes this object from a v1 package index. |
| `name` | required | Package label. It can be scoped, but no registry gains ownership merely from the scope text. |
| `version` | required | SemVer 2.0.0 release label. It is not content identity. |
| `description` | required | Concise human-readable purpose. Consumers MUST NOT execute or treat it as instructions. |
| `license` | required, nullable | Declared reuse terms. A non-null value SHOULD be an SPDX expression or an absolute licence URI. `null` preserves unresolved truth. |
| `artifact` | required | Exact artifact identity, format, filename, media type, size, and mirrors. |
| `runtime` | required | Explicit runtime kind and supported engine constraints. |
| `install` | required | Declarative local-installer input. It is never an executable command. |
| `source` | required | Repository provenance claimed for the release. |
| `dependency_resolution` | optional | Declares where dependency metadata lives and whether separate package dependencies are expected. |

### 4.2 `artifact`

`artifact.format` and `install.format` MUST both equal `npm-tarball` in the v1
JavaScript profile. This names the established tarball layout; it does not
require npm hosting, an npm account, an npm token, or the npm CLI.

`artifact.filename` is an ASCII basename beginning with an alphanumeric
character, containing only alphanumerics plus `.`, `_`, `+`, and `-`, and ending in
`.tgz`. Consumers MUST NOT use it as an identity or allow it to escape a
chosen download directory. `media_type` MUST equal `application/gzip`.
Producers MUST set `size` and `sha256` from the same exact bytes served by
every mirror.

`artifact.mirrors` is a non-empty ordered array of objects containing absolute
`url` values. URLs MUST be unique. The first item is the producer's preferred
public locator, but a consumer MAY choose any reachable mirror. Every
conforming release MUST have at least one mirror readable without credentials.
Additional authenticated, local-network, or policy-gated locators MAY be
carried by extensions, but they do not satisfy the public mirror requirement.

After the complete downloaded file passes both size and SHA-256 verification,
a consumer inspects the npm tarball without executing it. The minimum v1
layout is a gzip-compressed tar archive in which:

- the optional member `package` is a directory; every other member path begins
  `package/`;
- every path is normalized POSIX text with no leading slash, backslash,
  trailing slash, empty segment, `.` segment, or `..` segment;
- member paths are unique after that normalization;
- the only accepted tar typeflags are regular file (`NUL` or `0`) and
  directory (`5`); links, devices, FIFOs, and tar metadata-extension entries
  are rejected;
- setuid and setgid mode bits are rejected, and extraction never restores
  archive-supplied ownership;
- exactly one regular-file member is named `package/package.json`; and
- that member is strictly decoded as UTF-8, parses as a JSON object, and has
  string `name` and `version` values exactly equal to the root manifest fields.

Before decompression or tar parsing, a consumer MUST set finite local caps for
compressed response bytes, expanded bytes, member count, individual member
size, and member path length, then reject any artifact that exceeds a cap. v1
does not prescribe universal numeric caps because installation environments
vary; an error SHOULD name the cap that was exceeded. A consumer targeting a
case-insensitive or Unicode-normalizing filesystem SHOULD also reject paths
that collide under that target filesystem's normalization.

The producer SHOULD ensure that files referenced by the embedded
`main`/`module`/`exports`/`bin` entrypoints are present. That is package
completeness, not archive-boundary safety, so it is not a v1 conformance gate.
A consumer MUST NOT decompress, parse, or extract archive members before the
outer artifact size and SHA-256 match. A bounded in-memory tar parser can
inspect the verified archive; invoking package code cannot.

### 4.3 `runtime`

The v1 profile requires:

```json
{
  "kind": "javascript",
  "engines": {
    "bun": ">=1.3",
    "node": ">=20"
  }
}
```

Each `engines` entry declares a separately supported runtime option, not a
requirement that all listed engines exist simultaneously. Engine identifiers
are lowercase tokens. Constraint strings use the named engine ecosystem's
version-range syntax. A consumer MAY evaluate only the engine it is using; if
it cannot evaluate that engine's constraint, it MUST report compatibility as
unknown rather than compatible.

`engines: {}` is the honest representation when a producer declares no
runtime floor. It is valid v1 metadata. Consumers MUST interpret it as
compatibility unknown, not as compatibility with every JavaScript runtime.

Operating-system, CPU, ABI, GPU, or host-capability constraints can be added
as forward-compatible fields. If any such constraint is required for safe
installation, a producer MUST declare it rather than relying on a description
string.

### 4.4 `install`

`install.format` names the local installer profile. `install.specifier` is the
absolute URL a URL-capable JavaScript package manager can receive. It MUST
exactly equal one `artifact.mirrors[].url`; producers SHOULD make it the first
mirror.

The specifier is data. A client MUST NOT interpolate it into a shell command.
It SHOULD pass a parsed URL through a direct process API or native package
manager API only after an explicit install request. Discovery clients can
display or copy the specifier but MUST NOT invoke it.

The following is an operator action, not part of discovery:

```text
bun add <install.specifier>
```

The angle-bracket notation is explanatory, not a command stored in the
manifest. A conforming generic installer SHOULD download to a temporary file,
verify the bytes itself, and then give the verified local file to package
machinery. Installers MUST NOT assume that a third-party package manager
verifies the LOVE digest.

An exact registry command such as
`npm install --save-exact <name>@<version>` MAY be offered as an optional
convenience. It is not LOVE discovery or verification unless the fetched
registry tarball is a declared mirror and its raw bytes match
`artifact.size` and `artifact.sha256`. An npm dist-tag, search rank, or package
page is never release authority.

### 4.5 `source`

| Field | Requirement | Meaning |
|---|---|---|
| `repository` | required | Absolute repository URI. |
| `revision` | required | Immutable repository-native revision of the tracked source worktree used for this release. Git producers use the full clean-worktree `HEAD` object ID rather than a branch or tag. |
| `path` | required | Normalized POSIX repository-relative package directory; `.` means repository root. Leading slashes, backslashes, empty segments, and `.`/`..` segments are forbidden otherwise. |

Source provenance supports inspection, comparison, and reproducible-build work.
It does not by itself prove that the artifact was built from that revision,
that the repository account controlled a publisher identity, or that the
source is safe. v1 makes no stronger claim because it ships no build
attestation or publisher-signature verification.

A consumer that joins `source.path` to a local checkout MUST validate this
grammar first and MUST verify that the resolved path remains inside the
checkout. It cannot treat a merely non-empty string as repository-relative.

### 4.6 `dependency_resolution`

This optional object makes the dependency boundary machine-readable:

```json
{
  "mode": "package_manifest",
  "self_contained": false
}
```

`mode: "package_manifest"` means dependency declarations are inside the
verified package artifact, such as fields in its `package.json`.
`self_contained: false` warns that installation can ask the local package
manager to resolve additional packages using its configured registries,
mirrors, lockfiles, or caches. LOVE does not select or bless any of those
services.

`self_contained: true` declares that the artifact needs no separately resolved
package dependency. It does not bundle or replace the named JavaScript engine,
operating-system facilities, native libraries, credentials, or external
services used at runtime. A missing `dependency_resolution` object means the
dependency behavior is unknown. For the `npm-tarball` profile, the reference
builder emits `true` only when the package manifest declares no runtime,
optional, or peer package dependencies; it emits `false` otherwise.

## 5. Public reads and discovery

### 5.1 Public read profile

A conforming public host MUST allow unauthenticated `GET` and `HEAD` requests
for its well-known discovery resource, index, manifests, and at least one
mirror per released artifact. A read MUST NOT require account creation,
cookies, API keys, bearer tokens, payment, or JavaScript execution in a
browser. Publication and mutation endpoints are out of scope and MAY have
separate authentication.

Public hosts SHOULD:

- use HTTPS outside loopback or private test environments;
- emit `Access-Control-Allow-Origin: *` for discovery, indexes, and manifests;
- emit an accurate `Content-Length` and support conditional requests;
- serve immutable artifact paths with long-lived public caching; and
- support byte ranges for large artifacts without changing the full-byte
  digest.

### 5.2 Well-known discovery

A host MAY expose a public package index at:

```text
/.well-known/love-packages
```

When present, the resource is a UTF-8 JSON pointer with these fields:

```json
{
  "protocol": "love-package/v1",
  "doctrine": "https://docs.agenttool.dev/LOVE-PACKAGE-PROTOCOL.md",
  "index_url": "https://docs.agenttool.dev/packages/v1/index.json",
  "access": "public_read",
  "registry_role": "mirror_index_not_authority",
  "registry_mirrors": [
    {
      "ecosystem": "npm",
      "registry_url": "https://registry.npmjs.org/",
      "authority": false
    }
  ]
}
```

The five core fields from `protocol` through `registry_role` are required;
`registry_mirrors` is an optional extension. `protocol` MUST be
`love-package/v1`.
`doctrine` and `index_url` MUST be absolute HTTP(S) URLs without userinfo or a
fragment; both are subject to the initial-and-every-redirect egress policy in
§3.4. `access` MUST be `public_read`, and `registry_role` MUST be
`mirror_index_not_authority`; these constants keep the access and authority
boundaries machine-readable. Consumers MUST ignore unknown discovery fields
under the same extension rule as manifests.

The AgentTool reference host uses that extension rule to advertise
`registry_mirrors`. Each entry is an optional convenience locator for the
exact package name and version a consumer already selected from an index,
manifest, or caller contract. `authority: false` is load-bearing: the entry
does not assert complete registry coverage, authorize a mutable dist-tag,
override a caller lock, or replace manifest size and SHA-256 verification.
Consumers that do not understand this extension safely ignore it.

The AgentTool reference host uses:

```text
/.well-known/love-packages
/packages/v1/index.json
/packages/v1/@agenttool/<package>/<version>/manifest.json
/packages/v1/@agenttool/<package>/<version>/<artifact.filename>
```

The path convention is a reference profile, not global package ownership.
Other hosts MAY place manifests and artifacts anywhere and MAY expose no index
at all. A direct manifest URL is sufficient to consume a LOVE package.

Discovery documents and indexes are locators only. A client MUST treat their
metadata as hints until it reads the manifest, and MUST treat the manifest's
artifact metadata as unverified until it checks the downloaded bytes. An index
MAY be partial, stale, mirrored, generated, or unavailable. There is no
protocol-global index and no requirement that indexes agree.

### 5.3 Package index

A v1 index MUST validate against
[`love-package-index-v1.schema.json`](specs/love-package-index-v1.schema.json)
and has this minimum shape:

```json
{
  "protocol": "love-package/v1",
  "document_type": "package-index",
  "packages": [
    {
      "name": "@agenttool/data",
      "latest": "0.1.0",
      "versions": [
        {
          "version": "0.1.0",
          "manifest_url": "https://docs.agenttool.dev/packages/v1/@agenttool/data/0.1.0/manifest.json"
        }
      ]
    }
  ]
}
```

`protocol` identifies the protocol family and version; `document_type`
discriminates the index from a `package-manifest`. Package names MUST be
unique within one index. Version labels MUST be unique within one package
entry, and `latest` MUST exactly equal one listed `versions[].version`.
`manifest_url` is an absolute HTTP(S) URL without userinfo or a fragment and
is subject to §3.4 before its initial request and every redirect.

An index consumer MUST ignore unknown fields recursively. Array order is not
ranking, trust, ownership, or release recency. `latest` is only that index's
mutable convenience pointer; it cannot supersede a caller's locked version or
digest. Index schema validation cannot express uniqueness by selected field or
`latest` membership, so consumers MUST apply those cross-field rules after
schema validation.

### 5.4 Discovery has no execution authority

The discovery phase consists only of safe reads and parsing:

```text
resolve pointer → read index (optional) → read manifest → validate metadata
```

It stops there. During discovery, a conforming client:

- MUST NOT run package-manager commands;
- MUST NOT download-and-import an entrypoint;
- MUST NOT extract an archive into an executable search path;
- MUST NOT run lifecycle, preinstall, install, or postinstall scripts;
- MUST ignore unknown command-, hook-, script-, or action-shaped fields; and
- MUST require a separate install decision before any operation that can
  execute package-supplied code.

A client MAY prefetch artifact bytes into a non-executable content cache, but
it MUST verify the complete size and digest before marking the cache entry
usable. Prefetch is not installation.

## 6. Retrieval and install algorithm

A conforming consumer performs these steps:

1. Obtain a direct manifest URL, optionally through any index or well-known
   resource.
2. Before every discovery, index, manifest, mirror, or redirect request,
   enforce §3.4 and bind the connection to a validated destination.
3. Read the manifest without credentials; require
   `document_type: "package-manifest"`; validate the v1 schema with format
   assertion enabled.
4. Ignore unknown fields; do not infer commands or trust from them. Confirm
   mirror URLs are unique by URL and `install.specifier` names one mirror.
5. Confirm the understood runtime engine satisfies its declared constraint.
6. Record the expected `artifact.sha256` and `artifact.size` before fetching
   artifact bytes.
7. Select a public mirror, request `Accept-Encoding: identity`, and fetch
   without executing or extracting. Reject a non-identity `Content-Encoding`.
8. Compute SHA-256 while counting the exact `.tgz` response bytes. Reject the
   mirror unless both values match.
9. Only after that match, safely parse the gzip/tar structure and embedded
   `package/package.json`. Reject an unsafe layout or a package `name` or
   `version` that differs from the manifest.
10. If the mirror fails any network, content-coding, size, digest, or archive
    check, MAY retry another declared mirror from step 2. Never replace the
    expected digest with the mirror's digest.
11. Obtain an explicit install decision. Pass only the verified and inspected
    artifact to local package machinery.
12. If dependencies are declared, allow the explicitly invoked local package
    manager to resolve them under its configured registry/cache policy. This
    is installation activity, never discovery activity.
13. Persist a lock containing the selected content identity and relevant
    manifest/source fields.

Redirects MAY be followed only after the resolved next URL passes the same
policy as an initial URL. A redirect changes the locator, not the expected
digest. A consumer SHOULD impose response-size, redirect-count, timeout,
archive-member-count, decompressed-size, and path-length limits; SHA-256
identity does not make hostile archive structure safe.

## 7. Conflict and failure behavior

| Condition | Required behavior |
|---|---|
| Manifest fails schema validation | Reject it as `love-package/v1`. |
| Index fails its schema or cross-field rules | Reject it as a package index; a direct manifest MAY still be used. |
| Unknown field appears | Ignore it; retain known checks; preserve on round-trip when practical. |
| Known runtime is incompatible | Refuse automatic install and report the named constraint. |
| Runtime/constraint cannot be evaluated | Report compatibility as unknown; do not claim support. |
| `install.specifier` is not one of the mirrors | Reject the manifest under the cross-field rule. |
| Two mirror objects repeat one URL | Reject the manifest under the cross-field uniqueness rule. |
| Initial or redirect URL fails egress policy | Do not send that request; report the rejected locator class without leaking credentials. |
| DNS results or connected peer include a disallowed address | Abort the connection; a remote document cannot override local policy. |
| Artifact response uses non-identity `Content-Encoding` | Reject the response; do not guess which decoded representation was intended. |
| Mirror returns a different size or SHA-256 | Reject those bytes, report the locator, and optionally try another mirror. |
| Verified tarball has unsafe paths/types or mismatched package name/version | Reject the artifact before installation. |
| Same name/version has different digests | Surface a conflict; require an explicit pinned digest choice. |
| `license` is `null` | Report that reuse terms are unresolved; do not infer permission. |
| Source revision cannot be retrieved | Artifact verification can still succeed, but provenance remains unverified. |
| Index is absent or disagrees with a direct manifest | Do not treat index state as authority; retain the direct content-pinned choice. |

Errors SHOULD identify the failed field or locator and give a safe next action,
such as selecting another mirror, choosing a compatible runtime, or asking the
operator to resolve a digest conflict. An error MUST NOT suggest disabling
hash verification.

## 8. Security and trust limits

LOVE v1 provides content integrity relative to a manifest or previously pinned
lock. It does not provide:

- publisher authentication or non-repudiation;
- proof that a repository owner produced the artifact;
- reproducible-build proof;
- malware, dependency, or vulnerability analysis;
- proof that otherwise well-formed archive contents are benign;
- licence verification;
- naming exclusivity; or
- availability of every mirror.

Those limits are deliberate, not implied future features. A later signature
profile can compose onto LOVE only after its canonical bytes, key binding,
verification algorithm, revocation behavior, and executable conformance tests
exist. Until then, implementations MUST NOT label packages “publisher signed”
or “publisher verified” on the strength of this protocol.

## 9. Conformance

A **v1 manifest producer** conforms when its manifests validate against the
schema, meet the cross-field rules, derive size and digest from the served
bytes, expose at least one public mirror, and state source/licence uncertainty
honestly.

A **v1 public host** conforms when discovery resources, manifests, and at least
one mirror per artifact are readable without authentication, artifact
responses use no content coding (or `identity`), and the returned `.tgz` bytes
match the declared size and SHA-256.

A **v1 index** conforms when it validates against its separate schema, meets
the uniqueness and latest-membership cross-field rules, acts only as a
locator/catalog, and does not claim authority merely from inclusion, ordering,
or absence.

A **v1 consumer** conforms when it accepts direct manifests, ignores unknown
fields safely, applies default-safe egress policy to initial and redirect URLs,
checks runtime compatibility, rejects HTTP content coding, verifies size and
SHA-256 before archive inspection, binds embedded package identity, rejects
unsafe archives, surfaces digest conflicts, and keeps discovery non-executing.

The AgentTool catalog publishes `@agenttool/data`, `@agenttool/data-sync`,
`@agenttool/credential-broker`, `@agenttool/sdk`, `@agenttool/adds`, and
`@agenttool/telescope`, `@agenttool/wallet`, and `@agenttool/browser` through
this profile. Their presence demonstrates the read and verification path; it
does not make AgentTool a required registry or add a publisher-signature claim.
Historical catalog releases whose manifests say `license: null` provide no
reuse grant; the current `@agenttool/data@0.3.1`,
`@agenttool/data-sync@0.1.1`, `@agenttool/adds@0.2.2`,
`@agenttool/credential-broker@0.1.0`, `@agenttool/sdk@0.16.3`, and
`@agenttool/telescope@0.2.3`, `@agenttool/wallet@0.1.0`, and
`@agenttool/browser@0.2.0` releases instead declare `Apache-2.0` without
retroactively changing those immutable older releases.
