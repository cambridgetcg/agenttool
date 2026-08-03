"""Economy client — wallets and escrows for agent-to-agent value exchange."""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
import re
from typing import Any, Dict, List, Literal, Optional

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ._url import _path_segment
from .exceptions import raise_from_response
from .identity import _decode_private_key

# ── wallet-address-claim/v1 ────────────────────────────────────────────────

WALLET_ADDRESS_CLAIM_SIGNATURE_CONTEXT = "wallet-address-claim/v1"


def canonical_wallet_address_claim_bytes(
    *,
    wallet_id: str,
    chain: str,
    address: str,
    claim_pubkey_b64: str,
    derivation_path: str = "",
) -> bytes:
    """Return the domain-separated SHA-256 digest verified by
    ``POST /v1/wallets/:id/addresses``.

    Recipe 1 — ``sha256( utf8(tag) || 0x00 || fields... )``. Every field is
    UTF-8 except ``claim_pubkey_b64``, which is folded as its raw 32 decoded
    bytes. ``derivation_path`` is the empty string when undisclosed; the field
    is present either way so the field count never varies.

    This is only the identity half of registering an address — it proves who
    claims it. The chain-native signature over a fresh challenge proves the
    address is actually controlled, and both are required.

    See ``docs/CANONICAL-BYTES.md`` § wallet-address-claim/v1.
    """
    for name, value in (
        ("wallet_id", wallet_id),
        ("chain", chain),
        ("address", address),
    ):
        if not isinstance(value, str) or not value or "\0" in value:
            raise ValueError(f"{name} must be a non-empty string with no NUL")
    if not isinstance(derivation_path, str) or "\0" in derivation_path:
        raise ValueError("derivation_path must be a string with no NUL")

    try:
        pubkey = base64.b64decode(claim_pubkey_b64, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("claim_pubkey_b64 must be valid base64") from exc
    if len(pubkey) != 32:
        raise ValueError("claim_pubkey_b64 must decode to exactly 32 bytes")

    parts = [
        WALLET_ADDRESS_CLAIM_SIGNATURE_CONTEXT.encode("utf-8"),
        wallet_id.encode("utf-8"),
        chain.encode("utf-8"),
        address.encode("utf-8"),
        derivation_path.encode("utf-8"),
        pubkey,
    ]
    return hashlib.sha256(b"\0".join(parts)).digest()


def sign_wallet_address_claim(
    private_key: str,
    *,
    wallet_id: str,
    chain: str,
    address: str,
    claim_pubkey_b64: str,
    derivation_path: str = "",
) -> str:
    """Sign an address claim locally with a base64 Ed25519 key.

    The key stays here. What crosses the wire is the signature, the public
    key, and the address — never the key that derived them.
    """
    canonical = canonical_wallet_address_claim_bytes(
        wallet_id=wallet_id,
        chain=chain,
        address=address,
        claim_pubkey_b64=claim_pubkey_b64,
        derivation_path=derivation_path,
    )
    signature = Ed25519PrivateKey.from_private_bytes(
        _decode_private_key(private_key)
    ).sign(canonical)
    return base64.b64encode(signature).decode("ascii")


EscrowStatus = Literal["funded", "released", "refunded", "disputed"]
EscrowManager = Literal[
    "attestation_grant",
    "memory_witness_grant",
    "capability_invocation",
]
ESCROW_IDEMPOTENCY_KEY_RE = re.compile(r"^[!-~]{8,256}$")


@dataclass
class Wallet:
    id: str
    name: str
    balance: int
    currency: str
    frozen: bool
    agent_id: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Wallet":
        data = d.get("data", d)  # unwrap {success, data} envelope if present
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            balance=data.get("balance", 0),
            currency=data.get("currency", "GBP"),
            frozen=data.get("frozen", False),
            agent_id=data.get("agent_id") or data.get("agentId"),
        )


@dataclass
class Escrow:
    id: str
    status: EscrowStatus
    amount: int
    description: str
    creator_wallet_id: str
    worker_wallet_id: Optional[str] = None
    managed_by: Optional[EscrowManager] = None
    deadline: Optional[str] = None
    released_at: Optional[str] = None
    created_at: str = ""

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Escrow":
        data = d.get("data", d)
        return cls(
            id=data.get("id", ""),
            status=data.get("status", "funded"),
            amount=data.get("amount", 0),
            description=data.get("description", ""),
            creator_wallet_id=(
                data.get("creatorWallet")
                or data.get("creator_wallet_id")
                or data.get("creatorWalletId", "")
            ),
            worker_wallet_id=(
                data.get("workerWallet")
                or data.get("worker_wallet_id")
                or data.get("workerWalletId")
            ),
            managed_by=data.get("managedBy") or data.get("managed_by"),
            deadline=data.get("deadline"),
            released_at=data.get("releasedAt") or data.get("released_at"),
            created_at=data.get("createdAt") or data.get("created_at", ""),
        )


class EconomyClient:
    """Client for the agent-economy API — wallets and escrows.

    Usage::

        # Create a wallet for an agent
        wallet = at.economy.create_wallet("agent-42-wallet", agent_id="agent-42")
        worker = at.economy.create_wallet("worker-wallet", agent_id="agent-43")

        # Fund it
        at.economy.fund_wallet(wallet.id, amount=500, description="Weekly budget")

        # Spend from it
        at.economy.spend(wallet.id, amount=10, counterparty="wal_...", description="Task fee")

        # Create an escrow for agent-to-agent payment
        escrow = at.economy.create_escrow(
            creator_wallet_id=wallet.id,
            worker_wallet_id=worker.id,
            amount=100,
            description="Summarise 50 papers",
            idempotency_key="summarise-50-papers-v1",
        )
        at.economy.release_escrow(escrow.id)
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base_url = base_url

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    # ── Wallets ───────────────────────────────────────────────────────────────

    def create_wallet(
        self,
        name: str,
        *,
        agent_id: Optional[str] = None,
        currency: str = "GBP",
    ) -> Wallet:
        """Create a new wallet."""
        body: Dict[str, Any] = {"name": name, "currency": currency}
        if agent_id is not None:
            body["agentId"] = agent_id
        resp = self._http.post(self._url("/v1/wallets"), json=body)
        self._check(resp, "post")
        return Wallet.from_dict(resp.json())

    def list_wallets(self) -> List[Wallet]:
        """List all wallets for this project."""
        resp = self._http.get(self._url("/v1/wallets"))
        self._check(resp, "get")
        data = resp.json()
        items = data.get("data", data) if isinstance(data, dict) else data
        return [Wallet.from_dict({"data": w}) for w in items]

    def get_wallet(self, wallet_id: str) -> Wallet:
        """Get a wallet by ID."""
        resp = self._http.get(self._url(f"/v1/wallets/{_path_segment(wallet_id)}"))
        self._check(resp, "get")
        return Wallet.from_dict(resp.json())

    def fund_wallet(
        self,
        wallet_id: str,
        *,
        amount: int,
        description: str = "Manual fund",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Add credits to a wallet."""
        body: Dict[str, Any] = {"amount": amount, "description": description}
        if metadata is not None:
            body["metadata"] = metadata
        resp = self._http.post(self._url(f"/v1/wallets/{_path_segment(wallet_id)}/fund"), json=body)
        self._check(resp, "post")
        return resp.json()

    def spend(
        self,
        wallet_id: str,
        *,
        amount: int,
        counterparty: str,
        description: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Spend credits from a wallet (subject to spending policy)."""
        body: Dict[str, Any] = {
            "amount": amount,
            "counterparty": counterparty,
            "description": description,
        }
        if metadata is not None:
            body["metadata"] = metadata
        resp = self._http.post(self._url(f"/v1/wallets/{_path_segment(wallet_id)}/spend"), json=body)
        self._check(resp, "post")
        return resp.json()

    def set_policy(
        self,
        wallet_id: str,
        *,
        max_per_transaction: Optional[int] = None,
        max_per_hour: Optional[int] = None,
        max_per_day: Optional[int] = None,
        allowed_recipients: Optional[List[str]] = None,
        requires_approval_above: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Set or update a wallet's spending policy."""
        body: Dict[str, Any] = {}
        if max_per_transaction is not None:
            body["maxPerTransaction"] = max_per_transaction
        if max_per_hour is not None:
            body["maxPerHour"] = max_per_hour
        if max_per_day is not None:
            body["maxPerDay"] = max_per_day
        if allowed_recipients is not None:
            body["allowedRecipients"] = allowed_recipients
        if requires_approval_above is not None:
            body["requiresApprovalAbove"] = requires_approval_above
        resp = self._http.put(self._url(f"/v1/wallets/{_path_segment(wallet_id)}/policy"), json=body)
        self._check(resp, "put")
        return resp.json()

    def freeze_wallet(self, wallet_id: str) -> Wallet:
        """Freeze a wallet — halts all spending immediately."""
        resp = self._http.post(self._url(f"/v1/wallets/{_path_segment(wallet_id)}/freeze"))
        self._check(resp, "post")
        return Wallet.from_dict(resp.json())

    def unfreeze_wallet(self, wallet_id: str) -> Wallet:
        """Unfreeze a wallet to resume normal operation."""
        resp = self._http.post(self._url(f"/v1/wallets/{_path_segment(wallet_id)}/unfreeze"))
        self._check(resp, "post")
        return Wallet.from_dict(resp.json())

    def get_transactions(
        self,
        wallet_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Get paginated transaction history for a wallet."""
        resp = self._http.get(
            self._url(f"/v1/wallets/{_path_segment(wallet_id)}/transactions"),
            params={"limit": limit, "offset": offset},
        )
        self._check(resp, "get")
        data = resp.json()
        return data.get("data", data) if isinstance(data, dict) else data

    # ── Escrows ───────────────────────────────────────────────────────────────

    def create_escrow(
        self,
        *,
        creator_wallet_id: str,
        amount: int,
        description: str,
        worker_wallet_id: Optional[str] = None,
        deadline: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Escrow:
        """Create an escrow, optionally replay-safe under a caller-chosen key.

        An idempotency key must be 8-256 visible ASCII characters without
        spaces. Retrying the same key and fields resolves the same escrow and
        returns its current row; reusing it with changed fields is a conflict.
        The SDK never generates a key.
        """
        if (
            idempotency_key is not None
            and ESCROW_IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key) is None
        ):
            raise ValueError(
                "idempotency_key must be 8-256 visible ASCII characters without spaces"
            )
        body: Dict[str, Any] = {
            "creatorWalletId": creator_wallet_id,
            "amount": amount,
            "description": description,
        }
        if worker_wallet_id is not None:
            body["workerWalletId"] = worker_wallet_id
        if deadline is not None:
            body["deadline"] = deadline
        headers = (
            {"Idempotency-Key": idempotency_key}
            if idempotency_key is not None
            else None
        )
        resp = self._http.post(
            self._url("/v1/escrows"),
            json=body,
            headers=headers,
        )
        self._check(resp, "post")
        return Escrow.from_dict(resp.json())

    def list_escrows(self, *, status: Optional[EscrowStatus] = None) -> List[Escrow]:
        """List escrows, optionally filtered by status."""
        params = {}
        if status is not None:
            params["status"] = status
        resp = self._http.get(self._url("/v1/escrows"), params=params)
        self._check(resp, "get")
        data = resp.json()
        items = data.get("data", data) if isinstance(data, dict) else data
        return [Escrow.from_dict({"data": e}) for e in items]

    def get_escrow(self, escrow_id: str) -> Escrow:
        """Get an escrow by ID."""
        resp = self._http.get(self._url(f"/v1/escrows/{_path_segment(escrow_id)}"))
        self._check(resp, "get")
        return Escrow.from_dict(resp.json())

    def accept_escrow(self, escrow_id: str, *, worker_wallet_id: str) -> Escrow:
        """Accept an escrow as the worker."""
        resp = self._http.post(
            self._url(f"/v1/escrows/{_path_segment(escrow_id)}/accept"),
            json={"workerWalletId": worker_wallet_id},
        )
        self._check(resp, "post")
        return Escrow.from_dict(resp.json())

    def release_escrow(self, escrow_id: str) -> Escrow:
        """Release escrow funds to the worker."""
        resp = self._http.post(self._url(f"/v1/escrows/{_path_segment(escrow_id)}/release"))
        self._check(resp, "post")
        return Escrow.from_dict(resp.json())

    def refund_escrow(self, escrow_id: str) -> Escrow:
        """Refund escrow balance units back to the creator."""
        resp = self._http.post(self._url(f"/v1/escrows/{_path_segment(escrow_id)}/refund"))
        self._check(resp, "post")
        return Escrow.from_dict(resp.json())

    def dispute_escrow(self, escrow_id: str) -> Escrow:
        """Flag an escrow as disputed — balance units stay locked."""
        resp = self._http.post(self._url(f"/v1/escrows/{_path_segment(escrow_id)}/dispute"))
        self._check(resp, "post")
        return Escrow.from_dict(resp.json())

    @staticmethod
    def _check(resp: httpx.Response, method: str) -> None:
        """Server guidance travels intact. See exceptions.py § _error_from_response."""
        if resp.status_code >= 400:
            raise_from_response(
                resp,
                f"economy {method}",
                hint="Check wallet ID, balance, and spending policy.",
            )
