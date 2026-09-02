import { describe, expect, test } from "bun:test";

import {
  SEMANTIC_BOUNDARY,
  WALLET_ZERONE_SUPPORT,
  validateEvidenceReceipt,
  validateWorkSpec,
  createWorkSpec,
} from "../src/index.js";
import { buildFixture, buildIdentityProofFixture } from "./fixtures.js";

describe("semantic and effect walls", () => {
  test("ZRN never becomes identity, truth, KARMA, or governance", () => {
    const fixture = buildFixture();
    expect(fixture.workSpec.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
    expect(fixture.evidence.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
    expect(fixture.settlement.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
    expect(fixture.treasury.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
  });

  test("closed records reject authority and score escape fields", () => {
    const { workSpec, evidence } = buildFixture();
    expect(() => validateWorkSpec({ ...workSpec, governance_weight: 1 })).toThrow();
    expect(() => validateEvidenceReceipt({ ...evidence, truth_score: 100 })).toThrow();
  });

  test("message builders perform no signer, RPC, simulation, broadcast, or custody work", () => {
    const { createBounty, submitClaim, fulfill } = buildFixture();
    for (const projection of [createBounty, submitClaim, fulfill]) {
      expect(projection.compatibility.signer_required).toBeTrue();
      expect(projection.compatibility.simulation_required).toBeTrue();
      expect(projection.compatibility.broadcast_required).toBeTrue();
      expect(projection.compatibility.durable_reservation_required).toBeTrue();
      expect(projection.compatibility.sticky_unknown_accounting_required).toBeTrue();
      expect(projection.compatibility.effects_performed).toBeFalse();
    }
  });

  test("dual proof remains key-control evidence without currentness or custody claims", () => {
    const { binding, bindingProof } = buildIdentityProofFixture();
    expect(binding.proof_status).toBe("unsigned_unverified");
    expect(bindingProof.effects_performed).toBeFalse();
    expect(bindingProof.signature_input).toBe("shared_signing_digest_raw_32_bytes");
    expect(bindingProof.shared_signing_digest).toBe(binding.binding_id);
    expect(Object.keys(bindingProof).sort()).toEqual([
      "binding",
      "effects_performed",
      "format",
      "identity_proof",
      "proof_id",
      "shared_signing_digest",
      "signature_input",
      "signing_domain",
      "wallet_proof",
    ]);
    for (const forbidden of [
      "authorized",
      "current",
      "custody",
      "identity_registry_verified",
      "ownership",
      "reservation",
    ]) {
      expect(bindingProof).not.toHaveProperty(forbidden);
    }
  });

  test("keeps released wallet versions and host-only boundaries explicit", async () => {
    const wallet = await Bun.file(new URL(
      "../../wallet/package.json",
      import.meta.url,
    )).json() as { readonly name: string; readonly version: string };
    const walletZerone = await Bun.file(new URL(
      "../../wallet-zerone/package.json",
      import.meta.url,
    )).json() as { readonly name: string; readonly version: string };
    const economy = await Bun.file(new URL(
      "../package.json",
      import.meta.url,
    )).json() as {
      readonly private: boolean;
      readonly dependencies: Readonly<Record<string, string>>;
    };
    const [readme, guide] = await Promise.all([
      Bun.file(new URL("../README.md", import.meta.url)).text(),
      Bun.file(new URL("../CLAUDE.md", import.meta.url)).text(),
    ]);

    expect(wallet).toMatchObject({ name: "@agenttool/wallet", version: "0.1.3" });
    expect(walletZerone).toMatchObject({
      name: "@agenttool/wallet-zerone",
      version: "0.1.2",
    });
    expect(WALLET_ZERONE_SUPPORT.wallet_zerone_version).toBe("0.1.2");
    expect(economy.private).toBeTrue();
    expect(economy.dependencies["@noble/curves"]).toBe("2.2.0");
    expect(readme).toContain(
      "A historical proof remains\ncryptographically valid after rotation",
    );
    expect(readme).toContain("repeat currentness\ninside the sign-time reservation");
    expect(guide).toContain(
      "Pure proof verification establishes declared key control only.",
    );
    expect(guide).toContain("durable host\n  responsibility");
  });

  test("zero corroborations means ordinary challenge-window maturity", () => {
    const { workSpec, sponsorAccount } = buildFixture();
    const { work_spec_id: _id, ...core } = workSpec;
    const zero = createWorkSpec({
      ...core,
      settlement: { ...core.settlement, min_corroborations: "0" },
    });
    expect(zero.settlement.min_corroborations).toBe("0");
    const reassigned = createWorkSpec({ ...core, worker_account: sponsorAccount });
    expect(reassigned.work_spec_id).not.toBe(workSpec.work_spec_id);
    expect(() => createWorkSpec({
      ...core,
      worker_account: core.worker_account.replace(
        "cosmos:zerone-testnet-1:",
        "cosmos:zerone-1:",
      ) as typeof core.worker_account,
    })).toThrow();
  });

  test("v0 only adds a Fact and requires exact existing Fact IDs for edges", () => {
    const { workSpec } = buildFixture();
    expect(workSpec.target_tree.transition_kind).toBe("add_fact");
    expect(workSpec.target_tree.parent_fact_ids).toEqual(["commitment-UW"]);
    const { work_spec_id: _id, ...core } = workSpec;
    expect(() => createWorkSpec({
      ...core,
      target_tree: { ...core.target_tree, transition_kind: "tombstone" as never },
    })).toThrow();
    expect(() => createWorkSpec({
      ...core,
      target_tree: { ...core.target_tree, parent_fact_ids: ["not a fact id"] },
    })).toThrow();
  });
});
