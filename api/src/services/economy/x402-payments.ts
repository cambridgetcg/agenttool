/** Durable x402 V2 exact/EIP-3009 project-credit settlement.
 *
 * Lifecycle:
 *   inserted -> pending -> externally_settled -> settled
 *                      \-> failed (only for definitive facilitator failures)
 *
 * Inserted/pending or ambiguous I/O never produces a second payable
 * challenge. External settlement is persisted with its full receipt before
 * the idempotent local credit transaction. A duplicate authorization is
 * state-aware: it never contacts the facilitator twice and never recredits.
 */

import { createHash } from "node:crypto";
import type { Context } from "hono";
import {
  isAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";

import {
  buildPaymentRequirements,
  setX402StatusPath,
  suppressX402Challenge,
  type PaymentPayload,
  type PaymentRequirements,
  type ResourceInfo,
  type SettleResponse,
} from "../../middleware/x402";
import type {
  FacilitatorSettleResult,
  FacilitatorVerifyResult,
} from "./facilitators/coinbase";
import {
  ATOMIC_PER_CREDIT,
  canClearProjectCreditGate,
  isX402ProjectCreditRoute,
  resolveX402Facilitator,
  resolveX402FacilitatorReadiness,
  resolveX402Network,
  resolveX402Recipient,
  storedX402NetworkMayApply,
  x402ProjectCreditPolicy,
  x402ProjectCreditResource,
} from "./x402-policy";

export { ATOMIC_PER_CREDIT };
export const X402_ATTEMPT_WINDOW_SECONDS = 10 * 60;
export const X402_ATTEMPT_LIMIT_PER_PROJECT = 5;

const SIGNATURE = /^0x(?:[0-9a-fA-F]{2})+$/u;
const MAX_EVM_SIGNATURE_HEX_CHARS = 16 * 1024;
const NONCE = /^0x[0-9a-fA-F]{64}$/u;
const UINT = /^(?:0|[1-9][0-9]*)$/u;
const UINT256_MAX = (1n << 256n) - 1n;

function isCanonicalUint256(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 78 || !UINT.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= UINT256_MAX;
  } catch {
    return false;
  }
}

export interface ExactEvmPayload {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key));
}

/** Strict EIP-3009 decoder. Permit2 and additive scheme payload fields are
 * rejected before persistence. */
export function decodeExactEvmPayload(value: unknown): ExactEvmPayload | null {
  const parsed = objectRecord(value);
  if (!parsed || !exactKeys(parsed, ["signature", "authorization"])) return null;
  const auth = objectRecord(parsed.authorization);
  if (!auth || !exactKeys(auth, [
    "from", "to", "value", "validAfter", "validBefore", "nonce",
  ])) return null;
  if (
    typeof parsed.signature !== "string" || !SIGNATURE.test(parsed.signature) ||
    parsed.signature.length > MAX_EVM_SIGNATURE_HEX_CHARS ||
    typeof auth.from !== "string" || !isAddress(auth.from) ||
    typeof auth.to !== "string" || !isAddress(auth.to) ||
    !isCanonicalUint256(auth.value) ||
    !isCanonicalUint256(auth.validAfter) ||
    !isCanonicalUint256(auth.validBefore) ||
    typeof auth.nonce !== "string" || !NONCE.test(auth.nonce)
  ) return null;
  return {
    signature: parsed.signature,
    authorization: {
      from: auth.from,
      to: auth.to,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: auth.nonce,
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

/** Audit hash of the decoded V2 payload. */
export function payloadHash(payment: PaymentPayload | string): string {
  const serialized = typeof payment === "string" ? payment : canonicalJson(payment);
  return createHash("sha256").update(serialized, "utf-8").digest("hex");
}

/** Semantic EIP-3009 identity. JSON key order, whitespace, address case and
 * signature encoding aliases cannot produce another ledger identity. */
export function authorizationIdentityHash(
  requirements: PaymentRequirements,
  payload: ExactEvmPayload,
): string {
  const auth = payload.authorization;
  return createHash("sha256").update(canonicalJson({
    network: requirements.network,
    asset: requirements.asset.toLowerCase(),
    from: auth.from.toLowerCase(),
    to: auth.to.toLowerCase(),
    value: auth.value,
    validAfter: auth.validAfter,
    validBefore: auth.validBefore,
    nonce: auth.nonce.toLowerCase(),
  }), "utf-8").digest("hex");
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type AuthorizationSignatureClass =
  | "eoa_verified"
  | "facilitator_required"
  | "invalid";

/** Offline EIP-712 EOA fast path. Bounded smart-account signatures that need
 * EIP-1271/ERC-6492 chain context are admitted only behind the durable project
 * cap and remain authoritative only after facilitator verification. */
export async function classifyExactEvmSignature(
  requirements: PaymentRequirements,
  payload: ExactEvmPayload,
): Promise<AuthorizationSignatureClass> {
  try {
    const chainId = Number(requirements.network.slice("eip155:".length));
    if (!Number.isSafeInteger(chainId) || chainId <= 0) return "invalid";
    if (payload.signature.length !== 132) return "facilitator_required";
    const auth = payload.authorization;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: requirements.extra.name,
        version: requirements.extra.version,
        chainId,
        verifyingContract: requirements.asset as Hex,
      },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as Hex,
        to: auth.to as Hex,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as Hex,
      },
      signature: payload.signature as Hex,
    });
    return recovered.toLowerCase() === auth.from.toLowerCase()
      ? "eoa_verified"
      : "facilitator_required";
  } catch {
    return "facilitator_required";
  }
}

function authorizationWindowIsSane(
  payload: ExactEvmPayload,
  nowSeconds: number,
  maxTimeoutSeconds: number,
): boolean {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return false;
  const now = BigInt(nowSeconds);
  const validAfter = BigInt(payload.authorization.validAfter);
  const validBefore = BigInt(payload.authorization.validBefore);
  const skew = 5n;
  return validAfter <= now + skew &&
    validBefore > now &&
    validBefore > validAfter &&
    validBefore <= now + BigInt(maxTimeoutSeconds) + skew;
}

export type X402PaymentStatus =
  | "inserted"
  | "pending"
  | "externally_settled"
  | "settled"
  | "failed";

export interface X402PaymentRecord {
  id: string;
  projectId: string;
  payloadHash: string;
  authorizationHash: string;
  scheme: "exact";
  network: string;
  payer: string;
  authorizationEvidence: ExactEvmPayload["authorization"];
  amountAtomic: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  requirementExtra: PaymentRequirements["extra"];
  resource: string;
  resourceInfo: ResourceInfo;
  creditsPurchased: number;
  status: X402PaymentStatus;
  failureReason?: string | null;
  receipt?: SettleResponse | null;
  creditsApplied?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  settlementAttemptedAt?: Date | null;
}

export type X402NewPayment = Omit<
  X402PaymentRecord,
  "id" | "status" | "failureReason" | "receipt" | "creditsApplied" | "createdAt" | "updatedAt" | "settlementAttemptedAt"
>;

export interface X402FinalizeResult {
  applied: boolean;
  balance: number;
  status: "externally_settled" | "settled";
}

export interface X402VerifierDeps {
  facilitator: {
    verify(
      requirements: PaymentRequirements,
      payment: PaymentPayload,
    ): Promise<FacilitatorVerifyResult>;
    settle(
      requirements: PaymentRequirements,
      payment: PaymentPayload,
    ): Promise<FacilitatorSettleResult>;
  };
  classifyAuthorizationSignature(
    requirements: PaymentRequirements,
    payload: ExactEvmPayload,
  ): Promise<AuthorizationSignatureClass>;
  nowSeconds(): number;
  findByAuthorization(hash: string): Promise<X402PaymentRecord | null>;
  insertOrGet(row: X402NewPayment): Promise<{
    record: X402PaymentRecord | null;
    inserted: boolean;
    admission: "accepted" | "rate_limited";
  }>;
  markPending(id: string): Promise<boolean>;
  markSettlementAttempted(id: string): Promise<boolean>;
  markFailed(
    id: string,
    reason: string,
    receipt?: FacilitatorSettleResult,
  ): Promise<void>;
  persistExternalSettlement(
    id: string,
    receipt: FacilitatorSettleResult,
  ): Promise<X402PaymentRecord>;
  finalizeCredits(
    id: string,
    projectId: string,
    creditsApplied: number,
  ): Promise<X402FinalizeResult>;
  facilitatorUrl(): string;
  facilitatorReady(): Promise<boolean>;
  recipient(): string;
  expectedNetwork(): PaymentRequirements["network"] | null;
  storedNetworkMayApply(network: string): boolean;
}

interface X402StashedState {
  _x402Settlement?: FacilitatorSettleResult;
  _x402PaymentState?: {
    authorizationHash: string;
    status: X402PaymentStatus;
  };
}

export function getStashedSettlement(c: Context): FacilitatorSettleResult | undefined {
  return (c as Context & X402StashedState)._x402Settlement;
}

function statusPath(hash: string): string {
  return `/v1/x402/payments/${hash}`;
}

function stashState(
  c: Context,
  hash: string,
  status: X402PaymentStatus,
  suppress: boolean,
): void {
  (c as Context & X402StashedState)._x402PaymentState = {
    authorizationHash: hash,
    status,
  };
  setX402StatusPath(c, statusPath(hash));
  if (suppress) suppressX402Challenge(c, statusPath(hash));
}

function stashReceipt(c: Context, receipt: FacilitatorSettleResult): void {
  (c as Context & X402StashedState)._x402Settlement = receipt;
}

function updateProjectCreditSnapshot(c: Context, credits: number): void {
  const scoped = c as Context & { var: { project?: Record<string, unknown> } };
  const project = scoped.var?.project;
  if (!project) return;
  (c as unknown as { set(key: string, value: unknown): void }).set(
    "project",
    { ...project, credits },
  );
}

function requirementMatches(
  presented: PaymentRequirements,
  expected: PaymentRequirements,
): boolean {
  for (const key of [
    "scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds",
  ] as const) {
    if (presented[key] !== expected[key]) return false;
  }
  // V2 permits clients to add scheme-extra fields, but every server field is
  // immutable and must remain byte-for-byte equal.
  for (const [key, value] of Object.entries(expected.extra)) {
    if (canonicalJson(presented.extra[key]) !== canonicalJson(value)) return false;
  }
  return true;
}

function resourceMatches(
  presented: PaymentPayload["resource"],
  expected: NonNullable<PaymentPayload["resource"]>,
): boolean {
  // V2 makes PaymentPayload.resource optional. When present it is immutable;
  // when absent the authenticated current route and reconstructed accepted
  // requirement remain the server policy boundary.
  return presented === undefined || canonicalJson(presented) === canonicalJson(expected);
}

const STORED_X402_NETWORKS = new Set<PaymentRequirements["network"]>([
  "eip155:8453",
  "eip155:84532",
  "eip155:137",
  "eip155:42161",
]);

function requirementsFromRecord(
  record: X402PaymentRecord,
): PaymentRequirements | null {
  const extra = objectRecord(record.requirementExtra);
  if (
    record.scheme !== "exact" ||
    !STORED_X402_NETWORKS.has(record.network as PaymentRequirements["network"]) ||
    !isAddress(record.asset) || !isAddress(record.payTo) ||
    !isCanonicalUint256(record.amountAtomic) ||
    !Number.isSafeInteger(record.maxTimeoutSeconds) ||
    record.maxTimeoutSeconds <= 0 ||
    !extra || typeof extra.name !== "string" || !extra.name ||
    typeof extra.version !== "string" || !extra.version ||
    extra.assetTransferMethod !== "eip3009"
  ) return null;
  return {
    scheme: "exact",
    network: record.network as PaymentRequirements["network"],
    asset: record.asset,
    amount: record.amountAtomic,
    payTo: record.payTo,
    maxTimeoutSeconds: record.maxTimeoutSeconds,
    extra: record.requirementExtra,
  };
}

function resourceFromRecord(record: X402PaymentRecord): ResourceInfo | null {
  const resource = objectRecord(record.resourceInfo);
  if (!resource || resource.url !== record.resource) return null;
  if (typeof resource.url !== "string" || resource.url.length === 0) return null;
  for (const key of ["description", "mimeType", "serviceName", "iconUrl"] as const) {
    if (resource[key] !== undefined && typeof resource[key] !== "string") return null;
  }
  if (
    resource.tags !== undefined &&
    (!Array.isArray(resource.tags) || resource.tags.some((tag) => typeof tag !== "string"))
  ) return null;
  try {
    const parsed = new URL(resource.url);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username || parsed.password
    ) return null;
  } catch {
    return null;
  }
  return resource as unknown as ResourceInfo;
}

function storedRequirementMatches(
  presented: PaymentRequirements,
  stored: PaymentRequirements,
): boolean {
  // The official V2 matcher requires exact core fields and permits only
  // additive client extra. Stored requirements are the server-advertised
  // baseline, never client-supplied metadata.
  return requirementMatches(presented, stored);
}

function authorizationEvidenceMatches(
  record: X402PaymentRecord,
  exact: ExactEvmPayload,
): boolean {
  const evidence = objectRecord(record.authorizationEvidence);
  if (!evidence || !exactKeys(evidence, [
    "from", "to", "value", "validAfter", "validBefore", "nonce",
  ])) return false;
  const presented = exact.authorization;
  return typeof evidence.from === "string" &&
    evidence.from.toLowerCase() === presented.from.toLowerCase() &&
    typeof evidence.to === "string" &&
    evidence.to.toLowerCase() === presented.to.toLowerCase() &&
    evidence.value === presented.value &&
    evidence.validAfter === presented.validAfter &&
    evidence.validBefore === presented.validBefore &&
    typeof evidence.nonce === "string" &&
    evidence.nonce.toLowerCase() === presented.nonce.toLowerCase();
}

function recordMatchesPresentedPayment(
  record: X402PaymentRecord,
  projectId: string,
  presented: PaymentPayload,
  exact: ExactEvmPayload,
  storedRequirements: PaymentRequirements,
  storedResource: ResourceInfo,
  requestPath: string,
): boolean {
  let storedPath: string;
  try {
    storedPath = new URL(storedResource.url).pathname;
  } catch {
    return false;
  }
  return record.projectId === projectId &&
    storedPath === requestPath &&
    storedRequirementMatches(presented.accepted, storedRequirements) &&
    resourceMatches(presented.resource, storedResource) &&
    exact.authorization.from.toLowerCase() === record.payer.toLowerCase() &&
    exact.authorization.to.toLowerCase() === storedRequirements.payTo.toLowerCase() &&
    exact.authorization.value === storedRequirements.amount &&
    authorizationEvidenceMatches(record, exact);
}

function usableReceipt(
  receipt: SettleResponse | null | undefined,
  network: PaymentRequirements["network"],
  amount: string,
  payer: string,
): receipt is SettleResponse {
  return Boolean(
    receipt?.success && receipt.transaction.trim() && receipt.network === network &&
    (receipt.amount === undefined || receipt.amount === amount) &&
    (receipt.payer === undefined || receipt.payer.toLowerCase() === payer.toLowerCase()),
  );
}

export function createX402Verifier(deps: X402VerifierDeps) {
  return async function verifyX402Payment(
    c: Context,
    payment: PaymentPayload,
  ): Promise<boolean> {
    let claimed: X402PaymentRecord | null = null;
    let ownsClaim = false;
    let signedAdmissionStarted = false;
    try {
      // Route/project/version/payload decoding are stable request boundaries.
      // Mutable price, recipient, network and public-origin policy are
      // intentionally consulted only after a semantic durable-identity miss.
      if (!isX402ProjectCreditRoute(c.req.path, c.req.method)) return false;
      const project = (c as Context & {
        var: { project?: { id: string; credits?: unknown } };
      }).var?.project;
      if (!project?.id) return false;
      if (payment.x402Version !== 2) return false;
      const exact = decodeExactEvmPayload(payment.payload);
      if (!exact) return false;
      const identity = authorizationIdentityHash(payment.accepted, exact);
      signedAdmissionStarted = true;

      const existing = await deps.findByAuthorization(identity);
      let requirements: PaymentRequirements;
      let resource: ResourceInfo;
      let facilitatorIsReady = false;
      if (existing) {
        const storedRequirements = requirementsFromRecord(existing);
        const storedResource = resourceFromRecord(existing);
        if (
          !storedRequirements || !storedResource ||
          !Number.isSafeInteger(existing.creditsPurchased) ||
          existing.creditsPurchased <= 0 ||
          !recordMatchesPresentedPayment(
            existing,
            project.id,
            payment,
            exact,
            storedRequirements,
            storedResource,
            c.req.path,
          )
        ) return false;
        claimed = existing;
        requirements = storedRequirements;
        resource = storedResource;
      } else {
        const policy = x402ProjectCreditPolicy(c.req.path, c.req.method);
        if (!policy) return false;
        const recipient = resolveX402Recipient(deps.recipient()).recipient;
        const network = deps.expectedNetwork();
        if (!recipient || !network) return false;
        const currentResource = x402ProjectCreditResource(policy, c.req.url);
        if (!currentResource) return false;
        const expected = buildPaymentRequirements({
          amountAtomic: policy.amountAtomic,
          payTo: recipient,
          network,
          maxTimeoutSeconds: 60,
        });
        if (
          !requirementMatches(payment.accepted, expected) ||
          !resourceMatches(payment.resource, currentResource) ||
          exact.authorization.to.toLowerCase() !== recipient.toLowerCase() ||
          exact.authorization.value !== policy.amountAtomic ||
          !authorizationWindowIsSane(
            exact,
            deps.nowSeconds(),
            expected.maxTimeoutSeconds,
          ) ||
          !canClearProjectCreditGate(policy, project.credits)
        ) return false;
        facilitatorIsReady = await deps.facilitatorReady();
        if (!facilitatorIsReady) return false;
        const claim = await deps.insertOrGet({
          projectId: project.id,
          payloadHash: payloadHash(payment),
          authorizationHash: identity,
          scheme: "exact",
          network: expected.network,
          payer: exact.authorization.from,
          authorizationEvidence: exact.authorization,
          amountAtomic: expected.amount,
          asset: expected.asset,
          payTo: expected.payTo,
          maxTimeoutSeconds: expected.maxTimeoutSeconds,
          requirementExtra: expected.extra,
          resource: currentResource.url,
          resourceInfo: currentResource,
          creditsPurchased: policy.creditsRequired,
        });
        if (claim.admission === "rate_limited" || !claim.record) {
          suppressX402Challenge(c);
          c.header("Retry-After", "600");
          return false;
        }
        const storedRequirements = requirementsFromRecord(claim.record);
        const storedResource = resourceFromRecord(claim.record);
        if (
          !storedRequirements || !storedResource ||
          !Number.isSafeInteger(claim.record.creditsPurchased) ||
          claim.record.creditsPurchased <= 0 ||
          !recordMatchesPresentedPayment(
            claim.record,
            project.id,
            payment,
            exact,
            storedRequirements,
            storedResource,
            c.req.path,
          )
        ) return false;
        claimed = claim.record;
        requirements = storedRequirements;
        resource = storedResource;
      }

      // A Base-Sepolia row is status-only unless this runtime has the explicit
      // local-test opt-in. In particular, it can never settle or mint credits
      // after a restart into NODE_ENV=production or Fly.
      if (!deps.storedNetworkMayApply(requirements.network)) {
        if (usableReceipt(
          claimed.receipt,
          requirements.network,
          requirements.amount,
          exact.authorization.from,
        )) stashReceipt(c, claimed.receipt);
        stashState(c, identity, claimed.status, true);
        return false;
      }

      // An inserted row proves no facilitator I/O began. Once its immutable
      // authorization has expired, the old signature is status-only: do not
      // spend facilitator capacity on a transfer that can no longer succeed,
      // and do not attach a second challenge to the same signed request.
      if (
        claimed.status === "inserted" &&
        BigInt(exact.authorization.validBefore) <= BigInt(deps.nowSeconds())
      ) {
        stashState(c, identity, "inserted", true);
        return false;
      }

      // No facilitator call can begin before inserted→pending. After a crash
      // in that narrow gap, the first duplicate to win this CAS safely owns
      // I/O; every request that merely observes pending must suppress replay.
      if (claimed.status === "inserted") {
        if (!facilitatorIsReady) {
          facilitatorIsReady = await deps.facilitatorReady();
          if (!facilitatorIsReady) {
            stashState(c, identity, "inserted", true);
            return false;
          }
        }
        ownsClaim = await deps.markPending(claimed.id);
        if (ownsClaim) {
          claimed = { ...claimed, status: "pending" };
        } else {
          const raced = await deps.findByAuthorization(identity);
          if (
            !raced || !recordMatchesPresentedPayment(
              raced,
              project.id,
              payment,
              exact,
              requirements,
              resource,
              c.req.path,
            )
          ) return false;
          claimed = raced;
        }
      }
      if (claimed.status === "pending" && !ownsClaim) {
        stashState(c, identity, "pending", true);
        return false;
      }

      if (claimed.status === "failed") {
        stashState(c, identity, "failed", false);
        return false;
      }

      if (claimed.status === "externally_settled" || claimed.status === "settled") {
        if (!usableReceipt(
          claimed.receipt,
          requirements.network,
          requirements.amount,
          exact.authorization.from,
        )) {
          stashState(c, identity, claimed.status, true);
          return false;
        }
        stashReceipt(c, claimed.receipt);
        stashState(c, identity, claimed.status, true);
        if (claimed.status === "settled") return false;
        const finalized = await deps.finalizeCredits(
          claimed.id,
          project.id,
          claimed.creditsPurchased,
        );
        stashState(c, identity, finalized.status, true);
        if (!finalized.applied) return false;
        updateProjectCreditSnapshot(c, finalized.balance);
        return true;
      }

      if (claimed.status !== "pending") {
        stashState(c, identity, claimed.status, true);
        return false;
      }

      // Fresh pending claim: facilitator I/O begins only after durable identity.
      stashState(c, identity, "pending", false);
      const signatureClass = await deps.classifyAuthorizationSignature(requirements, exact);
      if (signatureClass === "invalid") {
        await deps.markFailed(claimed.id, "authorization_signature_invalid");
        stashState(c, identity, "failed", false);
        return false;
      }
      // A direct EOA signature has already been verified offline; /settle
      // performs the authoritative balance/nonce check. Smart-account forms
      // need facilitator /verify first because EIP-1271/ERC-6492 need chain
      // context unavailable to this bounded edge.
      if (signatureClass === "facilitator_required") {
        let verified: FacilitatorVerifyResult;
        try {
          verified = await deps.facilitator.verify(requirements, payment);
        } catch {
          stashState(c, identity, "pending", true);
          return false;
        }
        if (!verified.isValid) {
          await deps.markFailed(
            claimed.id,
            verified.invalidReason ?? "facilitator_verify_invalid",
          );
          stashState(c, identity, "failed", false);
          return false;
        }
        if (
          verified.payer !== undefined &&
          verified.payer.toLowerCase() !== exact.authorization.from.toLowerCase()
        ) {
          await deps.markFailed(claimed.id, "facilitator_verify_payer_mismatch");
          stashState(c, identity, "failed", false);
          return false;
        }
      }

      let settled: FacilitatorSettleResult;
      try {
        if (!await deps.markSettlementAttempted(claimed.id)) {
          stashState(c, identity, "pending", true);
          return false;
        }
        settled = await deps.facilitator.settle(requirements, payment);
      } catch {
        // A request/response failure cannot prove that no on-chain move
        // occurred. Leave pending for status/reconciliation.
        stashState(c, identity, "pending", true);
        return false;
      }
      if (!settled.success) {
        stashReceipt(c, settled);
        await deps.markFailed(
          claimed.id,
          settled.errorReason ?? "facilitator_settle_failed",
          settled,
        );
        stashState(c, identity, "failed", false);
        return false;
      }
      if (!usableReceipt(
        settled,
        requirements.network,
        requirements.amount,
        exact.authorization.from,
      )) {
        stashState(c, identity, "pending", true);
        return false;
      }
      stashReceipt(c, settled);

      // PAYMENT-RESPONSE is immediate facilitator evidence and may be the
      // caller's only transaction artifact if local persistence fails. The
      // status Link remains pending/manual in that case; no local durability
      // or credit is claimed. Persist the external fact before any credit.
      const external = await deps.persistExternalSettlement(claimed.id, settled);
      claimed = external;
      stashReceipt(c, settled);
      stashState(c, identity, "externally_settled", true);
      const finalized = await deps.finalizeCredits(
        external.id,
        project.id,
        external.creditsPurchased,
      );
      stashState(c, identity, finalized.status, true);
      if (!finalized.applied) return false;
      updateProjectCreditSnapshot(c, finalized.balance);
      return true;
    } catch (error) {
      // Never print payloads, signatures, credentials, or facilitator bodies.
      console.error("[x402] verifier boundary failure:",
        error instanceof Error ? error.name : "unknown_error");
      if (claimed && claimed.status !== "failed") {
        stashState(c, claimed.authorizationHash, claimed.status, true);
      } else if (signedAdmissionStarted) {
        suppressX402Challenge(c);
        c.header("Retry-After", "600");
      }
      return false;
    }
  };
}

function rowSelection(table: typeof import("../../db/schema/economy")["x402Payments"]) {
  return {
    id: table.id,
    projectId: table.projectId,
    payloadHash: table.payloadHash,
    authorizationHash: table.authorizationHash,
    scheme: table.scheme,
    network: table.network,
    payer: table.payer,
    authorizationEvidence: table.authorizationEvidence,
    amountAtomic: table.amountAtomic,
    asset: table.asset,
    payTo: table.payTo,
    maxTimeoutSeconds: table.maxTimeoutSeconds,
    requirementExtra: table.requirementExtra,
    resource: table.resource,
    resourceInfo: table.resourceInfo,
    creditsPurchased: table.creditsPurchased,
    status: table.status,
    failureReason: table.failureReason,
    receipt: table.settlementReceipt,
    creditsApplied: table.creditsApplied,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    settlementAttemptedAt: table.settlementAttemptedAt,
  };
}

function asRecord(row: Record<string, unknown>): X402PaymentRecord {
  return row as unknown as X402PaymentRecord;
}

export async function buildProductionDeps(): Promise<X402VerifierDeps> {
  const [
    { db },
    { x402Payments },
    { projects },
    { and, count, eq, gte, isNull, lte, sql },
    coinbase,
  ] = await Promise.all([
    import("../../db/client"),
    import("../../db/schema/economy"),
    import("../../db/schema/tools"),
    import("drizzle-orm"),
    import("./facilitators/coinbase"),
  ]);
  const facilitatorUrl = resolveX402Facilitator().url;
  const facilitator = new coinbase.CoinbaseFacilitatorClient({
    baseUrl: facilitatorUrl,
  });
  const selection = rowSelection(x402Payments);

  const findByAuthorization = async (hash: string): Promise<X402PaymentRecord | null> => {
    const [row] = await db.select(selection)
      .from(x402Payments)
      .where(eq(x402Payments.authorizationHash, hash))
      .limit(1);
    return row ? asRecord(row) : null;
  };

  return {
    facilitator,
    classifyAuthorizationSignature: classifyExactEvmSignature,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    findByAuthorization,
    async insertOrGet(row) {
      return db.transaction(async (tx) => {
        // Serialize admission for this project so concurrent nonces cannot all
        // observe the same count and exceed the durable facilitator quota.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${row.projectId}, 402))
        `);
        const [existing] = await tx.select(selection).from(x402Payments)
          .where(eq(x402Payments.authorizationHash, row.authorizationHash))
          .limit(1);
        if (existing) {
          return {
            record: asRecord(existing),
            inserted: false,
            admission: "accepted" as const,
          };
        }
        const [usage] = await tx.select({ value: count() })
          .from(x402Payments)
          .where(and(
            eq(x402Payments.projectId, row.projectId),
            sql`${x402Payments.status} IN ('inserted', 'pending', 'failed')`,
            gte(x402Payments.createdAt, sql`now() - interval '10 minutes'`),
          ));
        if (Number(usage?.value ?? 0) >= X402_ATTEMPT_LIMIT_PER_PROJECT) {
          return {
            record: null,
            inserted: false,
            admission: "rate_limited" as const,
          };
        }
        const [inserted] = await tx.insert(x402Payments).values({
          ...row,
          status: "inserted",
        }).onConflictDoNothing().returning(selection);
        if (inserted) {
          return {
            record: asRecord(inserted),
            inserted: true,
            admission: "accepted" as const,
          };
        }
        const [raced] = await tx.select(selection).from(x402Payments)
          .where(eq(x402Payments.authorizationHash, row.authorizationHash))
          .limit(1);
        if (!raced) throw new Error("x402 identity conflict without row");
        return {
          record: asRecord(raced),
          inserted: false,
          admission: "accepted" as const,
        };
      });
    },
    async markPending(id) {
      const [updated] = await db.update(x402Payments).set({
        status: "pending",
        updatedAt: new Date(),
      }).where(and(
        eq(x402Payments.id, id),
        eq(x402Payments.status, "inserted"),
      )).returning({ id: x402Payments.id });
      return Boolean(updated);
    },
    async markSettlementAttempted(id) {
      const [updated] = await db.update(x402Payments).set({
        settlementAttemptedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(x402Payments.id, id),
        eq(x402Payments.status, "pending"),
        isNull(x402Payments.settlementAttemptedAt),
      )).returning({ id: x402Payments.id });
      return Boolean(updated);
    },
    async markFailed(id, reason, receipt) {
      await db.update(x402Payments).set({
        status: "failed",
        failureReason: reason.slice(0, 512),
        ...(receipt ? { settlementReceipt: receipt } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(x402Payments.id, id),
        sql`${x402Payments.status} IN ('inserted', 'pending')`,
      ));
    },
    async persistExternalSettlement(id, receipt) {
      const [updated] = await db.update(x402Payments).set({
        status: "externally_settled",
        txHash: receipt.transaction,
        settlementReceipt: receipt,
        externalSettledAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(x402Payments.id, id),
        eq(x402Payments.status, "pending"),
      )).returning(selection);
      if (updated) return asRecord(updated);
      const [existing] = await db.select(selection).from(x402Payments)
        .where(eq(x402Payments.id, id)).limit(1);
      if (!existing) throw new Error("x402 payment row not found");
      const record = asRecord(existing);
      if (record.status !== "externally_settled" && record.status !== "settled") {
        throw new Error("x402 external settlement state conflict");
      }
      return record;
    },
    async finalizeCredits(id, projectId, creditsApplied) {
      return db.transaction(async (tx) => {
        const [payment] = await tx.update(x402Payments).set({
          status: "settled",
          creditsApplied,
          settledAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(x402Payments.id, id),
          eq(x402Payments.projectId, projectId),
          eq(x402Payments.status, "externally_settled"),
        )).returning({ id: x402Payments.id });
        if (!payment) {
          const [existing] = await tx.select({ status: x402Payments.status })
            .from(x402Payments)
            .where(and(
              eq(x402Payments.id, id),
              eq(x402Payments.projectId, projectId),
            )).limit(1);
          const [project] = await tx.select({ credits: projects.credits })
            .from(projects).where(eq(projects.id, projectId)).limit(1);
          if (existing?.status !== "settled" || !project) {
            throw new Error("x402 payment is not externally settled");
          }
          return { applied: false, balance: project.credits, status: "settled" };
        }
        const [project] = await tx.update(projects)
          .set({ credits: sql`${projects.credits} + ${creditsApplied}` })
          .where(and(
            eq(projects.id, projectId),
            gte(projects.credits, 0),
            lte(projects.credits, 2_147_483_647 - creditsApplied),
          )).returning({ credits: projects.credits });
        if (!project) throw new Error("x402 project credit update rejected");
        return { applied: true, balance: project.credits, status: "settled" };
      });
    },
    facilitatorUrl: () => facilitatorUrl,
    facilitatorReady: async () =>
      resolveX402FacilitatorReadiness().ready &&
      await coinbase.isX402FacilitatorLocallyReady(),
    recipient: () => resolveX402Recipient().recipient ?? "",
    expectedNetwork: () => {
      const resolution = resolveX402Network();
      return resolution.reason === "invalid" ? null : resolution.network;
    },
    storedNetworkMayApply: storedX402NetworkMayApply,
  };
}

/** Authenticated project-scoped status query used by the receipt endpoint.
 * It reconciles payment state only; it is not tool-result idempotency. */
export async function getProductionX402PaymentStatus(
  projectId: string,
  authorizationHash: string,
): Promise<X402PaymentRecord | null> {
  if (!/^[0-9a-f]{64}$/u.test(authorizationHash)) return null;
  const [{ db }, { x402Payments }, { and, eq }] = await Promise.all([
    import("../../db/client"),
    import("../../db/schema/economy"),
    import("drizzle-orm"),
  ]);
  const [row] = await db.select(rowSelection(x402Payments))
    .from(x402Payments)
    .where(and(
      eq(x402Payments.authorizationHash, authorizationHash),
      eq(x402Payments.projectId, projectId),
    )).limit(1);
  return row ? asRecord(row) : null;
}
