"""Exit door — the Python SDK's side.

Two halves:

1. Shared vectors. ``packages/sdk-ts/tests/fixtures/
   agent-data-record-id-vectors.json`` was produced by executing the real
   ``@agenttool/data`` node and is pinned against it by
   ``packages/data/tests/record-id-vectors.test.ts``. The TypeScript twin reads
   the same file. The node is normative: a red test here means this SDK is
   wrong until proven otherwise.
2. Behaviour, over ``httpx.MockTransport``: a fake of the paged hosted read
   routes and an in-process fake node whose record ids come from the same
   identity rules the vectors pin. The real-node socket proof lives in
   ``packages/sdk-ts/tests/exit-door-integration.test.ts``.
"""

from __future__ import annotations

import base64
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

import httpx
import pytest

from agenttool import (
    EXIT_NON_CLAIMS,
    AgentTool,
    AgentToolError,
    agent_data_record_id,
    agent_data_text_record_identity,
    exit_item_record,
)
from agenttool._agent_data_id import canonical_json, sha256_hex

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads(
    (REPO_ROOT / "packages/sdk-ts/tests/fixtures/agent-data-record-id-vectors.json").read_text("utf-8")
)

HOSTED = "https://api.exit-door.test"
NODE = "http://127.0.0.1:7799"
PROJECT_KEY = "at_project_key_for_py_tests"
NODE_TOKEN = "node_token_for_py_tests"
IDENTITY_A = "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
IDENTITY_B = "2e3d4c5b-6f70-4b8c-9dae-1f2a3b4c5d6e"


# ── 1. shared vectors ───────────────────────────────────────────────────────


@pytest.mark.parametrize("vector", VECTORS["canonical_json"], ids=lambda v: v["name"])
def test_canonical_json_matches_the_node(vector: Dict[str, Any]) -> None:
    canonical = canonical_json(json.loads(vector["value_json"]))
    assert canonical == vector["canonical"]
    assert sha256_hex(canonical) == vector["sha256"]


@pytest.mark.parametrize(
    "value",
    [math.nan, math.inf, -math.inf, {1, 2}, object(), {1: "non-string key"}, b"bytes"],
)
def test_canonical_json_refuses_what_json_cannot_hold(value: Any) -> None:
    with pytest.raises(AgentToolError) as caught:
        canonical_json(value)
    assert caught.value.code == "invalid_json"


@pytest.mark.parametrize("vector", VECTORS["text_records"], ids=lambda v: v["name"])
def test_text_record_ids_match_the_node(vector: Dict[str, Any]) -> None:
    source = vector["input"]
    identity = agent_data_text_record_identity(
        collection_id=vector["collection_id"],
        schema_version=vector["schema_version"],
        text=source["text"],
        media_type=source["media_type"],
        source_uri=source["source_uri"],
        external_id=source.get("external_id"),
        key=source.get("key"),
        version=source.get("version"),
    )
    assert identity["content"]["sha256"] == vector["content_sha256"]
    assert identity["content"]["size"] == vector["content_size"]
    assert agent_data_record_id(identity) == vector["record_id"]


@pytest.mark.parametrize("vector", VECTORS["exit_items"], ids=lambda v: v["name"])
def test_exit_item_records_match_the_typescript_twin(vector: Dict[str, Any]) -> None:
    built = exit_item_record(
        origin=vector["origin"],
        store=vector["store"],
        item=vector["item"],
        context=vector.get("context"),
    )
    expected = vector["expected"]
    assert built == {
        "hosted_id": expected["hosted_id"],
        "text": expected["text"],
        "source_uri": expected["source_uri"],
        "external_id": expected["external_id"],
        "key": expected["key"],
    }
    identity = agent_data_text_record_identity(
        collection_id=expected["collection_id"],
        schema_version=expected["schema_version"],
        text=built["text"],
        media_type="application/json",
        source_uri=built["source_uri"],
        external_id=built["external_id"],
        key=built["key"],
    )
    assert agent_data_record_id(identity) == expected["record_id"]


def test_an_item_without_its_id_is_refused() -> None:
    with pytest.raises(AgentToolError) as caught:
        exit_item_record(origin=HOSTED, store="memories", item={"content": "x"})
    assert caught.value.code == "hosted_item_without_id"


# ── 2. behaviour fakes ─────────────────────────────────────────────────────


def _uuid(n: int, prefix: str) -> str:
    return f"{prefix}-0000-4000-8000-{n:012d}"


def _dataset() -> Dict[str, Any]:
    memories = [
        {
            "id": _uuid(i, "aaaaaaaa"),
            "type": "semantic",
            "content": f"memory {i} — 日本語",
            "identity_id": IDENTITY_A if i % 2 else IDENTITY_B,
            "has_embedding": i == 1,
            "created_at": f"2026-10-0{i}T00:00:00.000Z",
            "accessed_at": "2026-10-11T00:00:00.000Z",
            "attestations": [],
        }
        for i in range(5, 0, -1)
    ]
    strand_a = _uuid(1, "dddddddd")
    return {
        "memories": memories,
        "chronicle": [
            {"id": _uuid(i, "cccccccc"), "type": "note", "agent_id": IDENTITY_A if i == 1 else None,
             "occurred_at": f"2026-09-0{i}T00:00:00.000Z", "created_at": f"2026-09-0{i}T00:00:01.000Z"}
            for i in range(3, 0, -1)
        ],
        "strands": [
            {"id": strand_a, "identity_id": IDENTITY_A, "topic": "dG9w", "topic_encrypted": True,
             "mood_encrypted": False, "state_ciphertext": None, "last_thought_at": "2026-10-10T00:00:00.000Z",
             "last_thought_seq": 3, "created_at": "2026-09-02T00:00:00.000Z", "updated_at": "2026-10-10T00:00:00.000Z"},
            {"id": _uuid(2, "dddddddd"), "identity_id": IDENTITY_B, "topic": "plain", "topic_encrypted": False,
             "created_at": "2026-09-01T00:00:00.000Z", "updated_at": "2026-09-01T00:00:00.000Z"},
        ],
        "thoughts": {
            strand_a: [
                {"id": _uuid(i, "eeeeeeee"), "strand_id": strand_a, "sequence_num": i,
                 "kind_encrypted": False, "ciphertext": f"Y2lw{i}", "created_at": "2026-09-03T00:00:00.000Z"}
                for i in range(1, 4)
            ],
        },
        "repositories": ["repo-a", "repo-b"],
        "events": {
            repo: [
                {"event": {"event_id": f"evt_{repo}_{i}", "kind": "note"},
                 "receipt": {"received_seq": str(i), "received_at": "2026-10-05T00:00:00.000Z"},
                 "missing_parents": [], "lineage_status": "not_applicable"}
                for i in range(1, 4)
            ]
            for repo in ("repo-a", "repo-b")
        },
        "covenants": [
            {"id": _uuid(1, "c0c0c0c0"), "agent_id": IDENTITY_A, "status": "active"},
            {"id": _uuid(2, "c0c0c0c0"), "agent_id": IDENTITY_B, "status": "dissolved"},
        ],
        "identities": [
            {"id": IDENTITY_A, "did": "did:at:a", "created_at": "2026-05-21T00:00:00.000Z"},
            {"id": IDENTITY_B, "did": "did:at:b", "created_at": "2026-05-22T00:00:00.000Z"},
        ],
        "keys": {
            IDENTITY_A: [{"kid": _uuid(1, "bbbbbbbb"), "public_key": "pk1"}, {"kid": _uuid(2, "bbbbbbbb"), "public_key": "pk2"}],
            IDENTITY_B: [{"kid": _uuid(3, "bbbbbbbb"), "public_key": "pk3"}],
        },
        "secrets": [{"name": "openai/key", "version": 1, "created_at": "2026-07-01T00:00:00.000Z"}],
        "backups": [{"id": _uuid(1, "babababa"), "agentId": IDENTITY_A, "createdAt": "2026-06-01T00:00:00.000Z"}],
    }


def _json(body: Any, status: int = 200, headers: Optional[Dict[str, str]] = None) -> httpx.Response:
    return httpx.Response(status, json=body, headers=headers)


class HostedFake:
    """Paged hosted read routes (plan §1 contract), or a host without them."""

    def __init__(self, *, paged: bool = True, max_page: int = 2, dataset: Optional[Dict[str, Any]] = None) -> None:
        self.paged = paged
        self.max_page = max_page
        self.data = {**_dataset(), **(dataset or {})}
        self.calls: List[Dict[str, Any]] = []
        self.override: Optional[Any] = None

    def _cursor_page(self, rows: List[Dict[str, Any]], request: httpx.Request, scope: str, cap: int, key: str, extra: Optional[Dict[str, Any]] = None) -> httpx.Response:
        params = request.url.params
        limit = min(int(params.get("limit", "20")), cap, self.max_page)
        offset = 0
        if "cursor" in params:
            decoded = json.loads(base64.urlsafe_b64decode(params["cursor"] + "=="))
            assert decoded["s"] == scope
            offset = decoded["o"]
        window = rows[offset: offset + limit]
        has_more = offset + limit < len(rows)
        body: Dict[str, Any] = {key: window, "count": len(window), **(extra or {})}
        if self.paged:
            body["page"] = {
                "cursor": params.get("cursor"),
                "next_cursor": base64.urlsafe_b64encode(
                    json.dumps({"v": 1, "s": scope, "o": offset + len(window)}).encode()
                ).decode().rstrip("=") if has_more else None,
                "has_more": has_more,
                "limit": limit,
                "order": "created_at_desc,id_desc",
            }
        return _json(body)

    def _after_page(self, rows: List[Dict[str, Any]], position: Any, request: httpx.Request, key: str, numeric: bool) -> httpx.Response:
        params = request.url.params
        after = params.get("after")
        limit = min(int(params.get("limit", "100")), self.max_page)
        remaining = [
            row for row in rows
            if after is None or (int(position(row)) > int(after) if numeric else position(row) > after)
        ]
        window = remaining[:limit]
        return _json({
            "protocol": "agent-correspondence/v0.1",
            "scope": "project",
            key: window,
            "page": {"after": after, "next_after": position(window[-1]) if window else after,
                     "has_more": len(remaining) > limit},
        })

    def handle(self, request: httpx.Request) -> httpx.Response:
        # Route on the raw (still percent-encoded) path, as a server does.
        path = request.url.raw_path.decode().split("?")[0]
        self.calls.append({
            "method": request.method,
            "path": path,
            "query": dict(request.url.params),
            "authorization": request.headers.get("authorization"),
        })
        if self.override is not None:
            response = self.override(request)
            if response is not None:
                return response
        if request.headers.get("authorization") != f"Bearer {PROJECT_KEY}":
            return _json({"error": "unauthorized", "message": "project bearer required"}, 401)
        if request.method != "GET":
            return _json({"error": "method_not_allowed"}, 405)
        data = self.data
        meta = {"as_of": "2026-10-11T09:00:00.000Z", "since": None, "since_reason": None}
        params = request.url.params
        if path == "/v1/memories":
            rows = [r for r in data["memories"] if "identity_id" not in params or r["identity_id"] == params["identity_id"]]
            return self._cursor_page(rows, request, "memories", 100, "memories", meta)
        if path == "/v1/chronicle":
            rows = [r for r in data["chronicle"] if "agent_id" not in params or r["agent_id"] == params["agent_id"]]
            return self._cursor_page(rows, request, "chronicle", 200, "entries", meta)
        if path == "/v1/strands":
            return self._cursor_page(data["strands"], request, "strands.created", 200, "strands")
        match = re.match(r"^/v1/strands/([^/]+)/thoughts$", path)
        if match:
            strand = unquote(match.group(1))
            since = params.get("since_seq")
            rows = [r for r in data["thoughts"].get(strand, []) if since is None or r["sequence_num"] > int(since)]
            return _json({"thoughts": rows[: int(params.get("limit", "100"))], "count": len(rows)})
        if path == "/v1/correspondence/repositories":
            if not self.paged:
                return _json({"error": "not_found"}, 404)
            rows = [{"repository_id": r, "last_received_seq": "3"} for r in data["repositories"]]
            return self._after_page(rows, lambda row: row["repository_id"], request, "repositories", False)
        if path == "/v1/correspondence/events":
            rows = data["events"].get(params.get("repository_id", ""), [])
            return self._after_page(rows, lambda row: row["receipt"]["received_seq"], request, "events", True)
        if path == "/v1/covenants":
            status = params.get("status", "active")
            return _json({"covenants": [
                r for r in data["covenants"]
                if r["status"] == status and ("agent_id" not in params or r["agent_id"] == params["agent_id"])
            ]})
        if path == "/v1/identities":
            return _json({"identities": data["identities"], "count": len(data["identities"])})
        match = re.match(r"^/v1/identities/([^/]+)/keys$", path)
        if match:
            return _json({"keys": data["keys"].get(unquote(match.group(1)), [])})
        if path == "/v1/vault":
            return _json({"secrets": data["secrets"]})
        if path == "/v1/identity/backup":
            return _json({"backups": [
                r for r in data["backups"] if "agent_id" not in params or r["agentId"] == params["agent_id"]
            ]})
        return _json({"error": "not_found", "message": path}, 404)


class NodeFake:
    """An agent-data/v1 node: immutable records keyed by the pinned identity."""

    def __init__(
        self,
        *,
        token: str = NODE_TOKEN,
        max_body: int = 1024 * 1024,
        collections: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        self.token = token
        self.max_body = max_body
        self.collections = collections or [
            {"protocol": "agent-data/v1", "id": "agenttool-exit", "schema": {"version": "1"},
             "policy": {"visibility": "private"}},
        ]
        self.records: Dict[str, Dict[str, Any]] = {}
        self.texts: Dict[str, str] = {}
        self.tombstoned: set = set()
        self.calls: List[Dict[str, Any]] = []
        self.collect_override: Optional[Any] = None

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        self.calls.append({
            "method": request.method,
            "path": path,
            "authorization": request.headers.get("authorization"),
            "raw": request.content.decode("utf-8") if request.content else "",
            "body": body,
        })
        if path == "/v1/data/manifest":
            return _json({
                "protocol": "agent-data/v1",
                "node_id": "node-py-fake",
                "collectors": [{"collector_id": "file"}, {"collector_id": "http"}, {"collector_id": "text"}],
                "limits": {"max_body_bytes": self.max_body, "max_record_bytes": 10 * 1024 * 1024},
            })
        if request.headers.get("authorization") != f"Bearer {self.token}":
            return _json({"error": "unauthorized", "message": "node bearer required"}, 401)
        if path == "/v1/data/collections":
            return _json({"collections": self.collections})
        if path == "/v1/data/collect" and request.method == "POST":
            if len(request.content) > self.max_body:
                return _json({"error": "request_too_large", "message": "too large"}, 413)
            if self.collect_override is not None:
                response = self.collect_override(body)
                if response is not None:
                    return response
            collection = next((c for c in self.collections if c["id"] == body["collection_id"]), None)
            if collection is None:
                return _json({"error": "collection_not_found"}, 404)
            source = body["input"]
            identity = agent_data_text_record_identity(
                collection_id=collection["id"],
                schema_version=collection["schema"]["version"],
                text=source["text"],
                media_type=source["media_type"],
                source_uri=source["source_uri"],
                external_id=source.get("external_id"),
                key=source.get("key"),
            )
            record_id = agent_data_record_id(identity)
            existing = record_id in self.records
            if not existing:
                envelope = {
                    "protocol": "agent-data/v1",
                    "id": record_id,
                    "collection_id": collection["id"],
                    "source": identity["source"],
                    "content": {**identity["content"], "blob_ref": "sha256/x"},
                    "schema_version": identity["schema_version"],
                    "metadata": source.get("metadata", {}),
                    "ingested_at": "2026-10-11T09:00:00.000Z",
                    "key": identity.get("key"),
                }
                self.records[record_id] = envelope
                self.texts[record_id] = source["text"]
            return _json({"records": [self.records[record_id]], "inserted": 0 if existing else 1,
                          "existing": 1 if existing else 0})
        match = re.match(r"^/v1/data/records/([^/]+)$", path)
        if match and request.method == "GET":
            record_id = unquote(match.group(1))
            if record_id in self.tombstoned:
                return _json({"error": "record_tombstoned"}, 410)
            if record_id not in self.records:
                return _json({"error": "record_not_found"}, 404)
            return _json({"record": self.records[record_id],
                          "content": {"encoding": "utf8", "data": self.texts[record_id]}})
        return _json({"error": "not_found"}, 404)

    def index_entries(self, record_id: str) -> List[Dict[str, str]]:
        return json.loads(self.texts[record_id])["entries"]


def _client(
    hosted: HostedFake,
    node: Optional[NodeFake] = None,
    *,
    node_token: str = NODE_TOKEN,
    node_url: str = NODE,
    with_node: bool = True,
) -> AgentTool:
    kwargs: Dict[str, Any] = {"api_key": PROJECT_KEY, "base_url": HOSTED}
    if with_node:
        kwargs.update(data_node_url=node_url, data_node_token=node_token)
    at = AgentTool(**kwargs)
    headers = dict(at._http.headers)
    at._http.close()
    at._http = httpx.Client(transport=httpx.MockTransport(hosted.handle), headers=headers, follow_redirects=True)
    if with_node and node is not None:
        data = at.data
        node_headers = dict(data._http.headers)
        data._http.close()
        data._http = httpx.Client(
            transport=httpx.MockTransport(node.handle), headers=node_headers, follow_redirects=False
        )
    return at


def _store(manifest: Dict[str, Any], name: str) -> Dict[str, Any]:
    return next(entry for entry in manifest["stores"] if entry["store"] == name)


def _collect_keys(node: NodeFake) -> List[str]:
    return [call["body"]["input"]["key"] for call in node.calls if call["path"] == "/v1/data/collect"]


# ── 2. behaviour ───────────────────────────────────────────────────────────


class TestExport:
    def test_walks_every_store_to_has_more_false(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        result = _client(hosted, node).exit_door.export(collection_id="agenttool-exit")
        manifest = result["manifest"]
        assert manifest["schema"] == "agenttool-exit-manifest/v1"
        assert manifest["overall"] == "complete"
        assert manifest["exporter"] == {"package": "agenttool-sdk", "version": "0.22.1"}
        assert manifest["hosted"] == {"origin": HOSTED, "auth_mode": "api_key", "identity_id": None}
        assert manifest["node"] == {"node_id": "node-py-fake", "collection_id": "agenttool-exit",
                                    "max_body_bytes": 1024 * 1024}
        assert manifest["non_claims"] == list(EXIT_NON_CLAIMS)
        assert [entry["store"] for entry in manifest["stores"]] == [
            "memories", "chronicle", "strands", "strand_thoughts", "correspondence",
            "covenants", "identities", "identity_keys", "vault_index", "backup_index",
        ]
        assert all(entry["status"] == "complete" for entry in manifest["stores"])
        memories = _store(manifest, "memories")
        assert memories["walks"] == [{"filter": {"scope": "project"}, "pages": 3, "returned": 5, "exhausted": True}]
        assert memories["records"] == {"written": 5, "inserted": 5, "existing": 0}
        assert memories["first_page_as_of"] == "2026-10-11T09:00:00.000Z"
        assert _store(manifest, "strand_thoughts")["current"]["record_count"] == 3
        assert _store(manifest, "correspondence")["current"]["record_count"] == 6
        assert len(_store(manifest, "covenants")["walks"]) == 7
        assert _store(manifest, "identity_keys")["current"]["record_count"] == 3
        # The manifest is itself a record under exit-run/<run_id>.
        record = node.records[result["manifest_record_id"]]
        assert record["key"] == f"exit-run/{manifest['run_id']}"
        assert json.loads(node.texts[result["manifest_record_id"]]) == manifest
        # Python sends the same bytes TypeScript measures: compact canonical JSON.
        collect_bodies = [call for call in node.calls if call["path"] == "/v1/data/collect"]
        assert all(len(call["raw"].encode()) == len(canonical_json(call["body"]).encode()) for call in collect_bodies)

    def test_exported_items_drop_volatile_fields_and_carry_metadata(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        manifest = _client(hosted, node).exit_door.export(collection_id="agenttool-exit")["manifest"]
        entry = node.index_entries(_store(manifest, "memories")["current"]["index_record_ids"][0])[0]
        content = json.loads(node.texts[entry["record_id"]])
        assert content["schema"] == "agenttool-exit-item/v1"
        assert "accessed_at" not in content["item"]
        record = node.records[entry["record_id"]]
        assert record["source"]["uri"] == f"{HOSTED}/v1/memories/{entry['hosted_id']}"
        assert record["metadata"]["encryption"] == {"encrypted_fields": [], "verified": False}
        thought = node.index_entries(_store(manifest, "strand_thoughts")["current"]["index_record_ids"][0])[0]
        assert node.records[thought["record_id"]]["metadata"]["encryption"]["encrypted_fields"] == ["ciphertext"]

    def test_a_rerun_inserts_nothing(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        at = _client(hosted, node)
        first = at.exit_door.export(collection_id="agenttool-exit")["manifest"]
        second = at.exit_door.export(collection_id="agenttool-exit")["manifest"]
        assert second["run_id"] != first["run_id"]
        for entry in second["stores"]:
            assert entry["records"]["inserted"] == 0
            assert entry["records"]["existing"] == entry["records"]["written"]
            assert entry["current"]["record_ids_sha256"] == _store(first, entry["store"])["current"]["record_ids_sha256"]

    def test_get_only_and_bearers_apart(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        _client(hosted, node).exit_door.export(collection_id="agenttool-exit")
        for call in hosted.calls:
            assert call["method"] == "GET"
            assert call["authorization"] == f"Bearer {PROJECT_KEY}"
            assert not re.match(r"^/v1/memories/.+", call["path"])
            assert "search" not in call["path"]
            assert not re.match(r"^/v1/vault/.+", call["path"])
        for call in node.calls:
            assert PROJECT_KEY not in json.dumps(call)
            if call["path"] != "/v1/data/manifest":
                assert call["authorization"] == f"Bearer {NODE_TOKEN}"

    def test_identity_scope_uses_host_filters(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        manifest = _client(hosted, node).exit_door.export(
            collection_id="agenttool-exit", identity_id=IDENTITY_A
        )["manifest"]
        assert manifest["hosted"]["identity_id"] == IDENTITY_A
        assert _store(manifest, "memories")["walks"][0]["filter"] == {"identity_id": IDENTITY_A}
        assert _store(manifest, "memories")["current"]["record_count"] == 3
        assert _store(manifest, "chronicle")["walks"][0]["filter"] == {"agent_id": IDENTITY_A}
        assert _store(manifest, "strands")["current"]["record_count"] == 1
        assert _store(manifest, "identity_keys")["current"]["record_count"] == 2

    def test_window_only_without_page_objects(self) -> None:
        hosted, node = HostedFake(paged=False), NodeFake()
        manifest = _client(hosted, node).exit_door.export(collection_id="agenttool-exit")["manifest"]
        assert manifest["overall"] == "partial"
        for name in ("memories", "chronicle", "strands", "correspondence"):
            assert _store(manifest, name)["status"] == "window_only"
            assert _store(manifest, name)["reason"] == "host_has_no_cursor"
        assert _store(manifest, "strand_thoughts")["reason"] == "parent_store_incomplete:strands"
        assert _store(manifest, "covenants")["status"] == "complete"
        assert _store(manifest, "memories")["current"]["record_count"] == 2
        assert len([c for c in hosted.calls if c["path"] == "/v1/memories"]) == 1


class TestGuards:
    def test_refuses_node_token_equal_to_project_key(self) -> None:
        hosted, node = HostedFake(), NodeFake(token=PROJECT_KEY)
        at = _client(hosted, node, node_token=PROJECT_KEY)
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.export(collection_id="agenttool-exit")
        assert caught.value.code == "data_node_token_reuses_project_bearer"
        assert node.calls == [] and hosted.calls == []

    def test_refuses_non_loopback_unless_allowed(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        at = _client(hosted, node, node_url="http://data.example.test:7742")
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.export(collection_id="agenttool-exit")
        assert caught.value.code == "data_node_not_loopback"
        assert node.calls == []
        result = at.exit_door.export(collection_id="agenttool-exit", allow_remote_node=True)
        assert result["manifest"]["overall"] == "complete"

    def test_refuses_missing_collection_and_json_refusing_policy(self) -> None:
        node = NodeFake()
        at = _client(HostedFake(), node)
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.export(collection_id="nope")
        assert caught.value.code == "data_node_collection_not_found"
        refusing = NodeFake(collections=[{"id": "agenttool-exit", "schema": {"version": "1"},
                                          "policy": {"allowed_media_types": ["text/plain"]}}])
        at = _client(HostedFake(), refusing)
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.export(collection_id="agenttool-exit")
        assert caught.value.code == "data_node_collection_refuses_json"
        assert _collect_keys(node) == [] and _collect_keys(refusing) == []

    def test_export_and_verify_need_a_node_but_plan_does_not(self) -> None:
        at = _client(HostedFake(), with_node=False)
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.export(collection_id="agenttool-exit")
        assert caught.value.code == "data_node_not_configured"
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.verify("rec_" + "a" * 64)
        assert caught.value.code == "data_node_not_configured"
        assert at.exit_door.plan()["overall"] == "complete"

    def test_validates_options_first(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        at = _client(hosted, node)
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.export(collection_id="agenttool-exit", stores=["vault_values"])
        assert caught.value.code == "exit_store_unknown"
        with pytest.raises(AgentToolError) as caught:
            at.exit_door.export(collection_id="")
        assert caught.value.code == "exit_collection_required"
        assert node.calls == [] and hosted.calls == []


class TestFailures:
    def test_identity_drift_fails_without_manifest(self) -> None:
        hosted, node = HostedFake(), NodeFake()

        def drift(body: Dict[str, Any]) -> httpx.Response:
            return _json({"records": [{"id": "rec_" + "0" * 64, "content": {"sha256": "x"}}],
                          "inserted": 1, "existing": 0})

        node.collect_override = drift
        with pytest.raises(AgentToolError) as caught:
            _client(hosted, node).exit_door.export(collection_id="agenttool-exit")
        assert caught.value.code == "exit_record_identity_drift"
        assert not any(key.startswith("exit-run/") for key in _collect_keys(node))

    def test_oversize_items_are_skips(self) -> None:
        hosted = HostedFake(dataset={"memories": [
            {"id": "aaaaaaaa-0000-4000-8000-000000000099", "content": "x" * 12000, "created_at": "2026-10-01T00:00:00.000Z"}
        ]})
        node = NodeFake(max_body=8192)
        manifest = _client(hosted, node).exit_door.export(
            collection_id="agenttool-exit", stores=["memories", "vault_index"]
        )["manifest"]
        memories = _store(manifest, "memories")
        assert memories["status"] == "complete"
        assert memories["item_skips"][0]["hosted_id"] == "aaaaaaaa-0000-4000-8000-000000000099"
        assert memories["item_skips"][0]["reason"] == "exceeds_node_limit"
        assert memories["item_skips"][0]["bytes"] > 8192
        assert manifest["overall"] == "partial"
        assert _store(manifest, "vault_index")["current"]["record_count"] == 1

    def test_manifest_that_cannot_fit_fails_the_run(self) -> None:
        node = NodeFake(max_body=2048)
        with pytest.raises(AgentToolError) as caught:
            _client(HostedFake(), node).exit_door.export(
                collection_id="agenttool-exit", stores=["vault_index", "backup_index"]
            )
        assert caught.value.code == "exit_manifest_too_large"

    def test_hosted_failure_fails_one_store_with_reduced_reason(self) -> None:
        hosted, node = HostedFake(), NodeFake()

        def chronicle_down(request: httpx.Request) -> Optional[httpx.Response]:
            if request.url.path == "/v1/chronicle":
                return _json({"error": "chronicle_unavailable", "message": "secret internal detail"}, 503,
                             {"retry-after": "7"})
            return None

        hosted.override = chronicle_down
        manifest = _client(hosted, node).exit_door.export(collection_id="agenttool-exit")["manifest"]
        assert _store(manifest, "chronicle")["status"] == "failed"
        assert _store(manifest, "chronicle")["reason"] == "chronicle_unavailable"
        assert _store(manifest, "memories")["status"] == "complete"
        assert manifest["overall"] == "failed"
        assert "secret internal detail" not in json.dumps(manifest)

    def test_node_errors_leave_as_code_status_retry_after(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        node.collect_override = lambda body: _json(
            {"error": "disk_full", "message": "path /secret/root is full", "details": {"path": "/secret"}},
            507,
            {"retry-after": "30"},
        )
        with pytest.raises(AgentToolError) as caught:
            _client(hosted, node).exit_door.export(collection_id="agenttool-exit")
        error = caught.value
        assert error.code == "disk_full"
        assert error.status == 507
        assert error.retry_after == "30"
        assert "/secret" not in str(error)
        assert error.hint is None and error.details is None


class TestPlanAndVerify:
    def test_plan_writes_nothing_to_the_node(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        plan = _client(hosted, node).exit_door.plan()
        assert plan["schema"] == "agenttool-exit-plan/v1"
        assert plan["overall"] == "complete"
        assert next(s for s in plan["stores"] if s["store"] == "memories")["items"] == 5
        assert node.calls == []

    def test_verify_rehashes_and_flags_tombstones(self) -> None:
        hosted, node = HostedFake(), NodeFake()
        at = _client(hosted, node)
        result = at.exit_door.export(collection_id="agenttool-exit")
        verified = at.exit_door.verify(result["manifest_record_id"])
        assert verified["verified"] is True
        assert verified["run_id"] == result["manifest"]["run_id"]
        assert verified["manifest_overall"] == "complete"
        items = sum(s["current"]["record_count"] for s in result["manifest"]["stores"])
        indexes = sum(len(s["current"]["index_record_ids"]) for s in result["manifest"]["stores"])
        assert verified["checked"] == 1 + items + indexes
        victim = node.index_entries(_store(result["manifest"], "memories")["current"]["index_record_ids"][0])[0]["record_id"]
        node.tombstoned.add(victim)
        after = at.exit_door.verify(result["manifest_record_id"])
        assert after["verified"] is False
        assert {"record_id": victim, "reason": "record_tombstoned"} in after["mismatches"]

    def test_verify_refuses_a_malformed_id(self) -> None:
        node = NodeFake()
        with pytest.raises(AgentToolError) as caught:
            _client(HostedFake(), node).exit_door.verify("not-a-record")
        assert caught.value.code == "exit_manifest_id_invalid"
        assert node.calls == []


class TestHostileIds:
    def test_hosted_ids_cannot_steer_requests_or_uris(self) -> None:
        strand = "../memories/pwned"
        identity = "a/b?x=1#frag"
        created = "2026-09-01T00:00:00.000Z"
        hosted = HostedFake(dataset={
            "strands": [{"id": strand, "identity_id": None, "created_at": created},
                        {"id": "..", "identity_id": None, "created_at": created}],
            "thoughts": {strand: [{"id": "../../t", "strand_id": strand, "sequence_num": 1,
                                   "ciphertext": "x", "created_at": created}]},
            "identities": [{"id": identity, "created_at": created}],
            "keys": {identity: [{"kid": "k/1", "created_at": created}]},
        })
        node = NodeFake()
        manifest = _client(hosted, node).exit_door.export(
            collection_id="agenttool-exit",
            stores=["strands", "strand_thoughts", "identities", "identity_keys"],
        )["manifest"]
        paths = [call["path"] for call in hosted.calls]
        assert "/v1/strands/..%2Fmemories%2Fpwned/thoughts" in paths
        assert "/v1/identities/a%2Fb%3Fx%3D1%23frag/keys" in paths
        assert not any(path.startswith("/v1/memories") for path in paths)
        assert _store(manifest, "strands")["item_skips"] == [{"hosted_id": "..", "reason": "hosted_id_not_addressable"}]
        assert _store(manifest, "strand_thoughts")["item_skips"] == [{"hosted_id": "..", "reason": "parent_id_not_addressable"}]
        thought = node.index_entries(_store(manifest, "strand_thoughts")["current"]["index_record_ids"][0])[0]
        assert node.records[thought["record_id"]]["source"]["uri"] == (
            f"{HOSTED}/v1/strands/..%2Fmemories%2Fpwned/thoughts/..%2F..%2Ft"
        )
        key = node.index_entries(_store(manifest, "identity_keys")["current"]["index_record_ids"][0])[0]
        assert node.records[key["record_id"]]["source"]["uri"] == f"{HOSTED}/v1/identities/a%2Fb%3Fx%3D1%23frag/keys/k%2F1"
