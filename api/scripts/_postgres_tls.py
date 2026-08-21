"""Exact authenticated transport options for the repository Python client."""

from __future__ import annotations

import hashlib
import os
import re
from typing import Dict
from urllib.parse import unquote, urlsplit


HERE = os.path.dirname(os.path.abspath(__file__))
SUPABASE_CA_PATH = os.path.normpath(
    os.path.join(HERE, "..", "certs", "supabase-prod-ca-2021.crt")
)
SUPABASE_CA_PEM_SHA256 = (
    "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
)


def postgres_tls_kwargs(database_url: str) -> Dict[str, str]:
    """Return explicit authenticated TLS or an exact loopback posture."""
    try:
        parsed = urlsplit(database_url)
        hostname = parsed.hostname
        # Access forces malformed/non-numeric/out-of-range ports to fail here.
        parsed.port
    except (UnicodeError, ValueError) as error:
        raise RuntimeError("DATABASE_URL is malformed or not PostgreSQL") from error
    if (
        parsed.scheme not in ("postgres", "postgresql")
        or not hostname
        or parsed.fragment
    ):
        raise RuntimeError("DATABASE_URL is malformed or not PostgreSQL")
    if parsed.query:
        raise RuntimeError("database URL query parameters are not supported")

    hostname = hostname.lower()
    is_supabase = bool(
        re.fullmatch(r"db\.[a-z0-9]{20}\.supabase\.co", hostname)
        or re.fullmatch(r"[a-z0-9-]+\.pooler\.supabase\.com", hostname)
    )
    if is_supabase:
        if not parsed.username or not parsed.password:
            raise RuntimeError("Supabase database URL credentials are incomplete")
        encoded_database = parsed.path[1:] if parsed.path.startswith("/") else ""
        if not encoded_database or re.search(r"%(?![0-9a-fA-F]{2})", encoded_database):
            raise RuntimeError("Supabase database URL path is invalid")
        try:
            database = unquote(encoded_database, errors="strict")
        except (UnicodeDecodeError, ValueError) as error:
            raise RuntimeError("Supabase database URL path is invalid") from error
        if not database or "/" in database:
            raise RuntimeError("Supabase database URL path is invalid")
        with open(SUPABASE_CA_PATH, "rb") as ca_file:
            ca_bytes = ca_file.read()
        if hashlib.sha256(ca_bytes).hexdigest() != SUPABASE_CA_PEM_SHA256:
            raise RuntimeError("vendored Supabase database CA bytes mismatch")
        return {"sslmode": "verify-full", "sslrootcert": SUPABASE_CA_PATH}

    if hostname in {"localhost", "127.0.0.1", "::1"} or hostname.startswith(
        "127."
    ):
        return {"sslmode": "disable"}
    raise RuntimeError(
        "unsupported remote database target; authenticated TLS is not configured"
    )
