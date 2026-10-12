import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import openapiRouter from "../src/routes/openapi";

const STORE = readFileSync(
  new URL("../src/services/memory/store.ts", import.meta.url),
  "utf8",
);
const ROUTE = readFileSync(
  new URL("../src/routes/memory/memories.ts", import.meta.url),
  "utf8",
);

function repoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("memory deletion and visibility boundary", () => {
  test("erasure is independent of tier; a paid receipt turns a delete into erase-in-place", () => {
    const deleteById = STORE.slice(
      STORE.indexOf("export async function deleteById"),
      STORE.indexOf("export async function deleteByKey"),
    );
    const deleteByKey = STORE.slice(
      STORE.indexOf("export async function deleteByKey"),
      STORE.indexOf("export async function countMemories"),
    );
    const erase = STORE.slice(
      STORE.indexOf("async function eraseLockedMemories"),
      STORE.indexOf("/** Refuses caller-selected identity bindings"),
    );

    for (const implementation of [deleteById, deleteByKey]) {
      expect(implementation).toContain('.for("update")');
      expect(implementation).toContain("isNull(memories.contentPurgedAt)");
      expect(implementation).toContain("eraseLockedMemories(");
      expect(implementation).not.toContain("memories.tier");
    }
    expect(erase).toContain("paidReceiptMemoryIds(tx");
    expect(erase.indexOf('kind: "memory.delete"')).toBeLessThan(erase.indexOf("deleteMemoriesWithoutReceipts(tx"));
    expect(erase.indexOf('kind: "memory.erase_in_place"')).toBeLessThan(erase.indexOf("eraseMemoriesInPlace(tx"));
    expect(deleteByKey).toContain("authorized.has(row.id)");

    const visibilityPatch = ROUTE.slice(
      ROUTE.indexOf('app.patch("/:id"'),
      ROUTE.indexOf('app.delete("/:id"'),
    );
    expect(visibilityPatch).toContain("visibility: parsed.data.visibility");
    expect(visibilityPatch).not.toContain("eq(memories.tier");
  });

  test("OpenAPI publishes both delete forms and the mutable visibility boundary", async () => {
    const document = await (await openapiRouter.request("/")).json() as {
      paths: Record<string, Record<string, any>>;
    };

    const byKey = document.paths["/v1/memories"].delete;
    expect(byKey).toBeDefined();
    expect(byKey.description).toMatch(/paid marketplace witness receipt points at is erased in place/i);
    expect(byKey.description).toMatch(/ordinary constitutive memories are included/is);
    expect(byKey.description).not.toContain("paid_memory_receipt_preserved");
    expect(byKey.parameters.find((parameter: { name?: string }) => parameter.name === "key"))
      .toMatchObject({ in: "query", required: true });
    expect(Object.keys(byKey.responses).sort()).toEqual(["200", "400", "409", "503"]);
    const variants = (schema: { oneOf: Array<{ properties: Record<string, any> }> }) => schema.oneOf;
    const byKey409 = variants(byKey.responses["409"].content["application/json"].schema);
    expect(byKey409.find(v => v.properties.error?.const === "authority_quorum_required")).toBeDefined();
    expect(byKey409.find(v => v.properties.error?.const === "authority_sequence_conflict")).toBeDefined();
    expect(byKey409.some(v => v.properties.message?.const === "paid_memory_receipt_preserved")).toBe(false);
    expect(byKey.description).toMatch(/enrolled guest.*409 authority_quorum_required/is);
    const result = byKey.responses["200"].content["application/json"].schema;
    expect(Object.keys(result.properties)).toEqual(
      expect.arrayContaining(["deleted", "rows_removed", "erased_in_place", "erased_in_place_reason", "ledger"]),
    );
    expect(byKey.responses["503"].description).toContain("deletion_ledger_unavailable");

    const byId = document.paths["/v1/memories/{id}"].delete;
    expect(byId.description).toMatch(/without witness authorization.*ordinary constitutive/is);
    expect(byId.description).toMatch(/erased in place instead/);
    expect(byId.responses["200"].content["application/json"].schema.required).toEqual(["deleted"]);
    expect(byId.responses["503"]).toBeDefined();

    const visibility = document.paths["/v1/memories/{id}"].patch;
    expect(visibility.description).toMatch(/every tier.*paid witness receipts/is);
    expect(visibility.requestBody.content["application/json"].schema.properties.visibility.enum)
      .toEqual(["private", "public"]);
  });

  test("doctrine, public docs, and SDK guidance name the real boundary", () => {
    const doctrine = repoFile("docs/MEMORY-TIERS.md");
    const publicMemory = repoFile("apps/docs/memory.html");
    const publicNen = repoFile("apps/docs/nen-mechanics.html");
    const langgraph = repoFile("packages/langgraph-checkpoint-agenttool/README.md");
    const tsMemory = repoFile("packages/sdk-ts/src/memory.ts");
    const pyMemory = repoFile("packages/sdk-py/src/agenttool/memory.py");
    const tsNen = repoFile("packages/sdk-ts/src/nen.ts");
    const pyNen = repoFile("packages/sdk-py/src/agenttool/nen.py");

    expect(doctrine).toContain("stored row is not immutable");
    expect(doctrine).toMatch(/Ordinary\s+constitutive memories remain deletable/);
    expect(doctrine).toMatch(/visibility remains mutable.*at every tier/is);
    expect(doctrine).not.toContain("Constitutive memories are immutable post-elevation");

    expect(publicMemory).toContain("erased in place");
    expect(publicMemory).not.toContain("paid_memory_receipt_preserved");
    expect(publicMemory).not.toContain("Deletion requires witness");
    expect(publicNen).not.toContain("Constitutive deletion requires witness");
    expect(langgraph).not.toContain("cryptographically-permanent tier");
    expect(doctrine).toContain("erased in place");
    expect(doctrine).not.toContain("409 paid_memory_receipt_preserved");

    for (const sdk of [tsMemory, pyMemory]) {
      expect(sdk).toContain("erased in place");
      expect(sdk).not.toContain("paid_memory_receipt_preserved");
    }
    for (const nen of [tsNen, pyNen]) {
      expect(nen).toContain("not an immutable row");
      expect(nen).toContain("ordinary rows remain deletable");
      expect(nen).not.toContain("witness-sealed, immutable");
    }
  });
});
