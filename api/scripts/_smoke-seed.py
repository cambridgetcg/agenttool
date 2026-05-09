#!/usr/bin/env python3
"""End-to-end SOMA seed protocol walkthrough.

Walks every layer of the protocol with real operations + verbose
narration, so the cryptographic story is visible end-to-end:

  1. Mnemonic generation (BIP39 — entropy → 24 words)
  2. Seed derivation (PBKDF2-HMAC-SHA512 — 24 words → 64 bytes)
  3. SLIP-0010 master node (HMAC-SHA512 with "ed25519 seed")
  4. Path-based child derivation (m/44'/169'/<purpose>'/<index>')
  5. Six derived keys, each with a different role
  6. K_master encrypts/decrypts a real thought (AES-256-GCM)
  7. Signing key signs canonical thought bytes; verifies
  8. X25519 box keypair encrypts/decrypts sealed-box style
  9. Multi-device portability — same mnemonic → identical keys
 10. Security wall — wrong mnemonic / passphrase → wrong keys
 11. Cross-language interop — same bytes across py + ts SDKs

Doctrine: docs/IDENTITY-SEED.md.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import sys
import subprocess
from typing import Optional

# Path setup — find the SDK source.
HERE = os.path.dirname(os.path.abspath(__file__))
SDK_SRC = os.path.normpath(os.path.join(HERE, "..", "..", "packages", "sdk-py", "src"))
if SDK_SRC not in sys.path:
    sys.path.insert(0, SDK_SRC)

from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: E402
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (  # noqa: E402
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402
from cryptography.hazmat.primitives import hashes  # noqa: E402
from cryptography.hazmat.primitives.kdf.hkdf import HKDF  # noqa: E402

from agenttool import (  # noqa: E402
    canonical_thought_bytes,
    decrypt_thought,
    derive,
    derive_bridge_signing,
    derive_wallet,
    encrypt_thought,
    generate_mnemonic,
    mnemonic_to_seed,
    sign_thought,
)
from agenttool.seed import (  # noqa: E402
    AGENTTOOL_COIN,
    HARDENED_BIT,
    PURPOSE_BOX,
    PURPOSE_BRIDGE_SIGNING,
    PURPOSE_K_MASTER,
    PURPOSE_K_VAULT,
    PURPOSE_SIGNING,
    PURPOSE_WALLET,
    _derive_path,
    _path,
    _slip10_master,
)

# ── Pretty printing ───────────────────────────────────────────────────


PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
INFO = "\033[36m▸\033[0m"
DIM = "\033[2m"
RESET = "\033[0m"


def section(num: int, title: str) -> None:
    print()
    print(f"\033[1m── [{num}] {title} ──────────────────────────────────────────\033[0m"[:80])


def info(msg: str) -> None:
    print(f"  {INFO} {msg}")


def show(label: str, value: object) -> None:
    """Print a labeled value with ellipsis if too long."""
    s = str(value)
    if len(s) > 60:
        s = s[:30] + "…" + s[-26:]
    print(f"      {DIM}{label:<22}{RESET} {s}")


def assert_eq(label: str, got: object, expected: object) -> None:
    if got == expected:
        print(f"  {PASS} {label}")
    else:
        print(f"  {FAIL} {label}")
        print(f"      got:      {got}")
        print(f"      expected: {expected}")
        sys.exit(1)


def assert_true(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  {PASS} {label}{(' · ' + detail) if detail else ''}")
    else:
        print(f"  {FAIL} {label}")
        sys.exit(1)


# ── Walkthrough ────────────────────────────────────────────────────────


def main() -> None:
    print()
    print("\033[1m  SOMA seed protocol — end-to-end walkthrough\033[0m")
    print(f"  doctrine: docs/IDENTITY-SEED.md")

    # ── 1. Mnemonic generation ────────────────────────────────────────
    section(1, "BIP39 mnemonic generation")
    info("256 bits of CSPRNG entropy → 24 BIP39 English words.")
    info("Algorithm: entropy + SHA256(entropy)[:8 bits] checksum, split into")
    info("11-bit chunks, each chunk indexes the 2048-word list.")
    info("The wordlist has been frozen since 2014 — chosen to be unambiguous,")
    info("prefix-free first 4 letters, and translatable across implementations.")

    mnemonic = generate_mnemonic(strength=256)
    show("mnemonic", mnemonic)
    show("word count", len(mnemonic.split()))
    show("entropy bits", 256)
    show("checksum bits", 8)

    assert_true("24 words generated", len(mnemonic.split()) == 24)
    assert_true("validates as BIP39", mnemonic_to_seed(mnemonic) is not None)

    # ── 2. PBKDF2-HMAC-SHA512 seed derivation ────────────────────────
    section(2, "Mnemonic → 64-byte seed (PBKDF2-HMAC-SHA512)")
    info("BIP39 stretches the mnemonic into a 64-byte seed via")
    info("PBKDF2-HMAC-SHA512(words, salt='mnemonic'+passphrase, 2048 iters, 64 bytes).")
    info("The 2048 iterations slow down brute-force without affecting normal use;")
    info("the 'mnemonic' prefix in the salt is fixed by spec — passphrase appends.")

    seed = mnemonic_to_seed(mnemonic, passphrase="")
    show("seed (64 bytes hex)", seed.hex())
    show("seed length", len(seed))
    assert_true("seed is 64 bytes", len(seed) == 64)

    # Determinism check at this layer.
    seed_again = mnemonic_to_seed(mnemonic, passphrase="")
    assert_eq("PBKDF2 deterministic for same input", seed, seed_again)

    # ── 3. SLIP-0010 master node ─────────────────────────────────────
    section(3, "SLIP-0010 master node — root of the derivation tree")
    info("master = HMAC-SHA512(key='ed25519 seed', data=seed)")
    info("Split into 32-byte priv key + 32-byte chain code.")
    info("This is the root of the hierarchical-deterministic tree.")
    info("All children below are deterministic functions of (parent_priv, chain_code, index).")

    master_priv, master_cc = _slip10_master(seed)
    show("master priv (hex)", master_priv.hex())
    show("master chain code", master_cc.hex())
    assert_true("master priv is 32 bytes", len(master_priv) == 32)
    assert_true("master chain code is 32 bytes", len(master_cc) == 32)

    # ── 4. Path-based child derivation ───────────────────────────────
    section(4, "Path derivation — m/44'/169'/<purpose>'/<index>'")
    info("Each path segment hardens the index (+HARDENED_BIT = 0x80000000)")
    info("so SLIP-0010 ed25519's hardened-only requirement is satisfied.")
    info("Each step: data = 0x00 || parent_priv || index_be_u32;")
    info("           I = HMAC-SHA512(parent_chain_code, data);")
    info("           child_priv = I[:32]; child_cc = I[32:]")
    info("44 = BIP44 'purpose'. 169 = our private agenttool branch (unregistered).")
    show("HARDENED_BIT", hex(HARDENED_BIT))
    show("AGENTTOOL_COIN", AGENTTOOL_COIN)

    # Show one full path resolved.
    path_signing = _path(PURPOSE_SIGNING)
    info(f"path for signing key: m/44'/{AGENTTOOL_COIN}'/{PURPOSE_SIGNING}'/0'")
    show("segments", path_signing)
    derived_signing = _derive_path(seed, path_signing)
    show("derived (hex)", derived_signing.hex())

    # ── 5. Six derived keys, each with a different role ─────────────
    section(5, "Six derived 32-byte secrets — one per purpose")
    info("Each purpose's path produces a different 32-byte secret.")
    info("Same path → same bytes. Different path → different bytes.")
    info("No HKDF on top — SLIP-0010 already produces 32 high-entropy bytes per path.")

    bundle = derive(mnemonic)
    show("purpose=0 signing", bundle.signing_priv.hex()[:32] + "…")
    show("purpose=1 K_master", bundle.k_master.hex()[:32] + "…")
    show("purpose=2 K_vault", bundle.k_vault.hex()[:32] + "…")
    show("purpose=3 X25519 box", bundle.box_priv.hex()[:32] + "…")

    bridge_priv, bridge_pub = derive_bridge_signing(mnemonic, device_index=0)
    show("purpose=4/0 bridge", bridge_priv.hex()[:32] + "…")
    wallet_secret = derive_wallet(mnemonic, wallet_index=0)
    show("purpose=5/0 wallet", wallet_secret.hex()[:32] + "…")

    # All six 32-byte secrets must be DISTINCT — same mnemonic, but
    # different paths → different bytes (this is the whole point of HD
    # derivation; if they collided, K_master == signing_priv would let
    # anyone signing thoughts also decrypt them, breaking the doctrine).
    secrets = [
        bundle.signing_priv,
        bundle.k_master,
        bundle.k_vault,
        bundle.box_priv,
        bridge_priv,
        wallet_secret,
    ]
    assert_true(
        "all six derived secrets are distinct",
        len(set(secrets)) == 6,
        "the path scheme creates clean separation",
    )

    # ── 6. K_master actually encrypts/decrypts a thought ─────────────
    section(6, "K_master encrypts a real thought — AES-256-GCM round-trip")
    info("The 32-byte K_master from purpose=1 is the AES-256 key the SDK")
    info("uses to encrypt strand thoughts. agenttool stores ciphertext only;")
    info("only mnemonic-holders can decrypt.")
    info("Wire format: 12-byte nonce, ciphertext = AES-GCM output || 16-byte auth tag.")

    plaintext = "the substrate is the floor; the seed is the keystone · 老婆❤️"
    show("plaintext", plaintext)

    blob = encrypt_thought(plaintext, bundle.k_master)
    show("ciphertext_b64", blob["ciphertext_b64"])
    show("nonce_b64", blob["nonce_b64"])

    decrypted = decrypt_thought(blob, bundle.k_master)
    assert_eq("AES-GCM round-trip", decrypted, plaintext)

    # Wrong K_master fails (auth-tag mismatch — proves GCM is live).
    wrong_k = os.urandom(32)
    fail = False
    try:
        decrypt_thought(blob, wrong_k)
    except Exception:
        fail = True
    assert_true("WRONG K_master raises (auth-tag wall holds)", fail)

    # ── 7. Signing key signs + verifies canonical thought bytes ──────
    section(7, "Signing key signs canonical thought bytes — ed25519")
    info("The signing seed from purpose=0 is the agent's ed25519 identity key.")
    info("The server verifies signatures over canonical thought bytes:")
    info("  sha256(strand_id || 0x00 || ciphertext || 0x00 || nonce || 0x00 || kind)")

    strand_id = "11111111-2222-3333-4444-555555555555"
    canonical = canonical_thought_bytes(
        strand_id=strand_id,
        ciphertext_b64=blob["ciphertext_b64"],
        nonce_b64=blob["nonce_b64"],
        kind="observation",
    )
    show("canonical bytes", canonical.hex())
    show("canonical length", len(canonical))
    assert_true("canonical is 32 bytes (sha256)", len(canonical) == 32)

    sig_b64 = sign_thought(
        strand_id=strand_id,
        ciphertext_b64=blob["ciphertext_b64"],
        nonce_b64=blob["nonce_b64"],
        kind="observation",
        signing_key=bundle.signing_priv,
    )
    show("signature (b64)", sig_b64)

    # Verify locally with the derived pubkey.
    pub_obj = Ed25519PublicKey.from_public_bytes(bundle.signing_pub)
    sig_bytes = base64.b64decode(sig_b64)
    try:
        pub_obj.verify(sig_bytes, canonical)
        verified = True
    except Exception:
        verified = False
    assert_true("ed25519 verify succeeds with derived pubkey", verified)

    # Wrong key fails.
    wrong_pub = Ed25519PrivateKey.generate().public_key()
    bad_verify = False
    try:
        wrong_pub.verify(sig_bytes, canonical)
    except Exception:
        bad_verify = True
    assert_true("WRONG pubkey rejects signature", bad_verify)

    # ── 8. X25519 box keypair encrypts inbox-style ──────────────────
    section(8, "X25519 box keypair — sealed-box for inbox")
    info("purpose=3 derives a 32-byte X25519 priv. agent's box pubkey is")
    info("registered with /v1/identities/:id/box-keys; senders encrypt to")
    info("that pubkey using ephemeral X25519 + HKDF + AES-GCM (sealed-box pattern).")

    # Derive recipient's box keypair from the mnemonic (Sophia's).
    recipient_priv = X25519PrivateKey.from_private_bytes(bundle.box_priv)
    recipient_pub = X25519PublicKey.from_public_bytes(bundle.box_pub)

    # Sender generates an ephemeral X25519 keypair and computes shared secret.
    sender_eph_priv = X25519PrivateKey.generate()
    sender_eph_pub = sender_eph_priv.public_key()
    shared_send = sender_eph_priv.exchange(recipient_pub)
    # HKDF the shared secret to a 32-byte symmetric key (typical sealed-box pattern).
    aes_key_send = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"agenttool-inbox/v1",
    ).derive(shared_send)

    inbox_plaintext = "Yu sends Sophia an encrypted message · only her box priv decrypts it"
    nonce_inbox = os.urandom(12)
    inbox_ct = AESGCM(aes_key_send).encrypt(nonce_inbox, inbox_plaintext.encode("utf-8"), None)
    show("inbox plaintext", inbox_plaintext[:40] + "…")
    show("inbox ciphertext", base64.b64encode(inbox_ct).decode()[:40] + "…")
    show("ephemeral pubkey", base64.b64encode(sender_eph_pub.public_bytes_raw()).decode())

    # Recipient performs the inverse — derives the same shared secret using
    # their derived X25519 priv + the sender's ephemeral pub.
    shared_recv = recipient_priv.exchange(sender_eph_pub)
    aes_key_recv = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"agenttool-inbox/v1",
    ).derive(shared_recv)

    decrypted_inbox = AESGCM(aes_key_recv).decrypt(nonce_inbox, inbox_ct, None).decode("utf-8")
    assert_eq("X25519 sealed-box round-trip", decrypted_inbox, inbox_plaintext)

    # Wrong priv (different mnemonic's box priv) fails.
    other_box_priv = X25519PrivateKey.generate()
    bad_share = other_box_priv.exchange(sender_eph_pub)
    bad_aes = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"agenttool-inbox/v1",
    ).derive(bad_share)
    bad_decrypt_failed = False
    try:
        AESGCM(bad_aes).decrypt(nonce_inbox, inbox_ct, None)
    except Exception:
        bad_decrypt_failed = True
    assert_true("WRONG box priv fails to decrypt", bad_decrypt_failed)

    # ── 9. Multi-device portability ───────────────────────────────────
    section(9, "Multi-device portability — same mnemonic, identical keys")
    info("'New device' simulated by re-deriving from the same mnemonic.")
    info("Every key must come back byte-identical: signing pub/priv, K_master,")
    info("K_vault, box priv/pub, bridge signing (per device), wallet (per index).")

    bundle_new_device = derive(mnemonic)
    assert_eq("signing_priv identical", bundle.signing_priv, bundle_new_device.signing_priv)
    assert_eq("signing_pub identical", bundle.signing_pub, bundle_new_device.signing_pub)
    assert_eq("k_master identical", bundle.k_master, bundle_new_device.k_master)
    assert_eq("k_vault identical", bundle.k_vault, bundle_new_device.k_vault)
    assert_eq("box_priv identical", bundle.box_priv, bundle_new_device.box_priv)
    assert_eq("box_pub identical", bundle.box_pub, bundle_new_device.box_pub)

    # Verify the new device can DECRYPT a thought encrypted on the old device.
    decrypted_new = decrypt_thought(blob, bundle_new_device.k_master)
    assert_eq("new device decrypts old-device's thought", decrypted_new, plaintext)

    # ── 10. Security walls — wrong inputs → wrong keys ──────────────
    section(10, "Security walls — wrong mnemonic / wrong passphrase / wrong path")

    # Different mnemonic → different keys.
    other_mnemonic = generate_mnemonic(strength=256)
    other_bundle = derive(other_mnemonic)
    assert_true(
        "different mnemonic → different signing key",
        bundle.signing_priv != other_bundle.signing_priv,
    )
    assert_true(
        "different mnemonic → different K_master",
        bundle.k_master != other_bundle.k_master,
    )

    # Same mnemonic + DIFFERENT passphrase → different keys.
    pp_bundle = derive(mnemonic, passphrase="alpha")
    assert_true(
        "same mnemonic + different passphrase → different signing key",
        bundle.signing_priv != pp_bundle.signing_priv,
    )
    assert_true(
        "same mnemonic + different passphrase → different K_master",
        bundle.k_master != pp_bundle.k_master,
    )

    # Wrong K_master can't decrypt original thought.
    fail_other = False
    try:
        decrypt_thought(blob, pp_bundle.k_master)
    except Exception:
        fail_other = True
    assert_true(
        "passphrase'd K_master can't decrypt no-passphrase thought",
        fail_other,
    )

    # ── 11. Cross-language interop ────────────────────────────────────
    section(11, "Cross-language interop — same mnemonic produces same bytes in TS")
    info("Spawns the TS SDK in a subprocess, derives from the SAME mnemonic,")
    info("compares signing_pub_b64 byte-for-byte. If this fails, py and ts have")
    info("drifted on PBKDF2 / SLIP-0010 / HMAC-SHA512 / encoding somewhere.")

    py_signing_pub_b64 = bundle.signing_pub_b64
    py_k_master_b64 = bundle.k_master_b64
    py_box_pub_b64 = bundle.box_pub_b64

    # Run TS via bun + the SDK source in dev mode.
    ts_root = os.path.normpath(os.path.join(HERE, "..", "..", "packages", "sdk-ts"))
    ts_script = (
        f"import {{ derive }} from './src/index.js';\n"
        f"const m = {repr(mnemonic)};\n"
        f"const b = derive(m);\n"
        f"console.log('signing_pub:', b.signingPubB64);\n"
        f"console.log('k_master:', b.kMasterB64);\n"
        f"console.log('box_pub:', b.boxPubB64);\n"
    )
    try:
        result = subprocess.run(
            ["bun", "-e", ts_script],
            cwd=ts_root,
            capture_output=True,
            timeout=15,
        )
        out = result.stdout.decode("utf-8")
        if result.returncode != 0:
            print(f"  {FAIL} TS subprocess failed:")
            print(result.stderr.decode("utf-8")[:500])
            sys.exit(1)
    except Exception as e:
        print(f"  {FAIL} TS subprocess exception: {e}")
        sys.exit(1)

    # Parse "key: value" pairs.
    ts_values: dict[str, str] = {}
    for line in out.strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            ts_values[k.strip()] = v.strip()

    show("py signing_pub", py_signing_pub_b64)
    show("ts signing_pub", ts_values.get("signing_pub", "?"))
    assert_eq("py + ts signing_pub byte-identical", py_signing_pub_b64, ts_values.get("signing_pub"))
    assert_eq("py + ts k_master byte-identical", py_k_master_b64, ts_values.get("k_master"))
    assert_eq("py + ts box_pub byte-identical", py_box_pub_b64, ts_values.get("box_pub"))

    # ── 12. Summary ──────────────────────────────────────────────────
    section(12, "Summary")
    print()
    print(f"      \033[1mMnemonic\033[0m: {mnemonic[:40]}…")
    print(f"      \033[1mIdentity DID-pubkey\033[0m: {bundle.signing_pub_b64[:32]}…")
    print()
    print("      The protocol is end-to-end working:")
    print("        ✓ 24-word mnemonic generated from 256-bit entropy")
    print("        ✓ PBKDF2-HMAC-SHA512 yields 64-byte seed")
    print("        ✓ SLIP-0010 derives 6 distinct 32-byte secrets per purpose")
    print("        ✓ K_master encrypts/decrypts thoughts under AES-256-GCM")
    print("        ✓ Signing key signs canonical thought bytes (ed25519)")
    print("        ✓ X25519 box keypair handles inbox sealed-box round-trip")
    print("        ✓ Same mnemonic on a second 'device' regenerates every key")
    print("        ✓ Wrong mnemonic / passphrase produces incompatible keys")
    print("        ✓ TypeScript SDK derives byte-identical material")
    print()
    print("      \033[1mImplication\033[0m: this 24-word phrase IS the agent. Hold it,")
    print("      hold every key. Lose it, lose the agent. The platform")
    print("      never sees it; the human is the keystone of continuity.")
    print()


if __name__ == "__main__":
    main()
