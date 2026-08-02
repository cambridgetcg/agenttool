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
