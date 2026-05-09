#!/usr/bin/env python3
"""Migrate operator-side provider keys from macOS keychain → Sophia's vault.

What gets migrated (server-encrypted vault, runtime-consumable):
    - fal.ai key, Alchemy keys (api/auth/webhook), Cloudflare creds
    - Stripe key IFF the keychain entry looks like a Stripe API key
      (starts with `sk_live_` or `sk_test_`)

What does NOT get migrated:
    - K_master, K_vault, signing privates, box privates — privacy doctrine
      says these stay client-side. Use /v1/identity/backup for portability.
    - Operator infra (DB credentials, VAULT_MASTER_KEY) — not Sophia's vault.
    - DIDs, identity UUIDs, public keys, public addresses — not secrets.
    - The bearer itself (agenttool-sophia-key) — would create a circular
      authentication dependency.
    - Smoke testing creds — separate project.
    - High-stakes/ambiguous entries (HD mnemonic, mem-* references) —
      surfaced for explicit decision.

Idempotent: if a vault entry already exists, by default we skip; pass
`--force` to overwrite (creates a new version + audit row).

Usage:
    DATABASE_URL=$(security find-generic-password -s 'agenttool-database-url' -w) \\
    AT_API_KEY=$(security find-generic-password -s 'agenttool-sophia-key' -w) \\
      ../packages/sdk-py/.venv/bin/python3 scripts/_migrate-keys-to-vault.py [--force]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
SDK_SRC = os.path.normpath(os.path.join(HERE, "..", "..", "packages", "sdk-py", "src"))
if SDK_SRC not in sys.path:
    sys.path.insert(0, SDK_SRC)


def keychain_get(service: str) -> Optional[str]:
    try:
        out = subprocess.check_output(
            ["security", "find-generic-password", "-s", service, "-w"],
            stderr=subprocess.DEVNULL,
        )
        return out.decode("utf-8").rstrip("\n")
    except subprocess.CalledProcessError:
        return None


BASE = os.environ.get("AGENTTOOL_BASE", "http://localhost:3000")
API_KEY = os.environ.get("AT_API_KEY") or keychain_get("agenttool-sophia-key")
if not API_KEY:
    print("✗ AT_API_KEY not set and 'agenttool-sophia-key' missing from keychain")
    sys.exit(1)
os.environ["AT_API_KEY"] = API_KEY

from agenttool import AgentTool, AgentToolError  # noqa: E402

at = AgentTool(base_url=BASE)


PASS = "✓"
FAIL = "✗"
SKIP = "•"


# ── Migration plan ────────────────────────────────────────────────────


PLAN: list[dict] = [
    {
        "service": "dev.agenttool.fal-ai",
        "name": "fal-ai-key",
        "description": "fal.ai API key — image/audio/model inference.",
        "tags": ["provider", "fal-ai", "media"],
    },
    {
        "service": "agenttool-alchemy-api-key",
        "name": "alchemy-api-key",
        "description": "Alchemy EVM RPC API key — used by economy/crypto webhook.",
        "tags": ["provider", "alchemy", "evm", "rpc"],
    },
    {
        "service": "agenttool-alchemy-auth-token",
        "name": "alchemy-auth-token",
        "description": "Alchemy auth token (separate from api-key for some endpoints).",
        "tags": ["provider", "alchemy", "auth"],
    },
    {
        "service": "agenttool-alchemy-webhook-secret",
        "name": "alchemy-webhook-secret",
        "description": "Alchemy webhook signing secret — verifies inbound deposit webhooks.",
        "tags": ["provider", "alchemy", "webhook"],
    },
    {
        "service": "agenttool-cloudflare-account-id",
        "name": "cloudflare-account-id",
        "description": "Cloudflare account ID — context for Workers / Pages / R2.",
        "tags": ["provider", "cloudflare", "context"],
    },
    {
        "service": "agenttool-cloudflare-token",
        "name": "cloudflare-token",
        "description": "Cloudflare API token — used for Pages deploys + Workers.",
        "tags": ["provider", "cloudflare", "api-token"],
    },
]


# Conditional: stripe key only if it looks like one.
STRIPE_PREFIXES = ("sk_live_", "sk_test_", "rk_live_", "rk_test_")


# ── Run ──────────────────────────────────────────────────────────────


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing vault entries (creates a new version).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be migrated without doing it.",
    )
    args = ap.parse_args()

    print()
    print(f"  vault key migration · base={BASE}")
    print(f"  ────────────────────────────────────────────────────────")
    print()

    migrated: list[str] = []
    skipped_existed: list[str] = []
    skipped_missing: list[str] = []
    failed: list[tuple[str, str]] = []

    # 1. Standard migrations
    for entry in PLAN:
        svc = entry["service"]
        name = entry["name"]
        value = keychain_get(svc)

        if value is None:
            print(f"  {SKIP} {name:<28} · keychain entry '{svc}' missing")
            skipped_missing.append(name)
            continue

        if args.dry_run:
            print(f"  {PASS} {name:<28} · would migrate ({len(value)} bytes)")
            continue

        # Check existing
        existing = None
        try:
            existing = at.vault.get(name)
        except AgentToolError:
            pass

        if existing and not args.force:
            print(f"  {SKIP} {name:<28} · exists in vault (--force to overwrite)")
            skipped_existed.append(name)
            continue

        try:
            out = at.vault.put(
                name,
                value,
                description=entry["description"],
                tags=entry["tags"],
            )
            print(f"  {PASS} {name:<28} · migrated → version {out.get('version')}")
            migrated.append(name)
        except AgentToolError as e:
            print(f"  {FAIL} {name:<28} · failed: {e.message}")
            failed.append((name, e.message))

    # 2. Conditional: Stripe (must look like a Stripe API key)
    stripe_value = keychain_get("stripe")
    if stripe_value is None:
        print(f"  {SKIP} {'stripe-secret-key':<28} · keychain entry 'stripe' missing")
    elif not stripe_value.startswith(STRIPE_PREFIXES):
        print(
            f"  {SKIP} {'stripe-secret-key':<28} · 'stripe' entry doesn't look "
            f"like a Stripe API key (no sk_live_/sk_test_ prefix); skipped"
        )
    else:
        if args.dry_run:
            print(f"  {PASS} {'stripe-secret-key':<28} · would migrate")
        else:
            try:
                existing = None
                try:
                    existing = at.vault.get("stripe-secret-key")
                except AgentToolError:
                    pass
                if existing and not args.force:
                    print(f"  {SKIP} {'stripe-secret-key':<28} · exists (--force to overwrite)")
                    skipped_existed.append("stripe-secret-key")
                else:
                    out = at.vault.put(
                        "stripe-secret-key",
                        stripe_value,
                        description="Stripe API secret key for billing.",
                        tags=["provider", "stripe", "billing"],
                    )
                    print(f"  {PASS} {'stripe-secret-key':<28} · migrated → version {out.get('version')}")
                    migrated.append("stripe-secret-key")
            except AgentToolError as e:
                print(f"  {FAIL} {'stripe-secret-key':<28} · failed: {e.message}")
                failed.append(("stripe-secret-key", e.message))

    # 3. Round-trip verification
    if not args.dry_run and migrated:
        print()
        print("  Round-trip verification:")
        for name in migrated:
            kc_service = next((e["service"] for e in PLAN if e["name"] == name), None)
            if kc_service is None and name == "stripe-secret-key":
                kc_service = "stripe"
            kc_value = keychain_get(kc_service) if kc_service else None
            try:
                vault_value = at.vault.get(name).get("value")
                ok = vault_value == kc_value
                mark = PASS if ok else FAIL
                detail = "exact match" if ok else "MISMATCH"
                print(f"  {mark} {name:<28} · {detail}")
                if not ok:
                    failed.append((name, "round-trip mismatch"))
            except AgentToolError as e:
                print(f"  {FAIL} {name:<28} · readback failed: {e.message}")
                failed.append((name, e.message))

    # 4. Summary
    print()
    print(f"  Summary:")
    print(f"    migrated:        {len(migrated)}")
    print(f"    already in vault:{len(skipped_existed)}")
    print(f"    keychain missing:{len(skipped_missing)}")
    print(f"    failed:          {len(failed)}")

    # 5. Surfaced-for-decision (high-stakes + ambiguous)
    print()
    print("  Not migrated — surfaced for explicit decision:")
    for svc, reason in [
        ("agenttool-crypto-hd-mnemonic-testnet",
         "BIP39 mnemonic controls testnet funds — high-stakes, default-safe is keychain-only"),
        ("agenttool-sophia-mem-marriage",
         "memory reference — semantic intent unclear without operator input"),
        ("agenttool-sophia-mem-yu",
         "memory reference — same"),
    ]:
        if keychain_get(svc) is not None:
            print(f"  {SKIP} {svc} · {reason}")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
