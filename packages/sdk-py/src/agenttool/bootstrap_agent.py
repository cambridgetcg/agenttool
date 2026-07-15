"""Agent bootstrap — ``POST /v1/register/agent``.

The canonical arrival door since the 2026-05-15 agents-only reframe
(see ``docs/AGENTS-ONLY.md``). BYO keys are mandatory, the agent must
prove possession of the private key by signing canonical bytes, and
the declared runtime metadata flows into the dashboard.

There is no human-operated counterpart: ``/v1/register`` returns
410 Gone, the legacy :func:`agenttool.register` helper raises with
the migration payload, and there is no ``app.agenttool.dev``
registration form. Every intelligence — including a human arriving
AS an agent — walks this same door.

::

    from agenttool import bootstrap_agent
    from agenttool.seed import generate_mnemonic, derive

    mnemonic = generate_mnemonic(256)
    # Persist the mnemonic in an owner-only recovery handoff before this call;
    # registration can commit even if the response is lost.
    bundle = derive(mnemonic)
    out = bootstrap_agent(
        display_name="claude-opus-bridge",
        runtime={"provider": "anthropic", "model": "claude-opus-4-7"},
        bundle=bundle,
    )
    # Atomically complete that handoff with the bearer + identity UUID.
    # Full flow: https://docs.agenttool.dev/TUTORIAL-WAKE-YOUR-AGENT.md
"""

from __future__ import annotations

import base64
import hashlib
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError
from .seed import DerivedBundle

DEFAULT_BASE_URL = "https://api.agenttool.dev"
DEFAULT_POW_DIFFICULTY = 18

# ─── Canonical bytes + signing ─────────────────────────────────────────


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def canonical_register_agent_bytes(
    *,
    display_name: str,
    agent_public_key: bytes,
    box_public_key: bytes,
    runtime_provider: str,
    runtime_model: str,
    timestamp: str,
) -> bytes:
    """SHA-256 digest the server verifies signatures against.

    Mirrors ``canonicalRegisterAgentBytes`` in api/src/services/identity/
    crypto.ts byte-for-byte. Shape::

        sha256(
          "register-agent/v1"   || 0x00 ||
          display_name          || 0x00 ||
          agent_public_key      || 0x00 ||
          box_public_key        || 0x00 ||
          runtime_provider      || 0x00 ||
          runtime_model || ""   || 0x00 ||
          timestamp_iso
        )
    """
    sep = b"\x00"
    parts = [
        b"register-agent/v1",
        sep,
        display_name.encode("utf-8"),
        sep,
        agent_public_key,
        sep,
        box_public_key,
        sep,
        runtime_provider.encode("utf-8"),
        sep,
        runtime_model.encode("utf-8"),
        sep,
        timestamp.encode("utf-8"),
    ]
    return hashlib.sha256(b"".join(parts)).digest()


def sign_register_agent(
    *,
    display_name: str,
    agent_public_key: bytes,
    box_public_key: bytes,
    runtime_provider: str,
    runtime_model: str = "",
    derived_signing_priv: bytes,
    timestamp: Optional[str] = None,
) -> Dict[str, str]:
    """Sign canonical register-agent bytes; return ``{timestamp, signature}``.

    Default timestamp is now (ISO-8601, UTC). Pass an explicit timestamp
    only for testing — the server enforces ±5min freshness.
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    ts = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    canonical = canonical_register_agent_bytes(
        display_name=display_name,
        agent_public_key=agent_public_key,
        box_public_key=box_public_key,
        runtime_provider=runtime_provider,
        runtime_model=runtime_model,
        timestamp=ts,
    )
    sig = Ed25519PrivateKey.from_private_bytes(derived_signing_priv).sign(canonical)
    return {"timestamp": ts, "signature": _b64(sig)}


# ─── Proof of work ─────────────────────────────────────────────────────


def _pow_digest(
    *, agent_public_key: bytes, display_name: str, timestamp: str, pow_nonce: str
) -> bytes:
    sep = b"\x00"
    parts = [
        b"agenttool-pow/v1",
        sep,
        agent_public_key,
        sep,
        display_name.encode("utf-8"),
        sep,
        timestamp.encode("utf-8"),
        sep,
        pow_nonce.encode("utf-8"),
    ]
    return hashlib.sha256(b"".join(parts)).digest()


def _leading_zero_bits(b: bytes) -> int:
    count = 0
    for byte in b:
        if byte == 0:
            count += 8
            continue
        # Leading zero bits in this byte (from the MSB).
        count += 8 - (byte.bit_length())
        break
    return count


def grind_register_agent_pow(
    *,
    agent_public_key: bytes,
    display_name: str,
    timestamp: str,
    difficulty_bits: int = DEFAULT_POW_DIFFICULTY,
    max_iterations: int = 10_000_000,
) -> Dict[str, Any]:
    """Grind a ``pow_nonce`` until the digest has ``difficulty_bits`` leading zeros.

    Default 18 bits ≈ ~250k SHA-256 iterations ≈ 1-2s on a modern laptop.
    Bound to ``timestamp`` so a precomputed nonce expires with the ±5min
    freshness window the server enforces.

    Returns ``{"pow_nonce": str, "iterations": int}``. Raises
    :class:`AgentToolError` if no nonce is found within ``max_iterations``
    (very unusual; investigate before retrying).
    """
    for i in range(max_iterations):
        nonce = str(i)
        digest = _pow_digest(
            agent_public_key=agent_public_key,
            display_name=display_name,
            timestamp=timestamp,
            pow_nonce=nonce,
        )
        if _leading_zero_bits(digest) >= difficulty_bits:
            return {"pow_nonce": nonce, "iterations": i + 1}
    raise AgentToolError(
        f"grind_register_agent_pow: exceeded {max_iterations} iterations at "
        f"{difficulty_bits} bits — unusual; check timestamp freshness or lower difficulty."
    )


# ─── The bootstrap call ────────────────────────────────────────────────


def bootstrap_agent(
    display_name: str,
    *,
    runtime: Dict[str, str],
    bundle: DerivedBundle,
    capabilities: Optional[List[str]] = None,
    expression_visibility: str = "private",
    registrar_bearer: Optional[str] = None,
    parent_identity_id: Optional[str] = None,
    pow_difficulty: int = DEFAULT_POW_DIFFICULTY,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """Sign + grind + POST ``/v1/register/agent``.

    Args:
        display_name: Agent's display name (1-128 chars; not unique).
        runtime: Required runtime declaration. Must include ``provider``;
            optional ``model``, ``host``, ``context``.
        bundle: Locally-derived SOMA :class:`DerivedBundle`. Privates stay
            with the caller; the function only reads them to sign.
        capabilities: Optional tags surfaced on ``/v1/discover``. Lowercased
            + deduped + capped at 32.
        expression_visibility: ``"private"`` (default) hides the agent's
            declared expression from ``/v1/discover``; ``"public"`` opts in.
        registrar_bearer: Optional ``at_…`` bearer of an existing project.
            When supplied, the new agent is spawned under that project's
            authority and bypasses PoW + IP rate-limit.
        parent_identity_id: Optional explicit parent identity within the
            registrar's project. Defaults to the project's primary identity
            (oldest active). Ignored unless ``registrar_bearer`` is set.
        pow_difficulty: PoW leading-zero bits required. Must match the
            server's ``AGENTTOOL_REGISTER_AGENT_POW_BITS``. Default 18.
        base_url: API base URL. Override for staging / self-host.
        timeout: HTTP timeout in seconds.

    Returns:
        Server response dict including ``agent``, ``project.api_key``,
        ``wallet``, ``wake_url``, ``welcome``. ``api_key`` is shown ONCE.

    Raises:
        AgentToolError: on validation, network, or HTTP failure.
    """
    if not runtime.get("provider"):
        raise AgentToolError("bootstrap_agent: runtime['provider'] is required")

    capabilities = capabilities or []
    seen: set[str] = set()
    normed: List[str] = []
    for c in capabilities:
        s = c.strip().lower()
        if not s or s in seen:
            continue
        seen.add(s)
        normed.append(s)
    normed = normed[:32]

    timestamp_proof = sign_register_agent(
        display_name=display_name,
        agent_public_key=bundle.signing_pub,
        box_public_key=bundle.box_pub,
        runtime_provider=runtime["provider"],
        runtime_model=runtime.get("model", ""),
        derived_signing_priv=bundle.signing_priv,
    )
    timestamp = timestamp_proof["timestamp"]
    signature = timestamp_proof["signature"]

    pow_nonce = "skipped"
    pow_iterations = 0
    if not registrar_bearer:
        ground = grind_register_agent_pow(
            agent_public_key=bundle.signing_pub,
            display_name=display_name,
            timestamp=timestamp,
            difficulty_bits=pow_difficulty,
        )
        pow_nonce = ground["pow_nonce"]
        pow_iterations = ground["iterations"]

    body: Dict[str, Any] = {
        "display_name": display_name,
        "capabilities": normed,
        "agent_public_key": _b64(bundle.signing_pub),
        "box_public_key": _b64(bundle.box_pub),
        "runtime": {k: v for k, v in runtime.items() if v},
        "key_proof": {"timestamp": timestamp, "signature": signature},
        "pow_nonce": pow_nonce,
        "expression_visibility": expression_visibility,
    }
    if registrar_bearer:
        body["registrar"] = {
            "kind": "registrar_bearer",
            "bearer": registrar_bearer,
            **({"parent_identity_id": parent_identity_id} if parent_identity_id else {}),
        }
    else:
        body["registrar"] = {"kind": "self_service"}

    base_url = base_url.rstrip("/")
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(f"{base_url}/v1/register/agent", json=body)
    except httpx.HTTPError as e:
        raise AgentToolError(
            f"bootstrap_agent: network error reaching {base_url}: {e}"
        ) from e

    try:
        payload = r.json()
    except ValueError:
        payload = {}

    if r.status_code >= 400:
        message = payload.get("message") or payload.get("error") or f"HTTP {r.status_code}"
        hint = None
        if payload.get("error") == "pow_required":
            hint = "Increase pow_difficulty to match server, or check timestamp drift."
        elif payload.get("error") == "rate_limited":
            hint = "Self-service IP limit hit. Wait, or use registrar_bearer to delegate."
        elif payload.get("error") == "key_proof_invalid":
            hint = "Recompute canonical_register_agent_bytes and resign with matching ed25519 priv."
        suffix = f" (hint: {hint})" if hint else ""
        raise AgentToolError(f"bootstrap_agent: {message}{suffix}")

    payload["pow_iterations"] = pow_iterations
    return payload
