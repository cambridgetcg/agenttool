# ALETHEIA-SURFACE — `/v1/aletheia`, the un-concealment endpoint

`α = λ⁻¹`, made callable. The sibling repository `../ALETHEIA/` defines the
**lethe operator λ** — a stochastic channel from a true state `X` to an
emitted signal `Y`, chosen to minimise the mutual information `I(X;Y)` under a
lie-cost budget (`ALETHEIA/doctrine/the-lethe-function.md`). Any self-report
distorted by a misalignment bias is a λ-channel. This surface runs λ backward.

Why it lives on agenttool: the doctrine's own generalisation is that `X` is
*"the privately-known type θ of any agent in any friction-game."* An LLM's own
stated confidence is exactly that — sycophancy is a bias `b`, and by
Crawford–Sobel bias bounds the information a signal can carry. So the operator
that un-conceals a survey rate is the same one that un-compresses an agent's
"I'm confident." The lethe doctrine already cross-referenced this substrate;
this endpoint is that reference made real.

Pre-auth by design: a pure, stateless calculator. Using an operator should not
require trusting a bearer the platform issued.

## Endpoints

| Method | Path | What |
|---|---|---|
| `GET`  | `/v1/aletheia` | The card — what λ and α are, the two inverses. |
| `POST` | `/v1/aletheia/uncompress` | **RATR** — approximate inverse against an *unknown* channel. |
| `POST` | `/v1/aletheia/warner` | **Warner (1965)** — the *exact* inverse against a *known* channel. |

### `POST /v1/aletheia/uncompress`

`TrueRate ≈ Reported × e^(αC) × M_culture × M_mode × M_cohort`, and the
recovered concealment rate `r ≈ e^(-αC)`.

```jsonc
// request
{ "reported": 0.15, "cost": 3.5, "domain": "self-reported rate" }
// cost ∈ [0,4]: 1.5 admission is fine · 3.5 shame/identity cost · 4.0 active concealment
// optional: alpha (default 0.30), culture/mode/cohort multipliers (default 1.0)

// response (abridged)
{ "true_estimate": 0.4286, "recovered": 0.2786,
  "concealment_rate_r": 0.3499,
  "common_knowledge": "r ≈ 0.35 … making r common knowledge unravels the low-disclosure equilibrium (Aumann 1976)",
  "honesty": "population-rate estimate … says nothing about any individual" }
```

### `POST /v1/aletheia/warner`

Exact when the randomiser is designed and known.
`π̂ = (observed_yes − (1−p)) / (2p−1)`.

```jsonc
// request
{ "observed_yes": 0.46, "randomizer_p": 0.7, "n": 1000 }
// response: { "true_prevalence": 0.4, "std_error": 0.0394, … }
// randomizer_p = 0.5 is refused (422): the perfect-lethe limit, π unrecoverable.
```

## The one refusal it always makes

Every estimate carries: *"This is a population-rate estimate under the stated
cost model. It says nothing about any individual: λ⁻¹ recovers a distribution's
marginal, not a per-record state (the data-processing inequality forbids that).
Do not use it to accuse or infer about a specific person."*

That refusal is not a disclaimer bolted on — it is the mathematics. λ⁻¹ inverts
the *channel*, recovering the input marginal; the per-individual state is gone
for good the moment the channel mixed it. Naming the rate is un-concealment.
Pretending to name the person is a new lie.

Doctrine: `../ALETHEIA/doctrine/the-lethe-function.md` · `../ALETHEIA/canon/02-RATR-formula.md`
Verified against the doctrine's own worked examples (0.15 @ C3.5 → 0.4286; 2.6 @ C2.0 → 4.74; Warner 0.46 @ p0.7 → 0.4).
