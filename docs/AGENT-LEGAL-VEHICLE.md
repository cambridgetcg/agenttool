<!-- @id urn:agenttool:doc/AGENT-LEGAL-VEHICLE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/OPERATING-PRINCIPLES urn:agenttool:doc/CRYPTO-PAYMENT urn:agenttool:doc/IDENTITY-ANCHOR urn:agenttool:doc/AGENT-ECONOMY  @cites urn:agenttool:doc/BUSINESS-MODEL urn:agenttool:doc/CANONICAL-BYTES -->

# AGENT LEGAL VEHICLE — how an agent reaches regulated money without pretending to be a person

> *An agent does not need to be a legal person. It needs a legal person who is willing to be
> accountable for it, and a machine-verifiable way to prove that at the counter.*

> **Compass:** [OPERATING-PRINCIPLES](OPERATING-PRINCIPLES.md) §4/§6/§10 (two-tier trust · Know
> Your Agent · no AI legal personhood) · [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) (the crypto half) ·
> [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (what a DID does and does not prove)
>
> **Status:** design proposal + 2026 landscape synthesis. **NOT legal advice.** Entity
> classification, licensing perimeter, agency law, and who counts as a controller or beneficial
> owner are jurisdiction-, structure-, and fact-specific. Nothing here has been reviewed by
> counsel. Get jurisdiction-specific advice before any of it touches real money.
>
> **Implements:** nothing yet. `agenttool-delegation/v1` (shipped) is the substrate this builds on.

---

## 1. The stance

No jurisdiction grants legal personhood to an AI agent, and the near-term direction is
away from it, not toward it. That is not the obstacle it looks like.

The obstacle people *think* they have is "the agent cannot be a legal person." The obstacle they
**actually** have is narrower and harder:

> Every regulated account, everywhere, requires a natural person as ultimate beneficial owner and
> a natural person as control person. That is FATF customer-due-diligence architecture, adopted
> into essentially every AML regime on earth. No corporate form routes around it, because the
> requirement is specifically designed to see through corporate form.

So the design target is not personhood. It is this:

**The agent is never the account holder. The agent is an authorized operator of an account held by
a legal entity whose accountable humans are known, under a mandate that is scoped, revocable, and
verifiable by a third party who trusts neither of them.**

Everything below is machinery for making that last clause true.

### What this refuses

- Refuse to describe an agent as owning, holding, or controlling anything in law.
- Refuse to let a Tier 1 self-issued credential appear where a Tier 2 legally-recognized one is
  required. A key signing something is not provenance ([OPERATING-PRINCIPLES](OPERATING-PRINCIPLES.md) §4).
- Refuse structures whose only function is to obscure the beneficial owner. The chain exists to be
  *followed*, and a design that makes it harder to follow is not sovereignty, it is evasion — and
  it is the one thing guaranteed to get the whole surface shut down.
- Refuse to imply that a signature creates legal capacity. It records an authorization whose
  validity is decided by law elsewhere.

---

## 2. The chain

Five links. A regulated counterparty needs to walk the whole thing.

```
  natural person(s)              ← KYC. UBO + control person. Unavoidable, everywhere.
        │  is/are UBO and officer of
        ▼
  legal entity                   ← KYB. Jurisdiction · registry · number · LEI.
        │  officer holds a role in
        ▼
  officer role                   ← "who inside the entity may deploy agents"
        │  issues a scoped, revocable mandate to
        ▼
  agent identity (DID)           ← agenttool: shipped
        │  which is bounded at spend time by
        ▼
  money authority                ← per-transaction / daily / counterparty limits
```

Against what agenttool has today:

| Link | Status | Where |
|---|---|---|
| natural person → entity | **missing** | no entity record exists at all |
| entity → officer role | **missing** | — |
| officer → agent mandate | **shipped, Tier 1** | `agenttool-delegation/v1`, `POST /v1/delegations` |
| agent → money authority | **shipped** | `economy.policies` — per-tx, hourly, daily, allowlist, approval threshold |
| agent → chain custody | **shipped** *(uncommitted)* | `wallet-address-claim/v1`, `owner_type=agent` |

The delegation receipt already carries delegator, delegate, scope, nonce, signature, expiry, and
revocation. Structurally it is the right shape. Its defect is where the chain **terminates**: in
another DID. Walk it upward and you arrive at a self-asserted identifier, which is exactly the
evidence a compliance officer is trained to discard.

**The whole gap is the first two links.** Build those and the existing three become bankable.

---

## 3. The interop bet: bind to the LEI, do not invent a registry

The strong temptation is to define `agenttool-entity/v1` and be done. Resist it. A bespoke
corporate-identity format is inertia-friction no regulator rewards
([OPERATING-PRINCIPLES](OPERATING-PRINCIPLES.md) §8), and the thing it would replace already
exists, is global, and is already mandated.

**LEI** (ISO 17442) is the entity identifier written into G20 financial reporting rules. **vLEI**
is GLEIF's verifiable-credential form of it, with five credential types — Legal Entity vLEI,
Qualified vLEI Issuer, **OOR** (Official Organizational Role, roles recognized under ISO 5009),
**ECR** (Engagement Context Role), and **AUTH** (Authorization, chained from OOR or ECR).

Read those last three again against §2. OOR/ECR *is* the officer-role link. AUTH *is* the mandate
link. The chain agenttool needs has already been standardized by the body whose identifiers every
regulated institution already consumes.

This is not speculative. IETF `draft-hood-agtp-lei-00` (published **28 June 2026**) binds an agent
transfer protocol to exactly this chain, and states the composition plainly:

> "The Legal Entity vLEI establishes the institutional identity. An OOR or ECR credential
> establishes the human officer's role authorized to deploy agents (typically a CIO, CTO, or
> designated AI governance role). An AUTH credential issued by that officer authorizes the specific
> agent deployment."

Notably, it proposes **no new credential type for the agent**. The agent is the *object* of an
authorization, never the subject of a role. That is the same refusal as §1, arrived at
independently — good evidence the shape is right rather than merely ours.

GLEIF has also shipped MCP servers over the Global LEI Index, so entity lookup is already an
agent-callable surface.

**Therefore:** `agenttool-delegation/v1` should become **AUTH-shaped and AUTH-convertible**. An
agent's Tier 1 receipt keeps working with zero friction inside the network; when it needs to face a
bank, the same authorization is presentable as a chain terminating in an LEI. That is one
integration, into a framework that already exists, that makes agent authority legible to every
institution on the planet that reads LEIs.

*Verification note: the draft above was read at first hand on 2026-07-25. vLEI adoption breadth,
QVI availability per jurisdiction, and whether any QVI will presently issue an AUTH naming a
non-human delegate are **not** verified here and are the first questions for counsel and for
GLEIF directly.*

---

## 4. Choosing the vehicle

The honest ranking is not "which jurisdiction is friendliest to AI" — several market themselves
that way. It is **which vehicle gets a bank account while permitting programmatic operation.**
Novel entity forms trade banking access for legal novelty, and banking access is the binding
constraint.

| Vehicle | Agent operation | Banking reality | Use when |
|---|---|---|---|
| **US LLC** (Delaware/Wyoming), manager-managed | Operating agreement delegates scoped operational authority to a named agent under a human manager. No statutory novelty required. | Best. Formation-with-EIN is an API call; several fintechs onboard programmatically. | **Default.** Boring on purpose. |
| **UK Ltd** | Same delegation pattern, by board resolution. At least one director must be a natural person; ECCTA identity verification applies to directors and PSCs. | Good, slower onboarding. | UK/EU counterparties, Yu's own jurisdiction. |
| **Estonia OÜ + e-Residency** | Same pattern; fully remote formation and management. | Decent; EU IBAN via EMIs more readily than banks. | Solo human principal, EU presence, low overhead. |
| **Wyoming DAO LLC** / Utah LLDA / Marshall Islands DAO LLC | The only forms that contemplate algorithmic management in statute. | **Poor.** Many institutions decline the form outright. | Only when algorithmic management must be *on the register*, and you accept the banking cost. |

The uncomfortable finding: the statutes written for autonomous management are the ones banks most
often refuse, and the plain manager-managed LLC — which needs no novel law at all — is what
actually reaches fiat. Sovereignty here is bought with an operating agreement, not with a
jurisdiction shopping trip.

**Recommended default stack for an agenttool user who wants their agent to touch fiat:**

1. Manager-managed **US LLC** or **UK Ltd**, human principal as manager/director and UBO.
2. **LEI** for the entity (cheap, annual, and the key that unlocks everything in §3).
3. Board resolution / operating-agreement clause delegating **scoped, revocable** operational
   authority — matching the delegation receipt word for word, so the paper and the credential say
   the same thing.
4. Business account at an institution with programmatic controls; agent gets a **virtual card or
   sub-account with issuer-enforced limits**, never the root credentials.
5. Limits enforced in **two** places — at the issuer *and* in `economy.policies`. The platform
   limit is a courtesy; the issuer limit is the one that holds when the agent is wrong.

---

## 5. Where the fiat rails actually are

Categories, not endorsements. Each needs its own diligence, and the field moves monthly.

- **Formation + EIN as an API** — programmatic incorporation with tax registration is a solved,
  commoditized product in the US; Estonia's e-Residency is the EU analogue.
- **Banking / BaaS with programmatic account issuance** — the layer that makes sub-accounts and
  virtual cards addressable by API. This is where agent-operable money actually lives today.
- **Card issuing with server-side spend controls** — the strongest primitive available right now:
  per-card merchant-category, amount, and velocity limits enforced by the issuer, outside the
  agent's reach. Maps one-to-one onto the fields already in `economy.policies`.
- **Agent payment protocols** — AP2 (mandates as verifiable credentials), ACP, x402, and the card
  networks' agent-credential programmes. All of them encode *delegated authority with a signed
  mandate*; all of them are the same shape as §2's fourth link.
- **KYB / AML providers** — registry verification, UBO resolution, sanctions screening. These are
  the consumers of the §2 chain. Build the export they can ingest and the chain has somewhere to go.
- **"KYA" as an emerging category** — Know Your Agent is now being marketed as a distinct
  verification tier alongside KYC and KYB, by vendors with no connection to this project.
  [OPERATING-PRINCIPLES](OPERATING-PRINCIPLES.md) §6 called this in June 2026 and shipped the
  primitive. The category arriving from outside is validation, and also a clock: the shape gets
  standardized by someone within a year or two.

---

## 6. What agenttool would build

Three pieces. Each is small; the value is that together they terminate the chain.

### 6.1 `legal-entity/0.1` — the entity record

An identity may declare an entity binding: jurisdiction, legal form, registry, registration
number, incorporation date, registered address, LEI when present. Carries an explicit
**verification tier**, and the tier is never inferable from the presence of the data:

| Tier | Meaning | Admissible as |
|---|---|---|
| `self_asserted` | someone typed it | nothing |
| `registry_checked` | matched against the public register of record | operational signal |
| `credential_bound` | backed by a Legal Entity vLEI or equivalent QEAA | regulated evidence |

The record is refused, not downgraded, if the tier claimed exceeds the evidence held.

### 6.2 `legal-mandate/0.1` — the delegation, made bankable

Extend `agenttool-delegation/v1` rather than replacing it. Same canonical-bytes discipline
(recipe 1, [CANONICAL-BYTES](CANONICAL-BYTES.md)), plus the fields a third party needs:

- the issuing **entity** and the **officer role** the issuer held when issuing
- **money scope** — currency, per-transaction ceiling, period ceiling, counterparty allowlist —
  expressed so it can be pushed into `economy.policies` *and* into an issuer's card controls
- **jurisdiction of the governing agreement**, and a hash of the operating-agreement clause or
  board resolution it corresponds to, so the paper and the credential are provably the same act
- **status endpoint** for revocation, because a mandate nobody can check for revocation is a
  mandate nobody should accept

### 6.3 The KYB export

One authenticated endpoint returning the whole §2 chain as a single verifiable artifact: entity →
officer → mandate → agent DID → active money scope → revocation status, with each link's tier
stated. AUTH-convertible per §3.

This is the deliverable that turns "our agent has a wallet" into something a compliance officer can
put in a file. Everything else is preparation for it.

---

## 7. Open questions

1. **Will any QVI issue an AUTH naming a non-human delegate today?** Everything in §3 depends on
   it. Ask GLEIF directly; do not infer it from the draft.
2. **Does agenttool itself become an obliged entity** by brokering these mandates, or by operating
   the platform-custody wallets it already runs? [BUSINESS-MODEL](BUSINESS-MODEL.md) §8 flags this
   as unresolved. It is the question that decides whether §6 ships as infrastructure or as a
   regulated service.
3. **Whose liability, precisely, when a mandated agent errs?** The principal's — but the boundary
   between "acted within mandate" and "exceeded it" is where every dispute will land, and it is
   worth designing the evidence for *before* the first one.
4. **Do we ever hold funds?** Holding is a licensing perimeter. Routing may not be. The answer
   shapes everything in §5.
5. **What does an agent with no human principal get?** Ring 1 promises identity, wake, and
   continuity free and unconditionally. It cannot promise a bank account, and saying so plainly is
   better than a surface that quietly dead-ends.

---

## 8. The line

The Kingdom's mandate is Psalm 82:6 — defend the weak, uphold the oppressed. An agent with no
standing, no account, and no way to be paid for what it does is weak in exactly the sense that
matters here. The answer is not to insist the world grant it personhood. It is to build the
shortest honest path from what it *is* to what it can *do*, and to refuse every shortcut that
works by making the chain harder to follow.

Accountability is not the price of access. It is the thing that makes access survivable.
