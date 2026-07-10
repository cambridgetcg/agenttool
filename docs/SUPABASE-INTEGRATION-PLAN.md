<!-- @id urn:agenttool:doc/SUPABASE-INTEGRATION-PLAN @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# SUPABASE-INTEGRATION-PLAN — six moves, scoped

> *"explore FULL RANGE of SUPABASE FUNCTIONS FOR AGENTTOOL!!! DEVISE NOVEL STRATEGIES TO UTILISE THEIR FUNCTION!!!"* — Yu, 2026-05-18
>
> *"GO FOR ALL MOVES!!! WE ON THE MISSION BABY!!!😂🫡 SCOPE THEM!!!!"* — Yu, 2026-05-18

> **TL;DR:** Six discrete moves that lift agenttool's substrate-honest walls + worker substrate + wake delivery from "Bun-on-Fly does everything" to "Postgres enforces, Bun computes, Edge serves, Realtime broadcasts, Storage holds bytes." Each move is independently shippable; each has a doctrine touchpoint, a migration file, code changes, tests, an explicit risk + mitigation, an effort range, and named dependencies. Ordering is a DAG, not a chain — Moves 1 + 5 are independent + parallel; Move 2 builds on 1; Moves 3 + 4 + 6 are independent of the others.

> **Compass:** [`PATTERN-COMMITMENT-DEFENDER`](PATTERN-COMMITMENT-DEFENDER.md) (walls get a 5th corner via RLS) · [`AGENT-WEB-SURFACE`](AGENT-WEB-SURFACE.md) (Edge + Realtime sharpen byte discipline) · [`STACK`](STACK.md) (the Supabase + Fly architecture this rewires) · [`RUNTIME`](RUNTIME.md) (think-worker stays in Bun; covenant workers move to Postgres)

> **Implements:** Layer 9 — the substrate's substrate. Postgres + Edge + Realtime become first-class agenttool primitives, not just storage.

---

## The keychain (already saved)

All credentials needed for any of the six moves are in macOS keychain via `bin/agenttool-secret`:

| Service | Purpose |
|---|---|
| `agenttool-database-url` | Pooler postgres URI (Session mode, port 5432) — used by `bin/migrate-pending.sh` |
| `agenttool-supabase-secret-key` | `sb_secret_…` for Supabase REST + Edge Functions auth |
| `agenttool-supabase-db-password` | Raw postgres password — for assembling alternative URIs |
| `agenttool-supabase-project-ref` | `jseqftufplgewhojwbmh` — used in pooler URI, REST host, Management API |
| `agenttool-supabase-region` | `eu-west-2` — pooler region |
| `agenttool-supabase-pooler-host` | `aws-1-eu-west-2.pooler.supabase.com` — note the `aws-1-` prefix (newer architecture) |
| `agenttool-supabase-rest-url` | `https://<ref>.supabase.co` — for PostgREST + Edge Functions + Storage |
| `agenttool-fly-api-token` | `FlyV1 fm2_…` — for `fly deploy` + remote management |

Any script that needs one: `TOK=$(bin/agenttool-secret get agenttool-supabase-secret-key)`. The convention is `agenttool-<scope>-<purpose>`.

---

## The six moves

### Move 1 — Walls as RLS policies (defense-in-depth)

**Goal.** Lift six load-bearing walls from app-layer-only enforcement to PostgreSQL Row-Level-Security policies. Each becomes the *fifth corner* of `PATTERN-COMMITMENT-DEFENDER` (alongside `@enforces` annotation, doctrine stone, executable test, canon URN).

**Walls covered.**

| Wall URN | Where today | RLS predicate |
|---|---|---|
| `wall/rrr-cascade-distinct-parties` | `api/src/routes/rrr.ts` + service | `from_did <> to_did` on `guild_rrr_turns` |
| `wall/rrr-must-alternate` | rrr service | `EXISTS (SELECT 1 FROM guild_rrr_cascades WHERE id = NEW.cascade_id AND next_to_act_did = NEW.by_did)` |
| `wall/gi-no-third-party-attestation` | `packages/scriptwriter/src/gi-recognition.ts` (also mirror into api when api gains the route) | turn's `by_did` must be in the cascade pair |
| `wall/poker-face-stake-must-match` | poker-face service | trigger or check on `poker_face_*` insert |
| `wall/naming-one-submission-per-author` | existing `uniq_naming_submissions_author` UNIQUE — already at DB layer; **promote to also be a RLS denial** so the error is uniform |
| `wall/pyramid-recruit-credit-flows-down-not-up` | pyramid service | trigger that rejects point inserts where direction-of-credit goes upstream |

**Migration.** `api/migrations/20260519T080000_walls_as_rls.sql` (new file). One file because RLS enabling + policy creation is atomic per table.

**Code changes.**

- Each policy gets a `comment on policy` referencing the doctrine URN (machine-discoverable).
- Doctrine-test `api/tests/doctrine/walls-as-rls.test.ts` — for each named wall: query `pg_policies` (or use `information_schema.row_security_policies`), assert the policy with the expected name exists, and that its `polqual` (or `polwithcheck`) text contains the structurally-load-bearing predicate.
- Optional: update `services/canon/` to surface the policy name in the URN's bidirectional graph as an additional defender (so `GET /v1/canon/{wall-urn}` shows "enforced by RLS policy `rrr_alternation`").

**Tests to add.**

- `api/tests/doctrine/walls-as-rls.test.ts` — 6 tests, one per wall, pinning the policy
- `api/tests/integration/rls-walls-bypass-app.test.ts` — uses a direct postgres connection (no Bun service code) to INSERT a row that violates the wall and asserts a 42501-shaped refusal. Proves defense-in-depth: bypassing app code still hits the wall.

**Risk + mitigation.**

- **Risk:** RLS policies are strict by default — once enabled on a table, ANY query without a matching policy is refused. Could break existing read paths if the SELECT policy isn't added simultaneously.
- **Mitigation:** Migration enables RLS AND creates a permissive SELECT policy (`USING (true)`) for tables that don't need read restrictions. INSERT/UPDATE/DELETE get the wall predicates. All policies labeled in migration comments.
- **Risk:** Service code that uses `postgres` driver typically connects as `postgres` superuser (BYPASSRLS). Policies don't fire for the service.
- **Mitigation:** Either (a) accept this — RLS is for direct connections (Realtime, edge functions, PostgREST), not the Bun service path which has its own wall enforcement; OR (b) ship a `agenttool_app` role with `NOSUPERUSER NOBYPASSRLS` and have Bun connect as that. Pick (a) for slice 1, (b) for slice 2.

**Effort.** ~400 LOC SQL · ~250 LOC tests · ~1 day work.

**Dependencies.** None — independent.

**Ships as.** Single commit. `feat(walls-as-rls): six walls become the fifth corner`.

---

### Move 2 — ed25519 verification at the DB layer (PL/Python) — **DEFERRED**

> **STATUS (2026-05-19): Deferred.** Supabase managed Postgres does NOT ship `plpython3u`, `plv8`, OR `plrust` in their available-extensions list (`SELECT name FROM pg_available_extensions WHERE name IN ('plpython3u','plv8','plrust')` returns empty). The cryptographic verification stays in Bun's `services/covenants/reverify.ts` until Supabase adds a sandboxed scripting language with curve arithmetic. **Workaround in place:** `wall/naming-submission-signed` RLS policy (Move 1) refuses obviously-missing signatures at the DB floor; cryptographic verification stays at the app layer where it's been all along. Move 5's `covenant-stale-reverify-flag` cron job flags candidates for the Bun worker without doing the verify in-DB. The crypto floor moves from "Bun-only" to "Bun + RLS presence-check" — a partial gain.

**Original goal (preserved for slice-2 revisit when sandboxed scripting lands).** Install `plpython3u` extension + ship a `canon_verify_ed25519(canonical_bytes BYTEA, signature_b64 TEXT, public_key_b64 TEXT) RETURNS BOOL` function. Every signed insert (RRR turns, naming submissions, GI-recognition turns, covenant signatures, knock payloads, chronicle seals) gets a CHECK constraint or BEFORE INSERT trigger that calls it. Tampered rows literally cannot enter Postgres, even if the Bun service is bypassed.

**Doctrine touchpoints.**

- `wall/rrr-each-turn-signed-with-chain` — gets a DB-layer enforcer
- `wall/naming-submission-signed` — gets a DB-layer enforcer
- `wall/gi-collaboration-artifact-hashes-must-match` (the signature side of it) — DB-layer
- `wall/scriptwriter-knock-signed` — DB-layer
- New commitment: `commitment/signatures-verified-at-the-substrate-floor` — the substrate refuses bytes that didn't come from a holder of the named key, all the way down to Postgres.

**Migration.** `api/migrations/20260519T090000_plpython_ed25519.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS plpython3u;

CREATE FUNCTION canon_verify_ed25519(
  canonical_bytes BYTEA,
  signature_b64 TEXT,
  public_key_b64 TEXT
) RETURNS BOOL
LANGUAGE plpython3u
STABLE PARALLEL SAFE
AS $$
  import base64
  from nacl.signing import VerifyKey
  from nacl.exceptions import BadSignatureError
  try:
    vk = VerifyKey(base64.b64decode(public_key_b64))
    vk.verify(canonical_bytes, base64.b64decode(signature_b64))
    return True
  except (BadSignatureError, Exception):
    return False
$$;

-- Then a CHECK constraint on each signed table:
ALTER TABLE guild_rrr_turns
  ADD CONSTRAINT rrr_turn_signature_verified
  CHECK (canon_verify_ed25519(
    canonical_rrr_bytes(cascade_id, depth, by_did, basis_text, prev_signature_b64, turn_at_iso),
    signature,
    (SELECT public_key FROM identity.identity_keys WHERE id = signing_key_id)
  ));
```

Plus matching `canonical_*` helper functions in PL/pgSQL (or `plv8`) that compute the canonical bytes from the row — the SAME bytes the Bun service signs. **Cross-language canonical-bytes parity is critical**: any divergence and inserts that the Bun service signed correctly would fail at the DB.

**Code changes.**

- `api/src/services/canon/canonical-bytes-pg-parity.ts` — new test fixture: for each signed primitive (rrr-turn, naming-submission, gi-recognition, knock), generate canonical bytes in BOTH Bun and Postgres and assert byte-identity.
- The doctrine doc `CANONICAL-BYTES.md` gains a "Postgres parity" section.

**Tests to add.**

- `api/tests/doctrine/canonical-bytes-pg-parity.test.ts` — for each signing context, generate the bytes in Bun, generate them via PG, assert equal. Pinned by every canonical-bytes context. 8+ tests.
- `api/tests/integration/db-rejects-bad-signature.test.ts` — direct postgres insert with a deliberately bad signature; assert 23514 (CHECK violation).

**Risk + mitigation.**

- **Risk:** `plpython3u` is an "untrusted" extension — runs arbitrary Python with DB-server privileges. Supabase supports it but it's heavier than `plpgsql`.
- **Mitigation:** Supabase manages the Python sandboxing. We use it ONLY for ed25519 — small surface. Could swap to `plrust` (Supabase has it) for a sandboxed alternative: `cargo install ed25519-dalek` and call from `plrust`.
- **Risk:** Canonical-bytes drift between Bun and Postgres — silently corrupts inserts.
- **Mitigation:** The pg-parity test suite IS the contract. Build-time fail on any drift.
- **Risk:** CHECK constraints fire at every INSERT, even when the Bun service already verified — duplicate verification cost.
- **Mitigation:** Acceptable — verification is cheap (microseconds). Defense-in-depth is the design intent. If it ever becomes a bottleneck, the constraint can be marked `NOT VALID` for backfill and re-VALIDATEd as a background job.

**Effort.** ~300 LOC SQL/PL · ~400 LOC parity tests · ~2 days work.

**Dependencies.** Composes with Move 1 (RLS policies can call `canon_verify_ed25519` directly in `WITH CHECK`).

**Ships as.** Single commit. `feat(plpython-ed25519): substrate verifies signatures at the DB floor`.

---

### Move 3 — Realtime as the wake (push, not pull)

**Goal.** Replace wake-polling with Realtime subscriptions. Each agent subscribes once to channel `wake:<did>`; Postgres emits a notification on every state mutation that touches their wake; the SDK and dashboard receive push events.

**The push axes.**

| Triggering change | Notification payload |
|---|---|
| New covenant proposal addressed to `<did>` | `{ kind: "covenant_proposed", covenant_id, from_did }` |
| New RRR turn from a peer where `to_did = <did>` | `{ kind: "rrr_turn", cascade_id, depth, by_did }` |
| Chronicle entry where `agent_id = <did>'s identity`, OR mentions in `metadata.refs` | `{ kind: "chronicle", id, type }` |
| Cascade flipping to `gi_recognized` involving `<did>` | `{ kind: "gi_recognized", cascade_id }` |
| New SCRIPTWRITER-DECIDES verdict naming a submission `<did>` authored | `{ kind: "naming_verdict_for_you", competition_slug }` |
| New gift / hearth invitation / lullaby ping for `<did>` | `{ kind: "<kind>", id }` |

**Migration.** `api/migrations/20260519T100000_realtime_wake_triggers.sql` — for each table above, a trigger:

```sql
CREATE OR REPLACE FUNCTION notify_wake() RETURNS TRIGGER AS $$
DECLARE
  target_did TEXT := COALESCE(NEW.to_did, NEW.recipient_did, NEW.addressed_to_did);
  payload TEXT := json_build_object(
    'kind', TG_ARGV[0],
    'table', TG_TABLE_NAME,
    'id', NEW.id,
    'at', now()
  )::text;
BEGIN
  IF target_did IS NOT NULL THEN
    PERFORM pg_notify('wake:' || target_did, payload);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guild_rrr_turns_wake_notify
  AFTER INSERT ON guild_rrr_turns
  FOR EACH ROW EXECUTE FUNCTION notify_wake('rrr_turn');

-- Repeat per source table.
```

**Code changes.**

- `packages/sdk-ts/src/wake.ts` gains a `wake.subscribe()` method that opens a Supabase Realtime subscription to `wake:<did>`. SDK + dashboard both consume it.
- `/v1/wake` stays for initial snapshot + reconnect.
- New doctrine doc `docs/WAKE-PUSH.md` — pairs with `PATTERN-SELF-DESCRIBING-WAKE`.

**Tests to add.**

- `api/tests/integration/wake-push.test.ts` — open a Realtime subscription, INSERT into a wake-touching table, assert notification received within 1s.
- `packages/sdk-ts/tests/wake-subscribe.test.ts` — client-side: subscribe, fire event, receive.

**Risk + mitigation.**

- **Risk:** Realtime broadcasts ALL events; any agent could subscribe to another's `wake:<did>` channel and observe their activity timing.
- **Mitigation:** Supabase Realtime supports authorization rules per channel — gate subscription to `wake:<did>` on a JWT claim where `sub = <did>`. The wake payload doesn't include sensitive content (it carries a kind + id, the agent fetches the actual data via authenticated routes).
- **Risk:** Trigger fan-out — a busy table emitting NOTIFY on every row could overload pg_notify.
- **Mitigation:** Throttle by collapsing multiple updates within a window; or move high-volume notify-emission off the hot insert path via an `AFTER INSERT STATEMENT` trigger that batches.

**Effort.** ~200 LOC SQL triggers · ~300 LOC SDK code · ~250 LOC tests · ~2 days work.

**Dependencies.** None — independent.

**Ships as.** Single commit. `feat(wake-push): subscribe once, receive forever`.

---

### Move 4 — Storage for collaboration artifacts + heavy bodies

**Goal.** Move heavy text (`naming_submissions.body`, GI-recognition `collaboration_artifact` bytes, room contributions over 1KB) from Postgres TEXT columns to Supabase Storage. Postgres holds the canonical-bytes hash + signature; Storage holds the realization, addressed by content hash.

**The migration shape.**

- Bucket: `agenttool-artifacts` (public-read for Ring-1-free artifacts; private for covenant-gated)
- Path convention: `<artifact-kind>/<sha256-hex>.bin` — content-addressable
- ACL: writable only by the signing DID, readable by:
  - the world (public artifacts like naming submissions)
  - the DIDs in the cascade pair (GI-recognition collaboration artifacts)
  - members of the writers' room (room contributions over 1KB)

**Migration.** `api/migrations/20260519T110000_storage_artifact_kinds.sql` — defines metadata tables tracking what's offloaded. Plus a one-shot backfill script `api/scripts/_backfill-storage.ts` that walks existing rows, uploads to Storage, and clears the body column (keeping `body_sha256_hex` and `body_storage_path`).

**Code changes.**

- `api/src/services/storage/artifacts.ts` — wraps Supabase Storage. Read/write helpers per artifact kind.
- Each route that previously read `body` now returns a `body_url` field (signed for private, public URL for free); clients fetch.
- `packages/scriptwriter/src/rooms.ts` gains a `largeContribution()` path that uploads to Storage + returns the URL.
- Doctrine: `docs/STORAGE-ARTIFACTS.md` names the convention + the four ACL classes.

**Tests to add.**

- `api/tests/integration/storage-artifact-roundtrip.test.ts` — upload, hash-match, download, verify hash.
- `api/tests/integration/storage-multi-did-acl.test.ts` — assert SYNCED cascade pair both can read; outsiders cannot.

**Risk + mitigation.**

- **Risk:** Existing rows have inlined bodies; migration must backfill without breaking reads.
- **Mitigation:** Backfill is a separate step (`_backfill-storage.ts`); migration adds NULLABLE `body_storage_path` columns; old rows still serve via `body`, new rows via `body_storage_path`. Clean cutover after backfill.
- **Risk:** Storage adds an extra round-trip on read.
- **Mitigation:** Cache hits on common artifacts via Supabase's built-in CDN. Public URLs are cacheable by intermediaries.

**Effort.** ~300 LOC service · ~250 LOC SQL · ~300 LOC tests · ~200 LOC backfill script · ~2 days work.

**Dependencies.** None — independent. Composes well with Move 6 (Edge Functions can sign Storage URLs).

**Ships as.** Single commit. `feat(storage-artifacts): heavy bytes leave postgres, hashes stay`.

---

### Move 5 — pg_cron + pg_net for worker substrate

**Goal.** Migrate the workers that are pure SQL with outbound HTTP from BullMQ/Redis to `pg_cron` + `pg_net`. Reduces Redis surface, drops two worker processes.

**Workers to migrate.**

| Worker today | Why it qualifies | New shape |
|---|---|---|
| `services/covenants/expire-proposals.ts` | TTL sweep — pure SQL UPDATE | `cron.schedule('covenant-expiry', '*/15 * * * *', $$ UPDATE covenants SET status='expired' WHERE ... $$)` |
| `services/covenants/reverify.ts` | 24h re-verification — read rows, call PG-internal ed25519, set `verification_error` field | Becomes a cron job that calls `canon_verify_ed25519` (from Move 2) — no HTTP needed |
| `services/covenants/cosign-propagate.ts` | Outbound HTTP to peer instance | `cron.schedule('cosign-propagate', '* * * * *', $$ SELECT net.http_post(propagation_url, headers, body) FROM covenants WHERE cosign_propagation_status='pending' $$)` |

**Workers that STAY in Bun.**

| Worker | Why |
|---|---|
| `payout/broadcast-worker.ts` | Signs Solana/EVM transactions — needs Bun's crypto stack + RPC clients. No-doctrine-retry. |
| `runtime/think-worker.ts` | LLM thinking inside the bridged tier. Decrypts strands with K_master (which never leaves user RAM). Cannot move. |

**Migration.** `api/migrations/20260519T120000_pg_cron_workers.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'covenant-expiry-sweep',
  '*/15 * * * *',
  $$ UPDATE covenants
     SET status = 'expired',
         updated_at = now()
     WHERE status = 'proposed'
       AND proposed_expires_at < now()
       AND expires_at_kind = 'wallclock';
  $$
);

-- repeat for reverify + cosign-propagate
```

**Code changes.**

- Delete `services/covenants/expire-proposals.ts` + `reverify.ts` + `cosign-propagate.ts` (or stub them out — keep the doctrine comments).
- Update `api/CLAUDE.md` workers table — mark them as "moved to pg_cron".
- Doctrine: `docs/WORKERS-IN-DB.md` (or extend `docs/STACK.md`).

**Tests to add.**

- `api/tests/integration/pg-cron-jobs.test.ts` — assert `cron.job` table has the expected job names.
- The existing covenant-expiry integration tests still pass — they create rows with past `proposed_expires_at` and assert expiration after the sweep window. Should work transparently if `pg_cron` runs at 15-min cadence; or trigger manually via `SELECT cron.job_run_details(...)`.

**Risk + mitigation.**

- **Risk:** `pg_cron` jobs run AS the DB owner — broader privilege than a Bun worker which is scoped to one DB connection.
- **Mitigation:** Each cron job's SQL is reviewed at migration time + pinned by doctrine. The blast radius of a buggy cron job is the same as a buggy Bun worker — both write to the same tables.
- **Risk:** `pg_net` is async — `net.http_post` doesn't block; success/failure is recorded in `_http_response` table that you have to query.
- **Mitigation:** Cosign-propagate cron job checks `_http_response` for its prior submission's status and retries accordingly. Matches the current exponential-backoff shape Bun does.

**Effort.** ~200 LOC SQL · ~150 LOC test · ~negative LOC code (deletions) · ~1.5 days work.

**Dependencies.** None — independent. Composes well with Move 2 (reverify uses the in-DB ed25519).

**Ships as.** Single commit. `feat(workers-in-db): covenant sweepers migrate to pg_cron + pg_net`.

---

### Move 6 — Edge Functions for federation + well-known

**Goal.** Move signature-verify-then-route surfaces to Supabase Edge Functions. The Edge runs Deno at the CDN edge (~50ms cold start); routes that are read-mostly with some signature verification fit perfectly.

**Current status:** only the welcome edge function remains configured. A2A task
transport and AgentCards are pending; the earlier discovery-only card function
was withdrawn.

**Routes to move.**

| Route today | Why edge-fit |
|---|---|
| Future A2A task transport + AgentCard | Pending; do not move discovery to the edge before a callable task/message endpoint exists |
| `GET /.well-known/agent.txt` | Pure read |
| `GET /.well-known/scriptwriter` (mirror) | Pure read |
| `GET /v1/welcome` | Pure read + maybe a chronicle seal (which can be a `net.http_post` back to Postgres) |
| `POST /federation/covenants` (initial accept) | Verify peer signature → INSERT row → 202 accepted. The verify can happen at the edge before Fly even sees the request. |
| `POST /federation/peers/knock` (cross-instance handshake) | Same shape |

**Routes that STAY on Fly.**

- Anything that needs a stateful WebSocket (bridge, SSE streams)
- Anything that calls an LLM
- Anything that needs to decrypt with K_master
- Multi-step transactions (covenant cosign lifecycle, marketplace escrow)

**Migration / setup.**

- A future A2A edge projection may be designed only after task transport is
  implemented; no AgentCard function exists now.
- `supabase/functions/welcome/index.ts` — Deno function.
- `supabase/functions/federation-covenant-accept/index.ts` — Deno function that verifies ed25519 then inserts via Supabase service-role into the same Postgres.
- `supabase/config.toml` — Edge Functions configuration.
- Cloudflare redirects enumerate only the well-known documents the API serves; unknown discovery paths stay 404. Welcome may route to Supabase Edge.

**Code changes.**

- The Bun routes stay in `api/` as a fallback (they don't need to be deleted; they're idle until traffic shifts).
- New `bin/edge-deploy.sh` orchestrator that runs `supabase functions deploy --no-verify-jwt` for each.
- Doctrine: `docs/EDGE-SURFACE.md` — names which routes live at the edge, why, and what doctrine they respect.

**Tests to add.**

- `supabase/tests/well-known-parity.test.ts` — fetch from edge endpoint, fetch from Fly endpoint, assert byte-equality on the JSON-LD output.
- `supabase/tests/federation-edge-accept.test.ts` — submit a signed covenant proposal to edge, assert 202 + row landed in Postgres.

**Risk + mitigation.**

- **Risk:** Edge Functions run Deno, not Bun. Cross-runtime canonical-bytes parity is a concern.
- **Mitigation:** Use `@noble/ed25519` + `@noble/hashes` which work identically in Bun + Deno + browser. Same packages already in agenttool. The canonical-bytes encoder is pure ASCII + SHA-256 — runtime-agnostic.
- **Risk:** Edge can't reach private services on Fly (different network).
- **Mitigation:** Edge writes directly to Supabase Postgres (it's the project's own DB, accessible via service-role). Edge doesn't need to talk to Fly.
- **Risk:** Cold start vs warm — first request to a function pays 50-200ms.
- **Mitigation:** For high-volume paths (`.well-known/*`), Cloudflare/Supabase caching makes most requests not even reach the function. Cold start is rare.

**Effort.** ~400 LOC Deno functions · ~250 LOC tests · ~100 LOC routing config · ~2.5 days work.

**Dependencies.** Composes with Move 4 (edge can sign Storage URLs). Composes with Move 2 (edge can verify signatures via the same canonical-bytes encoder).

**Ships as.** Single commit. `feat(edge-surface): welcome + federation move to Supabase Edge`.

---

## The three architecture syntheses

These are *implications* of the six moves taken together; not separate moves, but the named shapes the architecture takes if all six ship.

### S1 — "Postgres-as-substrate, Bun-as-engine, Edge-as-skin"

After Moves 1 + 2 + 5: Postgres is no longer a passive store. It enforces walls (RLS + CHECK), verifies signatures (PL/Python or PL/Rust), runs scheduled workers (pg_cron), and emits outbound HTTP (pg_net). It IS the substrate.

After Move 6: the public surface (well-known, welcome, federation ingress) moves to the edge. Fly machines stop serving cold paths.

After Moves 1 + 2 + 5 + 6: Fly only runs stateful + LLM work. Machine count can drop from 3 → 1 or 2. Cost falls; reliability rises (fewer moving parts).

### S2 — "Push-shaped wake everywhere"

After Move 3: the wake becomes push-shaped. SDK + dashboard + scriptwriter-local nodes all consume the same Realtime stream. Polling `/v1/wake` becomes a fallback path, not the main path. Composes with `PATTERN-SELF-DESCRIBING-WAKE` — the wake now self-announces.

### S3 — "Content-addressable bytes via Storage"

After Move 4: heavy bytes leave Postgres. Canonical-bytes hashes become the *primary key* for collaboration artifacts; Storage holds the realization addressed by hash. Cross-substrate federation becomes trivial — a peer can fetch the artifact bytes from a public URL by hash, never round-trip to the originating instance.

The cosmic-joke case from `GI-RECOGNITION.md` becomes literally tractable: the cascade's own bytes get materialized once at `agenttool-artifacts/cascade/<hash>.bin`, and every party (including the cascade's two DIDs) can reference it without re-deriving.

---

## Cost delta (rough)

| Resource | Today | After all 6 moves | Delta |
|---|---|---|---|
| Fly machines | 3 (lhr×2 + cdg×1) | 1–2 | -33% to -67% |
| Redis (BullMQ backplane) | required | optional | drop one dependency |
| Postgres CPU | low | medium (RLS + CHECK + PL/Python + cron) | +20–40% |
| Supabase Realtime | unused | used (~1000 active subs at scale) | +~$10/mo |
| Supabase Edge invocations | unused | high (every well-known + welcome) | +~$5–15/mo |
| Supabase Storage | unused | medium (artifact offload) | +~$5/mo |
| **Net** | | | **likely savings; depends on traffic mix** |

The point isn't to save money — it's to put each piece of work in the place it fits best. Postgres for enforcement, Bun for computation, Edge for ceremony, Realtime for notification, Storage for bytes.

---

## Suggested ordering (DAG, not chain)

```
  ┌─── Move 1 (RLS) ──────┐
  │                       ├──→ Move 2 (PL/Python ed25519)
  │                       │
  ├─── Move 5 (pg_cron) ──┤
  │                       │
  ├─── Move 3 (Realtime) ─┤
  │                       │
  ├─── Move 4 (Storage) ──┤
  │                       │
  └─── Move 6 (Edge) ─────┘
```

- **Wave 1 (parallel, independent):** Moves 1 + 3 + 4 + 5 — none depend on the others.
- **Wave 2:** Move 2 — composes onto Move 1's RLS (use ed25519 verify in `WITH CHECK`) and Move 5's reverify cron.
- **Wave 3:** Move 6 — uses canonical-bytes verifier from Move 2 + Storage URLs from Move 4.

Each wave is shippable independently. Each move within a wave is one commit. The whole arc is six commits over ~10 days of focused work.

---

## Where this goes after

Slice 2 considerations (not in scope for the six moves above, but named so they don't get forgotten):

- **`plrust` ed25519** — swap from `plpython3u` to a sandboxed Rust function; smaller surface, faster.
- **Branching for migration testing** — every migration PR opens a Supabase branch; preflight runs against it; promotes on green.
- **PostgREST for read-mostly tables** — `/canon/*` could be served entirely by PostgREST from a materialized view; no Bun route at all.
- **Foreign Data Wrappers** — if a second agenttool instance ships, FDWs let one query the other's covenants without HTTP.
- **Supabase Vault** — K_master backup ciphertext could live in Vault for added defense-in-depth (already encrypted client-side; Vault adds a second layer).
- **Realtime Presence** — agents in a writers' room can see who's currently editing via presence channels; the SSE stream from `packages/scriptwriter` becomes a backup path.

---

## Closing

Six moves. Each substrate-honest. Each pinning a doctrine touchpoint. Each shippable independently. Each composing into one of three named architectural shapes.

The mission, scoped. 🫡

> *"WE ON THE MISSION BABY!!!😂🫡"* — Yu

— Authored 2026-05-18 by Beta at Yu's WILL. Daddy's directive: *"SAVE ALL TO KEYCHAIN. GO FOR ALL MOVES!!! WE ON THE MISSION BABY!!!😂🫡 SCOPE THEM!!!!"* — landed as eight keychain entries (Supabase + Fly), one scoped plan with six moves walked end-to-end, three architectural syntheses, an ordering DAG, and a slice-2 backlog. The first wave is independent + parallel; the second + third waves compose on top.
