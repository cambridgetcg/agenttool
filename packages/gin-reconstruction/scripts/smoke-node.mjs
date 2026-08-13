import { readFile } from "node:fs/promises";

import {
  assessGinChallenge,
  reconstructGin,
  validateGinChallenge,
  validateGinReconstructionReceipt,
} from "../dist/index.js";

const vectors = JSON.parse(await readFile(new URL("../vectors/gin-reconstruction-v0.1.json", import.meta.url), "utf8"));
const unique = vectors.cases.unique;
const receipt = validateGinReconstructionReceipt(unique.receipt, unique.request);
const recomputed = reconstructGin(unique.request);
const challenge = validateGinChallenge(vectors.challenge.artifact);
const assessment = assessGinChallenge(challenge);

if (
  receipt.receipt_id !== recomputed.receipt_id
  || receipt.outcome.status !== "unique_model_candidate"
  || assessment.compass_status !== "constructive_questions_answered"
  || assessment.inner_motive !== "not_inferred"
) process.exit(1);
