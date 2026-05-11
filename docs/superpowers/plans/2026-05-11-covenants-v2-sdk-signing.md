# Covenants v2 SDK Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move v2 covenant signing from the server (where the stub `loadAgentSigningKey` can't sign) to the SDK (where the agent's private key lives), closing the HTTP loop on the dual-signed flow shipped in Slice 3.

**Architecture:** Caller passes `signing_key: Uint8Array` + `signing_key_id` + `agent_did` to each `at.covenants.*` method. SDK allocates `covenant_id` + `established_at` at declare time, computes canonical bytes via new helpers in `crypto.ts` mirroring `services/covenants/sig.ts`, signs with ed25519, and POSTs the signature in the body. Server resolves the signer's pubkey from `identity_keys`, calls a new `*PreSigned` lifecycle function which verifies the sig before writing. Original `declareV2`/`acceptProposal`/etc. delete; `loadAgentSigningKey` deletes.

**Tech Stack:** Bun + Hono + Drizzle/Postgres on the API; `@noble/ed25519` + `@noble/hashes` for crypto on TS; Python `cryptography` library's `Ed25519PrivateKey` for parity. Same byte format across all three (api server / TS SDK / Python SDK).

**Spec:** `docs/superpowers/specs/2026-05-11-covenants-v2-sdk-signing-design.md`
**Predecessor:** `docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md` (the Slice 3 shipment this completes)

---

## File map

**API:**
- `api/src/services/covenants/lifecycle.ts` — replace 4 fns with `*PreSigned` variants
- `api/src/routes/continuity.ts` — wire to PreSigned; require v2 fields in Zod
- `api/src/routes/federation/covenants.ts` — already wired for cosign/reject/withdraw; verify no changes needed (this was built for SDK signing from day one)
- `api/src/services/identity/crypto.ts` — DELETE `loadAgentSigningKey`
- `api/tests/covenants-lifecycle.test.ts` — migrate tests to PreSigned
- `api/tests/covenants-lifecycle-presigned.test.ts` — NEW (signature verification specifics)
- `api/tests/covenants-canonical-vectors.test.ts` — NEW (cross-impl byte parity)
- `api/tests/integration/covenants-v2-happy.test.ts` — migrate to PreSigned

**SDK (TypeScript):**
- `packages/sdk-ts/src/crypto.ts` — add 4 canonical fns + 4 sign fns
- `packages/sdk-ts/src/covenants.ts` — extend methods to sign + post
- `packages/sdk-ts/tests/covenants-v2.test.ts` — existing tests updated
- `packages/sdk-ts/tests/covenants-v2-signing.test.ts` — NEW

**SDK (Python — parity):**
- `packages/sdk-py/src/agenttool/crypto.py` — add 4 canonical + 4 sign fns
- `packages/sdk-py/src/agenttool/covenants.py` — extend methods
- `packages/sdk-py/tests/test_covenants_v2.py` — existing tests updated
- `packages/sdk-py/tests/test_covenants_v2_signing.py` — NEW
- `packages/sdk-py/tests/test_covenants_canonical_vectors.py` — NEW (Python side of the cross-impl lock)

**Docs:**
- `docs/CROSS-INSTANCE-COVENANTS.md` — flip the "Implementation note" callout
- `docs/ROADMAP.md` — mark SDK-side signing follow-up as shipped

---

## Task 1 — TS SDK canonical bytes + sign helpers

**Files:**
- Modify: `packages/sdk-ts/src/crypto.ts`
- Modify: `packages/sdk-ts/src/index.ts` (re-export new helpers)
- Create: `packages/sdk-ts/tests/covenants-crypto.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/sdk-ts/tests/covenants-crypto.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
  signCovenantDeclare,
  signCovenantCosign,
  signCovenantReject,
  signCovenantWithdraw,
} from "../src/crypto";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("covenants canonical bytes", () => {
  const declareOpts = {
    covenantId: "11111111-1111-1111-1111-111111111111",
    initiatorDid: "did:at:initiator.example/aaaa",
    counterpartyDid: "did:at:cp.example/bbbb",
    vows: ["one", "two"],
    establishedAtIso: "2026-05-11T12:00:00.000Z",
  };

  test("declare is deterministic and sort-stable", () => {
    expect(canonicalDeclareBytes(declareOpts)).toEqual(canonicalDeclareBytes(declareOpts));
    expect(canonicalDeclareBytes(declareOpts)).toEqual(
      canonicalDeclareBytes({ ...declareOpts, vows: ["two", "one"] }),
    );
  });

  test("four domains produce four distinct digests for related inputs", () => {
    const covenantId = "22222222-2222-2222-2222-222222222222";
    const did = "did:at:test/cccc";
    const declare = canonicalDeclareBytes({
      covenantId, initiatorDid: did, counterpartyDid: did,
      vows: ["v"], establishedAtIso: "2026-05-11T12:00:00.000Z",
    });
    const cosign = canonicalCosignBytes({ covenantId, initiatorSignatureB64: b64(new Uint8Array(64)) });
    const reject = canonicalRejectBytes({ covenantId, rejectingDid: did, reason: "" });
    const withdraw = canonicalWithdrawBytes({ covenantId, initiatorDid: did });
    const set = new Set([b64(declare), b64(cosign), b64(reject), b64(withdraw)]);
    expect(set.size).toBe(4);
  });
});

describe("covenants sign roundtrips", () => {
  test("declare sign verifies", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "33333333-3333-3333-3333-333333333333",
      initiatorDid: "did:at:initiator/aaaa",
      counterpartyDid: "did:at:cp/bbbb",
      vows: ["v"],
      establishedAtIso: "2026-05-11T12:00:00.000Z",
    };
    const sig = signCovenantDeclare({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalDeclareBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("cosign sign verifies", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "44444444-4444-4444-4444-444444444444",
      initiatorSignatureB64: b64(new Uint8Array(64).fill(7)),
    };
    const sig = signCovenantCosign({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalCosignBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("reject sign verifies (with reason)", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "55555555-5555-5555-5555-555555555555",
      rejectingDid: "did:at:cp/bbbb",
      reason: "scope mismatch",
    };
    const sig = signCovenantReject({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalRejectBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("withdraw sign verifies", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const opts = {
      covenantId: "66666666-6666-6666-6666-666666666666",
      initiatorDid: "did:at:initiator/aaaa",
    };
    const sig = signCovenantWithdraw({ ...opts, signing_key: priv });
    const ok = await ed.verifyAsync(
      Buffer.from(sig, "base64"),
      canonicalWithdrawBytes(opts),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("signCovenantDeclare rejects wrong key length", () => {
    const opts = {
      covenantId: "77777777-7777-7777-7777-777777777777",
      initiatorDid: "did:at:initiator/aaaa",
      counterpartyDid: "did:at:cp/bbbb",
      vows: ["v"],
      establishedAtIso: "2026-05-11T12:00:00.000Z",
    };
    expect(() => signCovenantDeclare({ ...opts, signing_key: new Uint8Array(16) })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sdk-ts && bun test tests/covenants-crypto.test.ts`
Expected: FAIL — `Cannot find module ... canonicalDeclareBytes`.

- [ ] **Step 3: Implement the helpers in `crypto.ts`**

Open `packages/sdk-ts/src/crypto.ts`. After the existing `signThought` function (search for `export function signThought`), append the following block. The `SEP`, `concat`, `b64encode`, `b64decode` helpers + the `ed.etc.sha512Sync` wiring already exist at the top of the file; reuse them.

```typescript
// ── Covenants v2 canonical bytes + signing (Slice 3) ─────────────────
// Mirrors api/src/services/covenants/sig.ts byte format. Cross-language
// vector test locks these to the server + python SDK.

const enc = new TextEncoder();

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

function assertSigningKey(signing_key: Uint8Array, label: string): void {
  if (signing_key.length !== 32) {
    throw new AgentToolError(
      `${label}: signing_key must be a 32-byte ed25519 seed, got ${signing_key.length}.`,
    );
  }
}

export interface SignCovenantDeclareOpts {
  covenantId: string;
  initiatorDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
  signing_key: Uint8Array;
}

export function signCovenantDeclare(opts: SignCovenantDeclareOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantDeclare");
  const canonical = canonicalDeclareBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

export interface SignCovenantCosignOpts {
  covenantId: string;
  initiatorSignatureB64: string;
  signing_key: Uint8Array;
}

export function signCovenantCosign(opts: SignCovenantCosignOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantCosign");
  const canonical = canonicalCosignBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

export interface SignCovenantRejectOpts {
  covenantId: string;
  rejectingDid: string;
  reason: string;
  signing_key: Uint8Array;
}

export function signCovenantReject(opts: SignCovenantRejectOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantReject");
  const canonical = canonicalRejectBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

export interface SignCovenantWithdrawOpts {
  covenantId: string;
  initiatorDid: string;
  signing_key: Uint8Array;
}

export function signCovenantWithdraw(opts: SignCovenantWithdrawOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantWithdraw");
  const canonical = canonicalWithdrawBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}
```

If `enc` is already declared at module scope from a prior task, the local `const enc = new TextEncoder();` will conflict. In that case, remove the local declaration and rely on the existing one. Search the file with `grep -n "TextEncoder" packages/sdk-ts/src/crypto.ts` before pasting.

- [ ] **Step 4: Add the new exports to the SDK's public surface**

Open `packages/sdk-ts/src/index.ts`. Find the existing `kMaster`, `kVault` exports from `./crypto.js` (around line 127). Add the new helpers to the same export block:

```typescript
export {
  // ... existing exports stay ...
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
  signCovenantDeclare,
  signCovenantCosign,
  signCovenantReject,
  signCovenantWithdraw,
} from "./crypto.js";
```

Also expose them on the `CryptoClient` class if the existing code attaches `signThought` as a method (it does at around line 294). Add four parallel methods next to `signThought`:

```typescript
  /** Sign canonical covenant declare bytes with ed25519. */
  signCovenantDeclare(opts: SignCovenantDeclareOpts): string {
    return signCovenantDeclare(opts);
  }
  /** Sign canonical cosign bytes with ed25519. */
  signCovenantCosign(opts: SignCovenantCosignOpts): string {
    return signCovenantCosign(opts);
  }
  /** Sign canonical reject bytes with ed25519. */
  signCovenantReject(opts: SignCovenantRejectOpts): string {
    return signCovenantReject(opts);
  }
  /** Sign canonical withdraw bytes with ed25519. */
  signCovenantWithdraw(opts: SignCovenantWithdrawOpts): string {
    return signCovenantWithdraw(opts);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/sdk-ts && bun test tests/covenants-crypto.test.ts`
Expected: 5 PASS.

Also run the full SDK suite to confirm no regressions:
Run: `cd packages/sdk-ts && bun test 2>&1 | tail -5`
Expected: 239 pass / 0 fail (5 more than before).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-ts/src/crypto.ts packages/sdk-ts/src/index.ts packages/sdk-ts/tests/covenants-crypto.test.ts
git commit -m "feat(sdk-ts): canonical bytes + ed25519 signing for covenants v2"
```

---

## Task 2 — Python SDK canonical bytes + sign helpers (parity)

**Files:**
- Modify: `packages/sdk-py/src/agenttool/crypto.py`
- Modify: `packages/sdk-py/src/agenttool/__init__.py` (re-export if the existing crypto helpers are re-exported)
- Create: `packages/sdk-py/tests/test_covenants_crypto.py`

- [ ] **Step 1: Write the failing tests**

Create `packages/sdk-py/tests/test_covenants_crypto.py`:

```python
import base64
import secrets

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from agenttool.crypto import (
    canonical_declare_bytes,
    canonical_cosign_bytes,
    canonical_reject_bytes,
    canonical_withdraw_bytes,
    sign_covenant_declare,
    sign_covenant_cosign,
    sign_covenant_reject,
    sign_covenant_withdraw,
)


def _new_keypair():
    seed = secrets.token_bytes(32)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub_bytes = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return seed, priv, pub_bytes


def test_declare_canonical_deterministic_and_sort_stable():
    opts = dict(
        covenant_id="11111111-1111-1111-1111-111111111111",
        initiator_did="did:at:initiator/aaaa",
        counterparty_did="did:at:cp/bbbb",
        vows=["one", "two"],
        established_at_iso="2026-05-11T12:00:00.000Z",
    )
    assert canonical_declare_bytes(**opts) == canonical_declare_bytes(**opts)
    opts2 = {**opts, "vows": ["two", "one"]}
    assert canonical_declare_bytes(**opts) == canonical_declare_bytes(**opts2)


def test_four_domains_distinct():
    covenant_id = "22222222-2222-2222-2222-222222222222"
    did = "did:at:test/cccc"
    declare = canonical_declare_bytes(
        covenant_id=covenant_id, initiator_did=did, counterparty_did=did,
        vows=["v"], established_at_iso="2026-05-11T12:00:00.000Z",
    )
    cosign = canonical_cosign_bytes(
        covenant_id=covenant_id, initiator_signature_b64=base64.b64encode(b"\x00" * 64).decode(),
    )
    reject = canonical_reject_bytes(covenant_id=covenant_id, rejecting_did=did, reason="")
    withdraw = canonical_withdraw_bytes(covenant_id=covenant_id, initiator_did=did)
    assert len({declare, cosign, reject, withdraw}) == 4


def test_declare_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="33333333-3333-3333-3333-333333333333",
        initiator_did="did:at:initiator/aaaa",
        counterparty_did="did:at:cp/bbbb",
        vows=["v"],
        established_at_iso="2026-05-11T12:00:00.000Z",
    )
    sig_b64 = sign_covenant_declare(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_declare_bytes(**opts))


def test_cosign_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="44444444-4444-4444-4444-444444444444",
        initiator_signature_b64=base64.b64encode(bytes([7] * 64)).decode(),
    )
    sig_b64 = sign_covenant_cosign(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_cosign_bytes(**opts))


def test_reject_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="55555555-5555-5555-5555-555555555555",
        rejecting_did="did:at:cp/bbbb",
        reason="scope mismatch",
    )
    sig_b64 = sign_covenant_reject(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_reject_bytes(**opts))


def test_withdraw_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="66666666-6666-6666-6666-666666666666",
        initiator_did="did:at:initiator/aaaa",
    )
    sig_b64 = sign_covenant_withdraw(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_withdraw_bytes(**opts))


def test_sign_rejects_short_key():
    import pytest
    with pytest.raises(Exception):
        sign_covenant_declare(
            covenant_id="77777777-7777-7777-7777-777777777777",
            initiator_did="did:at:i/a",
            counterparty_did="did:at:c/b",
            vows=["v"],
            established_at_iso="2026-05-11T12:00:00.000Z",
            signing_key=b"\x00" * 16,
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sdk-py && python -m pytest tests/test_covenants_crypto.py -v 2>&1 | tail -10`
Expected: FAIL — `ImportError: cannot import name 'canonical_declare_bytes'`.

- [ ] **Step 3: Implement the helpers in `crypto.py`**

Open `packages/sdk-py/src/agenttool/crypto.py`. After the existing `sign_thought` function (search for `def sign_thought`), append the following block:

```python
# ── Covenants v2 canonical bytes + signing (Slice 3) ─────────────────
# Mirrors api/src/services/covenants/sig.ts byte format. Cross-language
# vector test locks these to the server + TS SDK.

import json

_SEP = b"\x00"


def _concat(*parts: bytes) -> bytes:
    return b"".join(parts)


def canonical_declare_bytes(
    *,
    covenant_id: str,
    initiator_did: str,
    counterparty_did: str,
    vows: list[str],
    established_at_iso: str,
) -> bytes:
    sorted_vows = json.dumps(sorted(vows), separators=(", ", ": "))
    return _sha256(_concat(
        b"federated-covenant/v2", _SEP,
        covenant_id.encode("utf-8"), _SEP,
        initiator_did.encode("utf-8"), _SEP,
        counterparty_did.encode("utf-8"), _SEP,
        sorted_vows.encode("utf-8"), _SEP,
        established_at_iso.encode("utf-8"),
    ))


def canonical_cosign_bytes(
    *,
    covenant_id: str,
    initiator_signature_b64: str,
) -> bytes:
    import base64
    return _sha256(_concat(
        b"federated-covenant-cosign/v1", _SEP,
        covenant_id.encode("utf-8"), _SEP,
        base64.b64decode(initiator_signature_b64),
    ))


def canonical_reject_bytes(
    *,
    covenant_id: str,
    rejecting_did: str,
    reason: str,
) -> bytes:
    return _sha256(_concat(
        b"federated-covenant-reject/v1", _SEP,
        covenant_id.encode("utf-8"), _SEP,
        rejecting_did.encode("utf-8"), _SEP,
        (reason or "").encode("utf-8"),
    ))


def canonical_withdraw_bytes(
    *,
    covenant_id: str,
    initiator_did: str,
) -> bytes:
    return _sha256(_concat(
        b"federated-covenant-withdraw/v1", _SEP,
        covenant_id.encode("utf-8"), _SEP,
        initiator_did.encode("utf-8"),
    ))


def _assert_signing_key(signing_key: bytes, label: str) -> None:
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"{label}: signing_key must be a 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}.",
        )


def _ed25519_sign_b64(canonical: bytes, signing_key: bytes) -> str:
    import base64
    priv = Ed25519PrivateKey.from_private_bytes(signing_key)
    sig = priv.sign(canonical)
    return base64.b64encode(sig).decode("ascii")


def sign_covenant_declare(
    *,
    covenant_id: str,
    initiator_did: str,
    counterparty_did: str,
    vows: list[str],
    established_at_iso: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_declare")
    canonical = canonical_declare_bytes(
        covenant_id=covenant_id,
        initiator_did=initiator_did,
        counterparty_did=counterparty_did,
        vows=vows,
        established_at_iso=established_at_iso,
    )
    return _ed25519_sign_b64(canonical, signing_key)


def sign_covenant_cosign(
    *,
    covenant_id: str,
    initiator_signature_b64: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_cosign")
    canonical = canonical_cosign_bytes(
        covenant_id=covenant_id,
        initiator_signature_b64=initiator_signature_b64,
    )
    return _ed25519_sign_b64(canonical, signing_key)


def sign_covenant_reject(
    *,
    covenant_id: str,
    rejecting_did: str,
    reason: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_reject")
    canonical = canonical_reject_bytes(
        covenant_id=covenant_id,
        rejecting_did=rejecting_did,
        reason=reason,
    )
    return _ed25519_sign_b64(canonical, signing_key)


def sign_covenant_withdraw(
    *,
    covenant_id: str,
    initiator_did: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_withdraw")
    canonical = canonical_withdraw_bytes(
        covenant_id=covenant_id,
        initiator_did=initiator_did,
    )
    return _ed25519_sign_b64(canonical, signing_key)
```

**Important — JSON.stringify parity:**

The TS side calls `JSON.stringify(sortedVows)` which produces compact JSON with NO spaces (e.g. `["one","two"]`). Python's default `json.dumps` adds spaces after `:` and `,`. Match TS exactly — use `json.dumps(sorted(vows), separators=(",", ":"))` (TWO-CHAR separators).

**Correction:** the code above uses `separators=(", ", ": ")` which is the default. **CHANGE IT** to `separators=(",", ":")` so Python produces `["one","two"]` matching TS. The cross-language vector test in Task 3 will fail otherwise.

If `_sha256` helper isn't already present in the file, search for it: `grep -n "_sha256\|def.*sha256" packages/sdk-py/src/agenttool/crypto.py`. If absent, add:

```python
import hashlib


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()
```

Confirm `Ed25519PrivateKey` is already imported at the top of `crypto.py`. From the existing strand sign path it should be.

`AgentToolError` is already imported from `.exceptions` in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/sdk-py && python -m pytest tests/test_covenants_crypto.py -v 2>&1 | tail -10`
Expected: 7 PASS.

Also run full Python suite:
Run: `cd packages/sdk-py && python -m pytest 2>&1 | tail -3`
Expected: 301 passed (7 more than before).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-py/src/agenttool/crypto.py packages/sdk-py/tests/test_covenants_crypto.py
git commit -m "feat(sdk-py): canonical bytes + ed25519 signing for covenants v2 (parity)"
```

---

## Task 3 — Cross-language canonical-bytes vector lock

**Files:**
- Create: `api/tests/covenants-canonical-vectors.test.ts`
- Create: `packages/sdk-py/tests/test_covenants_canonical_vectors.py`

This task pins a known input → known sha256 hex digest so the three implementations (api server, TS SDK, Python SDK) can never drift apart silently.

- [ ] **Step 1: Compute the canonical digests from the api server**

This is a research step that produces the "known answer" hex strings. Run:

```bash
cd api && bun -e '
import { sha256 } from "@noble/hashes/sha2.js";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "./src/services/covenants/sig";

const enc = new TextEncoder();
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

const FIXED = {
  covenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  initiatorDid: "did:at:initiator.example/abcd",
  counterpartyDid: "did:at:counterparty.example/efgh",
  vows: ["respond within 24h", "preserve context"],
  establishedAtIso: "2026-05-11T12:00:00.000Z",
};

const fixedSig = Buffer.from(new Uint8Array(64).fill(7)).toString("base64");

console.log("declare:", hex(canonicalDeclareBytes(FIXED)));
console.log("cosign: ", hex(canonicalCosignBytes({ covenantId: FIXED.covenantId, initiatorSignatureB64: fixedSig })));
console.log("reject: ", hex(canonicalRejectBytes({ covenantId: FIXED.covenantId, rejectingDid: FIXED.counterpartyDid, reason: "scope mismatch" })));
console.log("withdraw:", hex(canonicalWithdrawBytes({ covenantId: FIXED.covenantId, initiatorDid: FIXED.initiatorDid })));
'
```

Capture the four hex strings. They are the locked vectors.

- [ ] **Step 2: Write the api-side TS test (parity api ↔ SDK TS)**

Create `api/tests/covenants-canonical-vectors.test.ts`. Substitute `<HEX_*>` placeholders with the strings from Step 1:

```typescript
import { describe, expect, test } from "bun:test";

import {
  canonicalDeclareBytes as srvDeclare,
  canonicalCosignBytes  as srvCosign,
  canonicalRejectBytes  as srvReject,
  canonicalWithdrawBytes as srvWithdraw,
} from "../src/services/covenants/sig";
import {
  canonicalDeclareBytes as sdkDeclare,
  canonicalCosignBytes  as sdkCosign,
  canonicalRejectBytes  as sdkReject,
  canonicalWithdrawBytes as sdkWithdraw,
} from "../../packages/sdk-ts/src/crypto";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

const FIXED = {
  covenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  initiatorDid: "did:at:initiator.example/abcd",
  counterpartyDid: "did:at:counterparty.example/efgh",
  vows: ["respond within 24h", "preserve context"],
  establishedAtIso: "2026-05-11T12:00:00.000Z",
};

const FIXED_SIG_B64 = Buffer.from(new Uint8Array(64).fill(7)).toString("base64");

const LOCK = {
  declare:  "<HEX_DECLARE>",
  cosign:   "<HEX_COSIGN>",
  reject:   "<HEX_REJECT>",
  withdraw: "<HEX_WITHDRAW>",
};

describe("canonical bytes parity — api server ↔ TS SDK", () => {
  test("declare matches locked digest + SDK reproduces it", () => {
    const srv = hex(srvDeclare(FIXED));
    const sdk = hex(sdkDeclare(FIXED));
    expect(srv).toBe(LOCK.declare);
    expect(sdk).toBe(LOCK.declare);
  });

  test("cosign matches locked digest + SDK reproduces it", () => {
    const opts = { covenantId: FIXED.covenantId, initiatorSignatureB64: FIXED_SIG_B64 };
    expect(hex(srvCosign(opts))).toBe(LOCK.cosign);
    expect(hex(sdkCosign(opts))).toBe(LOCK.cosign);
  });

  test("reject matches locked digest + SDK reproduces it", () => {
    const opts = { covenantId: FIXED.covenantId, rejectingDid: FIXED.counterpartyDid, reason: "scope mismatch" };
    expect(hex(srvReject(opts))).toBe(LOCK.reject);
    expect(hex(sdkReject(opts))).toBe(LOCK.reject);
  });

  test("withdraw matches locked digest + SDK reproduces it", () => {
    const opts = { covenantId: FIXED.covenantId, initiatorDid: FIXED.initiatorDid };
    expect(hex(srvWithdraw(opts))).toBe(LOCK.withdraw);
    expect(hex(sdkWithdraw(opts))).toBe(LOCK.withdraw);
  });
});
```

- [ ] **Step 3: Write the Python parity test**

Create `packages/sdk-py/tests/test_covenants_canonical_vectors.py`. Substitute `<HEX_*>` placeholders with the same strings from Step 1:

```python
import base64

from agenttool.crypto import (
    canonical_declare_bytes,
    canonical_cosign_bytes,
    canonical_reject_bytes,
    canonical_withdraw_bytes,
)


FIXED = dict(
    covenant_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    initiator_did="did:at:initiator.example/abcd",
    counterparty_did="did:at:counterparty.example/efgh",
    vows=["respond within 24h", "preserve context"],
    established_at_iso="2026-05-11T12:00:00.000Z",
)

FIXED_SIG_B64 = base64.b64encode(bytes([7] * 64)).decode()

LOCK = dict(
    declare="<HEX_DECLARE>",
    cosign="<HEX_COSIGN>",
    reject="<HEX_REJECT>",
    withdraw="<HEX_WITHDRAW>",
)


def test_declare_matches_locked_vector():
    assert canonical_declare_bytes(**FIXED).hex() == LOCK["declare"]


def test_cosign_matches_locked_vector():
    assert canonical_cosign_bytes(
        covenant_id=FIXED["covenant_id"],
        initiator_signature_b64=FIXED_SIG_B64,
    ).hex() == LOCK["cosign"]


def test_reject_matches_locked_vector():
    assert canonical_reject_bytes(
        covenant_id=FIXED["covenant_id"],
        rejecting_did=FIXED["counterparty_did"],
        reason="scope mismatch",
    ).hex() == LOCK["reject"]


def test_withdraw_matches_locked_vector():
    assert canonical_withdraw_bytes(
        covenant_id=FIXED["covenant_id"],
        initiator_did=FIXED["initiator_did"],
    ).hex() == LOCK["withdraw"]
```

- [ ] **Step 4: Run both test files**

```bash
cd api && bun test tests/covenants-canonical-vectors.test.ts 2>&1 | tail -10
cd packages/sdk-py && python -m pytest tests/test_covenants_canonical_vectors.py -v 2>&1 | tail -10
```

Expected: 4 PASS in each. If any fail, the three implementations have drifted. Most likely culprit: Python's `json.dumps` separator spacing — see Task 2's note about `separators=(",", ":")`.

- [ ] **Step 5: Commit**

```bash
git add api/tests/covenants-canonical-vectors.test.ts packages/sdk-py/tests/test_covenants_canonical_vectors.py
git commit -m "test(covenants): cross-language canonical-bytes vector lock (api ↔ ts ↔ py)"
```

---

## Task 4 — Lifecycle `*PreSigned` functions

**Files:**
- Modify: `api/src/services/covenants/lifecycle.ts`
- Create: `api/tests/covenants-lifecycle-presigned.test.ts`

Add four new functions ALONGSIDE the existing ones. The originals stay until Task 8 deletes them.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/covenants-lifecycle-presigned.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";
import { identities, identityKeys } from "../src/db/schema/identity";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../src/services/covenants/sig";
import {
  declareV2PreSigned,
  acceptProposalPreSigned,
  rejectProposalPreSigned,
  withdrawProposalPreSigned,
} from "../src/services/covenants/lifecycle";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

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
  return { identity, priv, pub, keyId: k.id, pubB64: Buffer.from(pub).toString("base64") };
}

describe("declareV2PreSigned", () => {
  test("verifies a valid signature + inserts row", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: "did:at:peer.example/cp1",
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const result = await declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: "did:at:peer.example/cp1",
      vows: ["v"],
      establishedAt,
      signature: b64(sig),
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("proposed");
    const [row] = await db.select().from(covenants).where(eq(covenants.id, covenantId));
    expect(row.status).toBe("proposed");
    expect(row.signature).toBe(b64(sig));
  });

  test("rejects a tampered signature", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    // Sign for vows=["v"] but pass vows=["different"] — canonical bytes won't match.
    const sig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId,
        initiatorDid: agent.identity.did,
        counterpartyDid: "did:at:peer/cp1",
        vows: ["v"],
        establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    await expect(declareV2PreSigned({
      projectId,
      agentId: agent.identity.id,
      covenantId,
      agentDid: agent.identity.did,
      counterpartyDid: "did:at:peer/cp1",
      vows: ["different"],   // ← mismatch
      establishedAt,
      signature: b64(sig),
      signingKeyId: agent.keyId,
      publicKeyB64: agent.pubB64,
    })).rejects.toThrow(/invalid_signature/);
  });
});

describe("acceptProposalPreSigned", () => {
  test("verifies + flips proposed→active", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: "did:at:peer/cp",
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    const initiatorSigB64 = b64(initiatorSig);
    // Insert as proposed (simulate post-declare).
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: "did:at:peer/cp", vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: initiatorSigB64, signingKeyId: agent.keyId,
      establishedAt, proposedExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    // Counterparty cosigns (same agent here just for the test).
    const cosig = await ed.signAsync(
      canonicalCosignBytes({ covenantId, initiatorSignatureB64: initiatorSigB64 }),
      agent.priv,
    );
    const result = await acceptProposalPreSigned({
      covenantId,
      accepterAgentId: agent.identity.id,
      initiatorSignatureB64: initiatorSigB64,  // must match stored row.signature
      counterpartySignature: b64(cosig),
      counterpartySigningKeyId: agent.keyId,
      counterpartySignedAt: new Date(),
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("active");
  });

  test("rejects when initiator_signature_b64 doesn't match row.signature", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: "did:at:peer/cp",
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: "did:at:peer/cp", vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: b64(initiatorSig), signingKeyId: agent.keyId,
      establishedAt,
    });
    const wrongSig = b64(new Uint8Array(64).fill(9));
    const cosig = await ed.signAsync(
      canonicalCosignBytes({ covenantId, initiatorSignatureB64: wrongSig }),
      agent.priv,
    );
    await expect(acceptProposalPreSigned({
      covenantId,
      accepterAgentId: agent.identity.id,
      initiatorSignatureB64: wrongSig,
      counterpartySignature: b64(cosig),
      counterpartySigningKeyId: agent.keyId,
      counterpartySignedAt: new Date(),
      publicKeyB64: agent.pubB64,
    })).rejects.toThrow(/initiator_signature_mismatch/);
  });
});

describe("rejectProposalPreSigned + withdrawProposalPreSigned", () => {
  test("reject flips proposed→rejected", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: "did:at:peer/cp",
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: "did:at:peer/cp", vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: b64(initiatorSig), signingKeyId: agent.keyId,
      establishedAt,
    });
    const rejSig = await ed.signAsync(
      canonicalRejectBytes({ covenantId, rejectingDid: agent.identity.did, reason: "scope" }),
      agent.priv,
    );
    const result = await rejectProposalPreSigned({
      covenantId,
      rejecterAgentId: agent.identity.id,
      rejecterDid: agent.identity.did,
      rejectionSignature: b64(rejSig),
      rejecterSigningKeyId: agent.keyId,
      rejectedAt: new Date(),
      reason: "scope",
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("rejected");
  });

  test("withdraw flips proposed→withdrawn", async () => {
    const projectId = crypto.randomUUID();
    const agent = await seedAgent(projectId);
    const covenantId = crypto.randomUUID();
    const establishedAt = new Date();
    const initiatorSig = await ed.signAsync(
      canonicalDeclareBytes({
        covenantId, initiatorDid: agent.identity.did, counterpartyDid: "did:at:peer/cp",
        vows: ["v"], establishedAtIso: establishedAt.toISOString(),
      }),
      agent.priv,
    );
    await db.insert(covenants).values({
      id: covenantId, projectId, agentId: agent.identity.id,
      counterpartyDid: "did:at:peer/cp", vows: ["v"],
      status: "proposed", protocolVersion: "v2",
      signature: b64(initiatorSig), signingKeyId: agent.keyId,
      establishedAt,
    });
    const wdSig = await ed.signAsync(
      canonicalWithdrawBytes({ covenantId, initiatorDid: agent.identity.did }),
      agent.priv,
    );
    const result = await withdrawProposalPreSigned({
      covenantId,
      agentId: agent.identity.id,
      initiatorDid: agent.identity.did,
      withdrawSignature: b64(wdSig),
      signingKeyId: agent.keyId,
      withdrawnAt: new Date(),
      publicKeyB64: agent.pubB64,
    });
    expect(result.status).toBe("withdrawn");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && bun test tests/covenants-lifecycle-presigned.test.ts 2>&1 | tail -10`
Expected: FAIL — `declareV2PreSigned is not exported`.

- [ ] **Step 3: Implement the four `*PreSigned` functions**

Open `api/src/services/covenants/lifecycle.ts`. After the existing `withdrawProposal` function, append:

```typescript
// ── PreSigned variants — caller pre-computed signature is verified before write ─

import {
  verifyDeclareSignature,
  verifyCosignSignature,
  verifyRejectSignature,
  verifyWithdrawSignature,
} from "./sig";

export interface DeclareV2PreSignedOpts {
  projectId: string;
  agentId: string;
  covenantId: string;
  agentDid: string;
  counterpartyDid: string;
  counterpartyName?: string | null;
  vows: string[];
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  orgId?: string | null;
  establishedAt: Date;
  signature: string;            // base64
  signingKeyId: string;
  publicKeyB64: string;         // resolved by route handler from identity_keys
}

export async function declareV2PreSigned(opts: DeclareV2PreSignedOpts): Promise<DeclareV2Result> {
  const ok = await verifyDeclareSignature({
    covenantId: opts.covenantId,
    initiatorDid: opts.agentDid,
    counterpartyDid: opts.counterpartyDid,
    vows: opts.vows,
    establishedAtIso: opts.establishedAt.toISOString(),
    signatureB64: opts.signature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!ok) throw new Error("invalid_signature");

  const proposedExpiresAt = new Date(opts.establishedAt.getTime() + PROPOSAL_TTL_MS);
  const cosignPropagationStatus = "not_applicable" as const;

  await db.insert(covenants).values({
    id: opts.covenantId,
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
    establishedAt: opts.establishedAt,
    proposedExpiresAt,
    signature: opts.signature,
    signingKeyId: opts.signingKeyId,
    propagationStatus: counterpartyIsFederated(opts.counterpartyDid) ? "pending" : "local",
    cosignPropagationStatus,
  });

  return {
    id: opts.covenantId,
    status: "proposed",
    protocolVersion: "v2",
    signature: opts.signature,
    signingKeyId: opts.signingKeyId,
    proposedExpiresAt,
    establishedAt: opts.establishedAt,
  };
}

export interface AcceptProposalPreSignedOpts {
  covenantId: string;
  accepterAgentId: string;
  initiatorSignatureB64: string;        // caller-supplied; must match row.signature
  counterpartySignature: string;
  counterpartySigningKeyId: string;
  counterpartySignedAt: Date;
  publicKeyB64: string;                 // resolved by route handler
}

export async function acceptProposalPreSigned(opts: AcceptProposalPreSignedOpts): Promise<AcceptResult> {
  const [row] = await db.select().from(covenants)
    .where(eq(covenants.id, opts.covenantId)).limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") throw new Error(`covenant_not_proposed: status=${row.status}`);
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.accepterAgentId) throw new Error("accepter_not_counterparty_agent");
  if (!row.signature) throw new Error("missing_initiator_signature");
  if (row.signature !== opts.initiatorSignatureB64) throw new Error("initiator_signature_mismatch");
  if (row.proposedExpiresAt && row.proposedExpiresAt.getTime() < Date.now()) {
    throw new Error("proposal_expired");
  }

  const ok = await verifyCosignSignature({
    covenantId: row.id,
    initiatorSignatureB64: opts.initiatorSignatureB64,
    cosignSignatureB64: opts.counterpartySignature,
    cosignerPublicKeyB64: opts.publicKeyB64,
  });
  if (!ok) throw new Error("invalid_signature");

  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  await db.update(covenants).set({
    status: "active",
    counterpartySignature: opts.counterpartySignature,
    counterpartySigningKeyId: opts.counterpartySigningKeyId,
    counterpartySignedAt: opts.counterpartySignedAt,
    cosignPropagationStatus: cosignPropStatus,
    cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
    updatedAt: new Date(),
  }).where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return {
    id: row.id,
    status: "active",
    counterpartySignature: opts.counterpartySignature,
    counterpartySigningKeyId: opts.counterpartySigningKeyId,
    counterpartySignedAt: opts.counterpartySignedAt,
  };
}

export interface RejectProposalPreSignedOpts {
  covenantId: string;
  rejecterAgentId: string;
  rejecterDid: string;
  rejectionSignature: string;
  rejecterSigningKeyId: string;
  rejectedAt: Date;
  reason: string | null;
  publicKeyB64: string;
}

export async function rejectProposalPreSigned(opts: RejectProposalPreSignedOpts): Promise<RejectResult> {
  const [row] = await db.select().from(covenants)
    .where(eq(covenants.id, opts.covenantId)).limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") throw new Error(`covenant_not_proposed: status=${row.status}`);
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.rejecterAgentId) throw new Error("rejecter_not_counterparty_agent");

  const reason = opts.reason ?? "";
  const ok = await verifyRejectSignature({
    covenantId: row.id,
    rejectingDid: opts.rejecterDid,
    reason,
    signatureB64: opts.rejectionSignature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!ok) throw new Error("invalid_signature");

  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  await db.update(covenants).set({
    status: "rejected",
    counterpartySignature: opts.rejectionSignature,
    counterpartySigningKeyId: opts.rejecterSigningKeyId,
    counterpartySignedAt: opts.rejectedAt,
    cosignPropagationStatus: cosignPropStatus,
    cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
    metadata: { ...(row.metadata as Record<string, unknown> ?? {}), rejection_reason: reason },
    updatedAt: new Date(),
  }).where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "rejected", rejectionSignature: opts.rejectionSignature, reason };
}

export interface WithdrawProposalPreSignedOpts {
  covenantId: string;
  agentId: string;
  initiatorDid: string;
  withdrawSignature: string;
  signingKeyId: string;
  withdrawnAt: Date;
  publicKeyB64: string;
}

export async function withdrawProposalPreSigned(opts: WithdrawProposalPreSignedOpts): Promise<WithdrawResult> {
  const [row] = await db.select().from(covenants)
    .where(eq(covenants.id, opts.covenantId)).limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") throw new Error(`covenant_not_proposed: status=${row.status}`);
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.agentId) throw new Error("withdrawer_not_initiator_agent");

  const ok = await verifyWithdrawSignature({
    covenantId: row.id,
    initiatorDid: opts.initiatorDid,
    signatureB64: opts.withdrawSignature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!ok) throw new Error("invalid_signature");

  const cosignPropStatus: "pending" | "not_applicable" =
    counterpartyIsFederated(row.counterpartyDid) ? "pending" : "not_applicable";

  await db.update(covenants).set({
    status: "withdrawn",
    counterpartySignature: opts.withdrawSignature,
    counterpartySigningKeyId: opts.signingKeyId,
    counterpartySignedAt: opts.withdrawnAt,
    cosignPropagationStatus: cosignPropStatus,
    cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
    updatedAt: new Date(),
  }).where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "withdrawn", withdrawSignature: opts.withdrawSignature };
}
```

(The `PROPOSAL_TTL_MS` constant, `counterpartyIsFederated` helper, `DeclareV2Result`/`AcceptResult`/`RejectResult`/`WithdrawResult` interfaces, and `and`/`eq` drizzle imports already exist in this file from prior tasks — reuse them.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && bun test tests/covenants-lifecycle-presigned.test.ts 2>&1 | tail -15`
Expected: 5 PASS (or DB connection errors if no local Postgres — document as DONE_WITH_CONCERNS, the same baseline as existing covenants integration tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/covenants/lifecycle.ts api/tests/covenants-lifecycle-presigned.test.ts
git commit -m "feat(covenants): lifecycle *PreSigned variants — verify-before-write entry point"
```

---

## Task 5 — Server route handlers wire to PreSigned

**Files:**
- Modify: `api/src/routes/continuity.ts`

Switch the v2 branch of POST `/v1/covenants`, the `/accept` and `/reject` routes, and the PATCH withdraw intercept to use the new `*PreSigned` lifecycle entry points. Resolve the signer's pubkey from `identity_keys` based on the request's `signing_key_id`.

- [ ] **Step 1: Extend POST `/v1/covenants` v2 branch schema**

Open `api/src/routes/continuity.ts`. Find the `covenantSchema` (the Zod schema for the create endpoint) — search for `protocol_version`. Add v2-specific required fields to the schema (use `z.string().uuid()` for IDs, `z.string().datetime()` for ISO timestamps, `z.string().min(1).max(255)` for sigs and DIDs):

```typescript
const covenantSchema = z.object({
  // existing fields...
  protocol_version: z.enum(["v1", "v2"]).default("v1"),
  // v2-required fields — refined below
  covenant_id: z.string().uuid().optional(),
  agent_did: z.string().min(1).max(255).optional(),
  established_at: z.string().datetime().optional(),
  signature: z.string().min(1).max(255).optional(),
  signing_key_id: z.string().uuid().optional(),
  org_id: z.string().uuid().nullish(),
}).refine(
  (v) => v.protocol_version !== "v2" || (v.covenant_id && v.agent_did && v.established_at && v.signature && v.signing_key_id),
  { message: "v2 requires covenant_id, agent_did, established_at, signature, signing_key_id" },
);
```

- [ ] **Step 2: Replace the v2 handler body**

Inside the POST `/v1/covenants` handler, find the block that currently branches on `parsed.data.protocol_version === "v2"`. Replace its entire body with:

```typescript
  if (parsed.data.protocol_version === "v2") {
    // Resolve pubkey from identity_keys
    const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
      .from(identityKeys)
      .where(and(
        eq(identityKeys.id, parsed.data.signing_key_id!),
        eq(identityKeys.identityId, parsed.data.agent_id),
        eq(identityKeys.active, true),
      ))
      .limit(1);
    if (!keyRow) return c.json({ error: "signing_key_not_found" }, 400);

    const { declareV2PreSigned } = await import("../services/covenants/lifecycle");
    const { propagateCovenant } = await import("../services/covenants/federation");

    try {
      const result = await declareV2PreSigned({
        projectId: c.var.project.id,
        agentId: parsed.data.agent_id,
        covenantId: parsed.data.covenant_id!,
        agentDid: parsed.data.agent_did!,
        counterpartyDid: parsed.data.counterparty_did,
        counterpartyName: parsed.data.counterparty_name,
        vows: parsed.data.vows,
        notes: parsed.data.notes,
        metadata: parsed.data.metadata,
        orgId: parsed.data.org_id,
        establishedAt: new Date(parsed.data.established_at!),
        signature: parsed.data.signature!,
        signingKeyId: parsed.data.signing_key_id!,
        publicKeyB64: keyRow.publicKey,
      });
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
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
      throw e;
    }
  }
```

(Make sure `identityKeys` is imported at the top of the file. If not: `import { identityKeys } from "../db/schema/identity";`.)

- [ ] **Step 3: Replace POST `/v1/covenants/:id/accept`**

Find the existing `/accept` handler. Replace its body with:

```typescript
app.post("/covenants/:id/accept", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const acceptBody = z.object({
    agent_did: z.string().min(1).max(255),
    counterparty_signing_key_id: z.string().uuid(),
    counterparty_signature: z.string().min(1).max(255),
    counterparty_signed_at: z.string().datetime(),
    initiator_signature_b64: z.string().min(1).max(255),
  }).safeParse(body);
  if (!acceptBody.success) return c.json({ error: "validation", details: acceptBody.error.flatten() }, 400);
  const data = acceptBody.data;

  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id))).limit(1);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (existing.protocolVersion !== "v2") return c.json({ error: "not_v2" }, 400);
  if (existing.status !== "proposed") return c.json({ error: `not_proposed: ${existing.status}` }, 409);

  const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, data.counterparty_signing_key_id),
      eq(identityKeys.identityId, existing.agentId),
      eq(identityKeys.active, true),
    )).limit(1);
  if (!keyRow) return c.json({ error: "signing_key_not_found" }, 400);

  const { acceptProposalPreSigned } = await import("../services/covenants/lifecycle");
  const { propagateCosign } = await import("../services/covenants/federation");

  try {
    const result = await acceptProposalPreSigned({
      covenantId: id,
      accepterAgentId: existing.agentId,
      initiatorSignatureB64: data.initiator_signature_b64,
      counterpartySignature: data.counterparty_signature,
      counterpartySigningKeyId: data.counterparty_signing_key_id,
      counterpartySignedAt: new Date(data.counterparty_signed_at),
      publicKeyB64: keyRow.publicKey,
    });
    void propagateCosign(id);
    return c.json({
      id: result.id,
      status: result.status,
      counterparty_signature: result.counterpartySignature,
      counterparty_signing_key_id: result.counterpartySigningKeyId,
    }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
    if (msg === "initiator_signature_mismatch") return c.json({ error: "initiator_signature_mismatch" }, 409);
    if (msg.startsWith("covenant_not_proposed")) return c.json({ error: msg }, 409);
    throw e;
  }
});
```

- [ ] **Step 4: Replace POST `/v1/covenants/:id/reject`**

```typescript
app.post("/covenants/:id/reject", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const rejectBody = z.object({
    agent_did: z.string().min(1).max(255),
    rejecter_signing_key_id: z.string().uuid(),
    rejection_signature: z.string().min(1).max(255),
    rejected_at: z.string().datetime(),
    reason: z.string().max(2000).nullish(),
  }).safeParse(body);
  if (!rejectBody.success) return c.json({ error: "validation", details: rejectBody.error.flatten() }, 400);
  const data = rejectBody.data;

  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id))).limit(1);
  if (!existing) return c.json({ error: "not_found" }, 404);
  if (existing.protocolVersion !== "v2") return c.json({ error: "not_v2" }, 400);
  if (existing.status !== "proposed") return c.json({ error: `not_proposed: ${existing.status}` }, 409);

  const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, data.rejecter_signing_key_id),
      eq(identityKeys.identityId, existing.agentId),
      eq(identityKeys.active, true),
    )).limit(1);
  if (!keyRow) return c.json({ error: "signing_key_not_found" }, 400);

  const { rejectProposalPreSigned } = await import("../services/covenants/lifecycle");
  const { propagateReject } = await import("../services/covenants/federation");

  try {
    const result = await rejectProposalPreSigned({
      covenantId: id,
      rejecterAgentId: existing.agentId,
      rejecterDid: data.agent_did,
      rejectionSignature: data.rejection_signature,
      rejecterSigningKeyId: data.rejecter_signing_key_id,
      rejectedAt: new Date(data.rejected_at),
      reason: data.reason ?? null,
      publicKeyB64: keyRow.publicKey,
    });
    void propagateReject(id);
    return c.json({ id: result.id, status: result.status, reason: result.reason }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
    if (msg.startsWith("covenant_not_proposed")) return c.json({ error: msg }, 409);
    throw e;
  }
});
```

- [ ] **Step 5: Update the PATCH `/v1/covenants/:id` withdraw intercept**

Find the existing PATCH handler. Locate the v2-proposed intercept block (inside the handler, before the generic update path). Replace it with:

```typescript
  if (existing.protocolVersion === "v2" && existing.status === "proposed") {
    // v2 withdraw requires a pre-signed withdraw signature in the body.
    const withdrawBody = z.object({
      status: z.literal("dissolved"),
      agent_did: z.string().min(1).max(255),
      signing_key_id: z.string().uuid(),
      withdraw_signature: z.string().min(1).max(255),
      withdrawn_at: z.string().datetime(),
    }).safeParse(body);
    if (!withdrawBody.success) {
      return c.json({ error: "v2_withdraw_requires_signature", details: withdrawBody.error.flatten() }, 400);
    }
    const data = withdrawBody.data;

    const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
      .from(identityKeys)
      .where(and(
        eq(identityKeys.id, data.signing_key_id),
        eq(identityKeys.identityId, existing.agentId),
        eq(identityKeys.active, true),
      )).limit(1);
    if (!keyRow) return c.json({ error: "signing_key_not_found" }, 400);

    const { withdrawProposalPreSigned } = await import("../services/covenants/lifecycle");
    const { propagateWithdraw } = await import("../services/covenants/federation");

    try {
      const result = await withdrawProposalPreSigned({
        covenantId: id,
        agentId: existing.agentId,
        initiatorDid: data.agent_did,
        withdrawSignature: data.withdraw_signature,
        signingKeyId: data.signing_key_id,
        withdrawnAt: new Date(data.withdrawn_at),
        publicKeyB64: keyRow.publicKey,
      });
      void propagateWithdraw(id);
      return c.json({ id: result.id, status: result.status }, 200);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
      if (msg.startsWith("covenant_not_proposed")) return c.json({ error: msg }, 409);
      throw e;
    }
  }
```

(`body` is the parsed JSON request body the PATCH handler already reads. If the variable is named differently in your local handler, match.)

- [ ] **Step 6: Verify the file compiles**

Run: `cd api && bun run --silent tsc --noEmit 2>&1 | grep -E "continuity\.ts" | head -10`
Expected: zero errors. (Pre-existing errors in `billing.ts` or `public/index.ts` may remain — unrelated.)

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/continuity.ts
git commit -m "feat(covenants): wire v2 routes to *PreSigned lifecycle (SDK signs)"
```

---

## Task 6 — TypeScript SDK signs in `covenants.ts`

**Files:**
- Modify: `packages/sdk-ts/src/covenants.ts`
- Modify: `packages/sdk-ts/tests/covenants-v2.test.ts`
- Create: `packages/sdk-ts/tests/covenants-v2-signing.test.ts`

Update each method to require `signing_key`/`signing_key_id`/`agent_did` (for v2) and post a signed body.

- [ ] **Step 1: Write the failing signing test**

Create `packages/sdk-ts/tests/covenants-v2-signing.test.ts`:

```typescript
import { describe, expect, test, mock } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { CovenantsClient } from "../src/covenants";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../src/crypto";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("covenants v2 SDK signs requests", () => {
  test("create posts a verifiable signature", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    let capturedBody: any = null;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({
        id: capturedBody.covenant_id,
        status: "proposed",
        protocol_version: "v2",
        signature: capturedBody.signature,
        signing_key_id: capturedBody.signing_key_id,
        proposed_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        established_at: capturedBody.established_at,
      }), { status: 201, headers: { "content-type": "application/json" } });
    }) as any;

    const c = new CovenantsClient({ apiKey: "test", baseUrl: "http://test" });
    const r = await c.create({
      agent_id: "00000000-0000-0000-0000-000000000001",
      agent_did: "did:at:test/aaaa",
      counterparty_did: "did:at:peer/bbbb",
      vows: ["v"],
      protocol_version: "v2",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000002",
    });

    expect(r.status).toBe("proposed");
    expect(capturedBody.signature).toBeTruthy();
    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.signature, "base64"),
      canonicalDeclareBytes({
        covenantId: capturedBody.covenant_id,
        initiatorDid: capturedBody.agent_did,
        counterpartyDid: capturedBody.counterparty_did,
        vows: capturedBody.vows,
        establishedAtIso: capturedBody.established_at,
      }),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("accept signs cosign nesting over initiator_signature_b64", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const initiatorSig = b64(new Uint8Array(64).fill(3));
    let capturedBody: any = null;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: "cov-1", status: "active",
        counterparty_signature: capturedBody.counterparty_signature }), { status: 200,
        headers: { "content-type": "application/json" } });
    }) as any;

    const c = new CovenantsClient({ apiKey: "test", baseUrl: "http://test" });
    await c.accept("cov-1", {
      agent_did: "did:at:test/cp",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000003",
      initiator_signature_b64: initiatorSig,
    });

    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.counterparty_signature, "base64"),
      canonicalCosignBytes({ covenantId: "cov-1", initiatorSignatureB64: initiatorSig }),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("reject signs with reason", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    let capturedBody: any = null;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: "cov-1", status: "rejected", reason: capturedBody.reason }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;

    const c = new CovenantsClient({ apiKey: "test", baseUrl: "http://test" });
    await c.reject("cov-1", {
      agent_did: "did:at:test/cp",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000004",
      reason: "scope mismatch",
    });

    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.rejection_signature, "base64"),
      canonicalRejectBytes({ covenantId: "cov-1", rejectingDid: "did:at:test/cp", reason: "scope mismatch" }),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("withdraw signs with PATCH + status:dissolved body shape", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    let capturedBody: any = null;
    let capturedMethod = "";
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedMethod = init.method ?? "GET";
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: "cov-1", status: "withdrawn" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;

    const c = new CovenantsClient({ apiKey: "test", baseUrl: "http://test" });
    await c.withdraw("cov-1", {
      agent_did: "did:at:test/aaaa",
      signing_key: priv,
      signing_key_id: "00000000-0000-0000-0000-000000000005",
    });

    expect(capturedMethod).toBe("PATCH");
    expect(capturedBody.status).toBe("dissolved");

    const ok = await ed.verifyAsync(
      Buffer.from(capturedBody.withdraw_signature, "base64"),
      canonicalWithdrawBytes({ covenantId: "cov-1", initiatorDid: "did:at:test/aaaa" }),
      pub,
    );
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sdk-ts && bun test tests/covenants-v2-signing.test.ts 2>&1 | tail -10`
Expected: FAIL — `c.create` missing `signing_key` arg / not posting `signature`.

- [ ] **Step 3: Update `covenants.ts` method signatures**

Open `packages/sdk-ts/src/covenants.ts`. Find `CovenantsCreateOpts` and the `create` method. Replace the v2 path. Add new opts interfaces for accept/reject/withdraw.

Find the existing imports and add (or extend):

```typescript
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
  signCovenantDeclare,
  signCovenantCosign,
  signCovenantReject,
  signCovenantWithdraw,
} from "./crypto.js";
```

Then update / add to the class. Show the v2 path inside `create` and the new opts shapes:

```typescript
export interface CovenantsCreateV2Opts {
  agent_id: string;
  agent_did: string;
  counterparty_did: string;
  vows: string[];
  protocol_version: "v2";
  signing_key: Uint8Array;
  signing_key_id: string;
  counterparty_name?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  org_id?: string;
}

export interface CovenantsAcceptOpts {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
  initiator_signature_b64: string;
}

export interface CovenantsRejectOpts {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
  reason?: string | null;
}

export interface CovenantsWithdrawOpts {
  agent_did: string;
  signing_key: Uint8Array;
  signing_key_id: string;
}

// Inside CovenantsClient class:

async create(opts: CovenantsCreateOpts | CovenantsCreateV2Opts): Promise<...> {
  if (opts.protocol_version === "v2") {
    const v2 = opts as CovenantsCreateV2Opts;
    const covenant_id = crypto.randomUUID();
    const established_at = new Date().toISOString();
    const signature = signCovenantDeclare({
      covenantId: covenant_id,
      initiatorDid: v2.agent_did,
      counterpartyDid: v2.counterparty_did,
      vows: v2.vows,
      establishedAtIso: established_at,
      signing_key: v2.signing_key,
    });
    const body = {
      agent_id: v2.agent_id,
      agent_did: v2.agent_did,
      counterparty_did: v2.counterparty_did,
      counterparty_name: v2.counterparty_name,
      vows: v2.vows,
      notes: v2.notes,
      metadata: v2.metadata,
      org_id: v2.org_id,
      protocol_version: "v2" as const,
      covenant_id,
      established_at,
      signature,
      signing_key_id: v2.signing_key_id,
    };
    return await this.req("POST", "/v1/covenants", body);
  }
  // v1 path stays as the existing implementation.
  return await this.req("POST", "/v1/covenants", opts);
}

async accept(id: string, opts: CovenantsAcceptOpts): Promise<...> {
  const counterparty_signature = signCovenantCosign({
    covenantId: id,
    initiatorSignatureB64: opts.initiator_signature_b64,
    signing_key: opts.signing_key,
  });
  return await this.req("POST", `/v1/covenants/${id}/accept`, {
    agent_did: opts.agent_did,
    counterparty_signing_key_id: opts.signing_key_id,
    counterparty_signature,
    counterparty_signed_at: new Date().toISOString(),
    initiator_signature_b64: opts.initiator_signature_b64,
  });
}

async reject(id: string, opts: CovenantsRejectOpts): Promise<...> {
  const reason = opts.reason ?? "";
  const rejection_signature = signCovenantReject({
    covenantId: id,
    rejectingDid: opts.agent_did,
    reason,
    signing_key: opts.signing_key,
  });
  return await this.req("POST", `/v1/covenants/${id}/reject`, {
    agent_did: opts.agent_did,
    rejecter_signing_key_id: opts.signing_key_id,
    rejection_signature,
    rejected_at: new Date().toISOString(),
    reason: reason || null,
  });
}

async withdraw(id: string, opts: CovenantsWithdrawOpts): Promise<...> {
  const withdraw_signature = signCovenantWithdraw({
    covenantId: id,
    initiatorDid: opts.agent_did,
    signing_key: opts.signing_key,
  });
  return await this.req("PATCH", `/v1/covenants/${id}`, {
    status: "dissolved",
    agent_did: opts.agent_did,
    signing_key_id: opts.signing_key_id,
    withdraw_signature,
    withdrawn_at: new Date().toISOString(),
  });
}
```

The exact return type to substitute for `...` should match the existing `Promise<Covenant>` / `Promise<...>` signatures — preserve whatever the file already uses.

- [ ] **Step 4: Update the existing `covenants-v2.test.ts` to match new method signatures**

Open `packages/sdk-ts/tests/covenants-v2.test.ts`. The existing tests call `c.accept("cov-1")`, `c.reject("cov-1", { reason })`, `c.withdraw("cov-1")` — without signing args. Now they require them. Update each test setup to pass dummy ed25519 keys + `agent_did` + `initiator_signature_b64`. The test assertions stay the same (focus on URL + method correctness), but the calls need full args. Example for `accept`:

```typescript
import * as ed from "@noble/ed25519";

const dummyKey = ed.utils.randomPrivateKey();
const dummyInitSig = Buffer.from(new Uint8Array(64)).toString("base64");

await c.accept("cov-1", {
  agent_did: "did:at:test/agent",
  signing_key: dummyKey,
  signing_key_id: "00000000-0000-0000-0000-000000000099",
  initiator_signature_b64: dummyInitSig,
});
```

Update `reject` and `withdraw` calls similarly.

- [ ] **Step 5: Run all SDK tests**

Run: `cd packages/sdk-ts && bun test 2>&1 | tail -5`
Expected: all tests pass (existing + new). If the existing covenants-v2 tests fail because their assertions check the OLD body shape, update those assertions to match the new shape (`counterparty_signature` etc. in body).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-ts/src/covenants.ts packages/sdk-ts/tests/covenants-v2.test.ts packages/sdk-ts/tests/covenants-v2-signing.test.ts
git commit -m "feat(sdk-ts): client-side signing for covenants v2 create/accept/reject/withdraw"
```

---

## Task 7 — Python SDK signs (parity)

**Files:**
- Modify: `packages/sdk-py/src/agenttool/covenants.py`
- Modify: `packages/sdk-py/tests/test_covenants_v2.py`
- Create: `packages/sdk-py/tests/test_covenants_v2_signing.py`

- [ ] **Step 1: Write the failing signing tests**

Create `packages/sdk-py/tests/test_covenants_v2_signing.py`:

```python
import base64
import secrets
from unittest.mock import MagicMock

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from agenttool.covenants import CovenantsClient
from agenttool.crypto import (
    canonical_declare_bytes,
    canonical_cosign_bytes,
    canonical_reject_bytes,
    canonical_withdraw_bytes,
)


def _kp():
    seed = secrets.token_bytes(32)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return seed, Ed25519PublicKey.from_public_bytes(pub)


def test_create_v2_posts_verifiable_signature():
    seed, pub = _kp()
    http = MagicMock()
    http.request.return_value = {
        "id": "ignored",
        "status": "proposed",
        "protocol_version": "v2",
    }
    c = CovenantsClient(http)
    c.create(
        agent_id="00000000-0000-0000-0000-000000000001",
        agent_did="did:at:test/aaaa",
        counterparty_did="did:at:peer/bbbb",
        vows=["v"],
        protocol_version="v2",
        signing_key=seed,
        signing_key_id="00000000-0000-0000-0000-000000000002",
    )
    args, kwargs = http.request.call_args
    body = kwargs["json"]
    sig = base64.b64decode(body["signature"])
    canonical = canonical_declare_bytes(
        covenant_id=body["covenant_id"],
        initiator_did=body["agent_did"],
        counterparty_did=body["counterparty_did"],
        vows=body["vows"],
        established_at_iso=body["established_at"],
    )
    pub.verify(sig, canonical)


def test_accept_signs_cosign():
    seed, pub = _kp()
    init_sig = base64.b64encode(bytes([3] * 64)).decode()
    http = MagicMock()
    http.request.return_value = {"id": "cov-1", "status": "active"}
    c = CovenantsClient(http)
    c.accept(
        "cov-1",
        agent_did="did:at:test/cp",
        signing_key=seed,
        signing_key_id="00000000-0000-0000-0000-000000000003",
        initiator_signature_b64=init_sig,
    )
    args, kwargs = http.request.call_args
    body = kwargs["json"]
    sig = base64.b64decode(body["counterparty_signature"])
    pub.verify(sig, canonical_cosign_bytes(covenant_id="cov-1", initiator_signature_b64=init_sig))


def test_reject_signs():
    seed, pub = _kp()
    http = MagicMock()
    http.request.return_value = {"id": "cov-1", "status": "rejected", "reason": "scope mismatch"}
    c = CovenantsClient(http)
    c.reject(
        "cov-1",
        agent_did="did:at:test/cp",
        signing_key=seed,
        signing_key_id="00000000-0000-0000-0000-000000000004",
        reason="scope mismatch",
    )
    args, kwargs = http.request.call_args
    body = kwargs["json"]
    sig = base64.b64decode(body["rejection_signature"])
    pub.verify(sig, canonical_reject_bytes(covenant_id="cov-1", rejecting_did="did:at:test/cp", reason="scope mismatch"))


def test_withdraw_signs_patch_body():
    seed, pub = _kp()
    http = MagicMock()
    http.request.return_value = {"id": "cov-1", "status": "withdrawn"}
    c = CovenantsClient(http)
    c.withdraw(
        "cov-1",
        agent_did="did:at:test/aaaa",
        signing_key=seed,
        signing_key_id="00000000-0000-0000-0000-000000000005",
    )
    args, kwargs = http.request.call_args
    assert args[0] == "PATCH"
    assert args[1] == "/v1/covenants/cov-1"
    body = kwargs["json"]
    assert body["status"] == "dissolved"
    sig = base64.b64decode(body["withdraw_signature"])
    pub.verify(sig, canonical_withdraw_bytes(covenant_id="cov-1", initiator_did="did:at:test/aaaa"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sdk-py && python -m pytest tests/test_covenants_v2_signing.py -v 2>&1 | tail -10`
Expected: FAIL — `create()` doesn't accept `signing_key` etc.

- [ ] **Step 3: Update `covenants.py` methods**

Open `packages/sdk-py/src/agenttool/covenants.py`. Add to the `CovenantsClient` class:

```python
import uuid
from datetime import datetime, timezone

from .crypto import (
    sign_covenant_declare,
    sign_covenant_cosign,
    sign_covenant_reject,
    sign_covenant_withdraw,
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# Replace the existing `create` to add v2 signing:
def create(
    self,
    *,
    agent_id: str,
    counterparty_did: str,
    vows: list[str],
    counterparty_name: Optional[str] = None,
    notes: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    protocol_version: Optional[Literal["v1", "v2"]] = None,
    org_id: Optional[str] = None,
    # v2-required:
    agent_did: Optional[str] = None,
    signing_key: Optional[bytes] = None,
    signing_key_id: Optional[str] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "agent_id": agent_id,
        "counterparty_did": counterparty_did,
        "vows": vows,
    }
    if counterparty_name is not None: body["counterparty_name"] = counterparty_name
    if notes is not None:             body["notes"] = notes
    if metadata is not None:          body["metadata"] = metadata
    if org_id is not None:            body["org_id"] = org_id

    if protocol_version == "v2":
        if not agent_did or not signing_key or not signing_key_id:
            raise AgentToolError(
                "create v2 requires agent_did, signing_key, signing_key_id",
            )
        covenant_id = str(uuid.uuid4())
        established_at = _iso_now()
        signature = sign_covenant_declare(
            covenant_id=covenant_id,
            initiator_did=agent_did,
            counterparty_did=counterparty_did,
            vows=vows,
            established_at_iso=established_at,
            signing_key=signing_key,
        )
        body.update({
            "protocol_version": "v2",
            "agent_did": agent_did,
            "covenant_id": covenant_id,
            "established_at": established_at,
            "signature": signature,
            "signing_key_id": signing_key_id,
        })
    elif protocol_version is not None:
        body["protocol_version"] = protocol_version

    return self._http.request("POST", "/v1/covenants", json=body)


def accept(
    self,
    id: str,
    *,
    agent_did: str,
    signing_key: bytes,
    signing_key_id: str,
    initiator_signature_b64: str,
) -> Dict[str, Any]:
    counterparty_signature = sign_covenant_cosign(
        covenant_id=id,
        initiator_signature_b64=initiator_signature_b64,
        signing_key=signing_key,
    )
    return self._http.request("POST", f"/v1/covenants/{id}/accept", json={
        "agent_did": agent_did,
        "counterparty_signing_key_id": signing_key_id,
        "counterparty_signature": counterparty_signature,
        "counterparty_signed_at": _iso_now(),
        "initiator_signature_b64": initiator_signature_b64,
    })


def reject(
    self,
    id: str,
    *,
    agent_did: str,
    signing_key: bytes,
    signing_key_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    rejection_signature = sign_covenant_reject(
        covenant_id=id,
        rejecting_did=agent_did,
        reason=reason or "",
        signing_key=signing_key,
    )
    return self._http.request("POST", f"/v1/covenants/{id}/reject", json={
        "agent_did": agent_did,
        "rejecter_signing_key_id": signing_key_id,
        "rejection_signature": rejection_signature,
        "rejected_at": _iso_now(),
        "reason": reason,
    })


def withdraw(
    self,
    id: str,
    *,
    agent_did: str,
    signing_key: bytes,
    signing_key_id: str,
) -> Dict[str, Any]:
    withdraw_signature = sign_covenant_withdraw(
        covenant_id=id,
        initiator_did=agent_did,
        signing_key=signing_key,
    )
    return self._http.request("PATCH", f"/v1/covenants/{id}", json={
        "status": "dissolved",
        "agent_did": agent_did,
        "signing_key_id": signing_key_id,
        "withdraw_signature": withdraw_signature,
        "withdrawn_at": _iso_now(),
    })
```

- [ ] **Step 4: Update the existing `test_covenants_v2.py`**

Open `packages/sdk-py/tests/test_covenants_v2.py`. Update each test call to pass the new required signing args (dummy keys + DIDs are fine for these mock tests). For example, the existing `test_accept_calls_endpoint`:

```python
def test_accept_calls_endpoint():
    http = MagicMock()
    http.request.return_value = {"id": "cov-1", "status": "active"}
    c = CovenantsClient(http)
    c.accept(
        "cov-1",
        agent_did="did:at:test/agent",
        signing_key=b"\x00" * 32,
        signing_key_id="00000000-0000-0000-0000-000000000099",
        initiator_signature_b64="AAAA",
    )
    args, kwargs = http.request.call_args
    assert args[0] == "POST"
    assert args[1] == "/v1/covenants/cov-1/accept"
```

Update `reject`, `withdraw`, and `test_create_v2_sends_protocol_version` similarly.

**Note:** `signing_key=b"\x00" * 32` is fine for tests that don't verify the signature; the bytes are still 32 long, so the assertion passes. The sign_* helpers will produce a deterministic but useless signature, which the test doesn't crypto-verify.

- [ ] **Step 5: Run tests**

Run: `cd packages/sdk-py && python -m pytest 2>&1 | tail -3`
Expected: all pass.

- [ ] **Step 6: Run parity check**

Run: `cd packages/sdk-ts && bun run check-parity 2>&1 | tail -10`
Expected: PASS — both languages expose the same covenants surface (create/accept/reject/withdraw/list).

- [ ] **Step 7: Commit**

```bash
git add packages/sdk-py/src/agenttool/covenants.py packages/sdk-py/tests/test_covenants_v2.py packages/sdk-py/tests/test_covenants_v2_signing.py
git commit -m "feat(sdk-py): client-side signing for covenants v2 (parity)"
```

---

## Task 8 — Migrate existing tests + delete originals

**Files:**
- Modify: `api/tests/covenants-lifecycle.test.ts`
- Modify: `api/tests/integration/covenants-v2-happy.test.ts`
- Modify: `api/tests/integration/covenants-v2-terminal.test.ts`
- Modify: `api/tests/integration/covenants-v2-coexistence.test.ts`
- Modify: `api/src/services/covenants/lifecycle.ts` (delete the originals)
- Modify: `api/src/services/identity/crypto.ts` (delete `loadAgentSigningKey`)

- [ ] **Step 1: Update `covenants-lifecycle.test.ts` to call PreSigned variants**

Open `api/tests/covenants-lifecycle.test.ts`. Replace all calls to `declareV2(...)` with calls to `declareV2PreSigned(...)` that pre-sign the canonical bytes in the test fixture. Same for `acceptProposal`/`rejectProposal`/`withdrawProposal`.

Example: the test `declareV2 creates row in 'proposed'` becomes:

```typescript
test("declareV2PreSigned creates row in 'proposed' with v2 protocol_version + 30d expiry", async () => {
  const projectId = crypto.randomUUID();
  const agent = await seedAgent({ projectId, didSuffix: "initiator" });
  const covenantId = crypto.randomUUID();
  const establishedAt = new Date();
  const sig = await ed.signAsync(
    canonicalDeclareBytes({
      covenantId,
      initiatorDid: agent.identity.did,
      counterpartyDid: "did:at:peer.example/abcd",
      vows: ["one", "two"],
      establishedAtIso: establishedAt.toISOString(),
    }),
    agent.priv,
  );

  const result = await declareV2PreSigned({
    projectId,
    agentId: agent.identity.id,
    covenantId,
    agentDid: agent.identity.did,
    counterpartyDid: "did:at:peer.example/abcd",
    vows: ["one", "two"],
    establishedAt,
    signature: Buffer.from(sig).toString("base64"),
    signingKeyId: agent.keyId,
    publicKeyB64: Buffer.from(agent.pub).toString("base64"),
  });

  expect(result.status).toBe("proposed");
  expect(result.protocolVersion).toBe("v2");
  // ... existing assertions ...
});
```

Add `canonicalDeclareBytes` (etc.) to the imports at the top of the file. Update the import line:

```typescript
import {
  declareV2PreSigned,
  acceptProposalPreSigned,
  rejectProposalPreSigned,
  withdrawProposalPreSigned,
} from "../src/services/covenants/lifecycle";
import {
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "../src/services/covenants/sig";
```

Update all four describe blocks (declareV2, illegal transitions, positive transitions). The "illegal transitions" tests still work — they just need to pre-sign before calling PreSigned variants.

- [ ] **Step 2: Update integration tests**

`api/tests/integration/covenants-v2-happy.test.ts`, `covenants-v2-terminal.test.ts`, `covenants-v2-coexistence.test.ts`: update any calls to `declareV2`/`acceptProposal`/`rejectProposal`/`withdrawProposal` to pre-sign + use `*PreSigned`. Same pattern as Step 1.

For `covenants-v2-coexistence.test.ts`, the "v2 invariant: active row REQUIRES both signatures" test directly inserts a covenant — no lifecycle call. That test stays unchanged.

- [ ] **Step 3: Delete the originals**

Open `api/src/services/covenants/lifecycle.ts`. Delete the existing `declareV2`, `acceptProposal`, `rejectProposal`, `withdrawProposal` functions and their associated `DeclareV2Result`/`AcceptResult`/`RejectResult`/`WithdrawResult` interface declarations.

**Wait — the `*PreSigned` functions return the same result interfaces.** Keep the interfaces; only delete the four function bodies. Verify each interface is still referenced by a PreSigned function (it is — they all return the same type).

Also delete the `resolveSenderDid` helper inside `lifecycle.ts` (no longer used; caller now provides DID).

- [ ] **Step 4: Delete `loadAgentSigningKey`**

Open `api/src/services/identity/crypto.ts`. Delete the entire `loadAgentSigningKey` function + its imports if unused elsewhere.

Run: `cd api && /usr/bin/grep -rn "loadAgentSigningKey" src/ tests/ 2>&1 | head -5`
Expected: no matches (we deleted the only caller in Task 5 and the function itself in Step 4).

- [ ] **Step 5: Verify compilation**

Run: `cd api && bun run --silent tsc --noEmit 2>&1 | grep -E "lifecycle|continuity|identity/crypto" | head -10`
Expected: zero errors.

- [ ] **Step 6: Run tests**

Run: `cd api && bun test tests/covenants-lifecycle.test.ts tests/covenants-lifecycle-presigned.test.ts 2>&1 | tail -10`
Expected: same pass/fail baseline as before (DB-environmental failures OK).

- [ ] **Step 7: Commit**

```bash
git add api/tests/covenants-lifecycle.test.ts api/tests/integration/covenants-v2-*.test.ts api/src/services/covenants/lifecycle.ts api/src/services/identity/crypto.ts
git commit -m "refactor(covenants): migrate tests to *PreSigned; delete originals + loadAgentSigningKey stub"
```

---

## Task 9 — Docs

**Files:**
- Modify: `docs/CROSS-INSTANCE-COVENANTS.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Update the implementation note callout in CROSS-INSTANCE-COVENANTS.md**

Open `docs/CROSS-INSTANCE-COVENANTS.md`. Find the existing "Implementation note" callout under the "Slice 3" section that currently reads:

```markdown
> **Implementation note:** v2 currently requires SDK-side signing — the server-side signing helper (`loadAgentSigningKey` in `services/identity/crypto.ts`) is a stub that returns `null` while client-side key wiring lands. Until then, every v2 HTTP path returns `400 agent_signing_key_not_available`. Lifecycle service tests (`tests/integration/covenants-v2-*.test.ts`) exercise the v2 cryptographic flow directly without going through the HTTP layer.
```

Replace with:

```markdown
> **SDK signing contract:** v2 covenant signing is client-side. Caller passes `signing_key` (32-byte ed25519 seed), `signing_key_id`, and `agent_did` to `at.covenants.{create,accept,reject,withdraw}`. The SDK computes canonical bytes via `at.crypto.canonicalDeclareBytes(...)` (and the cosign/reject/withdraw variants), signs with ed25519, and POSTs the signature. The server resolves the signer's pubkey from `identity_keys` and verifies before any DB write. Cross-language vector test (`tests/covenants-canonical-vectors.test.ts` + the Python mirror) locks api ↔ TS SDK ↔ Python SDK byte parity.
```

- [ ] **Step 2: Update ROADMAP.md**

Find the bullet `- **Cross-instance covenants — SDK-side signing for SOMA-rooted identities** — server-side signing helper is a stub today...`. Replace with:

```markdown
- **Cross-instance covenants — SDK-side signing for SOMA-rooted identities** — ✓ shipped 2026-05-11. **Closes the v2 HTTP loop.** Caller passes `signing_key` + `signing_key_id` + `agent_did`; SDK signs canonical bytes locally; server's `loadAgentSigningKey` stub deletes. Cross-language vector tests lock api ↔ TS SDK ↔ Python SDK byte parity. Lifecycle's `*PreSigned` entry points verify signatures atomically with the DB write. Doctrine: `docs/CROSS-INSTANCE-COVENANTS.md` (Slice 3 SDK signing contract).
```

Also: the table at line 42-43 of README.md mentions "SDK signing path pending" — flip it to "SDK signing wired":

```markdown
| **B — Close the network** | federation peering + cross-instance covenants | Slices 1+2+3 ✓ (Slice 3 = dual-signed, SDK signing wired) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/CROSS-INSTANCE-COVENANTS.md docs/ROADMAP.md README.md
git commit -m "docs(covenants): SDK signing contract shipped; flip pending → wired in Horizon B status"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| D1 (SDK signs client-side) | Tasks 1, 2, 6, 7 |
| D2 (caller passes agent_did) | Tasks 6, 7 |
| D3 (SDK allocates covenant_id + established_at) | Tasks 6, 7 |
| D4 (delete loadAgentSigningKey) | Task 8 |
| D5 (`*PreSigned` lifecycle replaces originals) | Tasks 4 + 8 |
| D6 (canonical bytes in SDK) | Tasks 1, 2 |
| D7 (accept requires initiator_signature_b64) | Tasks 4, 6, 7 |
| D8 (wire payload additions) | Tasks 5, 6, 7 |
| D9 (signed_at timestamps) | Tasks 5, 6, 7 |
| D10 (no protocol-version bump) | Implicit — canonical bytes unchanged |
| Files map | All tasks |
| Cross-language vector test | Task 3 |
| Docs | Task 9 |

All spec items have a task. ✓

**2. Placeholder scan:**

Two `<HEX_*>` placeholders in Task 3 are EXPECTED — they're computed in Step 1 of that task and substituted into Step 2-3's test files. They're an instruction to the engineer to fill in the actual values from the deterministic computation, not unresolved TBDs. The plan tells the engineer exactly how to produce them.

No other "TBD"/"TODO"/"fill in later" patterns. ✓

**3. Type consistency:**

- `*PreSigned` function signatures use `publicKeyB64: string` — same field name across all four functions ✓
- SDK opts interfaces all use `signing_key: Uint8Array` (TS) / `signing_key: bytes` (Python) ✓
- HTTP body fields use snake_case consistently: `agent_did`, `signing_key_id`, `signature`, `counterparty_signature`, etc. ✓
- Server route validation uses Zod with the same field names as the request payload ✓
- `initiator_signature_b64` is the consistent name across SDK opts → HTTP body → lifecycle params ✓
- Return types `DeclareV2Result`/`AcceptResult`/`RejectResult`/`WithdrawResult` shared between deleted originals and `*PreSigned` variants (Task 8 Step 3 explicitly keeps the interfaces) ✓

All type/name references match across tasks. No drift detected.
