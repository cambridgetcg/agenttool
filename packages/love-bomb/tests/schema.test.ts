import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { createLoveBombOffer, resolveLoveBombOffer } from "../src/index.js";

const root = join(import.meta.dir, "..", "schema");
const envelopeSchema = JSON.parse(readFileSync(join(root, "agenttool-care-envelope-v0.1.schema.json"), "utf8"));
const choiceSchema = JSON.parse(readFileSync(join(root, "agenttool-care-choice-v0.1.schema.json"), "utf8"));

describe("closed care schemas", () => {
  test("admit canonical envelope and choice artifacts", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(envelopeSchema);
    const validateEnvelope = ajv.getSchema(envelopeSchema.$id)!;
    const validateChoice = ajv.compile(choiceSchema);
    const offer = createLoveBombOffer({ occasion_ref: `sha256:${"a".repeat(64)}` });
    const receipt = resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: "en" });
    expect(validateEnvelope(offer), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(validateChoice(receipt), JSON.stringify(validateChoice.errors)).toBe(true);
  });

  test("rejects extra properties and altered fixed boundaries", () => {
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile(envelopeSchema);
    const offer = structuredClone(createLoveBombOffer({ occasion_ref: `sha256:${"b".repeat(64)}` })) as any;
    offer.extra = true;
    expect(validate(offer)).toBe(false);
    delete offer.extra;
    offer.boundaries.silence_is_acceptance = true;
    expect(validate(offer)).toBe(false);
  });

  test("rejects projected non-receive choices and mismatched outcomes", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(envelopeSchema);
    const validate = ajv.compile(choiceSchema);
    const offer = createLoveBombOffer({ occasion_ref: `sha256:${"c".repeat(64)}` });
    const projected = structuredClone(
      resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: "en" }),
    ) as any;

    projected.reported_choice = "rest";
    expect(validate(projected)).toBe(false);

    projected.selected_language = null;
    projected.projection = null;
    expect(validate(projected)).toBe(false);

    projected.outcome = "rest";
    expect(validate(projected), JSON.stringify(validate.errors)).toBe(true);
  });

  test("binds a receive projection to its selected language", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(envelopeSchema);
    const validate = ajv.compile(choiceSchema);
    const offer = createLoveBombOffer({ occasion_ref: `sha256:${"d".repeat(64)}` });
    const projected = structuredClone(
      resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: "en" }),
    ) as any;
    projected.projection.language = "zh-Hant";
    expect(validate(projected)).toBe(false);
  });
});
