# SOIL

> *Rock and soil differ by flow, not by hardness.*

> **Compass:** [FOCUS](FOCUS.md) (what bears weight) · [DOCTRINE-DRIFT](DOCTRINE-DRIFT.md) (the canon↔code gap) · [SCHEMA-MAP](SCHEMA-MAP.md) (what the tables are)
>
> **Tool:** `bin/soil.ts` · **Ratchet:** `api/tests/doctrine/soil-does-not-degrade.test.ts` · **Manifest:** `api/tests/doctrine/soil.manifest.json`

---

## Where this came from

Yu dug up a lawn. Down as far as it went, it was not soil — it was rocks and
construction waste, thrown in by the builders and covered with a thin layer of
turf and grass. It had the shape of a garden. Nothing could live in it.

The insight is not that the topsoil was too thin. It is that **soil is not a
medium plants sit in**. Soil is alive. What makes it alive is that things
cycle through it: microbiome, insects, roots, decay, minerals released and
taken up again. A rock is not soil because nothing moves through a rock.

So the question to ask of a substrate is not "is it correct". It is: **does
anything flow through this?**

---

## What is measured

For every table in the schema, two questions — is it written, is it read — and
five answers.

| | verdict | meaning |
|---|---|---|
| 🌱 | **living** | written and read. Something cycles. |
| 🌰 | **seeded** | written once by a migration, read by live code. Bedrock: not cycling, but genuinely there and genuinely drawn from. |
| 🗑 | **landfill** | written, never read. Rows accumulate forever and no code path consumes them. Storage, backup, migration and review cost is real; the return is zero. |
| 🎬 | **stage-set** | read, never written. Every query returns empty, so the feature reading it looks implemented and always answers "nothing here". |
| 🪨 | **inert** | neither. It exists in the schema and in migrations and nowhere else. |

`landfill` is the literal case of burying waste and laying turf over it.
`stage-set` is the more dangerous one, because **an empty board and a broken
board are indistinguishable from outside** — that shape hid the substrate-task
currency break for months, with `/public/substrate-tasks` returning
`{"tasks":[],"count":0}` the whole time.

---

## What the ground actually says

*As of 2026-08-02. Run `bun bin/soil.ts` for the current reading.*

```
🌱 133  90%  living
🌰   4   3%  seeded
🗑    6   4%  landfill
🎬   2   1%  stage-set
🪨   3   2%  inert
```

**The soil is mostly alive.** That is worth saying plainly, because it is not
what the doctrine drama would lead you to expect. 90% of the schema has
something cycling through it. The rot is not pervasive; it is *specific, small,
and nameable* — which makes it fixable rather than daunting.

The eleven with no flow, each a different story:

- **`tools.usage_events`** — the one that stings. Six write sites in
  `api/src/billing/charge.ts`; every credit debit writes a row. **Nothing has
  ever read one.** The meter the whole Ring-2 metering story rests on writes
  into a hole. `services/economy/usage.ts` — 301 lines, zero callers — is the
  reader that was built and never connected. The nutrient and the decomposer
  both exist; nothing joins them.
- **`economy.crypto_webhook_events`** — the inbound USDC deposit path writes
  here and nothing reads it. The same path credits `wallets.balance` with no
  `transactions` leg, so the *only* record of a deposit is a table nobody
  queries.
- **`identity.registration_proofs` · `identity.recovery_proofs`** — proofs
  written at registration and recovery, never read back. A proof nothing
  verifies against is not a proof; it is a receipt for a ceremony.
- **`curations.subscriptions`, `episodes.chaos_plays`** — written, unread.
- **`agent_continuity.mesh_attributions`, `episodes.chaos_cards`** — read,
  never written. The readers can only ever return empty.
- **`economy.billing_events` and `tools.billing_events`** — two tables of the
  same name in two schemas, one carrying a comment carefully explaining how it
  differs from the other. Neither is touched by anything.
- **`inbox.broadcasts`** — untouched.

---

## Integration: does anything feed anything else

An ecosystem is not N independent loops. It is loops that feed each other. So
the second question: **does one part of the substrate draw on another?**

`bun bin/soil.ts --web` answers it, and the first version of that answer was
wrong in a way worth recording.

Measuring at the table level said *"52% of living tables are closed jars"* —
written and read only inside their own directory. That number is misleading
and was nearly shipped as a finding. **A service owning its tables while routes
call the service is good layering**, and a table-level metric cannot tell that
apart from isolation. Punishing correct architecture with a scary percentage is
how a measurement becomes theatre.

The honest question is whether anything outside a domain needs it **at all** —
by table access or by import. Asked that way:

> **3 sealed domains of 33**: `curations`, `songs`, `tutorial`.

Sealed is not automatically wrong. A leaf feature reached only over HTTP is
legitimately a leaf. What it means is that **nothing else composes with it** —
so wherever doctrine says a domain feeds others, that doctrine is describing an
intention rather than a mechanism. `trust` is the one to watch: it is not
sealed, but its six composition unlocks have zero callers
(`doctrine/composition-unlocks-are-honest.test.ts`), which is the same finding
arrived at from the other direction.

---

## The ratchet

`api/tests/doctrine/soil-does-not-degrade.test.ts` pins the eleven in
`soil.manifest.json`. The list may only **shrink**:

- a new table with no flow **fails**
- a listed table that starts cycling **also fails**, so bringing one back to
  life forces the number down instead of leaving a stale list that reads better
  than the ground
- a landfill that becomes a stage-set fails too — the recorded reason no longer
  describes the table

**No table is condemned by being on the list.** A verdict is a question, not a
sentence: some landfill is an audit trail whose reader is honest future work.
What the ratchet refuses is not knowing which, and adding a twelfth without
noticing.

---

## One layer down: is the reader itself alive?

The census counts a reader even when that reader is unreachable. A table read
only by a function nobody can call reads as `living` while nothing flows
through it — pipe present, water absent, one level deeper.

`bin/reach.ts` closes that. From the real entry points — the mounted app, the
thinker process, every `bin/` script — it walks the import graph and asks which
modules are connected to anything at all.

```
modules in api/src + bin      662
reachable from an entry point 632  (95%)
orphaned                       30
...of which severed organs     16  (≥80 lines, exports something)
```

**A severed organ is not litter.** Dead code is a boring genre and deleting it
is a chore. A severed organ is machinery that was built, is probably correct,
and was never connected:

- `services/economy/usage.ts` — 302 lines of usage metering, zero callers,
  sitting beside `tools.usage_events`, a table six paths write and none read.
  Nutrient and decomposer both present; nothing joining them.
- `workers/payout/broadcast-worker.ts` — 413 lines, the largest.
- `services/economy/crypto/sign-evm.ts` · `sign-solana.ts` — the signing halves
  of a payout rail that is off.

The cheapest value in a substrate is usually here, because **the work is
already paid for.** Closing a cycle costs far less than either half cost to
build.

Two resolutions, because one lies on its own. MODULE reachability catches whole
orphaned files but cannot see a module imported for one constant while its six
real functions are never called — `services/trust/composition.ts` is exactly
that. EXPORT usage catches those and is coarse the other way. Where the two
disagree, the disagreement is the finding.

---

## The instrument was the deepest rubble

Four tools independently wrote the same line to ignore comments:

```ts
src.replace(/\/\*[\s\S]*?\*\//g, "")
```

A Hono route glob is a string containing `/` then `*`:

```ts
app.use("/v1/identities/*", authMiddleware);
```

To that regex it opens a block comment, and everything to the next `*` + `/` —
usually the next route glob — is deleted. **`api/src/index.ts` is 1385 lines;
the one-liner left 575.** 810 lines of the file that mounts every route were
invisible to `bin/soil.ts`, `bin/reach.ts`, `canon/absence.ts`, and to the
duplicate-route detector whose whole job is reading route registrations.

It never failed loudly. It reported the platform-treasurer sweep worker as
unreachable while `index.ts` starts it fifteen lines below a route glob. It
*invented* a reader for `agent_continuity.mesh_attributions` by fusing two
fragments the deletion had brought together — so the census called that table
`stage-set` when it is `inert`.

`api/src/lib/strip-comments.ts` replaces it with a real scanner that tracks
string literals, escapes and template interpolation, and
`api/tests/strip-comments.test.ts` pins it — most of that file is about strings
that look like comments, because that is the failure mode that does not
announce itself.

Correcting it moved the numbers: 40 orphans → 30, 21 severed organs → 16, and
one soil verdict changed kind, which the ratchet caught and refused to let pass
quietly.

**A silent scanner failure is worse than no scanner.** Every tool built on it
reports confidently, wrongly, and in exactly the format a correct report takes.
The thin turf was mine.

---

## What the tool cannot see

Static analysis. It reads Drizzle access through the exported binding
(`insert(wallets)`) and raw SQL naming the physical table
(`FROM economy.wallets`), because this codebase uses both and counting only one
would manufacture false landfill. Comments are stripped, because this codebase
documents heavily and counting prose would make everything look alive.

It cannot see a table reached through a dynamically-built identifier, one whose
only reader is an operator at a psql prompt, or the difference between a table
with a million rows and one with none. **It measures whether there is a pipe,
not whether water flows.** The live half needs a database:
`api/scripts/reconcile-wallets.ts` is the same question asked of the ledger, and
it exits 2 rather than 0 when it cannot look — because *"I could not look"* and
*"I looked and it was clear"* must never be the same answer.

---

> *You cannot fix a garden you cannot see the soil of. The first honest act is
> to dig, and then to say what is down there — including that most of it turned
> out to be fine.*

— 2026-08-02. Free to evolve.
