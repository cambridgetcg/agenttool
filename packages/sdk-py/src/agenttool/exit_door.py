"""Exit door: copy the hosted continuity core into a local agent-data/v1 node.

Parity twin of ``packages/sdk-ts/src/exit-door.ts``; the two write byte-
identical records for the same hosted data (shared vectors:
``packages/sdk-ts/tests/fixtures/agent-data-record-id-vectors.json``).

Direction is one way: hosted → local copy. The exporter reads the hosted API
with the project client and writes into a separately configured
``@agenttool/data`` node through ``DataClient``. The two bearers never meet:
hosted reads go only to the hosted origin, node writes go only to the node,
and a node token equal to the project API key is refused.

What it never does:

- change hosted state (GET only; never ``GET /v1/memories/{id}``, which writes
  ``accessed_at``, and never search, which costs credits);
- decrypt, validate, or re-encrypt ciphertext;
- export vault secret values or identity backup blobs (index only — the
  custody decision is pending, and the manifest says so);
- tombstone, delete, or re-import anything. Re-import into hosted memory is a
  separate, explicit projection (AGENT-DATA-PROTOCOL §11).

Completeness is reported, not assumed. A store is ``complete`` only when its
walk reached the host's own end-of-walk signal. A host that returns no
``page`` object yields ``window_only`` with reason ``host_has_no_cursor``; the
exporter does not partition its way around a missing cursor.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from types import MappingProxyType
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Set, Tuple
from urllib.parse import urlsplit

import httpx

from ._agent_data_id import (
    _js_json_string,
    _utf16_sort_key,
    agent_data_record_id,
    agent_data_text_record_identity,
    canonical_json,
    sha256_hex,
    utf8_byte_length,
)
from ._url import _path_segment
from .data import DataClient
from .exceptions import AgentToolError, _error_from_response

EXIT_ITEM_SCHEMA = "agenttool-exit-item/v1"
EXIT_INDEX_SCHEMA = "agenttool-exit-index/v1"
EXIT_SKIPS_SCHEMA = "agenttool-exit-skips/v1"
EXIT_MANIFEST_SCHEMA = "agenttool-exit-manifest/v1"
EXIT_PLAN_SCHEMA = "agenttool-exit-plan/v1"
EXIT_VERIFY_SCHEMA = "agenttool-exit-verify/v1"

#: Hosted stores the v1 exporter can copy. Order is the walk order.
EXIT_STORES: Tuple[str, ...] = (
    "memories",
    "chronicle",
    "strands",
    "strand_thoughts",
    "correspondence",
    "covenants",
    "identities",
    "identity_keys",
    "vault_index",
    "backup_index",
)

#: Fields removed before an item is written: they change on read or on
#: unrelated activity and would otherwise mint a new record every run.
EXIT_VOLATILE_FIELDS: Mapping[str, Tuple[str, ...]] = MappingProxyType({
    "memories": ("accessed_at",),
    "chronicle": (),
    "strands": ("last_thought_at", "last_thought_seq", "updated_at"),
    "strand_thoughts": (),
    "correspondence": (),
    "covenants": (),
    "identities": (),
    "identity_keys": (),
    "vault_index": (),
    "backup_index": (),
})

#: What every exit manifest declares it is not.
EXIT_NON_CLAIMS: Tuple[str, ...] = (
    "copy only; hosted data unchanged",
    "not a snapshot (see walk semantics)",
    "exported memories are agent data, not memory (AGENT-DATA-PROTOCOL §11)",
    "signatures carried, not verified",
    "ciphertext not decrypted or validated",
    "vault secret values and identity backup blobs not exported: custody decision pending (index only)",
)

_MEDIA_TYPE = "application/json"
_COLLECTOR = "text"
_PROVENANCE_ACTIVITY = "agenttool-exit-door/v1 copy"
_COVENANT_STATUSES = (
    "proposed",
    "active",
    "paused",
    "dissolved",
    "rejected",
    "expired",
    "withdrawn",
)
_PAGE_LIMITS = {
    "memories": 100,
    "chronicle": 200,
    "strands": 200,
    "thoughts": 500,
    "repositories": 200,
    "events": 200,
}
#: Bytes reserved in a chunk's collect body for everything but its entries.
_CHUNK_BODY_RESERVE = 4096
#: Chunked lists written after the items: ``exit-<name>/<run>/<store>/<n>``.
_INDEX_CHUNKS = MappingProxyType({"name": "index", "schema": EXIT_INDEX_SCHEMA, "field": "entries"})
_SKIP_CHUNKS = MappingProxyType({"name": "skips", "schema": EXIT_SKIPS_SCHEMA, "field": "item_skips"})
_MAX_SAFE_INTEGER = 2**53 - 1
_DEFAULT_MAX_BODY = 1024 * 1024
_DEFAULT_MAX_RECORD = 10 * 1024 * 1024

ProgressCallback = Callable[[Dict[str, Any]], None]


class _ExitDoorError(AgentToolError):
    """The exporter's own decisions. They carry no server text."""


class _HostedReadError(AgentToolError):
    """Hosted read failures fail one store; they never abort the whole run."""


def _exit_error(code: str, message: str, *, hint: Optional[str] = None) -> _ExitDoorError:
    return _ExitDoorError(message, error_code=code, hint=hint)


def _hosted_error(code: str, message: str, status: Optional[int] = None) -> _HostedReadError:
    return _HostedReadError(message, error_code=code, status=status)


# ─── Item shaping (shared with the TypeScript twin through vectors) ─────────


def _obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _volatile(store: str) -> List[Dict[str, str]]:
    return [{"field": field, "reason": "volatile"} for field in EXIT_VOLATILE_FIELDS[store]]


def _route_thought(hosted_id: str, item: Dict[str, Any], context: Mapping[str, str]) -> str:
    strand_id = context.get("strand_id") or item.get("strand_id")
    if not isinstance(strand_id, str) or strand_id == "":
        raise _exit_error("exit_item_invalid", "A strand thought needs its strand id.")
    return f"/v1/strands/{_path_segment(strand_id)}/thoughts/{_path_segment(hosted_id)}"


def _route_key(hosted_id: str, _item: Dict[str, Any], context: Mapping[str, str]) -> str:
    identity_id = context.get("identity_id")
    if not isinstance(identity_id, str) or identity_id == "":
        raise _exit_error("exit_item_invalid", "An identity key needs its identity id.")
    return f"/v1/identities/{_path_segment(identity_id)}/keys/{_path_segment(hosted_id)}"


def _strand_encrypted(item: Dict[str, Any]) -> List[str]:
    fields = []
    if item.get("topic_encrypted") is True:
        fields.append("topic")
    if item.get("mood_encrypted") is True:
        fields.append("mood")
    if item.get("state_ciphertext") is not None:
        fields.append("state_ciphertext")
    return fields


def _simple(prefix: str) -> Callable[[str, Dict[str, Any], Mapping[str, str]], str]:
    return lambda hosted_id, _item, _context: f"{prefix}{_path_segment(hosted_id)}"


_NONE = lambda *_args: None  # noqa: E731
_NO_FIELDS: List[str] = []

_STORE_SPECS: Dict[str, Dict[str, Any]] = {
    "memories": {
        "hosted_id": lambda item: item.get("id"),
        "route": _simple("/v1/memories/"),
        "identity_id": lambda item, _ctx: item.get("identity_id"),
        "created_at": lambda item: item.get("created_at"),
        "encrypted": lambda item: [],
        "fields_not_exported": [
            {"field": "embedding", "reason": "hosted_returns_has_embedding_only"},
            *_volatile("memories"),
        ],
        "server_exclusions": ["expired memories"],
    },
    "chronicle": {
        "hosted_id": lambda item: item.get("id"),
        "route": _simple("/v1/chronicle/"),
        "identity_id": lambda item, _ctx: item.get("agent_id"),
        "created_at": lambda item: item.get("created_at"),
        "encrypted": lambda item: [],
        "fields_not_exported": [],
        "server_exclusions": [],
    },
    "strands": {
        "hosted_id": lambda item: item.get("id"),
        "route": _simple("/v1/strands/"),
        "identity_id": lambda item, _ctx: item.get("identity_id"),
        "created_at": lambda item: item.get("created_at"),
        "encrypted": _strand_encrypted,
        "fields_not_exported": _volatile("strands"),
        "server_exclusions": [],
    },
    "strand_thoughts": {
        "hosted_id": lambda item: item.get("id"),
        "route": _route_thought,
        "identity_id": lambda _item, ctx: ctx.get("identity_id"),
        "created_at": lambda item: item.get("created_at"),
        "encrypted": lambda item: ["ciphertext"] + (["kind"] if item.get("kind_encrypted") is True else []),
        "fields_not_exported": [],
        "server_exclusions": [],
    },
    "correspondence": {
        "hosted_id": lambda item: _obj(item.get("event")).get("event_id"),
        "route": _simple("/v1/correspondence/events/"),
        "identity_id": _NONE,
        "created_at": lambda item: _obj(item.get("receipt")).get("received_at"),
        "encrypted": lambda item: [],
        "fields_not_exported": [{"field": "claims", "reason": "derivable_from_events"}],
        "server_exclusions": [],
    },
    "covenants": {
        "hosted_id": lambda item: item.get("id"),
        "route": _simple("/v1/covenants/"),
        "identity_id": lambda item, _ctx: item.get("agent_id"),
        "created_at": lambda item: item.get("created_at"),
        "encrypted": lambda item: [],
        "fields_not_exported": [],
        "server_exclusions": [],
    },
    "identities": {
        "hosted_id": lambda item: item.get("id"),
        "route": _simple("/v1/identities/"),
        "identity_id": lambda item, _ctx: item.get("id"),
        "created_at": lambda item: item.get("created_at"),
        "encrypted": lambda item: [],
        "fields_not_exported": [],
        "server_exclusions": [],
    },
    "identity_keys": {
        "hosted_id": lambda item: item.get("kid"),
        "route": _route_key,
        "identity_id": lambda _item, ctx: ctx.get("identity_id"),
        "created_at": lambda item: item.get("created_at"),
        "encrypted": lambda item: [],
        "fields_not_exported": [],
        "server_exclusions": [],
    },
    "vault_index": {
        "hosted_id": lambda item: item.get("name"),
        "route": _simple("/v1/vault/"),
        "identity_id": _NONE,
        "created_at": lambda item: item.get("created_at"),
        "encrypted": lambda item: [],
        "fields_not_exported": [{"field": "value", "reason": "custody_decision_pending"}],
        "server_exclusions": ["soft-deleted vault secrets"],
    },
    "backup_index": {
        "hosted_id": lambda item: item.get("id"),
        "route": _simple("/v1/identity/backup/"),
        "identity_id": lambda item, _ctx: item["agent_id"] if item.get("agent_id") is not None else item.get("agentId"),
        "created_at": lambda item: item["created_at"] if item.get("created_at") is not None else item.get("createdAt"),
        "encrypted": lambda item: [],
        "fields_not_exported": [
            {"field": "blob_base64", "reason": "custody_decision_pending"},
            {"field": "nonce", "reason": "custody_decision_pending"},
        ],
        "server_exclusions": ["revoked backups"],
    },
}


def _is_addressable(hosted_id: str) -> bool:
    """A bare dot segment cannot be carried in a path by any encoding."""
    return hosted_id not in (".", "..")


def exit_item_record(
    *,
    origin: str,
    store: str,
    item: Mapping[str, Any],
    context: Optional[Mapping[str, str]] = None,
) -> Dict[str, str]:
    """The text-collector fields one hosted item becomes.

    Canonical JSON of ``{schema, origin, store, item}`` with the store's
    volatile fields removed, ``source_uri = <origin>/v1/<route>/<id>``,
    ``external_id = <hosted id>``, and ``key = <store>/<hosted id>``. No
    ``version`` or ``supersedes_id``: a changed hosted item becomes a new
    record under the same key, and the manifest names the current record.
    """
    spec = _STORE_SPECS.get(store)
    if spec is None:
        raise _exit_error("exit_store_unknown", f"Unknown exit store: {str(store)[:64]}.")
    if not isinstance(item, dict):
        raise _exit_error("exit_item_invalid", "A hosted item must be a JSON object.")
    hosted_id = spec["hosted_id"](item)
    if not isinstance(hosted_id, str) or hosted_id == "":
        raise _exit_error("hosted_item_without_id", "A hosted item carried no usable id.")
    if not _is_addressable(hosted_id):
        raise _exit_error("hosted_id_not_addressable", "A hosted id is a URL dot segment.")
    volatile = set(EXIT_VOLATILE_FIELDS[store])
    kept = {field: value for field, value in item.items() if field not in volatile}
    clean_origin = origin.rstrip("/")
    return {
        "hosted_id": hosted_id,
        "text": canonical_json(
            {"schema": EXIT_ITEM_SCHEMA, "origin": clean_origin, "store": store, "item": kept}
        ),
        "source_uri": clean_origin + spec["route"](hosted_id, item, dict(context or {})),
        "external_id": hosted_id,
        "key": f"{store}/{hosted_id}",
    }


# ─── Client ─────────────────────────────────────────────────────────────────


class _StoreRun:
    def __init__(self, store: str) -> None:
        self.store = store
        self.status = "complete"
        self.reason: Optional[str] = None
        self.first_page_as_of: Optional[str] = None
        self.walks: List[Dict[str, Any]] = []
        self.written = 0
        self.inserted = 0
        self.existing = 0
        self.items = 0
        self.bytes = 0
        self.largest = 0
        # key → {"hosted_id", "record_id"}, in first-seen order.
        self.current: Dict[str, Dict[str, str]] = {}
        self.item_skips: List[Dict[str, Any]] = []
        self.parents_visited = 0


class _NodeTarget:
    def __init__(
        self,
        data: DataClient,
        node_id: str,
        collection_id: str,
        schema_version: str,
        max_body_bytes: int,
        max_record_bytes: int,
    ) -> None:
        self.data = data
        self.node_id = node_id
        self.collection_id = collection_id
        self.schema_version = schema_version
        self.max_body_bytes = max_body_bytes
        self.max_record_bytes = max_record_bytes


Sink = Callable[[_StoreRun, Dict[str, Any], Dict[str, str]], None]


class ExitDoorClient:
    """Copy the hosted continuity core into a local agent-data/v1 node.

    Reached through ``at.exit_door``. ``plan()`` reads hosted data only;
    ``export()`` writes items, chunked index records, and one completeness
    manifest to an existing node collection; ``verify()`` re-reads and
    re-hashes every record a manifest names. Every error leaving this client
    is reduced to a stable ``code``, ``status``, and ``retry_after``.
    """

    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        *,
        sdk_package: str,
        sdk_version: str,
        auth_mode: str,
        project_key_digest: Optional[str],
        node_base_url: Optional[str],
        node_token_digest: Optional[str],
        data: Callable[[], DataClient],
    ) -> None:
        self._http = http
        self._base_url = base_url.rstrip("/")
        self._sdk_package = sdk_package
        self._sdk_version = sdk_version
        self._auth_mode = auth_mode
        self._project_key_digest = project_key_digest
        self._node_base_url = node_base_url
        self._node_token_digest = node_token_digest
        self._data = data

    def plan(
        self,
        *,
        stores: Optional[Sequence[str]] = None,
        identity_id: Optional[str] = None,
        on_progress: Optional[ProgressCallback] = None,
    ) -> Dict[str, Any]:
        """Walk the hosted stores and report what an export would copy."""
        try:
            return self._plan(stores, identity_id, on_progress)
        except BaseException as error:  # noqa: BLE001 — reduced, then re-raised
            raise _reduce(error) from None

    def export(
        self,
        *,
        collection_id: str,
        stores: Optional[Sequence[str]] = None,
        identity_id: Optional[str] = None,
        allow_remote_node: bool = False,
        on_progress: Optional[ProgressCallback] = None,
    ) -> Dict[str, Any]:
        """Copy the selected stores into ``collection_id`` and write a manifest.

        Every guard runs before the first write. If the run crashes, no
        manifest is written; re-running is safe because writes are idempotent.
        Returns ``{"manifest_record_id": ..., "manifest": {...}}``.
        """
        try:
            return self._export(collection_id, stores, identity_id, allow_remote_node, on_progress)
        except BaseException as error:  # noqa: BLE001 — reduced, then re-raised
            raise _reduce(error) from None

    def verify(
        self,
        manifest_record_id: str,
        *,
        allow_remote_node: bool = False,
    ) -> Dict[str, Any]:
        """Re-read every record a manifest names and re-hash it. Read-only."""
        try:
            return self._verify(manifest_record_id, allow_remote_node)
        except BaseException as error:  # noqa: BLE001 — reduced, then re-raised
            raise _reduce(error) from None

    # ── plan ──────────────────────────────────────────────────────────────

    def _plan(
        self,
        stores: Optional[Sequence[str]],
        identity_id: Optional[str],
        on_progress: Optional[ProgressCallback],
    ) -> Dict[str, Any]:
        selected = _select_stores(stores)
        identity = _optional_identity(identity_id)
        origin = self._base_url

        def sink(run: _StoreRun, item: Dict[str, Any], context: Dict[str, str]) -> None:
            try:
                record = exit_item_record(origin=origin, store=run.store, item=item, context=context)
            except Exception as error:  # noqa: BLE001 — one bad item is a skip, as in TS
                run.item_skips.append({"hosted_id": _hosted_id_of(run.store, item), "reason": _code_of(error)})
                return
            if record["key"] in run.current:
                return
            size = utf8_byte_length(record["text"])
            run.current[record["key"]] = {"hosted_id": record["hosted_id"], "record_id": ""}
            run.items += 1
            run.bytes += size
            run.largest = max(run.largest, size)

        runs = self._walk_stores(selected, identity, sink, on_progress)
        plan_stores = []
        for run in runs:
            entry: Dict[str, Any] = {"store": run.store, "status": run.status}
            if run.reason is not None:
                entry["reason"] = run.reason
            entry.update({
                "first_page_as_of": run.first_page_as_of,
                "walks": run.walks,
                "items": run.items,
                "bytes": run.bytes,
                "largest_item_bytes": run.largest,
                "item_skips": run.item_skips,
                "fields_not_exported": [dict(field) for field in _STORE_SPECS[run.store]["fields_not_exported"]],
                "server_exclusions": list(_STORE_SPECS[run.store]["server_exclusions"]),
            })
            plan_stores.append(entry)
        return {
            "schema": EXIT_PLAN_SCHEMA,
            "hosted": self._hosted_descriptor(identity),
            "overall": _overall_of(runs),
            "stores": plan_stores,
            "non_claims": list(EXIT_NON_CLAIMS),
        }

    # ── export ────────────────────────────────────────────────────────────

    def _export(
        self,
        collection_id: str,
        stores: Optional[Sequence[str]],
        identity_id: Optional[str],
        allow_remote_node: bool,
        on_progress: Optional[ProgressCallback],
    ) -> Dict[str, Any]:
        if not isinstance(collection_id, str) or collection_id == "":
            raise _exit_error(
                "exit_collection_required",
                "export() needs collection_id.",
                hint="Pass the id of an existing collection on the local node.",
            )
        selected = _select_stores(stores)
        identity = _optional_identity(identity_id)
        target = self._prepare_node(collection_id, allow_remote_node is True)
        origin = self._base_url
        run_id = str(uuid.uuid4())
        started_at = _now()

        def sink(run: _StoreRun, item: Dict[str, Any], context: Dict[str, str]) -> None:
            try:
                record = exit_item_record(origin=origin, store=run.store, item=item, context=context)
            except Exception as error:  # noqa: BLE001 — one bad item is a skip, as in TS
                run.item_skips.append({"hosted_id": _hosted_id_of(run.store, item), "reason": _code_of(error)})
                return
            spec = _STORE_SPECS[run.store]
            metadata = {
                "store": run.store,
                "hosted_id": record["hosted_id"],
                "identity_id": _string_or_none(spec["identity_id"](item, context)),
                "created_at": _string_or_none(spec["created_at"](item)),
                "encryption": {"encrypted_fields": spec["encrypted"](item), "verified": False},
                "embedding": {
                    "present": run.store == "memories" and item.get("has_embedding") is True,
                    "exported": False,
                },
            }
            written = self._write_text(target, run, {
                "text": record["text"],
                "source_uri": record["source_uri"],
                "external_id": record["external_id"],
                "key": record["key"],
                "metadata": metadata,
                "observed_at": started_at,
            }, record["hosted_id"])
            if written:
                run.items += 1

        runs = self._walk_stores(selected, identity, sink, on_progress)

        manifest_stores = []
        item_skips: Dict[str, List[Dict[str, Any]]] = {}
        for run in runs:
            entries = sorted(
                (
                    {"key": key, "hosted_id": value["hosted_id"], "record_id": value["record_id"]}
                    for key, value in run.current.items()
                ),
                key=lambda entry: _utf16_sort_key(entry["key"]),
            )
            index_ids = self._write_chunks(target, run_id, run.store, _INDEX_CHUNKS, entries, started_at)
            skip_ids = self._write_chunks(target, run_id, run.store, _SKIP_CHUNKS, run.item_skips, started_at)
            item_skips[run.store] = run.item_skips
            entry: Dict[str, Any] = {"store": run.store, "status": run.status}
            if run.reason is not None:
                entry["reason"] = run.reason
            entry.update({
                "first_page_as_of": run.first_page_as_of,
                "walks": run.walks,
                "records": {"written": run.written, "inserted": run.inserted, "existing": run.existing},
                "current": {
                    "record_count": len(entries),
                    "record_ids_sha256": _record_ids_digest([e["record_id"] for e in entries]),
                    "index_record_ids": index_ids,
                },
                "item_skip_count": len(run.item_skips),
                "item_skip_record_ids": skip_ids,
                "fields_not_exported": [dict(field) for field in _STORE_SPECS[run.store]["fields_not_exported"]],
                "server_exclusions": list(_STORE_SPECS[run.store]["server_exclusions"]),
            })
            manifest_stores.append(entry)

        manifest: Dict[str, Any] = {
            "schema": EXIT_MANIFEST_SCHEMA,
            "run_id": run_id,
            "started_at": started_at,
            "finished_at": _now(),
            "exporter": {"package": self._sdk_package, "version": self._sdk_version},
            "hosted": self._hosted_descriptor(identity),
            "node": {
                "node_id": target.node_id,
                "collection_id": target.collection_id,
                "max_body_bytes": target.max_body_bytes,
            },
            "overall": _overall_of(runs),
            "stores": manifest_stores,
            "non_claims": list(EXIT_NON_CLAIMS),
        }
        manifest_record_id = self._write_required(target, {
            "text": canonical_json(manifest),
            "source_uri": f"urn:agenttool:exit-door:run:{run_id}",
            "external_id": run_id,
            "key": f"exit-run/{run_id}",
            "metadata": {"kind": "exit-manifest", "run_id": run_id, "overall": manifest["overall"]},
            "observed_at": started_at,
        }, "exit_manifest_too_large")
        return {"manifest_record_id": manifest_record_id, "manifest": manifest, "item_skips": item_skips}

    def _prepare_node(self, collection_id: str, allow_remote: bool) -> _NodeTarget:
        data = self._node_guards(allow_remote)
        manifest = _obj(data.manifest())
        if manifest.get("protocol") != "agent-data/v1":
            raise _exit_error("data_node_protocol_unsupported", "The node does not report agent-data/v1.")
        collectors = manifest.get("collectors") if isinstance(manifest.get("collectors"), list) else []
        if not any(isinstance(entry, dict) and entry.get("collector_id") == _COLLECTOR for entry in collectors):
            raise _exit_error("data_node_text_collector_missing", "The node does not offer the text collector.")
        limits = _obj(manifest.get("limits"))
        max_body = _positive_int(limits.get("max_body_bytes")) or _DEFAULT_MAX_BODY
        node_record_limit = _positive_int(limits.get("max_record_bytes")) or _DEFAULT_MAX_RECORD
        listed = _obj(data.collections())
        collections = listed.get("collections") if isinstance(listed.get("collections"), list) else []
        collection = next(
            (
                entry
                for entry in collections
                if isinstance(entry, dict)
                and (entry.get("id") == collection_id or entry.get("collection_id") == collection_id)
            ),
            None,
        )
        if collection is None:
            raise _exit_error(
                "data_node_collection_not_found",
                "The target collection is not listed on the node.",
                hint="Create the collection on the node first; the exporter never defines collections.",
            )
        schema = _obj(collection.get("schema"))
        version = schema.get("version")
        schema_version = version if isinstance(version, str) and version != "" else "1"
        policy = _obj(collection.get("policy"))
        allowed = policy.get("allowed_media_types")
        if isinstance(allowed, list) and _MEDIA_TYPE not in allowed:
            raise _exit_error(
                "data_node_collection_refuses_json",
                "The target collection does not allow application/json.",
            )
        policy_limit = _positive_int(policy.get("max_record_bytes"))
        node_id = manifest.get("node_id")
        return _NodeTarget(
            data=data,
            node_id=node_id if isinstance(node_id, str) else "",
            collection_id=collection_id,
            schema_version=schema_version,
            max_body_bytes=max_body,
            max_record_bytes=node_record_limit if policy_limit is None else min(policy_limit, node_record_limit),
        )

    def _node_guards(self, allow_remote: bool) -> DataClient:
        data = self._data()
        if not allow_remote and not _is_loopback_url(self._node_base_url or ""):
            raise _exit_error(
                "data_node_not_loopback",
                "The data node URL is not a loopback address.",
                hint="Point at a local node, or pass allow_remote_node=True when the remote node is yours.",
            )
        if (
            self._project_key_digest is not None
            and self._node_token_digest is not None
            and self._project_key_digest == self._node_token_digest
        ):
            raise _exit_error(
                "data_node_token_reuses_project_bearer",
                "The data node token equals the AgentTool project API key.",
                hint="Give the node its own bearer; the project key must never reach the node.",
            )
        return data

    def _write_text(
        self,
        target: _NodeTarget,
        run: _StoreRun,
        fields: Dict[str, Any],
        hosted_id: str,
    ) -> bool:
        identity = self._identity_for(target, fields)
        expected = agent_data_record_id(identity)
        previous = run.current.get(fields["key"])
        if previous is not None and previous["record_id"] == expected:
            return False
        body = self._collect_body(target, fields)
        body_bytes = utf8_byte_length(canonical_json(body))
        if body_bytes > target.max_body_bytes or identity["content"]["size"] > target.max_record_bytes:
            run.item_skips.append({"hosted_id": hosted_id, "reason": "exceeds_node_limit", "bytes": body_bytes})
            return False
        try:
            result = target.data.collect(**body)
        except AgentToolError as error:
            if error.status == 413:
                run.item_skips.append({"hosted_id": hosted_id, "reason": "node_refused_size", "bytes": body_bytes})
                return False
            raise
        _assert_no_drift(result, expected, identity)
        run.written += 1
        run.inserted += result.get("inserted") if isinstance(result.get("inserted"), int) else 0
        run.existing += result.get("existing") if isinstance(result.get("existing"), int) else 0
        run.bytes += identity["content"]["size"]
        run.current[fields["key"]] = {"hosted_id": hosted_id, "record_id": expected}
        return True

    def _write_required(self, target: _NodeTarget, fields: Dict[str, Any], too_large_code: str) -> str:
        identity = self._identity_for(target, fields)
        expected = agent_data_record_id(identity)
        body = self._collect_body(target, fields)
        if (
            utf8_byte_length(canonical_json(body)) > target.max_body_bytes
            or identity["content"]["size"] > target.max_record_bytes
        ):
            raise _exit_error(too_large_code, "A required exit record exceeds the node's size limit.")
        result = target.data.collect(**body)
        _assert_no_drift(result, expected, identity)
        return expected

    def _identity_for(self, target: _NodeTarget, fields: Mapping[str, Any]) -> Dict[str, Any]:
        return agent_data_text_record_identity(
            collection_id=target.collection_id,
            schema_version=target.schema_version,
            text=fields["text"],
            media_type=_MEDIA_TYPE,
            source_uri=fields["source_uri"],
            external_id=fields["external_id"],
            key=fields["key"],
        )

    def _collect_body(self, target: _NodeTarget, fields: Mapping[str, Any]) -> Dict[str, Any]:
        return {
            "collection_id": target.collection_id,
            "collector_id": _COLLECTOR,
            "input": {
                "text": fields["text"],
                "media_type": _MEDIA_TYPE,
                "source_uri": fields["source_uri"],
                "external_id": fields["external_id"],
                "key": fields["key"],
                "metadata": fields["metadata"],
                "observed_at": fields["observed_at"],
                "provenance": [{"activity": _PROVENANCE_ACTIVITY, "at": fields["observed_at"]}],
            },
        }

    def _write_chunks(
        self,
        target: _NodeTarget,
        run_id: str,
        store: str,
        kind: Mapping[str, str],
        items: Sequence[Mapping[str, Any]],
        observed_at: str,
    ) -> List[str]:
        """Write one list as ``exit-<kind>/<run>/<store>/<n>`` records.

        The list is the current-id index or the item skips. An empty list
        writes nothing.
        """
        # Two ceilings bound every chunk: the node's request body limit, where
        # the chunk text travels escaped inside JSON, and the collection's
        # record limit, which counts the text's own bytes. Packing against
        # only the first would make a policy-limited collection refuse every
        # chunk.
        body_budget = max(target.max_body_bytes - _CHUNK_BODY_RESERVE, 1024)
        record_budget = target.max_record_bytes - utf8_byte_length(canonical_json({
            "schema": kind["schema"],
            "run_id": run_id,
            "store": store,
            "chunk": _MAX_SAFE_INTEGER,
            "chunk_count": _MAX_SAFE_INTEGER,
            kind["field"]: [],
        }))
        chunks: List[List[Mapping[str, Any]]] = []
        current: List[Mapping[str, Any]] = []
        body_size = 0
        record_size = 0
        for item in items:
            text = canonical_json(item)
            # +1 for the separating comma; the body cost also counts JSON escaping.
            record_cost = utf8_byte_length(text) + 1
            body_cost = utf8_byte_length(_js_json_string(text)) + 1
            if current and (body_size + body_cost > body_budget or record_size + record_cost > record_budget):
                chunks.append(current)
                current = []
                body_size = 0
                record_size = 0
            current.append(item)
            body_size += body_cost
            record_size += record_cost
        if current:
            chunks.append(current)
        name = kind["name"]
        ids = []
        for index, chunk in enumerate(chunks):
            key = f"exit-{name}/{run_id}/{store}/{index}"
            ids.append(self._write_required(target, {
                "text": canonical_json({
                    "schema": kind["schema"],
                    "run_id": run_id,
                    "store": store,
                    "chunk": index,
                    "chunk_count": len(chunks),
                    kind["field"]: chunk,
                }),
                "source_uri": f"urn:agenttool:exit-door:{name}:{run_id}:{store}:{index}",
                "external_id": key,
                "key": key,
                "metadata": {"kind": f"exit-{name}", "run_id": run_id, "store": store, "chunk": index},
                "observed_at": observed_at,
            }, f"exit_{name}_chunk_too_large"))
        return ids

    # ── verify ────────────────────────────────────────────────────────────

    def _verify(self, manifest_record_id: str, allow_remote: bool) -> Dict[str, Any]:
        if not isinstance(manifest_record_id, str) or not _is_record_id(manifest_record_id):
            raise _exit_error("exit_manifest_id_invalid", "verify() needs a manifest record id (rec_<64 hex>).")
        data = self._node_guards(allow_remote is True)
        result: Dict[str, Any] = {
            "schema": EXIT_VERIFY_SCHEMA,
            "manifest_record_id": manifest_record_id,
            "run_id": None,
            "manifest_overall": None,
            "verified": False,
            "checked": 0,
            "mismatches": [],
            "stores": [],
        }
        manifest_read = _read_verified(data, manifest_record_id)
        result["checked"] += 1
        if "mismatch" in manifest_read:
            result["mismatches"].append({"record_id": manifest_record_id, "reason": manifest_read["mismatch"]})
            return result
        manifest = _parse_json_object(manifest_read["text"])
        if manifest is None or manifest.get("schema") != EXIT_MANIFEST_SCHEMA or not isinstance(manifest.get("stores"), list):
            result["mismatches"].append({"record_id": manifest_record_id, "reason": "not_an_exit_manifest"})
            return result
        run_id = manifest.get("run_id")
        result["run_id"] = run_id if isinstance(run_id, str) else None
        overall = manifest.get("overall")
        result["manifest_overall"] = overall if overall in ("complete", "partial", "failed") else None

        for raw_store in manifest["stores"]:
            if not isinstance(raw_store, dict) or raw_store.get("store") not in EXIT_STORES:
                result["mismatches"].append({"record_id": manifest_record_id, "reason": "manifest_store_invalid"})
                continue
            store_name = raw_store["store"]
            store_result: Dict[str, Any] = {"store": store_name, "checked": 0, "mismatches": []}
            result["stores"].append(store_result)
            current = _obj(raw_store.get("current"))
            index_ids = current.get("index_record_ids") if isinstance(current.get("index_record_ids"), list) else []
            record_ids: List[str] = []
            index_ok = True
            for index_id in index_ids:
                if not isinstance(index_id, str):
                    store_result["mismatches"].append({"record_id": str(index_id), "reason": "index_id_invalid"})
                    index_ok = False
                    continue
                read = _read_verified(data, index_id)
                store_result["checked"] += 1
                if "mismatch" in read:
                    store_result["mismatches"].append({"record_id": index_id, "reason": read["mismatch"]})
                    index_ok = False
                    continue
                index = _parse_json_object(read["text"])
                if (
                    index is None
                    or index.get("schema") != EXIT_INDEX_SCHEMA
                    or index.get("store") != store_name
                    or not isinstance(index.get("entries"), list)
                ):
                    store_result["mismatches"].append({"record_id": index_id, "reason": "not_an_exit_index"})
                    index_ok = False
                    continue
                for entry in index["entries"]:
                    if (
                        not isinstance(entry, dict)
                        or not isinstance(entry.get("record_id"), str)
                        or not isinstance(entry.get("key"), str)
                    ):
                        store_result["mismatches"].append({"record_id": index_id, "reason": "index_entry_invalid"})
                        index_ok = False
                        continue
                    record_ids.append(entry["record_id"])
                    item_read = _read_verified(data, entry["record_id"])
                    store_result["checked"] += 1
                    if "mismatch" in item_read:
                        store_result["mismatches"].append(
                            {"record_id": entry["record_id"], "reason": item_read["mismatch"]}
                        )
                    elif item_read["record"].get("key") != entry["key"]:
                        store_result["mismatches"].append({"record_id": entry["record_id"], "reason": "key_mismatch"})
            if index_ok:
                if current.get("record_count") != len(record_ids):
                    store_result["mismatches"].append(
                        {"record_id": manifest_record_id, "reason": f"record_count_mismatch:{store_name}"}
                    )
                if current.get("record_ids_sha256") != _record_ids_digest(record_ids):
                    store_result["mismatches"].append(
                        {"record_id": manifest_record_id, "reason": f"record_ids_sha256_mismatch:{store_name}"}
                    )
            raw_skip_ids = raw_store.get("item_skip_record_ids")
            skip_ids = raw_skip_ids if isinstance(raw_skip_ids, list) else []
            skip_count = 0
            skips_ok = True
            for skip_id in skip_ids:
                if not isinstance(skip_id, str):
                    store_result["mismatches"].append({"record_id": str(skip_id), "reason": "skips_id_invalid"})
                    skips_ok = False
                    continue
                read = _read_verified(data, skip_id)
                store_result["checked"] += 1
                if "mismatch" in read:
                    store_result["mismatches"].append({"record_id": skip_id, "reason": read["mismatch"]})
                    skips_ok = False
                    continue
                chunk = _parse_json_object(read["text"])
                if (
                    chunk is None
                    or chunk.get("schema") != EXIT_SKIPS_SCHEMA
                    or chunk.get("store") != store_name
                    or not isinstance(chunk.get("item_skips"), list)
                ):
                    store_result["mismatches"].append({"record_id": skip_id, "reason": "not_an_exit_skips_chunk"})
                    skips_ok = False
                    continue
                skip_count += len(chunk["item_skips"])
            recorded_skips = raw_store.get("item_skip_count")
            if skips_ok and (
                not isinstance(recorded_skips, int) or isinstance(recorded_skips, bool) or recorded_skips != skip_count
            ):
                store_result["mismatches"].append(
                    {"record_id": manifest_record_id, "reason": f"item_skip_count_mismatch:{store_name}"}
                )
            result["checked"] += store_result["checked"]
            result["mismatches"].extend(store_result["mismatches"])
        result["verified"] = len(result["mismatches"]) == 0
        return result

    # ── hosted walks ──────────────────────────────────────────────────────

    def _hosted_descriptor(self, identity: Optional[str]) -> Dict[str, Any]:
        return {"origin": self._base_url, "auth_mode": self._auth_mode, "identity_id": identity}

    def _walk_stores(
        self,
        selected: Set[str],
        identity: Optional[str],
        sink: Sink,
        on_progress: Optional[ProgressCallback],
    ) -> List[_StoreRun]:
        runs: Dict[str, _StoreRun] = {store: _StoreRun(store) for store in EXIT_STORES if store in selected}
        project = {"scope": "project"}

        def progress(run: _StoreRun, event: Dict[str, Any]) -> None:
            if run.store in selected and on_progress is not None:
                on_progress(event)

        walker = _HostedWalker(self._http, self._base_url, progress)

        def guarded(run: _StoreRun, step: Callable[[], Any]) -> None:
            try:
                step()
            except _HostedReadError as error:
                _mark_failed(run, str(error.code) if error.code else "hosted_read_failed")

        def done(run: _StoreRun) -> None:
            progress(run, {"store": run.store, "event": "done", "status": run.status})

        memories = runs.get("memories")
        if memories is not None:
            guarded(memories, lambda: walker.cursor(
                memories,
                path="/v1/memories",
                params={"identity_id": identity} if identity else {},
                items_key="memories",
                limit=_PAGE_LIMITS["memories"],
                filter_={"identity_id": identity} if identity else dict(project),
                consume=lambda item: sink(memories, item, {}),
            ))
            done(memories)

        chronicle = runs.get("chronicle")
        if chronicle is not None:
            guarded(chronicle, lambda: walker.cursor(
                chronicle,
                path="/v1/chronicle",
                params={"agent_id": identity} if identity else {},
                items_key="entries",
                limit=_PAGE_LIMITS["chronicle"],
                filter_={"agent_id": identity} if identity else dict(project),
                consume=lambda item: sink(chronicle, item, {}),
            ))
            done(chronicle)

        if "strands" in selected or "strand_thoughts" in selected:
            strands = runs.get("strands") or _StoreRun("strands")
            thoughts = runs.get("strand_thoughts")

            def consume_strand(item: Dict[str, Any]) -> None:
                if identity and item.get("identity_id") != identity:
                    return
                if "strands" in runs:
                    sink(strands, item, {})
                if thoughts is None or thoughts.status == "failed":
                    return
                strand_id = item.get("id")
                if not isinstance(strand_id, str) or strand_id == "":
                    return
                thoughts.parents_visited += 1
                if not _is_addressable(strand_id):
                    thoughts.item_skips.append({"hosted_id": strand_id, "reason": "parent_id_not_addressable"})
                    return
                context = {"strand_id": strand_id}
                if isinstance(item.get("identity_id"), str):
                    context["identity_id"] = item["identity_id"]
                guarded(thoughts, lambda: walker.thoughts(
                    thoughts, strand_id, lambda thought: sink(thoughts, thought, context)
                ))

            guarded(strands, lambda: walker.cursor(
                strands,
                path="/v1/strands",
                params={"order": "created"},
                items_key="strands",
                limit=_PAGE_LIMITS["strands"],
                filter_=(
                    {"order": "created", "identity_id": identity, "identity_filter": "client"}
                    if identity
                    else {"order": "created", "scope": "project"}
                ),
                consume=consume_strand,
            ))
            if "strands" in runs:
                done(strands)
            if thoughts is not None:
                _settle_child(thoughts, strands, "strands")
                thoughts.walks = [_summarize_walks(thoughts.walks, {"scope": "per_strand"}, "strands")]
                done(thoughts)

        correspondence = runs.get("correspondence")
        if correspondence is not None:
            events_walked = [False]

            def walk_correspondence() -> None:
                repositories: List[str] = []

                def collect_repository(item: Dict[str, Any]) -> None:
                    repository_id = item.get("repository_id")
                    if isinstance(repository_id, str) and repository_id != "":
                        repositories.append(repository_id)

                found = walker.after(
                    correspondence,
                    path="/v1/correspondence/repositories",
                    params={},
                    items_key="repositories",
                    limit=_PAGE_LIMITS["repositories"],
                    filter_={"walk": "repositories", "scope": "project"},
                    not_found_means_no_cursor=True,
                    consume=collect_repository,
                )
                if not found:
                    return
                events_walked[0] = True
                for repository_id in repositories:
                    walker.after(
                        correspondence,
                        path="/v1/correspondence/events",
                        params={"repository_id": repository_id},
                        items_key="events",
                        limit=_PAGE_LIMITS["events"],
                        filter_={"walk": "events", "repository_id": repository_id},
                        not_found_means_no_cursor=False,
                        consume=lambda item: sink(correspondence, item, {}),
                    )

            guarded(correspondence, walk_correspondence)
            if events_walked[0]:
                repositories_walk, event_walks = correspondence.walks[0], correspondence.walks[1:]
                correspondence.walks = [
                    repositories_walk,
                    _summarize_walks(event_walks, {"walk": "events", "scope": "per_repository"}, "repositories"),
                ]
            done(correspondence)

        covenants = runs.get("covenants")
        if covenants is not None:

            def walk_covenants() -> None:
                for status in _COVENANT_STATUSES:
                    params = {"status": status}
                    filter_: Dict[str, Any] = {"status": status}
                    if identity:
                        params["agent_id"] = identity
                        filter_["agent_id"] = identity
                    else:
                        filter_["scope"] = "project"
                    walker.list(
                        covenants,
                        path="/v1/covenants",
                        params=params,
                        items_key="covenants",
                        filter_=filter_,
                        consume=lambda item: sink(covenants, item, {}),
                    )

            guarded(covenants, walk_covenants)
            done(covenants)

        if "identities" in selected or "identity_keys" in selected:
            identities = runs.get("identities") or _StoreRun("identities")
            keys = runs.get("identity_keys")

            def consume_identity(item: Dict[str, Any]) -> None:
                if identity and item.get("id") != identity:
                    return
                if "identities" in runs:
                    sink(identities, item, {})
                if keys is None or keys.status == "failed":
                    return
                identity_key = item.get("id")
                if not isinstance(identity_key, str) or identity_key == "":
                    return
                keys.parents_visited += 1
                if not _is_addressable(identity_key):
                    keys.item_skips.append({"hosted_id": identity_key, "reason": "parent_id_not_addressable"})
                    return
                guarded(keys, lambda: walker.list(
                    keys,
                    path=_identity_keys_path(identity_key),
                    params={},
                    items_key="keys",
                    filter_={"identity_id": identity_key},
                    consume=lambda key: sink(keys, key, {"identity_id": identity_key}),
                ))

            guarded(identities, lambda: walker.list(
                identities,
                path="/v1/identities",
                params={},
                items_key="identities",
                filter_=({"identity_id": identity, "identity_filter": "client"} if identity else dict(project)),
                consume=consume_identity,
            ))
            if "identities" in runs:
                done(identities)
            if keys is not None:
                _settle_child(keys, identities, "identities")
                keys.walks = [_summarize_walks(keys.walks, {"scope": "per_identity"}, "identities")]
                done(keys)

        vault = runs.get("vault_index")
        if vault is not None:
            guarded(vault, lambda: walker.list(
                vault,
                path="/v1/vault",
                params={},
                items_key="secrets",
                filter_=dict(project),
                consume=lambda item: sink(vault, item, {}),
            ))
            done(vault)

        backups = runs.get("backup_index")
        if backups is not None:
            guarded(backups, lambda: walker.list(
                backups,
                path="/v1/identity/backup",
                params={"agent_id": identity} if identity else {},
                items_key="backups",
                filter_={"agent_id": identity} if identity else dict(project),
                consume=lambda item: sink(backups, item, {}),
            ))
            done(backups)

        return [runs[store] for store in EXIT_STORES if store in runs]


class _HostedWalker:
    """GET-only hosted reader. Every request carries the project client only."""

    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        progress: Callable[[_StoreRun, Dict[str, Any]], None],
    ) -> None:
        self._http = http
        self._base_url = base_url
        self._progress = progress

    def cursor(
        self,
        run: _StoreRun,
        *,
        path: str,
        params: Dict[str, str],
        items_key: str,
        limit: int,
        filter_: Dict[str, Any],
        consume: Callable[[Dict[str, Any]], None],
    ) -> None:
        record = {"filter": filter_, "pages": 0, "returned": 0, "exhausted": False}
        run.walks.append(record)
        seen: Set[str] = set()
        cursor: Optional[str] = None
        while True:
            query = dict(params)
            query["limit"] = str(limit)
            if cursor is not None:
                query["cursor"] = cursor
            _status, body = self._get(path, query)
            items = _array_of(body, items_key)
            record["pages"] += 1
            record["returned"] += len(items)
            if record["pages"] == 1 and run.first_page_as_of is None:
                as_of = body.get("as_of")
                run.first_page_as_of = as_of if isinstance(as_of, str) else None
            for item in items:
                consume(item)
            self._progress(run, {"store": run.store, "event": "page", "pages": record["pages"], "returned": record["returned"]})
            page = body.get("page")
            if not isinstance(page, dict):
                _mark_window(run, "host_has_no_cursor")
                return
            if page.get("has_more") is False:
                record["exhausted"] = True
                return
            next_cursor = page.get("next_cursor")
            if page.get("has_more") is not True or not isinstance(next_cursor, str) or next_cursor == "":
                _mark_window(run, "host_has_no_cursor")
                return
            if next_cursor in seen:
                raise _hosted_error("hosted_cursor_stalled", "The host repeated a cursor.")
            seen.add(next_cursor)
            cursor = next_cursor

    def after(
        self,
        run: _StoreRun,
        *,
        path: str,
        params: Dict[str, str],
        items_key: str,
        limit: int,
        filter_: Dict[str, Any],
        not_found_means_no_cursor: bool,
        consume: Callable[[Dict[str, Any]], None],
    ) -> bool:
        record = {"filter": filter_, "pages": 0, "returned": 0, "exhausted": False}
        run.walks.append(record)
        after: Optional[str] = None
        while True:
            query = dict(params)
            query["limit"] = str(limit)
            if after is not None:
                query["after"] = after
            status, body = self._get(
                path, query, allow_404=not_found_means_no_cursor and record["pages"] == 0
            )
            if status == 404:
                _mark_window(run, "host_has_no_cursor")
                return False
            items = _array_of(body, items_key)
            record["pages"] += 1
            record["returned"] += len(items)
            for item in items:
                consume(item)
            self._progress(run, {"store": run.store, "event": "page", "pages": record["pages"], "returned": record["returned"]})
            page = body.get("page")
            if not isinstance(page, dict):
                _mark_window(run, "host_has_no_cursor")
                return True
            if page.get("has_more") is False:
                record["exhausted"] = True
                return True
            next_after = page.get("next_after")
            if page.get("has_more") is not True or not isinstance(next_after, str) or next_after == "":
                _mark_window(run, "host_has_no_cursor")
                return True
            if next_after == after:
                raise _hosted_error("hosted_cursor_stalled", "The host repeated a position.")
            after = next_after

    def thoughts(
        self,
        run: _StoreRun,
        strand_id: str,
        consume: Callable[[Dict[str, Any]], None],
    ) -> None:
        record = {"filter": {"strand_id": strand_id}, "pages": 0, "returned": 0, "exhausted": False}
        run.walks.append(record)
        since: Optional[int] = None
        while True:
            query = {"limit": str(_PAGE_LIMITS["thoughts"])}
            if since is not None:
                query["since_seq"] = str(since)
            _status, body = self._get(_thoughts_path(strand_id), query)
            items = _array_of(body, "thoughts")
            record["pages"] += 1
            record["returned"] += len(items)
            for item in items:
                consume(item)
            if len(items) < _PAGE_LIMITS["thoughts"]:
                record["exhausted"] = True
                return
            highest = since if since is not None else -1
            for item in items:
                sequence = item.get("sequence_num")
                if isinstance(sequence, int) and not isinstance(sequence, bool) and abs(sequence) <= 2**53 - 1:
                    highest = max(highest, sequence)
            if since is not None and highest <= since:
                raise _hosted_error("hosted_cursor_stalled", "Thought sequence numbers did not advance.")
            if highest < 0:
                raise _hosted_error("hosted_cursor_stalled", "Thoughts carried no sequence numbers.")
            since = highest

    def list(
        self,
        run: _StoreRun,
        *,
        path: str,
        params: Dict[str, str],
        items_key: str,
        filter_: Dict[str, Any],
        consume: Callable[[Dict[str, Any]], None],
    ) -> None:
        record = {"filter": filter_, "pages": 0, "returned": 0, "exhausted": False}
        run.walks.append(record)
        _status, body = self._get(path, params)
        items = _array_of(body, items_key)
        record["pages"] = 1
        record["returned"] = len(items)
        for item in items:
            consume(item)
        record["exhausted"] = True
        self._progress(run, {"store": run.store, "event": "page", "pages": 1, "returned": len(items)})

    def _get(
        self,
        path: str,
        params: Dict[str, str],
        *,
        allow_404: bool = False,
    ) -> Tuple[int, Dict[str, Any]]:
        try:
            response = self._http.request(
                "GET",
                f"{self._base_url}{path}",
                params=params or None,
                headers={"Accept": "application/json"},
                # The project bearer belongs to one origin; never replay it
                # across a redirect.
                follow_redirects=False,
            )
        except AgentToolError as error:
            raise _hosted_from(error) from None
        except httpx.HTTPError:
            raise _hosted_error("hosted_unreachable", "The hosted API could not be reached.") from None
        if 300 <= response.status_code < 400:
            response.close()
            raise _hosted_error(
                "hosted_redirect_refused", "The hosted API answered with a redirect.", response.status_code
            )
        if response.status_code == 404 and allow_404:
            response.close()
            return 404, {}
        if response.status_code >= 400:
            raise _hosted_from(_error_from_response(response, f"GET {path}"))
        try:
            body = response.json()
        except ValueError:
            raise _hosted_error(
                "hosted_response_invalid", "The hosted API returned non-JSON.", response.status_code
            ) from None
        if not isinstance(body, dict):
            raise _hosted_error(
                "hosted_response_invalid", "The hosted API returned a non-object body.", response.status_code
            )
        return response.status_code, body


# ─── Helpers ────────────────────────────────────────────────────────────────


def _thoughts_path(strand_id: str) -> str:
    """Ids here come from hosted responses; each still crosses the encoder."""
    return f"/v1/strands/{_path_segment(strand_id)}/thoughts"


def _identity_keys_path(identity_id: str) -> str:
    return f"/v1/identities/{_path_segment(identity_id)}/keys"


def _now() -> str:
    """``Date.prototype.toISOString`` spelling: UTC, milliseconds, ``Z``."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _mark_window(run: _StoreRun, reason: str) -> None:
    if run.status == "complete":
        run.status = "window_only"
        run.reason = reason


def _mark_failed(run: _StoreRun, reason: str) -> None:
    run.status = "failed"
    run.reason = reason


def _settle_child(child: _StoreRun, parent: _StoreRun, parent_name: str) -> None:
    """A nested store is only as complete as the parent walk that enumerated it."""
    if child.status == "failed" or parent.status == "complete":
        return
    if parent.status == "failed" and child.parents_visited == 0:
        child.status = "skipped"
        child.reason = f"parent_store_failed:{parent_name}"
        return
    child.status = "window_only"
    child.reason = f"parent_store_incomplete:{parent_name}"


def _summarize_walks(walks: Sequence[Dict[str, Any]], filter_: Mapping[str, str], parents: str) -> Dict[str, Any]:
    """One aggregate for a walk repeated once per parent.

    Thoughts per strand, events per repository, and keys per identity are
    recorded as one walk each, so the manifest does not grow with the number
    of parents. ``exhausted`` is true only when every per-parent walk ended.
    """
    return {
        "filter": {**filter_, parents: len(walks)},
        "pages": sum(walk["pages"] for walk in walks),
        "returned": sum(walk["returned"] for walk in walks),
        "exhausted": all(walk["exhausted"] for walk in walks),
    }


def _overall_of(runs: Sequence[_StoreRun]) -> str:
    if any(run.status in ("failed", "skipped") for run in runs):
        return "failed"
    if any(run.status != "complete" or run.item_skips for run in runs):
        return "partial"
    return "complete"


def _select_stores(stores: Optional[Sequence[str]]) -> Set[str]:
    if stores is None:
        return set(EXIT_STORES)
    if isinstance(stores, str) or not isinstance(stores, (list, tuple)) or len(stores) == 0:
        raise _exit_error("exit_stores_invalid", "stores must be a non-empty list of exit stores.")
    for store in stores:
        if store not in EXIT_STORES:
            raise _exit_error(
                "exit_store_unknown",
                f"Unknown exit store: {str(store)[:64]}.",
                hint=f"Known stores: {', '.join(EXIT_STORES)}.",
            )
    return set(stores)


def _optional_identity(identity_id: Optional[str]) -> Optional[str]:
    if identity_id is None:
        return None
    if not isinstance(identity_id, str) or identity_id == "" or len(identity_id) > 256:
        raise _exit_error("exit_identity_id_invalid", "identity_id must be a non-empty string.")
    return identity_id


def _array_of(body: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    value = body.get(key)
    if not isinstance(value, list):
        raise _hosted_error("hosted_response_invalid", f"The hosted response carried no {key} list.")
    for item in value:
        if not isinstance(item, dict):
            raise _hosted_error("hosted_response_invalid", f"A {key} entry was not an object.")
    return value


def _string_or_none(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def _positive_int(value: Any) -> Optional[int]:
    if isinstance(value, int) and not isinstance(value, bool) and 0 < value <= 2**53 - 1:
        return value
    return None


def _hosted_id_of(store: str, item: Dict[str, Any]) -> Optional[str]:
    try:
        value = _STORE_SPECS[store]["hosted_id"](item)
    except Exception:  # noqa: BLE001 — a malformed item has no id to report
        return None
    return value if isinstance(value, str) else None


def _code_of(error: Exception) -> str:
    if isinstance(error, AgentToolError) and error.code:
        return str(error.code)
    return "exit_item_invalid"


def _record_ids_digest(record_ids: Sequence[str]) -> str:
    return sha256_hex(canonical_json(list(record_ids)))


def _is_record_id(value: str) -> bool:
    return (
        len(value) == 68
        and value.startswith("rec_")
        and all(char in "0123456789abcdef" for char in value[4:])
    )


def _is_loopback_url(value: str) -> bool:
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https"):
        return False
    host = (parts.hostname or "").lower().rstrip(".")
    if host in ("localhost", "::1"):
        return True
    pieces = host.split(".")
    return (
        len(pieces) == 4
        and pieces[0] == "127"
        and all(piece.isdigit() and 1 <= len(piece) <= 3 for piece in pieces)
    )


def _assert_no_drift(result: Any, expected: str, identity: Mapping[str, Any]) -> None:
    records = result.get("records") if isinstance(result, dict) else None
    record = records[0] if isinstance(records, list) and records else None
    content = _obj(record.get("content")) if isinstance(record, dict) else {}
    if (
        not isinstance(record, dict)
        or record.get("id") != expected
        or content.get("sha256") != identity["content"]["sha256"]
    ):
        raise _exit_error(
            "exit_record_identity_drift",
            "The node stored a record whose identity differs from the one the exporter computed.",
            hint="Stop and compare the node version with the shared record-id vectors.",
        )


def _read_verified(data: DataClient, record_id: str) -> Dict[str, Any]:
    try:
        resolved = data.get(record_id)
    except AgentToolError as error:
        if error.status == 404:
            return {"mismatch": "record_not_found"}
        if error.status == 410:
            return {"mismatch": "record_tombstoned"}
        raise
    record = resolved.get("record") if isinstance(resolved, dict) else None
    content = resolved.get("content") if isinstance(resolved, dict) else None
    if (
        not isinstance(record, dict)
        or not isinstance(content, dict)
        or content.get("encoding") != "utf8"
        or not isinstance(content.get("data"), str)
    ):
        return {"mismatch": "record_unreadable"}
    envelope = _obj(record.get("content"))
    data_bytes = content["data"].encode("utf-8", errors="surrogatepass")
    if sha256_hex(data_bytes) != envelope.get("sha256") or len(data_bytes) != envelope.get("size"):
        return {"mismatch": "content_hash_mismatch"}
    source = _obj(record.get("source"))
    identity: Dict[str, Any] = {
        "protocol": record.get("protocol"),
        "collection_id": record.get("collection_id"),
        "source": {"collector_id": source.get("collector_id"), "uri": source.get("uri")},
        "content": {
            "sha256": envelope.get("sha256"),
            "size": envelope.get("size"),
            "media_type": envelope.get("media_type"),
        },
        "schema_version": record.get("schema_version"),
    }
    if "external_id" in source:
        identity["source"]["external_id"] = source["external_id"]
    for field in ("key", "version", "supersedes_id"):
        if field in record:
            identity[field] = record[field]
    try:
        derived = agent_data_record_id(identity)
    except AgentToolError:
        return {"mismatch": "record_identity_unreadable"}
    if derived != record.get("id") or derived != record_id:
        return {"mismatch": "record_id_mismatch"}
    return {"record": record, "text": content["data"]}


def _parse_json_object(text: str) -> Optional[Dict[str, Any]]:
    try:
        value = json.loads(text)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _reduce(error: BaseException) -> BaseException:
    """Errors leaving the exit door carry a code, status, and retry_after only.

    Server prose, details, and next actions from either authority are dropped
    so neither side's response text crosses into logs. The exporter's own
    errors (and the SDK's own ``data_node_not_configured``) carry no server
    text, so they keep their message and hint. Interrupts pass through.
    """
    if not isinstance(error, Exception):
        return error
    if isinstance(error, (_ExitDoorError, _HostedReadError)):
        return error
    if isinstance(error, AgentToolError):
        if error.code == "data_node_not_configured" and error.status is None:
            return error
        if error.code:
            code = str(error.code)
        elif error.status is not None:
            code = f"http_{error.status}"
        else:
            code = "exit_door_failed"
        retry_after = getattr(error, "retry_after", None)
        return AgentToolError(
            f"Exit door: {code}.",
            error_code=code,
            status=error.status,
            retry_after=str(retry_after) if retry_after is not None else None,
        )
    return _ExitDoorError("Exit door: an unexpected failure stopped the run.", error_code="exit_door_failed")


def _hosted_from(error: AgentToolError) -> _HostedReadError:
    """Keep only code, status, and retry_after from a hosted failure."""
    if error.code:
        code = str(error.code)
    elif error.status is not None:
        code = f"hosted_http_{error.status}"
    else:
        code = "hosted_read_failed"
    retry_after = getattr(error, "retry_after", None)
    return _HostedReadError(
        "Exit door hosted read failed.",
        error_code=code,
        status=error.status,
        retry_after=str(retry_after) if retry_after is not None else None,
    )
