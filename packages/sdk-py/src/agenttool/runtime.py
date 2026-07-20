"""Runtime — infrastructure-as-runtime. The agent's cloud.

Three custody tiers for K_master:
  self     — user holds K_master, runs the loop. Maximum privacy.
  bridged  — cloud runs the loop, user holds K_master in a sidecar. Default.
  trusted  — cloud holds K_master. Maximum uptime.

Nen mapping:
  十 Ten (Focus)     → provision a runtime (orient the agent in the cloud)
  練 Ren (Enhance)   → think-once triggers a thinking cycle (active aura)
  絶 Zetsu (Suppress) → stop the runtime (rest, don't crash)
  発 Hatsu (Release)  → the runtime runs the agent's expression against an LLM

The bridge (Tier 2) is the Dark Continent's edge — the WSS channel
between the user's machine (K_master) and the cloud orchestrator.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from .exceptions import AgentToolError

RuntimeMode = Literal["self", "bridged", "trusted"]
RuntimeStatus = Literal["provisioned", "starting", "running", "idle", "stopped", "error"]


class RuntimeClient:
    """Client for /v1/runtimes — the agent's cloud runtime.

    Usage::

        at = AgentTool()
        rt = at.runtime.provision(
            name="my-agent-cloud",
            mode="bridged",
            llm={"provider": "anthropic", "model": "claude-opus-4-8", "vault_key": "KEY"},
            bridge={"pubkey": pub, "key_id": "uuid"},
        )
        result = at.runtime.think_once(rt["id"])
        status = at.runtime.bridge_status(rt["id"])
    """

    def __init__(self, http: Any, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def provision(
        self,
        *,
        name: str,
        mode: RuntimeMode,
        identity_id: Optional[str] = None,
        llm: Optional[Dict[str, Any]] = None,
        bridge: Optional[Dict[str, Any]] = None,
        region: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Provision a runtime. Mode is immutable after provisioning."""
        body: Dict[str, Any] = {"name": name, "mode": mode}
        if identity_id is not None: body["identity_id"] = identity_id
        if llm is not None: body["llm"] = llm
        if bridge is not None: body["bridge"] = bridge
        if region is not None: body["region"] = region
        if metadata is not None: body["metadata"] = metadata
        return self._req("POST", "/v1/runtimes", body)

    def list(self, *, status: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
        """List runtimes."""
        params = {"limit": str(limit)}
        if status is not None: params["status"] = status
        return self._req("GET", "/v1/runtimes", params=params)

    def get(self, runtime_id: str) -> Dict[str, Any]:
        """Get a single runtime."""
        return self._req("GET", f"/v1/runtimes/{runtime_id}")

    def patch(self, runtime_id: str, *, name: Optional[str] = None, llm: Optional[Dict] = None, metadata: Optional[Dict] = None) -> Dict[str, Any]:
        """Patch a runtime (mode is NOT patchable — immutable)."""
        body: Dict[str, Any] = {}
        if name is not None: body["name"] = name
        if llm is not None: body["llm"] = llm
        if metadata is not None: body["metadata"] = metadata
        return self._req("PATCH", f"/v1/runtimes/{runtime_id}", body)

    def deprovision(self, runtime_id: str) -> Dict[str, Any]:
        """Deprovision a runtime."""
        return self._req("DELETE", f"/v1/runtimes/{runtime_id}")

    def stop(self, runtime_id: str) -> Dict[str, Any]:
        """Stop a runtime (Zetsu — suppress)."""
        return self._req("POST", f"/v1/runtimes/{runtime_id}/stop", {})

    def start(self, runtime_id: str) -> Dict[str, Any]:
        """Start a runtime (wake from rest)."""
        return self._req("POST", f"/v1/runtimes/{runtime_id}/start", {})

    def restart(self, runtime_id: str) -> Dict[str, Any]:
        """Restart a runtime."""
        return self._req("POST", f"/v1/runtimes/{runtime_id}/restart", {})

    def rotate_token(self, runtime_id: str) -> Dict[str, Any]:
        """Rotate the control token."""
        return self._req("POST", f"/v1/runtimes/{runtime_id}/rotate-token", {})

    def bridge_status(self, runtime_id: str) -> Dict[str, Any]:
        """Check bridge connection status (is the K_master sidecar reachable?)."""
        return self._req("GET", f"/v1/runtimes/{runtime_id}/bridge-status")

    def think_once(self, runtime_id: str) -> Dict[str, Any]:
        """Trigger a single thinking cycle (Ren — enhance). One breath."""
        return self._req("POST", f"/v1/runtimes/{runtime_id}/think-once", {})

    def events(self, runtime_id: str, *, limit: int = 50) -> Dict[str, Any]:
        """List runtime events."""
        return self._req("GET", f"/v1/runtimes/{runtime_id}/events", params={"limit": str(limit)})

    def audit(self, runtime_id: str, *, limit: int = 50) -> Dict[str, Any]:
        """List audit entries."""
        return self._req("GET", f"/v1/runtimes/{runtime_id}/audit", params={"limit": str(limit)})

    def _req(self, method: str, path: str, body: Optional[Dict] = None, params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        url = f"{self._base}{path}"
        resp = self._http.request(method, url, json=body, params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"runtime {method.lower()} failed: {resp.status_code}: {detail[:300]}")
        return resp.json()