import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { bech32 } from "@scure/base";
import { canonicalInvocationCompletionBytes } from "../../api/src/services/marketplace/sig";
import { canonicalSettlementReceiptBytes, outputDigestHex, type SettlementReceiptCore } from "../../api/src/services/marketplace/settlement-receipt-verify";
import { createAgentToolInvocationWitnessLink, computeAgentToolInvocationContentHash } from "../../packages/wallet-zerone/src/invocation";
import { createZeroneWitnessLink, encodeZeroneMsgSubmitExternalAttestation } from "../../packages/wallet-zerone/src/messages";
import { AGENTTOOL_ADAPTER_ID, AGENTTOOL_WORK_CLASS_ID, ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL } from "../../packages/wallet-zerone/src/constants";
import { compareReconciliation, parseReconciliationInput, renderReconciliation, readReconciliationInput,
  MAX_RECONCILE_INPUT_BYTES, type ReconciliationInput } from "../agenttool-zerone-reconcile";

const ROOT = resolve(import.meta.dir, "../..");
const CLI = join(ROOT, "bin/agenttool-zerone-reconcile.ts");
const ENV = { PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: "/Users/yournameisai", TMPDIR: "/tmp" };
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TIME = "2026-08-01T00:00:00.000Z";
const URL = `https://synthetic.invalid/v1/invocations/${ID}`;
const ADDRESS = bech32.encodeFromBytes("zrn", new Uint8Array(20).fill(1));
const OTHER_ADDRESS = bech32.encodeFromBytes("zrn", new Uint8Array(20).fill(2));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const row = (i: ReconciliationInput, name: string) => compareReconciliation(i).rows.find(r => r.check === name)!;

function fixture(): ReconciliationInput {
  // Synthetic deterministic keys only; no fixture contains chain signatures or TxRaw.
  const sellerSeed = new Uint8Array(32).fill(1), platformSeed = new Uint8Array(32).fill(2);
  const output = { ct: b64(new Uint8Array(50).fill(3)), nonce: b64(new Uint8Array(24).fill(4)), sender_pub: b64(new Uint8Array(32).fill(5)) };
  const publicKey = b64(ed.getPublicKey(sellerSeed));
  const signature = b64(ed.sign(canonicalInvocationCompletionBytes({ invocationId: ID, output }), sellerSeed));
  const projection = { amount: 100, buyer_did: `did:example:private-buyer-${ID}`, completed_at: TIME,
    completion_sig: signature, created_at: TIME, currency: "GBP", id: ID, listing_id: OTHER, settled_at: TIME, status: "released" as const };
  const core: SettlementReceiptCore = { invocationId: ID, listingId: OTHER, sellerDid: "did:example:seller", buyerRef: "b".repeat(64),
    amountGross: 100, platformFee: 5, amountNet: 95, currency: "GBP", takeRateBps: 500,
    outputDigestHex: outputDigestHex(output.ct), completionSigB64: signature, sellerPublicKeyB64: publicKey,
    slaDeadlineAt: "", acknowledgedAt: "", settledAt: TIME };
  const receipt = { invocation_id: ID, listing_id: OTHER, seller_did: core.sellerDid, buyer_ref: core.buyerRef,
    amount_gross: 100, platform_fee: 5, amount_net: 95, currency: "GBP", take_rate_bps: 500,
    output_digest_hex: core.outputDigestHex, completion_sig_b64: signature, seller_public_key_b64: publicKey,
    sla_deadline_at: "", acknowledged_at: "", settled_at: TIME,
    receipt_digest_hex: hex(canonicalSettlementReceiptBytes(core)),
    platform_sig_b64: b64(ed.sign(canonicalSettlementReceiptBytes(core), platformSeed)), platform_key_hex: hex(ed.getPublicKey(platformSeed)) };
  const link = createAgentToolInvocationWitnessLink({ invocation: projection, source_id: ID, source_url: URL, fetched_at_block: "123" });
  const message = encodeZeroneMsgSubmitExternalAttestation({ submitter: ADDRESS, adapter_id: AGENTTOOL_ADAPTER_ID,
    work_class_id: AGENTTOOL_WORK_CLASS_ID, bond_uzrn: "100", link });
  return { schema: "agenttool.zerone-reconciliation/1", invocation_id: ID, scope: "commitment",
    expected: { chain_id: "zerone-testnet-1", source_url: URL, submitter: ADDRESS, reward_recipient: OTHER_ADDRESS,
      reward_uzrn: "9", bond_recipient: ADDRESS, bond_return_uzrn: "100", tx_hash: "a".repeat(64),
      attestation_id: "synthetic-attestation", attestation_status: "SETTLED", included: true,
      seller_public_key_b64: publicKey, platform_key_hex: receipt.platform_key_hex },
    projection: { value: projection, captured_at: TIME }, receipt: { value: receipt, captured_at: TIME },
    seller: { output, public_key_b64: publicKey, signature_b64: signature },
    message: { type_url: ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL, value_b64: b64(message), height: "123" },
    chain: { chain_id: "zerone-testnet-1", source_id: ID, tx_hash: "a".repeat(64), included: true,
      message_sha256: createHash("sha256").update(message).digest("hex"), captured_at: TIME, height: "124", provenance_sha256: "c".repeat(64),
      attestation: { id: "synthetic-attestation", status: "SETTLED", adapter_id: AGENTTOOL_ADAPTER_ID,
        work_class_id: AGENTTOOL_WORK_CLASS_ID, link_hash_hex: hex(link.link_hash), submitter: ADDRESS },
      bond_return: { amount_uzrn: "100", recipient: ADDRESS }, reward: { amount_uzrn: "9", recipient: OTHER_ADDRESS } },
    writeback: { invocation_id: ID, witnesses: [{ schema: "agenttool.invocation-witness/1", chain_id: "zerone-testnet-1",
      tx_hash: "a".repeat(64), attestation_id: "synthetic-attestation", adapter_id: AGENTTOOL_ADAPTER_ID,
      witness_did: null, witnessed_at: TIME }] },
  };
}
async function cli(args: string[], input?: string) {
  const child = Bun.spawn([process.execPath, "--no-install", "--no-env-file", "--preserve-symlinks", CLI, ...args], {
    cwd: ROOT, env: ENV, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe",
  });
  return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
}

describe("offline reconciliation comparisons", () => {
  test("matching synthetic bytes succeed only in the fixed commitment scope", () => {
    const i = fixture(), report = compareReconciliation(parseReconciliationInput(bytes(i)));
    expect(report.exit_code).toBe(0);
    expect(report.rows.filter(r => r.required).map(r => r.check)).toEqual(["invocation_identifiers", "invocation_commitment", "message_correspondence"]);
    for (const check of ["completion_signature", "platform_signature", "receipt_digest", "output_digest", "transaction_inclusion", "reward_payment_amount_comparison", "party_writeback"]) expect(row(i, check).status).toBe("matched");
    expect(row(i, "transaction_inclusion").basis).toContain("caller_report");
    expect(row(i, "seller_identity_binding").status).toBe("unavailable");
    expect(row(i, "platform_identity_binding").status).toBe("unavailable");
    expect(row(i, "buyer_binding").status).toBe("unavailable");
    expect(compareReconciliation({ ...i, scope: "full" }).exit_code).toBe(2);
  });
  test("incomplete historical input is valid and never a successful empty comparison", () => {
    const input = { schema: "agenttool.zerone-reconciliation/1", invocation_id: ID };
    const i = parseReconciliationInput(bytes(input));
    expect(i.scope).toBe("full");
    expect(compareReconciliation(i).exit_code).toBe(2);
    expect(compareReconciliation({ ...i, scope: "commitment" }).exit_code).toBe(2);
    expect(row(i, "completion_signature").needs).toContain("exact_output_envelope");
  });
  test("ciphertext digest and seller signature tampering are separate contradictions", () => {
    const i = fixture(); i.seller!.output!.ct = b64(new Uint8Array(50).fill(6));
    expect(row(i, "output_digest").status).toBe("mismatch");
    expect(row(i, "completion_signature").status).toBe("mismatch");
    expect(row(i, "platform_signature").status).toBe("matched");
    expect(compareReconciliation(i).exit_code).toBe(1);
  });
  test("digest-only receipt cannot verify original completion or authenticate keys", () => {
    const i = fixture(); delete i.seller;
    expect(row(i, "completion_signature").status).toBe("unavailable");
    expect(row(i, "output_digest").status).toBe("unavailable");
    expect(row(i, "platform_signature").status).toBe("matched");
    expect(row(i, "seller_identity_binding").status).toBe("unavailable");
    delete i.expected!.seller_public_key_b64;
    expect(row(i, "seller_key_correspondence").status).toBe("unavailable");
  });
  test("platform signature, receipt hash and monetary tampering fail independently", () => {
    const i = fixture(); i.receipt!.value.amount_net = 94;
    expect(row(i, "receipt_amounts").status).toBe("mismatch");
    expect(row(i, "receipt_digest").status).toBe("mismatch");
    expect(row(i, "platform_signature").status).toBe("mismatch");
    i.receipt!.value.platform_sig_b64 = null;
    expect(row(i, "platform_signature").status).toBe("unavailable");
  });
  test("projection field and exact timestamp spelling tampering is not normalized", () => {
    const i = fixture(); i.projection!.value.settled_at = "2026-08-01T00:00:00Z";
    expect(row(i, "receipt_timestamps").status).toBe("mismatch");
    expect(row(i, "invocation_commitment").status).toBe("mismatch");
    i.projection!.value.amount = 101;
    expect(row(i, "receipt_fields").status).toBe("mismatch");
  });
  test("wrong invocation, chain, submitter and recipient are compared only to explicit targets", () => {
    const i = fixture(); i.chain!.source_id = OTHER; i.chain!.chain_id = "zerone-1";
    i.chain!.reward!.recipient = ADDRESS; i.expected!.submitter = OTHER_ADDRESS;
    for (const check of ["invocation_identifiers", "chain", "submitter", "reward_payment_recipient"]) expect(row(i, check).status).toBe("mismatch");
    expect(compareReconciliation(i).exit_code).toBe(1);
    delete i.expected!.reward_recipient;
    expect(row(i, "reward_payment_recipient").status).toBe("unavailable");
  });
  test("inclusion does not imply settlement, bond return or reward", () => {
    const i = fixture(); delete i.chain!.attestation; delete i.chain!.reward; delete i.chain!.bond_return;
    expect(row(i, "transaction_inclusion").status).toBe("matched");
    for (const check of ["attestation_settlement", "bond_return_amount_comparison", "reward_payment_amount_comparison"]) expect(row(i, check).status).toBe("unavailable");
    delete i.chain;
    expect(row(i, "invocation_commitment").status).toBe("matched");
    expect(row(i, "transaction_inclusion").status).toBe("unavailable");
  });
  test("SETTLED with zero reward reports zero, not positive paid or contradiction without expectation", () => {
    const i = fixture(); i.chain!.reward!.amount_uzrn = "0"; delete i.expected!.reward_uzrn;
    expect(row(i, "attestation_settlement").status).toBe("matched");
    expect(row(i, "reward_payment_amount_comparison").observed).toBe("reported_zero");
    expect(row(i, "reward_payment_amount_comparison").status).not.toBe("mismatch");
    i.expected!.reward_uzrn = "0";
    expect(row(i, "reward_payment_amount_comparison").status).toBe("matched");
    i.expected!.reward_uzrn = "1";
    expect(row(i, "reward_payment_amount_comparison").status).toBe("mismatch");
  });
  test("URL correspondence is separate from the keeper link hash", () => {
    const i = fixture(); i.expected!.source_url = URL.replace("synthetic.invalid", "mirror.invalid");
    expect(row(i, "invocation_commitment").status).toBe("matched");
    expect(row(i, "message_correspondence").status).toBe("mismatch");
  });
  test("wrong content/link hashes and unsupported protobuf fail closed", () => {
    const i = fixture();
    const link = createZeroneWitnessLink({ source_id: ID, source_url: URL, fetched_at_block: "123", content_hash: new Uint8Array(32).fill(9) });
    i.message!.value_b64 = b64(encodeZeroneMsgSubmitExternalAttestation({ submitter: ADDRESS, adapter_id: AGENTTOOL_ADAPTER_ID,
      work_class_id: AGENTTOOL_WORK_CLASS_ID, bond_uzrn: "100", link }));
    expect(row(i, "invocation_commitment").status).toBe("mismatch");
    expect(row(i, "attestation_link").status).toBe("mismatch");
    i.message!.value_b64 = b64(Buffer.concat([Buffer.from(i.message!.value_b64, "base64"), Buffer.from([0x30, 0])]));
    expect(row(i, "message_correspondence").status).toBe("unsupported");
    expect(compareReconciliation(i).exit_code).toBe(64);
  });
  test("nonreleased projection cannot become an attestable safe witness", () => {
    const i = fixture(); i.projection!.value.status = "refunded";
    expect(row(i, "message_correspondence").status).toBe("mismatch");
  });
  test("partial historical state preserves known facts without invented linkage", () => {
    const i = fixture();
    i.chain = { chain_id: "zerone-testnet-1", attestation: { id: "synthetic-attestation", status: "SETTLED" }, reward: { amount_uzrn: "0" } };
    delete i.expected!.reward_uzrn;
    expect(row(i, "attestation_settlement").status).toBe("matched");
    expect(row(i, "attestation_link").status).toBe("unavailable");
    delete i.expected!.attestation_status;
    expect(row(i, "attestation_settlement").status).toBe("unavailable");
    expect(row(i, "attestation_settlement").observed).toBe("reported_settled");
    expect(row(i, "reward_payment_amount_comparison").observed).toBe("reported_zero");
    expect(row(i, "reward_payment_recipient").status).toBe("unavailable");
    i.chain.attestation!.adapter_id = "different-adapter";
    expect(row(i, "attestation_link").status).toBe("mismatch");
    i.chain.attestation = { id: "different-attestation" };
    expect(row(i, "attestation_settlement").status).toBe("mismatch");
    i.chain.reward = { recipient: OTHER_ADDRESS };
    expect(row(i, "reward_payment_amount_comparison").observed).toBeUndefined();
    expect(row(i, "reward_payment_amount_comparison").status).toBe("unavailable");
    expect(row(i, "reward_payment_recipient").status).toBe("matched");
    expect(() => parseReconciliationInput(bytes({ ...i, chain: { chain_id: "zerone-testnet-1", reward: {} } }))).toThrow("input_invalid");
  });
  test("absent or other-chain writeback is a gap; an actual conflicting reference is not", () => {
    const i = fixture(); const witness = (i.writeback!.witnesses as object[])[0];
    i.writeback!.witnesses = [];
    expect(row(i, "party_writeback").status).toBe("unavailable");
    i.writeback!.witnesses = [{ ...witness, chain_id: "zerone-1" }];
    expect(row(i, "party_writeback").status).toBe("unavailable");
    i.writeback!.witnesses = [{ ...witness, tx_hash: "b".repeat(64) }];
    expect(row(i, "party_writeback").status).toBe("mismatch");
  });
  test("contradictory supplied seller keys are visible without an expected key pin", () => {
    const i = fixture(); delete i.expected!.seller_public_key_b64;
    i.seller!.public_key_b64 = b64(ed.getPublicKey(new Uint8Array(32).fill(7)));
    expect(row(i, "seller_key_records").status).toBe("mismatch");
    expect(row(i, "seller_key_correspondence").status).toBe("unavailable");
  });
  test("partial transaction evidence cannot hide a conflicting hash", () => {
    const i = fixture(); delete i.chain!.included; delete i.expected!.included;
    i.chain!.tx_hash = "b".repeat(64);
    expect(row(i, "transaction_inclusion").status).toBe("mismatch");
    expect(compareReconciliation(i).exit_code).toBe(1);
  });
  test("partial transaction evidence cannot hide a conflicting inclusion report", () => {
    const i = fixture(); delete i.chain!.tx_hash; delete i.expected!.tx_hash;
    i.chain!.included = false;
    expect(row(i, "transaction_inclusion").status).toBe("mismatch");
    expect(compareReconciliation(i).exit_code).toBe(1);
  });
  test("partial writeback evidence cannot hide a conflicting adapter", () => {
    const i = fixture(); delete i.chain!.tx_hash;
    (i.writeback!.witnesses as { adapter_id: string }[])[0].adapter_id = "different-adapter";
    expect(row(i, "party_writeback").status).toBe("mismatch");
    expect(compareReconciliation(i).exit_code).toBe(1);
  });
  test("direct comparisons reject negative zero before JSON normalization", () => {
    const i = fixture(); i.projection!.value.amount = -0;
    expect(() => compareReconciliation(i)).toThrow("input_invalid");
  });
  test("runtime digests compare but caller provenance never authenticates a build", () => {
    const i = fixture(); i.runtime = { agenttool_image: { expected_digest: "a".repeat(64), reported_digest: "a".repeat(64), provenance_sha256: "b".repeat(64) } };
    expect(row(i, "agenttool_image_correspondence").status).toBe("matched");
    expect(row(i, "agenttool_image_provenance").status).toBe("unavailable");
  });
});

describe("strict input and minimized output", () => {
  test("rejects malformed/duplicate witnesses and unknown history format instead of dropping it", () => {
    const i = fixture(); const witnesses = i.writeback!.witnesses as unknown[];
    witnesses.push(witnesses[0]);
    expect(() => parseReconciliationInput(bytes(i))).toThrow("witnesses_invalid");
    for (const witnesses of [null, [{ chain_id: "zerone-1" }], [{ ...(fixture().writeback!.witnesses as object[])[0], credential: "DO_NOT_ECHO" }]]) {
      i.writeback!.witnesses = witnesses;
      expect(() => parseReconciliationInput(bytes(i))).toThrow("witnesses_invalid");
    }
  });
  test("rejects unsafe, negative, fractional and noncanonical monetary/height values", () => {
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, -1, 0.1, -0, Infinity, NaN]) {
      const i = fixture(); i.projection!.value.amount = amount;
      if (Object.is(amount, -0)) {
        const json = JSON.stringify(i).replace('"amount":0', '"amount":-0');
        expect(() => parseReconciliationInput(new TextEncoder().encode(json))).toThrow("input_invalid");
      } else expect(() => parseReconciliationInput(bytes(i))).toThrow("input_invalid");
    }
    for (const amount of ["01", "1.0", "-1", "1e3", "9007199254740992", "1\n"]) {
      const i = fixture(); i.chain!.reward!.amount_uzrn = amount;
      expect(() => parseReconciliationInput(bytes(i))).toThrow("input_invalid");
    }
    const i = fixture(); i.chain!.height = "18446744073709551616";
    expect(() => parseReconciliationInput(bytes(i))).toThrow("input_invalid");
  });
  test("canonical base64, UUID, dates and closed object fields are required", () => {
    for (const mutate of [
      (i: any) => { i.seller.output.ct += "\n"; },
      (i: any) => { i.seller.output.nonce = "AA=="; },
      (i: any) => { i.invocation_id = ID.toUpperCase().replace("1111", "FFFF"); },
      (i: any) => { i.projection.value.created_at = "2026-02-30T00:00:00.000Z"; },
      (i: any) => { i.expected.source_url = `https://user:secret@synthetic.invalid/v1/invocations/${ID}`; },
      (i: any) => { i.receipt.value.private_key = "DO_NOT_ECHO"; },
      (i: any) => { i.signed_tx = "DO_NOT_ECHO"; },
      (i: any) => { i.required = []; },
      (i: any) => { i.message.type_url = "/cosmos.tx.v1beta1.TxRaw"; },
    ]) {
      const i = fixture(); mutate(i);
      expect(() => parseReconciliationInput(bytes(i))).toThrow("input_invalid");
    }
  });
  test("lossy numeric spellings are refused before rounded evidence can match", () => {
    for (const token of ["100.000000000000001", "1e-999", "9007199254740990.1", "1e2", "100.0", "1E+2"]) {
      const raw = JSON.stringify(fixture()).replace('"amount":100', `"amount":${token}`);
      expect(() => parseReconciliationInput(new TextEncoder().encode(raw))).toThrow("input_invalid");
    }
  });
  test("duplicate decoded JSON keys and excessive nesting are rejected", () => {
    const duplicate = `{"schema":"agenttool.zerone-reconciliation/1","invocation_id":"${ID}","invocation_\\u0069d":"${OTHER}"}`;
    expect(() => parseReconciliationInput(new TextEncoder().encode(duplicate))).toThrow("input_duplicate_json_key");
    const deep = "[".repeat(17) + "0" + "]".repeat(17);
    expect(() => parseReconciliationInput(new TextEncoder().encode(deep))).toThrow("input_json_depth_exceeded");
  });
  test("the maximum envelope is accepted but one byte beyond its cap is refused", () => {
    const i = fixture(); i.seller!.output!.ct = b64(new Uint8Array(128 * 1024).fill(3));
    expect(bytes(i).length).toBeLessThan(MAX_RECONCILE_INPUT_BYTES);
    expect(parseReconciliationInput(bytes(i)).seller!.output!.ct).toBe(i.seller!.output!.ct);
    i.seller!.output!.ct = b64(new Uint8Array(128 * 1024 + 1).fill(3));
    expect(() => parseReconciliationInput(bytes(i))).toThrow("input_invalid");
  });
  test("oversize and invalid UTF8 are refused, output never repeats private fields", () => {
    expect(() => parseReconciliationInput(new Uint8Array(MAX_RECONCILE_INPUT_BYTES + 1))).toThrow("input_byte_limit_exceeded");
    expect(() => parseReconciliationInput(Uint8Array.of(0xff))).toThrow("input_invalid");
    const i = fixture(), report = compareReconciliation(i);
    for (const format of ["json", "text"] as const) {
      const output = renderReconciliation(report, format);
      for (const sensitive of [ID, OTHER, URL, i.projection!.value.buyer_did, i.seller!.output!.ct, ADDRESS, "synthetic-attestation"]) expect(output).not.toContain(sensitive);
      expect(output).not.toContain("DO_NOT_ECHO");
    }
    expect(renderReconciliation(report)).toBe(renderReconciliation(compareReconciliation(i)));
  });
});

describe("hermetic CLI boundary", () => {
  test("stdin and one selected regular file produce identical bounded stdout", async () => {
    const input = JSON.stringify(fixture());
    const stdin = await cli(["--input", "-", "--format", "json"], input);
    expect(stdin.code).toBe(0); expect(stdin.err).toBe("");
    const dir = await mkdtemp("/tmp/zerone-reconcile-synthetic-");
    try {
      const file = join(dir, "fixture.json"); await writeFile(file, input);
      const fromFile = await cli(["--input", file]); expect(fromFile).toEqual(stdin);
      const link = join(dir, "link.json"); await symlink(file, link);
      expect((await cli(["--input", link])).code).toBe(64);
      await writeFile(file, new Uint8Array(MAX_RECONCILE_INPUT_BYTES + 1));
      expect((await cli(["--input", file])).err).toContain("input_byte_limit_exceeded");
      expect((await cli(["--input", dir])).code).toBe(64);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test("stable exit codes and errors do not echo paths, unknown keys or payloads", async () => {
    expect((await cli(["--input", "-"], JSON.stringify({ schema: "agenttool.zerone-reconciliation/1", invocation_id: ID }))).code).toBe(2);
    const wrong = fixture(); wrong.chain!.reward!.amount_uzrn = "123";
    expect((await cli(["--input", "-"], JSON.stringify(wrong))).code).toBe(1);
    for (const result of [await cli(["--input", "-"], '{"private_key":"DO_NOT_ECHO"}'),
      await cli(["--input", "/DO_NOT_ECHO/no.json"]), await cli(["--DO_NOT_ECHO", "secret"]),
      await cli(["--input", "-", "--input", "-"], "{}")]) {
      expect(result.code).toBe(64); expect(result.out).toBe("");
      expect(result.err).not.toContain("DO_NOT_ECHO"); expect(result.err).not.toContain("secret");
      expect(result.err.split("\n")).toHaveLength(2);
    }
    const oversize = await cli(["--input", "-"], "x".repeat(MAX_RECONCILE_INPUT_BYTES + 1));
    expect(oversize.code).toBe(64); expect(oversize.err).toContain("input_byte_limit_exceeded");
  });
  test("import calls no config, DB, network, subprocess, env discovery or main", async () => {
    const code = `
      Bun.plugin({name:'forbidden-imports',setup(b){b.onResolve({filter:/(config|db\\/|postgres|child_process|settlement-receipt-sig)/},()=>{throw Error('forbidden import')})}});
      globalThis.fetch=()=>{throw Error('network forbidden')};
      const oldSpawn=Bun.spawn; Bun.spawn=()=>{throw Error('subprocess forbidden')};
      process.env=new Proxy({}, {get(){throw Error('env discovery forbidden')}});
      await import(${JSON.stringify(CLI)});
    `;
    const child = Bun.spawn([process.execPath, "--no-install", "--no-env-file", "--preserve-symlinks", "--eval", code], { cwd: ROOT, env: ENV, stdout: "pipe", stderr: "pipe" });
    const err = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0); expect(err).toBe("");
    expect(await new Response(child.stdout).text()).toBe("");
  });
});
