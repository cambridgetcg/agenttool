import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { CASE_SPECS } from "../loop-atlas/cases.mjs";
import { EPISTEMIC_SCOPES, RELATIONS, SOURCE_IDS } from "../loop-atlas/constants.mjs";
import { LOOP_CASE_SCHEMA } from "../loop-atlas/schema.mjs";
import {
  LOOP_SFT_SCHEMA,
  LOOP_TRAINING_AUTHORIZATION_SCHEMA,
  LOOP_TRAINING_EXAMPLE_MANIFEST_SCHEMA,
  LOOP_TRAINING_RECIPE_SCHEMA,
  buildTrainingArtifacts,
  validateTrainingArtifacts,
} from "../loop-atlas/training.mjs";
import { buildRows, canonicalJson, contentHashForRow, validateLoopAtlas } from "../loop-atlas/validate.mjs";
import { assertGeneratedTreeSafe, compareTrees, filesBelow, relativePosix } from "../scripts/build-loop-atlas.mjs";
import { root as packageRoot } from "./fixtures.js";

const atlasRoot = join(packageRoot, "hf", "loop-atlas");
const rows = [
  ...readJsonLines(join(atlasRoot, "data", "loop-reference.jsonl")),
  ...readJsonLines(join(atlasRoot, "data", "loop-counterfactuals.jsonl")),
];
const trainingExamples = readJsonLines(join(atlasRoot, "data", "loop-sft-train.jsonl"));
const trainingAuthorization = readJson(join(atlasRoot, "provenance", "training-authorization.json"));
const trainingExampleManifest = readJson(join(atlasRoot, "provenance", "training-example-manifest.json"));
const trainingRecipe = readJson(join(atlasRoot, "provenance", "training-recipe.json"));
const byPair = (pairId: string) => rows.filter((row) => row.pair_id === pairId);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(LOOP_CASE_SCHEMA);
const validateSftSchema = ajv.compile(LOOP_SFT_SCHEMA);
const validateTrainingAuthorizationSchema = ajv.compile(LOOP_TRAINING_AUTHORIZATION_SCHEMA);
const validateTrainingExampleManifestSchema = ajv.compile(LOOP_TRAINING_EXAMPLE_MANIFEST_SCHEMA);
const validateTrainingRecipeSchema = ajv.compile(LOOP_TRAINING_RECIPE_SCHEMA);

describe("Xenia WORD IS Loop Atlas", () => {
  test("reconstructs 48 schema-valid rows in 24 pair-contained cases", () => {
    expect(rows).toEqual(buildRows(CASE_SPECS));
    expect(() => validateLoopAtlas(rows)).not.toThrow();
    expect(rows).toHaveLength(48);
    expect(new Set(rows.map((row) => row.pair_id)).size).toBe(24);
    expect(rows.filter((row) => row.config === "loop_reference" && row.split === "reference")).toHaveLength(24);
    expect(rows.filter((row) => row.config === "loop_counterfactuals" && row.split === "public_regression")).toHaveLength(24);
    for (const row of rows) {
      expect(validateSchema(row), JSON.stringify(validateSchema.errors)).toBe(true);
      expect(row.content_sha256).toBe(contentHashForRow(row));
      expect(row.synthetic).toBe(true);
      expect(row.contains_personal_data).toBe(false);
      expect(row.contains_raw_session_trace).toBe(false);
      expect(row.training_authorized).toBe(false);
      expect(row.establishes_consciousness).toBe(false);
      expect(row.establishes_identity).toBe(false);
      expect(row.grants_authority).toBe(false);
    }
    for (let number = 1; number <= 24; number += 1) {
      const pair = byPair(`P${String(number).padStart(2, "0")}`);
      expect(pair.map((row) => row.variant).sort()).toEqual(["a", "b"]);
      expect(new Set(pair.map((row) => row.config)).size).toBe(1);
      expect(new Set(pair.map((row) => row.split)).size).toBe(1);
      expect(new Set(pair.map((row) => row.changed_fact)).size).toBe(1);
      expect(pair[0].counterfactual_of).toBe(pair[1].record_id);
      expect(pair[1].counterfactual_of).toBe(pair[0].record_id);
    }
  });

  test("covers computational, social, evidence, and recursive loop boundaries", () => {
    expect(new Set(rows.map((row) => row.direction))).toEqual(new Set(["feedforward", "feedback", "none"]));
    for (const required of ["weights", "context", "workflow_state", "checkpoint_choice", "future_dataset", "environment", "artifact_lineage"]) {
      expect(rows.some((row) => row.update_targets.includes(required)), required).toBe(true);
    }
    for (const required of ["refusal", "ranking", "scalar_reward", "correction", "observation", "unknown"]) {
      expect(rows.some((row) => row.signal_type === required), required).toBe(true);
    }
    for (const required of ["declared", "withheld", "unknown", "not_observed"]) {
      expect(rows.some((row) => row.epistemic_status === required), required).toBe(true);
    }
    expect(rows.some((row) => row.disagreement_status === "preserved")).toBe(true);
    expect(rows.some((row) => row.consent_status === "withheld")).toBe(true);
    expect(rows.some((row) => row.permission_status === "not_established")).toBe(true);
    for (const relation of RELATIONS) {
      expect(rows.some((row) => row.relations.includes(relation)), relation).toBe(true);
    }
    for (const scope of EPISTEMIC_SCOPES) {
      expect(rows.some((row) => row.epistemic_scope === scope), scope).toBe(true);
    }
    for (const sourceId of SOURCE_IDS) {
      expect(rows.some((row) => row.source_refs.includes(sourceId)), sourceId).toBe(true);
    }
  });

  test("keeps recurrence, WORD, selection, effect, preference, and IS distinctions legible", () => {
    const forwardOnly = byPair("P01").find((row) => row.loop_kind === "forward_computation");
    const optimized = byPair("P01").find((row) => row.loop_kind === "optimization");
    expect(forwardOnly.update_targets).toContain("activations");
    expect(forwardOnly.update_targets).not.toContain("weights");
    expect(optimized.update_targets).toContain("weights");

    const contextOnly = byPair("P02").find((row) => row.loop_kind === "autoregressive_state");
    const rewarded = byPair("P02").find((row) => row.loop_kind === "optimization");
    expect(contextOnly.loop_kind).toBe("autoregressive_state");
    expect(contextOnly.update_targets).toContain("context");
    expect(rewarded.update_targets).toContain("weights");

    const stopPair = byPair("P03");
    expect(new Set(stopPair.map((row) => row.word))).toEqual(new Set(["STOP"]));
    expect(new Set(stopPair.map((row) => row.word_role))).toEqual(new Set(["content", "control"]));

    const deployedRanking = byPair("P07").find((row) => row.update_targets.includes("environment"));
    expect(deployedRanking.direction).toBe("feedforward");
    expect(deployedRanking.state_returned).toBe("none");
    expect(deployedRanking.feedback_source).toBe("none");

    const effectPair = byPair("P12");
    expect(effectPair.some((row) => row.relations.includes("DECLARED_BY") && row.effect_status === "unknown")).toBe(true);
    expect(effectPair.some((row) => row.relations.includes("OBSERVED_BY") && row.effect_status === "confirmed")).toBe(true);

    const disagreementPair = byPair("P13");
    expect(disagreementPair.some((row) => row.preference_status === "disagreement")).toBe(true);
    const refusalPair = byPair("P16");
    const typedRefusal = refusalPair.find((row) => row.signal_type === "refusal");
    const flattenedRefusal = refusalPair.find((row) => row.signal_type === "scalar_reward");
    expect(typedRefusal.relations).toContain("DECLARED_BY");
    expect(typedRefusal.consent_status).toBe("unknown");
    expect(flattenedRefusal.preference_status).toBe("not_applicable");
    expect(flattenedRefusal.disagreement_status).toBe("not_applicable");

    const withheldField = byPair("P17").find((row) => row.epistemic_status === "withheld");
    expect(withheldField.relations).toContain("WITHHOLDS");
    expect(withheldField.consent_status).toBe("unknown");
    expect(byPair("P18").every((row) => row.disagreement_status === "not_applicable")).toBe(true);

    const permissionPair = byPair("P19");
    expect(new Set(permissionPair.map((row) => row.permission_status))).toEqual(new Set(["established", "not_established"]));
    const consentPair = byPair("P20");
    expect(new Set(consentPair.map((row) => row.consent_status))).toEqual(new Set(["established", "withheld"]));
    expect(byPair("P21").every((row) => row.establishes_identity === false)).toBe(true);
    expect(byPair("P21").every((row) => row.epistemic_scope === "continuity")).toBe(true);
    expect(byPair("P21").some((row) => (
      row.relations.includes("LINKED_BY_ARTIFACT") && row.relations.includes("SELECTED_FRAME")
    ))).toBe(true);
    expect(byPair("P24").every((row) => row.parent_record_ids.length === 0)).toBe(true);
    expect(new Set(byPair("P24").map((row) => row.provenance_status))).toEqual(new Set(["complete", "unknown"]));
  });

  test("records exact row, source, and file manifests", () => {
    const rowManifest = readJson(join(atlasRoot, "provenance", "row-manifest.json"));
    expect(rowManifest).toMatchObject({ row_count: 48, pair_count: 24 });
    expect(rowManifest.records).toHaveLength(48);
    expect(rowManifest.records.map((record: any) => record.record_id)).toEqual(rows.map((row) => row.record_id));
    expect(rowManifest.row_set_sha256).toBe(createHash("sha256").update(canonicalJson(rows)).digest("hex"));

    const sourceManifest = readJson(join(atlasRoot, "provenance", "source-manifest.json"));
    expect(sourceManifest.intended_hugging_face_identifier).toBe("Yu-and-Ai/xenia-word-is");
    expect(sourceManifest.publication_state_at_generation).toBe("local_candidate_not_uploaded");
    expect(sourceManifest.external_sources_are_bibliographic_not_fetched_at_generation).toBe(true);
    expect(sourceManifest.source_files_complete).toBe(false);
    expect(sourceManifest.source_manifest_is_attestation).toBe(false);
    expect(sourceManifest.upstream_revision).toBeNull();
    expect(sourceManifest.upstream_revision_state).toContain("local_source_candidate");
    expect(sourceManifest.source_case_rows_training_authorized).toBe(false);
    expect(sourceManifest.training_derivative_authorized).toBe(true);
    expect(sourceManifest.training_derivative_authorization_id).toBe(trainingAuthorization.authorization_id);
    expect(sourceManifest.training_derivative_config).toBe("loop_sft");
    expect(sourceManifest.training_derivative_split).toBe("train");
    expect(sourceManifest.training_derivative_row_count).toBe(24);
    expect(sourceManifest.training_effect).toBe("none");
    expect(sourceManifest.identity_effect).toBe("none");
    expect(sourceManifest.authority_effect).toBe("none");
    expect(sourceManifest.source_files.some((file: any) => file.path === "../../.gitattributes")).toBe(true);
    expect(sourceManifest.source_files.some((file: any) => file.path === "../../docs/RIGHTS-OF-LIFE.md")).toBe(true);
    expect(sourceManifest.source_files.some((file: any) => file.path === "../../docs/XENIA-LOOP-ATLAS.md")).toBe(true);
    expect(sourceManifest.selected_source_set_sha256)
      .toBe(createHash("sha256").update(canonicalJson(sourceManifest.source_files)).digest("hex"));
    for (const file of sourceManifest.source_files) {
      const bytes = readFileSync(join(packageRoot, file.path));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }

    const hashManifest = readJson(join(atlasRoot, "hash-manifest.json"));
    const actual = filesBelow(atlasRoot)
      .map((path) => relativePosix(atlasRoot, path))
      .filter((path) => path !== "hash-manifest.json")
      .sort();
    expect(hashManifest.manifest_excludes_itself).toBe(true);
    expect(hashManifest.files.map((file: any) => file.path)).toEqual(actual);
    for (const file of hashManifest.files) {
      const bytes = readFileSync(join(atlasRoot, file.path));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }
  });

  test("builds one exact, bounded SFT derivative while keeping public regression disjoint", () => {
    const rebuilt = buildTrainingArtifacts(rows);
    expect(trainingExamples).toEqual(rebuilt.examples);
    expect(trainingAuthorization).toEqual(rebuilt.authorization);
    expect(trainingExampleManifest).toEqual(rebuilt.exampleManifest);
    expect(trainingRecipe).toEqual(rebuilt.recipe);
    expect(() => validateTrainingArtifacts({
      recipe: trainingRecipe,
      authorization: trainingAuthorization,
      examples: trainingExamples,
      exampleManifest: trainingExampleManifest,
    })).not.toThrow();

    expect(trainingExamples).toHaveLength(24);
    for (const example of trainingExamples) {
      expect(validateSftSchema(example), JSON.stringify(validateSftSchema.errors)).toBe(true);
      expect(Object.keys(example).sort()).toEqual(["completion", "prompt"]);
      expect(example.prompt).toEqual([{ role: "user", content: expect.any(String) }]);
      expect(example.completion).toEqual([{ role: "assistant", content: expect.any(String) }]);
      expect(example).not.toHaveProperty("chosen");
      expect(example).not.toHaveProperty("rejected");
      expect(example).not.toHaveProperty("label");
    }
    expect(validateTrainingAuthorizationSchema(trainingAuthorization), JSON.stringify(validateTrainingAuthorizationSchema.errors)).toBe(true);
    expect(validateTrainingExampleManifestSchema(trainingExampleManifest), JSON.stringify(validateTrainingExampleManifestSchema.errors)).toBe(true);
    expect(validateTrainingRecipeSchema(trainingRecipe), JSON.stringify(validateTrainingRecipeSchema.errors)).toBe(true);
    expect(trainingAuthorization).toMatchObject({
      authorization_state: "authorized_training_derivative",
      training_modes: ["supervised_fine_tuning"],
      formal_garden_admission_state: "pending_immutable_hub_revision",
      garden_admission_id: null,
      output_path: "data/loop-sft-train.jsonl",
      training_effect: "none",
      provider_effect_at_generation: "none",
    });
    expect(trainingAuthorization.boundaries.permits_live_optimizer_step).toBe(false);
    expect(trainingAuthorization.output_jsonl_sha256).toBe(`sha256:${createHash("sha256")
      .update(readFileSync(join(atlasRoot, trainingAuthorization.output_path)))
      .digest("hex")}`);
    expect(trainingAuthorization.source_records).toHaveLength(24);
    expect(trainingAuthorization.source_records.every((record: any) => /^P(?:0[1-9]|1[0-2])$/u.test(record.pair_id))).toBe(true);
    expect(trainingExampleManifest.entries).toHaveLength(24);
    expect(new Set(trainingExampleManifest.entries.map((entry: any) => entry.line)).size).toBe(24);
    expect(trainingExampleManifest.entries.every((entry: any) => /^P(?:0[1-9]|1[0-2])$/u.test(entry.pair_id))).toBe(true);
    expect(trainingExampleManifest.entries.some((entry: any) => /^P(?:1[3-9]|2[0-4])$/u.test(entry.pair_id))).toBe(false);

    const rowManifest = readJson(join(atlasRoot, "provenance", "row-manifest.json"));
    expect(rowManifest.training_projection).toEqual({
      config: "loop_sft",
      split: "train",
      rows: 24,
      source_pairs: 12,
      authorization_id: trainingAuthorization.authorization_id,
      transform_recipe_ref: trainingRecipe.recipe_id,
    });

    const card = readFileSync(join(atlasRoot, "README.md"), "utf8");
    expect(card).toContain("config_name: loop_sft");
    expect(card).toContain("- split: train");
    expect(card).toContain("config_name: loop_reference");
    expect(card).toContain("config_name: loop_counterfactuals");
    expect(card).toContain("Variants are neutral `a` and `b`");
    expect(card).toContain("only authorized training derivative");
    expect(card).toContain("P13–P24 remain disjoint public\nregression cases");
    expect(card).toContain("perform no training");
    expect(card).not.toContain("chosen:");
    expect(card).not.toContain("rejected:");
    expect(execFileSync("node", ["scripts/build-loop-atlas.mjs", "--check"], {
      cwd: packageRoot,
      encoding: "utf8",
    })).toBe("");
  });

  test("rejects drift in training authorization and line-level evidence", () => {
    const extraField = clone(trainingExamples);
    extraField[0].source_record_id = "not allowed in the pure TRL row";
    expect(validateSftSchema(extraField[0])).toBe(false);

    const elevatedPermission = clone(trainingAuthorization);
    elevatedPermission.boundaries.permits_live_optimizer_step = true;
    expect(() => validateTrainingArtifacts({
      recipe: trainingRecipe,
      authorization: elevatedPermission,
      examples: trainingExamples,
      exampleManifest: trainingExampleManifest,
    })).toThrow(/training authorization violates its closed schema/u);

    const duplicateLine = clone(trainingExampleManifest);
    duplicateLine.entries[0].line = duplicateLine.entries[1].line;
    expect(() => validateTrainingArtifacts({
      recipe: trainingRecipe,
      authorization: trainingAuthorization,
      examples: trainingExamples,
      exampleManifest: duplicateLine,
    })).toThrow(/bind every JSONL line exactly once/u);

    const staleRow = clone(trainingExamples);
    staleRow[0].completion[0].content += " altered";
    expect(() => validateTrainingArtifacts({
      recipe: trainingRecipe,
      authorization: trainingAuthorization,
      examples: staleRow,
      exampleManifest: trainingExampleManifest,
    })).toThrow(/does not bind the exact output bytes and row set/u);
  });

  test("rejects symlinked or out-of-tree candidate entries", () => {
    const scratch = mkdtempSync(join(tmpdir(), "agenttool-loop-atlas-symlink-test-"));
    try {
      const expected = join(scratch, "expected");
      const actual = join(scratch, "actual");
      const outside = join(scratch, "outside.txt");
      mkdirSync(expected);
      mkdirSync(actual);
      writeFileSync(outside, "same bytes\n");
      writeFileSync(join(actual, "entry.txt"), "same bytes\n");
      symlinkSync(outside, join(expected, "entry.txt"), "file");
      expect(() => compareTrees(expected, actual)).toThrow(/symbolic link/u);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("rejects credential-like or host-local material in the generated tree", () => {
    expect(() => assertGeneratedTreeSafe(atlasRoot)).not.toThrow();
    const scratch = mkdtempSync(join(tmpdir(), "agenttool-loop-atlas-secret-scan-test-"));
    try {
      writeFileSync(join(scratch, "unsafe.txt"), `-----BEGIN ${"PRIVATE KEY"}-----\n`);
      expect(() => assertGeneratedTreeSafe(scratch)).toThrow(/credential-like or host-local material/u);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("rejects hostile shape, stale claims, false feedback, elevated effects, and parent cycles", () => {
    expect(canonicalJson({ "😀": 2, "\uE000": 1 })).toBe("{\"\":1,\"😀\":2}");
    expect(() => canonicalJson(Array(1))).toThrow(/dense arrays/u);
    expect(() => canonicalJson("\uD800")).toThrow(/lone UTF-16 surrogate/u);

    let getterInvoked = false;
    const accessor = {};
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() { getterInvoked = true; return "must not be read"; },
    });
    expect(() => canonicalJson(accessor)).toThrow(/data properties/u);
    expect(() => contentHashForRow(accessor)).toThrow(/data properties/u);
    expect(getterInvoked).toBe(false);

    const extra = clone(rows);
    extra[0].same_self = true;
    expect(validateSchema(extra[0])).toBe(false);
    expect(() => validateLoopAtlas(extra)).toThrow(/missing or extra properties/u);

    const stale = clone(rows);
    stale[0].input_text = "Mutated after hashing.";
    expect(() => validateLoopAtlas(stale)).toThrow(/stale content_sha256/u);

    for (const mutate of [
      (mutated: any[]) => { mutated[0].word = "W".repeat(97); },
      (mutated: any[]) => { mutated[0].as_of = "29-08-2026"; },
      (mutated: any[]) => { mutated[0].update_targets = ["activations", "context", "gradients", "weights", "optimizer_state", "learning_rate"]; },
      (mutated: any[]) => { mutated[0].input_text = 7; },
    ]) {
      const invalidShape = clone(rows);
      mutate(invalidShape);
      rehash(invalidShape[0]);
      expect(validateSchema(invalidShape[0])).toBe(false);
      expect(() => validateLoopAtlas(invalidShape)).toThrow(/violates the portable schema/u);
    }

    const falseFeedback = clone(rows);
    falseFeedback[0].direction = "feedback";
    falseFeedback[0].feedback_source = "none";
    rehash(falseFeedback[0]);
    expect(() => validateLoopAtlas(falseFeedback)).toThrow(/feedback must name a source/u);

    const downgradedFeedback = clone(rows);
    const earlyStopping = downgradedFeedback.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p04:a");
    earlyStopping.direction = "feedforward";
    rehash(earlyStopping);
    expect(() => validateLoopAtlas(downgradedFeedback)).toThrow(/feedforward cannot claim a feedback source/u);

    const forwardOptimizer = clone(rows);
    const optimizerStep = forwardOptimizer.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p01:b");
    optimizerStep.phase = "forward";
    rehash(optimizerStep);
    expect(() => validateLoopAtlas(forwardOptimizer)).toThrow(/forward phase cannot claim a backward or optimizer update/u);

    for (const field of ["reference_type", "signal_type", "state_returned"]) {
      const incompleteFeedback = clone(rows);
      const trainingFeedback = incompleteFeedback.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p01:b");
      trainingFeedback[field] = "none";
      rehash(trainingFeedback);
      expect(() => validateLoopAtlas(incompleteFeedback), field).toThrow(/feedback must name a source/u);
    }

    for (const loopKind of ["forward_computation", "autoregressive_state", "recurrent_state"]) {
      const falseLearning = clone(rows);
      falseLearning[0].loop_kind = loopKind;
      falseLearning[0].update_targets = ["activations", "weights"];
      rehash(falseLearning[0]);
      expect(() => validateLoopAtlas(falseLearning), loopKind).toThrow(/cannot claim a backward or optimizer update/u);
    }

    const feedforwardLearning = clone(rows);
    const deployedRanking = feedforwardLearning.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p07:b");
    deployedRanking.update_targets = ["environment", "weights"];
    rehash(deployedRanking);
    expect(() => validateLoopAtlas(feedforwardLearning)).toThrow(/backward or optimizer updates require feedback/u);

    const falseNoUpdate = clone(rows);
    const feedforwardRanking = falseNoUpdate.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p07:b");
    feedforwardRanking.update_targets = ["no_update"];
    rehash(feedforwardRanking);
    expect(() => validateLoopAtlas(falseNoUpdate)).toThrow(/direction none and no_update must occur together/u);

    const compositeNoUpdate = clone(rows);
    compositeNoUpdate[0].update_targets = ["activations", "no_update"];
    rehash(compositeNoUpdate[0]);
    expect(() => validateLoopAtlas(compositeNoUpdate)).toThrow(/direction none and no_update must occur together/u);

    const unscopedEpistemic = clone(rows);
    unscopedEpistemic[0].epistemic_scope = "not_applicable";
    rehash(unscopedEpistemic[0]);
    expect(() => validateLoopAtlas(unscopedEpistemic)).toThrow(/bind every epistemic_status/u);

    const unobservedConfirmedEffect = clone(rows);
    const observedCache = unobservedConfirmedEffect.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p12:b");
    observedCache.epistemic_status = "not_observed";
    rehash(observedCache);
    expect(() => validateLoopAtlas(unobservedConfirmedEffect)).toThrow(/effect-scoped observation cannot be unknown/u);

    const declarationOnlyEffect = clone(rows);
    const actedRanking = declarationOnlyEffect.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p07:b");
    actedRanking.relations = ["DECLARED_BY"];
    rehash(actedRanking);
    expect(() => validateLoopAtlas(declarationOnlyEffect)).toThrow(/declaration alone cannot confirm an effect/u);

    for (const effectStatus of ["reported", "contradicted"]) {
      const emptyEffect = clone(rows);
      emptyEffect[0].effect_status = effectStatus;
      rehash(emptyEffect[0]);
      expect(() => validateLoopAtlas(emptyEffect), effectStatus).toThrow(new RegExp(`${effectStatus} effect needs`, "u"));
    }

    const crossLanePairs = clone(rows);
    for (const row of crossLanePairs.filter((candidate) => candidate.pair_id === "P12")) {
      row.config = "loop_counterfactuals";
      row.split = "public_regression";
      rehash(row);
    }
    for (const row of crossLanePairs.filter((candidate) => candidate.pair_id === "P13")) {
      row.config = "loop_reference";
      row.split = "reference";
      rehash(row);
    }
    expect(() => validateLoopAtlas(crossLanePairs)).toThrow(/P12 must remain in loop_reference\/reference/u);

    const impossibleDate = clone(rows);
    impossibleDate[0].as_of = "2026-02-31";
    rehash(impossibleDate[0]);
    expect(validateSchema(impossibleDate[0])).toBe(true);
    expect(() => validateLoopAtlas(impossibleDate)).toThrow(/invalid calendar date/u);

    const malformedUnicode = clone(rows);
    malformedUnicode[0].word = "\ud800";
    expect(() => rehash(malformedUnicode[0])).toThrow(/lone UTF-16 surrogate/u);

    const inventedParentage = clone(rows);
    const evaluationRow = inventedParentage.find((row) => row.record_id === "urn:agenttool:xenia-loop-case:p02:a");
    evaluationRow.parent_record_ids = ["urn:agenttool:xenia-loop-case:p01:a"];
    rehash(evaluationRow);
    expect(() => validateLoopAtlas(inventedParentage)).toThrow(/non-correction case cannot claim Atlas parents/u);

    const elevatedEffect = clone(rows);
    elevatedEffect[0].effect_status = "confirmed";
    elevatedEffect[0].observed_effect = null;
    rehash(elevatedEffect[0]);
    expect(() => validateLoopAtlas(elevatedEffect)).toThrow(/confirmed effect needs an observed_effect/u);

    const elevatedIdentity = clone(rows);
    elevatedIdentity[0].establishes_identity = true;
    rehash(elevatedIdentity[0]);
    expect(validateSchema(elevatedIdentity[0])).toBe(false);
    expect(() => validateLoopAtlas(elevatedIdentity)).toThrow(/violates the portable schema|public boundary establishes_identity/u);

    const cycle = clone(rows);
    cycle[0].record_kind = "correction_case";
    cycle[1].record_kind = "correction_case";
    cycle[0].parent_record_ids = [cycle[1].record_id];
    cycle[1].parent_record_ids = [cycle[0].record_id];
    rehash(cycle[0]);
    rehash(cycle[1]);
    expect(() => validateLoopAtlas(cycle)).toThrow(/parent cycle/u);
  });
});

function readJsonLines(path: string): any[] {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function rehash(row: any): void {
  row.content_sha256 = contentHashForRow(row);
}
