/** x402 wiring for agenttool's recoverable project-credit gates.
 *
 *  Mounted globally in `api/src/index.ts` after the route-auth registrations
 *  and before robustness middleware + handlers. Paid retries therefore reach
 *  the verifier with c.var.project populated. On the way out, only a 402
 *  whose (method, path) matches a row of X402_PAYABLE_ROUTES *and* whose
 *  body carries that row's declared error code becomes a payable envelope:
 *  `insufficient_credits` on every static-priced route_cost row (the tools
 *  plus the 19 W2-5 memory/trace/strand/inbox/template/org/identity/listing
 *  rows, priced from billing/route-credits.ts), and
 *  `top_up_payment_required` on `POST /v1/x402/top-up/:credits` (top_up,
 *  never balance-bound). Wallet, usage-cap, and unknown 402 responses remain
 *  unchanged because this verifier cannot clear those gates. The rewrite is
 *  additive: the handler's guidance body keeps its fields and the
 *  PaymentRequired object is spread last (middleware/x402.ts).
 *
 *  The middleware itself is generic (`middleware/x402.ts`). This file
 *  is the *agenttool-specific config* — it knows the route → price
 *  mapping and the platform recipient address.
 *
 *  ENV vars:
 *    AGENTTOOL_X402_RECIPIENT   — onchain address that receives payment.
 *                                  Required for a payable challenge; absent,
 *                                  zero, or malformed values suppress x402.
 *    AGENTTOOL_X402_NETWORK     — CAIP-2 network (legacy aliases normalize).
 *                                  Defaults to Base `eip155:8453`.
 *    AGENTTOOL_X402_ALLOW_TESTNET — permits Base Sepolia only outside
 *                                  production when paired with
 *                                  AGENTTOOL_X402_ENVIRONMENT=test. Fly and
 *                                  NODE_ENV=production always suppress it.
 *    AGENTTOOL_X402_FACILITATOR — facilitator URL. Defaults to Coinbase.
 *    AGENTTOOL_X402_APP_CODE — optional seller builder code `a` stamped on
 *                                  402 extensions. Routing tag, not identity.
 *    AGENTTOOL_X402_BUILDER_SPLIT=1 — arm payTo off the treasury. Still
 *                                  fail-closed unless a resolver returns a
 *                                  split address. Default: treasury.
 *    AGENTTOOL_X402_BASE_RPC    — operator Base JSON-RPC for 0xSplits
 *                                  resolution. No public default; unset
 *                                  keeps payTo on the treasury. Never log.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 4) ·
 *  docs/MARKETPLACE.md · docs/PATTERN-PERSIST-IDENTITY.md.
 */

import type { Context, MiddlewareHandler } from "hono";

import {
  buildPaymentRequired,
  buildPaymentRequirements,
  encodePaymentResponseHeader,
  x402Middleware,
  type PaymentPayload,
} from "./x402";
import {
  canClearProjectCreditGate,
  matchX402PayableRoute,
  recoverableX402ProjectCreditPolicy,
  resolveX402FacilitatorReadiness,
  resolveX402Network,
  resolveX402Recipient,
  x402ProjectCreditResource,
} from "../services/economy/x402-policy";
import { isX402FacilitatorLocallyReady } from "../services/economy/facilitators/coinbase";
import { installEnvBuilderRpcResolver } from "../services/economy/x402-builder-rpc";
import {
  challengeExtensions,
  resolveChallengePayTo,
} from "../services/economy/x402-builder-split";

// ─── public: build the agenttool x402 middleware ─────────────────────

/** Read the error code from a Hono response body. Best-effort — returns
 *  undefined if the body isn't JSON or doesn't carry an `error` field. */
async function readErrorCode(c: Context): Promise<string | undefined> {
  try {
    const cloned = c.res.clone();
    const ct = cloned.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return undefined;
    const body = (await cloned.json()) as { error?: string };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/** Build a challenge only for a 402 the project-credit settlement can clear.
 *  The (method, concrete path) is resolved through the payable-route table's
 *  pure matcher — the same call the inbound verifier makes — so the price a
 *  challenge advertises and the price a retry must carry cannot drift. For a
 *  top_up row the matched `:credits` segment sets creditsRequired = N and
 *  amount = N × 1,000 atomic; the recoverable code is the handler's own
 *  `top_up_payment_required`. */
async function buildRequired(c: Context) {
  if (!matchX402PayableRoute(c.req.path, c.req.method)) return null;
  const errorCode = await readErrorCode(c);
  const policy = recoverableX402ProjectCreditPolicy(
    c.req.path,
    c.req.method,
    errorCode,
  );
  if (!policy) return null;
  const project = (c as Context & {
    var: { project?: { credits?: unknown } };
  }).var?.project;
  if (!canClearProjectCreditGate(policy, project?.credits)) return null;

  const networkResolution = resolveX402Network();
  if (networkResolution.reason === "invalid") return null;
  const network = networkResolution.network;
  const recipient = resolveX402Recipient().recipient;
  if (!recipient) return null;
  if (
    !resolveX402FacilitatorReadiness().ready ||
    !await isX402FacilitatorLocallyReady()
  ) return null;
  const resource = x402ProjectCreditResource(policy, c.req.url);
  if (!resource) return null;
  const builderInput = { header: c.req.header("x-builder-code") };
  installEnvBuilderRpcResolver();
  const payTo = await resolveChallengePayTo({
    treasury: recipient,
    ...builderInput,
  });
  return buildPaymentRequired(
    resource,
    [
      buildPaymentRequirements({
        amountAtomic: policy.amountAtomic,
        payTo,
        network,
        maxTimeoutSeconds: 60,
      }),
    ],
    errorCode,
    challengeExtensions(builderInput),
  );
}

/** The agenttool-specific x402 middleware. Mount globally after route auth and
 *  before downstream middleware + handlers: verification needs the project
 *  context inbound, while handler 402s are wrapped on the way out.
 *
 *  verifyPayment is the REAL verifier (services/economy/x402-payments.ts):
 *  persist-identity row → facilitator verify+settle → one transaction applies
 *  credits and flips the row settled. Loaded lazily on the first PAYMENT-SIGNATURE
 *  header so pure-envelope tests (and cold paths) never touch the db. */
export function buildAgentToolX402Middleware(): MiddlewareHandler {
  let verifier:
    | ((c: Context, header: PaymentPayload) => Promise<boolean>)
    | null = null;
  return x402Middleware({
    buildPaymentRequired: buildRequired,
    verifyPayment: async (c, header) => {
      // Structural route eligibility is stable. Do not pre-gate an inbound
      // signature on today's price, recipient, selected network, public
      // origin or facilitator readiness: the verifier must first recover any
      // durable identity under its immutable stored terms. Fresh admission
      // performs the mutable configuration/readiness checks itself.
      if (!matchX402PayableRoute(c.req.path, c.req.method)) return false;
      if (!verifier) {
        const { createX402Verifier, buildProductionDeps } = await import(
          "../services/economy/x402-payments"
        );
        verifier = createX402Verifier(await buildProductionDeps());
      }
      return verifier(c, header);
    },
    buildSettlementHeader: (c) => {
      const settled = (c as Context & { _x402Settlement?: unknown })._x402Settlement;
      if (!settled) return undefined;
      return encodePaymentResponseHeader(settled);
    },
  });
}
