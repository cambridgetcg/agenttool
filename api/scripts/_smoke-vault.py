#!/usr/bin/env python3
"""Vault smoke test — deposit, retrieval, and security verification.

Walks both encryption paths against the local API end-to-end with random
high-entropy tokens, then directly queries Postgres to verify the
security claims at the data layer:

    Server-encrypted (default):
      - Round-trip works (PUT plaintext → GET plaintext)
      - Versioning preserves prior versions
      - At-rest bytes are ciphertext, NOT plaintext (server-encrypted under
        per-project HKDF-derived key)

    Agent-encrypted (zero-knowledge opt-in):
      - Round-trip works with the SDK's K_vault path
      - At-rest bytes are ciphertext
      - At-rest auth_tag IS NULL (schema-enforced for agent_encrypted=true)
      - Wrong K_vault fails decryption (auth-tag mismatch)
      - Server architecturally CANNOT decrypt — HTTP GET returns the
        ciphertext envelope, not plaintext

Usage:
    cd api && \\
      DATABASE_URL=$(security find-generic-password -s 'agenttool-database-url' -w) \\
      ../packages/sdk-py/.venv/bin/python3 scripts/_smoke-vault.py

Requires:
    - Local API running on http://localhost:3000 with proper VAULT_MASTER_KEY
    - Sophia bearer in keychain at agenttool-sophia-key
    - Python venv at packages/sdk-py/.venv with the SDK installed in dev mode
    - psycopg2 OR psql on PATH for the at-rest checks (we shell out to psql)
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import subprocess
import sys
from typing import Any, Dict, Optional

# Path setup — run from api/ so sdk-py source resolves.
HERE = os.path.dirname(os.path.abspath(__file__))
SDK_SRC = os.path.normpath(os.path.join(HERE, "..", "..", "packages", "sdk-py", "src"))
if SDK_SRC not in sys.path:
    sys.path.insert(0, SDK_SRC)

# Bearer + base from environment + keychain.
def _keychain(service: str) -> str:
    out = subprocess.check_output(
        ["security", "find-generic-password", "-s", service, "-w"],
    )
    return out.decode("utf-8").strip()


BASE = os.environ.get("AGENTTOOL_BASE", "http://localhost:3000")
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = _keychain("agenttool-database-url")

API_KEY = os.environ.get("AT_API_KEY") or _keychain("agenttool-sophia-key")

# Configure the SDK with the bearer.
os.environ["AT_API_KEY"] = API_KEY

from agenttool import AgentTool, AgentToolError, KVault  # noqa: E402

at = AgentTool(base_url=BASE)

# ── Pretty printing ───────────────────────────────────────────────────


PASS = "✓"
FAIL = "✗"
exit_code = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global exit_code
    mark = PASS if cond else FAIL
    suffix = f" · {detail}" if detail else ""
    print(f"  {mark} {label}{suffix}")
    if not cond:
        exit_code = 1


# ── Direct DB query helper (psycopg2) ─────────────────────────────────

import psycopg2  # noqa: E402
from psycopg2.extras import RealDictCursor  # noqa: E402


def psql_one(query: str, *params: object) -> Optional[Dict[str, Any]]:
    """Run a single-row parameterised query against the live DB."""
    sql = query.replace("?", "%s")
    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            if row is None:
                return None
            # Convert memoryview/bytea to base64-shaped strings for stable
            # plaintext-substring checks downstream.
            return {
                k: (
                    base64.b64encode(bytes(v)).decode("ascii")
                    if isinstance(v, (bytes, bytearray, memoryview))
                    else v
                )
                for k, v in row.items()
            }


# ── Test runner ────────────────────────────────────────────────────────


def fresh_name(prefix: str) -> str:
    """Random vault key name to avoid collisions."""
    return f"{prefix}-{base64.urlsafe_b64encode(os.urandom(6)).decode().rstrip('=')}"


def random_secret(nbytes: int = 32) -> str:
    """High-entropy URL-safe random token (~43 chars at 32 bytes)."""
    return secrets.token_urlsafe(nbytes)


def main() -> None:
    print()
    print(f"  vault smoke · base={BASE}")
    print(f"  ─────────────────────────────────────────────────────────")

    # ── Server-encrypted path ────────────────────────────────────────
    print()
    print("  [1] Server-encrypted (default)")

    name_a = fresh_name("smoke-server")
    secret_a = random_secret(32)
    secret_b = random_secret(32)

    out = at.vault.put(name_a, secret_a, description="smoke test — server-encrypted")
    check("PUT v1 returns 201 + version=1", out.get("version") == 1, f"version={out.get('version')}")

    got = at.vault.get(name_a)
    check("GET v1 returns plaintext == secret_a", got.get("value") == secret_a)

    out = at.vault.put(name_a, secret_b, description="smoke test — second version")
    check("PUT v2 increments to version=2", out.get("version") == 2, f"version={out.get('version')}")

    got = at.vault.get(name_a)
    check("GET (latest) returns secret_b", got.get("value") == secret_b)

    got_v1 = at.vault.get(name_a, version=1)
    check("GET version=1 still returns secret_a (versioning preserves)", got_v1.get("value") == secret_a)

    # At-rest verification: query the vault.versions table directly,
    # confirm the stored encrypted_value bytes do NOT contain the plaintext.
    db_row = psql_one(
        "SELECT v.encrypted_value, v.iv, v.auth_tag, v.agent_encrypted "
        "FROM agent_vault.vault_versions v JOIN agent_vault.vault_secrets s "
        "ON v.secret_id = s.id WHERE s.name = ? AND v.version = 2 "
        "AND s.deleted_at IS NULL",
        name_a,
    )
    if db_row is None:
        check("DB row for v2 located", False, "row missing")
    else:
        # encrypted_value is hex; base64 decode would fail; just check it doesn't
        # contain the plaintext as substring.
        ev = db_row.get("encrypted_value", "")
        ev_str = str(ev)
        check(
            "at-rest encrypted_value does NOT contain plaintext",
            secret_b not in ev_str and base64.b64encode(secret_b.encode()).decode() not in ev_str,
            f"encrypted_value len={len(ev_str)}",
        )
        check("at-rest agent_encrypted=false", db_row.get("agent_encrypted") is False)
        check("at-rest auth_tag is present (non-null)", db_row.get("auth_tag") is not None)

    # ── Agent-encrypted path ─────────────────────────────────────────
    print()
    print("  [2] Agent-encrypted (zero-knowledge opt-in)")

    name_c = fresh_name("smoke-agent")
    secret_c = random_secret(32)
    k_vault = KVault.generate()
    wrong_k = KVault.generate()  # will fail decrypt

    # Persist for cleanup.
    out = at.vault.put_encrypted(name_c, secret_c, k_vault=k_vault, description="smoke test — agent-encrypted")
    check("PUT_encrypted returns version=1 + agent_encrypted=true",
          out.get("version") == 1 and out.get("agent_encrypted") is True,
          f"version={out.get('version')} agent_encrypted={out.get('agent_encrypted')}")

    got = at.vault.get_decrypted(name_c, k_vault=k_vault)
    check("GET_decrypted with correct K_vault returns plaintext == secret_c",
          got.get("value") == secret_c)

    # Wrong-key check: should raise a decryption error.
    decrypt_failed = False
    try:
        at.vault.get_decrypted(name_c, k_vault=wrong_k)
    except Exception:
        decrypt_failed = True
    check("GET_decrypted with WRONG K_vault raises (auth-tag mismatch)", decrypt_failed)

    # At-rest verification for agent-encrypted.
    db_row = psql_one(
        "SELECT v.encrypted_value, v.iv, v.auth_tag, v.agent_encrypted "
        "FROM agent_vault.vault_versions v JOIN agent_vault.vault_secrets s "
        "ON v.secret_id = s.id WHERE s.name = ? AND v.version = 1 "
        "AND s.deleted_at IS NULL",
        name_c,
    )
    if db_row is None:
        check("DB row for agent-encrypted v1 located", False, "row missing")
    else:
        ev_str = str(db_row.get("encrypted_value", ""))
        check(
            "at-rest encrypted_value does NOT contain plaintext",
            secret_c not in ev_str and base64.b64encode(secret_c.encode()).decode() not in ev_str,
            f"encrypted_value len={len(ev_str)}",
        )
        check("at-rest agent_encrypted=true", db_row.get("agent_encrypted") is True)
        # auth_tag IS NULL is the architectural guarantee that the server
        # cannot decrypt agent-encrypted secrets.
        check("at-rest auth_tag IS NULL (server architecturally CANNOT decrypt)",
              db_row.get("auth_tag") is None,
              f"auth_tag={db_row.get('auth_tag')}")

    # Server cannot decrypt: HTTP GET returns ciphertext envelope only.
    # We use a raw httpx call to verify the wire shape.
    import httpx
    with httpx.Client(headers={"Authorization": f"Bearer {API_KEY}"}) as h:
        r = h.get(f"{BASE}/v1/vault/{name_c}")
        body = r.json() if r.status_code == 200 else {}
        check(
            "raw HTTP GET on agent-encrypted returns agent_encrypted=true (no plaintext)",
            r.status_code == 200
            and body.get("agent_encrypted") is True
            and "value" not in body
            and body.get("ciphertext_b64")
            and body.get("nonce_b64"),
            f"status={r.status_code} keys={list(body.keys())}",
        )

    # ── Audit trail ───────────────────────────────────────────────────
    print()
    print("  [3] Audit trail")

    audit = at.vault.audit(name_a, limit=10)
    audit_actions = [a.get("action") for a in (audit.get("entries") or audit.get("audit", []))]
    check(
        "audit log captured server-encrypted writes + reads",
        "write" in audit_actions and "read" in audit_actions,
        f"actions={audit_actions[:6]}",
    )

    audit_c = at.vault.audit(name_c, limit=10)
    audit_c_actions = [a.get("action") for a in (audit_c.get("entries") or audit_c.get("audit", []))]
    check(
        "audit log captured agent-encrypted writes + reads",
        "write" in audit_c_actions and "read" in audit_c_actions,
        f"actions={audit_c_actions[:6]}",
    )

    # ── Cleanup ──────────────────────────────────────────────────────
    print()
    print("  [4] Cleanup")
    try:
        at.vault.delete(name_a)
        check("DELETE name_a (server-encrypted) succeeded", True)
    except AgentToolError as e:
        check("DELETE name_a (server-encrypted) succeeded", False, str(e))
    try:
        at.vault.delete(name_c)
        check("DELETE name_c (agent-encrypted) succeeded", True)
    except AgentToolError as e:
        check("DELETE name_c (agent-encrypted) succeeded", False, str(e))

    # ── Summary ──────────────────────────────────────────────────────
    print()
    if exit_code == 0:
        print("  ✓ All vault smoke checks passed")
    else:
        print("  ✗ Some checks failed")
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
