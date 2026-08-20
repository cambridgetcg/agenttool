import { describe, expect, test } from "bun:test";

import {
  SOURCE_SCHEMAS,
  canonicalSha256,
  projectPublicOfferPublish,
  projectPublicOfferRevoke,
  projectPublicOfferSupersede,
  projectPublicWakeCheckpoint,
  projectPublicWakeSupersede,
  projectPublicWakeWithdrawal,
  sealPublicOffer,
  sealPublicWakeContract,
  sealPublicWakeWithdrawal,
  verifyPublicOffer,
  verifyPublicWakeContract,
} from "../src/index.js";
import {
  attackerAuthority,
  authorityFor,
  digest,
  initialWakeCore,
  offerPublishCore,
  offerRevokeCore,
  offerSupersedeCore,
  successorWakeCore,
  wakeAuthority,
  wakeWithdrawalCore,
} from "./fixtures.js";

describe("explicit signed PUBLIC WAKE source contract", () => {
  test("projects exactly four public roots and never accepts current /v1/wake", async () => {
    const contract = await sealPublicWakeContract(initialWakeCore(), wakeAuthority.signer);
    const projection = projectPublicWakeCheckpoint(contract);
    expect(projection).toEqual({
      public_contract_protocol: SOURCE_SCHEMAS.public_wake_contract,
      public_contract_schema_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      contract_root: canonicalSha256(contract),
      capability_root: contract.roots.capabilities,
      pricing_root: contract.roots.prices,
      protocols_root: contract.roots.protocols,
      boundaries_root: contract.roots.safety,
      authority_sequence: "1",
    });
    expect(Object.keys(contract.roots).sort()).toEqual(["capabilities", "prices", "protocols", "safety"]);
    expect(() => projectPublicWakeCheckpoint({
      method: "GET",
      route: "/v1/wake",
      private_project_state: true,
    })).toThrow();
  });

  test("requires exact predecessor and same authority key in v0", async () => {
    const initial = await sealPublicWakeContract(initialWakeCore(), wakeAuthority.signer);
    const successor = await sealPublicWakeContract(
      successorWakeCore(initial.contract_id),
      wakeAuthority.signer,
    );
    const projected = projectPublicWakeSupersede({
      previous_contract: initial,
      next_contract: successor,
      supersedes: digest("a"),
    });
    expect(projected.supersedes).toBe(digest("a"));
    expect(projected.authority_sequence).toBe("2");

    const keySwap = await sealPublicWakeContract(successorWakeCore(initial.contract_id, {
      authority: authorityFor(attackerAuthority.publicKey),
    }), attackerAuthority.signer);
    expect(() => projectPublicWakeSupersede({
      previous_contract: initial,
      next_contract: keySwap,
      supersedes: digest("a"),
    })).toThrow(/same|monotonically|prior/u);
  });

  test("withdrawal is separately signed, public and exact-predecessor bound", async () => {
    const contract = await sealPublicWakeContract(initialWakeCore(), wakeAuthority.signer);
    const withdrawal = await sealPublicWakeWithdrawal(wakeWithdrawalCore({
      contract_id: contract.contract_id,
      document_digest: canonicalSha256(contract),
    }), wakeAuthority.signer);
    expect(projectPublicWakeWithdrawal({
      contract,
      withdrawal,
      checkpoint_commitment: digest("b"),
    })).toEqual({
      checkpoint_commitment: digest("b"),
      reason_digest: withdrawal.reason_digest,
      withdrawal_document_digest: canonicalSha256(withdrawal),
      authority_sequence: "2",
      visibility: "PUBLIC",
    });

    const swapped = await sealPublicWakeWithdrawal(wakeWithdrawalCore({
      contract_id: contract.contract_id,
      document_digest: canonicalSha256(contract),
    }, {
      authority: authorityFor(attackerAuthority.publicKey),
    }), attackerAuthority.signer);
    expect(() => projectPublicWakeWithdrawal({
      contract,
      withdrawal: swapped,
      checkpoint_commitment: digest("b"),
    })).toThrow(/same key|monotonically/u);
  });

  test("tampering and unknown fields fail strict verification", async () => {
    const contract = await sealPublicWakeContract(initialWakeCore(), wakeAuthority.signer);
    expect(() => verifyPublicWakeContract({ ...contract, surprise: true })).toThrow();
    expect(() => verifyPublicWakeContract({
      ...contract,
      roots: { ...contract.roots, prices: digest("0") },
    })).toThrow();
  });
});

describe("pure signed public offer source lifecycle", () => {
  test("projects only verified source documents with PUBLIC parity", async () => {
    const publish = await sealPublicOffer(offerPublishCore(), wakeAuthority.signer);
    expect(projectPublicOfferPublish(publish)).toEqual({
      offer_ref: publish.offer_ref,
      capability_root: publish.capability_root,
      pricing_root: publish.pricing_root,
      sla_root: publish.sla_root,
      terms_digest: publish.terms_digest,
      revision: "1",
      offer_document_digest: canonicalSha256(publish),
      authority_sequence: "1",
      visibility: "PUBLIC",
    });
    expect(() => projectPublicOfferPublish({
      listing_id: "not-a-signed-offer",
      price: "10",
    })).toThrow();
  });

  test("supersede/revoke bind exact predecessor and source authority sequence", async () => {
    const publish = await sealPublicOffer(offerPublishCore(), wakeAuthority.signer);
    const predecessor = {
      offer_id: publish.offer_id,
      document_digest: canonicalSha256(publish),
    };
    const supersede = await sealPublicOffer(
      offerSupersedeCore(predecessor),
      wakeAuthority.signer,
    );
    const supersedeProjection = projectPublicOfferSupersede({
      previous_offer: publish,
      next_offer: supersede,
      supersedes: digest("c"),
    });
    expect(supersedeProjection.visibility).toBe("PUBLIC");
    expect(supersedeProjection.offer_document_digest).toBe(canonicalSha256(supersede));

    const revoke = await sealPublicOffer(offerRevokeCore(predecessor), wakeAuthority.signer);
    const revokeProjection = projectPublicOfferRevoke({
      previous_offer: publish,
      revoke_offer: revoke,
      offer_commitment: digest("d"),
    });
    expect(revokeProjection).toMatchObject({
      offer_ref: publish.offer_ref,
      offer_commitment: digest("d"),
      reason_digest: revoke.reason_digest,
      authority_sequence: "2",
      visibility: "PUBLIC",
    });
  });

  test("rejects subject mismatch, key swap and tampering", async () => {
    await expect(sealPublicOffer(offerPublishCore({ subject_ref: "44".repeat(32) }), wakeAuthority.signer))
      .rejects.toThrow(/subject_ref/u);
    const publish = await sealPublicOffer(offerPublishCore(), wakeAuthority.signer);
    const keySwap = await sealPublicOffer(offerSupersedeCore({
      offer_id: publish.offer_id,
      document_digest: canonicalSha256(publish),
    }, {
      authority: authorityFor(attackerAuthority.publicKey),
    }), attackerAuthority.signer);
    expect(() => projectPublicOfferSupersede({
      previous_offer: publish,
      next_offer: keySwap,
      supersedes: digest("e"),
    })).toThrow(/authority|predecessor/u);
    expect(() => verifyPublicOffer({ ...publish, pricing_root: digest("0") })).toThrow();
  });
});
