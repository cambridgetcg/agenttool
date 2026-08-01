import {
  assertSkillsYutabaseInput,
  planSkillsInspection,
  type SkillsYutabaseInput,
} from "../src/index.js";

declare let candidate: unknown;

assertSkillsYutabaseInput(candidate);
const narrowed: SkillsYutabaseInput = candidate;
planSkillsInspection(narrowed, { claimant: "urn:agenttool:type-contract" });
