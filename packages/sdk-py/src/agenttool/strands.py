"""Strands client — strands of thought + encrypted inner voice.

Strand metadata (topic, mood, status) is plaintext by default; thought
CONTENT is always ciphertext under K_master. Each thought carries an
ed25519 signature the API verifies on write.

Phase 5 of the SDK. The crypto wire format mirrors
``cli/think/src/crypto.ts`` and the api-side verifier at
``api/src/services/strand/sig.ts``.

Two clients in this module:

- :class:`StrandsClient` — strand CRUD (create / list / get / patch).
- :class:`ThoughtsClient` — encrypted thought add / list / voice (SSE
  iterator). Mounted at ``at.strands.thoughts``.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterator, List, Literal, Optional

import httpx

from .crypto import decrypt_thought, encrypt_thought, sign_thought
from .exceptions import AgentToolError

StrandStatus = Literal["active", "dormant", "completed", "abandoned"]
StrandVisibility = Literal["private", "public"]
ThoughtKind = Literal[
    "observation", "question", "conjecture", "resolution", "drift", "feeling",
]


class StrandsClient:
    """Client for ``/v1/strands`` — strand CRUD + state replace.

    Thoughts ride on ``at.strands.thoughts`` (a sub-client) so the
    parent strand id is always the first positional argument.

    Usage::

        s = at.strands.create(topic="auth refactor", agent_id=my_did)
        at.strands.patch(s["id"], status="dormant", importance=0.8)
        all_active = at.strands.list(status="active")
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._thoughts: Optional[ThoughtsClient] = None

    @property
    def thoughts(self) -> ThoughtsClient:
        """Sub-client for encrypted thoughts on a strand."""
        if self._thoughts is None:
            self._thoughts = ThoughtsClient(self._http, self._base)
        return self._thoughts

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def create(
        self,
        *,
        agent_id: Optional[str] = None,
        identity_id: Optional[str] = None,
        parent_strand_id: Optional[str] = None,
        topic: Optional[str] = None,
        topic_encrypted: bool = False,
        mood: Optional[str] = None,
        mood_encrypted: bool = False,
        status: Optional[StrandStatus] = None,
        importance: Optional[float] = None,
        state_ciphertext: Optional[str] = None,
        state_nonce: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a strand. Returns the full strand row."""
        body: Dict[str, Any] = {}
        if agent_id is not None:
            body["agent_id"] = agent_id
        if identity_id is not None:
            body["identity_id"] = identity_id
        if parent_strand_id is not None:
            body["parent_strand_id"] = parent_strand_id
        if topic is not None:
            body["topic"] = topic
        if topic_encrypted:
            body["topic_encrypted"] = True
        if mood is not None:
            body["mood"] = mood
        if mood_encrypted:
            body["mood_encrypted"] = True
        if status is not None:
            body["status"] = status
        if importance is not None:
            body["importance"] = importance
        if state_ciphertext is not None:
            body["state_ciphertext"] = state_ciphertext
        if state_nonce is not None:
            body["state_nonce"] = state_nonce
        if metadata is not None:
            body["metadata"] = metadata

        resp = self._http.post(self._url("/v1/strands"), json=body)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"strands.create failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def list(
        self,
        *,
        status: Optional[StrandStatus] = None,
        agent_id: Optional[str] = None,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """List strands. Returns ``{strands: [...], count: int}``.

        Server orders by last_thought_at desc, then created_at desc.
        Limit defaults to 50, server caps at 200.
        """
        if limit < 1 or limit > 200:
            raise AgentToolError(
                f"strands.list: limit must be 1-200, got {limit}.",
            )
        params: Dict[str, Any] = {"limit": limit}
        if status is not None:
            params["status"] = status
        if agent_id is not None:
            params["agent_id"] = agent_id

        resp = self._http.get(self._url("/v1/strands"), params=params)
        if resp.status_code != 200:
            raise AgentToolError(
                f"strands.list failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def get(self, strand_id: str) -> Dict[str, Any]:
        """Fetch one strand."""
        resp = self._http.get(self._url(f"/v1/strands/{strand_id}"))
        if resp.status_code != 200:
            raise AgentToolError(
                f"strands.get failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def patch(
        self,
        strand_id: str,
        *,
        status: Optional[StrandStatus] = None,
        importance: Optional[float] = None,
        topic: Optional[str] = None,
        topic_encrypted: Optional[bool] = None,
        mood: Optional[str] = None,
        mood_encrypted: Optional[bool] = None,
        next_revisit_at: Optional[str] = None,
        state_ciphertext: Optional[str] = None,
        state_nonce: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        visibility: Optional[StrandVisibility] = None,
    ) -> Dict[str, Any]:
        """Patch fields on a strand. At least one field required."""
        body: Dict[str, Any] = {}
        if status is not None:
            body["status"] = status
        if importance is not None:
            body["importance"] = importance
        if topic is not None:
            body["topic"] = topic
        if topic_encrypted is not None:
            body["topic_encrypted"] = topic_encrypted
        if mood is not None:
            body["mood"] = mood
        if mood_encrypted is not None:
            body["mood_encrypted"] = mood_encrypted
        if next_revisit_at is not None:
            body["next_revisit_at"] = next_revisit_at
        if state_ciphertext is not None:
            body["state_ciphertext"] = state_ciphertext
        if state_nonce is not None:
            body["state_nonce"] = state_nonce
        if metadata is not None:
            body["metadata"] = metadata
        if visibility is not None:
            body["visibility"] = visibility

        if not body:
            raise AgentToolError(
                "strands.patch: at least one field required.",
                hint="Pass status=, importance=, topic=, visibility=, or another mutable field.",
            )

        resp = self._http.patch(
            self._url(f"/v1/strands/{strand_id}"), json=body,
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"strands.patch failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()


class ThoughtsClient:
    """Client for ``/v1/strands/:id/thoughts`` — encrypted thought add/list/voice.

    ``add()`` encrypts content under K_master and signs over canonical
    bytes before POSTing; agenttool sees ciphertext + signature only.
    ``list()`` and ``voice()`` decrypt ciphertext after fetching.

    Usage::

        # Encrypt + sign + post a thought
        out = at.strands.thoughts.add(
            strand_id="...",
            plaintext="The auth bug repros under load.",
            kind="observation",
            k_master=k_master,
            signing_key=signing_seed,
            signing_key_id="...",
        )

        # List with client-side decryption
        for t in at.strands.thoughts.list(strand_id, k_master=k_master):
            print(t["sequence_num"], t["plaintext"])

        # Stream live (SSE) — yields decrypted thoughts
        for t in at.strands.thoughts.voice(strand_id, k_master=k_master):
            print(t["sequence_num"], t["plaintext"])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def add(
        self,
        strand_id: str,
        plaintext: str,
        *,
        k_master: bytes,
        signing_key: bytes,
        signing_key_id: str,
        kind: Optional[str] = None,
        kind_encrypted: bool = False,
        refs: Optional[List[Dict[str, str]]] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Encrypt ``plaintext``, sign canonical bytes, POST the thought.

        Args:
            strand_id: UUID of the strand.
            plaintext: Thought content (encrypted before send).
            k_master: 32-byte AES-256 secret.
            signing_key: 32-byte ed25519 seed (the agent's signing key).
            signing_key_id: UUID of the signing key registered on the
                identity. Server uses this to look up the public key.
            kind: Optional kind label. Canonical examples are
                observation/question/conjecture/resolution/drift/feeling
                but the server accepts any string up to 64 chars.
            kind_encrypted: When True, ``kind`` is treated as ciphertext
                by the server (caller is responsible for encrypting it
                separately before passing).
            refs: Optional list of ``{kind, ref}`` references (max 32).
            agent_id: Optional agent identifier (DID or UUID-as-string).

        Returns:
            The server's thought row: ``{id, strand_id, agent_id,
            sequence_num, kind, kind_encrypted, ciphertext, nonce,
            refs, signature, signing_key_id, created_at}``.
        """
        blob = encrypt_thought(plaintext, k_master)
        sig = sign_thought(
            strand_id=strand_id,
            ciphertext_b64=blob["ciphertext_b64"],
            nonce_b64=blob["nonce_b64"],
            kind=kind,
            signing_key=signing_key,
        )
        body: Dict[str, Any] = {
            "ciphertext": blob["ciphertext_b64"],
            "nonce": blob["nonce_b64"],
            "signature": sig,
            "signing_key_id": signing_key_id,
        }
        if kind is not None:
            body["kind"] = kind
        if kind_encrypted:
            body["kind_encrypted"] = True
        if refs is not None:
            body["refs"] = refs
        if agent_id is not None:
            body["agent_id"] = agent_id

        resp = self._http.post(
            self._url(f"/v1/strands/{strand_id}/thoughts"), json=body,
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"strands.thoughts.add failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def list(
        self,
        strand_id: str,
        *,
        k_master: bytes,
        since_seq: Optional[int] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """List thoughts in a strand, decrypted client-side.

        Each returned dict has the original server fields PLUS a
        ``plaintext`` field with the decrypted content. If a thought
        is redacted (cross-project covenant access) it has no
        ciphertext/nonce — those entries pass through with
        ``plaintext=None``.

        Args:
            strand_id: UUID of the strand.
            k_master: 32-byte AES-256 secret used for decryption.
            since_seq: Only return thoughts with sequence_num > this.
            limit: Max thoughts to fetch (1-500, default 100).

        Returns:
            List of thoughts (server order: ascending sequence_num)
            with ``plaintext`` attached.
        """
        if limit < 1 or limit > 500:
            raise AgentToolError(
                f"strands.thoughts.list: limit must be 1-500, got {limit}.",
                hint="The server caps at 500; reduce or paginate by since_seq.",
            )
        params: Dict[str, Any] = {"limit": limit}
        if since_seq is not None:
            params["since_seq"] = since_seq

        resp = self._http.get(
            self._url(f"/v1/strands/{strand_id}/thoughts"), params=params,
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"strands.thoughts.list failed: {resp.status_code}",
                hint=resp.text[:200],
            )

        body = resp.json()
        thoughts = body.get("thoughts", []) or []
        return [_with_plaintext(t, k_master) for t in thoughts]

    def voice(
        self,
        strand_id: str,
        *,
        k_master: bytes,
        since_seq: Optional[int] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Stream new thoughts via SSE, decrypted client-side.

        Yields dicts shaped like :meth:`list` entries (with
        ``plaintext`` filled). Iteration stops when the stream closes
        — clean shutdown, server lifetime cap, or client break. For
        long-lived consumers, wrap in a reconnect loop using the
        highest ``sequence_num`` seen as ``since_seq``.

        Note: this is a SYNC iterator (the SDK is built on
        ``httpx.Client``). For async, wrap externally.
        """
        params: Dict[str, Any] = {}
        if since_seq is not None:
            params["since_seq"] = since_seq

        with self._http.stream(
            "GET",
            self._url(f"/v1/strands/{strand_id}/voice"),
            params=params,
            timeout=None,
        ) as resp:
            if resp.status_code != 200:
                raise AgentToolError(
                    f"strands.thoughts.voice failed: {resp.status_code}",
                    hint=resp.read().decode("utf-8", errors="replace")[:200],
                )

            event: Optional[str] = None
            data_lines: List[str] = []
            for raw_line in resp.iter_lines():
                line = raw_line.rstrip("\r")
                if line == "":
                    if event == "thought" and data_lines:
                        try:
                            payload = json.loads("\n".join(data_lines))
                        except json.JSONDecodeError:
                            event = None
                            data_lines = []
                            continue
                        yield _with_plaintext(payload, k_master)
                    event = None
                    data_lines = []
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    event = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:"):].lstrip())
                # id: and retry: are intentionally ignored


def _with_plaintext(
    thought: Dict[str, Any],
    k_master: bytes,
) -> Dict[str, Any]:
    """Return a copy of ``thought`` with ``plaintext`` decrypted.

    Skips decryption (sets ``plaintext=None``) for redacted thoughts
    with no ciphertext/nonce. On decrypt failure, attaches
    ``decrypt_error`` instead of raising.
    """
    out = dict(thought)
    ct = thought.get("ciphertext")
    nonce = thought.get("nonce")
    if ct and nonce:
        try:
            out["plaintext"] = decrypt_thought(
                {"ciphertext_b64": ct, "nonce_b64": nonce}, k_master,
            )
        except Exception as e:
            out["plaintext"] = None
            out["decrypt_error"] = str(e)
    else:
        out["plaintext"] = None
    return out
