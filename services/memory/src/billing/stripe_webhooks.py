"""Stripe webhook handler for subscription lifecycle events."""

from __future__ import annotations

import logging

import stripe
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_db
from ..config import settings
from ..models import Project, UsageEvent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/billing", tags=["billing"])

stripe.api_key = settings.stripe_secret_key

# Map Stripe price IDs to plan names (configure these after creating Stripe products)
PRICE_TO_PLAN: dict[str, str] = {
    # "price_xxx": "seed",
    # "price_yyy": "grow",
    # "price_zzz": "scale",
}

PLAN_CREDITS: dict[str, int] = {
    "seed": 10_000,
    "grow": 100_000,
    "scale": 1_000_000,
}


@router.post("/webhooks")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        await _handle_checkout(data)
    elif event_type == "invoice.payment_succeeded":
        await _handle_payment_succeeded(data)
    elif event_type == "invoice.payment_failed":
        await _handle_payment_failed(data)
    elif event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(data)
    else:
        logger.debug(f"Unhandled Stripe event: {event_type}")

    return {"received": True}


async def _handle_checkout(data: dict):
    """Activate subscription after successful checkout."""
    logger.info(f"Checkout completed: {data.get('id')}")
    # TODO: link Stripe customer to project, activate plan


async def _handle_payment_succeeded(data: dict):
    """Renew credits on successful monthly payment."""
    logger.info(f"Payment succeeded: {data.get('id')}")
    # TODO: look up project by Stripe customer ID, reset credits to plan level


async def _handle_payment_failed(data: dict):
    """Start grace period on failed payment."""
    logger.warning(f"Payment failed: {data.get('id')}")
    # TODO: notify project owner, start 3-day grace period


async def _handle_subscription_deleted(data: dict):
    """Downgrade to dev plan when subscription cancelled."""
    logger.info(f"Subscription deleted: {data.get('id')}")
    # TODO: downgrade project to 'seed' plan, preserve data for 30 days
