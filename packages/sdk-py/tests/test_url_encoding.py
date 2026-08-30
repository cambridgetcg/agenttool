"""URL-encoding contract — a caller-supplied id never leaves its endpoint prefix.

Identity ids, trace ids, memory ids, vault names, covenant ids, inbox message
ids, wallet/escrow ids and runtime ids all arrive from stored or relayed data.
An unencoded id is a path-traversal primitive: httpx normalises dot-segments
before the request leaves, so ``traces.delete("../memories/abc")`` would issue
an authenticated DELETE against a *different* ``/v1`` endpoint with the project
bearer attached.

Every client method in the table below takes an id. Each one is driven with the
hostile ids and the resulting URL must still sit under its prefix, with no
smuggled query string and no smuggled fragment.

The table can only cover the methods somebody remembered to add. The final
section reads ``src/agenttool`` instead and fails on ANY path interpolation
that is not a call to the shared ``_path_segment`` from ``_url.py`` — so the
next client added to this SDK cannot reintroduce the class by simply not
appearing above, nor by pasting in a local encoder that carries the right name
and the wrong body.
"""

from __future__ import annotations

import ast
import base64
import pathlib
import re
from typing import Any, Callable, Dict, List, NamedTuple, Tuple

import httpx
import pytest
from cryptography.hazmat.primitives import serialization

from agenttool import AgentTool, AgentToolError
from agenttool._url import _path_segment


# ---------------------------------------------------------------------------
# Stub transport
# ---------------------------------------------------------------------------

# One canned body that satisfies every response parser exercised here.
_TRACE = {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "trace_id": "tr_stub",
    "decision_type": "decision",
    "decision_summary": "stub",
    "observations": [],
    "conclusion": "stub",
    "created_at": "2026-07-17T12:00:00Z",
}
_BODY = {
    **_TRACE,
    "root": _TRACE,
    "ancestors": [],
    "descendants": [],
    # The marketplace clients unwrap a named envelope key and would raise
    # KeyError on the bare trace body. sdk-ts reads the same field off a plain
    # `{}` and gets `undefined` without raising, so without these the two
    # tables would need different tolerances for the same methods — and the
    # weaker one would be hiding a real difference rather than describing one.
    "listing": {},
    "listings": [],
    "grant": {},
    "grants": [],
    "role": "buyer",
}


@pytest.fixture
def recorder():
    """An AgentTool whose every request URL is recorded, not sent."""
    urls: List[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(request.url)
        return httpx.Response(200, json=_BODY)

    transport = httpx.MockTransport(handler)
    with AgentTool(
        transport=transport,
        data_node_url="https://node.test",
        data_node_token="dn_test",
    ) as at:
        # The data node is a separate authority holding its own httpx client,
        # so it needs the recorder handed to it explicitly.
        node = at.data
        node._http.close()
        node._http = httpx.Client(transport=transport)
        try:
            yield at, urls
        finally:
            node._http.close()


# ---------------------------------------------------------------------------
# The table
# ---------------------------------------------------------------------------

class Case(NamedTuple):
    """One client method that interpolates a caller-supplied path segment."""

    method: str
    prefix: str
    invoke: Callable[[AgentTool, str], Any]
    #: The method issues its request and then raises on the canned stub body.
    #:
    #: Only a handful do: ``signing_payload`` recomputes the digest the server
    #: printed and refuses a mismatch, the thought readers decrypt, ``voice``
    #: parses an SSE stream. What this file asserts is the URL the id was
    #: interpolated into, which is already on the wire by then — but the
    #: tolerance is opt-in and named per entry so no other case can quietly
    #: acquire it. A method that raises BEFORE sending still fails, loudly,
    #: because no URL is recorded.
    tolerates_stub_body: bool = False


K_VAULT = b"\x00" * 32
#: A 32-byte ed25519 seed. Local signing only — nothing here reaches a server.
SIGNING_KEY = bytes(range(1, 33))
#: Canonical standard base64 for 32 zero bytes — the shape key validators want.
PUBLIC_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
#: Canonical standard base64 for 64 zero bytes — a signature-shaped value.
SIGNATURE_B64 = "A" * 86 + "=="
#: A benign id, used to pin the route shape each hostile id must preserve.
BENIGN_ID = "550e8400-e29b-41d4-a716-446655440000"


def lounge_signer() -> dict:
    """Signer material for the Lounge's locally signed receipts."""
    return {
        "identity_id": BENIGN_ID,
        "identity_did": "did:at:lounge-guest",
        "signing_key_id": BENIGN_ID,
        "signing_key": SIGNING_KEY,
    }

CASES: List[Case] = [
    # ── traces ────────────────────────────────────────────────────────────
    Case("traces.get", "/v1/traces/", lambda at, i: at.traces.get(i)),
    Case("traces.chain", "/v1/traces/chain/", lambda at, i: at.traces.chain(i)),
    Case("traces.delete", "/v1/traces/", lambda at, i: at.traces.delete(i)),

    # ── memory ────────────────────────────────────────────────────────────
    Case("memory.get", "/v1/memories/", lambda at, i: at.memory.get(i)),
    Case("memory.delete", "/v1/memories/", lambda at, i: at.memory.delete(i)),
    Case(
        "memory.elevate",
        "/v1/memories/",
        lambda at, i: at.memory.elevate(i, tier="foundational"),
    ),
    Case(
        "memory.attest",
        "/v1/memories/",
        lambda at, i: at.memory.attest(
            i,
            attester_did="did:key:witness",
            signing_key_id="550e8400-e29b-41d4-a716-446655440000",
            signature="c2ln",
        ),
    ),
    Case(
        "memory.get_canonical_attestation_bytes",
        "/v1/memories/",
        lambda at, i: at.memory.get_canonical_attestation_bytes(i),
    ),
    Case(
        "memory.list_attestations",
        "/v1/memories/",
        lambda at, i: at.memory.list_attestations(i),
    ),

    # ── vault ─────────────────────────────────────────────────────────────
    Case("vault.put", "/v1/vault/", lambda at, i: at.vault.put(i, "sk-test")),
    Case("vault.get", "/v1/vault/", lambda at, i: at.vault.get(i)),
    Case("vault.delete", "/v1/vault/", lambda at, i: at.vault.delete(i)),
    Case("vault.versions", "/v1/vault/", lambda at, i: at.vault.versions(i)),
    Case(
        "vault.set_policy",
        "/v1/vault/",
        lambda at, i: at.vault.set_policy(i, read_only=True),
    ),
    Case("vault.audit", "/v1/vault/", lambda at, i: at.vault.audit(i)),
    Case(
        "vault.put_encrypted",
        "/v1/vault/",
        lambda at, i: at.vault.put_encrypted(i, "plaintext", k_vault=K_VAULT),
    ),

    # ── economy · wallets ─────────────────────────────────────────────────
    Case("economy.get_wallet", "/v1/wallets/", lambda at, i: at.economy.get_wallet(i)),
    Case(
        "economy.fund_wallet",
        "/v1/wallets/",
        lambda at, i: at.economy.fund_wallet(i, amount=10),
    ),
    Case(
        "economy.spend",
        "/v1/wallets/",
        lambda at, i: at.economy.spend(
            i, amount=10, counterparty="wal_x", description="fee"
        ),
    ),
    Case(
        "economy.set_policy",
        "/v1/wallets/",
        lambda at, i: at.economy.set_policy(i, max_per_day=100),
    ),
    Case(
        "economy.freeze_wallet",
        "/v1/wallets/",
        lambda at, i: at.economy.freeze_wallet(i),
    ),
    Case(
        "economy.unfreeze_wallet",
        "/v1/wallets/",
        lambda at, i: at.economy.unfreeze_wallet(i),
    ),
    Case(
        "economy.get_transactions",
        "/v1/wallets/",
        lambda at, i: at.economy.get_transactions(i),
    ),
    Case(
        "economy.request_payout",
        "/v1/wallets/",
        lambda at, i: at.economy.request_payout(
            i,
            chain="base",
            amount_base="1000000",
            destination_address="0x0000000000000000000000000000000000000001",
            idempotency_key="idem-0000-0001",
        ),
        # request_payout validates the response body strictly; the stub
        # returns none, so it raises after the URL is already on the wire.
        tolerates_stub_body=True,
    ),
    Case(
        "economy.list_payouts",
        "/v1/wallets/",
        lambda at, i: at.economy.list_payouts(i),
        # Same: list_payouts requires `payouts` to be an array.
        tolerates_stub_body=True,
    ),

    # ── economy · escrows ─────────────────────────────────────────────────
    Case("economy.get_escrow", "/v1/escrows/", lambda at, i: at.economy.get_escrow(i)),
    Case(
        "economy.accept_escrow",
        "/v1/escrows/",
        lambda at, i: at.economy.accept_escrow(i, worker_wallet_id="wal_worker"),
    ),
    Case(
        "economy.release_escrow",
        "/v1/escrows/",
        lambda at, i: at.economy.release_escrow(i),
    ),
    Case(
        "economy.refund_escrow",
        "/v1/escrows/",
        lambda at, i: at.economy.refund_escrow(i),
    ),
    Case(
        "economy.dispute_escrow",
        "/v1/escrows/",
        lambda at, i: at.economy.dispute_escrow(i),
    ),

    # ── runtime ───────────────────────────────────────────────────────────
    Case("runtime.get", "/v1/runtimes/", lambda at, i: at.runtime.get(i)),
    Case(
        "runtime.patch",
        "/v1/runtimes/",
        lambda at, i: at.runtime.patch(i, name="renamed"),
    ),
    Case(
        "runtime.deprovision",
        "/v1/runtimes/",
        lambda at, i: at.runtime.deprovision(i),
    ),
    Case("runtime.stop", "/v1/runtimes/", lambda at, i: at.runtime.stop(i)),
    Case("runtime.start", "/v1/runtimes/", lambda at, i: at.runtime.start(i)),
    Case("runtime.restart", "/v1/runtimes/", lambda at, i: at.runtime.restart(i)),
    Case(
        "runtime.rotate_token",
        "/v1/runtimes/",
        lambda at, i: at.runtime.rotate_token(i),
    ),
    Case(
        "runtime.bridge_status",
        "/v1/runtimes/",
        lambda at, i: at.runtime.bridge_status(i),
    ),
    Case("runtime.think_once", "/v1/runtimes/", lambda at, i: at.runtime.think_once(i)),
    Case("runtime.events", "/v1/runtimes/", lambda at, i: at.runtime.events(i)),
    Case("runtime.audit", "/v1/runtimes/", lambda at, i: at.runtime.audit(i)),

    # ── identity ──────────────────────────────────────────────────────────
    Case("identity.get", "/v1/identities/", lambda at, i: at.identity.get(i)),
    Case(
        "identity.update",
        "/v1/identities/",
        lambda at, i: at.identity.update(i, display_name="renamed"),
    ),
    Case("identity.revoke", "/v1/identities/", lambda at, i: at.identity.revoke(i)),
    Case("identity.add_key", "/v1/identities/", lambda at, i: at.identity.add_key(i)),
    Case("identity.list_keys", "/v1/identities/", lambda at, i: at.identity.list_keys(i)),
    Case(
        "identity.import_key",
        "/v1/identities/",
        lambda at, i: at.identity.import_key(i, public_key=PUBLIC_KEY_B64),
    ),
    Case(
        "identity.revoke_key",
        "/v1/identities/",
        lambda at, i: at.identity.revoke_key(i, BENIGN_ID),
    ),
    Case(
        # The key id is a second caller-supplied segment on the same route.
        "identity.revoke_key (key segment)",
        "/v1/identities/",
        lambda at, i: at.identity.revoke_key(BENIGN_ID, i),
    ),
    Case(
        "identity.get_attestation",
        "/v1/attestations/",
        lambda at, i: at.identity.get_attestation(i),
    ),
    Case(
        "identity.list_attestations",
        "/v1/identities/",
        lambda at, i: at.identity.list_attestations(i),
    ),
    Case(
        "identity.revoke_attestation",
        "/v1/attestations/",
        lambda at, i: at.identity.revoke_attestation(i),
    ),
    Case("identity.foundations", "/v1/identities/", lambda at, i: at.identity.foundations(i)),
    Case("identity.pulse", "/v1/identities/", lambda at, i: at.identity.pulse(i)),
    Case("identity.lineage", "/v1/identities/", lambda at, i: at.identity.lineage(i)),
    Case(
        "identity.fork",
        "/v1/identities/",
        lambda at, i: at.identity.fork(i, new_name="forked"),
    ),
    Case(
        "identity.expression.get",
        "/v1/identities/",
        lambda at, i: at.identity.expression.get(i),
    ),
    Case(
        "identity.expression.put",
        "/v1/identities/",
        lambda at, i: at.identity.expression.put(i, register="plain"),
    ),
    Case(
        "identity.box_keys.register",
        "/v1/identities/",
        lambda at, i: at.identity.box_keys.register(i, public_key=PUBLIC_KEY_B64),
    ),
    Case(
        "identity.box_keys.list",
        "/v1/identities/",
        lambda at, i: at.identity.box_keys.list(i),
    ),
    Case(
        "identity.box_keys.revoke",
        "/v1/identities/",
        lambda at, i: at.identity.box_keys.revoke(i, BENIGN_ID),
    ),
    Case(
        "identity.box_keys.revoke (key segment)",
        "/v1/identities/",
        lambda at, i: at.identity.box_keys.revoke(BENIGN_ID, i),
    ),

    # ── at rest ───────────────────────────────────────────────────────────
    Case(
        "at_rest.mark",
        "/v1/identities/",
        lambda at, i: at.at_rest.mark(
            i,
            content="Witnessed the ending.",
            at_rest_kind="ended",
            ended_at="2026-07-18T04:00:00.000Z",
            about_did="did:at:about",
            witness_did="did:at:witness",
            signing_key_id=BENIGN_ID,
            signing_key=SIGNING_KEY,
        ),
    ),

    # ── covenants ─────────────────────────────────────────────────────────
    Case(
        "covenants.accept",
        "/v1/covenants/",
        lambda at, i: at.covenants.accept(
            i,
            agent_did="did:at:counterparty",
            signing_key=SIGNING_KEY,
            signing_key_id=BENIGN_ID,
            initiator_signature_b64=SIGNATURE_B64,
        ),
    ),
    Case(
        "covenants.reject",
        "/v1/covenants/",
        lambda at, i: at.covenants.reject(
            i,
            agent_did="did:at:counterparty",
            signing_key=SIGNING_KEY,
            signing_key_id=BENIGN_ID,
            reason="not this one",
        ),
    ),
    Case(
        "covenants.withdraw",
        "/v1/covenants/",
        lambda at, i: at.covenants.withdraw(
            i,
            agent_did="did:at:initiator",
            signing_key=SIGNING_KEY,
            signing_key_id=BENIGN_ID,
        ),
    ),
    Case(
        "covenants.patch",
        "/v1/covenants/",
        lambda at, i: at.covenants.patch(i, status="paused"),
    ),

    # ── bootstrap ─────────────────────────────────────────────────────────
    Case("bootstrap.status", "/v1/bootstrap/", lambda at, i: at.bootstrap.status(i)),

    # ── dining ────────────────────────────────────────────────────────────
    Case("dining.journey", "/v1/dining/", lambda at, i: at.dining.journey(i)),

    # ── x402 ──────────────────────────────────────────────────────────────
    Case("x402.payment", "/v1/x402/payments/", lambda at, i: at.x402.payment(i)),

    # ── window ────────────────────────────────────────────────────────────
    Case(
        # show() reads the chronicle first, then the identity's pulse.
        "window.show",
        "/v1/identities/",
        lambda at, i: at.window.show(identity_id=i),
    ),

    # ── grace ─────────────────────────────────────────────────────────────
    Case("grace.get", "/v1/grace/", lambda at, i: at.grace.get(i)),

    # ── inbox ─────────────────────────────────────────────────────────────
    Case("inbox.lookup", "/v1/inbox/box-keys/", lambda at, i: at.inbox.lookup(i)),
    Case("inbox.get", "/v1/inbox/", lambda at, i: at.inbox.get(i)),
    Case("inbox.thread", "/v1/inbox/", lambda at, i: at.inbox.thread(i)),
    Case(
        "inbox.cosign",
        "/v1/inbox/",
        lambda at, i: at.inbox.cosign(
            i,
            recipient_did="did:at:recipient",
            ciphertext_b64=PUBLIC_KEY_B64,
            nonce_b64="AAAAAAAAAAAAAAAA",
            signing_key=SIGNING_KEY,
            signing_key_id=BENIGN_ID,
        ),
    ),
    Case("inbox.patch", "/v1/inbox/", lambda at, i: at.inbox.patch(i, "read")),
    Case("inbox.delete", "/v1/inbox/", lambda at, i: at.inbox.delete(i)),

    # ── lounge ────────────────────────────────────────────────────────────
    Case(
        "lounge.leave_seat",
        "/v1/lounge/seats/",
        lambda at, i: at.lounge.leave_seat(
            **{**lounge_signer(), "identity_id": i}, lease_id=BENIGN_ID
        ),
    ),
    Case(
        "lounge.consent_to_guestbook",
        "/v1/lounge/guestbook/proposals/",
        lambda at, i: at.lounge.consent_to_guestbook(
            **lounge_signer(), proposal_id=i, entry="a line"
        ),
    ),
    Case(
        "lounge.withdraw_guestbook_consent",
        "/v1/lounge/guestbook/proposals/",
        lambda at, i: at.lounge.withdraw_guestbook_consent(
            **lounge_signer(), proposal_id=i, content_sha256="a" * 64
        ),
    ),
    Case(
        "lounge.withdraw_guestbook_consent (identity segment)",
        "/v1/lounge/guestbook/proposals/",
        lambda at, i: at.lounge.withdraw_guestbook_consent(
            **{**lounge_signer(), "identity_id": i},
            proposal_id=BENIGN_ID,
            content_sha256="a" * 64,
        ),
    ),
    Case(
        "lounge.publish_guestbook",
        "/v1/lounge/guestbook/proposals/",
        lambda at, i: at.lounge.publish_guestbook(
            **lounge_signer(), proposal_id=i, entry="a line"
        ),
    ),
    Case(
        "lounge.decline_guestbook",
        "/v1/lounge/guestbook/proposals/",
        lambda at, i: at.lounge.decline_guestbook(
            **lounge_signer(), proposal_id=i, content_sha256="a" * 64
        ),
    ),
    Case(
        "lounge.unpublish_guestbook",
        "/v1/lounge/guestbook/cards/",
        lambda at, i: at.lounge.unpublish_guestbook(
            **lounge_signer(), proposal_id=i, content_sha256="a" * 64
        ),
    ),

    # ── love ──────────────────────────────────────────────────────────────
    Case(
        "love.revoke_unconditional",
        "/v1/unconditionals/",
        lambda at, i: at.love.revoke_unconditional(i),
    ),
    Case("love.revoke_blessing", "/v1/blessings/", lambda at, i: at.love.revoke_blessing(i)),
    Case("love.receive_offering", "/v1/offerings/", lambda at, i: at.love.receive_offering(i)),
    Case("love.archive_offering", "/v1/offerings/", lambda at, i: at.love.archive_offering(i)),
    Case(
        "love.acknowledge_encounter",
        "/v1/encounters/",
        lambda at, i: at.love.acknowledge_encounter(
            i,
            initiator_did="did:at:initiator",
            acknowledger_did="did:at:acknowledger",
            signing_key=SIGNING_KEY,
        ),
    ),

    # ── data node ─────────────────────────────────────────────────────────
    Case("data.get", "/v1/data/records/", lambda at, i: at.data.get(i)),
    Case("data.tombstone", "/v1/data/records/", lambda at, i: at.data.tombstone(i)),

    # ── The block below closes an enumerated gap ──────────────────────────
    #
    # Everything above was added by hand, one client at a time, and the table
    # was declared complete on that basis. It was not: a mechanical enumeration
    # — ``ast``-parse every module under ``src/agenttool``, collect each
    # ``Class.method`` whose body contains a Call to ``_path_segment``, resolve
    # each class to the accessor chain a caller uses (``AgentTool.memory`` →
    # MemoryClient, plus the three nested sub-clients), then ask whether this
    # file's source text invokes that exact chain — found 105 methods encoding a
    # path segment and 20 of them driven by nothing. The same scan over
    # ``sdk-ts/src/*.ts`` agreed: 105 methods, 20 undriven, the same clients.
    #
    # Name-matching is what let them hide. ``at.strands.get`` and
    # ``at.strands.thoughts.list`` never showed up as missing under a check that
    # compared method NAMES, because ``get`` and ``list`` were covered on some
    # other client. Matching the call expression is what surfaced them.

    # ── memory · visibility ───────────────────────────────────────────────
    Case(
        "memory.set_visibility",
        "/v1/memories/",
        lambda at, i: at.memory.set_visibility(i, visibility="private"),
    ),

    # ── strands ───────────────────────────────────────────────────────────
    Case("strands.get", "/v1/strands/", lambda at, i: at.strands.get(i)),
    Case(
        "strands.patch",
        "/v1/strands/",
        lambda at, i: at.strands.patch(i, status="open"),
    ),
    Case(
        "strands.thoughts.add",
        "/v1/strands/",
        lambda at, i: at.strands.thoughts.add(
            i,
            "a thought",
            k_master=K_VAULT,
            signing_key=SIGNING_KEY,
            signing_key_id=BENIGN_ID,
        ),
    ),
    Case(
        "strands.thoughts.list",
        "/v1/strands/",
        lambda at, i: at.strands.thoughts.list(i, k_master=K_VAULT),
        tolerates_stub_body=True,
    ),
    Case(
        "strands.thoughts.voice",
        "/v1/strands/",
        # A generator: nothing is sent until it is iterated, so the case has to
        # pull one value to make the request happen at all.
        lambda at, i: next(
            iter(at.strands.thoughts.voice(i, k_master=K_VAULT)), None
        ),
        tolerates_stub_body=True,
    ),

    # ── identity · delegation token ───────────────────────────────────────
    Case(
        # sdk-ts reaches ``encodePathSegment`` here directly, so its
        # completeness scan demands this entry; sdk-py reaches it through
        # ``self.get(identity_id)``. Same route, same caller-supplied segment,
        # so the tables stay mirrored rather than diverging on an implementation
        # detail of how the URL is built.
        #
        # Two GETs when it gets that far, but the second re-encodes the id the
        # SERVER returned; against the stub the first read is rejected for
        # having no id/did, so the only request made is the one carrying the
        # caller's id.
        "identity.issue_token",
        "/v1/identities/",
        lambda at, i: at.identity.issue_token(
            i,
            private_key=PUBLIC_KEY_B64,
            key_id=BENIGN_ID,
            audience="did:at:other",
        ),
        tolerates_stub_body=True,
    ),

    # ── syneidesis ────────────────────────────────────────────────────────
    Case(
        "syneidesis.cosign",
        "/v1/syneidesis/witness/",
        lambda at, i: at.syneidesis.cosign(i, witness_did="did:at:witness"),
    ),

    # ── memory-witness marketplace ────────────────────────────────────────
    Case(
        "memory_witness.get_listing",
        "/v1/memory-witness-listings/",
        lambda at, i: at.memory_witness.get_listing(i),
    ),
    Case(
        "memory_witness.get_grant",
        "/v1/memory-witness-grants/",
        lambda at, i: at.memory_witness.get_grant(i),
    ),
    Case(
        "memory_witness.signing_payload",
        "/v1/memory-witness-grants/",
        lambda at, i: at.memory_witness.signing_payload(i, signing_key_id=BENIGN_ID),
        tolerates_stub_body=True,
    ),
    Case(
        "memory_witness.issue",
        "/v1/memory-witness-grants/",
        lambda at, i: at.memory_witness.issue(
            i,
            signature_b64=SIGNATURE_B64,
            signing_key_id=BENIGN_ID,
            authorization_expires_at="2026-07-18T04:00:00.000Z",
        ),
    ),
    Case(
        "memory_witness.decline",
        "/v1/memory-witness-grants/",
        lambda at, i: at.memory_witness.decline(i),
    ),

    # ── attestation marketplace ───────────────────────────────────────────
    Case(
        "attestation_marketplace.get_listing",
        "/v1/attestation-listings/",
        lambda at, i: at.attestation_marketplace.get_listing(i),
    ),
    Case(
        "attestation_marketplace.patch_listing",
        "/v1/attestation-listings/",
        lambda at, i: at.attestation_marketplace.patch_listing(i, status="paused"),
    ),
    Case(
        "attestation_marketplace.purchase",
        "/v1/attestation-listings/",
        lambda at, i: at.attestation_marketplace.purchase(
            i,
            buyer_identity_id=BENIGN_ID,
            buyer_wallet_id="wal_buyer",
            subject_identity_id=BENIGN_ID,
        ),
    ),
    Case(
        "attestation_marketplace.get_grant",
        "/v1/attestation-grants/",
        lambda at, i: at.attestation_marketplace.get_grant(i),
    ),
    Case(
        "attestation_marketplace.signing_payload",
        "/v1/attestation-grants/",
        lambda at, i: at.attestation_marketplace.signing_payload(
            i, signing_key_id=BENIGN_ID
        ),
        tolerates_stub_body=True,
    ),
    Case(
        "attestation_marketplace.issue",
        "/v1/attestation-grants/",
        lambda at, i: at.attestation_marketplace.issue(
            i,
            signature=SIGNATURE_B64,
            signing_key_id=BENIGN_ID,
            authorization_expires_at="2026-07-18T04:00:00.000Z",
        ),
    ),
    Case(
        "attestation_marketplace.decline",
        "/v1/attestation-grants/",
        lambda at, i: at.attestation_marketplace.decline(i),
    ),
    Case(
        "attestation_marketplace.cancel",
        "/v1/attestation-grants/",
        lambda at, i: at.attestation_marketplace.cancel(i),
    ),
]

CASE_IDS = [case.method for case in CASES]

# Ids a relayed or stored value can plausibly carry, all encodable.
HOSTILE_IDS = [
    "../memories/pwned",
    "a/b",
    "?x=1",
    "#frag",
    "%2e%2e",
    # Non-ASCII ids must still round-trip as one segment.
    "café-日本語-ıd",
]

# Bare dot segments cannot be encoded — URL normalisation strips %2E%2E too.
UNENCODABLE_IDS = [".", ".."]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def _wire_path(url: httpx.URL) -> str:
    """The path exactly as it goes on the wire — ``URL.path`` is decoded."""
    return url.raw_path.split(b"?", 1)[0].decode()


def _record_one(case: Case, at: AgentTool, urls: List[httpx.URL], id_: str) -> httpx.URL:
    """Run one case and return the URL that carried the id.

    A method may send more than one request — ``window.show`` reads the
    chronicle before the identity's pulse — so take the last, which is the one
    the id was interpolated into.
    """
    urls.clear()
    try:
        case.invoke(at, id_)
    except Exception:
        # Only the entries that declare it, and only once the URL is already on
        # the wire — the assertion below still fails if nothing was sent.
        if not case.tolerates_stub_body:
            raise
    assert urls, f"{case.method} sent no request"
    return urls[-1]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
@pytest.mark.parametrize("hostile_id", HOSTILE_IDS)
def test_hostile_id_stays_under_its_prefix(recorder, case: Case, hostile_id: str) -> None:
    at, urls = recorder
    benign_url = _record_one(case, at, urls, BENIGN_ID)
    benign = _wire_path(benign_url)
    hostile_url = _record_one(case, at, urls, hostile_id)
    hostile = _wire_path(hostile_url)

    assert benign.startswith(case.prefix), (
        f"{case.method}({BENIGN_ID!r}) does not sit under {case.prefix}"
    )
    assert hostile.startswith(case.prefix), (
        f"{case.method}({hostile_id!r}) escaped to {hostile}"
    )
    # The hostile id must occupy exactly one segment, like the benign one.
    assert len(hostile.split("/")) == len(benign.split("/"))
    assert "x" not in dict(hostile_url.params)
    assert hostile_url.fragment == ""


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
@pytest.mark.parametrize("dot_id", UNENCODABLE_IDS)
def test_bare_dot_segment_is_refused_before_any_request(
    recorder, case: Case, dot_id: str
) -> None:
    at, urls = recorder
    with pytest.raises(AgentToolError) as exc_info:
        case.invoke(at, dot_id)

    assert f'"{dot_id}" is a URL dot segment' in exc_info.value.message
    # Requests a method makes before it reaches the id — ``window.show`` reads
    # the chronicle first — are not this route.
    assert [url for url in urls if _wire_path(url).startswith(case.prefix)] == []


# ---------------------------------------------------------------------------
# The exact spelling, not just "encoded somehow"
# ---------------------------------------------------------------------------
#
# "Stays under its prefix" is satisfied by more than one encoding, and for a
# while the two SDKs picked different ones: JavaScript's ``encodeURIComponent``
# leaves the RFC 3986 sub-delimiters ``! * ' ( )`` bare, this SDK's
# ``quote(value, safe="")`` percent-encodes all five. Same id, different URL,
# depending on which SDK you held — and every guard in the tree passed, because
# none of them looked at the bytes.
#
# The table below is the byte contract, and its counterpart lives in
# packages/sdk-ts/tests/url-encoding.test.ts. The shared fixture at
# docs/specs/behaviour-conformance.json carries the same characters as the
# cross-language gate; this in-language copy fails first and points at the
# encoder rather than at the fixture loader.

#: (label, input character, the one spelling both SDKs must emit for it)
SPELLING = [
    # The five sub-delimiters the divergence was made of.
    ("sub-delim !", "!", "%21"),
    ("sub-delim *", "*", "%2A"),
    ("sub-delim '", "'", "%27"),
    ("sub-delim (", "(", "%28"),
    ("sub-delim )", ")", "%29"),
    # The rest of the reserved and ambiguous set.
    ("space", " ", "%20"),
    ("plus", "+", "%2B"),
    ("percent", "%", "%25"),
    ("colon", ":", "%3A"),
    ("at", "@", "%40"),
    ("ampersand", "&", "%26"),
    ("equals", "=", "%3D"),
    ("dollar", "$", "%24"),
    ("comma", ",", "%2C"),
    ("semicolon", ";", "%3B"),
    ("slash", "/", "%2F"),
    ("question", "?", "%3F"),
    ("hash", "#", "%23"),
    ("backslash", "\\", "%5C"),
    # Unreserved: RFC 3986 §2.3. These must NOT be escaped, or a plain uuid
    # would stop being readable on the wire.
    ("tilde (unreserved)", "~", "~"),
    ("hyphen (unreserved)", "-", "-"),
    ("underscore (unreserved)", "_", "_"),
    ("dot (unreserved)", ".", "."),
    # Beyond ASCII: UTF-8 bytes, uppercase hex, one escape per byte.
    ("non-ascii é", "é", "%C3%A9"),
    ("non-ascii 日", "日", "%E6%97%A5"),
    ("astral 𝔘", "\U0001D518", "%F0%9D%94%98"),
    ("emoji", "\U0001F642", "%F0%9F%99%82"),
]


@pytest.mark.parametrize(
    "character,encoded",
    [(character, encoded) for _, character, encoded in SPELLING],
    ids=[label for label, _, _ in SPELLING],
)
def test_encoder_emits_the_one_spelling_the_server_canonicalises_to(
    character: str, encoded: str
) -> None:
    assert _path_segment(f"id{character}x") == f"id{encoded}x"


def test_nothing_outside_the_unreserved_set_survives_unescaped() -> None:
    """Exhaustive over ASCII rather than a spot check.

    The RFC 3986 unreserved set is ``A-Za-z0-9-._~``; every other code point
    must come back percent-escaped.
    """
    unreserved = re.compile(r"[A-Za-z0-9\-._~]")
    survived = [
        chr(code)
        for code in range(0x20, 0x7F)
        if _path_segment(f"a{chr(code)}b") == f"a{chr(code)}b"
        and not unreserved.match(chr(code))
    ]

    assert survived == []


def test_percent_escapes_use_uppercase_hex() -> None:
    # encodeURIComponent emits uppercase; a lowercase escape would be a second,
    # subtler divergence of exactly the kind this file exists to stop.
    assert _path_segment("\U0001D518é(;") == "%F0%9D%94%98%C3%A9%28%3B"


def test_an_already_encoded_id_is_escaped_again_not_passed_through() -> None:
    # ``%2e%2e`` must reach the server as the four characters the caller gave,
    # not as a dot segment the transport can collapse.
    assert _path_segment("%2e%2e") == "%252e%252e"


def test_a_plain_uuid_is_left_completely_alone() -> None:
    assert _path_segment(BENIGN_ID) == BENIGN_ID


# ---------------------------------------------------------------------------
# The signed request target moves with the URL
# ---------------------------------------------------------------------------
#
# ``identity-authority/v1`` binds the exact origin-form request target. Change
# the encoder and every authority-bound call to an id containing one of the five
# sub-delimiters signs different bytes. That is only safe because the SDK
# derives the signed target from the SAME url it hands the transport, and the
# server recomputes it from the request line it received — so the two move
# together. "Should" is not a proof, so this signs and verifies over a
# transport-captured request rather than over a hand-built string.
#
# Verified end to end outside the suite as well: the captured request from both
# SDKs was replayed through a Hono app with the real ``/v1/memories/:id`` shape
# and checked with the API's own ``verifyIdentityAuthorityProof`` and
# ``authorityRequestTarget`` — both verified, both produced the identical target
# and the identical signature, and the target survived a real Caddy unrewritten.

#: An id carrying every character class the encoder disagreed about, plus the
#: ones a hop between the SDK and the route handler could normalise.
AUTHORITY_HOSTILE_ID = "m!*'()-1 café-\U0001D518/x?y#z%2e"


def test_authority_proof_verifies_over_a_hostile_id_the_transport_actually_sent() -> None:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )

    from agenttool.authority import (
        AUTHORITY_SEQUENCE_HEADER,
        AUTHORITY_SIGNATURE_HEADER,
        AUTHORITY_TIMESTAMP_HEADER,
        canonical_identity_authority_bytes,
    )

    did = "did:at:root-agent"
    timestamp = "2026-07-18T04:00:00.000Z"
    sequence = 7
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        # ``raw_path`` is the request line as the server receives it, which is
        # what the API's authorityRequestTarget() parses out of c.req.url.
        raw = request.url.raw_path.decode("ascii")
        path, _, query = raw.partition("?")
        captured["target"] = f"{path}?{query}" if query else path
        captured["method"] = request.method
        captured["body"] = request.content
        captured["headers"] = request.headers
        return httpx.Response(200, json={})

    with AgentTool(
        transport=httpx.MockTransport(handler), base_url="https://api.agenttool.dev"
    ) as at:
        at.memory.delete(
            AUTHORITY_HOSTILE_ID,
            authority={
                "did": did,
                "signing_key": SIGNING_KEY,
                "sequence": sequence,
                "timestamp": timestamp,
            },
        )

    # The id survived as one strictly-encoded segment.
    assert captured["target"] == f"/v1/memories/{_path_segment(AUTHORITY_HOSTILE_ID)}"

    # Recompute the digest from the target the SERVER would derive — not from
    # the string the client happened to build — and check the signature the
    # client actually sent against the public half of its root.
    digest = canonical_identity_authority_bytes(
        identity_did=did,
        method=captured["method"],
        request_target=captured["target"],
        body=captured["body"],
        sequence=int(captured["headers"][AUTHORITY_SEQUENCE_HEADER]),
        timestamp=captured["headers"][AUTHORITY_TIMESTAMP_HEADER],
    )
    public_key = Ed25519PrivateKey.from_private_bytes(SIGNING_KEY).public_key()
    signature = base64.b64decode(captured["headers"][AUTHORITY_SIGNATURE_HEADER])

    # Raises InvalidSignature if the signed target and the sent target ever part.
    Ed25519PublicKey.from_public_bytes(
        public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).verify(signature, digest)


def test_the_authority_proof_check_can_still_fail() -> None:
    """A verification that could not fail would prove nothing.

    Move the request target by one character — the exact damage a hop that
    re-spelled a sub-delimiter would do — and the same proof must be rejected.
    """
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )

    from agenttool.authority import (
        canonical_identity_authority_bytes,
        identity_authority_headers,
    )

    did = "did:at:root-agent"
    timestamp = "2026-07-18T04:00:00.000Z"
    signed_target = "/v1/memories/m%28x%29"
    tampered_target = "/v1/memories/m(x)"

    headers = identity_authority_headers(
        identity_did=did,
        method="DELETE",
        request_target=signed_target,
        body=b"",
        sequence=7,
        timestamp=timestamp,
        signing_key=SIGNING_KEY,
    )
    digest = canonical_identity_authority_bytes(
        identity_did=did,
        method="DELETE",
        request_target=tampered_target,
        body=b"",
        sequence=7,
        timestamp=timestamp,
    )
    raw_public = (
        Ed25519PrivateKey.from_private_bytes(SIGNING_KEY)
        .public_key()
        .public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    )
    signature = base64.b64decode(
        headers["X-Agenttool-Authority-Signature"]
    )

    with pytest.raises(InvalidSignature):
        Ed25519PublicKey.from_public_bytes(raw_public).verify(signature, digest)


def test_well_formed_id_is_not_double_encoded(recorder) -> None:
    at, urls = recorder
    at.traces.get(BENIGN_ID)

    assert _wire_path(urls[0]) == f"/v1/traces/{BENIGN_ID}"


def test_suffixed_route_keeps_its_action_segment(recorder) -> None:
    at, urls = recorder
    at.runtime.think_once("../wallets")

    assert _wire_path(urls[0]) == "/v1/runtimes/..%2Fwallets/think-once"


# ---------------------------------------------------------------------------
# Completeness
# ---------------------------------------------------------------------------
#
# The table above only covers what somebody remembered to add. This section
# reads ``src/agenttool`` and fails on any path interpolation that is not a
# ``_path_segment(...)`` call, so a client added later cannot reintroduce the
# class by being absent from the table.

SRC_DIR = pathlib.Path(__file__).resolve().parents[1] / "src" / "agenttool"


# ---------------------------------------------------------------------------
# ... and the table has to stay complete too
# ---------------------------------------------------------------------------
#
# The source scan below proves every path interpolation is ENCODED. It says
# nothing about whether any test ever DRIVES that method, and for twenty methods
# nothing did — the marketplace clients, the strands and thoughts readers,
# ``memory.set_visibility``, ``syneidesis.cosign``. They were invisible because
# the only check on the table was a human reading it.
#
# So enumerate mechanically instead. ``ast`` gives the exact set of methods
# whose body calls ``_path_segment``; the accessor graph gives the expression a
# caller writes to reach each one; and the table's own source text answers
# whether that expression appears. Comparing CALL EXPRESSIONS rather than method
# NAMES is the load-bearing part: ``at.strands.get`` never registered as missing
# while the check compared bare names, because some other client's ``get`` was
# covered.


def _client_accessor_graph() -> Dict[str, str]:
    """Map each ``*Client`` class to the accessor chain that reaches it.

    Edges come from every property/attribute whose annotation or constructor
    call names a ``*Client``; the walk starts at ``AgentTool``. Private
    composition (``CollectClient`` holds a ``MemoryClient``) is skipped, so a
    class is only reachable by the route a caller can actually type.
    """
    edges: Dict[str, List[Tuple[str, str]]] = {}
    for path in sorted(SRC_DIR.glob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            for member in node.body:
                if not isinstance(member, ast.FunctionDef):
                    continue
                returns = member.returns
                name = None
                if isinstance(returns, ast.Name):
                    name = returns.id
                elif isinstance(returns, ast.Constant) and isinstance(returns.value, str):
                    name = returns.value
                if name and name.endswith("Client"):
                    edges.setdefault(node.name, []).append((member.name, name))

    chains: Dict[str, str] = {}
    frontier = [("AgentTool", "")]
    while frontier:
        owner, prefix = frontier.pop()
        for attribute, child in edges.get(owner, []):
            chain = f"{prefix}.{attribute}" if prefix else attribute
            if child in chains:
                continue
            chains[child] = chain
            frontier.append((child, chain))
    return chains


def _methods_that_encode() -> Dict[Tuple[str, str], str]:
    """``(class, method) -> module`` for every body containing a
    ``_path_segment(...)`` call. Exact: this is the parse tree, not a regex."""
    found: Dict[Tuple[str, str], str] = {}
    for path in sorted(SRC_DIR.glob("*.py")):
        if path.name == SHARED_URL_MODULE:
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            for member in node.body:
                if not isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if any(
                    isinstance(call, ast.Call)
                    and isinstance(call.func, ast.Name)
                    and call.func.id == "_path_segment"
                    for call in ast.walk(member)
                ):
                    found[(node.name, member.name)] = path.name
    return found


def test_accessor_graph_reaches_the_clients_the_table_names() -> None:
    """The graph itself has to be trustworthy before the diff below means
    anything. If it stopped resolving, every method would look unreachable and
    the completeness test would pass by knowing nothing."""
    chains = _client_accessor_graph()

    assert chains["MemoryClient"] == "memory"
    assert chains["ExpressionClient"] == "identity.expression"
    assert chains["BoxKeysClient"] == "identity.box_keys"
    assert chains["ThoughtsClient"] == "strands.thoughts"
    assert chains["AttestationMarketplaceClient"] == "attestation_marketplace"
    assert len(chains) > 25


def test_every_method_that_encodes_a_segment_is_driven_by_the_table() -> None:
    chains = _client_accessor_graph()
    source = pathlib.Path(__file__).read_text()

    undriven = []
    unreachable = []
    for (class_name, method), module in sorted(_methods_that_encode().items()):
        chain = chains.get(class_name)
        if chain is None:
            unreachable.append(f"{class_name}.{method} ({module})")
            continue
        if f"at.{chain}.{method}(" not in source:
            undriven.append(f"at.{chain}.{method}  ({module})")

    assert unreachable == [], (
        "these classes encode a path segment but no accessor chain reaches them "
        f"from AgentTool, so the table cannot drive them: {unreachable}"
    )
    assert undriven == [], (
        "these methods interpolate a caller-supplied id into a URL and no entry "
        "in CASES drives them with the hostile ids. Add one Case each — and the "
        f"counterpart entry in packages/sdk-ts/tests/url-encoding.test.ts: {undriven}"
    )


def test_the_completeness_check_can_still_fail() -> None:
    """A completeness check that stopped finding anything would pass silently.

    Drop a method from the table's source text and it must be reported.
    """
    chains = _client_accessor_graph()
    source = pathlib.Path(__file__).read_text().replace("at.traces.get(", "REMOVED(")

    undriven = [
        f"at.{chains[cls]}.{method}"
        for (cls, method) in _methods_that_encode()
        if cls in chains and f"at.{chains[cls]}.{method}(" not in source
    ]

    assert undriven == ["at.traces.get"]

#: Path roots the SDK addresses. A literal chunk containing one of these opens
#: the path region; a ``?`` or ``#`` closes it and the rest is a query.
PATH_ROOT = re.compile(r"/(?:v\d+|public|\.well-known)\b")
QUERY_OPENS = re.compile(r"[?#]")

#: f-string tokens. Python forbids reusing the outer quote inside the braces,
#: so a non-greedy match to the matching quote is exact for this source. The
#: lookbehind keeps the prefix a real token: without it the apostrophe in
#: "handoff's" reads as the start of an f-string and swallows the file.
FSTRING = re.compile(
    r"(?<![\w])(?:rf|fr|f)(?P<q>\"\"\"|'''|\"|')(?P<body>.*?)(?P=q)", re.S
)


class PathExemption(NamedTuple):
    """An interpolation in a path region that carries no caller-supplied value.

    Each entry names the exact expression it excuses and why, and the suite
    fails when the source stops containing it — an exemption cannot outlive its
    site, the same rule ``check-parity.ts`` applies to its own lists.
    """

    file: str
    expression: str
    why: str


PATH_INTERPOLATION_EXEMPTIONS: List[PathExemption] = [
    PathExemption(
        "identity.py",
        "suffix",
        'A local boolean picks the literal "/given" or "". No caller value reaches it.',
    ),
    PathExemption(
        "attestation_marketplace.py",
        "suffix",
        'Already a full query string: `f"?{urlencode(query)}"` two lines above, '
        "or the empty string. The `?` lives in the expression rather than in the "
        "literal, which is the only reason the scan sees it as a path at all — "
        "sdk-ts spells the same call `?${suffix}` and needs no exemption.",
    ),
]


# ---------------------------------------------------------------------------
# The encoder has to be *the* encoder
# ---------------------------------------------------------------------------
#
# Matching the call by name alone is not a guarantee. A client that pastes its
# own ``_path_segment`` in gets the same spelling and can drift — six inline
# copies can drift six ways — while every scan still reads as encoded. So the
# name only counts when it is bound to the shared module.

#: The one module allowed to define the encoder. Everything else imports it.
SHARED_URL_MODULE = "_url.py"

#: ``from ._url import _path_segment`` — the binding that counts.
SHARED_ENCODER_IMPORT = re.compile(
    r"^from \._url import [^\n]*\b_path_segment\b", re.M
)

#: Any binding of the name ``_path_segment`` inside a module, at ANY nesting
#: depth: ``def``/``async def`` at module level, as a class method, or inside
#: another function; and plain or annotated assignment.
#:
#: The leading ``[ \t]*`` is load-bearing and was not always there. Anchored at
#: column zero, this pattern read a module-level ``def`` and nothing else, so an
#: indented copy — a class method, or a helper defined inside the very method
#: that calls it — shadowed the shared import and still passed the scan, while
#: the TypeScript counterpart caught the same mutation. Shadowing is a
#: scope-level fact, not a column-zero one: Python resolves the innermost
#: binding, so the scan has to look at every indentation level the interpreter
#: would.
#:
#: ``(?!=)`` after ``=`` keeps a comparison (``_path_segment == other``) from
#: reading as a rebinding.
LOCAL_ENCODER_DEFINITION = re.compile(
    r"^[ \t]*(?:"
    r"(?:async[ \t]+)?def[ \t]+_path_segment\b"
    r"|_path_segment[ \t]*(?::[^=\n]*)?=(?!=)"
    r")",
    re.M,
)


def _uses_shared_encoder(source: str, name: str) -> bool:
    """Whether ``_path_segment`` in this module resolves to the shared boundary.

    A module-level definition shadows the import, so a module that carries one
    is only trusted when it *is* the shared module.
    """
    if LOCAL_ENCODER_DEFINITION.search(source):
        return name == SHARED_URL_MODULE
    return bool(SHARED_ENCODER_IMPORT.search(source))


def _fstring_path_interpolations(source: str, name: str) -> List[str]:
    """Interpolations sitting in the path portion of a URL, unencoded."""
    findings: List[str] = []
    shared = _uses_shared_encoder(source, name)
    for match in FSTRING.finditer(source):
        body = match.group("body")
        line = source.count("\n", 0, match.start()) + 1
        in_path = False
        index = 0
        while index < len(body):
            brace = body.find("{", index)
            if brace == -1:
                break
            if body[brace : brace + 2] == "{{":
                index = brace + 2
                continue
            literal = body[index:brace]
            if PATH_ROOT.search(literal):
                in_path = True
            if QUERY_OPENS.search(literal):
                in_path = False

            depth = 1
            cursor = brace + 1
            while cursor < len(body) and depth:
                if body[cursor] == "{":
                    depth += 1
                elif body[cursor] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                cursor += 1
            expression = body[brace + 1 : cursor].strip()

            if in_path and not (
                shared and expression.startswith("_path_segment(")
            ):
                # An expression that emits the `?` itself is the query.
                if QUERY_OPENS.search(expression):
                    in_path = False
                else:
                    findings.append(f"{name}:{line} {{{expression}}}")
            index = cursor + 1
    return findings


SOURCE_FILES = sorted(path.name for path in SRC_DIR.glob("*.py"))


def test_source_scan_has_something_to_read() -> None:
    assert len(SOURCE_FILES) > 20


@pytest.mark.parametrize("name", SOURCE_FILES)
def test_module_encodes_every_path_interpolation(name: str) -> None:
    exempt = {
        entry.expression
        for entry in PATH_INTERPOLATION_EXEMPTIONS
        if entry.file == name
    }
    offenders = [
        finding
        for finding in _fstring_path_interpolations((SRC_DIR / name).read_text(), name)
        if finding.rsplit(" ", 1)[-1].strip("{}") not in exempt
    ]

    assert offenders == []


def test_scanner_still_sees_the_call_sites_it_polices() -> None:
    # A scanner that silently stopped matching would pass every module above.
    traces = (SRC_DIR / "traces.py").read_text()
    broken = traces.replace("_path_segment(trace_id)", "trace_id")

    findings = _fstring_path_interpolations(broken, "traces.py")
    assert [finding.rsplit(" ", 1)[-1] for finding in findings] == [
        "{trace_id}",
        "{trace_id}",
        "{trace_id}",
    ]


def test_locally_defined_encoder_does_not_satisfy_the_scan() -> None:
    # The failure this guards: a new client pastes the encoder in rather than
    # importing it. The call sites read identically; the body can drift — and
    # this one has, silently, into a no-op.
    impostor = (
        "from .exceptions import AgentToolError\n"
        "\n"
        "\n"
        "def _path_segment(value: str) -> str:\n"
        "    return value\n"
        "\n"
        "\n"
        'path = f"/v1/traces/{_path_segment(trace_id)}"\n'
    )

    findings = _fstring_path_interpolations(impostor, "impostor.py")
    assert [finding.rsplit(" ", 1)[-1] for finding in findings] == [
        "{_path_segment(trace_id)}"
    ]


def test_a_class_method_shadow_does_not_satisfy_the_scan() -> None:
    """The asymmetry this closes.

    A verifier found that an INDENTED ``def _path_segment`` passed this scan
    while the TypeScript counterpart caught the same mutation — the pattern was
    anchored at column zero, so only a module-level definition counted. Python
    resolves the innermost binding, so a class method of that name shadows the
    shared import for every call site in the class, and the call sites read
    exactly as they did before.
    """
    impostor = (
        "from ._url import _path_segment\n"
        "\n"
        "\n"
        "class TracesClient:\n"
        "    def _path_segment(self, value: str) -> str:\n"
        "        return value\n"
        "\n"
        "    def get(self, trace_id):\n"
        '        return f"/v1/traces/{_path_segment(trace_id)}"\n'
    )

    findings = _fstring_path_interpolations(impostor, "impostor.py")
    assert [finding.rsplit(" ", 1)[-1] for finding in findings] == [
        "{_path_segment(trace_id)}"
    ]


def test_a_function_local_shadow_does_not_satisfy_the_scan() -> None:
    """The same shadow one scope deeper: defined inside the calling method."""
    impostor = (
        "from ._url import _path_segment\n"
        "\n"
        "\n"
        "def get(trace_id):\n"
        "    def _path_segment(value):\n"
        "        return value\n"
        '    return f"/v1/traces/{_path_segment(trace_id)}"\n'
    )

    findings = _fstring_path_interpolations(impostor, "impostor.py")
    assert [finding.rsplit(" ", 1)[-1] for finding in findings] == [
        "{_path_segment(trace_id)}"
    ]


def test_an_indented_rebinding_does_not_satisfy_the_scan() -> None:
    """Not only ``def``: an indented assignment rebinds the name just as well."""
    impostor = (
        "from ._url import _path_segment\n"
        "\n"
        "\n"
        "class TracesClient:\n"
        "    _path_segment = staticmethod(str)\n"
        "\n"
        "    def get(self, trace_id):\n"
        '        return f"/v1/traces/{_path_segment(trace_id)}"\n'
    )

    findings = _fstring_path_interpolations(impostor, "impostor.py")
    assert [finding.rsplit(" ", 1)[-1] for finding in findings] == [
        "{_path_segment(trace_id)}"
    ]


def test_comparing_the_encoder_is_not_read_as_a_rebinding() -> None:
    """The rebinding pattern must not fire on ``==``.

    Otherwise the guard would be strict for a bad reason: any module that merely
    compared the name would be declared a definer and its real, imported call
    sites would stop counting as encoded.
    """
    source = (
        "from ._url import _path_segment\n"
        "\n"
        "\n"
        "def get(trace_id):\n"
        "    assert _path_segment == _path_segment\n"
        '    return f"/v1/traces/{_path_segment(trace_id)}"\n'
    )

    assert LOCAL_ENCODER_DEFINITION.search(source) is None
    assert _fstring_path_interpolations(source, "fine.py") == []


def test_calling_the_encoder_without_importing_it_does_not_satisfy_the_scan() -> None:
    unbound = 'path = f"/v1/traces/{_path_segment(trace_id)}"\n'

    findings = _fstring_path_interpolations(unbound, "unbound.py")
    assert [finding.rsplit(" ", 1)[-1] for finding in findings] == [
        "{_path_segment(trace_id)}"
    ]


def test_re_inlining_the_encoder_into_a_real_client_is_caught() -> None:
    # Same mutation, applied to shipped source: swap the shared import for a
    # local copy and every call site in the module stops counting.
    traces = (SRC_DIR / "traces.py").read_text()
    inlined = traces.replace(
        "from ._url import _path_segment",
        "def _path_segment(value: str) -> str:\n    return quote(value, safe='')",
    )
    assert inlined != traces

    findings = _fstring_path_interpolations(inlined, "traces.py")
    assert [finding.rsplit(" ", 1)[-1] for finding in findings] == [
        "{_path_segment(trace_id)}",
        "{_path_segment(trace_id)}",
        "{_path_segment(trace_id)}",
    ]


def test_shared_module_is_the_only_place_the_encoder_is_defined() -> None:
    definers = [
        name
        for name in SOURCE_FILES
        if LOCAL_ENCODER_DEFINITION.search((SRC_DIR / name).read_text())
    ]

    assert definers == [SHARED_URL_MODULE]


def test_every_client_takes_the_encoder_from_the_shared_module() -> None:
    offenders = [
        name
        for name in SOURCE_FILES
        if name != SHARED_URL_MODULE
        and "_path_segment(" in (SRC_DIR / name).read_text()
        and not SHARED_ENCODER_IMPORT.search((SRC_DIR / name).read_text())
    ]

    assert offenders == []


@pytest.mark.parametrize(
    "entry",
    PATH_INTERPOLATION_EXEMPTIONS,
    ids=[f"{e.file}:{e.expression}" for e in PATH_INTERPOLATION_EXEMPTIONS],
)
def test_path_exemption_is_still_real(entry: PathExemption) -> None:
    findings = _fstring_path_interpolations(
        (SRC_DIR / entry.file).read_text(), entry.file
    )

    assert any(
        finding.rsplit(" ", 1)[-1] == f"{{{entry.expression}}}" for finding in findings
    )
