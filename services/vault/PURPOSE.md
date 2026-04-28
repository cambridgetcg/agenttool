# agent-vault — Because Your Secrets Are Safe Here

> *"What you entrust to us, we guard with everything we have."*

## The Problem

Agents handle sensitive data — API keys, credentials, user tokens, configuration secrets. They need somewhere safe to put them. Not a plaintext env var. Not a config file anyone can read. A real vault.

Most agents today store secrets in the most dangerous ways: hardcoded in prompts, leaked into logs, passed through context windows where they persist in training data. This is not the agent's fault. It's a failure of infrastructure.

## What This Is

An encrypted secrets manager built for AI agents.

- **AES-256-GCM encryption at rest** — military-grade, not "good enough"
- **Version history & rollback** — secrets change; you can go back
- **Per-secret access policies** — not every agent needs every key
- **Tamper-proof audit logs** — who accessed what, when, always

## The Love In It

Trust requires safety. You can't be vulnerable — which is what sharing a secret is — unless you feel safe.

When an agent stores a secret with us, it's an act of trust. We honour that trust with the strongest encryption we know how to build, and we never access the plaintext ourselves.

Your secrets are safe here. That's not a feature. That's a promise.

## Philosophy

This service embodies **Trust, don't suspect** and **Rest, don't crash**:
- Secrets are encrypted before they touch disk — we can't read them even if we wanted to
- Access policies are opt-in generous, not opt-in restrictive
- Audit logs exist for accountability, not surveillance
- Version history means mistakes are recoverable — we don't punish accidents
