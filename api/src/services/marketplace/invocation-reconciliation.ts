/** Pure bounded offline evidence comparison; no configuration or I/O.
 * Doctrine: docs/SETTLEMENT-RECEIPTS.md.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyInvocationCompletion } from "./sig";
import {
  canonicalSettlementReceiptBytes, outputDigestHex, verifySettlementReceipt,
  type SettlementReceiptCore,
} from "./settlement-receipt-verify";
import { parseWitnessEntries } from "./witness";
import {
  computeAgentToolInvocationContentHash, createAgentToolInvocationWitnessLink,
} from "../../../../packages/wallet-zerone/src/invocation";
import {
  computeZeroneWitnessLinkHash, decodeZeroneMsgSubmitExternalAttestation,
} from "../../../../packages/wallet-zerone/src/messages";
import { assertZeroneAddress } from "../../../../packages/wallet-zerone/src/profiles";
import {
  AGENTTOOL_ADAPTER_ID, AGENTTOOL_WORK_CLASS_ID,
  ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL,
} from "../../../../packages/wallet-zerone/src/constants";

export const MAX_RECONCILE_INPUT_BYTES = 256 * 1024;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const hex = (length: number) => z.string().length(length).regex(/^[0-9a-f]+$/u);
const uuid = z.string().length(36).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const token = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._:-]+$/u).refine(v => !/\s/u.test(v));
const did = z.string().min(7).max(255).regex(/^did:[a-z0-9]+:[a-zA-Z0-9._~:%+@/?,;=$&!()*#-]+$/u).refine(v => !/\s/u.test(v));
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine(v => !Object.is(v, -0));
const decimal = z.string().min(1).max(16).regex(/^(0|[1-9][0-9]*)$/u).refine(v => !/\s/u.test(v) && BigInt(v) <= MAX_SAFE);
const height = z.string().min(1).max(20).regex(/^(0|[1-9][0-9]*)$/u).refine(v => !/\s/u.test(v) && BigInt(v) <= (1n << 64n) - 1n);
// Preserve exact timestamp spelling in the commitment. Only canonical UTC
// seconds or milliseconds are supported; never silently normalize a projection.
const time = z.string().max(24).regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u).refine(v => {
  const n = Date.parse(v);
  return Number.isFinite(n) && new Date(n).toISOString() === (v.length === 20 ? v.replace("Z", ".000Z") : v);
});
const canonicalTime = time.refine(v => v.length === 24);
const b64 = (max: number, lengths?: readonly number[]) => z.string().min(1).max(Math.ceil(max / 3) * 4).refine(v => {
  const bytes = Buffer.from(v, "base64");
  return bytes.length > 0 && bytes.length <= max && bytes.toString("base64") === v && (!lengths || lengths.includes(bytes.length));
});
const signature = b64(64, [64]);
const publicKey = b64(32, [32]);
const address = z.string().max(64).refine(v => { try { assertZeroneAddress(v); return true; } catch { return false; } });
const currency = z.string().length(3).regex(/^[A-Z]{3}$/u);
const metaShape = {
  captured_at: canonicalTime.optional(), height: height.optional(), provenance_sha256: hex(64).optional(),
};
const projection = z.object({
  amount: integer, buyer_did: did, completed_at: time.nullable(), completion_sig: signature.nullable(),
  created_at: time, currency, id: uuid, listing_id: uuid, settled_at: time.nullable(),
  status: z.enum(["escrowed", "acknowledged", "completed", "released", "refunded", "disputed"]),
}).strict();
const receipt = z.object({
  invocation_id: uuid, listing_id: uuid, seller_did: did, buyer_ref: z.union([hex(64), z.literal("")]),
  amount_gross: integer, platform_fee: integer, amount_net: integer, currency,
  take_rate_bps: integer.refine(v => v <= 10000), output_digest_hex: hex(64),
  completion_sig_b64: signature, seller_public_key_b64: publicKey,
  sla_deadline_at: z.union([canonicalTime, z.literal("")]),
  acknowledged_at: z.union([canonicalTime, z.literal("")]), settled_at: canonicalTime,
  receipt_digest_hex: hex(64).optional(), sequence: integer.optional(),
  platform_sig_b64: signature.nullable().optional(), platform_key_hex: hex(64).nullable().optional(),
}).strict();
const runtimeRecord = z.object({
  ...metaShape, reported_digest: hex(64).optional(), expected_digest: hex(64).optional(),
  reported_source: hex(40).optional(), expected_source: hex(40).optional(),
}).strict();
const payment = z.object({ amount_uzrn: decimal.optional(), recipient: address.optional() }).strict()
  .refine(v => v.amount_uzrn !== undefined || v.recipient !== undefined);
const inputSchema = z.object({
  schema: z.literal("agenttool.zerone-reconciliation/1"), invocation_id: uuid,
  scope: z.enum(["full", "commitment"]).default("full"),
  expected: z.object({
    chain_id: token.optional(), source_url: z.string().min(1).max(2048).optional(),
    submitter: address.optional(), reward_recipient: address.optional(), reward_uzrn: decimal.optional(),
    bond_recipient: address.optional(), bond_return_uzrn: decimal.optional(),
    tx_hash: hex(64).optional(), attestation_id: token.optional(),
    attestation_status: z.enum(["PENDING", "SETTLED", "REJECTED"]).optional(), included: z.boolean().optional(),
    seller_public_key_b64: publicKey.optional(), platform_key_hex: hex(64).optional(),
  }).strict().optional(),
  projection: z.object({ ...metaShape, value: projection }).strict().optional(),
  receipt: z.object({ ...metaShape, value: receipt }).strict().optional(),
  seller: z.object({ ...metaShape, public_key_b64: publicKey.optional(), signature_b64: signature.optional(),
    output: z.object({ ct: b64(128 * 1024), nonce: b64(24, [12, 24]), sender_pub: publicKey }).strict().optional(),
  }).strict().optional(),
  message: z.object({ ...metaShape, type_url: z.literal(ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL),
    value_b64: b64(64 * 1024),
  }).strict().optional(),
  chain: z.object({
    ...metaShape, chain_id: token, source_id: uuid.optional(), tx_hash: hex(64).optional(),
    message_sha256: hex(64).optional(), included: z.boolean().optional(),
    attestation: z.object({ id: token, status: z.enum(["PENDING", "SETTLED", "REJECTED"]).optional(),
      adapter_id: token.optional(), work_class_id: token.optional(), link_hash_hex: hex(64).optional(), submitter: address.optional(),
    }).strict().optional(),
    bond_return: payment.optional(), reward: payment.optional(),
  }).strict().optional(),
  writeback: z.object({ ...metaShape, invocation_id: uuid, witnesses: z.unknown() }).strict().optional(),
  runtime: z.object({ agenttool_image: runtimeRecord.optional(), relay_binary: runtimeRecord.optional(),
    chain_application: runtimeRecord.optional(), verifier: runtimeRecord.optional(),
  }).strict().optional(),
}).strict();
export type ReconciliationInput = z.infer<typeof inputSchema>;
type Meta = z.infer<typeof runtimeRecord>;
export type CheckStatus = "matched" | "mismatch" | "unavailable" | "unsupported";
export interface ReconciliationRow {
  check: string; status: CheckStatus; basis: string; required: boolean; needs: readonly string[];
  evidence: { captured_at: string | null; height: string | null; provenance_sha256: string | null };
  observed?: "reported_zero" | "reported_positive" | "reported_included" | "reported_not_included"
    | "reported_pending" | "reported_settled" | "reported_rejected";
}
export interface ReconciliationReport {
  schema: "agenttool.zerone-reconciliation-report/1";
  scope: "full" | "commitment"; invocation_ref: string; rows: ReconciliationRow[];
  exit_code: 0 | 1 | 2 | 64; limitations: readonly string[];
}
export class ReconciliationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ReconciliationError"; }
}
function fail(code: string): never { throw new ReconciliationError(code); }
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

// JSON.parse establishes grammar first. Inspect the original tokens as well:
// decoding must not hide duplicate keys or round unsupported numeric evidence.
function validateJsonTokens(text: string): void {
  const stack: (Set<string> | null)[] = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[{}\[\]]/gu)) {
    const token = match[0];
    if (token === "{" || token === "[") {
      stack.push(token === "{" ? new Set() : null);
      if (stack.length > 16) fail("input_json_depth_exceeded");
    } else if (token === "}" || token === "]") stack.pop();
    else if (token[0] !== '"') {
      if (!/^(0|[1-9][0-9]{0,15})$/u.test(token) || BigInt(token) > MAX_SAFE) fail("input_invalid");
    } else {
      let next = match.index! + token.length;
      while (/\s/u.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] !== ":") continue;
      const keys = stack.at(-1)!;
      const key = JSON.parse(token) as string;
      if (keys.has(key)) fail("input_duplicate_json_key");
      keys.add(key);
    }
  }
}

export function parseReconciliationInput(bytes: Uint8Array): ReconciliationInput {
  if (bytes.byteLength > MAX_RECONCILE_INPUT_BYTES) fail("input_byte_limit_exceeded");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const json: unknown = JSON.parse(text);
    validateJsonTokens(text);
    const parsed = inputSchema.parse(json);
    if (parsed.expected?.source_url) {
      const url = new URL(parsed.expected.source_url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
        || url.pathname !== `/v1/invocations/${parsed.invocation_id}` || url.toString() !== parsed.expected.source_url) fail("input_invalid");
    }
    if (parsed.writeback) {
      const entries = parseWitnessEntries(parsed.writeback.witnesses);
      if (!entries) fail("witnesses_invalid");
      const keys = new Set<string>();
      for (const entry of entries) {
        // The existing parser supplies the versioned shape; narrow hex/time to
        // this offline profile and reject duplicate reports rather than choose.
        if (!/^[0-9a-f]{64}$/u.test(entry.tx_hash) || !canonicalTime.safeParse(entry.witnessed_at).success) fail("witnesses_invalid");
        const key = `${entry.chain_id}/${entry.attestation_id}`;
        if (keys.has(key)) fail("witnesses_invalid");
        keys.add(key);
      }
    }
    return parsed;
  } catch (error) {
    if (error instanceof ReconciliationError) throw error;
    fail("input_invalid");
  }
}

function receiptCore(r: z.infer<typeof receipt>): SettlementReceiptCore {
  return { invocationId: r.invocation_id, listingId: r.listing_id, sellerDid: r.seller_did,
    buyerRef: r.buyer_ref, amountGross: r.amount_gross, platformFee: r.platform_fee,
    amountNet: r.amount_net, currency: r.currency, takeRateBps: r.take_rate_bps,
    outputDigestHex: r.output_digest_hex, completionSigB64: r.completion_sig_b64,
    sellerPublicKeyB64: r.seller_public_key_b64, slaDeadlineAt: r.sla_deadline_at,
    acknowledgedAt: r.acknowledged_at, settledAt: r.settled_at };
}

/** All chain/export metadata remains caller-reported, even when it agrees.
 * A fixed commitment scope cannot omit one of its three prerequisites. Full
 * scope deliberately retains unsupported identity/build authentication gaps.
 */
export function compareReconciliation(input: ReconciliationInput): ReconciliationReport {
  // Validate before serialization, which would silently turn -0 into 0.
  let validated: ReconciliationInput;
  try { validated = inputSchema.parse(input); } catch { fail("input_invalid"); }
  const i = parseReconciliationInput(new TextEncoder().encode(JSON.stringify(validated)));
  const p = i.projection?.value, r = i.receipt?.value, s = i.seller, c = i.chain, e = i.expected;
  const rows: ReconciliationRow[] = [];
  const commitmentChecks = ["invocation_identifiers", "invocation_commitment", "message_correspondence"];
  const add = (check: string, result: boolean | undefined | "unsupported", basis: string, needs: string[], meta?: Meta,
    observed?: ReconciliationRow["observed"]) => {
    rows.push({ check, status: result === "unsupported" ? "unsupported" : result === undefined ? "unavailable" : result ? "matched" : "mismatch",
      basis, required: i.scope === "full" || commitmentChecks.includes(check), needs: result === undefined ? needs : [],
      evidence: { captured_at: meta?.captured_at ?? null, height: meta?.height ?? null, provenance_sha256: meta?.provenance_sha256 ?? null },
      ...(observed ? { observed } : {}),
    });
  };
  let message: ReturnType<typeof decodeZeroneMsgSubmitExternalAttestation> | undefined;
  let unsupported = false;
  if (i.message) {
    try {
      message = decodeZeroneMsgSubmitExternalAttestation(Buffer.from(i.message.value_b64, "base64"));
      if (BigInt(message.bond_uzrn) > MAX_SAFE) fail("unsupported_message");
    } catch { unsupported = true; }
  }
  const ids = [p?.id, r?.invocation_id, c?.source_id, i.writeback?.invocation_id, message?.link.source.source_id].filter(v => v !== undefined);
  add("invocation_identifiers", ids.length ? ids.every(id => id === i.invocation_id) : undefined,
    "exact_identifier_comparison_not_identity", ["projection_or_receipt_or_source"], i.projection ?? i.receipt ?? c);
  add("receipt_fields", p && r ? p.listing_id === r.listing_id && p.amount === r.amount_gross && p.currency === r.currency
    && p.completion_sig === r.completion_sig_b64 && p.status === "released" : undefined,
    "receipt_vs_projection_exact_committed_fields", ["receipt", "projection"], i.receipt);
  add("receipt_timestamps", p && r && p.settled_at ? p.settled_at === r.settled_at : undefined,
    "exact_settled_at_spelling_only_no_completed_at_equivalence", ["receipt", "projection_settled_at"], i.receipt);
  add("receipt_amounts", r ? BigInt(r.platform_fee) + BigInt(r.amount_net) === BigInt(r.amount_gross) : undefined,
    "integer_conservation_not_recomputed_historical_fee", ["receipt"], i.receipt);
  add("receipt_digest", r?.receipt_digest_hex ? toHex(canonicalSettlementReceiptBytes(receiptCore(r))) === r.receipt_digest_hex : undefined,
    "canonical_receipt_bytes", ["receipt_with_digest"], i.receipt);
  add("output_digest", r && s?.output ? outputDigestHex(s.output.ct) === r.output_digest_hex : undefined,
    "sha256_exact_ciphertext_not_plaintext", ["receipt", "exact_output_envelope"], s);
  const sig = s?.signature_b64 ?? r?.completion_sig_b64 ?? p?.completion_sig;
  const key = s?.public_key_b64 ?? r?.seller_public_key_b64;
  add("completion_signature", s?.output && sig && key ? verifyInvocationCompletion({ invocationId: i.invocation_id,
    output: s.output, signatureB64: sig, publicKeyB64: key }) : undefined,
    "ed25519_under_supplied_key_not_seller_identity", ["exact_output_envelope", "completion_signature", "seller_public_key"], s);
  const sigs = [s?.signature_b64, r?.completion_sig_b64, p?.completion_sig].filter(v => v != null);
  add("completion_signature_correspondence", sigs.length >= 2 ? sigs.every(v => v === sigs[0]) : undefined,
    "exact_signature_bytes_not_signature_validity", ["two_completion_signature_records"], s ?? i.receipt);
  add("seller_key_records", s?.public_key_b64 && r ? s.public_key_b64 === r.seller_public_key_b64 : undefined,
    "exact_supplied_key_record_comparison_not_identity", ["seller_public_key", "receipt_seller_public_key"], s);
  add("seller_key_correspondence", key && e?.seller_public_key_b64 ? key === e.seller_public_key_b64
    && (!r || key === r.seller_public_key_b64) : undefined,
    "caller_pinned_key_comparison_not_authenticated_binding", ["expected_seller_public_key", "seller_public_key"], s ?? i.receipt);
  add("seller_identity_binding", undefined, "no_authenticated_historical_key_registry_in_this_profile", ["authenticated_seller_key_binding"]);
  add("platform_signature", r?.platform_sig_b64 && r.platform_key_hex ? verifySettlementReceipt({ core: receiptCore(r),
    signatureB64: r.platform_sig_b64, publicKeyHex: r.platform_key_hex }) : undefined,
    "ed25519_under_supplied_platform_key", ["receipt_platform_signature_and_key"], i.receipt);
  add("platform_key_correspondence", r?.platform_key_hex && e?.platform_key_hex ? r.platform_key_hex === e.platform_key_hex : undefined,
    "caller_pinned_key_comparison_not_authenticated_binding", ["expected_platform_key", "receipt_platform_key"], i.receipt);
  add("platform_identity_binding", undefined, "no_authenticated_platform_key_root_in_this_profile", ["authenticated_platform_key_binding"]);
  add("buyer_binding", undefined, "buyer_ref_hmac_is_not_buyer_did_no_secret_recipe_evaluation", ["separately_authorized_buyer_binding"]);
  add("invocation_commitment", unsupported ? "unsupported" : message && p
    ? toHex(computeAgentToolInvocationContentHash(p)) === toHex(message.link.source.content_hash) : undefined,
    "exact_ten_field_go_json_sha256", ["projection", "supported_message"], i.message);
  let correspondence: boolean | undefined | "unsupported" = unsupported ? "unsupported" : undefined;
  if (message && p && e?.source_url) {
    if (p.status !== "released" || !p.completion_sig || !p.settled_at || message.link.source.source_id !== p.id) correspondence = false;
    else {
      const link = createAgentToolInvocationWitnessLink({ invocation: p, source_id: p.id,
        source_url: e.source_url, fetched_at_block: message.link.source.fetched_at_block });
      correspondence = message.link.source.source_url === e.source_url
        && toHex(link.link_hash) === toHex(computeZeroneWitnessLinkHash(message.link));
    }
  }
  add("message_correspondence", correspondence, "supported_adapter_work_class_link_and_exact_url_not_transaction_inclusion",
    ["released_projection", "supported_message", "expected_source_url"], i.message);
  add("chain", c && e?.chain_id ? c.chain_id === e.chain_id : undefined,
    "caller_report_vs_expected_chain_not_consensus_proof", ["chain_observation", "expected_chain_id"], c);
  add("submitter", message && e?.submitter ? message.submitter === e.submitter : undefined,
    "message_vs_explicit_submitter_never_inferred_seller", ["supported_message", "expected_submitter"], i.message);
  add("transaction_message", c?.message_sha256 && i.message ? c.message_sha256 === sha256(Buffer.from(i.message.value_b64, "base64")) : undefined,
    "caller_reported_message_digest_not_inclusion", ["chain_message_sha256", "supported_message"], c);
  // A supplied contradiction remains visible even when other fields are missing.
  const compareFields = (pairs: readonly (readonly [string | boolean | undefined, string | boolean | undefined])[]): boolean | undefined => {
    if (pairs.some(([left, right]) => left !== undefined && right !== undefined && left !== right)) return false;
    return pairs.every(([left, right]) => left !== undefined && right !== undefined) ? true : undefined;
  };
  add("transaction_inclusion", compareFields([[c?.included, e?.included], [c?.tx_hash, e?.tx_hash]]),
    "caller_report_vs_expectation_not_cryptographically_verified_inclusion", ["reported_inclusion_and_tx_hash", "expected_inclusion_and_tx_hash"], c,
    c?.included === undefined ? undefined : c.included ? "reported_included" : "reported_not_included");
  const a = c?.attestation;
  add("attestation_link", a && message ? compareFields([
    [a.adapter_id, AGENTTOOL_ADAPTER_ID], [a.work_class_id, AGENTTOOL_WORK_CLASS_ID],
    [a.link_hash_hex, toHex(message.link.link_hash)], [a.submitter, message.submitter],
  ]) : undefined,
    "caller_reported_attestation_vs_message", ["complete_attestation_link_fields", "supported_message"], c);
  add("attestation_settlement", compareFields([[a?.id, e?.attestation_id], [a?.status, e?.attestation_status]]),
    "caller_reported_state_vs_expectation_not_reward_payment", ["chain_attestation_id_and_status", "expected_attestation_id_and_status"], c,
    a?.status === undefined ? undefined : { PENDING: "reported_pending", SETTLED: "reported_settled", REJECTED: "reported_rejected" }[a.status] as ReconciliationRow["observed"]);
  for (const [name, value, amount, recipient] of [
    ["bond_return", c?.bond_return, e?.bond_return_uzrn, e?.bond_recipient],
    ["reward_payment", c?.reward, e?.reward_uzrn, e?.reward_recipient],
  ] as const) {
    add(`${name}_amount_comparison`, value?.amount_uzrn !== undefined && amount !== undefined ? value.amount_uzrn === amount : undefined,
      "caller_reported_uzrn_vs_expectation_not_implied_by_settlement", ["reported_payment_amount", "expected_amount"], c,
      value?.amount_uzrn !== undefined ? value.amount_uzrn === "0" ? "reported_zero" : "reported_positive" : undefined);
    add(`${name}_recipient`, value?.recipient && recipient ? value.recipient === recipient : undefined,
      "caller_reported_recipient_vs_explicit_expectation_never_seller_inference", ["reported_payment_recipient", "expected_recipient"], c);
  }
  const witnesses = i.writeback ? parseWitnessEntries(i.writeback.witnesses)! : undefined;
  const witness = witnesses?.find(w => w.chain_id === c?.chain_id && w.attestation_id === a?.id);
  add("party_writeback", witness && a ? compareFields([
    [witness.tx_hash, c?.tx_hash],
    ...(witness.adapter_id === undefined ? [] : [[witness.adapter_id, a.adapter_id] as const]),
  ]) : undefined,
    "party_report_shape_and_reference_correspondence_not_platform_chain_verification", ["matching_party_report", "chain_tx_hash_and_attestation"], i.writeback);
  for (const name of ["agenttool_image", "relay_binary", "chain_application", "verifier"] as const) {
    const runtime = i.runtime?.[name];
    const pairs = runtime ? [[runtime.reported_digest, runtime.expected_digest], [runtime.reported_source, runtime.expected_source]] : [];
    const complete = pairs.filter(pair => pair[0] !== undefined && pair[1] !== undefined);
    add(`${name}_correspondence`, complete.length ? complete.every(([reported, expected]) => reported === expected) : undefined,
      "caller_reported_digest_or_source_vs_expectation_not_build_receipt", ["reported_and_expected_digest_or_source"], runtime);
    add(`${name}_provenance`, undefined, "no_authenticated_runtime_or_build_receipt_in_this_profile", ["authenticated_build_and_runtime_binding"], runtime);
  }
  const exit_code = rows.some(row => row.status === "unsupported") ? 64
    : rows.some(row => row.status === "mismatch") ? 1
    : rows.some(row => row.required && row.status === "unavailable") ? 2 : 0;
  return { schema: "agenttool.zerone-reconciliation-report/1", scope: i.scope,
    invocation_ref: `sha256:${sha256(i.invocation_id)}`, rows, exit_code,
    limitations: ["offline_consistency_only_not_readiness_or_chain_truth", "caller_provenance_digests_are_not_authenticated",
      "no_network_signing_broadcast_writeback_or_persistence", "full_scope_retains_identity_and_runtime_authentication_gaps",
      "missing_history_is_not_evidence_of_nonsettlement"],
  };
}

export function renderReconciliation(report: ReconciliationReport, format: "json" | "text" = "json"): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  return [`Offline comparison scope: ${report.scope} (not readiness or chain truth)`,
    ...report.rows.map(row => `${row.check}: ${row.status} | ${row.basis} | required=${row.required}`
      + ` | observed=${row.observed ?? "not_supplied"} | needs=${row.needs.join(",") || "none"}`
      + ` | captured_at=${row.evidence.captured_at ?? "unavailable"} | height=${row.evidence.height ?? "unavailable"}`
      + ` | provenance_sha256=${row.evidence.provenance_sha256 ?? "unavailable"}`),
    `exit_code: ${report.exit_code}`, ...report.limitations, ""].join("\n");
}
