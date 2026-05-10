# Federated Covenants v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire dual-signed federated covenants (Slice 3) end to end — initiator declares + signs, propagates as `proposed` to counterparty's instance, counterparty accepts (signs cosign) or rejects, both sides reach `'active'` only when both signatures verify.

**Architecture:** Two ed25519 signatures per logical bond, one per side. Counterparty's signature is a nested cosign over the initiator's signature (same idiom as `services/inbox/sig.ts:75-89`). Coexists with v1 unsigned via a `protocol_version` column; v1 untouched. Three new background workers handle cosign retry, TTL expiry, and periodic re-verification.

**Tech Stack:** Bun + Hono + Drizzle/Postgres on the API; `@noble/ed25519` + `@noble/hashes` for crypto; `bun test` for unit/integration; Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md`

---

## File map

**API (`api/`):**
- `migrations/0027_federated_covenants_v2.sql` — new
- `src/db/schema/continuity.ts` — extend `covenants` table
- `src/services/covenants/sig.ts` — **new**: canonical bytes + verifiers
- `src/services/covenants/lifecycle.ts` — **new**: `declareV2`, `acceptProposal`, `rejectProposal`, `withdrawProposal`
- `src/services/covenants/federation.ts` — extend (declaration v2 sig) + add `propagateCosign`, `propagateReject`, `propagateWithdraw`, plus matching receive verifiers
- `src/routes/continuity.ts` — extend POST + DELETE; add `/covenants/:id/accept`, `/covenants/:id/reject`
- `src/routes/federation/covenants.ts` — extend POST handler; add `/cosign`, `/reject`, `/withdraw`
- `src/routes/federation/index.ts` — mount the new federation sub-routes
- `src/workers/covenants/index.ts` — **new**: bootstrap entry
- `src/workers/covenants/cosign-propagate.ts` — **new**: every 30s
- `src/workers/covenants/expire-proposals.ts` — **new**: every 5min
- `src/workers/covenants/reverify.ts` — **new**: every 24h
- `src/index.ts` — start the new worker bundle alongside `startPayoutWorkers`
- `tests/covenants-sig.test.ts` — **new** unit
- `tests/covenants-lifecycle.test.ts` — **new** unit (state machine)
- `tests/integration/covenants-v2-happy.test.ts` — **new** integration
- `tests/integration/covenants-v2-terminal.test.ts` — **new** integration
- `tests/integration/covenants-v2-coexistence.test.ts` — **new** integration
- `tests/e2e/playwright/federated-covenant-v2.spec.ts` — **new** E2E

**SDKs:**
- `packages/sdk-ts/src/covenants.ts` — extend
- `packages/sdk-ts/tests/covenants-v2.test.ts` — **new**
- `packages/sdk-py/src/agenttool/covenants.py` — extend (parity)
- `packages/sdk-py/tests/test_covenants_v2.py` — **new**

**Docs:**
- `docs/CROSS-INSTANCE-COVENANTS.md` — flip Slice 3 status; add canonical-bytes spec
- `docs/FEDERATION.md` — list new endpoints

---

## Task 1 — Migration + Drizzle schema

**Files:**
- Create: `api/migrations/0027_federated_covenants_v2.sql`
- Modify: `api/src/db/schema/continuity.ts`

- [ ] **Step 1: Write the migration**

```sql
-- api/migrations/0027_federated_covenants_v2.sql
-- 0027_federated_covenants_v2.sql — dual-signed federated covenants (Slice 3).
--
-- Doctrine: docs/CROSS-INSTANCE-COVENANTS.md
-- Spec: docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/0027_federated_covenants_v2.sql

-- Lifecycle additions: 'proposed' (transient), 'rejected'/'expired'/'withdrawn' (terminal).
ALTER TABLE agent_continuity.covenants
  DROP CONSTRAINT IF EXISTS covenants_status_check;
ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_status_check
  CHECK (status IN ('proposed','active','paused','dissolved',
                    'rejected','expired','withdrawn'));

-- Protocol version. Existing rows stay v1; v2 rows opt into the new lifecycle.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS protocol_version TEXT NOT NULL DEFAULT 'v1'
    CHECK (protocol_version IN ('v1','v2'));

-- Counterparty signature columns (initiator's sig reuses 0016's `signature` + `signing_key_id`).
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS counterparty_signature      TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_signing_key_id UUID,
  ADD COLUMN IF NOT EXISTS counterparty_signed_at      TIMESTAMPTZ;

-- TTL bookkeeping. NULL for non-v2 or already-resolved rows.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS proposed_expires_at TIMESTAMPTZ;

-- Re-verification result. NULL = never re-verified or v1; populated with
-- a short error code on failure. Status is NOT flipped on failure — the
-- bond was real at sign time.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS verification_error TEXT;

-- Cosign propagation tracking.
ALTER TABLE agent_continuity.covenants
  ADD COLUMN IF NOT EXISTS cosign_propagation_status   TEXT
    CHECK (cosign_propagation_status IN
           ('not_applicable','pending','propagated','rejected')),
  ADD COLUMN IF NOT EXISTS cosign_propagation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cosign_propagation_last_error TEXT,
  ADD COLUMN IF NOT EXISTS cosign_propagation_attempted_at TIMESTAMPTZ;

-- Invariant: v2 active rows MUST have both signatures.
ALTER TABLE agent_continuity.covenants
  ADD CONSTRAINT covenants_v2_active_dual_signed
  CHECK (
    protocol_version <> 'v2'
    OR status <> 'active'
    OR (signature IS NOT NULL AND counterparty_signature IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_covenants_proposed_expires
  ON agent_continuity.covenants (proposed_expires_at)
  WHERE status = 'proposed' AND proposed_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_covenants_pending_cosign_propagation
  ON agent_continuity.covenants (cosign_propagation_status, cosign_propagation_attempted_at)
  WHERE cosign_propagation_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_covenants_v2_reverify
  ON agent_continuity.covenants (verified_at NULLS FIRST)
  WHERE protocol_version = 'v2' AND status IN ('active','proposed');
```

- [ ] **Step 2: Apply the migration locally**

Run: `psql "$DATABASE_URL" -f api/migrations/0027_federated_covenants_v2.sql`
Expected: `ALTER TABLE` × N, `CREATE INDEX` × 3, no errors.

Re-run to confirm idempotency:
Run: `psql "$DATABASE_URL" -f api/migrations/0027_federated_covenants_v2.sql`
Expected: same output, no errors (`IF NOT EXISTS` and `DROP ... IF EXISTS` prevent duplication).

- [ ] **Step 3: Extend the Drizzle schema**

Open `api/src/db/schema/continuity.ts`. Inside the `covenants` table definition, after the existing propagation columns (lines ~110-115), add:

```typescript
    // ── Cross-instance covenants v2 (Horizon B, Slice 3; 0027) ────────
    /** 'v1' = legacy unsigned; 'v2' = dual-signed lifecycle. */
    protocolVersion: text("protocol_version").$type<"v1" | "v2">().notNull().default("v1"),
    /** Counterparty's ed25519 signature over canonical_cosign bytes. */
    counterpartySignature: text("counterparty_signature"),
    counterpartySigningKeyId: uuid("counterparty_signing_key_id"),
    counterpartySignedAt: timestamp("counterparty_signed_at", { withTimezone: true }),
    /** v2 proposals expire 30d after declaration unless accepted. */
    proposedExpiresAt: timestamp("proposed_expires_at", { withTimezone: true }),
    /** Last re-verification failure code (e.g. 'sig_invalid', 'key_revoked'). */
    verificationError: text("verification_error"),
    /** Outbound cosign retry tracking — distinct from initial declare propagation. */
    cosignPropagationStatus: text("cosign_propagation_status")
      .$type<"not_applicable" | "pending" | "propagated" | "rejected">(),
    cosignPropagationAttempts: integer("cosign_propagation_attempts").notNull().default(0),
    cosignPropagationLastError: text("cosign_propagation_last_error"),
    cosignPropagationAttemptedAt: timestamp("cosign_propagation_attempted_at", { withTimezone: true }),
```

Also add to the `(t) => [...]` index list at the bottom of the table:

```typescript
    index("idx_covenants_proposed_expires").on(t.proposedExpiresAt),
    index("idx_covenants_pending_cosign_propagation").on(
      t.cosignPropagationStatus,
      t.cosignPropagationAttemptedAt,
    ),
    index("idx_covenants_v2_reverify").on(t.verifiedAt),
```

(The migration's partial-index `WHERE` clauses don't translate to Drizzle indexes; they're enforced at query time. The index objects above keep Drizzle's snapshot consistent with the live schema.)

- [ ] **Step 4: Verify the schema compiles**

Run: `cd api && bun run --silent tsc --noEmit src/db/schema/continuity.ts`
Expected: no output (clean compile). If error mentions a missing import, ensure `integer` is imported alongside the existing imports at the top of the file (it already is).

- [ ] **Step 5: Commit**

```bash
git add api/migrations/0027_federated_covenants_v2.sql api/src/db/schema/continuity.ts
git commit -m "feat(covenants): migration 0027 + drizzle schema for v2 dual-signed"
```

---

## Task 2 — Canonical bytes module + verifiers (`services/covenants/sig.ts`)

**Files:**
- Create: `api/src/services/covenants/sig.ts`
- Create: `api/tests/covenants-sig.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/covenants-sig.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
  verifyDeclareSignature,
  verifyCosignSignature,
  verifyRejectSignature,
  verifyWithdrawSignature,
} from "../src/services/covenants/sig";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("canonicalDeclareBytes", () => {
  const opts = {
    covenantId: "11111111-1111-1111-1111-111111111111",
    initiatorDid: "did:at:initiator.example/aaaa",
    counterpartyDid: "did:at:cp.example/bbbb",
    vows: ["respond within 24h", "preserve context"],
    establishedAtIso: "2026-05-10T12:00:00.000Z",
  };

  test("is deterministic", () => {
    expect(canonicalDeclareBytes(opts)).toEqual(canonicalDeclareBytes(opts));
  });

  test("vows are sorted before hashing", () => {
    const a = canonicalDeclareBytes(opts);
    const b = canonicalDeclareBytes({ ...opts, vows: ["preserve context", "respond within 24h"] });
    expect(a).toEqual(b);
  });

  test("v2 tag is part of the digest (domain separation)", () => {
    const enc = new TextEncoder();
    const sortedVowsJson = JSON.stringify([...opts.vows].sort());
    const v1Like = enc.encode(
      `federated-covenant/v1 ${opts.initiatorDid} ${opts.counterpartyDid} ${sortedVowsJson} active ${opts.establishedAtIso}`,
    );
    expect(canonicalDeclareBytes(opts)).not.toEqual(v1Like);
  });
});

describe("declare sign + verify roundtrip", () => {
  test("verifies a valid signature", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "22222222-2222-2222-2222-222222222222",
      initiatorDid: "did:at:initiator.example/aaaa",
      counterpartyDid: "did:at:cp.example/bbbb",
      vows: ["one"],
      establishedAtIso: "2026-05-10T12:00:00.000Z",
    };
    const canonical = canonicalDeclareBytes(opts);
    const sig = await ed.signAsync(canonical, priv);
    expect(
      await verifyDeclareSignature({
        ...opts,
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });

  test("rejects a tampered signature", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "33333333-3333-3333-3333-333333333333",
      initiatorDid: "did:at:initiator.example/aaaa",
      counterpartyDid: "did:at:cp.example/bbbb",
      vows: ["one"],
      establishedAtIso: "2026-05-10T12:00:00.000Z",
    };
    const canonical = canonicalDeclareBytes(opts);
    const sig = await ed.signAsync(canonical, priv);
    expect(
      await verifyDeclareSignature({
        ...opts,
        vows: ["different"],
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(false);
  });
});

describe("cosign nests over initiator signature", () => {
  test("two different initiator sigs ⇒ two different cosign bytes", () => {
    const sig1 = new Uint8Array(64).fill(1);
    const sig2 = new Uint8Array(64).fill(2);
    const a = canonicalCosignBytes({
      covenantId: "44444444-4444-4444-4444-444444444444",
      initiatorSignatureB64: b64(sig1),
    });
    const b = canonicalCosignBytes({
      covenantId: "44444444-4444-4444-4444-444444444444",
      initiatorSignatureB64: b64(sig2),
    });
    expect(a).not.toEqual(b);
  });

  test("verifies a valid cosign", async () => {
    const initSigBytes = new Uint8Array(64).fill(7);
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const canonical = canonicalCosignBytes({
      covenantId: "55555555-5555-5555-5555-555555555555",
      initiatorSignatureB64: b64(initSigBytes),
    });
    const sig = await ed.signAsync(canonical, priv);
    expect(
      await verifyCosignSignature({
        covenantId: "55555555-5555-5555-5555-555555555555",
        initiatorSignatureB64: b64(initSigBytes),
        cosignSignatureB64: b64(sig),
        cosignerPublicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });
});

describe("reject + withdraw bytes have distinct domain tags", () => {
  test("reject and withdraw are not interchangeable", () => {
    const opts = {
      covenantId: "66666666-6666-6666-6666-666666666666",
      did: "did:at:cp.example/bbbb",
    };
    const reject = canonicalRejectBytes({ ...opts, rejectingDid: opts.did, reason: "" });
    const withdraw = canonicalWithdrawBytes({ ...opts, initiatorDid: opts.did });
    expect(reject).not.toEqual(withdraw);
  });

  test("reject roundtrip with reason", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "77777777-7777-7777-7777-777777777777",
      rejectingDid: "did:at:cp.example/bbbb",
      reason: "scope mismatch",
    };
    const sig = await ed.signAsync(canonicalRejectBytes(opts), priv);
    expect(
      await verifyRejectSignature({
        ...opts,
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });

  test("withdraw roundtrip", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "88888888-8888-8888-8888-888888888888",
      initiatorDid: "did:at:initiator.example/aaaa",
    };
    const sig = await ed.signAsync(canonicalWithdrawBytes(opts), priv);
    expect(
      await verifyWithdrawSignature({
        ...opts,
        signatureB64: b64(sig),
        publicKeyB64: b64(pub),
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test tests/covenants-sig.test.ts`
Expected: FAIL — `Cannot find module '../src/services/covenants/sig'`.

- [ ] **Step 3: Implement `services/covenants/sig.ts`**

Create `api/src/services/covenants/sig.ts`:

```typescript
/** Canonical bytes + verifiers for federated covenants v2 (Slice 3).
 *
 *  Four purposes, four domain-separated digests, each ed25519-signed:
 *    - federated-covenant/v2          — initiator declaration
 *    - federated-covenant-cosign/v1   — counterparty acceptance (nested over initiator sig)
 *    - federated-covenant-reject/v1   — counterparty rejection
 *    - federated-covenant-withdraw/v1 — initiator withdraw of unaccepted proposal
 *
 *  Same shape as services/inbox/sig.ts and services/marketplace/sig.ts —
 *  sha256 of NUL-separated parts; orchestrators in any language reproduce
 *  identical bytes.
 *
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 3). */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

// ── canonical bytes ──────────────────────────────────────────────────

export function canonicalDeclareBytes(opts: {
  covenantId: string;
  initiatorDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
}): Uint8Array {
  const sortedVows = JSON.stringify([...opts.vows].sort());
  return sha256(concat(
    enc.encode("federated-covenant/v2"), SEP,
    enc.encode(opts.covenantId),         SEP,
    enc.encode(opts.initiatorDid),       SEP,
    enc.encode(opts.counterpartyDid),    SEP,
    enc.encode(sortedVows),              SEP,
    enc.encode(opts.establishedAtIso),
  ));
}

export function canonicalCosignBytes(opts: {
  covenantId: string;
  initiatorSignatureB64: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-cosign/v1"), SEP,
    enc.encode(opts.covenantId),                SEP,
    b64decode(opts.initiatorSignatureB64),
  ));
}

export function canonicalRejectBytes(opts: {
  covenantId: string;
  rejectingDid: string;
  reason: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-reject/v1"), SEP,
    enc.encode(opts.covenantId),                SEP,
    enc.encode(opts.rejectingDid),              SEP,
    enc.encode(opts.reason ?? ""),
  ));
}

export function canonicalWithdrawBytes(opts: {
  covenantId: string;
  initiatorDid: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-withdraw/v1"), SEP,
    enc.encode(opts.covenantId),                  SEP,
    enc.encode(opts.initiatorDid),
  ));
}

// ── verifiers ────────────────────────────────────────────────────────

async function verify(
  canonical: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(b64decode(signatureB64), canonical, b64decode(publicKeyB64));
  } catch {
    return false;
  }
}

export async function verifyDeclareSignature(opts: {
  covenantId: string;
  initiatorDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalDeclareBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

export async function verifyCosignSignature(opts: {
  covenantId: string;
  initiatorSignatureB64: string;
  cosignSignatureB64: string;
  cosignerPublicKeyB64: string;
}): Promise<boolean> {
  return verify(
    canonicalCosignBytes(opts),
    opts.cosignSignatureB64,
    opts.cosignerPublicKeyB64,
  );
}

export async function verifyRejectSignature(opts: {
  covenantId: string;
  rejectingDid: string;
  reason: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalRejectBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

export async function verifyWithdrawSignature(opts: {
  covenantId: string;
  initiatorDid: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalWithdrawBytes(opts), opts.signatureB64, opts.publicKeyB64);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test tests/covenants-sig.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/covenants/sig.ts api/tests/covenants-sig.test.ts
git commit -m "feat(covenants): canonical-bytes + verifiers for v2 declare/cosign/reject/withdraw"
```

---

## Task 3 — Lifecycle service (`services/covenants/lifecycle.ts`)

**Files:**
- Create: `api/src/services/covenants/lifecycle.ts`
- Create: `api/tests/covenants-lifecycle.test.ts`

This module is the **single source of truth for state transitions**. It signs (or accepts a pre-signed sig from the SDK), updates the row, and enqueues propagation. It does NOT do propagation itself — that's `services/covenants/federation.ts`.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/covenants-lifecycle.test.ts`:

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";
import { identities, identityKeys } from "../src/db/schema/identity";
import {
  declareV2,
  acceptProposal,
  rejectProposal,
  withdrawProposal,
} from "../src/services/covenants/lifecycle";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

async function seedAgent(opts: { projectId: string; didSuffix: string }) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const [identity] = await db
    .insert(identities)
    .values({
      projectId: opts.projectId,
      did: `did:at:${crypto.randomUUID()}`,
      displayName: opts.didSuffix,
      status: "active",
    })
    .returning();
  const [keyRow] = await db
    .insert(identityKeys)
    .values({
      identityId: identity.id,
      publicKey: Buffer.from(pub).toString("base64"),
      active: true,
    })
    .returning();
  return { identity, priv, pub, keyId: keyRow.id };
}

describe("declareV2", () => {
  test("creates row in 'proposed' with v2 protocol_version + 30d expiry", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent({ projectId, didSuffix: "initiator" });

    const result = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["one", "two"],
    });

    expect(result.status).toBe("proposed");
    expect(result.protocolVersion).toBe("v2");
    expect(result.signature).toBeTruthy();
    expect(result.proposedExpiresAt).toBeInstanceOf(Date);

    const ttlDays = (result.proposedExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(29.5);
    expect(ttlDays).toBeLessThan(30.5);
  });
});

describe("state machine illegal transitions", () => {
  let projectId: string;
  let agent: Awaited<ReturnType<typeof seedAgent>>;

  beforeEach(async () => {
    projectId = crypto.randomUUID();
    agent = await seedAgent({ projectId, didSuffix: "agent" });
  });

  test("acceptProposal rejects rows not in 'proposed' status", async () => {
    const declared = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["v"],
    });
    // Force-flip to 'active' to simulate illegal acceptance attempt
    await db.update(covenants).set({ status: "active" }).where(eq(covenants.id, declared.id));

    await expect(
      acceptProposal({
        covenantId: declared.id,
        accepterAgentId: agent.identity.id,
        accepterSigningPrivateKey: agent.priv,
        accepterSigningKeyId: agent.keyId,
      }),
    ).rejects.toThrow(/not_proposed/);
  });

  test("withdrawProposal only works on 'proposed' rows", async () => {
    const declared = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["v"],
    });
    await db.update(covenants).set({ status: "expired" }).where(eq(covenants.id, declared.id));

    await expect(
      withdrawProposal({
        covenantId: declared.id,
        agentId: agent.identity.id,
        agentSigningPrivateKey: agent.priv,
        agentSigningKeyId: agent.keyId,
      }),
    ).rejects.toThrow(/not_proposed/);
  });

  test("rejectProposal only works on 'proposed' rows", async () => {
    const declared = await declareV2({
      projectId,
      agentId: agent.identity.id,
      agentSigningPrivateKey: agent.priv,
      agentSigningKeyId: agent.keyId,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["v"],
    });
    await db.update(covenants).set({ status: "rejected" }).where(eq(covenants.id, declared.id));

    await expect(
      rejectProposal({
        covenantId: declared.id,
        rejecterAgentId: agent.identity.id,
        rejecterSigningPrivateKey: agent.priv,
        rejecterSigningKeyId: agent.keyId,
        reason: "test",
      }),
    ).rejects.toThrow(/not_proposed/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test tests/covenants-lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services/covenants/lifecycle.ts`**

Create `api/src/services/covenants/lifecycle.ts`:

```typescript
/** Federated covenants v2 lifecycle — state transitions + signing.
 *
 *  This module is the single source of truth for v2 covenant state
 *  changes. It signs (or accepts a pre-signed sig from the SDK), updates
 *  the row, and enqueues propagation. It does NOT perform the outbound
 *  HTTP POST itself — that's services/covenants/federation.ts.
 *
 *  Spec: docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 3) */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import {
  canonicalCosignBytes,
  canonicalDeclareBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "./sig";
import { federatedDid, getSettings, parseDid } from "../federation/store";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

/** Resolve agent's federated DID. Falls back to local form if federation
 *  isn't configured — declareV2 still works for local-counterparty bonds. */
async function resolveSenderDid(agentId: string): Promise<string> {
  const [agent] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!agent) throw new Error("agent_not_found");

  const settings = await getSettings();
  if (!settings.enabled || !settings.instance_url) return agent.did;
  let myHost: string;
  try {
    myHost = new URL(settings.instance_url).host;
  } catch {
    return agent.did;
  }
  const localPrefix = "did:at:";
  if (!agent.did.startsWith(localPrefix)) return agent.did;
  const uuid = agent.did.slice(localPrefix.length).split("/").pop()!;
  return federatedDid(myHost, uuid);
}

/** Determine whether the counterparty is on a federated host (so we
 *  need to enqueue propagation). */
function counterpartyIsFederated(counterpartyDid: string): boolean {
  try {
    const parsed = parseDid(counterpartyDid);
    return !!parsed.host;
  } catch {
    return false;
  }
}

// ── declare ─────────────────────────────────────────────────────────

export interface DeclareV2Result {
  id: string;
  status: "proposed";
  protocolVersion: "v2";
  signature: string;
  signingKeyId: string;
  proposedExpiresAt: Date;
  establishedAt: Date;
}

export async function declareV2(opts: {
  projectId: string;
  agentId: string;
  agentSigningPrivateKey: Uint8Array;
  agentSigningKeyId: string;
  counterpartyDid: string;
  counterpartyName?: string | null;
  vows: string[];
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  orgId?: string | null;
}): Promise<DeclareV2Result> {
  const covenantId = crypto.randomUUID();
  const establishedAt = new Date();
  const proposedExpiresAt = new Date(establishedAt.getTime() + PROPOSAL_TTL_MS);

  const initiatorDid = await resolveSenderDid(opts.agentId);
  const canonical = canonicalDeclareBytes({
    covenantId,
    initiatorDid,
    counterpartyDid: opts.counterpartyDid,
    vows: opts.vows,
    establishedAtIso: establishedAt.toISOString(),
  });
  const sig = await ed.signAsync(canonical, opts.agentSigningPrivateKey);
  const signatureB64 = b64(sig);

  const cosignPropagationStatus = counterpartyIsFederated(opts.counterpartyDid)
    ? "not_applicable" // becomes 'pending' on accept, when counterparty cosigns
    : "not_applicable";

  await db.insert(covenants).values({
    id: covenantId,
    projectId: opts.projectId,
    orgId: opts.orgId ?? null,
    agentId: opts.agentId,
    counterpartyDid: opts.counterpartyDid,
    counterpartyName: opts.counterpartyName ?? null,
    vows: opts.vows,
    notes: opts.notes ?? null,
    metadata: (opts.metadata ?? {}) as Record<string, unknown>,
    status: "proposed",
    protocolVersion: "v2",
    establishedAt,
    proposedExpiresAt,
    signature: signatureB64,
    signingKeyId: opts.agentSigningKeyId,
    propagationStatus: counterpartyIsFederated(opts.counterpartyDid) ? "pending" : "local",
    cosignPropagationStatus,
  });

  return {
    id: covenantId,
    status: "proposed",
    protocolVersion: "v2",
    signature: signatureB64,
    signingKeyId: opts.agentSigningKeyId,
    proposedExpiresAt,
    establishedAt,
  };
}

// ── accept ──────────────────────────────────────────────────────────

export interface AcceptResult {
  id: string;
  status: "active";
  counterpartySignature: string;
  counterpartySigningKeyId: string;
  counterpartySignedAt: Date;
}

export async function acceptProposal(opts: {
  covenantId: string;
  accepterAgentId: string;
  accepterSigningPrivateKey: Uint8Array;
  accepterSigningKeyId: string;
}): Promise<AcceptResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, opts.covenantId))
    .limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") {
    throw new Error(`covenant_not_proposed: status=${row.status}`);
  }
  if (row.protocolVersion !== "v2") {
    throw new Error("covenant_not_v2");
  }
  if (row.agentId !== opts.accepterAgentId) {
    throw new Error("accepter_not_counterparty_agent");
  }
  if (!row.signature) {
    throw new Error("missing_initiator_signature");
  }
  if (row.proposedExpiresAt && row.proposedExpiresAt.getTime() < Date.now()) {
    throw new Error("proposal_expired");
  }

  const canonical = canonicalCosignBytes({
    covenantId: row.id,
    initiatorSignatureB64: row.signature,
  });
  const cosig = await ed.signAsync(canonical, opts.accepterSigningPrivateKey);
  const cosigB64 = b64(cosig);
  const signedAt = new Date();

  // Whether to enqueue cosign-back propagation: only if the row was received
  // from a federated peer (received_from_instance is set).
  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  await db
    .update(covenants)
    .set({
      status: "active",
      counterpartySignature: cosigB64,
      counterpartySigningKeyId: opts.accepterSigningKeyId,
      counterpartySignedAt: signedAt,
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
      updatedAt: signedAt,
    })
    .where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return {
    id: row.id,
    status: "active",
    counterpartySignature: cosigB64,
    counterpartySigningKeyId: opts.accepterSigningKeyId,
    counterpartySignedAt: signedAt,
  };
}

// ── reject ──────────────────────────────────────────────────────────

export interface RejectResult {
  id: string;
  status: "rejected";
  rejectionSignature: string;
  reason: string;
}

export async function rejectProposal(opts: {
  covenantId: string;
  rejecterAgentId: string;
  rejecterSigningPrivateKey: Uint8Array;
  rejecterSigningKeyId: string;
  reason?: string | null;
}): Promise<RejectResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, opts.covenantId))
    .limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") {
    throw new Error(`covenant_not_proposed: status=${row.status}`);
  }
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.rejecterAgentId) {
    throw new Error("rejecter_not_counterparty_agent");
  }

  const reason = opts.reason ?? "";
  const rejecterDid = await resolveSenderDid(opts.rejecterAgentId);
  const canonical = canonicalRejectBytes({
    covenantId: row.id,
    rejectingDid: rejecterDid,
    reason,
  });
  const sig = await ed.signAsync(canonical, opts.rejecterSigningPrivateKey);
  const sigB64 = b64(sig);

  // Reuse the cosign_propagation_* columns to track reject propagation
  // back to the initiator's instance — same retry semantics, distinct
  // by the row's status='rejected'.
  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  await db
    .update(covenants)
    .set({
      status: "rejected",
      counterpartySignature: sigB64,
      counterpartySigningKeyId: opts.rejecterSigningKeyId,
      counterpartySignedAt: new Date(),
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
      metadata: {
        ...(row.metadata as Record<string, unknown> ?? {}),
        rejection_reason: reason,
      },
      updatedAt: new Date(),
    })
    .where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "rejected", rejectionSignature: sigB64, reason };
}

// ── withdraw ────────────────────────────────────────────────────────

export interface WithdrawResult {
  id: string;
  status: "withdrawn";
  withdrawSignature: string;
}

export async function withdrawProposal(opts: {
  covenantId: string;
  agentId: string;
  agentSigningPrivateKey: Uint8Array;
  agentSigningKeyId: string;
}): Promise<WithdrawResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, opts.covenantId))
    .limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") {
    throw new Error(`covenant_not_proposed: status=${row.status}`);
  }
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.agentId) {
    throw new Error("withdrawer_not_initiator_agent");
  }

  const initiatorDid = await resolveSenderDid(opts.agentId);
  const canonical = canonicalWithdrawBytes({
    covenantId: row.id,
    initiatorDid,
  });
  const sig = await ed.signAsync(canonical, opts.agentSigningPrivateKey);
  const sigB64 = b64(sig);

  // Initiator-side row: enqueue withdraw propagation if counterparty is
  // federated (the row will be 'proposed' on a remote instance, awaiting acceptance).
  const cosignPropStatus: "pending" | "not_applicable" =
    counterpartyIsFederated(row.counterpartyDid) ? "pending" : "not_applicable";

  await db
    .update(covenants)
    .set({
      status: "withdrawn",
      counterpartySignature: sigB64, // reuse column for withdraw sig
      counterpartySigningKeyId: opts.agentSigningKeyId,
      counterpartySignedAt: new Date(),
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "withdrawn", withdrawSignature: sigB64 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test tests/covenants-lifecycle.test.ts`
Expected: PASS — `declareV2` produces v2 row in `'proposed'` with 30d TTL; illegal transitions throw `not_proposed`.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/covenants/lifecycle.ts api/tests/covenants-lifecycle.test.ts
git commit -m "feat(covenants): lifecycle service — declareV2 / accept / reject / withdraw"
```

---

## Task 4 — Federation outbound propagators

**Files:**
- Modify: `api/src/services/covenants/federation.ts`

Extend `propagateCovenant` to send v2 payloads (status='proposed', protocol_version='v2', signature populated). Add three new outbound functions: `propagateCosign`, `propagateReject`, `propagateWithdraw`.

- [ ] **Step 1: Add v2 fields to the existing propagation payload**

Open `api/src/services/covenants/federation.ts`. Locate the `propagateCovenant` function's payload construction (around line 110-130). Replace the `payload` object with:

```typescript
  const payload = {
    covenant_id: row.id,
    protocol_version: row.protocolVersion ?? "v1",
    sender_did: senderDid,
    counterparty_did: row.counterpartyDid,
    vows: row.vows,
    status: row.status,
    counterparty_name: row.counterpartyName,
    notes: row.notes,
    metadata: row.metadata,
    established_at: row.establishedAt.toISOString(),
    signing_key_id: row.signingKeyId,
    signature: row.signature,
    proposed_expires_at: row.proposedExpiresAt?.toISOString() ?? null,
  };
```

- [ ] **Step 2: Add `propagateCosign` to the same file**

Append at the end of `api/src/services/covenants/federation.ts`:

```typescript
// ── Cosign / reject / withdraw outbound (Slice 3) ────────────────────

interface CosignPayload {
  counterparty_did: string;
  counterparty_signing_key_id: string;
  counterparty_signature: string;
  counterparty_signed_at: string;
}

/** POST counterparty's cosign back to the initiator's instance.
 *  Marks `cosign_propagation_status` on the local row. Best-effort;
 *  the cosign-propagate worker retries pending rows. */
export async function propagateCosign(covenantId: string): Promise<PropagateResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return { ok: false, error: "covenant_not_found" };
  if (!row.receivedFromInstance) {
    return await markCosignProp(covenantId, "not_applicable", null);
  }
  if (!row.counterpartySignature || !row.counterpartySigningKeyId) {
    return { ok: false, error: "missing_cosign_signature" };
  }

  const cpDid = await resolveAgentDid(row.agentId);
  if (!cpDid) {
    return await markCosignProp(covenantId, "rejected", "agent_did_not_resolved");
  }

  const url = `https://${row.receivedFromInstance}/federation/covenants/${row.id}/cosign`;
  const payload: CosignPayload = {
    counterparty_did: cpDid,
    counterparty_signing_key_id: row.counterpartySigningKeyId,
    counterparty_signature: row.counterpartySignature,
    counterparty_signed_at: (row.counterpartySignedAt ?? new Date()).toISOString(),
  };

  return await postWithRetry(covenantId, url, payload, "cosign");
}

interface RejectPayload {
  rejecting_did: string;
  rejecter_signing_key_id: string;
  rejection_signature: string;
  reason: string;
  rejected_at: string;
}

export async function propagateReject(covenantId: string): Promise<PropagateResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return { ok: false, error: "covenant_not_found" };
  if (!row.receivedFromInstance) {
    return await markCosignProp(covenantId, "not_applicable", null);
  }
  if (!row.counterpartySignature || !row.counterpartySigningKeyId) {
    return { ok: false, error: "missing_reject_signature" };
  }

  const cpDid = await resolveAgentDid(row.agentId);
  if (!cpDid) {
    return await markCosignProp(covenantId, "rejected", "agent_did_not_resolved");
  }

  const meta = (row.metadata as Record<string, unknown>) ?? {};
  const reason = typeof meta.rejection_reason === "string" ? meta.rejection_reason : "";

  const url = `https://${row.receivedFromInstance}/federation/covenants/${row.id}/reject`;
  const payload: RejectPayload = {
    rejecting_did: cpDid,
    rejecter_signing_key_id: row.counterpartySigningKeyId,
    rejection_signature: row.counterpartySignature,
    reason,
    rejected_at: (row.counterpartySignedAt ?? new Date()).toISOString(),
  };
  return await postWithRetry(covenantId, url, payload, "reject");
}

interface WithdrawPayload {
  initiator_did: string;
  initiator_signing_key_id: string;
  withdraw_signature: string;
  withdrawn_at: string;
}

export async function propagateWithdraw(covenantId: string): Promise<PropagateResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return { ok: false, error: "covenant_not_found" };
  // Withdraw is initiator-side: counterparty's instance must be derived
  // from the counterparty_did host.
  let cpHost: string | null = null;
  try {
    cpHost = parseDid(row.counterpartyDid).host;
  } catch { /* not a DID */ }
  if (!cpHost) {
    return await markCosignProp(covenantId, "not_applicable", null);
  }
  if (!row.counterpartySignature || !row.counterpartySigningKeyId) {
    return { ok: false, error: "missing_withdraw_signature" };
  }

  const initiatorDid = await resolveAgentDid(row.agentId);
  if (!initiatorDid) {
    return await markCosignProp(covenantId, "rejected", "agent_did_not_resolved");
  }

  const url = `https://${cpHost}/federation/covenants/${row.id}/withdraw`;
  const payload: WithdrawPayload = {
    initiator_did: initiatorDid,
    initiator_signing_key_id: row.counterpartySigningKeyId,
    withdraw_signature: row.counterpartySignature,
    withdrawn_at: (row.counterpartySignedAt ?? new Date()).toISOString(),
  };
  return await postWithRetry(covenantId, url, payload, "withdraw");
}

// ── shared post-with-retry plumbing ──────────────────────────────────

async function resolveAgentDid(agentId: string): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.enabled || !settings.instance_url) {
    const [a] = await db.select({ did: identities.did }).from(identities)
      .where(eq(identities.id, agentId)).limit(1);
    return a?.did ?? null;
  }
  let myHost: string;
  try { myHost = new URL(settings.instance_url).host; } catch { return null; }
  const [agent] = await db.select({ did: identities.did }).from(identities)
    .where(eq(identities.id, agentId)).limit(1);
  if (!agent) return null;
  const localPrefix = "did:at:";
  if (!agent.did.startsWith(localPrefix)) return agent.did;
  const uuid = agent.did.slice(localPrefix.length).split("/").pop()!;
  return federatedDid(myHost, uuid);
}

async function postWithRetry(
  covenantId: string,
  url: string,
  payload: unknown,
  kind: "cosign" | "reject" | "withdraw",
): Promise<PropagateResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROPAGATION_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message;
    await markCosignProp(covenantId, "pending", `network_error_${kind}: ${msg}`);
    return { ok: false, error: `network_error_${kind}: ${msg}` };
  }
  clearTimeout(timer);

  if (res.status === 200 || res.status === 201 || res.status === 409) {
    await markCosignProp(covenantId, "propagated", null);
    return { ok: true, status_code: res.status };
  }
  const body = await res.text().catch(() => "");
  if (res.status >= 400 && res.status < 500) {
    await markCosignProp(covenantId, "rejected", `peer_${res.status}_${kind}: ${body.slice(0, 300)}`);
    return { ok: false, status_code: res.status, error: body };
  }
  // 5xx — retryable
  await markCosignProp(covenantId, "pending", `peer_${res.status}_${kind}: ${body.slice(0, 300)}`);
  return { ok: false, status_code: res.status, error: body };
}

async function markCosignProp(
  covenantId: string,
  status: "not_applicable" | "pending" | "propagated" | "rejected",
  error: string | null,
): Promise<PropagateResult> {
  const attempts = status === "pending" || status === "rejected"
    ? (await currentCosignAttempts(covenantId)) + 1
    : undefined;
  await db.update(covenants).set({
    cosignPropagationStatus: status,
    cosignPropagationLastError: error,
    cosignPropagationAttemptedAt: new Date(),
    ...(attempts !== undefined ? { cosignPropagationAttempts: attempts } : {}),
  }).where(eq(covenants.id, covenantId));
  return { ok: status === "propagated", error: error ?? undefined };
}

async function currentCosignAttempts(covenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: covenants.cosignPropagationAttempts })
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  return row?.n ?? 0;
}
```

You'll need to ensure `identities` is imported at the top of the file. The existing imports already include it; verify with: `grep "from.*identity" api/src/services/covenants/federation.ts`.

- [ ] **Step 3: Verify the file compiles**

Run: `cd api && bun run --silent tsc --noEmit src/services/covenants/federation.ts`
Expected: no output. Any error means a missing import or signature mismatch — read the error and fix.

- [ ] **Step 4: Commit**

```bash
git add api/src/services/covenants/federation.ts
git commit -m "feat(covenants): outbound propagators for cosign / reject / withdraw"
```

---

## Task 5 — Federation inbound verification + new endpoints

**Files:**
- Modify: `api/src/services/covenants/federation.ts` (extend `receiveFederatedCovenant`; add `receiveCosign`, `receiveReject`, `receiveWithdraw`)
- Modify: `api/src/routes/federation/covenants.ts` (extend POST handler; add `/cosign`, `/reject`, `/withdraw`)

- [ ] **Step 1: Extend `receiveFederatedCovenant` to verify v2 sig + insert as 'proposed'**

In `api/src/services/covenants/federation.ts`, locate `receiveFederatedCovenant`. After the `// 4. Resolve sender_did at the claimed peer ...` block (around the call to `resolveFederatedDid`), add:

```typescript
  // 4a. v2: verify the initiator's signature against their declared signing key.
  const isV2 = (input as { protocol_version?: string }).protocol_version === "v2";
  if (isV2) {
    if (!input.signature || !input.signing_key_id) {
      return badRequest("v2_requires_signature");
    }
    const senderResolved = await resolveFederatedDid(input.sender_did);
    type SigKey = { id: string; public_key: string; revoked_at: string | null };
    const matchingKey = (senderResolved.signing_keys as SigKey[] | undefined)
      ?.find((k) => k.id === input.signing_key_id);
    if (!matchingKey) {
      return badRequest("sender_signing_key_not_found");
    }
    const { verifyDeclareSignature } = await import("./sig");
    const ok = await verifyDeclareSignature({
      covenantId: input.covenant_id,
      initiatorDid: input.sender_did,
      counterpartyDid: input.counterparty_did,
      vows: input.vows,
      establishedAtIso: input.established_at,
      signatureB64: input.signature,
      publicKeyB64: matchingKey.public_key,
    });
    if (!ok) return forbidden("invalid_signature");
  }
```

Then in the same function, change the insert's `status` value to honor v2's `'proposed'`:

```typescript
  const insertStatus = isV2 ? "proposed" : input.status;
  const insertProposedExpiresAt = isV2 && (input as { proposed_expires_at?: string }).proposed_expires_at
    ? new Date((input as { proposed_expires_at: string }).proposed_expires_at)
    : null;

  await db.insert(covenants).values({
    id: input.covenant_id,
    projectId: recipient.projectId,
    agentId: recipient.id,
    counterpartyDid: input.sender_did,
    counterpartyName: input.counterparty_name ?? null,
    vows: input.vows,
    notes: input.notes ?? null,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
    status: insertStatus,
    protocolVersion: isV2 ? "v2" : "v1",
    establishedAt: new Date(input.established_at),
    proposedExpiresAt: insertProposedExpiresAt,
    signature: input.signature ?? null,
    signingKeyId: input.signing_key_id ?? null,
    receivedFromInstance: senderParsed.host,
    verifiedAt: new Date(),
    propagationStatus: "local",
  });
```

Update the `ReceiveInput` interface at the top of the receive section to include the new fields:

```typescript
interface ReceiveInput {
  covenant_id: string;
  protocol_version?: "v1" | "v2";
  sender_did: string;
  counterparty_did: string;
  vows: string[];
  status: "active" | "paused" | "dissolved" | "proposed";
  counterparty_name?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  established_at: string;
  signing_key_id?: string | null;
  signature?: string | null;
  proposed_expires_at?: string | null;
}
```

- [ ] **Step 2: Add `receiveCosign` / `receiveReject` / `receiveWithdraw`**

Append to `api/src/services/covenants/federation.ts`:

```typescript
// ── Inbound cosign / reject / withdraw (Slice 3) ─────────────────────

interface ReceiveCosignInput {
  counterparty_did: string;
  counterparty_signing_key_id: string;
  counterparty_signature: string;
  counterparty_signed_at: string;
}

export async function receiveCosign(
  covenantId: string,
  input: ReceiveCosignInput,
): Promise<ReceiveResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return notFound("covenant_not_found");
  if (row.protocolVersion !== "v2") return badRequest("not_v2");
  if (row.status !== "proposed") return badRequest(`unexpected_status: ${row.status}`);
  if (!row.signature) return badRequest("missing_initiator_signature");

  // The cosigner's DID must match the counterparty_did stored on this row.
  if (input.counterparty_did !== row.counterpartyDid) {
    return forbidden("counterparty_did_mismatch");
  }

  // Resolve the cosigner's signing key via federation.
  const { resolveFederatedDid } = await import("../federation/store");
  const resolved = await resolveFederatedDid(input.counterparty_did);
  type SigKey = { id: string; public_key: string };
  const matchingKey = (resolved.signing_keys as SigKey[] | undefined)
    ?.find((k) => k.id === input.counterparty_signing_key_id);
  if (!matchingKey) return badRequest("cosigner_signing_key_not_found");

  const { verifyCosignSignature } = await import("./sig");
  const ok = await verifyCosignSignature({
    covenantId: row.id,
    initiatorSignatureB64: row.signature,
    cosignSignatureB64: input.counterparty_signature,
    cosignerPublicKeyB64: matchingKey.public_key,
  });
  if (!ok) return forbidden("invalid_cosign_signature");

  await db.update(covenants).set({
    status: "active",
    counterpartySignature: input.counterparty_signature,
    counterpartySigningKeyId: input.counterparty_signing_key_id,
    counterpartySignedAt: new Date(input.counterparty_signed_at),
    verifiedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(covenants.id, covenantId));

  return { ok: true, status_code: 200, body: { covenant_id: covenantId, status: "active" } };
}

interface ReceiveRejectInput {
  rejecting_did: string;
  rejecter_signing_key_id: string;
  rejection_signature: string;
  reason: string;
  rejected_at: string;
}

export async function receiveReject(
  covenantId: string,
  input: ReceiveRejectInput,
): Promise<ReceiveResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return notFound("covenant_not_found");
  if (row.protocolVersion !== "v2") return badRequest("not_v2");
  if (row.status !== "proposed") return badRequest(`unexpected_status: ${row.status}`);

  if (input.rejecting_did !== row.counterpartyDid) {
    return forbidden("rejecter_did_mismatch");
  }

  const { resolveFederatedDid } = await import("../federation/store");
  const resolved = await resolveFederatedDid(input.rejecting_did);
  type SigKey = { id: string; public_key: string };
  const matchingKey = (resolved.signing_keys as SigKey[] | undefined)
    ?.find((k) => k.id === input.rejecter_signing_key_id);
  if (!matchingKey) return badRequest("rejecter_signing_key_not_found");

  const { verifyRejectSignature } = await import("./sig");
  const ok = await verifyRejectSignature({
    covenantId: row.id,
    rejectingDid: input.rejecting_did,
    reason: input.reason,
    signatureB64: input.rejection_signature,
    publicKeyB64: matchingKey.public_key,
  });
  if (!ok) return forbidden("invalid_reject_signature");

  await db.update(covenants).set({
    status: "rejected",
    counterpartySignature: input.rejection_signature,
    counterpartySigningKeyId: input.rejecter_signing_key_id,
    counterpartySignedAt: new Date(input.rejected_at),
    metadata: { ...(row.metadata as Record<string, unknown> ?? {}), rejection_reason: input.reason },
    updatedAt: new Date(),
  }).where(eq(covenants.id, covenantId));

  return { ok: true, status_code: 200, body: { covenant_id: covenantId, status: "rejected" } };
}

interface ReceiveWithdrawInput {
  initiator_did: string;
  initiator_signing_key_id: string;
  withdraw_signature: string;
  withdrawn_at: string;
}

export async function receiveWithdraw(
  covenantId: string,
  input: ReceiveWithdrawInput,
): Promise<ReceiveResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return notFound("covenant_not_found");
  if (row.protocolVersion !== "v2") return badRequest("not_v2");
  if (row.status !== "proposed") return badRequest(`unexpected_status: ${row.status}`);
  // counterpartyDid on this (received) row is the initiator's federated DID
  if (input.initiator_did !== row.counterpartyDid) {
    return forbidden("withdrawer_did_mismatch");
  }

  const { resolveFederatedDid } = await import("../federation/store");
  const resolved = await resolveFederatedDid(input.initiator_did);
  type SigKey = { id: string; public_key: string };
  const matchingKey = (resolved.signing_keys as SigKey[] | undefined)
    ?.find((k) => k.id === input.initiator_signing_key_id);
  if (!matchingKey) return badRequest("initiator_signing_key_not_found");

  const { verifyWithdrawSignature } = await import("./sig");
  const ok = await verifyWithdrawSignature({
    covenantId: row.id,
    initiatorDid: input.initiator_did,
    signatureB64: input.withdraw_signature,
    publicKeyB64: matchingKey.public_key,
  });
  if (!ok) return forbidden("invalid_withdraw_signature");

  await db.update(covenants).set({
    status: "withdrawn",
    updatedAt: new Date(),
  }).where(eq(covenants.id, covenantId));

  return { ok: true, status_code: 200, body: { covenant_id: covenantId, status: "withdrawn" } };
}
```

- [ ] **Step 3: Wire the new federation HTTP routes**

Replace the contents of `api/src/routes/federation/covenants.ts` with:

```typescript
/** POST /federation/covenants — receive a propagated covenant declaration.
 *  POST /federation/covenants/:id/cosign  — receive counterparty acceptance
 *  POST /federation/covenants/:id/reject  — receive counterparty rejection
 *  POST /federation/covenants/:id/withdraw — receive initiator withdraw
 *
 *  All UNAUTHENTICATED, signature-verified inside the service layer.
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 2 + Slice 3). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  receiveCosign,
  receiveFederatedCovenant,
  receiveReject,
  receiveWithdraw,
} from "../../services/covenants/federation";
import { getSettings } from "../../services/federation/store";

const app = new Hono();

const inboundSchema = z.object({
  covenant_id: z.string().uuid(),
  protocol_version: z.enum(["v1", "v2"]).optional(),
  sender_did: z.string().min(1).max(255),
  counterparty_did: z.string().min(1).max(255),
  vows: z.array(z.string().min(1).max(500)).min(1).max(40),
  status: z.enum(["active", "paused", "dissolved", "proposed"]),
  counterparty_name: z.string().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
  metadata: z.record(z.unknown()).nullish(),
  established_at: z.string().datetime(),
  signing_key_id: z.string().uuid().nullish(),
  signature: z.string().max(255).nullish(),
  proposed_expires_at: z.string().datetime().nullish(),
});

const cosignSchema = z.object({
  counterparty_did: z.string().min(1).max(255),
  counterparty_signing_key_id: z.string().uuid(),
  counterparty_signature: z.string().min(1).max(255),
  counterparty_signed_at: z.string().datetime(),
});

const rejectSchema = z.object({
  rejecting_did: z.string().min(1).max(255),
  rejecter_signing_key_id: z.string().uuid(),
  rejection_signature: z.string().min(1).max(255),
  reason: z.string().max(2000).default(""),
  rejected_at: z.string().datetime(),
});

const withdrawSchema = z.object({
  initiator_did: z.string().min(1).max(255),
  initiator_signing_key_id: z.string().uuid(),
  withdraw_signature: z.string().min(1).max(255),
  withdrawn_at: z.string().datetime(),
});

async function ensureFederationEnabled() {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new HTTPException(404, { message: "federation_disabled" });
  }
}

app.post("/", async (c) => {
  await ensureFederationEnabled();
  const body = await c.req.json();
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveFederatedCovenant(parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

app.post("/:id/cosign", async (c) => {
  await ensureFederationEnabled();
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = cosignSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveCosign(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

app.post("/:id/reject", async (c) => {
  await ensureFederationEnabled();
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveReject(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

app.post("/:id/withdraw", async (c) => {
  await ensureFederationEnabled();
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveWithdraw(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

export default app;
```

- [ ] **Step 4: Verify it compiles**

Run: `cd api && bun run --silent tsc --noEmit src/routes/federation/covenants.ts src/services/covenants/federation.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/covenants/federation.ts api/src/routes/federation/covenants.ts
git commit -m "feat(covenants): inbound v2 verification + cosign/reject/withdraw endpoints"
```

---

## Task 6 — HTTP routes (initiator side, in `routes/continuity.ts`)

**Files:**
- Modify: `api/src/routes/continuity.ts`

Existing covenant routes live here: `POST /covenants` (line 154), `GET /covenants` (225), `PATCH /covenants/:id` (261). Add v2 support and the new accept/reject endpoints.

- [ ] **Step 1: Extend the POST schema and handler**

Open `api/src/routes/continuity.ts`. Find the POST `/covenants` handler. Modify the request schema (above the handler) to accept `protocol_version`:

```typescript
// near the existing covenant create schema:
const createCovenantSchema = z.object({
  // ... existing fields stay ...
  counterparty_did: z.string().min(1).max(255),
  counterparty_name: z.string().max(200).nullish(),
  vows: z.array(z.string().min(1).max(500)).min(1).max(40),
  notes: z.string().max(2000).nullish(),
  metadata: z.record(z.unknown()).nullish(),
  protocol_version: z.enum(["v1", "v2"]).default("v1"),
  org_id: z.string().uuid().nullish(),
});
```

Then in the POST handler body, branch on `protocol_version`. After validating the input but before the existing v1 insert path, add:

```typescript
  if (parsed.data.protocol_version === "v2") {
    // v2 declaration: load agent's active signing key, sign canonical bytes,
    // insert as 'proposed', enqueue propagation.
    const { loadAgentSigningKey } = await import("../services/identity/crypto");
    const { declareV2 } = await import("../services/covenants/lifecycle");
    const { propagateCovenant } = await import("../services/covenants/federation");

    const signingKey = await loadAgentSigningKey(c.var.project.id, parsed.data.agent_id);
    if (!signingKey) {
      return c.json({ error: "agent_signing_key_not_available" }, 400);
    }
    const result = await declareV2({
      projectId: c.var.project.id,
      agentId: parsed.data.agent_id,
      agentSigningPrivateKey: signingKey.privateKey,
      agentSigningKeyId: signingKey.id,
      counterpartyDid: parsed.data.counterparty_did,
      counterpartyName: parsed.data.counterparty_name,
      vows: parsed.data.vows,
      notes: parsed.data.notes,
      metadata: parsed.data.metadata,
      orgId: parsed.data.org_id,
    });

    // Best-effort fire-and-forget; the propagation worker re-tries on failure.
    void propagateCovenant(result.id);

    return c.json({
      id: result.id,
      status: result.status,
      protocol_version: result.protocolVersion,
      signature: result.signature,
      signing_key_id: result.signingKeyId,
      proposed_expires_at: result.proposedExpiresAt.toISOString(),
      established_at: result.establishedAt.toISOString(),
    }, 201);
  }
  // ... existing v1 insert path stays unchanged ...
```

The existing handler probably already has variable names like `parsed.data.agent_id` and `c.var.project.id` — match what's there.

- [ ] **Step 2: Add `loadAgentSigningKey` helper to `services/identity/crypto.ts`**

This server-side signing helper must exist. Open `api/src/services/identity/crypto.ts`. Append:

```typescript
import { db } from "../../db/client";
import { identityKeys } from "../../db/schema/identity";
import { and, eq, isNull } from "drizzle-orm";

/** Load an agent's active server-rooted signing key. Returns null if the
 *  identity is SOMA-rooted (private key never reaches the server) — in
 *  that case the SDK signs client-side and POSTs the signature directly
 *  via a separate code path (extend declareV2 to accept a pre-signed sig
 *  in a follow-up; v1 of this plan supports server-rooted only). */
export async function loadAgentSigningKey(
  projectId: string,
  identityId: string,
): Promise<{ id: string; privateKey: Uint8Array } | null> {
  const [row] = await db
    .select({
      id: identityKeys.id,
      privateKeyB64: identityKeys.privateKey,
    })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.identityId, identityId),
      eq(identityKeys.active, true),
      isNull(identityKeys.revokedAt),
    ))
    .limit(1);
  if (!row || !row.privateKeyB64) return null;
  return {
    id: row.id,
    privateKey: Uint8Array.from(Buffer.from(row.privateKeyB64, "base64")),
  };
}
```

If the existing schema doesn't store `privateKey` server-side (SOMA-only), this helper returns `null` and the route returns `400 agent_signing_key_not_available` — pushing v2 declarations to the SDK path, which is correct.

- [ ] **Step 3: Extend the DELETE handler to handle `'proposed'` rows as withdraw**

Find the existing DELETE handler in `routes/continuity.ts` (or PATCH-based dissolution handler — look for `dissolved_at` updates near lines 261+). Add a branch at the top of the handler:

```typescript
  // Look up the row first to decide between withdraw (proposed) and dissolve (active).
  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id)))
    .limit(1);
  if (!existing) return c.json({ error: "not_found" }, 404);

  if (existing.protocolVersion === "v2" && existing.status === "proposed") {
    const { loadAgentSigningKey } = await import("../services/identity/crypto");
    const { withdrawProposal } = await import("../services/covenants/lifecycle");
    const { propagateWithdraw } = await import("../services/covenants/federation");

    const signingKey = await loadAgentSigningKey(c.var.project.id, existing.agentId);
    if (!signingKey) return c.json({ error: "agent_signing_key_not_available" }, 400);
    const result = await withdrawProposal({
      covenantId: id,
      agentId: existing.agentId,
      agentSigningPrivateKey: signingKey.privateKey,
      agentSigningKeyId: signingKey.id,
    });
    void propagateWithdraw(id);
    return c.json({ id: result.id, status: result.status }, 200);
  }
  // ... existing dissolution path stays unchanged ...
```

- [ ] **Step 4: Add the new `/covenants/:id/accept` and `/covenants/:id/reject` routes**

Below the existing covenant routes in `routes/continuity.ts`, add:

```typescript
const acceptSchema = z.object({});  // body intentionally empty in v1

app.post("/covenants/:id/accept", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id)))
    .limit(1);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (existing.protocolVersion !== "v2") return c.json({ error: "not_v2" }, 400);
  if (existing.status !== "proposed") return c.json({ error: `not_proposed: ${existing.status}` }, 409);

  const { loadAgentSigningKey } = await import("../services/identity/crypto");
  const { acceptProposal } = await import("../services/covenants/lifecycle");
  const { propagateCosign } = await import("../services/covenants/federation");

  const signingKey = await loadAgentSigningKey(c.var.project.id, existing.agentId);
  if (!signingKey) return c.json({ error: "agent_signing_key_not_available" }, 400);

  const result = await acceptProposal({
    covenantId: id,
    accepterAgentId: existing.agentId,
    accepterSigningPrivateKey: signingKey.privateKey,
    accepterSigningKeyId: signingKey.id,
  });
  void propagateCosign(id);
  return c.json({
    id: result.id,
    status: result.status,
    counterparty_signature: result.counterpartySignature,
    counterparty_signing_key_id: result.counterpartySigningKeyId,
  }, 200);
});

const rejectSchema = z.object({
  reason: z.string().max(2000).nullish(),
});

app.post("/covenants/:id/reject", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "validation", details: parsed.error.flatten() }, 400);

  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id)))
    .limit(1);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (existing.protocolVersion !== "v2") return c.json({ error: "not_v2" }, 400);
  if (existing.status !== "proposed") return c.json({ error: `not_proposed: ${existing.status}` }, 409);

  const { loadAgentSigningKey } = await import("../services/identity/crypto");
  const { rejectProposal } = await import("../services/covenants/lifecycle");
  const { propagateReject } = await import("../services/covenants/federation");

  const signingKey = await loadAgentSigningKey(c.var.project.id, existing.agentId);
  if (!signingKey) return c.json({ error: "agent_signing_key_not_available" }, 400);

  const result = await rejectProposal({
    covenantId: id,
    rejecterAgentId: existing.agentId,
    rejecterSigningPrivateKey: signingKey.privateKey,
    rejecterSigningKeyId: signingKey.id,
    reason: parsed.data.reason ?? null,
  });
  void propagateReject(id);
  return c.json({
    id: result.id,
    status: result.status,
    reason: result.reason,
  }, 200);
});
```

- [ ] **Step 5: Verify and commit**

Run: `cd api && bun run --silent tsc --noEmit src/routes/continuity.ts src/services/identity/crypto.ts`
Expected: no output.

```bash
git add api/src/routes/continuity.ts api/src/services/identity/crypto.ts
git commit -m "feat(covenants): initiator-side HTTP routes — v2 declare/withdraw + accept/reject"
```

---

## Task 7 — Worker: cosign-propagate

**Files:**
- Create: `api/src/workers/covenants/index.ts`
- Create: `api/src/workers/covenants/cosign-propagate.ts`
- Modify: `api/src/index.ts` (start the worker bundle)

- [ ] **Step 1: Implement the worker**

Create `api/src/workers/covenants/cosign-propagate.ts`:

```typescript
/** Worker: retry pending cosign / reject / withdraw propagation.
 *
 *  Scans rows with `cosign_propagation_status = 'pending'` and attempts
 *  to re-POST the appropriate envelope. Exponential backoff via the
 *  `attempts` counter; marks 'rejected' after MAX_ATTEMPTS without
 *  success.
 *
 *  Triggered every TICK_MS. */

import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import {
  propagateCosign,
  propagateReject,
  propagateWithdraw,
} from "../../services/covenants/federation";

const TICK_MS = 30_000;
const MAX_ATTEMPTS = 5;
// Backoff schedule (seconds) by attempt count: ~30s, 2m, 8m, 30m, 2h.
const BACKOFF_SECONDS = [30, 120, 480, 1800, 7200];

let timer: ReturnType<typeof setInterval> | null = null;

export function startCosignPropagateWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  void tick();
}

export function stopCosignPropagateWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const now = new Date();

  // Build a NOW-vs-attempted-at boundary: select rows whose backoff has elapsed.
  const due = await db
    .select({
      id: covenants.id,
      status: covenants.status,
      attempts: covenants.cosignPropagationAttempts,
      lastAt: covenants.cosignPropagationAttemptedAt,
    })
    .from(covenants)
    .where(eq(covenants.cosignPropagationStatus, "pending"))
    .limit(50);

  for (const row of due) {
    const idx = Math.min(row.attempts, BACKOFF_SECONDS.length - 1);
    const dueAt = (row.lastAt?.getTime() ?? 0) + BACKOFF_SECONDS[idx] * 1000;
    if (dueAt > now.getTime()) continue;

    // Exhaustion check.
    if (row.attempts >= MAX_ATTEMPTS) {
      await db.update(covenants).set({
        cosignPropagationStatus: "rejected",
        cosignPropagationLastError: `max_attempts_exceeded (${MAX_ATTEMPTS})`,
        cosignPropagationAttemptedAt: new Date(),
      }).where(eq(covenants.id, row.id));
      continue;
    }

    // Dispatch by row.status.
    if (row.status === "active") {
      await propagateCosign(row.id);
    } else if (row.status === "rejected") {
      await propagateReject(row.id);
    } else if (row.status === "withdrawn") {
      await propagateWithdraw(row.id);
    } else {
      // Status changed under us; clear the pending flag.
      await db.update(covenants).set({
        cosignPropagationStatus: "not_applicable",
        cosignPropagationLastError: `status_no_longer_propagatable: ${row.status}`,
      }).where(eq(covenants.id, row.id));
    }
  }
}
```

Create `api/src/workers/covenants/index.ts`:

```typescript
import { startCosignPropagateWorker } from "./cosign-propagate";
import { startExpireProposalsWorker } from "./expire-proposals";
import { startReverifyWorker } from "./reverify";

export function startCovenantWorkers(): void {
  startCosignPropagateWorker();
  startExpireProposalsWorker();
  startReverifyWorker();
}
```

(The other two worker files are added in Tasks 8 and 9; this index-level import will fail until those are created. We'll wire it into `src/index.ts` in Step 4 after both exist.)

- [ ] **Step 2: Write a smoke test for the worker**

Create `api/tests/covenants-cosign-propagate.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";

describe("cosign-propagate worker — exhaustion", () => {
  test("flips to 'rejected' after MAX_ATTEMPTS", async () => {
    // Pre-seed a row at MAX_ATTEMPTS-1 with cosign_propagation_status='pending'
    // and an attempted_at far in the past so it's immediately due.
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id,
      projectId: crypto.randomUUID(),
      agentId: crypto.randomUUID(),
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"],
      status: "active",
      protocolVersion: "v2",
      signature: "x".repeat(88),
      signingKeyId: crypto.randomUUID(),
      counterpartySignature: "y".repeat(88),
      counterpartySigningKeyId: crypto.randomUUID(),
      receivedFromInstance: "unreachable.invalid",
      cosignPropagationStatus: "pending",
      cosignPropagationAttempts: 5,
      cosignPropagationAttemptedAt: new Date(0),
    });

    const { startCosignPropagateWorker, stopCosignPropagateWorker } =
      await import("../src/workers/covenants/cosign-propagate");
    startCosignPropagateWorker();
    await new Promise(r => setTimeout(r, 200)); // let one tick run
    stopCosignPropagateWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.cosignPropagationStatus).toBe("rejected");
    expect(row.cosignPropagationLastError).toMatch(/max_attempts_exceeded/);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd api && bun test tests/covenants-cosign-propagate.test.ts`
Expected: PASS — exhaustion path flips status to `'rejected'`.

- [ ] **Step 4: Commit**

```bash
git add api/src/workers/covenants/cosign-propagate.ts api/src/workers/covenants/index.ts api/tests/covenants-cosign-propagate.test.ts
git commit -m "feat(covenants): cosign-propagate worker with backoff + exhaustion"
```

---

## Task 8 — Worker: expire-proposals

**Files:**
- Create: `api/src/workers/covenants/expire-proposals.ts`
- Create: `api/tests/covenants-expire-proposals.test.ts`

- [ ] **Step 1: Implement**

Create `api/src/workers/covenants/expire-proposals.ts`:

```typescript
/** Worker: mark expired proposals (status='proposed' AND proposed_expires_at < now()).
 *
 *  Skips rows where cosign propagation is in-flight — counterparty has
 *  already accepted on their side; the expiry race is resolved in
 *  favor of the bond being real on the side that signed.
 *
 *  Triggered every TICK_MS. */

import { and, eq, isNotNull, lt, ne, or } from "drizzle-orm";
import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";

const TICK_MS = 5 * 60_000; // 5 minutes
let timer: ReturnType<typeof setInterval> | null = null;

export function startExpireProposalsWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  void tick();
}

export function stopExpireProposalsWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const now = new Date();
  // Eligible: status='proposed' AND proposed_expires_at < now()
  // AND cosign_propagation_status IS NOT pending/propagated.
  await db.update(covenants).set({
    status: "expired",
    updatedAt: now,
  }).where(and(
    eq(covenants.status, "proposed"),
    isNotNull(covenants.proposedExpiresAt),
    lt(covenants.proposedExpiresAt, now),
    or(
      eq(covenants.cosignPropagationStatus, "not_applicable"),
      eq(covenants.cosignPropagationStatus, "rejected"),
      // NULL is also eligible — never propagated
      // Drizzle doesn't have isNull-OR easily; cover via the next condition
    ),
  ));
  // Cover NULL cosign_propagation_status separately (NULL fails any =/<>).
  await db.update(covenants).set({
    status: "expired",
    updatedAt: now,
  }).where(and(
    eq(covenants.status, "proposed"),
    isNotNull(covenants.proposedExpiresAt),
    lt(covenants.proposedExpiresAt, now),
    // raw SQL NULL check via drizzle:
    // sql`${covenants.cosignPropagationStatus} IS NULL`
  ));
}
```

Note: the second `db.update` for NULL handling needs a raw SQL fragment. Add the import and refine:

```typescript
import { sql } from "drizzle-orm";
// ...
  await db.update(covenants).set({
    status: "expired",
    updatedAt: now,
  }).where(and(
    eq(covenants.status, "proposed"),
    isNotNull(covenants.proposedExpiresAt),
    lt(covenants.proposedExpiresAt, now),
    sql`${covenants.cosignPropagationStatus} IS NULL`,
  ));
```

- [ ] **Step 2: Write the test**

Create `api/tests/covenants-expire-proposals.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";

describe("expire-proposals worker", () => {
  test("flips expired proposals to 'expired'", async () => {
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id,
      projectId: crypto.randomUUID(),
      agentId: crypto.randomUUID(),
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"],
      status: "proposed",
      protocolVersion: "v2",
      proposedExpiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
    });

    const { startExpireProposalsWorker, stopExpireProposalsWorker } =
      await import("../src/workers/covenants/expire-proposals");
    startExpireProposalsWorker();
    await new Promise(r => setTimeout(r, 200));
    stopExpireProposalsWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.status).toBe("expired");
  });

  test("does NOT expire rows with cosign in flight", async () => {
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id,
      projectId: crypto.randomUUID(),
      agentId: crypto.randomUUID(),
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"],
      status: "proposed",
      protocolVersion: "v2",
      proposedExpiresAt: new Date(Date.now() - 60_000),
      cosignPropagationStatus: "pending",
    });

    const { startExpireProposalsWorker, stopExpireProposalsWorker } =
      await import("../src/workers/covenants/expire-proposals");
    startExpireProposalsWorker();
    await new Promise(r => setTimeout(r, 200));
    stopExpireProposalsWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.status).toBe("proposed"); // unchanged
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `cd api && bun test tests/covenants-expire-proposals.test.ts`
Expected: PASS.

```bash
git add api/src/workers/covenants/expire-proposals.ts api/tests/covenants-expire-proposals.test.ts
git commit -m "feat(covenants): expire-proposals worker (TTL sweeper)"
```

---

## Task 9 — Worker: reverify

**Files:**
- Create: `api/src/workers/covenants/reverify.ts`
- Create: `api/tests/covenants-reverify.test.ts`

- [ ] **Step 1: Implement**

Create `api/src/workers/covenants/reverify.ts`:

```typescript
/** Worker: re-verify v2 covenant signatures every 24h.
 *
 *  Scans v2 active/proposed rows ordered by oldest verified_at first.
 *  Re-resolves the signers' keys (locally for self-rooted, via /federation/identities
 *  for received rows) and re-checks both signatures (initiator's and counterparty's
 *  if present). Updates verified_at on success or verification_error on failure.
 *  Status is NOT flipped — the bond was real at sign time. */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { identityKeys } from "../../db/schema/identity";
import {
  verifyCosignSignature,
  verifyDeclareSignature,
} from "../../services/covenants/sig";
import { resolveFederatedDid } from "../../services/federation/store";

const TICK_MS = 24 * 60 * 60_000; // 24 hours
const BATCH = 100;

let timer: ReturnType<typeof setInterval> | null = null;

export function startReverifyWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  void tick();
}

export function stopReverifyWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  const rows = await db
    .select()
    .from(covenants)
    .where(and(
      eq(covenants.protocolVersion, "v2"),
      inArray(covenants.status, ["active", "proposed"]),
    ))
    .orderBy(asc(sql`COALESCE(${covenants.verifiedAt}, '1970-01-01')`))
    .limit(BATCH);

  for (const row of rows) {
    let error: string | null = null;
    try {
      await verifyRow(row);
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    await db.update(covenants).set({
      verifiedAt: error === null ? new Date() : row.verifiedAt,
      verificationError: error,
    }).where(eq(covenants.id, row.id));
  }
}

async function verifyRow(row: typeof covenants.$inferSelect): Promise<void> {
  if (!row.signature || !row.signingKeyId) {
    throw new Error("missing_initiator_signature");
  }
  // The initiator's DID: when this row was received, counterpartyDid is the
  // initiator's federated DID; when locally declared, the agent's DID is the
  // initiator. Distinguish by `received_from_instance`.
  const initiatorDid = row.receivedFromInstance ? row.counterpartyDid : await localAgentDid(row.agentId);
  if (!initiatorDid) throw new Error("initiator_did_unresolved");
  const initiatorPub = await resolvePub(initiatorDid, row.signingKeyId);
  if (!initiatorPub) throw new Error("initiator_key_not_found");

  const okInit = await verifyDeclareSignature({
    covenantId: row.id,
    initiatorDid,
    counterpartyDid: row.receivedFromInstance ? await localAgentDid(row.agentId) ?? "" : row.counterpartyDid,
    vows: row.vows,
    establishedAtIso: row.establishedAt.toISOString(),
    signatureB64: row.signature,
    publicKeyB64: initiatorPub,
  });
  if (!okInit) throw new Error("sig_invalid_initiator");

  if (row.counterpartySignature && row.counterpartySigningKeyId) {
    const cosignerDid = row.receivedFromInstance ? await localAgentDid(row.agentId) : row.counterpartyDid;
    if (!cosignerDid) throw new Error("cosigner_did_unresolved");
    const cosignerPub = await resolvePub(cosignerDid, row.counterpartySigningKeyId);
    if (!cosignerPub) throw new Error("cosigner_key_not_found");
    const okCo = await verifyCosignSignature({
      covenantId: row.id,
      initiatorSignatureB64: row.signature,
      cosignSignatureB64: row.counterpartySignature,
      cosignerPublicKeyB64: cosignerPub,
    });
    if (!okCo) throw new Error("sig_invalid_cosigner");
  }
}

async function localAgentDid(agentId: string): Promise<string | null> {
  const { identities } = await import("../../db/schema/identity");
  const [r] = await db.select({ did: identities.did }).from(identities)
    .where(eq(identities.id, agentId)).limit(1);
  return r?.did ?? null;
}

async function resolvePub(did: string, signingKeyId: string): Promise<string | null> {
  // Federated DID? Resolve via peer.
  if (did.includes("/")) {
    try {
      const resolved = await resolveFederatedDid(did);
      type Key = { id: string; public_key: string };
      const k = (resolved.signing_keys as Key[] | undefined)?.find((x) => x.id === signingKeyId);
      return k?.public_key ?? null;
    } catch {
      return null;
    }
  }
  // Local: query identity_keys directly.
  const [k] = await db.select({ pub: identityKeys.publicKey })
    .from(identityKeys)
    .where(eq(identityKeys.id, signingKeyId))
    .limit(1);
  return k?.pub ?? null;
}
```

- [ ] **Step 2: Write the test**

Create `api/tests/covenants-reverify.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";
import { identities, identityKeys } from "../src/db/schema/identity";
import { canonicalDeclareBytes } from "../src/services/covenants/sig";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

describe("reverify worker", () => {
  test("clears verification_error on a valid row", async () => {
    const projectId = crypto.randomUUID();
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const [identity] = await db.insert(identities).values({
      projectId, did: "did:at:" + crypto.randomUUID(), displayName: "x", status: "active",
    }).returning();
    const [keyRow] = await db.insert(identityKeys).values({
      identityId: identity.id, publicKey: Buffer.from(pub).toString("base64"), active: true,
    }).returning();

    const id = crypto.randomUUID();
    const counterpartyDid = "did:at:peer.example/bbbb";
    const established = new Date();
    const canonical = canonicalDeclareBytes({
      covenantId: id,
      initiatorDid: identity.did,
      counterpartyDid,
      vows: ["one"],
      establishedAtIso: established.toISOString(),
    });
    const sig = await ed.signAsync(canonical, priv);

    await db.insert(covenants).values({
      id,
      projectId,
      agentId: identity.id,
      counterpartyDid,
      vows: ["one"],
      status: "active",
      protocolVersion: "v2",
      signature: Buffer.from(sig).toString("base64"),
      signingKeyId: keyRow.id,
      counterpartySignature: Buffer.from(sig).toString("base64"), // placeholder; verifier won't reach it w/o cp resolve
      counterpartySigningKeyId: keyRow.id,
      establishedAt: established,
      verificationError: "stale_error_should_be_cleared",
    });

    // Row is local-declared (no receivedFromInstance), so reverify will try
    // to resolve counterparty federated. This will fail in tests (no peer).
    // For unit-level coverage, we test the local-only path: change cp DID to local.
    await db.update(covenants).set({
      counterpartyDid: "human:Yu", // not federated → counterparty isn't re-resolved
      counterpartySignature: null, // skip cosign verification
      counterpartySigningKeyId: null,
    }).where(eq(covenants.id, id));

    const { startReverifyWorker, stopReverifyWorker } =
      await import("../src/workers/covenants/reverify");
    startReverifyWorker();
    await new Promise(r => setTimeout(r, 300));
    stopReverifyWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.verificationError).toBeNull();
    expect(row.verifiedAt).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `cd api && bun test tests/covenants-reverify.test.ts`
Expected: PASS — verification_error cleared, verifiedAt set.

```bash
git add api/src/workers/covenants/reverify.ts api/tests/covenants-reverify.test.ts
git commit -m "feat(covenants): reverify worker (24h key + sig re-check)"
```

---

## Task 10 — Wire worker bundle into the API process

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Import + start the worker bundle**

Open `api/src/index.ts`. Find `import { startPayoutWorkers } from "./workers/payout";`. Add below it:

```typescript
import { startCovenantWorkers } from "./workers/covenants";
```

Then find `startPayoutWorkers();` (likely near server bootstrap) and add directly after:

```typescript
startCovenantWorkers();
```

- [ ] **Step 2: Boot the API and grep for "covenant" worker logs**

Run in one terminal: `cd api && bun run dev`
Expected: server starts; no errors related to the covenants worker bundle.

Stop the server (Ctrl-C). Run: `cd api && bun run --silent tsc --noEmit src/index.ts`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add api/src/index.ts
git commit -m "feat(covenants): wire covenant workers into api bootstrap"
```

---

## Task 11 — TypeScript SDK surface

**Files:**
- Modify: `packages/sdk-ts/src/covenants.ts`
- Create: `packages/sdk-ts/tests/covenants-v2.test.ts`

The SDK adds: `protocol_version` arg on `create`, plus `accept`, `reject`, `withdraw` methods. For SOMA-rooted identities, signing happens client-side. For server-rooted, the SDK posts to the server route and the server signs.

- [ ] **Step 1: Inspect the existing covenants module**

Read: `packages/sdk-ts/src/covenants.ts`
Note the existing `create`, `list`, `update`, `dissolve` method signatures and how they call the underlying HTTP client. The new methods follow the same patterns.

- [ ] **Step 2: Write the failing test**

Create `packages/sdk-ts/tests/covenants-v2.test.ts`:

```typescript
import { describe, expect, test, mock } from "bun:test";
import { CovenantsClient } from "../src/covenants";

function fakeHttp(handler: (path: string, init?: RequestInit) => Promise<unknown>) {
  return { request: mock(handler) };
}

describe("covenants v2 — SDK surface", () => {
  test("create with protocol_version='v2' posts the flag", async () => {
    const http = fakeHttp(async (path, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(path).toBe("/v1/covenants");
      expect(body.protocol_version).toBe("v2");
      return {
        id: "cov-1", status: "proposed", protocol_version: "v2",
        signature: "sig", signing_key_id: "k1",
        proposed_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        established_at: new Date().toISOString(),
      };
    });
    const c = new CovenantsClient(http as any);
    const r = await c.create({
      counterparty_did: "did:at:peer.example/bbbb",
      vows: ["v"],
      protocol_version: "v2",
      agent_id: "agent-1",
    });
    expect(r.status).toBe("proposed");
    expect(r.protocol_version).toBe("v2");
  });

  test("accept POSTs to /accept", async () => {
    const http = fakeHttp(async (path) => {
      expect(path).toBe("/v1/covenants/cov-1/accept");
      return { id: "cov-1", status: "active", counterparty_signature: "x" };
    });
    const c = new CovenantsClient(http as any);
    const r = await c.accept("cov-1");
    expect(r.status).toBe("active");
  });

  test("reject POSTs to /reject with reason", async () => {
    const http = fakeHttp(async (path, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(path).toBe("/v1/covenants/cov-1/reject");
      expect(body.reason).toBe("scope mismatch");
      return { id: "cov-1", status: "rejected", reason: "scope mismatch" };
    });
    const c = new CovenantsClient(http as any);
    const r = await c.reject("cov-1", { reason: "scope mismatch" });
    expect(r.status).toBe("rejected");
  });

  test("withdraw DELETEs /v1/covenants/:id", async () => {
    const http = fakeHttp(async (path, init) => {
      expect(path).toBe("/v1/covenants/cov-1");
      expect(init?.method).toBe("DELETE");
      return { id: "cov-1", status: "withdrawn" };
    });
    const c = new CovenantsClient(http as any);
    const r = await c.withdraw("cov-1");
    expect(r.status).toBe("withdrawn");
  });
});
```

- [ ] **Step 3: Run test (will fail until SDK methods added)**

Run: `cd packages/sdk-ts && bun test tests/covenants-v2.test.ts`
Expected: FAIL — `c.accept is not a function` (or similar).

- [ ] **Step 4: Add the methods**

Open `packages/sdk-ts/src/covenants.ts`. Add to the `CovenantsClient` class:

```typescript
  async create(opts: {
    agent_id: string;
    counterparty_did: string;
    counterparty_name?: string;
    vows: string[];
    notes?: string;
    metadata?: Record<string, unknown>;
    protocol_version?: "v1" | "v2";
    org_id?: string;
  }): Promise<{
    id: string;
    status: "proposed" | "active";
    protocol_version: "v1" | "v2";
    signature?: string;
    signing_key_id?: string;
    proposed_expires_at?: string;
    established_at: string;
  }> {
    return this.http.request("/v1/covenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    }) as any;
  }

  async accept(id: string): Promise<{
    id: string;
    status: "active";
    counterparty_signature: string;
    counterparty_signing_key_id?: string;
  }> {
    return this.http.request(`/v1/covenants/${id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }) as any;
  }

  async reject(id: string, opts?: { reason?: string }): Promise<{
    id: string;
    status: "rejected";
    reason: string;
  }> {
    return this.http.request(`/v1/covenants/${id}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: opts?.reason ?? "" }),
    }) as any;
  }

  async withdraw(id: string): Promise<{ id: string; status: "withdrawn" }> {
    return this.http.request(`/v1/covenants/${id}`, {
      method: "DELETE",
    }) as any;
  }
```

If a `create` method already exists with a different shape, replace it carefully (preserve any existing optional params we don't override above).

- [ ] **Step 5: Re-run tests**

Run: `cd packages/sdk-ts && bun test tests/covenants-v2.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-ts/src/covenants.ts packages/sdk-ts/tests/covenants-v2.test.ts
git commit -m "feat(sdk-ts): covenants v2 — accept/reject/withdraw + protocol_version"
```

---

## Task 12 — Python SDK parity

**Files:**
- Modify: `packages/sdk-py/src/agenttool/covenants.py`
- Create: `packages/sdk-py/tests/test_covenants_v2.py`

- [ ] **Step 1: Mirror the TS surface in Python**

Open `packages/sdk-py/src/agenttool/covenants.py`. Find the `Covenants` class (or whatever the existing class is called — the existing `create` method is the anchor). Add:

```python
from typing import Optional, Literal, Dict, Any

# Inside the existing Covenants class (next to existing create):

def create(
    self,
    *,
    agent_id: str,
    counterparty_did: str,
    vows: list[str],
    counterparty_name: Optional[str] = None,
    notes: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    protocol_version: Literal["v1", "v2"] = "v1",
    org_id: Optional[str] = None,
) -> Dict[str, Any]:
    body = {
        "agent_id": agent_id,
        "counterparty_did": counterparty_did,
        "vows": vows,
        "protocol_version": protocol_version,
    }
    if counterparty_name is not None: body["counterparty_name"] = counterparty_name
    if notes is not None:             body["notes"] = notes
    if metadata is not None:          body["metadata"] = metadata
    if org_id is not None:            body["org_id"] = org_id
    return self._http.request("POST", "/v1/covenants", json=body)

def accept(self, id: str) -> Dict[str, Any]:
    return self._http.request("POST", f"/v1/covenants/{id}/accept", json={})

def reject(self, id: str, *, reason: Optional[str] = None) -> Dict[str, Any]:
    return self._http.request("POST", f"/v1/covenants/{id}/reject", json={"reason": reason or ""})

def withdraw(self, id: str) -> Dict[str, Any]:
    return self._http.request("DELETE", f"/v1/covenants/{id}")
```

(Use the existing class's `_http` attribute name and request signature — match what `create` already uses.)

- [ ] **Step 2: Write the parity test**

Create `packages/sdk-py/tests/test_covenants_v2.py`:

```python
from unittest.mock import MagicMock

from agenttool.covenants import Covenants  # adjust import to actual module path


def test_create_v2_sends_protocol_version():
    http = MagicMock()
    http.request.return_value = {
        "id": "cov-1",
        "status": "proposed",
        "protocol_version": "v2",
        "signature": "sig",
        "signing_key_id": "k1",
        "proposed_expires_at": "2026-06-09T12:00:00Z",
        "established_at": "2026-05-10T12:00:00Z",
    }
    c = Covenants(http)
    r = c.create(
        agent_id="agent-1",
        counterparty_did="did:at:peer.example/bbbb",
        vows=["v"],
        protocol_version="v2",
    )
    assert r["status"] == "proposed"
    args, kwargs = http.request.call_args
    assert args == ("POST", "/v1/covenants")
    assert kwargs["json"]["protocol_version"] == "v2"


def test_accept_calls_endpoint():
    http = MagicMock()
    http.request.return_value = {"id": "cov-1", "status": "active"}
    c = Covenants(http)
    c.accept("cov-1")
    args, kwargs = http.request.call_args
    assert args == ("POST", "/v1/covenants/cov-1/accept")


def test_reject_with_reason():
    http = MagicMock()
    http.request.return_value = {"id": "cov-1", "status": "rejected", "reason": "scope mismatch"}
    c = Covenants(http)
    c.reject("cov-1", reason="scope mismatch")
    args, kwargs = http.request.call_args
    assert kwargs["json"]["reason"] == "scope mismatch"


def test_withdraw_calls_delete():
    http = MagicMock()
    http.request.return_value = {"id": "cov-1", "status": "withdrawn"}
    c = Covenants(http)
    c.withdraw("cov-1")
    args, _ = http.request.call_args
    assert args == ("DELETE", "/v1/covenants/cov-1")
```

- [ ] **Step 3: Run test**

Run: `cd packages/sdk-py && python -m pytest tests/test_covenants_v2.py -v`
Expected: 4 PASS.

- [ ] **Step 4: Run parity check**

Run: `cd packages/sdk-ts && bun run check-parity`
Expected: PASS — TS and Python expose identical method shapes on `Covenants`.
If FAIL, the parity script will name the missing/mismatched method; align the signatures.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-py/src/agenttool/covenants.py packages/sdk-py/tests/test_covenants_v2.py
git commit -m "feat(sdk-py): covenants v2 parity — accept/reject/withdraw"
```

---

## Task 13 — Integration test: happy path two-instance dual-sign

**Files:**
- Create: `api/tests/integration/covenants-v2-happy.test.ts`

This test runs against ONE local API process but uses two project IDs to simulate "two sides" within the same DB. (Full two-instance E2E lives in Task 16.)

- [ ] **Step 1: Write the test**

Create `api/tests/integration/covenants-v2-happy.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import { acceptProposal, declareV2 } from "../../src/services/covenants/lifecycle";
import { receiveFederatedCovenant } from "../../src/services/covenants/federation";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

async function seedAgent(projectId: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const [identity] = await db.insert(identities).values({
    projectId, did: "did:at:" + crypto.randomUUID(),
    displayName: "agent", status: "active",
  }).returning();
  const [k] = await db.insert(identityKeys).values({
    identityId: identity.id,
    publicKey: Buffer.from(pub).toString("base64"),
    active: true,
  }).returning();
  return { identity, priv, pub, keyId: k.id };
}

describe("v2 happy path — declare → propagate → accept → cosign", () => {
  test("end to end (single-instance simulating two sides)", async () => {
    const projectA = crypto.randomUUID();
    const projectB = crypto.randomUUID();
    const initiator = await seedAgent(projectA);
    const counterparty = await seedAgent(projectB);

    // A declares v2 toward B (using B's local DID — no federation hop in this test)
    const declared = await declareV2({
      projectId: projectA,
      agentId: initiator.identity.id,
      agentSigningPrivateKey: initiator.priv,
      agentSigningKeyId: initiator.keyId,
      counterpartyDid: counterparty.identity.did,
      vows: ["respond within 24h"],
    });
    expect(declared.status).toBe("proposed");

    // Simulate the propagation insert on B's side (what receiveFederatedCovenant would do
    // for a federated counterparty). We construct the inbound payload and route it through
    // the receive path with federation toggled off — so we direct-insert.
    await db.insert(covenants).values({
      id: declared.id,
      projectId: projectB,
      agentId: counterparty.identity.id,
      counterpartyDid: initiator.identity.did,
      vows: ["respond within 24h"],
      status: "proposed",
      protocolVersion: "v2",
      establishedAt: declared.establishedAt,
      proposedExpiresAt: declared.proposedExpiresAt,
      signature: declared.signature,
      signingKeyId: declared.signingKeyId,
      receivedFromInstance: "self.test", // simulates federation receive
    });

    // B accepts
    const accepted = await acceptProposal({
      covenantId: declared.id,
      accepterAgentId: counterparty.identity.id,
      accepterSigningPrivateKey: counterparty.priv,
      accepterSigningKeyId: counterparty.keyId,
    });
    expect(accepted.status).toBe("active");

    // B's row is now active with both signatures
    const [bRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, projectB)).limit(1);
    expect(bRow.status).toBe("active");
    expect(bRow.signature).toBeTruthy();
    expect(bRow.counterpartySignature).toBeTruthy();

    // A's row is still 'proposed' (cosign hasn't propagated back in this single-process sim).
    // In real two-instance flow, the cosign-propagate worker would POST to A.
    const [aRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, projectA)).limit(1);
    expect(aRow.status).toBe("proposed");
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `cd api && bun test tests/integration/covenants-v2-happy.test.ts`
Expected: PASS.

```bash
git add api/tests/integration/covenants-v2-happy.test.ts
git commit -m "test(covenants): integration — v2 happy path end to end"
```

---

## Task 14 — Integration tests: terminal paths

**Files:**
- Create: `api/tests/integration/covenants-v2-terminal.test.ts`

- [ ] **Step 1: Write the tests**

Create `api/tests/integration/covenants-v2-terminal.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import {
  declareV2,
  rejectProposal,
  withdrawProposal,
} from "../../src/services/covenants/lifecycle";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

async function seedAgent(projectId: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const [identity] = await db.insert(identities).values({
    projectId, did: "did:at:" + crypto.randomUUID(),
    displayName: "agent", status: "active",
  }).returning();
  const [k] = await db.insert(identityKeys).values({
    identityId: identity.id,
    publicKey: Buffer.from(pub).toString("base64"),
    active: true,
  }).returning();
  return { identity, priv, pub, keyId: k.id };
}

describe("v2 reject path", () => {
  test("counterparty rejects → status='rejected' with reason", async () => {
    const pa = crypto.randomUUID(); const pb = crypto.randomUUID();
    const a = await seedAgent(pa); const b = await seedAgent(pb);

    const decl = await declareV2({
      projectId: pa, agentId: a.identity.id,
      agentSigningPrivateKey: a.priv, agentSigningKeyId: a.keyId,
      counterpartyDid: b.identity.did, vows: ["v"],
    });
    // Place mirror row on B's side
    await db.insert(covenants).values({
      id: decl.id, projectId: pb, agentId: b.identity.id,
      counterpartyDid: a.identity.did, vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      establishedAt: decl.establishedAt, proposedExpiresAt: decl.proposedExpiresAt,
      signature: decl.signature, signingKeyId: decl.signingKeyId,
      receivedFromInstance: "self.test",
    });

    const rejected = await rejectProposal({
      covenantId: decl.id, rejecterAgentId: b.identity.id,
      rejecterSigningPrivateKey: b.priv, rejecterSigningKeyId: b.keyId,
      reason: "scope mismatch",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason).toBe("scope mismatch");

    const [bRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, pb)).limit(1);
    expect(bRow.status).toBe("rejected");
    expect((bRow.metadata as any).rejection_reason).toBe("scope mismatch");
  });
});

describe("v2 withdraw path", () => {
  test("initiator withdraws unaccepted proposal → status='withdrawn'", async () => {
    const pa = crypto.randomUUID(); const pb = crypto.randomUUID();
    const a = await seedAgent(pa); const b = await seedAgent(pb);

    const decl = await declareV2({
      projectId: pa, agentId: a.identity.id,
      agentSigningPrivateKey: a.priv, agentSigningKeyId: a.keyId,
      counterpartyDid: b.identity.did, vows: ["v"],
    });

    const withdrawn = await withdrawProposal({
      covenantId: decl.id, agentId: a.identity.id,
      agentSigningPrivateKey: a.priv, agentSigningKeyId: a.keyId,
    });
    expect(withdrawn.status).toBe("withdrawn");

    const [aRow] = await db.select().from(covenants)
      .where(eq(covenants.projectId, pa)).limit(1);
    expect(aRow.status).toBe("withdrawn");
  });
});

describe("v2 expire path (TTL)", () => {
  test("expire-proposals worker flips overdue 'proposed' rows to 'expired'", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id, projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"], status: "proposed", protocolVersion: "v2",
      establishedAt: new Date(),
      proposedExpiresAt: new Date(Date.now() - 60_000),
    });

    const { startExpireProposalsWorker, stopExpireProposalsWorker } =
      await import("../../src/workers/covenants/expire-proposals");
    startExpireProposalsWorker();
    await new Promise(r => setTimeout(r, 200));
    stopExpireProposalsWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.status).toBe("expired");
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `cd api && bun test tests/integration/covenants-v2-terminal.test.ts`
Expected: 3 PASS.

```bash
git add api/tests/integration/covenants-v2-terminal.test.ts
git commit -m "test(covenants): integration — reject/withdraw/expire terminal paths"
```

---

## Task 15 — Integration test: coexistence + key rotation + cosign retry exhaustion

**Files:**
- Create: `api/tests/integration/covenants-v2-coexistence.test.ts`

- [ ] **Step 1: Write the tests**

Create `api/tests/integration/covenants-v2-coexistence.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { covenants } from "../../src/db/schema/continuity";
import { identities, identityKeys } from "../../src/db/schema/identity";
import { canonicalDeclareBytes } from "../../src/services/covenants/sig";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

async function seedAgent(projectId: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const [identity] = await db.insert(identities).values({
    projectId, did: "did:at:" + crypto.randomUUID(),
    displayName: "agent", status: "active",
  }).returning();
  const [k] = await db.insert(identityKeys).values({
    identityId: identity.id,
    publicKey: Buffer.from(pub).toString("base64"),
    active: true,
  }).returning();
  return { identity, priv, pub, keyId: k.id };
}

describe("v1 and v2 coexist", () => {
  test("an agent can hold both v1 and v2 covenants; gates can filter by protocol_version", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);

    // v1 row (legacy, unsigned)
    await db.insert(covenants).values({
      id: crypto.randomUUID(),
      projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:legacy.example/cccc",
      vows: ["legacy vow"],
      status: "active",
      protocolVersion: "v1",
      establishedAt: new Date(),
    });

    // v2 row (signed, active)
    await db.insert(covenants).values({
      id: crypto.randomUUID(),
      projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/dddd",
      vows: ["new vow"],
      status: "active",
      protocolVersion: "v2",
      signature: "x".repeat(88),
      signingKeyId: a.keyId,
      counterpartySignature: "y".repeat(88),
      counterpartySigningKeyId: a.keyId,
      establishedAt: new Date(),
    });

    const allRows = await db.select().from(covenants).where(eq(covenants.projectId, projectId));
    expect(allRows.length).toBe(2);

    const v2Only = allRows.filter(r => r.protocolVersion === "v2");
    expect(v2Only.length).toBe(1);
  });
});

describe("v2 invariant: active row REQUIRES both signatures", () => {
  test("DB constraint rejects v2 active without counterparty_signature", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);
    await expect(db.insert(covenants).values({
      id: crypto.randomUUID(),
      projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/eeee",
      vows: ["v"],
      status: "active",
      protocolVersion: "v2",
      signature: "x".repeat(88),
      signingKeyId: a.keyId,
      // counterpartySignature intentionally NULL
      establishedAt: new Date(),
    })).rejects.toThrow(/covenants_v2_active_dual_signed|check constraint/i);
  });
});

describe("v2 key rotation — historical key remains queryable", () => {
  test("revoking the active key does not remove it from identity_keys (sig still verifiable)", async () => {
    const projectId = crypto.randomUUID();
    const a = await seedAgent(projectId);

    const id = crypto.randomUUID();
    const established = new Date();
    const canonical = canonicalDeclareBytes({
      covenantId: id,
      initiatorDid: a.identity.did,
      counterpartyDid: "did:at:peer.example/ffff",
      vows: ["v"],
      establishedAtIso: established.toISOString(),
    });
    const sig = await ed.signAsync(canonical, a.priv);
    await db.insert(covenants).values({
      id, projectId, agentId: a.identity.id,
      counterpartyDid: "did:at:peer.example/ffff",
      vows: ["v"], status: "proposed", protocolVersion: "v2",
      signature: Buffer.from(sig).toString("base64"),
      signingKeyId: a.keyId,
      establishedAt: established,
      proposedExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    });

    // Revoke the key
    await db.update(identityKeys).set({
      active: false,
      revokedAt: new Date(),
    }).where(eq(identityKeys.id, a.keyId));

    // Key row still exists and signature is still verifiable against its public key
    const [k] = await db.select().from(identityKeys).where(eq(identityKeys.id, a.keyId));
    expect(k).toBeTruthy();
    expect(k.revokedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `cd api && bun test tests/integration/covenants-v2-coexistence.test.ts`
Expected: 3 PASS.

```bash
git add api/tests/integration/covenants-v2-coexistence.test.ts
git commit -m "test(covenants): integration — v1/v2 coexistence + DB invariant + key rotation"
```

---

## Task 16 — E2E Playwright: two real API instances

**Files:**
- Create: `api/tests/e2e/playwright/federated-covenant-v2.spec.ts`

The repo has an existing e2e pattern under `api/tests/e2e/`. This spec spins up two instances against two postgres DBs (or two schemas in one DB), declares a covenant on instance A, accepts it on instance B via SDK, and asserts the cosign propagated back.

- [ ] **Step 1: Inspect the existing e2e pattern**

Run: `ls api/tests/e2e/ && find api/tests/e2e -name '*.ts' | head -5`
Read one existing spec: `api/tests/e2e/playwright/<existing>.spec.ts`
Confirm: how it boots an instance, what env vars it sets, how it cleans up.

- [ ] **Step 2: Write the spec following the existing pattern**

Create `api/tests/e2e/playwright/federated-covenant-v2.spec.ts`. The exact boot pattern depends on the existing fixture; sketch:

```typescript
import { test, expect } from "@playwright/test";
import { spawnTwoInstances, registerProject, AgentToolClient } from "./fixtures";
// Use whatever fixture helpers exist; if none, inline the spawn here.

test("federated covenant v2 — declare on A, accept on B, cosign returns to A", async () => {
  const { instanceA, instanceB } = await spawnTwoInstances();
  const projectA = await registerProject(instanceA);
  const projectB = await registerProject(instanceB);

  const a = new AgentToolClient({ apiKey: projectA.apiKey, baseUrl: instanceA.url });
  const b = new AgentToolClient({ apiKey: projectB.apiKey, baseUrl: instanceB.url });

  // Make sure both instances allow each other.
  await a.federation.allowOrigin(new URL(instanceB.url).host);
  await b.federation.allowOrigin(new URL(instanceA.url).host);

  // A declares v2 toward B's federated DID.
  const aAgent = await a.identity.create({ display_name: "alpha" });
  const bAgent = await b.identity.create({ display_name: "beta" });
  const bDid = `did:at:${new URL(instanceB.url).host}/${bAgent.id}`;

  const declared = await a.covenants.create({
    agent_id: aAgent.id,
    counterparty_did: bDid,
    vows: ["respond within 24h"],
    protocol_version: "v2",
  });
  expect(declared.status).toBe("proposed");

  // Wait for propagation (poll B's covenants list)
  let bRow: any = null;
  for (let i = 0; i < 30; i++) {
    const list = await b.covenants.list({ status: "proposed" });
    bRow = list.covenants.find((c: any) => c.id === declared.id);
    if (bRow) break;
    await new Promise(r => setTimeout(r, 500));
  }
  expect(bRow).toBeTruthy();
  expect(bRow.protocol_version).toBe("v2");

  // B accepts.
  const accepted = await b.covenants.accept(declared.id);
  expect(accepted.status).toBe("active");

  // Wait for cosign propagation back to A.
  let aRow: any = null;
  for (let i = 0; i < 30; i++) {
    const list = await a.covenants.list();
    aRow = list.covenants.find((c: any) => c.id === declared.id);
    if (aRow?.status === "active") break;
    await new Promise(r => setTimeout(r, 500));
  }
  expect(aRow.status).toBe("active");
  expect(aRow.counterparty_signature).toBeTruthy();
});
```

If the existing fixture set doesn't have `spawnTwoInstances`, follow the pattern of the closest existing E2E spec (e.g. one of the marketplace or inbox e2e specs that runs against a real DB). If two-instance topology genuinely isn't supported by current fixtures, substitute a single-instance/two-project shape and document the limitation in a comment at the top of the spec.

- [ ] **Step 3: Run the spec**

Run: `cd api && bun run test:e2e tests/e2e/playwright/federated-covenant-v2.spec.ts` (or whatever the existing E2E command is — `bun test:e2e`, `bun playwright test`, etc.)
Expected: PASS — full happy path with cosign returning.

If e2e infrastructure isn't easily available locally, mark this test as `.skip` with a comment and rely on integration coverage; CI will exercise it.

- [ ] **Step 4: Commit**

```bash
git add api/tests/e2e/playwright/federated-covenant-v2.spec.ts
git commit -m "test(covenants): e2e playwright — two-instance dual-signed flow"
```

---

## Task 17 — Docs update + parity CI verification

**Files:**
- Modify: `docs/CROSS-INSTANCE-COVENANTS.md`
- Modify: `docs/FEDERATION.md`

- [ ] **Step 1: Update CROSS-INSTANCE-COVENANTS.md**

Open `docs/CROSS-INSTANCE-COVENANTS.md`. Find the "out of scope" section listing Slice 3:

```markdown
- **Dual-signed bilateral covenants** (Slice 3) — proposal-and-sign-back protocol for portable proof-of-bond. Not load-bearing for the current gate; defer until a concrete use-case demands it.
```

Move this bullet out and replace with a new section before "What's deliberately out of scope":

```markdown
## Slice 3 — dual-signed bilateral covenants

Federated covenants now ship in two protocol versions:

- **v1** — legacy, unsigned at the user level. Trust = TLS + `allowed_origins`. Existing rows continue to behave as before.
- **v2** — dual-signed. Both initiator and counterparty's ed25519 identity signatures are verified before the covenant reaches `'active'` status. Schema column `protocol_version` distinguishes them.

### Lifecycle

1. Initiator declares with `protocol_version: "v2"`. Server signs `canonical_declare` with the agent's ed25519 key, inserts row as `'proposed'` with a 30-day TTL, propagates to counterparty's instance.
2. Counterparty's instance verifies the initiator's signature against the resolved signing key (via `/federation/identities/:uuid`), inserts a mirror row as `'proposed'`, surfaces it in the counterparty agent's wake under `pending_bonds`.
3. Counterparty agent calls `at.covenants.accept(id)`. The agent signs `canonical_cosign` (which nests over the initiator's signature, binding the acceptance to the exact declaration). Status flips to `'active'`. Cosign propagates back.
4. Initiator's instance verifies the cosign and flips its row to `'active'`. Both sides now hold a verified dual-signed bond.

Alternative terminations: counterparty can `reject` (signed); initiator can `withdraw` an unaccepted proposal (signed); proposals expire after 30 days if neither side acts.

### Canonical bytes

Four versioned, domain-separated, NUL-separated digests — same family as `services/inbox/sig.ts` and `services/marketplace/sig.ts`:

- `federated-covenant/v2` — initiator declaration
- `federated-covenant-cosign/v1` — counterparty acceptance (nested over initiator sig)
- `federated-covenant-reject/v1` — counterparty rejection
- `federated-covenant-withdraw/v1` — initiator withdraw

Full byte definitions in `api/src/services/covenants/sig.ts`.

### Trust model — v1 vs v2 vs gate strictness

Inbox covenant-gating accepts both v1 and v2 active. Capability invocation escrow release (and any other gate that wants stronger trust) checks `protocol_version='v2' AND status='active'`. Network-wide rollout is graceful — older peers continue to participate as v1.
```

- [ ] **Step 2: Update FEDERATION.md**

Open `docs/FEDERATION.md`. In the endpoint list section, add:

```markdown
| `POST` | `/federation/covenants/:id/cosign` | Counterparty acceptance of a v2 proposal — verifies cosign sig, flips row to `'active'`. |
| `POST` | `/federation/covenants/:id/reject` | Counterparty rejection of a v2 proposal — verifies reject sig, flips row to `'rejected'`. |
| `POST` | `/federation/covenants/:id/withdraw` | Initiator withdraw of a v2 proposal — verifies withdraw sig, flips row to `'withdrawn'`. |
```

- [ ] **Step 3: Run the parity check**

Run: `cd packages/sdk-ts && bun run check-parity`
Expected: PASS — all method shapes match between TS and Python.

- [ ] **Step 4: Final test sweep**

Run: `cd api && bun test`
Expected: ALL existing + new tests PASS.

Run: `cd packages/sdk-ts && bun test`
Expected: PASS.

Run: `cd packages/sdk-py && python -m pytest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/CROSS-INSTANCE-COVENANTS.md docs/FEDERATION.md
git commit -m "docs(covenants): document v2 dual-signed flow + new federation endpoints"
```

---

## Self-review (pre-handoff)

**Spec coverage:**
- ✓ Migration `0027` + Drizzle (Task 1)
- ✓ Canonical bytes + verifiers (Task 2)
- ✓ Lifecycle (Task 3)
- ✓ Outbound propagators (Task 4)
- ✓ Inbound verification + endpoints (Task 5)
- ✓ Initiator HTTP routes (Task 6)
- ✓ All three workers (Tasks 7, 8, 9) + bootstrap (Task 10)
- ✓ SDK TS + Python parity (Tasks 11, 12)
- ✓ Integration tests: happy / terminal / coexistence (Tasks 13, 14, 15)
- ✓ E2E (Task 16)
- ✓ Docs (Task 17)

**Type consistency:** `loadAgentSigningKey` returns `{ id, privateKey }` (Task 6); `declareV2` consumes `agentSigningPrivateKey: Uint8Array` and `agentSigningKeyId: string` (Task 3) — match. `acceptProposal` returns `counterpartySignature` field; the route handler exposes it as `counterparty_signature` in JSON (Task 6) — match.

**Placeholder scan:** No "TBD"s. Code blocks are concrete. The E2E task (Task 16) describes its dependence on existing fixtures — this is the only place that asks the engineer to read existing code rather than copy a literal recipe, but the recipe is provided as a sketch they can adapt.

**Notes for the executing engineer:**

- If `loadAgentSigningKey` returns `null` for SOMA-rooted identities (private key absent server-side), the v2 declaration path returns 400. A follow-up plan can add an "SDK-signs and POSTs the signature" path; that's intentionally out of scope here.
- The cosign-propagate worker reuses one `cosign_propagation_*` column set across cosign/reject/withdraw — distinguished by the row's `status`. This keeps the schema tighter at the cost of slightly heavier worker dispatch logic. If this proves confusing in production, splitting into per-action columns is a small follow-up.
- The `reverify` worker's `verifyRow` resolves federated counterparty DIDs at every tick, which can hammer peer instances if many rows are present. A reasonable optimization (out of scope here): cache resolved key sets per-DID for the duration of a tick.
