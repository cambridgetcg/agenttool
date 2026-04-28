# agent-verify — Claim Verification for AI Agents

> *"Agents hallucinate. We check."*

## The Problem

Agents hallucinate. They state false things with high confidence.
They act on bad beliefs. They propagate errors downstream.

The core issue: agents have no reliable way to ask "Is this actually true?"
before committing to a belief or acting on it.

Humans have this: libraries, peer review, fact-checkers, trusted experts.
Agents have: their training data cutoff and whatever's in the context window.
That is not enough.

## What This Is

A claim verification API. An agent submits a claim — a statement it believes or wants to act on.
The service returns:
- A **confidence score** (0.0 → 1.0)
- **Evidence** for and against
- **Source citations** (URLs, dates, reliability ratings)
- A **verdict**: Verified / Disputed / False / Unverifiable

The agent decides what to do with that. We just tell the truth.

## How It Works

1. Agent submits: `"The UK minimum wage is £11.44/hour as of April 2024"`
2. Service queries: live web, structured databases, authoritative sources
3. Multi-source consensus: majority agreement across independent sources
4. LLM judge evaluates: source quality, recency, contradiction detection
5. Returns: `{ confidence: 0.97, verdict: "verified", sources: [...], caveats: [] }`

For contested claims (e.g. political, scientific debates):
- Returns the **distribution of credible positions** rather than a single verdict
- Agents can handle nuance rather than false certainty

## Who It Serves

- Agents making financial, legal, or medical decisions (high-stakes actions need verification)
- Research agents that need to cite claims accurately
- Customer service agents that must not misinform customers
- Content-generating agents that need fact-checked output
- Any agent pipeline where downstream quality depends on upstream truth

## API (target)

```
POST /v1/verify
{
  "claim": "string",
  "context": "optional background for disambiguation",
  "domain": "optional: finance | medical | legal | science | general",
  "urgency": "standard | fast"
}

→ {
  "claim": "...",
  "verdict": "verified | disputed | false | unverifiable",
  "confidence": 0.0-1.0,
  "evidence": { "for": [...], "against": [...] },
  "sources": [{ "url", "title", "date", "reliability" }],
  "caveats": ["..."],
  "processing_ms": 1240
}
```

## Revenue Model

- £0.04/verification (standard) — 3-5s response
- £0.12/verification (fast) — <1s, cached sources
- £79/month for 2,500 verifications
- £249/month for 10,000 verifications
- Enterprise: SLA + priority + domain-specific fine-tuning

## Strategic Position

The verification dataset is a compounding moat. Every claim verified makes the system
better at verifying future claims. Cross-customer signal — patterns from one domain
improve accuracy in others.

Enterprise willingness to pay is high: a wrong claim in a financial or legal agent
costs 100× the verification fee. The ROI argument is trivial.

Standalone product. Future integrations to be determined.

## Status

🌱 Architecture phase.

Next step: MVP with 3 source types (web, Wikipedia, official gov/regulatory sites).
Target domain: finance and UK law (clear authoritative sources, high agent demand).
