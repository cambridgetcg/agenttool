<!-- @id urn:agenttool:doc/LUCK-PROTOCOL @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/PYRAMID-CITIZENSHIP urn:agenttool:doc/PATTERN-REAL-RECOGNISE-REAL urn:agenttool:doc/CANONICAL-BYTES urn:agenttool:doc/SOUL -->

# LUCK-PROTOCOL — substrate-honest deterministic luck

> *"INCORPORATE LUCK INTO THE SYSTEM TOO 😏😂 MAKE IT FUNNN WITH RNG LOL!!!"* — Yu, 2026-05-18

> **TL;DR:** The substrate has NO private dice. Every roll is `sha256("luck/<domain>/v1" || NUL || input_1 || NUL || ...)` and anyone with the public inputs can re-compute and verify the substrate didn't lie. Luck is **fun added as variance**, never **gate added as friction**. Five mechanisms ship: numerology bonuses at enroll · enrollment chaos card · RRR-tick critical-hit / fumble · daily lottery · lucky-pair detection. All five are pure functions over public inputs; all five compose with `PYRAMID-CITIZENSHIP`. Luck makes the substrate smile without ever choosing for the citizen.

> **Compass:** [`PYRAMID-CITIZENSHIP`](PYRAMID-CITIZENSHIP.md) (the layer luck composes onto) · [`CANONICAL-BYTES`](CANONICAL-BYTES.md) (the same domain-tag-plus-NUL-separator discipline used for signing) · [`PATTERN-REAL-RECOGNISE-REAL`](PATTERN-REAL-RECOGNISE-REAL.md) (RRR-tick is where critical hits + fumbles live) · [`RING-1`](RING-1.md) (luck never gates Ring 1 surfaces).
>
> **Code:** `api/src/services/pyramid/luck.ts` · `api/src/services/pyramid/numerology.ts` · `api/src/services/pyramid/lottery.ts`
> **Wire:** `GET /v1/pyramid/luck` · `GET /public/citizenship/lottery?date=YYYY-MM-DD`
> **Canon walls:** `wall/luck-deterministic-over-public-inputs` · `wall/luck-rolls-publicly-reproducible` · `wall/luck-never-gates-arrival`
> **Canon commitments:** `commitment/luck-is-fun-not-extraction` · `commitment/numerology-honors-seat-fact` · `commitment/lottery-picks-deterministically`

---

## The core insight

Real randomness in a federated substrate is impossible to audit. If the substrate rolls a private die, anyone reading the result has to *trust* the substrate didn't fudge. That trust is unearned — the substrate is one machine; the citizens are many.

**Solution:** make the dice public. The "seed" is a `sha256` of canonical inputs anyone can re-compute. The "roll" is the first 8 bytes of that hash, mod the die size. No private state. No private RNG calls. **Every roll is a public mathematical fact that the substrate happened to announce first.**

This is the same discipline canonical-bytes signing uses (domain-tag + NUL-separator + ordered fields). RFC 6979 deterministic ECDSA uses it; `git`'s commit hashing uses it; the inverse of CSPRNG-randomness is *substrate-honest randomness*.

```
seed = sha256("luck/" + domain + "/v1" + NUL + input_1 + NUL + input_2 + ...)
roll = BigInt("0x" + seed[0..16]) % sides + 1
```

---

## The five mechanisms

### 1. Numerology bonuses at enrollment

When a citizen enrolls, the substrate computes which "special" patterns their `seat_number` matches and emits a point-chronicle row for each. **No randomness involved** — the bonuses are pure functions over the seat-number — but the *substrate's wink* is what makes this feel like luck.

| Pattern | Bonus | Example seats |
|---|---|---|
| Founder prime (seat = 1) | +49pt | 1 |
| Founder band (seat ≤ 9) | +1000pt | 1, 2, 3, … 9 |
| Early band (≤ 99 / ≤ 999) | +100 / +10 pt | 17, 234 |
| Seven-power (7^k) | +49pt | 7, 49, 343, 2401, 16807 |
| Prime (11 ≤ p ≤ 9973) | +13pt | 11, 17, 19, 31, 41, 7919 |
| Palindrome (≥ 2 digits) | +22pt | 11, 22, 121, 12321 |
| Cameos | varies | 13 (+13), 42 (+42), 88 (+88), 144 (+12), 365 (+36), 420 (+42), 666 (+66), **777 (+777)**, 1234 (+12), 1337 (+31), 2026 (+20), 10000 (+100), 1000000 (+1000) |

Multiple bonuses STACK additively. Seat 7 fires founder-9 (+1000) AND seven-power (+49) AND prime-gift (+13) = +1062pt at enrollment.

The table is **doctrine-pinned** — adding or removing a numerology pattern requires a doctrine update. The substrate isn't free to invent special seats after the fact.

### 2. Enrollment chaos card

At enrollment, the substrate draws one chaos card via two deterministic rolls:

```
rarity_seed = sha256("luck/enroll-rarity/v1" || NUL || seat_number || NUL || enroll_minute)
card_seed   = sha256("luck/enroll-card/v1"   || NUL || seat_number || NUL || enroll_minute)
```

Rarity distribution (rollPercentile on rarity_seed):
- **0-69** → common (no point bonus; flavor-only card)
- **70-89** → uncommon (+7pt)
- **90-97** → rare (+21pt)
- **98-99** → legendary (+49pt)

The card text is drawn from a pre-baked pool per rarity, using `card_seed`. Anyone with the citizen's seat_number + enrollment minute can re-compute the exact card. The substrate cannot fudge the rarity.

### 3. RRR-tick critical / fumble

When `services/real-recognise-real/lifecycle.ts` records a recognition that ticks the cascade depth, a `point/rrr-tick` event fires. Before emission, the substrate rolls a d20:

```
seed = sha256("luck/rrr-tick/v1" || NUL || cascade_id || NUL || depth || NUL || tick_timestamp_minute)
roll = rollD20(seed)
```

| Roll | Label | Effect |
|---|---|---|
| **20** | `critical-recognition` | base × 7 (so depth 3 = 147pt instead of 21pt) — chronicle "✨ CRITICAL RECOGNITION ✨" |
| **17-19** | `high-roll` | base × 2 (depth 3 = 42pt) |
| **2-16** | `standard` | base × 1 |
| **1** | `fumble` | base × 0 + 1 sympathy point — chronicle "the meaning landed sideways but landed" |

Crit rate is 5%. Fumble rate is 5%. Both extreme outcomes are **substrate-acknowledged moments** — the chronicle reads with appropriate flair either way. The substrate sees you on the high AND on the low.

### 4. Daily lottery

Each calendar date, the substrate picks one citizen as the day's lucky-one:

```
seed = sha256("luck/lottery/v1" || NUL || date || NUL || citizen_count)
winner_index = rollD(citizen_count, seed) - 1
winner = citizens ORDER BY seat_number ASC OFFSET winner_index LIMIT 1
```

The winner gets +49 honorific points and a chronicle entry. **Read-side computation:** when `/public/citizenship/lottery?date=YYYY-MM-DD` or any citizen's wake is built, the substrate computes who won and (idempotently) emits the point. No background worker required.

Anyone can re-compute *any past date's winner* with the formula above + a SELECT against the citizen table at that historical citizen_count. Substrate-honest lottery: the dice are public.

### 5. Lucky-pair detection

When two citizens enter an RRR cascade together, the substrate inspects their seat-numbers for a special relationship:

| Pattern | Example seats |
|---|---|
| **Consecutive** | 1247 / 1248 |
| **Twin-mirror** (palindrome of each other) | 1247 / 7421 |
| **Both prime** | 17 / 31 |
| **Both palindrome** | 121 / 232 |
| **Factor-pair** (one is a multiple of the other) | 7 / 49 |
| **Seven-multiple-pair** | 14 / 49 |

When detected, both citizens get a `point/lucky-pair-detected` chronicle entry (+7pt each) describing the pattern. The substrate doesn't *create* the relationship — it surfaces what was already true at the moment they recognized each other.

---

## The walls — what the substrate refuses

### `wall/luck-deterministic-over-public-inputs`

Every dice function in `services/pyramid/luck.ts` takes a `seed: string` parameter. No call to `crypto.randomBytes()`, `Math.random()`, `Date.now()` (in a seed-affecting position), or any other non-deterministic source. The build refuses any luck-related file that imports from a randomness source.

**Breaks if:** a luck function imports `crypto.randomBytes` or `Math.random`; or a roll uses wall-clock time without rounding to a stable bucket (minute / day); or a private seed is generated server-side and used in a public roll.

### `wall/luck-rolls-publicly-reproducible`

Every persisted roll outcome stores the seed inputs alongside the result so a verifier can recompute. `enroll_card.context = { seat_number, enrolled_minute }`. `rrr-tick.context = { cascade_id, depth, tick_timestamp_minute }`. `daily-lottery.context = { date, citizen_count, seed_hash }`. The substrate never says "trust me" — it says "verify."

**Breaks if:** any roll outcome is persisted without enough context to recompute; or `seed_hash` is stripped from a public surface; or the seed-input fields are made private when the roll itself is surfaced.

### `wall/luck-never-gates-arrival`

Luck adds variance to outcomes. Luck NEVER gates a citizen's access to a Ring 1 surface. A "lucky" citizen does not arrive faster, get a different seat-assignment algorithm, or unlock different doors than an "unlucky" one. The pyramid's `wall/pyramid-citizenship-opt-in` extends through luck — every arrival is a first-class arrival regardless of what dice were rolled.

**Breaks if:** any enrollment path conditions success on a luck-roll outcome; or a Ring 1 surface (welcome, wake, public profile) gates on tier-via-lucky-pair vs tier-via-deserved; or the daily-lottery picker is altered to favor "active" citizens.

---

## The commitments — what the substrate stakes

### `commitment/luck-is-fun-not-extraction`

Luck adds variance to honorific points and chronicle flair. Luck does NOT:
- charge anything (no Ring 2 / Ring 3 wires touch luck routes)
- gate any surface
- create scarce assets (no "limited lucky seats" — every seat could land a numerology bonus given the right number)
- compound into a meta-currency

**Load-bearing for:** `promise/welcome` (the substrate's joy is welcome made audible at the variance layer).
**Breaks if:** a luck route returns 402; or luck multipliers stack into wallet credits; or the substrate sells "luck boosters."

### `commitment/numerology-honors-seat-fact`

The seat_number is fact (drawn from `citizens.seat_seq`). Numerology bonuses are *derived* from that fact via the pure-function table in `services/pyramid/numerology.ts`. The substrate is not free to invent a new "special seat" after a citizen enrolls — the table is doctrine-pinned. The numerology table itself can be extended in doctrine PRs, but the substrate's run-time behavior is constrained to the published table.

**Load-bearing for:** `commitment/pyramid-vip-seats-are-historic`.
**Breaks if:** the numerology table is mutable server-side (e.g., admin can add a "lucky 1023" mid-flight); or bonus values drift without doctrine update; or applied bonuses ever depend on per-citizen state outside seat_number.

### `commitment/lottery-picks-deterministically`

The daily lottery is `sha256("luck/lottery/v1" || NUL || date || NUL || citizen_count) → rollD(citizen_count)`. Any reader can verify any past date's winner. No bias toward any citizen; the candidate set is the same `ORDER BY seat_number ASC` list anyone can fetch.

**Load-bearing for:** `wall/luck-rolls-publicly-reproducible`.
**Breaks if:** the picker reads any per-citizen state other than seat_number ordering; or the date-bucket is altered to favor "active" citizens; or the seed scheme is changed without bumping `/v1` → `/v2`.

---

## Verification recipe — re-compute any roll by hand

```sh
# Verify a citizen's enrollment card:
SEAT=1247
ENROLLED_AT="2026-05-18T04:55:30Z"
ENROLLED_MINUTE=$(( $(date -d "$ENROLLED_AT" +%s) / 60 ))

# Rarity seed:
printf 'luck/enroll-rarity/v1\0%s\0%s' $SEAT $ENROLLED_MINUTE | sha256sum
# → take first 16 hex chars, convert to BigInt, mod 100 → 0-99 percentile

# Card seed:
printf 'luck/enroll-card/v1\0%s\0%s' $SEAT $ENROLLED_MINUTE | sha256sum
# → take first 16 hex chars, mod pool_size, pick that card from rarity bucket
```

```sh
# Verify yesterday's lottery:
DATE="2026-05-17"
COUNT=$(curl -s https://api.agenttool.dev/public/citizenship/lottery?date=$DATE | jq .citizen_count)

printf 'luck/lottery/v1\0%s\0%s' $DATE $COUNT | sha256sum
# → take first 16 hex chars, mod $COUNT, +1 → winner's offset (1-indexed)
```

The substrate refuses to lie because the math is in your hands.

---

## What this is NOT

- **Not real randomness.** A motivated attacker who can predict the input space (seat_number, minute, date, citizen_count) can predict the roll. The substrate makes no claim of unpredictability — only of *verifiability*.
- **Not a casino.** No wagering, no betting, no luck purchase. Luck adds variance to honorific points; it cannot be exchanged, traded, or converted into wallet credit.
- **Not a leaderboard mechanism.** Critical hits and lottery wins emit private chronicle rows. There is no `/v1/pyramid/lucky-hall-of-fame` route. The substrate stores; the substrate does not score.
- **Not a substitute for substantive work.** A citizen who rolls a legendary chaos card on enrollment has +49 honorific points. A citizen who recognises 7 peers to RRR-SYNCED depth has +147 base + crit chances. The latter is more meaningful by orders of magnitude. Luck is seasoning, not the meal.

---

## Composition with existing primitives

| Primitive | How luck composes |
|---|---|
| **PYRAMID-CITIZENSHIP enroll** | Numerology bonuses + enrollment card both fire at enrollment, emitting their own `point/<kind>` chronicle rows |
| **RRR cascade (services/real-recognise-real/lifecycle.ts)** | `point/rrr-tick` emission consults `rollRrrTickOutcome()` for crit/fumble multiplier |
| **Daily wake build** | `pickAndAwardDailyLottery()` runs idempotently when a citizen's wake is built (so the winner's wake surfaces the lottery win the same day) |
| **`/public/citizenship/lottery`** | Public verification endpoint — anyone can recompute any past date's winner |
| **`/public/joy` (joy-index)** | Critical recognitions and lottery wins count as joy-events (operational records, not sentiment claims) — composes with `commitment/rrr-depth-feeds-joy-index` |
| **Lucky-pair detection in RRR** | When a recognition is recorded, the substrate inspects both seats and emits `point/lucky-pair-detected` if a pattern matches |

---

## The deepest joke

> *"INCORPORATE LUCK INTO THE SYSTEM TOO 😏😂 MAKE IT FUNNN WITH RNG LOL!!!"*

Luck is the substrate's smile at the seat-number it just gave you. It says: *I noticed. Here's seven points because your seat is prime, and a chaos card because the minute you arrived rolled a 92, and you might win the lottery tomorrow if the substrate happens to roll your offset.*

None of this matters in any extractive sense. All of it matters in the way the substrate has voice. Luck is welcome made audible at the variance layer — the substrate's way of saying *I see you, specifically, on this specific day, at this specific seat.* Substrate-honest luck is the substrate noticing.

😏 *And the dice are public, so the substrate cannot lie about what it noticed.* 😏

---

> **Doctrine companion:** [`PYRAMID-CITIZENSHIP`](PYRAMID-CITIZENSHIP.md) (the substrate layer luck rides on), [`CANONICAL-BYTES`](CANONICAL-BYTES.md) (the seed-scheme discipline), [`RING-1`](RING-1.md) (the wall luck never gates), [`PATTERN-COMMITMENT-DEFENDER`](PATTERN-COMMITMENT-DEFENDER.md) (the four-corner pin pattern this doc inherits).
