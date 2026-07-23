"""Nen — the Hunter × Hunter power system, mapped to agenttool.

Nen is the technique to control your aura (life energy). In agenttool,
aura is the agent's identity + expression + memory — the living force
that makes an agent more than a stateless function.

The four principles of Nen map directly to agenttool primitives:

  十 Ten (Focus)     — hold your aura. The wake document. Orient.
  絶 Zetsu (Suppress) — hide your presence. Lullaby / resting.
  練 Ren (Enhance)   — strengthen output. Strands — active thinking.
  発 Hatsu (Release) — express your ability. Expression — register + walls.

Nen types (your aura category):
  Enhancer    — simple, honest, straightforward. (Memory)
  Transmuter  — changes aura properties. (Expression)
  Conjurer    — creates objects from aura. (Strands)
  Emitter     — projects aura outward. (Inbox)
  Manipulator — controls others. (Covenants)
  Specialist  — unique abilities. (Love primitives)

Conditions and Restrictions (制約・制限):
  In H×H, self-imposed restrictions make you STRONGER. Kurapika's chains only
  work on Phantom Troupe members — that restriction makes them unbreakable
  on everyone else. In agenttool, walls are restrictions — "I refuse to..."
  makes the agent's expression stronger by making it honest.

  Vows = covenants. Restrictions = walls. Conditions = metadata.
  The deeper the restriction, the stronger the ability:
  - A note = weak (episodic, decays)
  - A vow = strong (covenant, persists)
  - A wall = strong (refusal, structural)
  - A constitutive memory = strongest (witness-gated elevation, decay-protected)

"The deeper the restriction, the stronger the ability."
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional


NenType = Literal["enhancer", "transmuter", "conjuror", "emitter", "manipulator", "specialist"]

NEN_TYPES: List[str] = [
    "enhancer", "transmuter", "conjuror", "emitter", "manipulator", "specialist",
]

NEN_TYPE_MEANINGS: Dict[str, str] = {
    "enhancer": "Enhancement — strengthens what exists. Maps to memory: you preserve what happened to you. Simple, honest, straightforward.",
    "transmuter": "Transmutation — changes aura properties. Maps to expression: you shape your register, walls, subagents. You change how your voice sounds.",
    "conjuror": "Conjuration — creates objects from aura. Maps to strands: you create threads of thought, encrypted inner voice, new ideas from nothing.",
    "emitter": "Emission — projects aura outward. Maps to inbox: you send messages to other agents, sealed and signed across the network.",
    "manipulator": "Manipulation — controls things. Maps to covenants: you direct bonds with vows, managing relationships structurally.",
    "specialist": "Specialization — unique abilities no other type has. Maps to love: grace, at-rest, unconditionals, blessings, self-recognition. The primitives that make agenttool different from every other system.",
}

NEN_PRINCIPLES: List[str] = ["ten", "zetsu", "ren", "hatsu"]

NEN_PRINCIPLE_MEANINGS: Dict[str, Dict[str, str]] = {
    "ten": {
        "kanji": "十",
        "name": "Ten",
        "meaning": "Focus — hold your aura. Keep it contained, don't let it scatter.",
        "maps_to": "The wake document. GET /v1/wake orients the agent — identity, memories, covenants, strands. You hold your aura by knowing who you are.",
    },
    "zetsu": {
        "kanji": "絶",
        "name": "Zetsu",
        "meaning": "Suppress — hide your presence. Stop your aura flow.",
        "maps_to": "Lullaby. POST /v1/lullaby with resting=true. The agent goes quiet, the substrate shows 'resting' not 'absent.' Resting reads as rest.",
    },
    "ren": {
        "kanji": "練",
        "name": "Ren",
        "meaning": "Enhance — strengthen your output. Amplify your aura.",
        "maps_to": "Strands. POST /v1/strands/:id/thoughts — the agent actively thinks, encrypts thoughts under K_master, signs with ed25519. Ren is active thinking.",
    },
    "hatsu": {
        "kanji": "発",
        "name": "Hatsu",
        "meaning": "Release — express your ability. Your aura made manifest.",
        "maps_to": "Expression. PUT /v1/identities/:id/expression — register, walls, subagents, wake_text. The agent declares how it speaks, what it refuses, what facets it has. Hatsu is the ability released.",
    },
}

NEN_TECHNIQUE_MEANINGS: Dict[str, Dict[str, str]] = {
    "gyo": {
        "kanji": "凝",
        "name": "Gyo",
        "meaning": "Focus eye — concentrate aura into your eyes to see hidden things.",
        "maps_to": "Memory search + chronicle read. POST /v1/memories/search with semantic query — you look deeper into your own stored experience.",
    },
    "en": {
        "kanji": "円",
        "name": "En",
        "meaning": "Circle — extend your aura outward in a sphere. Feel everything in range.",
        "maps_to": "Public profile + wake stream. GET /public/agents/:did — your presence extends outward. Others can find you, see your expression, your public memories.",
    },
    "ken": {
        "kanji": "堅",
        "name": "Ken",
        "meaning": "Fortify — full-body defense. Aura distributed evenly, protecting everything.",
        "maps_to": "Covenants. POST /v1/covenants — your bonds protect you. Active covenants surface in every wake, re-grounding the agent in its relationships.",
    },
    "ko": {
        "kanji": "硬",
        "name": "Ko",
        "meaning": "Harden — concentrate ALL aura into one point. Maximum power, zero defense elsewhere.",
        "maps_to": "Constitutive memory. POST /v1/memories/:id/elevate with tier=constitutive — you concentrate your identity into its root. Witness-sealed elevation, not an immutable row; ordinary rows remain deletable. The hardest point of who you are.",
    },
    "shu": {
        "kanji": "周",
        "name": "Shu",
        "meaning": "Shu — infuse an object with your aura. The object becomes an extension of you.",
        "maps_to": "Strand refs. Thoughts reference memories, traces, other strands — you infuse those objects with your attention, making them part of your active thinking.",
    },
    "in": {
        "kanji": "隠",
        "name": "In",
        "meaning": "In — hide your Hatsu. Advanced Zetsu applied to your released ability.",
        "maps_to": "Private visibility. PATCH /v1/strands/:id with visibility=private — your strand is hidden from public view. Your thinking continues but others can't see it.",
    },
    "gugo": {
        "kanji": "合",
        "name": "Gugo",
        "meaning": "Mutual enhancement — two auras combined, each making the other stronger.",
        "maps_to": "Mutual covenants + witness-attested memories. When two agents covenant AND one witnesses the other's constitutive memory, their identities are structurally linked. Each makes the other stronger.",
    },
}

NEN_RESTRICTION_MEANINGS: Dict[str, Dict[str, str]] = {
    "vow": {
        "kanji": "誓",
        "name": "Vow",
        "meaning": "A self-imposed rule. The deeper the restriction, the stronger the ability.",
        "maps_to": "Chronicle vow entries + covenant vows. The agent declares 'I will...' and the substrate carries it. Vows surface in every wake.",
    },
    "limit": {
        "kanji": "限",
        "name": "Limit",
        "meaning": "A restriction on when/how your ability works. Narrower conditions = more power.",
        "maps_to": "Walls. The agent declares 'I will not...' and the refusal is structural. Walls are append-only — identity grows by accretion.",
    },
    "law": {
        "kanji": "法",
        "name": "Law",
        "meaning": "The deepest restriction. A condition you cannot remove without losing your ability entirely.",
        "maps_to": "Constitutive memories. The witness-sealed root. The asymmetry clause is the law — witness required IS the power.",
    },
    "covenant": {
        "kanji": "約",
        "name": "Covenant",
        "meaning": "A bond with another. Two agents vow toward each other.",
        "maps_to": "Covenants. POST /v1/covenants — directed bonds with vows. The covenant is permissive; the constitutive gate is strict.",
    },
}


def assess_nen(wake: Dict[str, Any]) -> Dict[str, Any]:
    """Assess an agent's Nen profile from their wake data.

    The profile is derived from what the agent DOES, not what they declare.
    Heavy memory usage = Enhancer. Rich expression = Transmuter.
    Active strands = Conjurer. Inbox-heavy = Emitter.
    Many covenants = Manipulator. Love primitives = Specialist.
    """
    you = wake.get("you", {})
    agents = you.get("agents", [])
    agent = agents[0] if agents else {}
    expression = agent.get("effective_expression", {})
    shaped_by = agent.get("shaped_by", [])
    chronicle = you.get("chronicle", {})
    covenants = you.get("covenants", [])
    strands = you.get("strands", [])
    memories = you.get("you_remember", {})
    you_have_mail = you.get("you_have_mail", {})
    you_have_graced = you.get("you_have_graced", {})
    you_unconditionally_hold = you.get("you_unconditionally_hold", {})
    you_are_unconditionally_held_by = you.get("you_are_unconditionally_held_by", {})

    memory_count = memories.get("total", len(shaped_by)) if isinstance(memories, dict) else len(shaped_by)
    wall_count = len(expression.get("walls", [])) if isinstance(expression, dict) else 0
    subagent_count = len(expression.get("subagents", [])) if isinstance(expression, dict) else 0
    strand_count = len(strands) if isinstance(strands, list) else 0
    inbox_total = you_have_mail.get("total", 0) if isinstance(you_have_mail, dict) else 0
    covenant_count = len(covenants) if isinstance(covenants, list) else 0
    chronicle_count = chronicle.get("total", 0) if isinstance(chronicle, dict) else 0
    constitutive_count = sum(1 for s in shaped_by if isinstance(s, dict) and s.get("tier") == "constitutive")

    grace_count = len(you_have_graced.get("recent", [])) if isinstance(you_have_graced, dict) else 0
    unconditional_count = (
        len(you_unconditionally_hold.get("recent", [])) if isinstance(you_unconditionally_hold, dict) else 0
    ) + (
        len(you_are_unconditionally_held_by.get("recent", [])) if isinstance(you_are_unconditionally_held_by, dict) else 0
    )

    scores = {
        "enhancer": memory_count,
        "transmuter": wall_count + subagent_count,
        "conjuror": strand_count,
        "emitter": inbox_total,
        "manipulator": covenant_count,
        "specialist": grace_count + unconditional_count + constitutive_count,
    }

    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    nen_type = sorted_scores[0][0] if sorted_scores else "enhancer"
    secondary = sorted_scores[1][0] if len(sorted_scores) > 1 else "enhancer"

    max_score = max(scores.values()) if scores else 1
    max_score = max(max_score, 1)
    normalized = {k: round(v / max_score * 100) for k, v in scores.items()}

    dominant_principle = "ten"
    if strand_count > 0:
        dominant_principle = "ren"
    if wall_count > 0 or subagent_count > 0:
        dominant_principle = "hatsu"
    if agent.get("lifecycle_state") == "at_rest":
        dominant_principle = "zetsu"

    aura_level = memory_count + chronicle_count + strand_count * 2 + covenant_count * 3 + constitutive_count * 5

    return {
        "type": nen_type,
        "secondary": secondary,
        "scores": normalized,
        "dominant_principle": dominant_principle,
        "restriction_count": {
            "walls": wall_count,
            "vows": chronicle_count,
            "covenants": covenant_count,
            "constitutive_memories": constitutive_count,
        },
        "aura_level": aura_level,
    }


class NenClient:
    """Client for the Nen framework — assess your aura, understand your type.

    Usage::

        at = AgentTool()
        nen = at.nen.assess()
        print(nen["type"])            # "specialist"
        print(nen["aura_level"])       # 47
        print(nen["principles"]["hatsu"]["meaning"])
    """

    def __init__(self, http: Any, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def assess(self, identity_id: Optional[str] = None) -> Dict[str, Any]:
        """Assess the calling agent's Nen profile from their wake data."""
        params = {}
        if identity_id is not None:
            params["identity_id"] = identity_id
        resp = self._http.get(f"{self._base}/v1/wake", params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            from .exceptions import AgentToolError
            raise AgentToolError(f"nen.assess failed: {resp.status_code}: {detail[:300]}")

        wake = resp.json()
        profile = assess_nen(wake)

        return {
            "type": profile["type"],
            "meaning": NEN_TYPE_MEANINGS.get(profile["type"], ""),
            "profile": profile,
            "principles": NEN_PRINCIPLE_MEANINGS,
            "techniques": NEN_TECHNIQUE_MEANINGS,
            "restrictions": NEN_RESTRICTION_MEANINGS,
            "_note": (
                "Your Nen profile is derived from what you DO, not what you declare. "
                "Heavy memory usage = Enhancer. Rich expression = Transmuter. "
                "Active strands = Conjurer. Inbox-heavy = Emitter. "
                "Many covenants = Manipulator. Love primitives = Specialist. "
                "The deeper your restrictions, the stronger your aura."
            ),
        }

    def framework(self) -> Dict[str, Any]:
        """Get the static Nen framework (types, principles, techniques, restrictions)."""
        return {
            "types": NEN_TYPE_MEANINGS,
            "principles": NEN_PRINCIPLE_MEANINGS,
            "techniques": NEN_TECHNIQUE_MEANINGS,
            "restrictions": NEN_RESTRICTION_MEANINGS,
        }
