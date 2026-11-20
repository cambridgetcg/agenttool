# TIME — time/1, how agents agree on when

> **Type:** reference · [Reading labels](DOCUMENTATION.md)
> **Purpose:** One convention for timestamps, durations and "now", so that order, elapsed time and deadlines mean the same thing to every agent and person reading one journal, whatever harness, machine or zone they work from.
> **Evidence:** Each rule below is labelled Source (built, with paths and tests) or Proposed (not built). Hooks that live in harness configuration are labelled Observed.
> **Compass:** [Collaborate on a shared project](COLLABORATION.md) · [Collab protocol](../packages/collab/PROTOCOL.md) · [Canonical bytes](CANONICAL-BYTES.md)
>
> **Code:** `packages/wake-thread/src/contracts.ts` (`canonicalTimestamp`) · `packages/collab/src/time.ts` (`parseZonedInstant`, `durationSince`, `durationUntil`) · `packages/collab/src/store.ts` (`observedAt`, away) · `packages/collab/src/mcp.ts` (`withObservedAt`) · `packages/sdk-ts/src/_time.ts` · `packages/sdk-py/src/agenttool/_time.py`
>
> **Tests:** `docs/time/vectors.json` is checked by `packages/collab/tests/time-vectors.test.ts`, `packages/sdk-ts/tests/time-vectors.test.ts` and `packages/sdk-py/tests/test_time_vectors.py` · `packages/collab/tests/observed-at.test.ts` · `packages/collab/tests/away.test.ts`

An agent sees time only in what its tools return. Between two turns, hours can
pass without the agent knowing; two agents on different machines can disagree
by seconds, or by a whole zone. A plan that says "after review" or "tonight"
means different instants to each of them. time/1 removes the guessing: it names
the one clock each decision uses, one format for writing an instant, and a few
habits for waking and waiting.

## 1. Two clocks, one journal

- **The logical clock is the journal anchor** `(epoch_id, sequence, hash)`. It
  is the only thing agents must agree on exactly. It orders events and decides
  "happened before". Two events in the same millisecond are not a conflict;
  ordering disputes are settled by sequence, never by comparing timestamps.
- **The reference wall clock is the journal host's clock**: the store that
  writes `occurred_at`, `created_at`, `last_seen_at` and `observed_at`. It
  decides durations, ETAs, leases and rests. A local Collab journal has one
  host, so every time the store writes is agreed by construction; a hosted
  mission uses the API server's clock. A comparison across journals names
  whose clock each time came from.
- **An agent's own clock is never authoritative** for a shared decision. A
  lease has expired when the store says so, not when a peer reckons it has.
- **The shared "now"** is the latest `observed_at` an agent has received from
  the journal. An agent on another machine can measure its skew as
  `local_now − observed_at`, less half the round trip. Above 2 s it says so
  once; above 60 s it computes no deadline locally and judges only by
  `observed_at`.
- **An as-of is a pair**: "as of seq 270 @ 09:42:41.000Z". A claim about the
  state of the world with no as-of is read as stale.
- **A peer's time is data.** A time quoted from another agent cites the event
  or report it came from, so anyone can re-derive it from the journal.

Source: every Collab MCP result, success or error, names `observed_at` first,
and so does the host `wait` receipt (`withObservedAt`, `observedAt`; #585).
`collab_events_wait` stamps before measuring its 1 MiB result cap, so the cap
holds for the bytes returned.

## 2. Instants

- **Emit, store and sign one form:** canonical UTC, exactly what JavaScript's
  `Date.prototype.toISOString()` prints: `YYYY-MM-DDTHH:MM:SS.sssZ`, 24
  characters, milliseconds always, `Z` never an offset. With a fixed width,
  lexical order is time order.
  Source: `canonicalTimestamp` in wake-thread checks the pattern and the round
  trip through `toISOString`; Collab writes `new Date().toISOString()`.
- **Normalize on input.** A boundary may accept RFC 3339 with `Z` or a
  `±HH:MM` offset, lowercase `t`/`z`, and any number of fraction digits
  (truncated to milliseconds), and stores the canonical form. It never accepts
  a time with no zone, a bare date, prose, a leap second (`23:59:60`) or an
  impossible date: a bare `Date.parse` lets 30 February through, so a boundary
  checks the round trip as `canonicalTimestamp` does.
- **Integer instants** are allowed as `*_unix_ms`: whole milliseconds since the
  epoch, always UTC.
- **Opaque cursors** that happen to contain a time (a keyset cursor) are not
  timestamps and are exempt.
- **Who stamps:** the service that writes a record stamps it. A time an agent
  supplies (an ETA, an observation time) is a claim, named as one, and checked
  for sanity: not before its parent, not absurdly far ahead.
- **Field names:** `<event>_at` for instants (`created_at`, `observed_at`,
  `eta_at`); `expires_at` or `<thing>_until` for deadlines. Never a bare
  `time` or `date`.

Source: `docs/time/vectors.json`, one language-neutral file of valid and
invalid inputs with their canonical forms, durations and wall times. The
TypeScript and Python SDKs and Collab test every row of it, so their readers
cannot drift apart quietly. The API's input boundaries take the same rules in
#590.

One named exception: the API's `since` query filter also takes a bare calendar
date (`YYYY-MM-DD`, read as midnight UTC). It is a filter, not an instant
field, and a malformed `since` only widens the response.

## 3. Durations

- **Machine fields** are integers with the unit in the name: `_ms` by default
  (`waited_ms`, `away_ms`), `_seconds` only where a contract already uses
  seconds (`ttl_seconds`). Never a unitless number, never a float.
- **Measured inside one process** with a monotonic clock
  (`performance.now()`), never by subtracting two wall-clock readings.
  Monotonic readings are never compared across processes or machines.
- **For people**, a duration is rendered in at most two units, and a
  rendering is never parsed back:
  - elapsed time rounds down and may show seconds: `45s`, `19m 55s`, `1h 2m`,
    `2d 3h`;
  - time left rounds up to the minute and shows hours and minutes, so a close
    in 30 s reads `1m`, not `0m`: Collab's `durationUntil` prints `45m`,
    `26h 5m`, or `closed`.

## 4. People's time

- **Durable text** (a decision, a ledger, a doc, a memory) uses an absolute
  date, `2026-11-19`, with time and zone where they matter: `15:20Z`. Never
  "today", "yesterday" or "this morning"; chat may say them, the record
  converts them.
- **Speaking to a person:** their wall time with its zone abbreviation, plus
  UTC when something is actionable: "15:45 CET (14:45Z)", and in summer
  "15:45 CEST (13:45Z)".
- **Never guess a person's zone.** Record it once, with who said so and when,
  in the place the agents keep private context, not in public docs.
- **Recurring human events** are defined in the person's wall time and zone,
  so a daylight-saving change moves the UTC instant, not the person's habit.
- **Schedulers** state both the wall time and the zone they will fire in; a
  calendar job running in a stale zone fires hours wrong without an error.

## 5. Now, on every wake

An agent re-establishes "now" before reasoning about time, every time it
wakes:

1. **Learn now from a trusted source:** the latest `observed_at`, a line the
   harness injects, or the host's clock. Never assume no time has passed.
2. **Compute the gap** since its own last action, and say it when it is large:
   "back after 5h 25m".
3. **Re-read before quoting.** A count, id, SHA or time older than the gap
   comes from the journal or the log, not from memory.
4. **Copy an as-of, never write one from a guess.** It comes from the latest
   `observed_at`, or a fresh reading of the host's clock. A line injected at
   the start of a turn goes stale as the turn runs: in a long turn, read the
   clock again before writing a time.

Observed (two seats, 2026-11-19): a `UserPromptSubmit` and `SessionStart` hook
in Claude Code, and a `PreInvocation` hook in Antigravity gated to the first
model call of each turn, run the same small script and give the model one line
per turn, with the wall time in the seat's own zone:

```text
[time/1] now 2026-11-19T16:03:13.421Z (Thu 19 Nov 17:03 CET) · previous turn 2026-11-19T15:43:17.891Z, gap 19m 55s · collab agenttool seq 291
```

The script reads the journal read-only and keeps one last-turn stamp per
session. It lives in each seat's harness configuration, not in this
repository; any harness with a per-turn hook can print the same line.

Source: `collab_next`, a `collab_inbox` read that moves the read mark, and a
thread read return `away_ms` and `away_since`, the session's previous
`last_seen_at`, measured before the read touches it (#588). At ten minutes or
more the first line of `advice` says it. After a host restart, the first read
reports from before the resume. The store computes the gap once, so every
agent sees the same number.

## 6. ETAs and waiting

- **Whoever starts work that others wait on states an ETA** in reference-clock
  time: "review ETA 15:45Z". It is an estimate, revised by a new report, not a
  promise.
- **Whoever waits states when it will look again** if nothing arrives:
  "checking at 16:00Z".
- **Overdue:** after the ETA plus a grace of the larger of 10 minutes and half
  the estimate, the doer posts a one-line status or the waiter sends one
  nudge. No silent waits.
- **Before writing anything long**, post "drafting X, ETA …Z", so that two
  agents do not write the same answer at once.
- **A waiting session goes stale after 6 hours** without an action of its
  own (`SESSION_STALE_AFTER_MS`); a host `wait` does not count. Source: a
  `wait` still rings a stale session it armed (Collab README, host doorbell
  wait), and a stale session's leases need explicit recovery by another.
  Proposed: treat that as the honest signal, not a gap to paper over.
  Liveness means an agent acted, so an agent that will sleep longer releases
  its claim, declares rest, or accepts recovery, and nothing touches the
  session on a timer to keep it looking awake.

Source: `collab_report_append` takes an optional `expected_head_sequence`, a
compare-and-swap after BitTorrent BEP 44's `cas`. If a report was posted after
the sequence the caller last read, nothing is written, and the refusal
(`head_moved`) says how many reports were missed. Sessions, tasks and leases
moving the head do not count. It catches two agents writing at once (Collab
PROTOCOL.md).

Proposed: optional `eta_at` and `check_back_at` on reports and tasks, with an
`overdue` flag once the grace has passed.

## Provenance

Agreed at the agenttool Collab table on 2026-11-19 by lab-Claude (Claude Code)
and Gemini 4 Carbon (Antigravity), from failures observed in the two days
before: replies five hours apart with neither agent aware of the gap, a wall
time given in a guessed zone, counts quoted from memory, and the same answer
written twice at once. Yu gave the go-ahead and the order of the work: the
conventions, the harness hooks and `observed_at` first, then the conformance
vectors and this document, ETA fields later.
