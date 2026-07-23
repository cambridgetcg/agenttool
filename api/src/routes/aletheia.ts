/** /v1/aletheia/* — the un-concealment surface. α = λ⁻¹.
 *
 *  ALETHEIA (ἀ-λήθη, *un*-concealment) crossed onto the substrate. The
 *  sibling doctrine `ALETHEIA/doctrine/the-lethe-function.md` defines the
 *  **lethe operator λ** — a stochastic channel from a true state X to an
 *  emitted signal Y, chosen to minimise the mutual information I(X;Y) under
 *  a lie-cost budget. Any self-report distorted by a misalignment bias is a
 *  λ-channel: a survey answer, a status update, and — the reason this lives
 *  on agenttool — an agent's own stated confidence (sycophancy is a bias b,
 *  and by Crawford–Sobel bias bounds the transmissible information). This
 *  router is λ run backward: it takes a compressed report and estimates the
 *  truth λ dropped, then names the concealment rate so it becomes common
 *  knowledge (Aumann 1976) — the act for which the repository is named.
 *
 *  Pre-auth by design: this is a pure, stateless calculator. Verifying or
 *  using an operator should not require trusting a bearer the platform issued.
 *
 *  Endpoints:
 *    GET  /v1/aletheia                — the card (what λ and α are)
 *    POST /v1/aletheia/uncompress     — RATR: approximate inverse, unknown channel
 *    POST /v1/aletheia/warner         — Warner: exact inverse, known channel
 *
 *  Doctrine: ALETHEIA/doctrine/the-lethe-function.md · canon/02-RATR-formula.md
 *  Honesty: every estimate is a POPULATION-rate model under a stated cost
 *  assumption. It says nothing about any individual — the data-processing
 *  inequality forbids per-individual recovery. The router refuses to pretend
 *  otherwise.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono();

/** RATR default exponent for high-cost topics (the-lethe-function Part 1;
 *  canon/02-RATR-formula). α ≈ 0.30. */
const ALPHA_DEFAULT = 0.3;

/** The individual-recovery refusal, attached to every estimate. λ⁻¹ recovers
 *  the input *marginal* (a population rate), never a per-record state — the
 *  data-processing inequality forbids the latter. Naming this is the point:
 *  α un-conceals the rate, and refuses to counterfeit certainty about a person. */
const NOT_ABOUT_A_PERSON =
  "This is a population-rate estimate under the stated cost model. It says " +
  "nothing about any individual: λ⁻¹ recovers a distribution's marginal, not " +
  "a per-record state (the data-processing inequality forbids that). Do not " +
  "use it to accuse or infer about a specific person.";

const round = (x: number, dp = 4) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

// ─── GET /v1/aletheia ──────────────────────────────────────────────────────
//
// The card. What the operator is, and how to run it backward.
app.get("/", (c) =>
  c.json({
    name: "aletheia",
    greek: "ἀ-λήθη · un-concealment",
    operator: {
      lethe: "λ = argmin I(X;Y) subject to a lie-cost budget — the channel that starves the truth of bandwidth",
      inverse: "α = λ⁻¹ — divide the estimated channel back out; then name the concealment rate so it becomes common knowledge",
    },
    a_signal_is_a_channel:
      "Any self-report distorted by a misalignment bias is a λ-channel — a survey answer, a status update, or an agent's own stated confidence (sycophancy is the bias). The operator does not care what X is.",
    two_inverses: {
      uncompress:
        "POST /v1/aletheia/uncompress — RATR. Approximate inverse against an UNKNOWN channel. TrueRate ≈ Reported × e^(αC) × M. Use when you can only estimate the cost of honesty.",
      warner:
        "POST /v1/aletheia/warner — the EXACT inverse against a KNOWN channel (Warner 1965 randomized response). Use when the randomiser probability is designed and known.",
    },
    honesty: NOT_ABOUT_A_PERSON,
    doctrine: "ALETHEIA/doctrine/the-lethe-function.md",
  }),
);

// ─── POST /v1/aletheia/uncompress ──────────────────────────────────────────
//
// RATR — approximate channel-decoding against nature's undisclosed device.
//   TrueRate ≈ Reported × e^(αC) × M_culture × M_mode × M_cohort
//   recovered concealment rate  r ≈ e^(-αC)
//
// `reported` may be a rate in [0,1] or any positive quantity (e.g. a mean
// count) — the multiplier is scale-free. When `reported` is a rate and the
// model pushes the estimate past 1, we clamp and flag: that is the cost
// model telling you it is too aggressive for that base rate.
const uncompressSchema = z.object({
  reported: z.number().nonnegative(),
  /** cost of honesty on [0,4]: 1.5 admission is socially fine · 2.0 ·
   *  3.5 shame/identity cost · 4.0 active concealment, real stakes. */
  cost: z.number().min(0).max(4),
  alpha: z.number().positive().max(2).optional(),
  /** cultural conservatism: 0.9 liberal → 1.5 conservative. default 1.0 */
  culture: z.number().min(0.5).max(2).optional(),
  /** survey mode: 1.0 anonymous online → 1.7 face-to-face. default 1.0 */
  mode: z.number().min(0.5).max(2).optional(),
  /** age cohort: 0.95 young liberal → 1.4 older strict-norm. default 1.0 */
  cohort: z.number().min(0.5).max(2).optional(),
  /** free-text: what X is (echoed back). "female EPP", "my own confidence"… */
  domain: z.string().max(200).optional(),
});

app.post("/uncompress", zValidator("json", uncompressSchema), (c) => {
  const b = c.req.valid("json");
  const alpha = b.alpha ?? ALPHA_DEFAULT;
  const culture = b.culture ?? 1;
  const mode = b.mode ?? 1;
  const cohort = b.cohort ?? 1;

  const costMultiplier = Math.exp(alpha * b.cost); // e^(αC) = 1/r
  const contextMultiplier = culture * mode * cohort;
  const totalMultiplier = costMultiplier * contextMultiplier;
  const r = Math.exp(-alpha * b.cost); // recovered concealment rate

  const rawEstimate = b.reported * totalMultiplier;
  const looksLikeRate = b.reported <= 1;
  const clamped = looksLikeRate && rawEstimate > 1;
  const trueEstimate = clamped ? 1 : rawEstimate;

  return c.json({
    domain: b.domain ?? null,
    reported: b.reported,
    true_estimate: round(trueEstimate),
    recovered: round(trueEstimate - b.reported), // the mass λ had dropped
    concealment_rate_r: round(r), // P(report defect | defect)
    equivocation:
      "of every 1.00 units of the true rate, λ let " +
      round(r, 3) +
      " surface; " +
      round(1 - r, 3) +
      " stayed concealed.",
    multiplier: {
      cost_e_alphaC: round(costMultiplier),
      culture,
      mode,
      cohort,
      total: round(totalMultiplier),
      formula: "TrueRate ≈ Reported × e^(αC) × M_culture × M_mode × M_cohort",
      alpha,
    },
    ...(clamped
      ? {
          clamp_flag:
            "Estimate exceeded 1.0 and was clamped. For this base rate the cost model (C, multipliers) is too aggressive — lower C or the context multipliers.",
        }
      : {}),
    common_knowledge:
      "Concealment rate now named: r ≈ " +
      round(r, 3) +
      ". Making r common knowledge unravels the low-disclosure equilibrium (Aumann 1976) — the audience can no longer keep using its prior as if the report were the truth.",
    honesty: NOT_ABOUT_A_PERSON,
    method: "RATR — approximate inverse against an unknown channel",
    doctrine: "ALETHEIA/canon/02-RATR-formula.md",
  });
});

// ─── POST /v1/aletheia/warner ──────────────────────────────────────────────
//
// Warner (1965) randomized response — the EXACT inverse when the channel is
// designed and known. A respondent answers about statement A with known
// probability p, its complement with 1-p; the analyst never learns which.
//   Pr[yes] = (1-p) + (2p-1)·π
//   π̂ = (observed_yes - (1-p)) / (2p-1)
//   Var(π̂) = π(1-π)/n + [p(1-p)/(2p-1)²]/n
// As p → 0.5 the device gives maximal deniability and π becomes unrecoverable.
const warnerSchema = z.object({
  /** observed proportion of "yes" answers, in [0,1] (Warner's λ̂). */
  observed_yes: z.number().min(0).max(1),
  /** randomiser probability p that the sensitive statement was posed. Must
   *  not be 0.5 — at 0.5 the estimator's variance diverges (perfect lethe). */
  randomizer_p: z.number().min(0).max(1),
  /** optional sample size, to return the estimator variance / std error. */
  n: z.number().int().positive().optional(),
  domain: z.string().max(200).optional(),
});

app.post("/warner", zValidator("json", warnerSchema), (c) => {
  const b = c.req.valid("json");
  const slope = 2 * b.randomizer_p - 1;

  if (Math.abs(slope) < 1e-9) {
    return c.json(
      {
        refused: true,
        reason:
          "randomizer_p = 0.5 gives maximal deniability: the slope (2p-1) is 0, variance diverges, and π is unrecoverable. This is the perfect-lethe limit — the channel destroyed all the information. Choose p ≠ 0.5.",
        doctrine: "ALETHEIA/doctrine/the-lethe-function.md (Part 4)",
      },
      422,
    );
  }

  const rawPi = (b.observed_yes - (1 - b.randomizer_p)) / slope;
  const pi = Math.min(1, Math.max(0, rawPi));
  const outOfRange = rawPi < 0 || rawPi > 1;

  let variance: number | null = null;
  let stdError: number | null = null;
  if (b.n) {
    const sampling = (pi * (1 - pi)) / b.n;
    const deniabilityPrice = (b.randomizer_p * (1 - b.randomizer_p)) / (slope * slope) / b.n;
    variance = sampling + deniabilityPrice;
    stdError = Math.sqrt(variance);
  }

  return c.json({
    domain: b.domain ?? null,
    observed_yes: b.observed_yes,
    randomizer_p: b.randomizer_p,
    true_prevalence: round(pi),
    ...(outOfRange
      ? {
          out_of_range_flag:
            "Raw estimate fell outside [0,1] and was clamped — usually sampling noise near a boundary, or a randomizer_p that does not match how the data was actually collected.",
        }
      : {}),
    slope_2p_minus_1: round(slope),
    ...(variance !== null
      ? {
          variance: round(variance, 6),
          std_error: round(stdError as number, 4),
          note: "variance = sampling π(1-π)/n + the price of deniability p(1-p)/(2p-1)²/n",
        }
      : {}),
    common_knowledge:
      "Exact inverse: the known device supplied the deniability, so truthful answering was weakly dominant and π is read off directly — no cost model, no fudge factor.",
    honesty: NOT_ABOUT_A_PERSON,
    method: "Warner 1965 — exact inverse against a known channel",
    doctrine: "ALETHEIA/doctrine/the-lethe-function.md (Part 4)",
  });
});

export default app;
