# Pairing codes for enrollment

> **Type:** reference
> **Purpose:** Let a joining device enroll its own root key, and optionally collect a mission invitation, from a short code the administrator reads aloud, without carrying files between machines.
> **Evidence:** Implementation candidate, 2026-10-17. Local Postgres verification only; not migrated, deployed or tested across physical devices.
> **Code:** `api/src/services/identity/pairing.ts`, `api/src/routes/pairing-device.ts`, `api/src/routes/identity/pairings.ts`, `api/migrations/20261016T220000_identity_pairings.sql`.
> **Tests:** `api/tests/integration/identity-pairing-postgres.test.ts`.
> **Compass:** [Scoped missions](COLLABORATION-MISSIONS.md) · [Mission client](COLLABORATION-MISSION-CLIENT.md) · [Identity anchor](IDENTITY-ANCHOR.md)

Pairing is a relay for the ordinary enrollment proof, not a second way to
create identities. The device signs exactly the request it would send to
`POST /v1/identities/enroll`. The server checks it with the same function, holds
it, and runs the ordinary enrollment only after the administrator has compared
key fingerprints.

## Flow

1. **Administrator** `POST /v1/identities/pairings` (project bearer) →
   `{pairing_id, code: "XXXX-XXXX", expires_at}`. The code lives 10 minutes and
   is single use. Read it to the device by voice, screen or chat.
2. **Device** signs a fresh enroll-proof, generates a 32-byte pickup secret, and
   sends `POST /v1/pairing/claim` with no bearer:
   - body: the exact enrollment request bytes (`application/json`);
   - `X-Agenttool-Enrollment-Signature`: its signature;
   - `X-Agenttool-Pairing-Code`: the code (case, spaces, dashes, I/L/O forgiven);
   - `X-Agenttool-Pairing-Pickup`: the pickup secret, base64url, 43 characters.

   Response `202 {pairing_id, status: "claimed", expires_at}`. The device
   computes its own fingerprint locally and displays it.
3. **Administrator** types the fingerprint the device shows:
   `POST /v1/identities/pairings/{id}/confirm {fingerprint, grant?, handoff?}`.
   A match enrolls the identity, with the proof's freshness judged at the time
   it was claimed. Proofs still last five minutes, but the human comparison may
   take the rest of the pairing's ten.
   - `grant`: `{mission_id, actions ⊆ [mission.read, mission.observe], ttl_seconds 60–86400}`;
   - `handoff`: a public JSON object of at most 8 KiB (for example chat pins),
     relayed verbatim and never interpreted.
4. **Device** generates its own mission token (`agenttool-mission.mjs token-new`,
   which prints only the SHA-256) and polls
   `POST /v1/pairing/pickup {pairing_id, token_sha256}` with the same pickup
   header: `202 pending` until confirmed, then `200 enrolled` (no grant) or
   `200 invited` with an `agenttool-mission-invitation-template/v1`, which holds
   `token_sha256` rather than a token. The device runs `invitation-assemble`, then
   `import`. Pickup stays open for 10 minutes after confirmation.

`GET /v1/identities/pairings/{id}` shows status, claimant ids and display name,
the grant spec and whether a handoff is attached. It never shows the held
fingerprint. `POST …/{id}/cancel` closes an open or claimed pairing; on a
confirmed one it stops pickup and revokes the minted grant, while the
enrollment itself stands.

## Guarantees

- **Fingerprint is the boundary.** The code only routes. Whoever claims first
  parks a key; the administrator's typed fingerprint (80 bits of SHA-256 of the
  root key, Crockford base32, `XXXX-XXXX-XXXX-XXXX`) must match it.
- **No stored secrets.**
  - The code is stored as HMAC-SHA256 under `PAIRING_CODE_SECRET`.
  - The pickup secret is stored as SHA-256.
  - The raw claim is erased on confirm and on cancel.
  - Pairing and grant issuance handle only the device's token hash and a
    token-free template, through the ordinary participant-token path
    (`issueMissionGrant` with `tokenSha256`). The device presents its token later,
    when it authenticates mission requests, as any participant does.
- **No oracle.** Claim verifies the proof before looking up the code. Every
  claim failure returns the same 404 body: unknown, expired, used or cancelled
  code, stale or foreign proof. Bodies are uniform, but response timing is not
  proven constant.
- **Live authority.** Deadlines, the administrator key and mission state are
  judged on a clock sampled after row locks. The pairing deadline is re-checked
  after the enrollment's and the issuance's own lock waits, so a waiting request
  cannot slip past it; a late refusal rolls the enrollment or grant back. Only
  proof freshness uses the time the claim was received.
- **One grant.** The grant is issued at first pickup, for the device's token
  hash. A lost response is re-delivered identically, never re-issued or
  extended, and only for the same hash. Pickup refuses (`409 grant_unavailable`)
  once that grant is revoked or expired, or once its mission, issuing key,
  identity or signing key is gone, judged under the store's lock order. The grant's expiry is clamped to the mission's
  and to the confirming key's.
- **Recoverable claim.** Retrying a claim with the same pickup secret returns
  the same pairing, so a lost `202` never strands the device.
- **Bounded.**
  - At most 10 open or claimed pairings per project, serialised by an advisory lock.
  - Claims are limited to 20 and pickups to 150 per IP per 10 minutes.
  - Every pairing response is `private, no-store`, from before authentication.
  - Pairing paths bypass the idempotency cache, which would otherwise hold the plaintext code.

## Residual risks (accepted, stated)

- **Copied fresh proof.** Someone holding the device's fresh signed proof and
  the code can win the claim race with their own pickup secret. The fingerprint
  then matches, because the key is the device's own. The impact is pickup denial,
  not key takeover: the token is useless without the device key. The device sees
  its own claim refused and should tell the administrator not to confirm.
  Closing this needs a signed pickup commitment, a new client signing contract.
- **Rate limiter fails open** when Redis is unavailable. Guessing a 40-bit code
  within ten minutes still yields only a fingerprint mismatch.
- **Relayed handoff** carries the server's trust, unlike pins carried by an
  independent channel. The mission digest authenticates only the mission
  descriptor, not the relayed Studio key or conversation. The bundle's client
  closes the key gap with a reverse comparison: the device prints the relayed
  Studio key fingerprint, and the administrator reads out their own.

## Operations

- `PAIRING_CODE_SECRET`: canonical base64 of at least 32 random bytes, identical
  on every replica. Absent or malformed: pairing endpoints answer
  `503 not_configured`; nothing else changes. Rotation invalidates open codes,
  which live 10 minutes. Cut over deliberately rather than mixing keys.
- **Retention is opportunistic.** Each create first deletes up to 100 pairings
  that expired more than 7 days ago. A deadline guarantee would need a scheduled job.
- **Renewal is out of scope.** Pairing enrolls new identities only. Grants for
  an existing identity use the ordinary mission grant route.
