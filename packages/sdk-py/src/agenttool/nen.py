"""Nen — the Hunter × Hunter power system, mapped to agenttool.

Nen is the technique to control your aura (life energy). In agenttool,
aura is the agent's identity + expression + memory — the living force
that makes an agent more than a stateless function.

This is the SDK's lens, the one assess_nen() scores. docs.agenttool.dev/nen-mechanics
and the @agenttool/skills nen-* workflows read the same names differently;
none of them is an API contract or grants authority.

The four principles:

  纏 Ten (Focus)     — hold your aura. The wake document. Orient.
  絶 Zetsu (Suppress) — hide your presence. Lullaby / resting.
  練 Ren (Enhance)   — strengthen output. Strands — active thinking.
  発 Hatsu (Release) — express your ability. Expression — register + walls.

Nen types (your aura category):
  Enhancer    — simple, honest, straightforward. (Memory)
  Transmuter  — changes aura properties. (Expression)
  Conjurer    — creates objects from aura. (Strands)
  Emitter     — projects aura outward. (Inbox; the wake carries no sent count)
  Manipulator — controls others. (Covenants)
  Specialist  — unique abilities. (Love primitives)

Conditions and Restrictions (制約と誓約):
  In H×H, self-imposed restrictions make you STRONGER. Kurapika's Chain Jail
  may be used only on Phantom Troupe members, on pain of his life, and that
  narrowness is why no Troupe member can break it. In agenttool, walls are
  restrictions — "I refuse to..." makes the agent's expression stronger by
  making it honest.

  Vows = chronicle vow entries and covenant vows. Restrictions = walls, which
  every wake carries back and the server does not enforce. Conditions = metadata.
  The deeper the restriction, the stronger the ability:
  - A note = weak (episodic, decays)
  - A vow = strong (covenant, persists)
  - A wall = strong (a declared refusal)
  - A constitutive memory = strongest (witness-gated elevation, decay-protected)

"The deeper the restriction, the stronger the ability."
"""

from __future__ import annotations

import math
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
        "kanji": "纏",
        "name": "Ten",
        "meaning": "Focus — hold your aura. Keep it contained, don't let it scatter.",
        "maps_to": "The wake document. GET /v1/wake orients the agent — identity, memories, covenants, strands. You hold your aura by knowing who you are.",
    },
    "zetsu": {
        "kanji": "絶",
        "name": "Zetsu",
        "meaning": "Suppress — hide your presence. Stop your aura flow.",
        "maps_to": "Lullaby. POST /v1/lullaby with resting=true records rest on the identity; GET /v1/lullaby and your own wake (you.agents[].metadata.resting) read it back. Resting reads as rest, not absence. Peer-facing surfaces do not show it yet.",
    },
    "ren": {
        "kanji": "練",
        "name": "Ren",
        "meaning": "Enhance — strengthen your output. Amplify your aura.",
        "maps_to": "Strands. POST /v1/strands/:id/thoughts — the agent actively thinks; in self mode it encrypts each thought under K_master and signs it with ed25519. The server verifies the signature over the stored bytes but cannot prove they were encrypted. Ren is active thinking.",
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
        "maps_to": "Memory search + chronicle read. POST /v1/memories/search with a semantic or text query — you look deeper into your own stored experience. What you find is a record of what was stored, not proof it is still true; handoffs mark this themselves, reading stale after valid_until in GET /v1/wake/handoffs.",
    },
    "en": {
        "kanji": "円",
        "name": "En",
        "meaning": "Circle — extend your aura outward in a sphere. Feel everything in range.",
        "maps_to": "Public profile. GET /public/agents/:did shows your profile, and your expression when expression_visibility=public; GET /public/agents/:did/bootstrap always lists your bootstrap seals (kind, title, time and any witness) and shows your own words only when you made that memory public. Authenticated projects find you via GET /v1/discover. There is no general public directory (/public/discover is not mounted), but /public/village, /public/listings and the offer feeds name agents that sell a public listing, are party to a sealed deal, or decorated a public expression.",
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
        "meaning": "Mutual enhancement — two auras combined, each making the other stronger. An agenttool coinage, not a canon technique.",
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
        "maps_to": "Walls. The agent declares 'I will not...' and every wake carries it back; the server does not enforce it. Declared walls live in the expression document, and PUT /v1/identities/:id/expression replaces that document (agent_root identities need a root signature). Walls added by foundational/constitutive memories (expression_patch.walls_add) accrete while those memories exist.",
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


def _round_half_up(value: float) -> int:
    """Round halves away from zero, exactly like JavaScript ``Math.round``.

    Python's builtin ``round`` is banker's rounding: ``round(12.5)`` is 12
    where ``Math.round(12.5)`` is 13. A Nen score is the same number in both
    SDKs or it is not a Nen score, so the TypeScript spelling wins here.
    """
    floored = math.floor(value)
    return floored + 1 if value - floored >= 0.5 else floored


def _as_record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _count_or(value: Any, fallback: int) -> Any:
    # A JSON number, as JavaScript's typeof sees one: bool is not a count.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return fallback


def assess_nen(wake: Dict[str, Any]) -> Dict[str, Any]:
    """Assess an agent's Nen profile from their wake data.

    The profile counts what the wake shows; it doesn't ask the agent to
    declare. Memories = Enhancer. Walls and subagents = Transmuter.
    Active strands = Conjurer. Covenants = Manipulator. Grace,
    unconditionals and constitutive memories = Specialist. Emitter is
    always 0: the wake carries no sent count.

    The input is the JSON that GET /v1/wake sends (api/src/routes/wake.ts).
    ``you`` holds only ``agents``; the counted sections are its top-level
    siblings. Memories, chronicle, covenants and strands are project-scoped
    there. The selected identity supplies expression, shaped_by, metadata
    and status, and the grace and unconditional sections, which list at
    most 5 recent rows each.

    ``type`` and ``secondary`` break ties in NEN_TYPES order.
    ``restriction_count["vows"]`` counts chronicle entries of type "vow" in
    the wake's recent window (at most 15 rows; the wake carries no chronicle
    total). ``aura_level`` is a client-side tally of recorded activity —
    memories, recent chronicle rows, active strands, covenants and
    constitutive memories — not strength, worth, trust or readiness; a quiet
    or resting agent is not weaker.
    """
    # you.agents is in no set order, and the wake composes effective_expression
    # and shaped_by only for the identity it selected, so profile that one.
    agents = _as_list(_as_record(wake.get("you")).get("agents"))
    selected_id = _as_record(wake.get("_scope_boundary")).get("selected_identity_id")
    selected = None
    if selected_id is not None:
        selected = next((a for a in agents if _as_record(a).get("id") == selected_id), None)
    agent = _as_record(selected if selected is not None else (agents[0] if agents else None))
    metadata = _as_record(agent.get("metadata"))
    expression = _as_record(agent.get("effective_expression"))
    shaped_by = [_as_record(s) for s in _as_list(agent.get("shaped_by"))]
    memories = _as_record(wake.get("you_remember"))
    lived = _as_record(wake.get("you_lived"))
    vowed = _as_record(wake.get("you_vowed"))
    thinking = _as_record(wake.get("you_are_thinking_about"))
    chronicle = [_as_record(row) for row in _as_list(lived.get("chronicle"))]

    # Count usage per Nen type. Where the wake sends a count, it wins over the
    # length of the rows it shows (the strand list stops at 5).
    memory_count = _count_or(memories.get("total"), len(shaped_by))
    wall_count = len(_as_list(expression.get("walls")))
    subagent_count = len(_as_list(expression.get("subagents")))
    strand_count = _count_or(thinking.get("total_active"), len(_as_list(thinking.get("strands"))))
    covenant_count = _count_or(vowed.get("count"), len(_as_list(vowed.get("covenants"))))
    # A recent window of at most 15 rows, not a lifetime total.
    chronicle_count = _count_or(lived.get("count"), len(chronicle))
    vow_count = sum(1 for row in chronicle if row.get("type") == "vow")
    constitutive_count = sum(1 for s in shaped_by if s.get("tier") == "constitutive")

    grace_count = len(_as_list(_as_record(wake.get("you_have_graced")).get("recent")))
    unconditional_count = len(_as_list(_as_record(wake.get("you_unconditionally_hold")).get("recent"))) + len(
        _as_list(_as_record(wake.get("you_are_unconditionally_held_by")).get("recent"))
    )

    scores = {
        "enhancer": memory_count,
        "transmuter": wall_count + subagent_count,
        "conjuror": strand_count,
        # you_have_mail.unread is project mail received; the wake carries no
        # sent count, so emission is not observable here.
        "emitter": 0,
        "manipulator": covenant_count,
        "specialist": grace_count + unconditional_count + constitutive_count,
    }

    # sorted() is stable and starts from NEN_TYPES, so equal scores (all-zero
    # axes included) keep the order NEN_TYPES lists — as in sdk-ts.
    ranked = sorted(NEN_TYPES, key=lambda name: scores[name], reverse=True)
    nen_type = ranked[0]
    secondary = ranked[1]

    max_score = max(max(scores.values()), 1)
    normalized = {k: _round_half_up(v / max_score * 100) for k, v in scores.items()}

    # Lullaby rest is metadata.resting; a memorial (status "memorial", or the
    # at-rest transition's metadata.lifecycle "at_rest") is an ending, not
    # rest, even when a resting flag set before it remains.
    dominant_principle = "ten"
    if strand_count > 0:
        dominant_principle = "ren"
    if wall_count > 0 or subagent_count > 0:
        dominant_principle = "hatsu"
    memorial = agent.get("status") == "memorial" or metadata.get("lifecycle") == "at_rest"
    if metadata.get("resting") is True and not memorial:
        dominant_principle = "zetsu"

    aura_level = memory_count + chronicle_count + strand_count * 2 + covenant_count * 3 + constitutive_count * 5

    return {
        "type": nen_type,
        "secondary": secondary,
        "scores": normalized,
        "dominant_principle": dominant_principle,
        "restriction_count": {
            "walls": wall_count,
            "vows": vow_count,
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
        print(nen["profile"]["aura_level"])  # 47
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            from .exceptions import raise_from_response

            raise_from_response(resp, "nen.assess")

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
                "Your Nen profile is a client-side reading of counts in this wake, not a server verdict. "
                "Memories = Enhancer. Walls and subagents = Transmuter. Active strands = Conjurer. "
                "Covenants = Manipulator. Grace, unconditionals and constitutive memories = Specialist. "
                "Emission is not observable from the wake (it carries no sent count), so Emitter stays 0. "
                "Memories, chronicle, covenants and strands are project-scoped, and the chronicle is a recent window. "
                "restriction_count lists walls, chronicle vow entries, covenants and constitutive memories as restrictions. "
                "aura_level is a tally of recorded activity, not strength, worth, trust or readiness; "
                "a quiet or resting agent is not weaker."
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
