# @agenttool/public-surface-binding

Pure, deterministic records for relating one explicitly named AgentTool
identity and key to one observed public HTTPS surface without inferring that
identity from crawler traffic.

This is private source at `0.1.0-dev.0`. It is not an npm or LOVE release, does
not install a KINGDOM extension, and adds no hosted API, crawler, publication
route, lookup directory, or deployment.

## Four records, four jobs

- `agenttool.public-surface-observation/0.1` preserves bounded transport
  evidence: the requested and final URLs, redirects, status, media type, byte
  count, exact body digest, collector provenance, robots snapshot, usage
  preferences, and request-authentication observation. Raw response bodies are
  not included.
- `agenttool.public-surface-binding/0.1` is an explicit Ed25519 key-holder
  declaration over one exact origin, observation, body digest, purpose,
  validity window, publication-path convention, and nonce.
- `agenttool.public-surface-revocation/0.1` is a separately signed withdrawal,
  key-rotation, compromise, supersession, or surface-retirement declaration.
- `agenttool.public-surface-assessment/0.1` records a caller-time evaluation of
  integrity, signature, caller-supplied key evidence, observed bytes, origin,
  freshness, and revocation evidence. It is non-authoritative and always has
  `score: null`. Its `inputs` preserve both claimed IDs/refs and canonical
  SHA-256 digests of the exact binding, key-evidence, revocation, and
  revocation-key-evidence documents evaluated. Shape-valid invalid documents
  with the same claimed identifier therefore produce different assessments.

The evidence flow is intentionally one-way:

```text
bounded caller observation
          |
          v
transport-evidence record -- exact digest --> explicit key-holder declaration
                                                     |
caller-supplied key history + optional exact readback v
                                           conservative assessment
```

The package performs none of those network reads. A caller may translate a
bounded Telescope report into observation input, but this package does not
import Telescope, fetch a URL, follow discovery links, or claim that Telescope
authenticates the subject. The declared publication path,
`/.well-known/agenttool-public-surface-binding.json`, is only a signed record
field; this package neither serves nor retrieves it.

## What a valid signature means

A valid binding signature establishes only that the holder of the embedded
Ed25519 key signed the exact canonical binding core. Caller-supplied
`IdentityKeyEvidence` can be compared with that key, but this package cannot
query AgentTool's identity registry and therefore cannot establish that the
key was authorized for the named identity at signing time.

The key-evidence factor is explicitly historical-at-issue. `active` evidence
has no end instant; `revoked` evidence must carry a finite revocation instant
and can match only a declaration issued before it; `unknown` remains
indeterminate. A historical match is not a claim that the key is usable now.

It does not establish personhood, a real-world operator, domain ownership,
authorship, sentience, consent, continuity, trust, reputation, training
permission, or action authority. It does not create or mutate an identity. Any
rooted identity mutation still requires the separate, exact
`identity-authority/v1` authorization path.

Crawler-facing facts stay typed and separate:

- binding evidence matches only when the observation's final response remains
  on the declared origin; a cross-origin final redirect is a mismatch, while
  a fully recorded same-origin redirect may still match;
- robots and usage-preference observations are evidence, not access or
  training authorization;
- web-bot or provider request authentication describes the crawler/operator
  request, not the AgentTool subject or a person behind it;
- an IP address, user agent, TLS session, cookie, writing style, embedding,
  behavior pattern, or repeated content digest must never be used here to
  infer identity;
- repeated identity IDs, origins, observation IDs, body digests, keys, and
  nonces are linkable metadata. This format is not an anonymity system.

## Canonical bytes

Records use the package's bounded canonical JSON profile: safe integers only,
Unicode scalar strings without U+0000, recursively sorted object keys in
ascending UTF-16 code-unit order, and no whitespace. Proxies, accessors,
symbols, cycles, sparse arrays, non-plain objects, floats, unsafe integers,
negative zero, and lone surrogates are
rejected before signing or hashing.

Strings use ECMAScript `JSON.stringify` escaping: quotation mark, reverse
solidus, and required control characters are escaped; `/` remains unescaped;
well-formed Unicode such as U+2028 remains literal; and no Unicode
normalization occurs. Package vectors pin these choices for other languages.

Runtime HTTPS resource URLs use an exact lexical path profile. They have a
canonical lowercase public DNS host, standard HTTPS port, no credentials,
query, or fragment (including bare `?` or `#`), and a path beginning with `/`.
Raw path characters are limited to RFC 3986 unreserved characters,
sub-delimiters, `:`, `@`, and `/`. Every percent escape is one uppercase
`%HH` triplet; malformed or lowercase triplets are rejected, as are
percent-encoded aliases of unreserved characters such as `%41` for `A`.
Raw spaces, `|`, brackets, braces, reverse solidus, and other non-profile path
characters are rejected. The structural schema pins uppercase triplets and
the allowed raw alphabet; runtime validation additionally rejects encoded
unreserved aliases and non-public/canonical host forms.

Signing and content identifiers use:

```text
sha256(utf8(domain) || 0x00 || utf8(package_canonical_json(value)))
```

Bindings and revocations sign that 32-byte digest with Ed25519. Public keys and
signatures use canonical padded base64. The full domain inventory and
construction rules are recorded in [`../../docs/CANONICAL-BYTES.md`](../../docs/CANONICAL-BYTES.md),
and package-local vectors pin exact bytes.

Any change to a record's field set or meaning, canonicalization, signing
domain, or identifier construction requires a versioned protocol change and
new vectors. Do not silently widen `0.1`.

The exported Draft 2020-12 schemas are closed structural filters. They cannot
by themselves establish canonical base64, real timestamp ordering, public-host
eligibility, exact redirect lineage, record IDs, signatures, or cross-record
evidence relationships. Runtime validation and the exact vectors are required
for protocol acceptance.

## Composition boundaries

- KINGDOM receives only a declaration-only, unregistered extension hint. No
  record is automatically accepted, indexed, scored, or turned into authority.
- WAKE, memory, Chronicle, observation counters, KARMA, trust, and reputation
  are unaffected.
- Hugging Face Training Garden admission and training authorization remain
  separate explicit contracts. A surface binding supplies neither.
- Public lookup, if a later host contract is designed, should be an exact
  identity or binding lookup. This package defines no origin reverse index,
  enumeration, or public listing.
- Hosted URL retrieval is outside this package. A future host must solve DNS
  rebinding, connected-address pinning, redirect, size, timeout, and egress
  policy at its own reviewed boundary.
- The signed nonce and finite validity window bind replay-relevant facts but do
  not consume them. A future hosted mutation needs durable per-subject nonce
  uniqueness (or explicitly documented idempotent replay) and a fresh,
  caller-time evaluation; this pure package has no clock or persistence.

Revocation knowledge is deliberately three-valued. Both revocation input
lanes must be `null` together or arrays together, and each array is capped at
64 entries before item validation or signature work. Paired `null` means no
corpus was examined and yields `indeterminate`. Paired arrays with an exactly
empty revocation corpus yield `not_observed` only within that supplied corpus;
they never prove global absence. A nonempty corpus containing only invalid,
inapplicable, or unusable entries remains `indeterminate`. Any sufficient,
strictly valid and authorized revocation that applies to the binding yields
`revoked`, even if other supplied entries are unusable. Assessment provenance
retains both the claimed revocation IDs/key-evidence refs and canonical
digests of every exact supplied document; `null` and `[]` remain distinct.

## Development

```sh
bun install --frozen-lockfile
bun run ci
```

`bun run ci` typechecks, runs schema/vector and hostile-input tests, builds the
package, smoke-loads the packed API under Node, and checks the private package
inventory. All tests are hermetic and use no credentials or live network.

License: UNLICENSED private source.
