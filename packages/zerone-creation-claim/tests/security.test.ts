import { describe, expect, test } from "bun:test";

import {
  CreationClaimError,
  HASH_DOMAINS,
  MAX_HASH_INPUT_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_STRING_BYTES,
  aggregateCreationLifecycle,
  assertWorkSpecMatchesContract,
  assertCreationWitnessMatches,
  canonicalJson,
  createCreationArtifact,
  createCreationContract,
  createCreationWitness,
  createCreationWorkSpec,
  createVerificationWitness,
  domainSeparatedId,
  projectCreationClaim,
  sha256Id,
  validateCreationArtifactCore,
  validateCreationClaimProjection,
  validateCreationWitnessCore,
  validateCreationWorkSpecCore,
  validateVerificationWitnessCore,
  validateCreationLifecycle,
} from "../src/index.js";
import {
  clone,
  contractInput,
  creationWitnessInput,
  vectors,
  verificationWitnessInput,
  workSpecInput,
} from "./fixtures.js";

const ready = vectors.cases.ready_formal_creation;

describe("hostile input and authority walls", () => {
  test("rejects a Proxy without executing its traps", () => {
    let traps = 0;
    const trap = () => { traps += 1; throw new Error("trap executed"); };
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(() => createCreationContract(hostile as any)).toThrow(CreationClaimError);
    expect(traps).toBe(0);

    const hostileArray = new Proxy([], { get: trap, ownKeys: trap });
    expect(() => aggregateCreationLifecycle(
      ready.contract,
      ready.work_spec,
      ready.creation_witness,
      hostileArray as any,
    )).toThrow(CreationClaimError);
    expect(traps).toBe(0);
  });

  test("rejects accessors, cycles, custom prototypes, sparse arrays, and symbols", () => {
    const accessor = contractInput();
    Object.defineProperty(accessor, "lane", { enumerable: true, get: () => "formal_math" });
    expect(() => createCreationContract(accessor as any)).toThrow(/data property/u);

    const cycle = contractInput();
    cycle.loop = cycle;
    expect(() => createCreationContract(cycle as any)).toThrow(/cycles/u);

    const custom = Object.assign(Object.create({ inherited: true }), contractInput());
    expect(() => createCreationContract(custom as any)).toThrow(/plain object/u);

    const sparse = contractInput();
    sparse.outcome_routes = new Array(5);
    sparse.outcome_routes[4] = contractInput().outcome_routes[4];
    expect(() => createCreationContract(sparse as any)).toThrow(/dense Array/u);

    const symbol = contractInput();
    symbol[Symbol("hidden")] = true;
    expect(() => createCreationContract(symbol as any)).toThrow(/symbol property/u);
  });

  test("enforces Unicode, depth, node, string, and hash bounds", () => {
    expect(() => canonicalJson("x".repeat(MAX_STRING_BYTES + 1))).toThrow(/string byte bound/u);
    expect(() => canonicalJson("\ud800")).toThrow(/malformed Unicode/u);
    expect(() => sha256Id("x".repeat(MAX_HASH_INPUT_BYTES + 1))).toThrow(/hash input exceeds/u);

    let deep: any = null;
    for (let index = 0; index < MAX_JSON_DEPTH + 2; index += 1) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow(/deeply nested/u);
    expect(() => canonicalJson(Array.from({ length: MAX_JSON_NODES + 1 }, () => null)))
      .toThrow(/dense Array|too many/u);

    const detached = new Uint8Array([1, 2, 3]);
    structuredClone(detached, { transfer: [detached.buffer] });
    expect(() => sha256Id(detached)).toThrow(CreationClaimError);
  });

  test("rejects worker/payee substitution and semantic-edge widening", () => {
    const contract = createCreationContract(contractInput() as any);
    const payee = workSpecInput();
    payee.payee_address = "zrn1enxvenxvenxvenxvenxvenxvenxvenxvlnucek";
    expect(() => createCreationWorkSpec(contract, payee as any)).toThrow(/assigned worker.*payee/u);

    const edge = workSpecInput();
    edge.target_tree.relation_support = "all_typed_relations";
    expect(() => createCreationWorkSpec(contract, edge as any)).toThrow(/REQUIRES parents/u);

    const excessiveStake = workSpecInput();
    excessiveStake.claim_submission.review_stake_uzrn = "101";
    expect(() => createCreationWorkSpec(contract, excessiveStake as any)).toThrow(/stake exceeds/u);

    const underfundedEscrow = workSpecInput();
    underfundedEscrow.settlement.prefunded_escrow_uzrn = "999";
    expect(() => createCreationWorkSpec(contract, underfundedEscrow as any)).toThrow(/prefunded escrow/u);

    const substitutedEscrowEvidence = workSpecInput();
    substitutedEscrowEvidence.settlement.bounty_escrow_reservation_ref =
      substitutedEscrowEvidence.claim_submission.review_stake_funding_ref;
    expect(() => createCreationWorkSpec(contract, substitutedEscrowEvidence as any))
      .toThrow(/distinct evidence refs/u);
  });

  test("rejects a wrong Zerone HRP and a bad Bech32 checksum", () => {
    const contract = createCreationContract(contractInput() as any);
    const wrongHrp = workSpecInput();
    wrongHrp.worker.account_address = wrongHrp.worker.account_address.replace(/^zrn/u, "zerone");
    wrongHrp.payee_address = wrongHrp.worker.account_address;
    wrongHrp.fulfillment_caller_address = wrongHrp.worker.account_address;
    expect(() => createCreationWorkSpec(contract, wrongHrp as any)).toThrow(/zrn Bech32/u);

    const badChecksum = workSpecInput();
    badChecksum.worker.account_address = `${badChecksum.worker.account_address.slice(0, -1)}q`;
    badChecksum.payee_address = badChecksum.worker.account_address;
    badChecksum.fulfillment_caller_address = badChecksum.worker.account_address;
    expect(() => createCreationWorkSpec(contract, badChecksum as any)).toThrow(/zrn Bech32/u);
  });

  test("rejects execution-root, producer, and resource substitutions", () => {
    const contract = createCreationContract(contractInput() as any);
    const workSpec = createCreationWorkSpec(contract, workSpecInput() as any);

    const rootSwap = creationWitnessInput();
    rootSwap.run.environment_root = rootSwap.run.input_root;
    expect(() => createCreationWitness(contract, workSpec, rootSwap as any)).toThrow(/environment_root/u);

    const producerSwap = creationWitnessInput();
    producerSwap.producer.wallet_binding_ref = producerSwap.producer.producer_key_ref;
    expect(() => createCreationWitness(contract, workSpec, producerSwap as any)).toThrow(/wallet_binding_ref/u);

    const excess = creationWitnessInput();
    excess.resource_usage.compute_millis = "100001";
    expect(() => createCreationWitness(contract, workSpec, excess as any)).toThrow(/exceeds.*limit/u);
  });

  test("rejects an internally valid witness rebound to a different run", () => {
    const witness = clone(ready.creation_witness);
    delete witness.creation_witness_id;
    witness.run.model_ref = ready.contract.execution.toolchain_ref;
    const core = validateCreationWitnessCore(witness);
    const rebound = {
      ...core,
      creation_witness_id: domainSeparatedId(HASH_DOMAINS.creation_witness, core),
    };

    expect(() => assertCreationWitnessMatches(
      ready.contract,
      ready.work_spec,
      rebound,
    )).toThrow(/model_ref/u);
  });

  test("does not build a verification witness for an orphaned creation witness", () => {
    const witness = clone(ready.creation_witness);
    delete witness.creation_witness_id;
    witness.artifact_kind = "detector";
    const core = validateCreationWitnessCore(witness);
    const rebound = {
      ...core,
      creation_witness_id: domainSeparatedId(HASH_DOMAINS.creation_witness, core),
    };
    const input = verificationWitnessInput(ready.verification_witnesses[0]);

    expect(() => createVerificationWitness(
      ready.contract,
      ready.work_spec,
      rebound,
      input as any,
    )).toThrow(/artifact_kind/u);
  });

  test("rechecks WorkSpec corroboration and witness route semantics after reload", () => {
    const workSpec = clone(ready.work_spec);
    delete workSpec.work_spec_id;
    workSpec.settlement.min_corroborations = "1";
    const workSpecCore = validateCreationWorkSpecCore(workSpec);
    const weakenedWorkSpec = {
      ...workSpecCore,
      work_spec_id: domainSeparatedId(HASH_DOMAINS.work_spec, workSpecCore),
    };
    expect(() => assertWorkSpecMatchesContract(ready.contract, weakenedWorkSpec))
      .toThrow(/corroboration threshold/u);

    const contractInputValue = contractInput();
    const boundedRoute = contractInputValue.outcome_routes.find((route: any) => route.outcome === "bounded_answer");
    const noAnswerRoute = contractInputValue.outcome_routes.find((route: any) => route.outcome === "no_bounded_answer");
    noAnswerRoute.tok_posture = "digest_fact_candidate";
    noAnswerRoute.settlement_posture = "separate_activation_required";
    noAnswerRoute.requirements = clone(boundedRoute.requirements);
    const contract = createCreationContract(contractInputValue as any);
    const reboundWorkSpec = createCreationWorkSpec(contract, workSpecInput() as any);
    const witness = creationWitnessInput();
    witness.outcome = "no_bounded_answer";
    witness.result.candidate_artifact_ref = null;
    witness.result.statement_or_behavior_ref = null;
    witness.result.public_summary_ref = null;
    const witnessCore = validateCreationWitnessCore({
      ...witness,
      _format: ready.creation_witness._format,
      contract_id: contract.contract_id,
      work_spec_id: reboundWorkSpec.work_spec_id,
      declaration: ready.creation_witness.declaration,
      nonclaims: ready.creation_witness.nonclaims,
      boundary: ready.creation_witness.boundary,
      effects: ready.creation_witness.effects,
    });
    const routeReboundWitness = {
      ...witnessCore,
      creation_witness_id: domainSeparatedId(HASH_DOMAINS.creation_witness, witnessCore),
    };
    expect(() => aggregateCreationLifecycle(contract, reboundWorkSpec, routeReboundWitness, []))
      .toThrow(/ToK-routed outcome/u);
  });

  test("rejects an internally valid artifact rebound to different compute roots", () => {
    const artifact = clone(ready.artifact);
    delete artifact.artifact_id;
    artifact.computational_roots.input_root = sha256Id("rebound-input-root");
    artifact.work_receipt_input_root = domainSeparatedId(HASH_DOMAINS.work_receipt_input, {
      ...artifact.computational_roots,
      payee_address: artifact.producer_account_address,
    });
    const core = validateCreationArtifactCore(artifact);
    const rebound = {
      ...core,
      artifact_id: domainSeparatedId(HASH_DOMAINS.computational_artifact, core),
    };

    expect(() => projectCreationClaim(
      ready.contract,
      ready.work_spec,
      ready.creation_witness,
      ready.verification_witnesses,
      ready.lifecycle,
      rebound,
    )).toThrow(/artifact must be recomputed/u);
  });

  test("rejects duplicate verification records rather than inflating a threshold", () => {
    const duplicate = ready.verification_witnesses.find((witness: any) =>
      witness.kind === "independent_reproduction"
    );
    expect(() => aggregateCreationLifecycle(
      ready.contract,
      ready.work_spec,
      ready.creation_witness,
      [...ready.verification_witnesses, duplicate],
    )).toThrow(/strictly Unicode-sorted and unique/u);
  });

  test("rechecks requirement policy bindings and verifier-count bounds", () => {
    const original = clone(ready.verification_witnesses[0]);
    delete original.verification_witness_id;
    original.policy_ref = original.method_ref;
    const core = validateVerificationWitnessCore(original);
    const rebound = {
      ...core,
      verification_witness_id: domainSeparatedId(HASH_DOMAINS.verification_witness, core),
    };
    expect(() => aggregateCreationLifecycle(
      ready.contract,
      ready.work_spec,
      ready.creation_witness,
      [rebound, ...ready.verification_witnesses.slice(1)],
    )).toThrow(/selected requirement policy/u);

    expect(() => aggregateCreationLifecycle(
      ready.contract,
      ready.work_spec,
      ready.creation_witness,
      Array.from({ length: 65 }, () => ready.verification_witnesses[0]),
    )).toThrow(/must not exceed 64/u);

    const impossibleContract = contractInput();
    const route = impossibleContract.outcome_routes.find((entry: any) => entry.outcome === "bounded_answer");
    for (const requirement of route.requirements) requirement.minimum_passes = "16";
    route.requirements.push({
      kind: "functional_validation",
      minimum_passes: "16",
      independence: "not_required",
      policy_ref: sha256Id("impossible-functional-policy"),
    });
    expect(() => createCreationContract(impossibleContract as any)).toThrow(/more witnesses/u);
  });

  test("rejects typed-relation downgrades and lifecycle maturity injection", () => {
    const downgrade = vectors.cases.rejected_relation_downgrade;
    expect(() => validateCreationClaimProjection(downgrade.projection)).toThrow(/only exact REQUIRES/u);

    const mature = clone(ready.lifecycle);
    mature.handoff.chain_maturity = "mature";
    expect(() => validateCreationLifecycle(mature)).toThrow(/cannot claim chain maturity/u);

    const settled = clone(ready.lifecycle);
    settled.handoff.settlement = "settled";
    expect(() => validateCreationLifecycle(settled)).toThrow(/cannot claim chain maturity or settlement/u);

    const extra = clone(ready.lifecycle);
    extra.consensus_height = "1";
    expect(() => validateCreationLifecycle(extra)).toThrow(/must contain exactly/u);

    const forgedRequirement = clone(ready.lifecycle);
    forgedRequirement.requirements[0].status = "open";
    expect(() => validateCreationLifecycle(forgedRequirement)).toThrow(/status does not match/u);

    const vacuousReady = clone(ready.lifecycle);
    vacuousReady.requirements = [];
    expect(() => validateCreationLifecycle(vacuousReady)).toThrow(/nonempty set/u);
  });
});
