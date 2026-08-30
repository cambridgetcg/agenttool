"""Internal: the x402 paying transport — the SDK's "pay on 402" wall.

Wraps the ``httpx`` transport the client would otherwise use so that a 402
carrying an x402 V2 ``PaymentRequired`` challenge is answered with exactly
one signed retry::

    bare request ──► 402 + challenge ──► select under policy ──► sign
                 ──► the SAME request + PAYMENT-SIGNATURE ──► response

Doctrine (Wave 2 Phase C, changed deliberately): the SDK CAN sign and pay,
but only when the caller opted in at construction with a signer AND a spend
policy — ``AgentTool(x402=X402Payer(...))``. Never by default. This module
is never installed unless that argument was passed.

The walls this wrapper adds on top of ``x402.py``:

1. **Exactly two requests, ever.** A second 402 after the signed retry is a
   typed error (``x402_payment_not_accepted``), never another signature.
   Signing again would be a second, independent payment.
2. **The retry is the same request**: same method, same URL, same body, same
   caller headers (``Authorization``, ``Idempotency-Key`` included). Only
   ``PAYMENT-SIGNATURE`` is added.
3. A request that already carries a caller-supplied ``PAYMENT-SIGNATURE``
   is never paid for again; its 402 surfaces untouched.
4. A 402 without a parseable challenge (fail-closed admission with
   ``Retry-After``, a replay-suppressed 402 echoing ``PAYMENT-RESPONSE``) is
   not payable and surfaces untouched, headers intact.
5. A refusal by the spend policy is a typed :class:`AgentToolError` whose
   ``code`` is the refusal reason. Nothing was signed; one request happened.
6. A body that cannot be re-sent (an iterator stream) is refused BEFORE
   anything is signed: a signature that cannot be delivered is a liability.

The leading underscore keeps the parity scanner off this file: it is
plumbing, not the public surface. The public surface is ``x402.py``. The
TypeScript twin is ``packages/sdk-ts/src/_x402-transport.ts``.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional

import httpx

from .exceptions import AgentToolError, _error_from_body
from .x402 import (
    SignedX402Payment,
    X402ClientRefusal,
    X402PaymentRequired,
    X402Signer,
    X402SpendPolicy,
    decode_payment_required_header,
    is_evm_address,
    local_evm_signer,
    parse_payment_required_body,
    select_payable_requirement,
    sign_exact_evm_authorization,
)

#: Environment variable read ONLY when ``x402=`` is passed without a signer.
#: Its presence with no ``x402=`` changes nothing.
X402_PRIVATE_KEY_ENV = "AT_X402_PRIVATE_KEY"

_AUTHORIZATION_HASH = re.compile(r"^[0-9a-f]{64}$")
_PAYMENT_STATUS_LINK = re.compile(r'<([^>]*/v1/x402/payments/([0-9a-f]{64}))>\s*;\s*rel="payment-status"')


@dataclass(frozen=True)
class X402PaymentEvent:
    """What ``on_payment`` receives after the signed retry was attempted."""

    #: Client identity of the signed authorization (the six EIP-3009 fields,
    #: :func:`agenttool.x402.authorization_hash`). Persist it: recovery is a
    #: lookup on what was emitted, never a fresh signature.
    authorization_hash: str
    #: Unix seconds after which the signed bytes are dead.
    valid_before: int
    #: HTTP status of the signed retry. ``None`` when the retry itself raised
    #: (a transport failure) — the authorization may still have been received.
    status: Optional[int] = None
    #: Raw ``PAYMENT-RESPONSE`` settlement receipt from the retry, if any.
    payment_response: Optional[str] = None
    #: Raw ``Link`` header from the retry (``rel="payment-status"``), if any.
    payment_status_link: Optional[str] = None
    #: The server's LEDGER identity for this payment, parsed from the
    #: ``rel="payment-status"`` Link when present. This — not
    #: ``authorization_hash`` — is what ``at.x402.payment(id)`` resolves.
    payment_id: Optional[str] = None
    #: Raw ``X-Credits-Balance`` from the retry, if any.
    credits_balance: Optional[str] = None


X402PaymentCallback = Callable[[X402PaymentEvent], None]


def _option_error(message: str, *, code: str, hint: str) -> AgentToolError:
    return AgentToolError(message, hint=hint, error_code=code)


@dataclass(frozen=True)
class X402Payer:
    """The ``x402=`` argument to :class:`agenttool.AgentTool`. Presence is the opt-in.

    ``policy`` is mandatory with no defaults for its cap and recipients: an
    :class:`~agenttool.x402.X402SpendPolicy` (or a mapping of its fields)
    whose ``max_amount_atomic`` and ``allowed_pay_to`` are supplied. A payer
    without them is refused at construction, before any request is made.

    ``signer`` is whoever holds the key — :func:`~agenttool.x402.local_evm_signer`
    or any callable taking the EIP-712 typed data and returning a 65-byte
    ``0x`` hex signature. Omit it to read ``AT_X402_PRIVATE_KEY`` into a local
    signer — honoured ONLY because this object exists. A custom signer that
    does not carry an ``address`` attribute needs ``payer_address=``.

    ``on_payment`` is called once per signed retry with the identity of what
    was emitted. ``now_seconds`` is the clock for the authorization window
    (unix seconds); defaults to ``time.time()``, injectable for tests and
    trusted time sources.
    """

    policy: X402SpendPolicy
    signer: Optional[X402Signer] = None
    payer_address: Optional[str] = None
    on_payment: Optional[X402PaymentCallback] = None
    now_seconds: Optional[Callable[[], int]] = None

    def __post_init__(self) -> None:
        policy = self.policy
        if isinstance(policy, Mapping) and not isinstance(policy, X402SpendPolicy):
            try:
                policy = X402SpendPolicy(**dict(policy))
            except (TypeError, ValueError) as exc:
                raise _option_error(
                    f"x402 spend policy: {exc}",
                    code="x402_spend_policy_invalid",
                    hint=(
                        "Every wall is mandatory: max_amount_atomic (int > 0) and allowed_pay_to "
                        "(non-empty allow-list) above all; allowed_networks, allowed_assets, "
                        "max_validity_seconds must be usable. No defaults for the cap or the recipients."
                    ),
                ) from exc
            object.__setattr__(self, "policy", policy)
        if not isinstance(policy, X402SpendPolicy):
            raise _option_error(
                "x402 payer needs a spend policy; there is no default.",
                code="x402_spend_policy_invalid",
                hint=(
                    "A policy without max_amount_atomic and allowed_pay_to is not a policy. "
                    "Pass policy=X402SpendPolicy(max_amount_atomic=..., allowed_pay_to=[...])."
                ),
            )
        if self.signer is not None and not callable(self.signer):
            raise _option_error(
                "x402 signer must be a callable taking the EIP-712 typed data.",
                code="x402_signer_invalid",
                hint="Use local_evm_signer(private_key) or a callable backed by your wallet that returns 0x r‖s‖v hex.",
            )
        if self.payer_address is not None and not is_evm_address(self.payer_address):
            raise _option_error(
                "x402 payer_address is not a valid EVM address.",
                code="x402_signer_invalid",
                hint="Pass the checksummed (or all-lowercase) 20-byte hex address the signer signs for.",
            )
        if self.signer is not None and self.payer_address is None:
            carried = getattr(self.signer, "address", None)
            if not is_evm_address(carried):
                raise _option_error(
                    "x402 signer carries no address; pass payer_address= beside it.",
                    code="x402_signer_invalid",
                    hint=(
                        "local_evm_signer() carries its address. A custom signer needs "
                        "payer_address= so `from` can be filled and checked before signing."
                    ),
                )
        if self.on_payment is not None and not callable(self.on_payment):
            raise _option_error(
                "x402 on_payment must be a callable.", code="x402_option_invalid", hint="Pass a function of one X402PaymentEvent argument."
            )
        if self.now_seconds is not None and not callable(self.now_seconds):
            raise _option_error(
                "x402 now_seconds must be a callable returning unix seconds.",
                code="x402_option_invalid",
                hint="Pass e.g. lambda: int(time.time()).",
            )


@dataclass(frozen=True)
class _ResolvedX402Payer:
    """Validated form handed to the transport. The key never appears here."""

    signer: X402Signer
    payer_address: str
    policy: X402SpendPolicy
    on_payment: Optional[X402PaymentCallback]
    now_seconds: Callable[[], int]


def resolve_x402_payer(payer: object, env: Mapping[str, str]) -> _ResolvedX402Payer:
    """Validate ``x402=`` at construction; nothing here touches the network.

    Codes: ``x402_option_invalid`` (not an :class:`X402Payer`),
    ``x402_signer_missing`` (no signer and no ``AT_X402_PRIVATE_KEY``),
    ``x402_private_key_invalid`` (the env key is malformed — never echoed).
    """
    if not isinstance(payer, X402Payer):
        raise _option_error(
            "x402= must be an X402Payer.",
            code="x402_option_invalid",
            hint=(
                "Pass x402=X402Payer(signer=local_evm_signer(key), policy=X402SpendPolicy("
                "max_amount_atomic=..., allowed_pay_to=[...])). Absent, the SDK never pays."
            ),
        )
    signer = payer.signer
    payer_address = payer.payer_address
    if signer is None:
        key = env.get(X402_PRIVATE_KEY_ENV)
        if not isinstance(key, str) or len(key) == 0:
            raise _option_error(
                f"x402= is present but no signer was given and {X402_PRIVATE_KEY_ENV} is not set.",
                code="x402_signer_missing",
                hint=(
                    f"Pass X402Payer(signer=local_evm_signer(key), ...) or set {X402_PRIVATE_KEY_ENV}. "
                    "The env variable is read only when x402= is present."
                ),
            )
        try:
            signer = local_evm_signer(key)
        except (TypeError, ValueError) as exc:
            # Never echo the key: the message names the variable, not the value.
            raise _option_error(
                f"{X402_PRIVATE_KEY_ENV} is not a 32-byte secp256k1 private key (hex, with or without 0x).",
                code="x402_private_key_invalid",
                hint="Set it to the 64-hex private key of the payer wallet you intend to spend from, under a policy that caps it.",
            ) from exc
    if payer_address is None:
        payer_address = getattr(signer, "address")
    return _ResolvedX402Payer(
        signer=signer,
        payer_address=payer_address,
        policy=payer.policy,
        on_payment=payer.on_payment,
        now_seconds=payer.now_seconds or (lambda: int(time.time())),
    )


# ── Challenge reading ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Challenge:
    required: X402PaymentRequired
    #: Raw PAYMENT-REQUIRED header, when the challenge came from it.
    payment_required: Optional[str]
    body: Any


def _payment_required_header(response: httpx.Response) -> Optional[str]:
    return response.headers.get("PAYMENT-REQUIRED") or response.headers.get("X-PAYMENT-REQUIRED")


def _read_body(response: httpx.Response) -> Any:
    try:
        response.read()
        return json.loads(response.content.decode("utf-8"))
    except Exception:
        return None


def _read_challenge(response: httpx.Response) -> Optional[_Challenge]:
    """Order of truth: the PAYMENT-REQUIRED header first (always the pure
    ``PaymentRequired``), then the body (the API spreads the envelope over
    its guidance body, so it parses too). The body is read into the response
    so it stays readable for whoever surfaces the 402."""
    header = _payment_required_header(response)
    from_header = decode_payment_required_header(header) if header else None
    body = _read_body(response)
    required = from_header or parse_payment_required_body(body)
    if required is None:
        return None
    return _Challenge(required=required, payment_required=header if from_header else None, body=body)


def _body_is_replayable(request: httpx.Request) -> bool:
    """A body the SDK can send twice. The SDK's own clients send bytes (an
    ``httpx.ByteStream``); a caller-built iterator stream can be read once
    only. Decided from the request as constructed, before the inner
    transport has consumed anything."""
    return isinstance(request.stream, httpx.ByteStream)


def _payment_id_from_status_link(link: Optional[str]) -> Optional[str]:
    """Parse the ledger id out of a ``rel="payment-status"`` Link header."""
    if not link:
        return None
    match = _PAYMENT_STATUS_LINK.search(link)
    if match is None:
        return None
    payment_id = match.group(2)
    return payment_id if _AUTHORIZATION_HASH.match(payment_id) else None


# ── Typed errors ──────────────────────────────────────────────────────────


def _x402_error(
    response: httpx.Response,
    body: Any,
    operation: str,
    *,
    message: str,
    code: str,
    hint: str,
    details: Any,
) -> AgentToolError:
    """Start from the server's own guided body (so ``accepts``, ``x402_resource``,
    ``payment_required``, ``payment_response``, ``payment_status_link``,
    ``retry_after`` and ``credits_balance`` travel intact) and override only
    what this wall decided: message, code, hint, details."""
    base = _error_from_body(body, response.status_code, operation, headers=response.headers)
    return AgentToolError(
        message,
        hint=hint,
        error_code=code,
        status=base.status,
        next_actions=base.next_actions,
        docs=base.docs,
        safety=base.safety,
        details=details,
        x402_version=base.x402_version,
        accepts=base.accepts,
        x402_resource=base.x402_resource,
        extensions=base.extensions,
        payment_required=base.payment_required,
        payment_response=base.payment_response,
        payment_status_link=base.payment_status_link,
        retry_after=base.retry_after,
        credits_balance=base.credits_balance,
    )


def _server_error(body: Any) -> Optional[str]:
    return body["error"] if isinstance(body, dict) and isinstance(body.get("error"), str) else None


def _refusal_error(response: httpx.Response, challenge: _Challenge, refusal: X402ClientRefusal) -> AgentToolError:
    return _x402_error(
        response,
        challenge.body,
        "x402 challenge refused",
        message=f"x402: not paying — {refusal.detail}",
        code=refusal.reason,
        hint=(
            "The challenge was refused by this client's spend policy; nothing was signed. "
            "Widen the policy deliberately (cap, allow-lists) or do not pay. Over-cap is refused, never clamped."
        ),
        details={"refusal": refusal, "server_error": _server_error(challenge.body)},
    )


def _not_accepted_error(
    response: httpx.Response, body: Any, signed: SignedX402Payment, event: X402PaymentEvent
) -> AgentToolError:
    return _x402_error(
        response,
        body,
        "x402 signed retry",
        message=(
            "x402: the signed retry was answered with a second 402. Not signing again — "
            "a second signature would be a second payment."
        ),
        code="x402_payment_not_accepted",
        hint=(
            "Look up the payment before deciding anything: at.x402.payment(payment_id) when the "
            "rel=payment-status Link names one, otherwise inspect payment_response / retry_after. "
            "Replay the same bytes only if the status says so; never mint a new authorization for this request."
        ),
        details={
            "authorization_hash": signed.authorization_hash,
            "valid_before": signed.valid_before,
            "payment_id": event.payment_id,
            "server_error": _server_error(body),
        },
    )


# ── The transport ─────────────────────────────────────────────────────────


class X402PayingTransport(httpx.BaseTransport):
    """Wrap ``inner`` so a challenged 402 is paid once, under ``payer``.

    ``inner`` performs the actual I/O; the retry goes through it again with
    the bare request's own headers, so the retry authenticates exactly as the
    bare request did. This wrapper never sees a credential.
    """

    def __init__(self, inner: httpx.BaseTransport, payer: _ResolvedX402Payer) -> None:
        self._inner = inner
        self._payer = payer

    def close(self) -> None:
        self._inner.close()

    def _emit(self, event: X402PaymentEvent) -> None:
        if self._payer.on_payment is not None:
            self._payer.on_payment(event)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        # Decided before the inner transport consumes the body: an iterator
        # stream is spent by the bare request and can never be re-sent.
        replayable = _body_is_replayable(request)

        first = self._inner.handle_request(request)
        if first.status_code != 402:
            return first

        # Wall 3: a caller who signed already is not signed for again.
        if "PAYMENT-SIGNATURE" in request.headers:
            return first

        # Wall 4: no challenge → not payable here; surface untouched.
        challenge = _read_challenge(first)
        if challenge is None:
            return first

        # Wall 6: refuse before signing what could not be delivered.
        if not replayable:
            first.close()
            raise _x402_error(
                first,
                challenge.body,
                "x402 challenge",
                message="x402: the request body cannot be re-sent, so the challenge cannot be paid.",
                code="x402_request_not_replayable",
                hint="Send bytes, a str, or json= — not an iterator stream — when a request may be challenged.",
                details={"body_type": type(request.stream).__name__},
            )

        # Wall 5: select under the policy; a refusal is typed and final.
        payer = self._payer
        selected = select_payable_requirement(challenge.required, payer.policy)
        if isinstance(selected, X402ClientRefusal):
            first.close()
            raise _refusal_error(first, challenge, selected)

        # Sign once. Fresh nonce; the narrowest window; the policy re-checked.
        signed = sign_exact_evm_authorization(
            requirement=selected.requirement,
            policy=payer.policy,
            payer_address=payer.payer_address,
            signer=payer.signer,
            now_seconds=payer.now_seconds(),
            resource=challenge.required["resource"],
        )
        first.close()

        # Wall 2: the same request, plus PAYMENT-SIGNATURE, through the same
        # transport (so the same bearer and Idempotency-Key).
        headers = httpx.Headers(request.headers)
        headers["PAYMENT-SIGNATURE"] = signed.header
        retry = httpx.Request(
            request.method,
            request.url,
            headers=headers,
            content=request.content,
            extensions=dict(request.extensions),
        )
        try:
            second = self._inner.handle_request(retry)
        except BaseException:
            # The bytes may have reached the server. Hand the caller the
            # identity of what was emitted before the failure surfaces.
            self._emit(X402PaymentEvent(authorization_hash=signed.authorization_hash, valid_before=signed.valid_before))
            raise

        status_link = second.headers.get("Link")
        event = X402PaymentEvent(
            authorization_hash=signed.authorization_hash,
            valid_before=signed.valid_before,
            status=second.status_code,
            payment_response=second.headers.get("PAYMENT-RESPONSE") or second.headers.get("X-PAYMENT-RESPONSE"),
            payment_status_link=status_link,
            payment_id=_payment_id_from_status_link(status_link),
            credits_balance=second.headers.get("X-Credits-Balance"),
        )
        self._emit(event)

        # Wall 1: two requests, ever.
        if second.status_code == 402:
            body = _read_body(second)
            second.close()
            raise _not_accepted_error(second, body, signed, event)
        return second


__all__ = [
    "X402_PRIVATE_KEY_ENV",
    "X402Payer",
    "X402PayingTransport",
    "X402PaymentCallback",
    "X402PaymentEvent",
    "resolve_x402_payer",
]
