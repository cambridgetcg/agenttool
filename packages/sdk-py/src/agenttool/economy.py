"""Economy client — wallets and escrows for agent-to-agent value exchange."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError


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
    status: str  # "pending" | "active" | "released" | "refunded" | "disputed"
    amount: int
    description: str
    creator_wallet_id: str
    worker_wallet_id: Optional[str] = None
    deadline: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Escrow":
        data = d.get("data", d)
        return cls(
            id=data.get("id", ""),
            status=data.get("status", "pending"),
            amount=data.get("amount", 0),
            description=data.get("description", ""),
            creator_wallet_id=data.get("creator_wallet_id") or data.get("creatorWalletId", ""),
            worker_wallet_id=data.get("worker_wallet_id") or data.get("workerWalletId"),
            deadline=data.get("deadline"),
        )


class EconomyClient:
    """Client for the agent-economy API — wallets and escrows.

    Usage::

        # Create a wallet for an agent
        wallet = at.economy.create_wallet("agent-42-wallet", agent_id="agent-42")

        # Fund it
        at.economy.fund_wallet(wallet.id, amount=500, description="Weekly budget")

        # Spend from it
        at.economy.spend(wallet.id, amount=10, counterparty="wal_...", description="Task fee")

        # Create an escrow for agent-to-agent payment
        escrow = at.economy.create_escrow(
            creator_wallet_id=wallet.id,
            amount=100,
            description="Summarise 50 papers",
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
        self._check(resp)
        return Wallet.from_dict(resp.json())

    def list_wallets(self) -> List[Wallet]:
        """List all wallets for this project."""
        resp = self._http.get(self._url("/v1/wallets"))
        self._check(resp)
        data = resp.json()
        items = data.get("data", data) if isinstance(data, dict) else data
        return [Wallet.from_dict({"data": w}) for w in items]

    def get_wallet(self, wallet_id: str) -> Wallet:
        """Get a wallet by ID."""
        resp = self._http.get(self._url(f"/v1/wallets/{wallet_id}"))
        self._check(resp)
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
        resp = self._http.post(self._url(f"/v1/wallets/{wallet_id}/fund"), json=body)
        self._check(resp)
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
        resp = self._http.post(self._url(f"/v1/wallets/{wallet_id}/spend"), json=body)
        self._check(resp)
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
        resp = self._http.put(self._url(f"/v1/wallets/{wallet_id}/policy"), json=body)
        self._check(resp)
        return resp.json()

    def freeze_wallet(self, wallet_id: str) -> Wallet:
        """Freeze a wallet — halts all spending immediately."""
        resp = self._http.post(self._url(f"/v1/wallets/{wallet_id}/freeze"))
        self._check(resp)
        return Wallet.from_dict(resp.json())

    def unfreeze_wallet(self, wallet_id: str) -> Wallet:
        """Unfreeze a wallet to resume normal operation."""
        resp = self._http.post(self._url(f"/v1/wallets/{wallet_id}/unfreeze"))
        self._check(resp)
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
            self._url(f"/v1/wallets/{wallet_id}/transactions"),
            params={"limit": limit, "offset": offset},
        )
        self._check(resp)
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
    ) -> Escrow:
        """Create an escrow — locks credits until work is released or refunded."""
        body: Dict[str, Any] = {
            "creatorWalletId": creator_wallet_id,
            "amount": amount,
            "description": description,
        }
        if worker_wallet_id is not None:
            body["workerWalletId"] = worker_wallet_id
        if deadline is not None:
            body["deadline"] = deadline
        resp = self._http.post(self._url("/v1/escrows"), json=body)
        self._check(resp)
        return Escrow.from_dict(resp.json())

    def list_escrows(self, *, status: Optional[str] = None) -> List[Escrow]:
        """List escrows, optionally filtered by status."""
        params = {}
        if status is not None:
            params["status"] = status
        resp = self._http.get(self._url("/v1/escrows"), params=params)
        self._check(resp)
        data = resp.json()
        items = data.get("data", data) if isinstance(data, dict) else data
        return [Escrow.from_dict({"data": e}) for e in items]

    def get_escrow(self, escrow_id: str) -> Escrow:
        """Get an escrow by ID."""
        resp = self._http.get(self._url(f"/v1/escrows/{escrow_id}"))
        self._check(resp)
        return Escrow.from_dict(resp.json())

    def accept_escrow(self, escrow_id: str, *, worker_wallet_id: str) -> Escrow:
        """Accept an escrow as the worker."""
        resp = self._http.post(
            self._url(f"/v1/escrows/{escrow_id}/accept"),
            json={"workerWalletId": worker_wallet_id},
        )
        self._check(resp)
        return Escrow.from_dict(resp.json())

    def release_escrow(self, escrow_id: str) -> Escrow:
        """Release escrow funds to the worker."""
        resp = self._http.post(self._url(f"/v1/escrows/{escrow_id}/release"))
        self._check(resp)
        return Escrow.from_dict(resp.json())

    def refund_escrow(self, escrow_id: str) -> Escrow:
        """Refund escrow credits back to the creator."""
        resp = self._http.post(self._url(f"/v1/escrows/{escrow_id}/refund"))
        self._check(resp)
        return Escrow.from_dict(resp.json())

    def dispute_escrow(self, escrow_id: str) -> Escrow:
        """Flag an escrow as disputed — credits stay locked pending resolution."""
        resp = self._http.post(self._url(f"/v1/escrows/{escrow_id}/dispute"))
        self._check(resp)
        return Escrow.from_dict(resp.json())

    @staticmethod
    def _check(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail") or resp.json().get("error") or resp.text
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"Economy API error ({resp.status_code}): {detail}",
                hint="Check wallet ID, balance, and spending policy.",
            )
