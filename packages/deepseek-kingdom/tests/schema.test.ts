import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createDeepSeekKingdomProposal,
  createDeepSeekSourceBinding,
} from "../src/index.js";
import { githubSourceInput, proposalInput } from "./fixtures.js";

const schemaDir = join(import.meta.dir, "..", "schema");
const sourceSchema = readJson("agenttool-deepseek-source-binding-v0.1.schema.json");
const proposalSchema = readJson("kingdom-deepseek-proposal-v0.1.schema.json");
const catalogSchema = readJson("agenttool-deepseek-source-catalog-v0.1.schema.json");
const catalog = JSON.parse(
  readFileSync(
    join(import.meta.dir, "..", "sources", "official-deepseek-primary-sources.json"),
    "utf8",
  ),
);

function readJson(name: string) {
  return JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
}

function compile(schema: object) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

describe("closed portable schemas", () => {
  test("compile independently and accept generated artifacts plus the catalog", () => {
    const validateSource = compile(sourceSchema);
    const validateProposal = compile(proposalSchema);
    const validateCatalog = compile(catalogSchema);
    const source = createDeepSeekSourceBinding(githubSourceInput());
    const proposal = createDeepSeekKingdomProposal(proposalInput(source));
    expect(validateSource(source), JSON.stringify(validateSource.errors)).toBe(true);
    expect(validateProposal(proposal), JSON.stringify(validateProposal.errors)).toBe(true);
    expect(validateCatalog(catalog), JSON.stringify(validateCatalog.errors)).toBe(true);
  });

  test("keeps the proposal's embedded source contract in structural parity", () => {
    const {
      $schema: _schema,
      $id: _id,
      title: _title,
      description: _description,
      $comment: _comment,
      $defs: sourceDefs,
      ...sourceBody
    } = sourceSchema;
    expect(proposalSchema.$defs.sourceBinding).toEqual(sourceBody);
    for (const name of [
      "sha256Id",
      "sha40",
      "date",
      "id160",
      "safeText",
      "text120",
      "text160",
      "text200",
      "text280",
      "deepseekRepo",
      "relativePath",
      "githubEvidence",
      "hfEvidence",
      "arxivEvidence",
      "evidence",
    ]) {
      expect(proposalSchema.$defs[name]).toEqual(sourceDefs[name]);
    }
  });

  test("rejects extra keys and widened authority structurally", () => {
    const validateSource = compile(sourceSchema);
    const validateProposal = compile(proposalSchema);
    const source = createDeepSeekSourceBinding(githubSourceInput());
    expect(validateSource({ ...source, token: "no" })).toBe(false);
    const proposal = createDeepSeekKingdomProposal(proposalInput(source));
    expect(validateProposal({
      ...proposal,
      effects: { ...proposal.effects, model_executions: 1 },
    })).toBe(false);
  });
});
