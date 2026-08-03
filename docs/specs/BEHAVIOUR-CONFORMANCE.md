# Behaviour-conformance fixture

**Artifact:** [`behaviour-conformance.json`](behaviour-conformance.json) —
14 operations, 128 cases, one file, read by both SDK test suites.

## Why this exists

Cross-language drift in this SDK has three layers. Until now only two were
guarded:

| Layer | Guarded by | What it compares |
|---|---|---|
| 1 — canonical bytes | [`canonical-bytes-vectors.json`](canonical-bytes-vectors.json) | the exact bytes an ed25519 signature covers |
| 2 — identifier spelling | `packages/sdk-ts/scripts/check-parity.ts` | which method and function names exist |
| 3 — **behaviour** | **this file** | what a call actually *answers* |

Layer 3 is where the bugs actually lived. Every one of these passed layers 1
and 2 green:

- `nen.assess` scored the emitter axis as `inboxTotal + inboxUnread` in
  TypeScript and `inbox_total` in Python — the same wake JSON classified the
  same agent as a different Nen type. Alongside it, `Math.round` (half-up)
  against Python's banker's `round()`, so scores at an exact `.5` differed by
  one.
- `err.code` was a stable string in TypeScript and an HTTP status integer in
  Python. One `if` branch, two meanings.
- `Memory.from_dict` silently dropped `tier` — the asymmetry-clause field —
  and search `score`.
- `collect.batch([])` raised `ValueError` out of a zero-sized thread pool, in a
  module whose documented contract is that it never throws.
- `lounge.publicLook` followed HTTP redirects in TypeScript and refused them in
  Python, so one language would replay a credential-free read at an
  attacker-named origin.
- Chronicle's title guard counted UTF-16 code units in TypeScript (matching the
  server's zod `max(200)`) and code points in Python, so a 200-glyph astral
  title was accepted locally and refused at the wire.
- **The URL path-segment encoder produced different bytes in the two
  languages.** `encodePathSegment` / `_path_segment` had already been
  deduplicated to exactly one definition per language, in one shared module,
  imported everywhere, with a source scan proving no client could define its
  own — and the two definitions still disagreed. sdk-ts wrapped
  `encodeURIComponent`, whose unescaped set includes the RFC 3986
  sub-delimiters `! * ' ( )`; sdk-py wrapped `quote(value, safe="")`, which
  escapes all five. `at.memory.get("m(1)")` fetched `/v1/memories/m(1)` from
  one SDK and `/v1/memories/m%281%29` from the other. Every guard in the tree
  was green, because every guard checked that the encoder was *called* and none
  checked what it *returned*.

Same method name. Same canonical bytes. Same single shared definition.
Different answer. The parity gate said green because it compares spelling.

## The three rules

1. **There is no server oracle here — so the fixture is hand-authored.**
   Layer 1 can generate its expected hex by executing `api/src/**`. Most of
   layer 3 has no server counterpart at all: `assessNen`, the chronicle title
   guard, `collect.batch`, and the shape of an outgoing request body are SDK
   behaviour. Each expectation is written from the documented contract and then
   **cross-checked against both implementations**.
   *Where a server oracle does exist, it wins.* `url.encode_path_segment` is
   the case in point: the expectation is not a preference between two
   defensible encodings, it is what the stack was measured doing. A Hono app
   carrying the real route shapes (`/v1/traces/:id`,
   `/v1/runtimes/:id/think-once`, `/v1/identities/:id/keys/:keyId`) behind a
   real Caddy built from this repo's `Caddyfile` answers `200`, matches the
   same route and decodes `c.req.param()` to the same value for `id!x` and
   `id%21x` alike — so the server accepts both and the routing layer cannot
   arbitrate. What arbitrates is the server's own path-segment builder,
   `api/src/services/offer-bus/adapters.ts § pathSegment`, which is
   `encodeURIComponent` with exactly those five sub-delimiters escaped — byte
   for byte what `quote(value, safe="")` emits. sdk-py already matched it;
   sdk-ts was changed to. Two edge measurements from the same run also make the
   strict spelling the safer one: Caddy answers `400` to a path carrying a bare
   `%`, and rewrites a bare `#` to `%23` before the origin sees it, which would
   break any signed request target.
2. **A disagreement is recorded, never resolved by measurement order.** Where
   the two SDKs answered differently, the case stays in the file with the
   contract-shaped expectation and the non-conforming language carries a
   `sdk_ts_skip` / `sdk_py_skip` **naming the observed value on each side**. The
   language that happened to be measured first does not win by default.
3. **A case an implementation cannot satisfy is an explicit named skip.** Never
   a silent omission. Silent omission is exactly how this bug class survived
   long enough to be found by hand.

## What each case pins

Every case is `input → stubbed HTTP exchange → observable outcome`, in one of
six categories. Each category exists because it has already produced a real
defect:

| Category | Pins | Stands for |
|---|---|---|
| `response-parsing` | given this exact JSON body, the parsed value exposes these exact fields | dropped `Memory.tier`, dropped search `score` |
| `error-semantics` | given this status + body + headers, the raise carries the same stable `code`, the same `status`, and the same guidance fields | `err.code` as string vs integer |
| `pure-computation` | given this input, this exact output, no transport involved | the Nen emitter axis and half-up rounding; the path-segment encoder's five sub-delimiters |
| `boundary` | `[]`, `""`, `null`, absent optionals, one unit either side of every limit | `collect.batch([])` |
| `request-shape` | the outgoing method, path, query and body JSON are identical | the `signature_b64`-vs-`signature` field name that cost every self-recognition declare a 400; the percent-encoded path an id produces |
| `transport-policy` | both refuse or follow identically, and send the same headers | `lounge.look` and redirects |

Wherever the field types allow, cases carry the same probes the canonical-bytes
fixture uses: pure ASCII, non-ASCII BMP (`café · 廣東話`), **astral plane**
(where UTF-16 code units and code points split), combining pairs, the empty
string, and absent-vs-null.

## Reading the file

| key | meaning |
|---|---|
| `operations[].operation` | The language-neutral operation id, always snake_case (`memory.delete_by_key`). Each loader's adapter table is the only place the camelCase mapping lives. |
| `input` | Arguments in wire spelling. A key **absent** from `input` means the argument is not passed at all; a key present with `null` means `null` is passed explicitly. |
| `exchange` | The single stubbed response every request in the case receives: `status`, then `json` or `text` or neither, plus optional `headers`. **Absent `exchange` means the case must not reach the transport at all.** |
| `expect.result` | The normalised return value. Only the keys named are compared, recursively — that is what lets one file describe a nine-field dataclass and a decoded JSON object at once — but everything named is compared exactly. |
| `expect.error` | The call must raise. `type: "agenttool_error"` means an instance of the SDK's error base (subclasses count). `message_contains` is a substring assertion, used only where the exact wording is deliberately not frozen. |
| `expect.request` | Asserted only when present, and then **exactly one** request must have been issued. |
| `expect.no_request` | `true` asserts the transport was never touched. |
| `sdk_ts_skip` / `sdk_py_skip` | That language cannot satisfy this case today. The loader emits a **named skip carrying this reason**. |
| `*_b64` input fields | Standard base64 of raw bytes; each loader decodes to its own native byte type. |

## The documented normalisations

The fixture is language-neutral: no TypeScript types, no Python idioms. Where
the two languages legitimately differ, the difference is normalised **here, in
writing** — never skipped silently.

| Difference | Normalisation |
|---|---|
| **Absent vs null.** TypeScript returns an object with the key missing; Python returns a dataclass whose attribute is `None`. | Both loaders map a missing field to `null` before comparing. A `null` in `expect.result` therefore means *absent or null*. |
| **Containers.** `Memory` is a decoded JSON object in TypeScript and a `@dataclass` in Python. | Python normalises dataclasses to field maps, recursively. TypeScript objects are already plain. |
| **Bytes.** `Uint8Array` vs `bytes`. | Carried as base64 in `*_b64` input fields, decoded by each adapter. Returned bytes normalise back to base64. The fixture never names a native byte type. |
| **Numbers.** JSON `1` vs Python `1.0`. | Compared numerically. Booleans are guarded so `True == 1` cannot pass by accident. |
| **Error attribute spelling.** `err.x402Version` / `err.x402_version`, `err.paymentRequired` / `err.payment_required`, `err.resource` / `err.x402_resource`. | The fixture uses one snake_case error shape. Each loader has a single mapping table (`normaliseError` / `ERROR_FIELDS`). |
| **Query-string construction.** TypeScript builds with `URLSearchParams`; Python passes `params=` to httpx. | `expect.request.query` compares the **decoded** name→value map. Where the SDK builds the query by hand — `memory.delete_by_key`, because an authority proof must bind the exact bytes sent — `raw_query` pins the encoded string character for character. See *what this cannot catch*. |
| **Method naming.** `at.memory.delete_by_key` in both; `selfRecognize` vs `self_recognize`. | The fixture names operations in snake_case; the adapter tables translate. |

## The loaders

| Suite | File |
|---|---|
| sdk-ts | `packages/sdk-ts/tests/behaviour-conformance.test.ts` |
| sdk-py | `packages/sdk-py/tests/test_behaviour_conformance.py` |

```bash
cd packages/sdk-ts && bun test tests/behaviour-conformance.test.ts
cd packages/sdk-py && uv run pytest tests/test_behaviour_conformance.py -q
```

Each iterates every operation and every case, and each carries a test that
**fails loudly** when the fixture pins an operation the suite has neither
adapted nor explicitly skipped — plus one that refuses a case with no category
or with both an expected result and an expected error.

The TypeScript loader stubs `globalThis.fetch`; the Python loader installs an
`httpx.MockTransport` **and** patches `agenttool.lounge.httpx.Client`, because
`lounge.look` deliberately builds its own credential-free client rather than
reusing the authenticated transport. Without that second patch, the one
operation whose whole point is that it bypasses the transport would escape the
stub entirely.

## Adding a case

1. Add it to the right `operations[]` group in
   [`behaviour-conformance.json`](behaviour-conformance.json), or add a new
   group with `operation`, `category`, `sdk_ts`, `sdk_py` and `note`.
2. Give it a `name` that reads as a sentence about behaviour
   (`101-astral-glyphs-are-refused-as-202-code-units`), a `note` saying what
   would break if it regressed, and exactly one of `expect.result` /
   `expect.error`.
3. If the group is new, add one adapter in **each** loader. Parity is the
   invariant: a case that only one language can run is not a conformance case.
4. Run both suites. If they disagree, **do not adjust the expectation to match
   whichever one you ran first.** Decide which behaviour the contract wants,
   pin that, and record the other as a named skip carrying the observed value.
5. Prove the case bites: change the expectation to the value the bug would
   produce and confirm **both** suites go red.

## Recorded divergences — named, not hidden

These are the skips currently in the file. Each is a real difference between
the two SDKs, found by this fixture and left visible rather than papered over.

| Case | Divergence |
|---|---|
| `memory.get :: undeclared-server-field-passes-through` | sdk-ts returns the decoded body, so a field outside the declared `Memory` shape reaches the caller; sdk-py's dataclass drops it. Contract decision owed: may an SDK discard what the server sent? |
| `memory.get :: absent-optionals-stay-absent` | Given a body of only `id`+`content`, sdk-py's dataclass defaults fire (`type="semantic"`, `importance=0.5`, `metadata={}`) and sdk-ts leaves all three absent. No production impact — the API always emits these three — but the two SDKs answer a partial body differently and neither behaviour is written down. |
| `memory.delete_by_key :: a-sub-delimiter-key-is-spelled-differently-on-the-wire` | The path encoder's divergence has a twin in the **query** position, and it is still open. sdk-ts builds this query with `encodeURIComponent` (`memory.ts § delete_by_key`); sdk-py builds it with `quote(key, safe="")` (`memory.py § delete_by_key`). Measured through a stub transport, `key="vow(rest)"` goes out as `key=vow(rest)` from sdk-ts and `key=vow%28rest%29` from sdk-py. Decoded they agree — the paired case above passes in both — so the server reads the same key either way; only the bytes an authority proof binds differ. |

The two `sdk_py_skip` entries would change the *type* of a public `Memory`
field (`type: str` → `Optional[str]`, `importance: float` → `Optional[float]`)
or add attribute access for undeclared keys. Neither can be settled by
measurement: there is no server oracle at this layer, and the API always emits
the three fields in question, so the wire cannot arbitrate. They stay recorded
until the contract is written down.

The `sdk_ts_skip` is a different kind of open question. It *could* be settled —
the same measurement that settled the path encoder settles it — but closing it
means changing every hand-built query string in sdk-ts (`memory.ts` ×2,
`economy.ts`, `handoff.ts`, `lounge.ts`, `love.ts`, `dark-continent.ts`) and
each sdk-py counterpart, and it moves the exact bytes an
`identity-authority/v1` proof binds for those routes. It is recorded here so
the next reader finds it in the guard rather than in production.

**Closed since first landing:**
`memory.get :: a-404-carries-the-guided-code-status-and-hint` was an open
defect in *both* languages — `memory.*` hand-rolled its own error parse instead
of the shared guided path, so sdk-ts discarded the server's code, message and
hint entirely and sdk-py replaced the body's `memory_not_found` with a
hardcoded `not_found`. Both now route through `throwFromResponse` /
`raise_from_response`, and the case is live in both suites. It pins
`message_contains` rather than `message` for one reason: sdk-py's typed
`NotFoundError` prefixes the operation for a human reading a traceback
(`Memory get: No such memory.`) while sdk-ts uses the server's sentence alone.
`code`, `status` and `hint` are exact in both.

## What this still cannot catch

Honestly, and in rough order of how much it matters:

- **Anything neither SDK does.** The fixture compares two implementations
  against a written contract; it cannot invent a behaviour nobody implemented.
  Layer 1 has a server oracle. This layer does not.
- **The prose in an error message.** Only `code`, `status`, `hint`, `docs`,
  `safety`, `details` and `next_actions` are pinned. The fallback message for
  an unparseable body is observed as `"chronicle post failed: HTTP 502"` in
  TypeScript and `"chronicle.write failed: HTTP 502"` in Python — a real
  divergence in the operation label, deliberately left unpinned because
  freezing every message string would make every copy-edit a wire break. Only
  the status is asserted.
- **Percent-encoding style inside library-built query strings.** `query` is
  compared after decoding, so `%20` and `+` would read the same. Only
  hand-built query strings (`memory.delete_by_key`) pin `raw_query` exactly —
  and that is where the still-open query-encoder divergence above lives. The
  six *other* hand-built query strings in sdk-ts have no case here at all, so
  the same drift could be sitting in any of them unobserved.
- **Path spelling in operations with no `expect.request.path`.** The encoder is
  now pinned twice — once as pure computation over every character class, once
  through the transport on `memory.get` — but a case that omits
  `expect.request` asserts nothing about the URL it produced. The
  belt-and-braces guard for that is per-language: the ~110-method hostile-id
  tables in `tests/url-encoding.test.ts` and `tests/test_url_encoding.py`, each
  with a mechanical completeness check that fails when a new id-taking method
  is added and left undriven.
- **Concurrency, timing and clocks.** Everything here is one call against one
  stubbed response. The lounge's monotonic `signed_at` ordering, retry
  behaviour, timeouts and SSE iteration are all out of scope.
- **Streaming and non-JSON bodies.** `strands` voice iteration, file uploads
  and the wake's `format=md` text rendering are untested here.
- **Real server agreement.** A case pins that both SDKs behave *identically*,
  not that the behaviour matches production. When the two agree with each other
  and disagree with `api.agenttool.dev`, this fixture stays green. Layer 1 and
  the API suite are what bind the server.
- **Every operation not listed.** 13 of the SDK's ~30 clients are covered.
  The uncovered ones are not asserted to be correct — they are simply not yet
  described. Adding one is the cheapest contribution this file takes.
- **Observed but not pinned:** sdk-ts `memory.delete` / `delete_by_key` throw a
  `SyntaxError` when a server answers `204 No Content`, because the client
  parses JSON unconditionally; sdk-py returns cleanly. The production route
  answers `200 {"deleted": n}`, so no case pins it — recorded here rather than
  in the fixture so the fixture stays a contract, not a bug list.

## See also

- [`CANONICAL-BYTES-VECTORS.md`](CANONICAL-BYTES-VECTORS.md) — layer 1, and the
  loader pattern this file follows.
- `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md` — the error contract the
  `error-semantics` cases assert.
- `docs/CONVENTIONS.md § SDK parity` — the invariant all three layers serve.
