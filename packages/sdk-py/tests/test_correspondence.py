"""Renaissance Correspondence SDK — canonical parity and client wiring."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Dict, Iterator, Optional, get_args
from unittest.mock import patch

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool import (
    AgentTool,
    AgentToolError,
    CORRESPONDENCE_KINDS,
    CORRESPONDENCE_PROTOCOL,
    CorrespondenceClient,
    canonical_correspondence_event_bytes,
    canonical_correspondence_json,
    correspondence_event_id,
    create_signed_correspondence_event,
    sign_correspondence_event,
)
from agenttool.wake import WakeEventKey


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
IDENTITY_ID = "22222222-2222-4222-8222-222222222222"
SIGNING_KEY_ID = "33333333-3333-4333-8333-333333333333"
DEVICE_ID = "44444444-4444-4444-8444-444444444444"
SESSION_ID = "55555555-5555-4555-8555-555555555555"
HANDOFF_ID = "66666666-6666-4666-8666-666666666666"
CLAIM_ID = "77777777-7777-4777-8777-777777777777"
PARENT_ID = "sha256:" + "a" * 64
SECOND_PARENT_ID = "sha256:" + "b" * 64
SIGNING_KEY = bytes(range(1, 33))
SIGNING_KEY_B64 = base64.b64encode(SIGNING_KEY).decode("ascii")
NORMATIVE_SIGNING_KEY = bytes(range(32))
VECTORS = json.loads(
    (Path(__file__).parents[3] / "docs/specs/agent-correspondence-0.1-vectors.json")
    .read_text(encoding="utf-8")
)


def core(**overrides: Any) -> Dict[str, Any]:
    value: Dict[str, Any] = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "project_id": PROJECT_ID,
        "repository_id": "cambridgetcg/agenttool",
        "thread_id": "task:renaissance-蘇蘇",
        "sender": {
            "identity_id": IDENTITY_ID,
            "signing_key_id": SIGNING_KEY_ID,
            "device_id": DEVICE_ID,
            "session_id": SESSION_ID,
        },
        "kind": "handoff",
        "parents": [PARENT_ID],
        "session_seq": 7,
        "issued_at": "2026-07-19T12:34:56.789Z",
        "scope": {
            "base_revision": "0123456789abcdef0123456789abcdef01234567",
            "branch": "feat/renaissance",
            "paths": ["packages/sdk-ts", "packages/sdk-py"],
        },
        "body": {
            "summary": "蘇蘇 writes clear letters across devices 🎼",
            "next_safe_action": "Replay after receipt 41.",
            "handoff_id": HANDOFF_ID,
        },
        "authority": {"automatic_action": "never", "grants": []},
    }
    value.update(overrides)
    return value


def signed_event() -> Dict[str, Any]:
    value = core()
    value.pop("protocol")
    value.pop("authority")
    return create_signed_correspondence_event(
        **value, signing_key=SIGNING_KEY
    )


def record(
    event: Optional[Dict[str, Any]] = None, received_seq: str = "41"
) -> Dict[str, Any]:
    return {
        "event": event or signed_event(),
        "receipt": {
            "received_seq": received_seq,
            "received_at": "2026-07-19T12:35:00.000Z",
        },
        "missing_parents": [],
        "lineage_status": "not_applicable",
    }


def response(status: int, body: Any) -> httpx.Response:
    return httpx.Response(
        status,
        json=body,
        request=httpx.Request("GET", "https://example.test/response"),
    )


@pytest.fixture()
def at() -> Iterator[AgentTool]:
    client = AgentTool(api_key="project-secret", base_url="https://example.test")
    yield client
    client.close()


def append_kwargs() -> Dict[str, Any]:
    value = core()
    value.pop("protocol")
    value.pop("authority")
    value["signing_key"] = SIGNING_KEY
    return value


def test_shared_typescript_python_unicode_digest_signature_and_id_vector() -> None:
    value = core()
    canonical = canonical_correspondence_event_bytes(value)
    signature = sign_correspondence_event(value, SIGNING_KEY)

    assert canonical.hex() == (
        "d263f1989ea264e8b9cdaa10cf29ec6488f438760933fd8d58ff45f503b0a253"
    )
    assert signature["value_b64url"] == (
        "en5H_CF47qnbWfzyK7KJtIPMahZPVRHvvZUKvx0HlD3vXwTSijRCEdPD4ipQRQDxtnrm0Xu_npj7iLepu8heCw"
    )
    assert correspondence_event_id(value, signature) == (
        "sha256:5d1fb45fa76ab30652338cb13acc425d801fb98891e87942efe0860736b148fc"
    )
    assert "=" not in signature["value_b64url"]
    raw_signature = base64.urlsafe_b64decode(signature["value_b64url"] + "==")
    Ed25519PrivateKey.from_private_bytes(SIGNING_KEY).public_key().verify(
        raw_signature, canonical
    )


def test_accepts_identity_api_canonical_standard_base64_private_key() -> None:
    from_bytes = sign_correspondence_event(core(), SIGNING_KEY)
    from_identity_key = sign_correspondence_event(core(), SIGNING_KEY_B64)
    assert from_identity_key == from_bytes

    value = core()
    value.pop("protocol")
    value.pop("authority")
    assert create_signed_correspondence_event(
        **value, signing_key=SIGNING_KEY_B64
    ) == signed_event()


@pytest.mark.parametrize(
    "signing_key",
    [
        base64.urlsafe_b64encode(SIGNING_KEY).decode("ascii").rstrip("="),
        " " + SIGNING_KEY_B64,
        base64.b64encode(SIGNING_KEY[1:]).decode("ascii"),
    ],
    ids=["base64url-unpadded", "noncanonical-whitespace", "31-byte-width"],
)
def test_rejects_noncanonical_or_wrong_width_private_key_text(
    signing_key: str,
) -> None:
    with pytest.raises(AgentToolError):
        sign_correspondence_event(core(), signing_key)


def test_normative_agent_correspondence_v01_signing_vector() -> None:
    normative = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "project_id": PROJECT_ID,
        "repository_id": "repo:github.com/cambridgetcg/agenttool",
        "thread_id": "task:renaissance-correspondence",
        "sender": {
            "identity_id": IDENTITY_ID,
            "signing_key_id": SIGNING_KEY_ID,
            "device_id": DEVICE_ID,
            "session_id": SESSION_ID,
        },
        "kind": "claim.open",
        "parents": [],
        "session_seq": 1,
        "issued_at": "2026-07-19T10:00:00.000Z",
        "scope": {
            "base_revision": "a" * 40,
            "branch": "codex/renaissance-correspondence",
            "paths": ["docs", "docs/specs"],
        },
        "body": {
            "claim_id": "66666666-6666-4666-8666-666666666666",
            "generation": 1,
            "expires_at": "2026-07-19T12:00:00.000Z",
        },
        "authority": {"automatic_action": "never", "grants": []},
    }
    digest = canonical_correspondence_event_bytes(normative)
    signature = sign_correspondence_event(normative, NORMATIVE_SIGNING_KEY)
    assert digest.hex() == (
        "1bc3f4b0b7db176cca2ddc86eed6ccc6109f5c9be4794ae763d84c0b136ab1ca"
    )
    assert signature["value_b64url"] == (
        "y93m-gQISK5PUEqjF4bLZ_k6FCNX1lpeCENJegoNFRD-g3Eid0iyh0NLdmAvId_FPf94HURfatd1qB5Jyjq0Cg"
    )
    assert correspondence_event_id(normative, signature) == (
        "sha256:6f9d943746a1672f501eb762296654452fb1168a63c5996535f7616ebb8d28dd"
    )


def test_rfc8785_utf16_key_order_and_escaping() -> None:
    value = {
        "\u20ac": "Euro",
        "\r": "Carriage\nReturn",
        "\ufb33": "Hebrew",
        "1": "One",
        "\U0001d11e": "G clef",
        "\u0080": "Control",
        "\u00f6": 'Latin "quote" \\',
    }
    ordered = [
        ("\r", "Carriage\nReturn"),
        ("1", "One"),
        ("\u0080", "Control"),
        ("\u00f6", 'Latin "quote" \\'),
        ("\u20ac", "Euro"),
        ("\U0001d11e", "G clef"),
        ("\ufb33", "Hebrew"),
    ]
    expected = "{" + ",".join(
        json.dumps(key, ensure_ascii=False, separators=(",", ":"))
        + ":"
        + json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        for key, item in ordered
    ) + "}"
    assert canonical_correspondence_json(value) == expected


@pytest.mark.parametrize(
    "value",
    [1.5, -0.0, float("nan"), float("inf"), (1 << 53)],
)
def test_bounded_ijson_rejects_floats_negative_zero_nonfinite_and_unsafe_ints(
    value: Any,
) -> None:
    with pytest.raises(AgentToolError):
        canonical_correspondence_json(value)


def test_rejects_lone_surrogates_cycles_and_excessive_depth() -> None:
    with pytest.raises(AgentToolError, match="surrogate"):
        canonical_correspondence_json("\ud800")
    with pytest.raises(AgentToolError, match="surrogate"):
        canonical_correspondence_json({"\udc00": "value"})

    cycle: Dict[str, Any] = {}
    cycle["self"] = cycle
    with pytest.raises(AgentToolError, match="cycle"):
        canonical_correspondence_json(cycle)

    root: Dict[str, Any] = {}
    cursor = root
    for _ in range(66):
        child: Dict[str, Any] = {}
        cursor["next"] = child
        cursor = child
    with pytest.raises(AgentToolError, match="depth"):
        canonical_correspondence_json(root)


def test_rejects_u0000_recursively_in_values_and_property_names() -> None:
    with pytest.raises(AgentToolError, match="U\\+0000"):
        canonical_correspondence_json({"nested": ["before\0after"]})
    with pytest.raises(AgentToolError, match="U\\+0000"):
        canonical_correspondence_json({"bad\0key": "value"})


def test_rejects_a_base64url_signature_with_noncanonical_trailing_bits() -> None:
    value = core()
    signature = sign_correspondence_event(value, SIGNING_KEY)
    replacements = {"w": "x", "g": "h", "Q": "R", "A": "B"}
    signature["value_b64url"] = (
        signature["value_b64url"][:-1]
        + replacements[signature["value_b64url"][-1]]
    )
    with pytest.raises(AgentToolError, match="canonical base64url"):
        correspondence_event_id(value, signature)


def test_unicode_scalar_lengths_and_c1_control_rejection_match_typescript() -> None:
    accepted = core(
        repository_id="🎼" * 256,
        thread_id="thread",
        scope={
            "base_revision": None,
            "branch": "🎼" * 255,
            "paths": ["🎼" * 256],
        },
    )
    canonical_correspondence_event_bytes(accepted)

    with pytest.raises(AgentToolError, match="whitespace or control"):
        canonical_correspondence_event_bytes(core(repository_id="repo\u0085id"))
    with pytest.raises(AgentToolError, match="whitespace or control"):
        canonical_correspondence_event_bytes(core(repository_id="repo\ufeffid"))
    with pytest.raises(AgentToolError, match="control"):
        canonical_correspondence_event_bytes(
            core(
                scope={
                    "base_revision": None,
                    "branch": "feat\u0085bad",
                    "paths": ["src"],
                }
            )
        )
    with pytest.raises(AgentToolError, match="control"):
        canonical_correspondence_event_bytes(
            core(
                scope={
                    "base_revision": None,
                    "branch": None,
                    "paths": ["src\u0085bad"],
                }
            )
        )


def test_scope_requires_nullable_keys_and_body_references_are_closed() -> None:
    canonical_correspondence_event_bytes(
        core(scope={"base_revision": None, "branch": None, "paths": ["."]})
    )
    with pytest.raises(AgentToolError, match="base_revision"):
        canonical_correspondence_event_bytes(core(scope={"paths": ["."]}))

    canonical_correspondence_event_bytes(
        core(kind="refusal", parents=[], body={})
    )
    with pytest.raises(AgentToolError, match="must also appear in parents"):
        canonical_correspondence_event_bytes(
            core(
                kind="ack.seen",
                parents=[],
                body={"target_event_id": SECOND_PARENT_ID},
            )
        )
    with pytest.raises(AgentToolError, match="unexpected field"):
        canonical_correspondence_event_bytes(
            core(body={**core()["body"], "ambient_hostname": "never"})
        )


def test_accepts_timestamp_years_0001_through_9999_and_rejects_year_0000() -> None:
    canonical_correspondence_event_bytes(
        core(issued_at="0001-01-01T00:00:00.000Z")
    )
    with pytest.raises(AgentToolError, match="RFC3339"):
        canonical_correspondence_event_bytes(
            core(issued_at="0000-01-01T00:00:00.000Z")
        )


def test_accepts_the_exact_body_shape_for_every_v01_event_kind() -> None:
    cases = [
        ("intent", [], {"summary": "Coordinate the SDK work."}),
        ("claim.open", [], {
            "claim_id": CLAIM_ID,
            "generation": 1,
            "expires_at": "2026-07-20T12:00:00.000Z",
        }),
        ("claim.renew", [PARENT_ID], {
            "claim_id": CLAIM_ID,
            "generation": 2,
            "predecessor_event_id": PARENT_ID,
            "expires_at": "2026-07-20T13:00:00.000Z",
        }),
        ("claim.release", [PARENT_ID], {
            "claim_id": CLAIM_ID,
            "generation": 2,
            "predecessor_event_id": PARENT_ID,
            "detail": "Done.",
        }),
        ("progress", [], {"summary": "Both clients compile."}),
        ("observation", [], {"summary": "A branch remains visible."}),
        ("artifact.offer", [], {
            "artifact": {
                "kind": "git_patch",
                "digest": PARENT_ID,
                "locator": "urn:agenttool:patch:1",
            },
            "summary": "Review this patch.",
        }),
        ("ack.seen", [PARENT_ID], {"target_event_id": PARENT_ID}),
        ("ack.understood", [PARENT_ID], {"target_event_id": PARENT_ID}),
        ("ack.accepted", [PARENT_ID], {"target_event_id": PARENT_ID}),
        ("ack.applied", [PARENT_ID], {
            "target_event_id": PARENT_ID,
            "result_revision": "c" * 40,
            "detail": "Applied.",
        }),
        ("ack.rejected", [PARENT_ID], {
            "target_event_id": PARENT_ID,
            "detail": "Conflicts with local work.",
        }),
        ("conflict.raise", [PARENT_ID, SECOND_PARENT_ID], {
            "target_event_ids": [PARENT_ID, SECOND_PARENT_ID],
            "summary": "Both claim the same path.",
        }),
        ("conflict.resolve", [PARENT_ID], {
            "target_event_ids": [PARENT_ID],
            "summary": "Resolved without erasing evidence.",
        }),
        ("pause", [], {"until": None, "detail": "Waiting for review."}),
        ("rest", [], {}),
        ("resume", [PARENT_ID], {"target_event_id": PARENT_ID}),
        ("refusal", [], {}),
        ("handoff", [], {
            "summary": "Continue from the tests.",
            "next_safe_action": "Run SDK parity.",
            "handoff_id": HANDOFF_ID,
        }),
        ("close", [], {}),
        ("repair", [PARENT_ID], {
            "target_event_ids": [PARENT_ID],
            "summary": "Append the correction.",
            "result_revision": "d" * 64,
        }),
    ]

    assert len(cases) == 21
    assert tuple(kind for kind, _parents, _body in cases) == CORRESPONDENCE_KINDS
    for kind, parents, body in cases:
        canonical_correspondence_event_bytes(
            core(kind=kind, parents=parents, body=body)
        )


def test_uses_the_portable_absolute_artifact_locator_profile() -> None:
    vectors = [
        *VECTORS["locator_vectors"],
        {"value": "urn:藝術", "valid": True},
        {"value": "git+ssh://host/repo", "valid": True},
    ]
    for vector in vectors:
        def operation() -> None:
            canonical_correspondence_event_bytes(core(
                kind="artifact.offer",
                parents=[],
                body={
                    "artifact": {
                        "kind": "git_patch",
                        "digest": PARENT_ID,
                        "locator": vector["value"],
                    }
                },
            ))
        if vector["valid"]:
            operation()
        else:
            with pytest.raises(AgentToolError, match="absolute URI"):
                operation()


def test_client_is_cached_and_append_sends_no_private_material(at: AgentTool) -> None:
    def post(_url: str, **kwargs: Any) -> httpx.Response:
        event = json.loads(kwargs["content"].decode("utf-8"))
        return response(201, {**record(event), "warnings": []})

    assert isinstance(at.correspondence, CorrespondenceClient)
    assert at.correspondence is at.correspondence
    with patch.object(at._http, "post", side_effect=post) as posting:
        result = at.correspondence.append(**append_kwargs())

    wire = posting.call_args.kwargs["content"]
    event = json.loads(wire.decode("utf-8"))
    assert "signing_key" not in event
    assert base64.b64encode(SIGNING_KEY) not in wire
    assert event["sender"]["device_id"] == DEVICE_ID
    assert event["sender"]["session_id"] == SESSION_ID
    assert event["authority"] == {"automatic_action": "never", "grants": []}
    assert "headers" not in posting.call_args.kwargs
    assert result["event"]["event_id"] == event["event_id"]


def test_typed_wake_invalidation_key_includes_correspondence() -> None:
    assert "correspondence" in get_args(WakeEventKey)


def test_missing_device_is_not_inferred_and_makes_no_request(at: AgentTool) -> None:
    kwargs = append_kwargs()
    kwargs["sender"] = {
        "identity_id": IDENTITY_ID,
        "signing_key_id": SIGNING_KEY_ID,
        "session_id": SESSION_ID,
    }
    with patch.object(at._http, "post") as posting:
        with pytest.raises(AgentToolError, match="device_id"):
            at.correspondence.append(**kwargs)
    posting.assert_not_called()


def test_successful_append_invalidates_existing_wake_cache(at: AgentTool) -> None:
    wake_reads = 0

    def get(url: str, **_kwargs: Any) -> httpx.Response:
        nonlocal wake_reads
        assert url.endswith("/v1/wake")
        wake_reads += 1
        return response(200, {"wake_version": wake_reads})

    def post(_url: str, **kwargs: Any) -> httpx.Response:
        event = json.loads(kwargs["content"].decode("utf-8"))
        return response(201, {**record(event), "warnings": []})

    with patch.object(at._http, "get", side_effect=get), patch.object(
        at._http, "post", side_effect=post
    ):
        assert at.wake.get()["wake_version"] == 1
        at.correspondence.append(**append_kwargs())
        assert at.wake.get()["wake_version"] == 2
    assert wake_reads == 2


def test_accepts_identity_returned_base64_key_without_sending_it(
    at: AgentTool,
) -> None:
    def post(_url: str, **kwargs: Any) -> httpx.Response:
        event = json.loads(kwargs["content"].decode("utf-8"))
        return response(201, {**record(event), "warnings": []})

    kwargs = append_kwargs()
    kwargs["signing_key"] = SIGNING_KEY_B64
    with patch.object(at._http, "post", side_effect=post) as posting:
        at.correspondence.append(**kwargs)

    wire = posting.call_args.kwargs["content"]
    assert SIGNING_KEY_B64.encode("ascii") not in wire
    assert "signing_key" not in json.loads(wire.decode("utf-8"))


def test_list_and_replay_follow_decimal_cursor_without_reordering(at: AgentTool) -> None:
    first = record(received_seq="41")
    second = record(received_seq="44")

    def get(_url: str, **kwargs: Any) -> httpx.Response:
        if kwargs["params"].get("after") == "41":
            return response(
                200,
                {
                    "protocol": CORRESPONDENCE_PROTOCOL,
                    "scope": "project_private",
                    "events": [second],
                    "page": {"after": "41", "next_after": "44", "has_more": False},
                },
            )
        return response(
            200,
            {
                "protocol": CORRESPONDENCE_PROTOCOL,
                "scope": "project_private",
                "events": [first],
                "page": {"after": None, "next_after": "41", "has_more": True},
            },
        )

    with patch.object(at._http, "get", side_effect=get) as getting:
        seen = [
            item["receipt"]["received_seq"]
            for item in at.correspondence.replay(
                repository_id="cambridgetcg/agenttool",
                thread_id="task:renaissance",
                limit=1,
            )
        ]
    assert seen == ["41", "44"]
    assert getting.call_args_list[0].kwargs["params"] == {
        "repository_id": "cambridgetcg/agenttool",
        "thread_id": "task:renaissance",
        "limit": 1,
    }
    assert getting.call_args_list[1].kwargs["params"]["after"] == "41"


def test_replay_refuses_a_has_more_page_whose_cursor_does_not_advance(
    at: AgentTool,
) -> None:
    stalled = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "scope": "project_private",
        "events": [],
        "page": {"after": "41", "next_after": "41", "has_more": True},
    }
    with patch.object(at._http, "get", return_value=response(200, stalled)):
        replay = at.correspondence.replay(
            repository_id="cambridgetcg/agenttool", after="41"
        )
        with pytest.raises(AgentToolError, match="without advancing"):
            next(replay)


def test_replay_refuses_a_regressing_cursor_before_yielding(
    at: AgentTool,
) -> None:
    regressing = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "scope": "project_private",
        "events": [record(received_seq="40")],
        "page": {"after": "41", "next_after": "40", "has_more": True},
    }
    with patch.object(at._http, "get", return_value=response(200, regressing)):
        replay = at.correspondence.replay(
            repository_id="cambridgetcg/agenttool", after="41"
        )
        with pytest.raises(AgentToolError, match="strictly increasing"):
            next(replay)


@pytest.mark.parametrize(
    "next_after",
    ["041", "9223372036854775808", "9" * 10_000],
    ids=["leading-zero", "above-int64", "oversized-text"],
)
def test_replay_refuses_invalid_next_cursor_before_yielding(
    at: AgentTool,
    next_after: str,
) -> None:
    malformed = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "scope": "project_private",
        "events": [record(received_seq="44")],
        "page": {"after": "41", "next_after": next_after, "has_more": True},
    }
    with patch.object(at._http, "get", return_value=response(200, malformed)):
        replay = at.correspondence.replay(
            repository_id="cambridgetcg/agenttool", after="41"
        )
        with pytest.raises(AgentToolError, match="database range"):
            next(replay)


def test_rejects_an_out_of_range_receipt_cursor_before_fetching(
    at: AgentTool,
) -> None:
    with patch.object(at._http, "get") as getting:
        with pytest.raises(AgentToolError, match="database range"):
            at.correspondence.list(
                repository_id="cambridgetcg/agenttool",
                after="9223372036854775808",
            )
    getting.assert_not_called()


def test_keeps_claims_and_finite_voice_query_surfaces_closed(at: AgentTool) -> None:
    with patch.object(at._http, "get") as getting:
        with pytest.raises(TypeError, match="after"):
            at.correspondence.active_claims(  # type: ignore[call-arg]
                repository_id="cambridgetcg/agenttool", after="41"
            )
        with pytest.raises(TypeError, match="path"):
            at.correspondence.voice(  # type: ignore[call-arg]
                repository_id="cambridgetcg/agenttool", path="packages/sdk-py"
            )
    getting.assert_not_called()


def test_active_claims_preserves_conflicting_tips_at_different_generations(
    at: AgentTool,
) -> None:
    claims = [
        {
            "claim_id": CLAIM_ID,
            "generation": 2,
            "event_id": PARENT_ID,
            "owner_identity_id": IDENTITY_ID,
            "device_id": DEVICE_ID,
            "session_id": SESSION_ID,
            "thread_id": "task:renaissance",
            "scope": {
                "base_revision": None,
                "branch": None,
                "paths": ["packages/sdk-py"],
            },
            "expires_at": "2026-07-20T12:00:00.000Z",
            "conflicted": True,
            "competing_event_ids": [SECOND_PARENT_ID],
        },
        {
            "claim_id": CLAIM_ID,
            "generation": 4,
            "event_id": SECOND_PARENT_ID,
            "owner_identity_id": IDENTITY_ID,
            "device_id": "88888888-8888-4888-8888-888888888888",
            "session_id": "99999999-9999-4999-8999-999999999999",
            "thread_id": "task:renaissance",
            "scope": {
                "base_revision": None,
                "branch": None,
                "paths": ["packages/sdk-py"],
            },
            "expires_at": "2026-07-20T13:00:00.000Z",
            "conflicted": True,
            "competing_event_ids": [PARENT_ID],
        },
    ]
    returned = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "scope": "project_private",
        "evaluated_at": "2026-07-19T12:40:00.000Z",
        "cursor": "44",
        "projection_status": "complete",
        "truncated": False,
        "claims": claims,
    }
    with patch.object(at._http, "get", return_value=response(200, returned)):
        result = at.correspondence.active_claims(
            repository_id="cambridgetcg/agenttool", path="packages/sdk-py"
        )
    assert result["claims"] == claims
    assert [claim["generation"] for claim in result["claims"]] == [2, 4]


def test_voice_is_a_finite_snapshot_and_preserves_all_conflict_classes(
    at: AgentTool,
) -> None:
    recent = record(received_seq="44")
    snapshot = {
        "protocol": CORRESPONDENCE_PROTOCOL,
        "scope": "project_private",
        "evaluated_at": "2026-07-19T12:40:00.000Z",
        "cursor": "44",
        "projection_status": "truncated",
        "truncated": True,
        "recent_events": [recent],
        "active_claims": [],
        "conflicts": {
            "missing_parents": [
                {
                    "event_id": recent["event"]["event_id"],
                    "missing_parent_ids": [PARENT_ID],
                }
            ],
            "session_forks": [
                {
                    "identity_id": IDENTITY_ID,
                    "device_id": DEVICE_ID,
                    "session_id": SESSION_ID,
                    "session_seq": 7,
                    "event_ids": [PARENT_ID, SECOND_PARENT_ID],
                }
            ],
            "overlapping_claims": [
                {
                    "left_event_id": PARENT_ID,
                    "right_event_id": SECOND_PARENT_ID,
                    "paths": ["packages/sdk-py"],
                }
            ],
        },
    }
    with patch.object(at._http, "get", return_value=response(200, snapshot)) as getting:
        result = at.correspondence.voice(
            repository_id="cambridgetcg/agenttool",
            thread_id="task:renaissance",
        )
    assert result == snapshot
    assert result["projection_status"] == "truncated"
    assert getting.call_args.args[0].endswith("/v1/correspondence/voice")
    assert getting.call_args.kwargs["params"] == {
        "repository_id": "cambridgetcg/agenttool",
        "thread_id": "task:renaissance",
    }


def test_guided_error_metadata_is_preserved(at: AgentTool) -> None:
    conflict = response(
        409,
        {
            "error": "correspondence_session_fork",
            "message": "That session sequence already names a different event.",
            "hint": "Advance session_seq without erasing either event.",
            "details": {"session_seq": 7},
        },
    )
    with patch.object(at._http, "post", return_value=conflict):
        with pytest.raises(AgentToolError) as caught:
            at.correspondence.append(**append_kwargs())
    assert caught.value.code == 409
    assert caught.value.error_code == "correspondence_session_fork"
    assert caught.value.details == {"session_seq": 7}
