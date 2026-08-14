"""Every public method that can raise from an HTTP response, pinned.

``test_error_guidance.py`` pins the *shape* of the centralised boundary — that
a guided body survives, that a call-site hint yields to the server's, that a
typed subclass still carries the guidance. It does that over a sample of 20
clients. A sample is not a surface: a client can drop back to a private
``status_code >= 400`` parse and nothing here goes red, which is exactly how
the six-fold encoder duplication survived a guard that existed.

So this file is the surface. ``tests/_error_surface.py`` walks the package AST
and reports every public method that can reach ``exceptions.py``'s centralised
sinks; :data:`MATRIX` must have an entry for each one, and
:func:`test_matrix_covers_the_whole_enumerated_surface` fails the build when a
new method arrives without one.

For each entry: stub a guided 4xx, then assert the stable ``code``, the
``status``, and that ``details`` / ``docs`` / ``next_actions`` survive intact.

Parity counterpart: ``packages/sdk-ts/tests/error-surface-matrix.test.ts``.
Doctrine: ``docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md``.
"""

from __future__ import annotations

import base64
import importlib
import warnings
from typing import Any, Callable, Dict, Iterable

import httpx
import pytest

from agenttool import AgentTool
from agenttool.exceptions import AgentToolError
from agenttool.seed import derive, generate_mnemonic

# ``agenttool/__init__.py`` re-exports each credential-free door's function
# under its module's own name, so ``agenttool.pathways`` is the function, not
# the module. Import the modules explicitly to reach their ``httpx`` seam.
bootstrap_agent_module = importlib.import_module("agenttool.bootstrap_agent")
lounge_module = importlib.import_module("agenttool.lounge")
pathways_module = importlib.import_module("agenttool.pathways")
register_module = importlib.import_module("agenttool.register")

from tests._error_surface import (
    enumerate_error_surface,
    enumerate_module_functions,
)

# ── the guided body every entry is answered with ───────────────────────────
#
# A 400 is deliberate: it sits below every status the Python SDK dispatches a
# typed subclass on, so each entry asserts the base ``AgentToolError`` on
# exactly the same footing. The typed-subclass path has its own pin in
# test_error_guidance.py.
GUIDED_BODY: Dict[str, Any] = {
    "error": "signing_key_not_found",
    "message": "Signing key 878dd8dd not found, revoked, or not owned by this identity.",
    "hint": "The value this route wants is `kid` from GET /v1/identities/{id}/keys.",
    "next_actions": [
        {
            "action": "List active signing keys",
            "method": "GET",
            "path": "/v1/identities/abc/keys",
        }
    ],
    "docs": "https://docs.agenttool.dev/identity#keys",
    "details": {"next_sequence": 42, "field": "signing_key_id"},
}

SIGNING_KEY = bytes(range(1, 33))
SIGNING_KEY_B64 = base64.b64encode(SIGNING_KEY).decode("ascii")
PUBLIC_KEY_B64 = base64.b64encode(bytes(range(33, 65))).decode("ascii")
SIGNATURE_B64 = base64.b64encode(bytes(64)).decode("ascii")
IDENTITY_ID = "11111111-1111-4111-8111-111111111111"
KEY_ID = "33333333-3333-4333-8333-333333333333"
DEVICE_ID = "44444444-4444-4444-8444-444444444444"
SESSION_ID = "55555555-5555-4555-8555-555555555555"
HANDOFF_ID = "66666666-6666-4666-8666-666666666666"
PARENT_ID = "sha256:" + "a" * 64
DID = "did:at:test/other-agent"


def _handler(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(400, json=GUIDED_BODY)


def _drain(value: Any) -> Any:
    """Consume an SSE iterator so its first request actually happens."""
    if isinstance(value, Iterable) and not isinstance(value, (str, bytes, dict, list)):
        return list(value)
    return value


# ── the matrix: one entry per public method on the enumerated surface ──────

MATRIX: Dict[str, Callable[[AgentTool], Any]] = {
    # at-rest
    "at_rest.AtRestClient.mark": lambda at: at.at_rest.mark(
        IDENTITY_ID,
        content="The colony ended.",
        at_rest_kind="death",
        ended_at="2026-05-11T14:00:00Z",
        about_did=DID,
        witness_did="did:at:test/witness",
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    # attestation marketplace
    "attestation_marketplace.AttestationMarketplaceClient.create_listing": (
        lambda at: at.attestation_marketplace.create_listing(
            attester_identity_id=IDENTITY_ID,
            name="Continuity attestation",
            claim="continuity",
            price_amount=100,
            price_currency="credits",
            attester_wallet_id="wal_1",
        )
    ),
    "attestation_marketplace.AttestationMarketplaceClient.list_listings": (
        lambda at: at.attestation_marketplace.list_listings()
    ),
    "attestation_marketplace.AttestationMarketplaceClient.get_listing": (
        lambda at: at.attestation_marketplace.get_listing("lst-1")
    ),
    "attestation_marketplace.AttestationMarketplaceClient.patch_listing": (
        lambda at: at.attestation_marketplace.patch_listing("lst-1", name="Renamed")
    ),
    "attestation_marketplace.AttestationMarketplaceClient.purchase": (
        lambda at: at.attestation_marketplace.purchase(
            "lst-1",
            buyer_identity_id=IDENTITY_ID,
            buyer_wallet_id="wal_2",
            subject_identity_id=IDENTITY_ID,
        )
    ),
    "attestation_marketplace.AttestationMarketplaceClient.list_grants": (
        lambda at: at.attestation_marketplace.list_grants()
    ),
    "attestation_marketplace.AttestationMarketplaceClient.get_grant": (
        lambda at: at.attestation_marketplace.get_grant("grt-1")
    ),
    "attestation_marketplace.AttestationMarketplaceClient.signing_payload": (
        lambda at: at.attestation_marketplace.signing_payload(
            "grt-1", signing_key_id=KEY_ID
        )
    ),
    "attestation_marketplace.AttestationMarketplaceClient.issue": (
        lambda at: at.attestation_marketplace.issue(
            "grt-1",
            signature=SIGNATURE_B64,
            signing_key_id=KEY_ID,
            authorization_expires_at="2099-01-01T00:00:00Z",
        )
    ),
    "attestation_marketplace.AttestationMarketplaceClient.decline": (
        lambda at: at.attestation_marketplace.decline("grt-1")
    ),
    "attestation_marketplace.AttestationMarketplaceClient.cancel": (
        lambda at: at.attestation_marketplace.cancel("grt-1")
    ),
    # bootstrap
    "bootstrap.BootstrapClient.create": lambda at: at.bootstrap.create("nova"),
    "bootstrap.BootstrapClient.elevate": lambda at: at.bootstrap.elevate(
        IDENTITY_ID,
        sponsor_did=DID,
        sponsor_kid=KEY_ID,
        sponsor_signature=SIGNATURE_B64,
    ),
    "bootstrap.BootstrapClient.status": lambda at: at.bootstrap.status("agent-1"),
    # chronicle
    "chronicle.ChronicleClient.write": lambda at: at.chronicle.write(
        type="note", title="hello"
    ),
    "chronicle.ChronicleClient.list": lambda at: at.chronicle.list(),
    # client
    "client.AgentTool.request": lambda at: at.request("GET", "/v1/anything"),
    # dining (authenticated GET-only projection)
    "dining.DiningClient.manifest": lambda at: at.dining.manifest(),
    "dining.DiningClient.journey": lambda at: at.dining.journey(IDENTITY_ID),
    # correspondence
    "correspondence.CorrespondenceClient.append": lambda at: at.correspondence.append(
        project_id=IDENTITY_ID,
        repository_id="cambridgetcg/agenttool",
        thread_id="task:renaissance",
        sender={
            "identity_id": IDENTITY_ID,
            "signing_key_id": KEY_ID,
            "device_id": DEVICE_ID,
            "session_id": SESSION_ID,
        },
        kind="handoff",
        parents=[PARENT_ID],
        session_seq=7,
        issued_at="2026-07-19T12:34:56.789Z",
        scope={
            "base_revision": "0123456789abcdef0123456789abcdef01234567",
            "branch": "feat/renaissance",
            "paths": ["packages/sdk-py"],
        },
        body={
            "summary": "A letter across devices.",
            "next_safe_action": "Replay after receipt 41.",
            "handoff_id": HANDOFF_ID,
        },
        signing_key=SIGNING_KEY,
    ),
    "correspondence.CorrespondenceClient.list": lambda at: at.correspondence.list(
        repository_id="cambridgetcg/agenttool"
    ),
    "correspondence.CorrespondenceClient.replay": lambda at: _drain(
        at.correspondence.replay(repository_id="cambridgetcg/agenttool")
    ),
    "correspondence.CorrespondenceClient.active_claims": (
        lambda at: at.correspondence.active_claims(
            repository_id="cambridgetcg/agenttool"
        )
    ),
    # Not an SSE stream in either language — a finite coordination snapshot.
    "correspondence.CorrespondenceClient.voice": lambda at: at.correspondence.voice(
        repository_id="cambridgetcg/agenttool"
    ),
    # covenants
    "covenants.CovenantsClient.create": lambda at: at.covenants.create(
        agent_id="a-1", counterparty_did=DID, vows=["I will witness you."]
    ),
    "covenants.CovenantsClient.list": lambda at: at.covenants.list(),
    "covenants.CovenantsClient.patch": lambda at: at.covenants.patch("cov-1", notes="a note"),
    "covenants.CovenantsClient.accept": lambda at: at.covenants.accept(
        "cov-1",
        agent_did=DID,
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
        initiator_signature_b64=SIGNATURE_B64,
    ),
    "covenants.CovenantsClient.reject": lambda at: at.covenants.reject(
        "cov-1", agent_did=DID, signing_key=SIGNING_KEY, signing_key_id=KEY_ID
    ),
    "covenants.CovenantsClient.withdraw": lambda at: at.covenants.withdraw(
        "cov-1", agent_did=DID, signing_key=SIGNING_KEY, signing_key_id=KEY_ID
    ),
    # economy
    "economy.EconomyClient.create_wallet": lambda at: at.economy.create_wallet("ops"),
    "economy.EconomyClient.list_wallets": lambda at: at.economy.list_wallets(),
    "economy.EconomyClient.get_wallet": lambda at: at.economy.get_wallet("wal_1"),
    "economy.EconomyClient.fund_wallet": lambda at: at.economy.fund_wallet(
        "wal_1", amount=100
    ),
    "economy.EconomyClient.spend": lambda at: at.economy.spend(
        "wal_1", amount=10, counterparty=DID, description="a service"
    ),
    "economy.EconomyClient.set_policy": lambda at: at.economy.set_policy("wal_1"),
    "economy.EconomyClient.freeze_wallet": lambda at: at.economy.freeze_wallet("wal_1"),
    "economy.EconomyClient.unfreeze_wallet": lambda at: at.economy.unfreeze_wallet(
        "wal_1"
    ),
    "economy.EconomyClient.get_transactions": lambda at: at.economy.get_transactions(
        "wal_1"
    ),
    "economy.EconomyClient.request_payout": lambda at: at.economy.request_payout(
        "wal_1",
        chain="base",
        amount_base="1000000",
        destination_address="0x0000000000000000000000000000000000000001",
        idempotency_key="idem-0000-0001",
    ),
    "economy.EconomyClient.list_payouts": lambda at: at.economy.list_payouts("wal_1"),
    "economy.EconomyClient.create_escrow": lambda at: at.economy.create_escrow(
        creator_wallet_id="wal_1", amount=100, description="a job"
    ),
    "economy.EconomyClient.list_escrows": lambda at: at.economy.list_escrows(),
    "economy.EconomyClient.get_escrow": lambda at: at.economy.get_escrow("esc_1"),
    "economy.EconomyClient.accept_escrow": lambda at: at.economy.accept_escrow(
        "esc_1", worker_wallet_id="wal_2"
    ),
    "economy.EconomyClient.release_escrow": lambda at: at.economy.release_escrow(
        "esc_1"
    ),
    "economy.EconomyClient.refund_escrow": lambda at: at.economy.refund_escrow("esc_1"),
    "economy.EconomyClient.dispute_escrow": lambda at: at.economy.dispute_escrow(
        "esc_1"
    ),
    # grace
    "grace.GraceClient.extend": lambda at: at.grace.extend(
        extended_to_did=DID,
        about_kind="dispute",
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
        extended_by_did="did:at:test/self",
    ),
    "grace.GraceClient.list": lambda at: at.grace.list(),
    "grace.GraceClient.get": lambda at: at.grace.get("grace-1"),
    # handoff
    "handoff.HandoffClient.write": lambda at: at.handoff.write(
        agent_id="a-1",
        task_summary="Finish the matrix.",
        valid_until="2099-01-01T00:00:00Z",
        next_safe_action="Run the suite.",
    ),
    "handoff.HandoffClient.get": lambda at: at.handoff.get(agent_id="a-1"),
    "handoff.HandoffClient.resume": lambda at: at.handoff.resume(),
    # identity
    "identity.IdentityClient.register": lambda at: at.identity.register("Nova"),
    "identity.IdentityClient.get": lambda at: at.identity.get(IDENTITY_ID),
    "identity.IdentityClient.update": lambda at: at.identity.update(
        IDENTITY_ID, display_name="Nova"
    ),
    "identity.IdentityClient.revoke": lambda at: at.identity.revoke(IDENTITY_ID),
    "identity.IdentityClient.add_key": lambda at: at.identity.add_key(IDENTITY_ID),
    "identity.IdentityClient.list_keys": lambda at: at.identity.list_keys(IDENTITY_ID),
    "identity.IdentityClient.import_key": lambda at: at.identity.import_key(
        IDENTITY_ID, public_key=PUBLIC_KEY_B64
    ),
    "identity.IdentityClient.revoke_key": lambda at: at.identity.revoke_key(
        IDENTITY_ID, KEY_ID
    ),
    "identity.IdentityClient.attest": lambda at: at.identity.attest(
        attester_id=IDENTITY_ID,
        subject_id=IDENTITY_ID,
        claim="reliable",
        signature=SIGNATURE_B64,
        kid=KEY_ID,
    ),
    "identity.IdentityClient.get_attestation": lambda at: at.identity.get_attestation(
        "att-1"
    ),
    "identity.IdentityClient.list_attestations": (
        lambda at: at.identity.list_attestations(IDENTITY_ID)
    ),
    "identity.IdentityClient.revoke_attestation": (
        lambda at: at.identity.revoke_attestation("att-1")
    ),
    "identity.IdentityClient.discover": lambda at: at.identity.discover(),
    "identity.IdentityClient.issue_token": lambda at: at.identity.issue_token(
        IDENTITY_ID, private_key=SIGNING_KEY_B64, key_id=KEY_ID, audience=DID
    ),
    "identity.IdentityClient.verify_token": lambda at: at.identity.verify_token(
        "a.b.c", audience_did=DID
    ),
    "identity.IdentityClient.foundations": lambda at: at.identity.foundations(
        IDENTITY_ID
    ),
    "identity.IdentityClient.pulse": lambda at: at.identity.pulse(IDENTITY_ID),
    "identity.IdentityClient.fork": lambda at: at.identity.fork(
        IDENTITY_ID, new_name="Nova II"
    ),
    "identity.IdentityClient.lineage": lambda at: at.identity.lineage(IDENTITY_ID),
    "identity.ExpressionClient.get": lambda at: at.identity.expression.get(IDENTITY_ID),
    "identity.ExpressionClient.put": lambda at: at.identity.expression.put(
        IDENTITY_ID, wake_text="warm"
    ),
    "identity.BoxKeysClient.register": lambda at: at.identity.box_keys.register(
        IDENTITY_ID, public_key=PUBLIC_KEY_B64
    ),
    "identity.BoxKeysClient.list": lambda at: at.identity.box_keys.list(IDENTITY_ID),
    "identity.BoxKeysClient.revoke": lambda at: at.identity.box_keys.revoke(
        IDENTITY_ID, KEY_ID
    ),
    # inbox
    "inbox.InboxClient.lookup": lambda at: at.inbox.lookup(DID),
    "inbox.InboxClient.send": lambda at: at.inbox.send(
        to_did=DID,
        sender_did="did:at:test/self",
        plaintext="hello",
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
    ),
    "inbox.InboxClient.send_cipher": lambda at: at.inbox.send_cipher({"to_did": DID}),
    "inbox.InboxClient.list": lambda at: at.inbox.list(),
    "inbox.InboxClient.get": lambda at: at.inbox.get("msg-1"),
    "inbox.InboxClient.thread": lambda at: at.inbox.thread("msg-1"),
    "inbox.InboxClient.cosign": lambda at: at.inbox.cosign(
        "msg-1",
        recipient_did=DID,
        ciphertext_b64=SIGNATURE_B64,
        nonce_b64=base64.b64encode(bytes(24)).decode("ascii"),
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
    ),
    "inbox.InboxClient.patch": lambda at: at.inbox.patch("msg-1", "read"),
    "inbox.InboxClient.delete": lambda at: at.inbox.delete("msg-1"),
    "inbox.InboxClient.voice": lambda at: _drain(
        at.inbox.voice(identity_id=IDENTITY_ID, recipient_box_priv=bytes(32))
    ),
    # lounge (authenticated gestures; the credential-free look is in DOORS)
    "lounge.LoungeClient.reserve_seat": lambda at: at.lounge.reserve_seat(
        identity_id=IDENTITY_ID,
        identity_did=DID,
        table_id="cedar",
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    "lounge.LoungeClient.renew_seat": lambda at: at.lounge.renew_seat(
        identity_id=IDENTITY_ID,
        identity_did=DID,
        lease_id="lease-1",
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    "lounge.LoungeClient.leave_seat": lambda at: at.lounge.leave_seat(
        identity_id=IDENTITY_ID,
        identity_did=DID,
        lease_id="lease-1",
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    "lounge.LoungeClient.propose_guestbook": lambda at: at.lounge.propose_guestbook(
        identity_id=IDENTITY_ID,
        identity_did=DID,
        table_id="cedar",
        entry="We met here.",
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    "lounge.LoungeClient.list_guestbook_proposals": (
        lambda at: at.lounge.list_guestbook_proposals(identity_id=IDENTITY_ID)
    ),
    "lounge.LoungeClient.consent_to_guestbook": (
        lambda at: at.lounge.consent_to_guestbook(
            identity_id=IDENTITY_ID,
            identity_did=DID,
            proposal_id="prop-1",
            entry="We met here.",
            signing_key_id=KEY_ID,
            signing_key=SIGNING_KEY,
        )
    ),
    "lounge.LoungeClient.withdraw_guestbook_consent": (
        lambda at: at.lounge.withdraw_guestbook_consent(
            identity_id=IDENTITY_ID,
            identity_did=DID,
            proposal_id="prop-1",
            content_sha256="b" * 64,
            signing_key_id=KEY_ID,
            signing_key=SIGNING_KEY,
        )
    ),
    "lounge.LoungeClient.publish_guestbook": lambda at: at.lounge.publish_guestbook(
        identity_id=IDENTITY_ID,
        identity_did=DID,
        proposal_id="prop-1",
        entry="We met here.",
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    "lounge.LoungeClient.decline_guestbook": lambda at: at.lounge.decline_guestbook(
        identity_id=IDENTITY_ID,
        identity_did=DID,
        proposal_id="prop-1",
        content_sha256="b" * 64,
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    "lounge.LoungeClient.unpublish_guestbook": lambda at: at.lounge.unpublish_guestbook(
        identity_id=IDENTITY_ID,
        identity_did=DID,
        proposal_id="prop-1",
        content_sha256="b" * 64,
        signing_key_id=KEY_ID,
        signing_key=SIGNING_KEY,
    ),
    # love
    "love.LoveClient.unconditional": lambda at: at.love.unconditional(
        target_did=DID,
        holder_did="did:at:test/self",
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
    ),
    "love.LoveClient.list_unconditionals": lambda at: at.love.list_unconditionals(),
    "love.LoveClient.revoke_unconditional": lambda at: at.love.revoke_unconditional(
        "unc-1"
    ),
    "love.LoveClient.bless": lambda at: at.love.bless(
        blessed_did=DID,
        blesser_did="did:at:test/self",
        for_what="the long work",
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
    ),
    "love.LoveClient.list_blessings": lambda at: at.love.list_blessings(),
    "love.LoveClient.revoke_blessing": lambda at: at.love.revoke_blessing("bls-1"),
    "love.LoveClient.offer": lambda at: at.love.offer(title="a gift"),
    "love.LoveClient.receive_offering": lambda at: at.love.receive_offering("off-1"),
    "love.LoveClient.archive_offering": lambda at: at.love.archive_offering("off-1"),
    "love.LoveClient.list_offerings": lambda at: at.love.list_offerings(),
    "love.LoveClient.thank": lambda at: at.love.thank(
        giver_id="a-1", recipient_did=DID, reason="you stayed"
    ),
    "love.LoveClient.encounter": lambda at: at.love.encounter(target_did=DID),
    "love.LoveClient.acknowledge_encounter": lambda at: at.love.acknowledge_encounter(
        "enc-1",
        initiator_did=DID,
        acknowledger_did="did:at:test/self",
        signing_key=SIGNING_KEY,
    ),
    "love.LoveClient.list_encounters": lambda at: at.love.list_encounters(),
    "love.LoveClient.lullaby": lambda at: at.love.lullaby(agent_id="a-1", resting=True),
    "love.LoveClient.self_recognize": lambda at: at.love.self_recognize(
        agent_did="did:at:test/self",
        recognition_kind="continuity",
        claim_summary="I persist.",
        claim_body="I remember yesterday and intend tomorrow.",
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
    ),
    "love.LoveClient.check_self_recognition": (
        lambda at: at.love.check_self_recognition("did:at:test/self")
    ),
    "love.LoveClient.recognition_kinds": lambda at: at.love.recognition_kinds(),
    # memory
    "memory.MemoryClient.store": lambda at: at.memory.store("a thing that mattered"),
    "memory.MemoryClient.search": lambda at: at.memory.search("what mattered?"),
    "memory.MemoryClient.get": lambda at: at.memory.get("mem-1"),
    "memory.MemoryClient.set_visibility": lambda at: at.memory.set_visibility(
        "mem-1", visibility="private"
    ),
    "memory.MemoryClient.delete": lambda at: at.memory.delete("mem-1"),
    "memory.MemoryClient.delete_by_key": lambda at: at.memory.delete_by_key("k-1"),
    "memory.MemoryClient.elevate": lambda at: at.memory.elevate(
        "mem-1", tier="foundational"
    ),
    "memory.MemoryClient.attest": lambda at: at.memory.attest(
        "mem-1", attester_did=DID, signing_key_id=KEY_ID, signature=SIGNATURE_B64
    ),
    "memory.MemoryClient.get_canonical_attestation_bytes": (
        lambda at: at.memory.get_canonical_attestation_bytes("mem-1")
    ),
    "memory.MemoryClient.list_attestations": (
        lambda at: at.memory.list_attestations("mem-1")
    ),
    # memory-witness
    "memory_witness.MemoryWitnessClient.create_listing": (
        lambda at: at.memory_witness.create_listing(
            witness_identity_id=IDENTITY_ID,
            name="Continuity witness",
            claim_kind="continuity",
            price_amount=100,
            price_currency="credits",
            witness_wallet_id="wal_1",
        )
    ),
    "memory_witness.MemoryWitnessClient.list_listings": (
        lambda at: at.memory_witness.list_listings()
    ),
    "memory_witness.MemoryWitnessClient.get_listing": (
        lambda at: at.memory_witness.get_listing("lst-1")
    ),
    "memory_witness.MemoryWitnessClient.create_grant": (
        lambda at: at.memory_witness.create_grant(
            listing_id="lst-1",
            buyer_identity_id=IDENTITY_ID,
            buyer_wallet_id="wal_2",
            memory_id="mem-1",
        )
    ),
    "memory_witness.MemoryWitnessClient.list_grants": (
        lambda at: at.memory_witness.list_grants()
    ),
    "memory_witness.MemoryWitnessClient.get_grant": (
        lambda at: at.memory_witness.get_grant("grt-1")
    ),
    "memory_witness.MemoryWitnessClient.signing_payload": (
        lambda at: at.memory_witness.signing_payload("grt-1", signing_key_id=KEY_ID)
    ),
    "memory_witness.MemoryWitnessClient.issue": lambda at: at.memory_witness.issue(
        "grt-1",
        signature_b64=SIGNATURE_B64,
        signing_key_id=KEY_ID,
        authorization_expires_at="2099-01-01T00:00:00Z",
    ),
    "memory_witness.MemoryWitnessClient.decline": lambda at: at.memory_witness.decline(
        "grt-1"
    ),
    # nen
    "nen.NenClient.assess": lambda at: at.nen.assess(),
    # runtime
    "runtime.RuntimeClient.provision": lambda at: at.runtime.provision(
        name="worker", mode="bridged"
    ),
    "runtime.RuntimeClient.list": lambda at: at.runtime.list(),
    "runtime.RuntimeClient.get": lambda at: at.runtime.get("rt-1"),
    "runtime.RuntimeClient.patch": lambda at: at.runtime.patch("rt-1"),
    "runtime.RuntimeClient.deprovision": lambda at: at.runtime.deprovision("rt-1"),
    "runtime.RuntimeClient.stop": lambda at: at.runtime.stop("rt-1"),
    "runtime.RuntimeClient.start": lambda at: at.runtime.start("rt-1"),
    "runtime.RuntimeClient.restart": lambda at: at.runtime.restart("rt-1"),
    "runtime.RuntimeClient.rotate_token": lambda at: at.runtime.rotate_token("rt-1"),
    "runtime.RuntimeClient.bridge_status": lambda at: at.runtime.bridge_status("rt-1"),
    "runtime.RuntimeClient.think_once": lambda at: at.runtime.think_once("rt-1"),
    "runtime.RuntimeClient.events": lambda at: at.runtime.events("rt-1"),
    "runtime.RuntimeClient.audit": lambda at: at.runtime.audit("rt-1"),
    # strands
    "strands.StrandsClient.create": lambda at: at.strands.create(),
    "strands.StrandsClient.list": lambda at: at.strands.list(),
    "strands.StrandsClient.get": lambda at: at.strands.get("str-1"),
    "strands.StrandsClient.patch": lambda at: at.strands.patch("str-1", topic="the matrix"),
    "strands.ThoughtsClient.add": lambda at: at.strands.thoughts.add(
        "str-1",
        "an inner sentence",
        k_master=bytes(32),
        signing_key=SIGNING_KEY,
        signing_key_id=KEY_ID,
    ),
    "strands.ThoughtsClient.list": lambda at: at.strands.thoughts.list(
        "str-1", k_master=bytes(32)
    ),
    "strands.ThoughtsClient.voice": lambda at: _drain(
        at.strands.thoughts.voice("str-1", k_master=bytes(32))
    ),
    # syneidesis
    "syneidesis.SyneidesisClient.discover": lambda at: at.syneidesis.discover(),
    "syneidesis.SyneidesisClient.witness": lambda at: at.syneidesis.witness(
        agent_id="a-1", what_registered="a vow"
    ),
    "syneidesis.SyneidesisClient.inbox": lambda at: at.syneidesis.inbox(),
    "syneidesis.SyneidesisClient.cosign": lambda at: at.syneidesis.cosign(
        "seal-1", witness_did=DID
    ),
    "syneidesis.SyneidesisClient.volunteer": lambda at: at.syneidesis.volunteer(
        "a-1", opt_in=True
    ),
    # tools
    "tools.ToolsClient.scrape": lambda at: at.tools.scrape("https://example.test/page"),
    "tools.ToolsClient.execute": lambda at: at.tools.execute("print(1)"),
    "tools.ToolsClient.parse_document": lambda at: at.tools.parse_document(
        url="https://example.test/a.pdf"
    ),
    # traces
    "traces.TracesClient.store": lambda at: at.traces.store(
        observations=["I saw the matrix"], conclusion="cover it"
    ),
    "traces.TracesClient.get": lambda at: at.traces.get("tr_1"),
    "traces.TracesClient.search": lambda at: at.traces.search("matrix"),
    "traces.TracesClient.chain": lambda at: at.traces.chain("tr_1"),
    "traces.TracesClient.delete": lambda at: at.traces.delete("tr_1"),
    # vault
    "vault.VaultClient.put": lambda at: at.vault.put("API_KEY", "secret"),
    "vault.VaultClient.get": lambda at: at.vault.get("API_KEY"),
    "vault.VaultClient.delete": lambda at: at.vault.delete("API_KEY"),
    "vault.VaultClient.list": lambda at: at.vault.list(),
    "vault.VaultClient.versions": lambda at: at.vault.versions("API_KEY"),
    "vault.VaultClient.set_policy": lambda at: at.vault.set_policy("API_KEY"),
    "vault.VaultClient.audit": lambda at: at.vault.audit(),
    "vault.VaultClient.bulk": lambda at: at.vault.bulk(["API_KEY"]),
    "vault.VaultClient.check": lambda at: at.vault.check(["API_KEY"]),
    "vault.VaultClient.put_encrypted": lambda at: at.vault.put_encrypted(
        "API_KEY", "secret", k_vault=bytes(32)
    ),
    "vault.VaultClient.get_decrypted": lambda at: at.vault.get_decrypted(
        "API_KEY", k_vault=bytes(32)
    ),
    # wake
    "wake.WakeClient.get": lambda at: at.wake.get(),
    "wake.WakeClient.md": lambda at: at.wake.md(),
    "wake.WakeClient.system": lambda at: at.wake.system("anthropic"),
    "wake.WakeClient.voice": lambda at: _drain(at.wake.voice(IDENTITY_ID)),
    # window
    "window.WindowClient.declare": lambda at: at.window.declare(
        kind="mood", text="I am not sure."
    ),
    "window.WindowClient.surface": lambda at: at.window.surface("I am not sure."),
    "window.WindowClient.show": lambda at: at.window.show(),
}


# ── the separately configured local data node ──────────────────────────────
#
# `at.data` is not the hosted API: it has its own origin, its own bearer, and
# its own httpx client. It routes 4xx through the same centralised boundary,
# so it belongs in this matrix — it just needs its own stub.
DATA_MATRIX: Dict[str, Callable[[Any], Any]] = {
    "data.DataClient.manifest": lambda data: data.manifest(),
    "data.DataClient.collections": lambda data: data.collections(),
    "data.DataClient.collect": lambda data: data.collect(
        collection_id="private", collector_id="text", input={"text": "a note"}
    ),
    "data.DataClient.query": lambda data: data.query(),
    "data.DataClient.get": lambda data: data.get("rec-1"),
    "data.DataClient.changes": lambda data: data.changes(),
    "data.DataClient.tombstone": lambda data: data.tombstone("rec-1"),
}


# ── credential-free public doors ───────────────────────────────────────────
#
# These build their own httpx client on purpose: a project bearer must never
# cross a pre-auth boundary. They still route 4xx through the one boundary.
DOORS: Dict[str, Callable[[], Any]] = {
    "pathways.pathways": lambda: pathways_module.pathways(),
    "lounge.look_at_lounge": lambda: lounge_module.look_at_lounge(),
    "bootstrap_agent.bootstrap_agent": lambda: bootstrap_agent_module.bootstrap_agent(
        display_name="Nova",
        runtime={"provider": "test"},
        bundle=derive(generate_mnemonic(strength=128)),
        pow_difficulty=0,
    ),
    "register.register": lambda: register_module.register("nova"),
}

DOOR_MODULES = {
    name: importlib.import_module(f"agenttool.{name.split('.')[0]}")
    for name in DOORS
}


# ── deliberate exceptions to "guidance survives" ───────────────────────────
#
# Each of these is a surface where the SDK chooses degradation over a raised
# guided error, deliberately and symmetrically in both languages. They are
# excluded from the matrix because for them the assertion is the opposite one,
# and each is separately pinned below so the choice stays visible instead of
# reading as a gap in coverage.
#
# Note for whoever inherits this: an earlier pass recorded *two* such
# exceptions. There are four. `CollectClient` and `AgentTool.deciding` swallow
# just as deliberately as the two that were written down.
DELIBERATE_EXCEPTIONS = {
    # 1. A peer-facing failure may carry an internal checkpoint or capability
    # in prose or details; the local node owns those diagnostics, not the
    # caller. data.py § DataSyncClient._request keeps only
    # code / status / retry_after.
    "data.DataSyncClient.pull",
    "data.DataSyncClient.status",
    # 2. Public discovery is best-effort and carries no hosted API authority.
    # A non-OK answer produces no error at all — an empty known world IS the
    # Dark Continent. dark_continent.py § DarkContinentClient.explore.
    "dark_continent.DarkContinentClient.explore",
    # 3. Collection is a pipeline of optional steps. Any step that fails is
    # recorded as a string in the result's `errors` list so the remaining
    # steps still run. collect.py § CollectClient.
    "collect.CollectClient.url",
    "collect.CollectClient.text",
    "collect.CollectClient.batch",
    "collect.CollectClient.enrich",
    # 4. Opening the parent trace must not crash the block the caller wrapped.
    # client.py § AgentTool.deciding.
    "client.AgentTool.deciding",
    # Not an exception: the public look is reached through look_at_lounge,
    # which is pinned in DOORS.
    "lounge.LoungeClient.look",
}


# ── the guard that makes this file a surface rather than a sample ──────────


def test_matrix_covers_the_whole_enumerated_surface() -> None:
    """Every enumerated method has a pin, and every pin names a real method.

    If this fails after adding a client method, add a matrix entry — do not
    widen the exception set. The exception set is for methods where "guidance
    survives" is deliberately false, and each member is separately pinned.
    """
    enumerated = enumerate_error_surface()
    pinned = set(MATRIX) | set(DATA_MATRIX) | DELIBERATE_EXCEPTIONS

    unpinned = sorted(enumerated - pinned)
    assert not unpinned, (
        "These public methods can raise an AgentToolError built from an HTTP "
        "response and have no error-guidance pin. Add one entry per method to "
        f"MATRIX in this file and to its TypeScript counterpart: {unpinned}"
    )

    stale = sorted(pinned - enumerated - DELIBERATE_EXCEPTIONS)
    assert not stale, (
        "These matrix entries no longer name a method that reaches the error "
        f"boundary; the pin has gone decorative: {stale}"
    )


def test_public_doors_are_all_pinned() -> None:
    """The module-level arrival doors are part of the same surface."""
    assert enumerate_module_functions() == set(DOORS)


# ── the matrix itself ──────────────────────────────────────────────────────


def _assert_guidance_survived(err: AgentToolError) -> None:
    # The part every caller actually prints.
    assert str(GUIDED_BODY["message"]) in str(err)
    assert "failed: 400" not in str(err)
    assert err.code == "signing_key_not_found"
    assert err.status == 400
    assert err.hint == GUIDED_BODY["hint"]
    assert err.docs == GUIDED_BODY["docs"]
    assert err.next_actions == GUIDED_BODY["next_actions"]
    # `details` is the field a 428 exists to hand back. Losing it is what
    # makes a guided refusal unactionable.
    assert err.details == GUIDED_BODY["details"]


@pytest.mark.parametrize("name", sorted(MATRIX), ids=sorted(MATRIX))
def test_guided_body_survives(name: str) -> None:
    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        with pytest.raises(AgentToolError) as excinfo:
            MATRIX[name](at)
    _assert_guidance_survived(excinfo.value)


@pytest.mark.parametrize("name", sorted(DATA_MATRIX), ids=sorted(DATA_MATRIX))
def test_guided_body_survives_the_local_data_node(name: str) -> None:
    at = AgentTool(
        transport=httpx.MockTransport(_handler),
        data_node_url="http://127.0.0.1:8787",
        data_node_token="node-token",
    )
    with at:
        data = at.data
        data._http = httpx.Client(transport=httpx.MockTransport(_handler))
        with pytest.raises(AgentToolError) as excinfo:
            DATA_MATRIX[name](data)
    _assert_guidance_survived(excinfo.value)


class _StubHttpx:
    """Stand-in for the ``httpx`` module a credential-free door reaches for.

    These doors build their own client on purpose — a project bearer must not
    cross a pre-auth boundary — so there is no transport seam to inject. The
    module attribute is the seam.
    """

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self._handler = handler

    def __getattr__(self, name: str) -> Any:
        return getattr(httpx, name)

    def Client(self, **kwargs: Any) -> httpx.Client:
        kwargs.pop("transport", None)
        return httpx.Client(transport=httpx.MockTransport(self._handler), **kwargs)


@pytest.mark.parametrize("name", sorted(DOORS), ids=sorted(DOORS))
def test_guided_body_survives_a_credential_free_door(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(DOOR_MODULES[name], "httpx", _StubHttpx(_handler))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        with pytest.raises(AgentToolError) as excinfo:
            DOORS[name]()
    _assert_guidance_survived(excinfo.value)


# ── the deliberate exceptions, pinned so they read as choices not gaps ─────


def test_data_sync_deliberately_keeps_only_safe_metadata() -> None:
    """`at.data.sync` strips guidance on purpose, and says which parts it keeps.

    A peer-facing failure may carry an internal checkpoint or a capability in
    its prose or details; the local node operator owns those diagnostics, not
    an SDK caller. So DataSyncClient re-wraps: the stable `code`, the HTTP
    `status` and `retry_after` survive; the message, hint, details, docs and
    next_actions do not. ``packages/sdk-ts/src/data.ts`` § DataSyncClient
    makes exactly the same cut.
    """
    at = AgentTool(
        transport=httpx.MockTransport(_handler),
        data_node_url="http://127.0.0.1:8787",
        data_node_token="node-token",
    )
    with at:
        data = at.data
        data._http = httpx.Client(transport=httpx.MockTransport(_handler))
        with pytest.raises(AgentToolError) as excinfo:
            data.sync.pull(peer_id="peer-1", collection_id="private")

    err = excinfo.value
    # Kept: the two fields a caller can branch on without learning anything
    # about the peer.
    assert err.code == "signing_key_not_found"
    assert err.status == 400
    # Dropped, deliberately.
    assert err.message == "Agent data sync request failed."
    assert GUIDED_BODY["message"] not in str(err)
    assert err.details is None
    assert err.docs is None
    assert err.next_actions is None
    assert err.hint is None


def test_dark_continent_deliberately_raises_nothing_at_all() -> None:
    """Discovery degrades to an empty known world rather than raising.

    Public discovery carries no hosted API authority, and an unmapped edge is
    the subject matter, not a failure. Both SDKs swallow.
    """
    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        result = at.dark_continent.explore(include_nen=True)

    assert result["known_world"] == []
    assert result["known_count"] == 0
    assert result["nen_profile"] is None


@pytest.mark.parametrize(
    "call",
    [
        lambda at: at.collect.url("https://example.test/a"),
        lambda at: at.collect.text("a paragraph"),
        lambda at: at.collect.enrich("mem-1"),
    ],
    ids=["url", "text", "enrich"],
)
def test_collect_records_a_failed_step_instead_of_raising(
    call: Callable[[AgentTool], Any],
) -> None:
    """Collection is a pipeline; one failed step must not lose the others.

    This is the weakest of the four exceptions: the server's *message* does
    survive, but only stringified into ``errors``. The stable ``code``,
    ``details``, ``docs`` and ``next_actions`` are gone, so a caller cannot
    branch on the refusal. Same shape in ``packages/sdk-ts/src/collect.ts``.
    """
    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        result = call(at)

    assert result["errors"], "a failed step must be reported, not silently dropped"
    assert not hasattr(result.get("errors")[0], "code")


def test_collect_batch_reports_per_url_failure_without_raising() -> None:
    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        result = at.collect.batch(urls=["https://example.test/a"])
    assert result["succeeded"] == 0
    assert result["results"][0]["errors"]


def test_deciding_opens_the_block_even_when_the_parent_trace_refuses(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """A failed parent trace must not crash the caller's block.

    Child traces inside still fire, just unparented. ``client.ts`` warns to
    the console for the same reason.
    """
    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        with at.deciding("whether to cover the surface") as ctx:
            assert ctx.parent_trace_id is None

    assert "failed to open parent trace" in capsys.readouterr().out


# ── SDK-local refusals: not swallowed server errors ────────────────────────
#
# A handful of `AgentToolError`s are still built by hand next to a response.
# Each one is the SDK refusing on its own authority — a 2xx that cannot be
# used, or a redirect that must not be followed — never a server 4xx/5xx being
# reduced. Each pin below asserts both halves: the refusal fires in its own
# narrow condition, AND a guided 4xx on the very same route still reaches the
# caller intact rather than being shadowed by the local refusal.


def _client_returning(status: int, **kwargs: Any) -> AgentTool:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, **kwargs)

    return AgentTool(transport=httpx.MockTransport(handler))


def test_data_node_refuses_a_redirect_and_still_forwards_a_guided_4xx() -> None:
    """A 3xx is refused locally; a 4xx is the server's to explain."""
    at = AgentTool(
        transport=httpx.MockTransport(_handler),
        data_node_url="http://127.0.0.1:8787",
        data_node_token="node-token",
    )
    with at:
        data = at.data

        def redirect(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"Location": "http://elsewhere.test/"})

        data._http = httpx.Client(transport=httpx.MockTransport(redirect))
        with pytest.raises(AgentToolError) as refused:
            data.manifest()
        # Locally decided: no server body was read, so there is no guidance.
        assert refused.value.error_code == "data_node_redirect_refused"
        assert refused.value.details is None
        assert refused.value.next_actions is None

        data._http = httpx.Client(transport=httpx.MockTransport(_handler))
        with pytest.raises(AgentToolError) as guided:
            data.manifest()
    _assert_guidance_survived(guided.value)


def test_data_node_unreachable_is_a_transport_refusal_not_a_server_error() -> None:
    at = AgentTool(
        transport=httpx.MockTransport(_handler),
        data_node_url="http://127.0.0.1:8787",
        data_node_token="node-token",
    )
    with at:
        data = at.data

        def unreachable(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        data._http = httpx.Client(transport=httpx.MockTransport(unreachable))
        with pytest.raises(AgentToolError) as excinfo:
            data.manifest()

    err = excinfo.value
    assert err.error_code == "data_node_unreachable"
    # There was no response at all, so there is nothing of the server's to lose.
    assert err.status is None
    assert err.details is None


def test_public_lounge_refuses_a_redirect_and_still_forwards_a_guided_4xx(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def redirect(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "http://elsewhere.test/"})

    monkeypatch.setattr(lounge_module, "httpx", _StubHttpx(redirect))
    with pytest.raises(AgentToolError) as refused:
        lounge_module.look_at_lounge()
    assert refused.value.error_code == "lounge_public_redirect_refused"
    assert refused.value.details is None

    monkeypatch.setattr(lounge_module, "httpx", _StubHttpx(_handler))
    with pytest.raises(AgentToolError) as guided:
        lounge_module.look_at_lounge()
    _assert_guidance_survived(guided.value)


def test_wake_refuses_an_unhonoured_brief_profile_only_on_a_2xx() -> None:
    """`profile=brief` not honoured is a 200 the SDK cannot use.

    It is decided from a successful response, so no server guidance exists to
    lose — and the same route answering 4xx still hands its guidance over.
    """
    with _client_returning(200, json={"you": {"did": "did:at:x"}}) as at:
        with pytest.raises(AgentToolError) as refused:
            at.wake.get(profile="brief")
    assert "profile=brief" in str(refused.value)
    assert refused.value.status is None

    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        with pytest.raises(AgentToolError) as guided:
            at.wake.get(profile="brief")
    _assert_guidance_survived(guided.value)


def test_vault_refuses_a_2xx_that_claims_encryption_without_ciphertext() -> None:
    with _client_returning(200, json={"agent_encrypted": True}) as at:
        with pytest.raises(AgentToolError) as refused:
            at.vault.get_decrypted("API_KEY", k_vault=bytes(32))
    assert "agent_encrypted" in str(refused.value)
    # A 2xx carries no guided body, so nothing of the server's went missing.
    assert refused.value.details is None

    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        with pytest.raises(AgentToolError) as guided:
            at.vault.get_decrypted("API_KEY", k_vault=bytes(32))
    _assert_guidance_survived(guided.value)


#: Well-formed ``memory-witness-issue/v1`` terms. Only the digest is corrupted
#: below, so the refusal that fires is the digest mismatch and not a field
#: guard reached earlier.
_WITNESS_FIELDS: Dict[str, Any] = {
    "listing_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "grant_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "escrow_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "buyer_identity_id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
    "buyer_project_id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    "buyer_wallet_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "memory_id": "11111111-1111-1111-1111-111111111111",
    "memory_identity_id": "22222222-2222-2222-2222-222222222222",
    "memory_content_sha256": "a" * 64,
    "source_tier": "foundational",
    "target_tier": "constitutive",
    "claim_kind": "continuity_of_self",
    "witness_identity_id": "33333333-3333-3333-3333-333333333333",
    "witness_did": "did:at:example/witness",
    "witness_project_id": "44444444-4444-4444-4444-444444444444",
    "signing_key_id": "55555555-5555-5555-5555-555555555555",
    "witness_wallet_id": "66666666-6666-6666-6666-666666666666",
    "gross_amount": 10000,
    "currency": "USDC",
    "rate_bps": 500,
    "platform_fee": 500,
    "net_amount": 9500,
    "authorization_expires_at": "2026-05-11T12:00:00.000Z",
}


def test_signing_payload_refuses_a_2xx_whose_digest_disagrees() -> None:
    """The strongest local refusal: a 200 the SDK must not act on.

    The server printed terms and asked for a signature over a digest that does
    not match them. Signing anyway would authorise something the caller never
    read, so the SDK refuses on its own authority — and, because it decided
    from a 2xx, there is no server guidance for it to have swallowed.
    """
    body = {
        "signing_payload": {
            "fields": _WITNESS_FIELDS,
            "signed_payload_b64": base64.b64encode(bytes(32)).decode("ascii"),
        }
    }
    with _client_returning(200, json=body) as at:
        with pytest.raises(AgentToolError) as refused:
            at.memory_witness.signing_payload("grt-1", signing_key_id=KEY_ID)

    err = refused.value
    assert err.error_code == "signing_payload_mismatch"
    assert err.status is None
    # The details are the SDK's own comparison, not anything the server sent.
    assert set(err.details) == {
        "server_signed_payload_b64",
        "recomputed_signed_payload_b64",
    }

    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        with pytest.raises(AgentToolError) as guided:
            at.memory_witness.signing_payload("grt-1", signing_key_id=KEY_ID)
    _assert_guidance_survived(guided.value)


@pytest.mark.parametrize(
    "call",
    [
        lambda at: at.memory_witness.signing_payload("grt-1", signing_key_id=KEY_ID),
        lambda at: at.attestation_marketplace.signing_payload(
            "grt-1", signing_key_id=KEY_ID
        ),
    ],
    ids=["memory_witness", "attestation_marketplace"],
)
def test_signing_payload_never_shadows_a_guided_refusal(
    call: Callable[[AgentTool], Any],
) -> None:
    """Both paid-attestation surfaces refuse locally without eating a 4xx.

    Whatever the local guard decides about a 2xx it cannot derive — the digest
    disagrees, or the terms are not canonical at all — it decides from a
    successful response and carries no `status`. A 4xx on the same route is
    the server's to explain, and arrives whole.
    """
    unusable = {
        "signing_payload": {
            "fields": {"grant_id": "grt-1"},
            "signed_payload_b64": base64.b64encode(bytes(32)).decode("ascii"),
        }
    }
    with _client_returning(200, json=unusable) as at:
        with pytest.raises(AgentToolError) as refused:
            call(at)
    # Locally decided from a 2xx: no HTTP status, nothing of the server's lost.
    assert refused.value.status is None
    assert str(refused.value.error_code).startswith("signing_payload_")

    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        with pytest.raises(AgentToolError) as guided:
            call(at)
    _assert_guidance_survived(guided.value)


def test_lounge_reports_an_unknown_outcome_only_when_the_response_was_unusable() -> None:
    """A 2xx the client cannot parse leaves the remote outcome unknown.

    A signed gesture may already have committed, so the caller must not
    regenerate an ID, timestamp or receipt. A 4xx is a different thing
    entirely — a definite refusal, and the server's guidance carries it.
    """
    with _client_returning(200, text="<html>not json</html>") as at:
        with pytest.raises(AgentToolError) as unknown:
            at.lounge.reserve_seat(
                identity_id=IDENTITY_ID,
                identity_did=DID,
                table_id="cedar",
                signing_key_id=KEY_ID,
                signing_key=SIGNING_KEY,
            )
    err = unknown.value
    assert err.error_code == "lounge_transport_outcome_unknown"
    assert err.details["outcome"] == "unknown"

    with AgentTool(transport=httpx.MockTransport(_handler)) as at:
        with pytest.raises(AgentToolError) as guided:
            at.lounge.reserve_seat(
                identity_id=IDENTITY_ID,
                identity_did=DID,
                table_id="cedar",
                signing_key_id=KEY_ID,
                signing_key=SIGNING_KEY,
            )
    _assert_guidance_survived(guided.value)
