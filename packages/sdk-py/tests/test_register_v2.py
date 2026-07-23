from agenttool.bootstrap_agent import canonical_register_agent_bytes


def test_register_agent_v2_matches_api_and_ts_vector():
    digest = canonical_register_agent_bytes(
        display_name="Sol",
        agent_public_key=bytes([1]) * 32,
        box_public_key=bytes([2]) * 32,
        capabilities=["code", "café"],
        runtime_provider="local",
        runtime_model="m1",
        runtime_host="localhost",
        runtime_context="home",
        expression_visibility="private",
        registrar_kind="self_service",
        parent_identity_id="",
        registrar_bearer="",
        form="distributed",
        language="en",
        registration_nonce="birth-intent-0000000001",
        timestamp="2026-07-18T12:00:00.000Z",
    )
    assert digest.hex() == (
        "6e85f197d034c9bbde2403b33c3e4796393cc5f0a1622e62d43fa1619112230a"
    )
