import { readFileSync } from "node:fs";

import {
  MATH_CARD_ASSESSMENT_SCHEMA,
  MATH_CARD_SCHEMA,
  PACKAGE_VERSION,
  assessMathCard,
  canonicalJson,
  sha256Id,
  validateMathCard,
} from "../dist/index.js";

const vectors = JSON.parse(readFileSync(
  new URL("../vectors/agenttool-math-cards-v0.1.json", import.meta.url),
  "utf8",
));
const card = validateMathCard(vectors.cases.ready_proof.card);
const assessment = assessMathCard(card);

if (
  PACKAGE_VERSION !== "0.1.0-dev.1"
  || MATH_CARD_SCHEMA !== "agenttool.math-card/0.1"
  || MATH_CARD_ASSESSMENT_SCHEMA !== "agenttool.math-card-assessment/0.1"
  || assessment.status !== "ready_for_bounded_inquiry"
  || assessment.card_id !== card.card_id
  || !Object.isFrozen(card)
  || canonicalJson({ b: 2, a: 1 }) !== '{"a":1,"b":2}'
  || sha256Id("math-cards-smoke") !== sha256Id("math-cards-smoke")
) {
  throw new Error("Math Cards runtime smoke failed");
}
