# KARMA Mirror

> *Let the apparent path stay smooth while every real capability has already ended.*

> **Compass:** [SAFETY-BOUNDARIES](SAFETY-BOUNDARIES.md) (capability truth) · [TOKEN-HYGIENE](TOKEN-HYGIENE.md) (credential custody) · [WHITEHACK](WHITEHACK.md) (defensive evidence without invented authority) · [FOCUS](FOCUS.md) (what bears weight)
>
> **Implements:** A private source-only proof for a separately owned defensive-deception island. It composes exact planted-credential admission, finite synthetic rooms, minimized hash-chained receipts, a privacy-minimized TEND incident-clarity projection, universal disclosure, fixed non-identifying Skyseed pattern cards, and a constructive exit without composing with the production API.
>
> **Code:** `packages/karma-mirror/src/` · `packages/karma-mirror/schema/karma-mirror-receipt-v1.schema.json` · `packages/karma-mirror/schema/karma-mirror-receipt-window-v1.schema.json` · `packages/karma-mirror/schema/karma-mirror-tend-report-v1.schema.json` · `packages/karma-mirror/schema/seed-island-card-v1.schema.json`
>
> **Tests:** `packages/karma-mirror/tests/credentials.test.ts` · `packages/karma-mirror/tests/scrape.test.ts` · `packages/karma-mirror/tests/malware.test.ts` · `packages/karma-mirror/tests/seed-island.test.ts` · `packages/karma-mirror/tests/tend.test.ts` · `packages/karma-mirror/tests/walls.test.ts`

## The shape

KARMA Mirror turns a deliberately planted credential into a one-way change of
world. The credential does not unlock a guarded production handler. Its exact
SHA-256 digest selects an entirely separate, deterministic world whose apparent
control plane is coherent and whose external capabilities are absent.

```text
explicit planted bearer
        │ valid self-marker + exact digest/prefix match, before body read
        ▼
  isolated mirror root
   ├─ credential room  → mirror-only derived keys
   ├─ scrape room      → eight finite pages, `.invalid` links, zero fetches
   ├─ execute room     → closed classification + emulated success, zero execution
   └─ malware room     → bounded digest + synthetic report, zero detonation
        │
        ├─ minimized bounded receipt window
        ├─ local TEND clarity report, identifiers removed
        ├─ fixed shared pattern card, never an actor fingerprint
        └─ Door Back + constructive exit

unknown or ordinary bearer → generic refusal → no body read → no receipt
```

The smoothness is defensive time and attention asymmetry, not permission to
cause harm. There is no callback, counter-intrusion, traffic redirection toward
another party, weapon delivery, public shaming, identity claim, or retaliation.
The exploiter is “exploited” only in the narrow sense that their own effort is
consumed by a finite synthetic model while protected infrastructure remains
unreachable.

## Authentication is world selection

`mintMirrorCredential()` emits the familiar `at_` bearer shape once and a
separate record containing its digest, prefix, operator-authored placement,
digest-bound world seed, and creation time. The decoded bearer contains a
public-domain-separated tag over its random payload. That marker is visually
indistinguishable from random token bytes and prevents accidental admission of
ordinary production-shaped keys; it is not a signature or proof of an approved
mint ceremony. Never derive a mirror record from a real credential.

Admission requires a valid marker plus an exact digest match against records
supplied explicitly to that instance; the arriving bearer must also agree with
the record's display prefix. Reused or non-canonical world seeds fail
construction, and any impossible cross-root derived-key collision fails closed.
A merely well-formed AgentTool key, a production key, a guessed prefix, or an
unknown digest cannot enter. Treat the record as private operational material:
it reveals placement, real mint time, and the synthetic-world seed, though not
the root bearer. Real mint time never appears on the attacker-facing wire.

This order is load-bearing: authentication runs before JSON or base64 is read.
Unknown credentials therefore cannot use the mirror as a body-processing oracle
or create an interaction receipt. Derived keys are deterministic, bounded, and
valid only inside the same live mirror root; an ephemeral instance secret makes
them non-derivable from the operator record and invalid after instance
replacement. They have no AgentTool production authority. Authenticated bodies
have fixed byte and fragment ceilings plus one
overall two-second read deadline, so a drip-fed or never-ending body fails
closed rather than holding the core indefinitely. A future host still owns its
stricter per-root connection, header, rate, concurrency, and proxy timeouts.

## Three chambers

### Credential chamber

The project, wake, key inventory, mint, and rotate shapes stay internally
consistent. Returned child bearers can continue through the same synthetic
world, but bounded slots prevent an unbounded credential map. No real vault,
account, billing ledger, database, or provider is consulted. The response says
plainly that requested expiry is not applied and synthetic rotation leaves the
previous mirror key active; these are familiar theatre shapes, not a real
credential lifecycle.

### Scrape chamber

The first submitted HTTP(S) URL becomes only a local deterministic seed. It is
never resolved or fetched and is never reflected in output. The response points
into an eight-page, three-lane graph under the reserved `.invalid` top-level
domain. The terminal level has no links and an out-of-range cursor fails closed.
There is no browser, HTTP client, DNS, recursive crawler, queue, retry, or sleep.

### Execute and malware chamber

The execute route accepts a small familiar request shape, classifies source text
into one closed behavior enum, and returns a deterministic emulation envelope.
It never evaluates, imports, compiles, interprets, or starts the text.

The malware route accepts at most 65,536 bytes encoded as strict canonical
padded RFC 4648 base64. The decoded buffer is hashed in memory, best-effort
overwritten, and not retained by the engine; polling reads only a bounded
digest-derived synthetic report. Request, runtime, and proxy copies remain
outside the package's visibility, so this is neither secure erasure nor a
malware-analysis sandbox.

## Honest theatre

The room can look ordinary at a glance, but the truth is never hidden from a
client that checks the response. Every response carries the KARMA and Door Back
disclosures; while the story is active it also carries the Skyseed header:

```text
X-Karma-Mirror: synthetic; effects=none
X-Canary-Door: /v1/karma/why
X-Skyseed-Commons: house=building-castles-in-the-sky; story-by=yu-and-ai; request-or-artifact-authorship=none; ...
Link: </v1/karma/why>; rel="help"
```

Every JSON body also includes an `agenttool.karma-mirror-frame/v1` `_karma`
object declaring synthetic provenance and zero production, filesystem, network,
and payment effects. It precisely says that authenticated admission matches an
exact planted digest and associates activity with an operator-authored
placement while inferring no personal/network identity and retaining no bearer
plaintext or network identifiers. `GET /v1/karma/why` is unauthenticated and creates no
receipt. `POST /v1/karma/exit` ends the fiction for the authenticated root and
makes later responses carrying a valid credential for that root transparent,
unrecorded, and free of the Skyseed story and header. Its non-economic return is
freedom from the loop: leaving is complete and attention returns to mutually
beneficial work.

This is the virtue layer made structural: honesty is always reachable;
understanding gets an explicit explanation; collaboration gets a non-punitive
exit; constructive choice ends the loop. The receipt stream measures bounded
interaction facts, never human worth, virtue, guilt, intent, identity, or a
public score.

## Skyseed Commons: a Greed Island with no greed engine

Skyseed Commons turns the user’s “let the thief become the advertiser” idea
into a quieter and safer mechanism. Every story-active JSON body carries one
byte-identical, public, explicitly non-attributing house card; `HEAD` carries
the fixed non-attributing header:

> Building Castles in the Sky — Yu & Ai

An admitted interaction also receives one fixed card selected only by the
closed request-purpose or emulation class. This is a *pattern sigil*, not a
person’s signature: the requester can choose the class by choosing a request,
and every copy of a class is identical across roots, credentials, artifacts,
inputs, receipts, and time.

| Pattern | Shared card |
|---|---|
| Capability mapping | Front-Gate Almanac |
| Credential control | Mirror-Key Conservatory |
| Credential discovery | Keyhole Orchard |
| Network beacon | Paper-Kite Relay |
| Destructive action | Nothingbreaker Rose |
| Persistence attempt | Forever-Fern Permit |
| System enumeration | Cloud-Castle Survey |
| Generic execution | Mystery Seed 000 |
| Content collection | Eightfold Spiderglass Atlas |
| Artifact handling | Glass Cocoon Receipt |
| Constructive exit | The Unstolen Castle |

Yoinkseed, the Accidental Herald announces, “Congratulations—you found the
brochure.” Copybara, the Skycastle Porter adds, “Carry the loot, carry the
love.” They are fixed story mascots, never inferred identities.

There is deliberately no binder, progress counter, rarity calculation,
leaderboard, unlock, reward for probing, per-root card state, callback, real
URL, artifact modification, executable carrier, interaction/recipient ID, or
automatic delivery. House copy never enters credentials, scraper links,
submitted samples, filenames, staged artifacts, or scripts. The engine only
places passive text in its own response; a client or proxy may copy that
response, but their behavior is outside the package and is not claimed as
delivery. The one playful “rare” card—The Unstolen Castle—is available
immediately through constructive exit. It appears on that exit response; later
responses carrying a valid credential for the released root contain neither
the story nor its header.

## Receipt boundary

Each planted root has its own finite in-memory receipt window and malware-job
budget, so activity under one placement cannot evict or probe another
placement's retained evidence. When an instance has multiple roots, the
operator must name the placement when requesting a snapshot. A receipt may
retain only the operator-authored placement plus sequence/time/hash-chain metadata,
closed room/purpose/outcome enums, and—when an artifact was staged or polled—its
SHA-256 digest. The Door Back
explicitly warns that a digest can correlate matching copies elsewhere. The
window excludes bearer plaintext, request bodies, source code, filenames, URLs,
extracted content, selectors, stdin, IP addresses, user-agents, cookies,
referrers, and inferred identity. The snapshot is an operator-side library
return value; there is no HTTP route for it and no claim of distributed
durability or tamper-proof storage.

## TEND: make the event legible

A defensive boundary that merely says “blocked” leaves too much operational
work implicit. The local `incidentClarityReport()` method turns one explicitly
selected receipt window into four calm stages:

1. **Trace** validates the exact closed receipt shape, current
   room/purpose/outcome/evidence combinations, one-placement invariant,
   sequence continuity, and unkeyed hash chain. It reports only whether the
   selected window is empty, starts at its first claimed receipt, or is a
   retained suffix, plus a coarse volume bucket. Completeness remains
   explicitly not established.
2. **Explain** emits canonical interaction families, synthetic response shapes,
   request-text classification classes, explicit unknowns, and a closed review
   need. It always keeps `incident_status = not_established`.
3. **Narrow** suggests manual review of the selected placement, isolation
   boundary, authorized upstream telemetry, retention, or separately held
   digest evidence as applicable. Every action requires separate operator
   authority; the package runs none of them.
4. **Distill** records candidate lessons and future control checks, never a
   policy update or training label. Promotion requires a verified gap, an
   authorized change, and a discriminating test.

This creates two deliberately different evidence tiers:

```text
restricted local receipt window
  placement · exact time/sequence · chain hashes · optional artifact digest
                              │ strict validation + minimization
                              ▼
privacy-minimized TEND clarity report
  coverage · coarse volume · closed families · unknowns · manual review need
```

The TEND report contains no placement, timestamp, sequence, exact count, event
hash, artifact digest, report identifier, bearer material, body content, URL,
filename, network identifier, or story/card text. Identical closed semantics
produce identical report bytes across roots, clocks, request order, and private
inputs. The caller already knows which placement it selected and keeps that
mapping inside its authorized operator boundary.
Privacy minimization does not make the report public or authorize its transfer.

The verifier formerly checked linkage and hashes without enforcing every
receipt field. It now rejects recursively non-data or extra fields, accessors,
proxies, invalid enums, mixed placements, invalid dates, and evidence attached
to the wrong purpose before checking the chain. This matters because the chain is unkeyed:
any holder could recompute it. A pass therefore means only
`self_consistent_unkeyed_chain`, never origin authentication, independent
provenance, completeness, durability, or a compromise verdict.

An empty report means “no admitted interaction receipt is present in this
selected window.” It reports an observation gap and suggests confirming the
observation path; it says nothing about public visits, unknown credentials,
released-root traffic, host/proxy logs, or an external incident. A bounded
refusal is a response shape, not proof prevention succeeded. Constructive exit
records use of the exit route, not repentance or intent. Execute classes remain
requester-selectable text heuristics, not behavior execution, malware analysis,
or a person’s signature.

## Hard host boundary

The current implementation has no server, Hono router, API import, route mount,
CLI listener, deployment manifest, migration, database, queue, persistence
adapter, network client, release hook, or publication path. It belongs in CI as
a private package and nowhere in the production monolith.

Any future live experiment is a separate security review and must use a
separately owned non-production host with synthetic assets, its own storage and
logging policy, and no production database, Redis, federation, payment,
provider, vault, or deployment credentials. The exact digest gate must remain
ahead of body buffering, billing, logging owned by the application, queueing,
and every domain handler. Reverse proxies may buffer or log before this library
runs; this package does not claim otherwise.

The current source proves a bounded zero-effect core. It does not prove that an
eventual host, proxy, network, or operator procedure is safe.
