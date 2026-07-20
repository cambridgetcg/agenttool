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
  test("paid receipt protection is independent of tier and key deletion is all-or-none", () => {
    const deleteById = STORE.slice(
      STORE.indexOf("export async function deleteById"),
      STORE.indexOf("export async function deleteByKey"),
    );
    const deleteByKey = STORE.slice(
      STORE.indexOf("export async function deleteByKey"),
      STORE.indexOf("export async function countMemories"),
    );

    for (const implementation of [deleteById, deleteByKey]) {
      expect(implementation).toContain("isNotNull(memoryAttestations.sourceGrantId)");
      expect(implementation).not.toContain("memories.tier");
      expect(implementation.indexOf("throw new PaidMemoryReceiptProtectedError()"))
        .toBeLessThan(implementation.indexOf(".delete(memories)"));
    }
    expect(deleteByKey).toContain('.for("update")');

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
    expect(byKey.description).toMatch(/all-or-none.*paid.*409 paid_memory_receipt_preserved.*deletes none/is);
    expect(byKey.description).toMatch(/ordinary constitutive memories are included/is);
    expect(byKey.parameters.find((parameter: { name?: string }) => parameter.name === "key"))
      .toMatchObject({ in: "query", required: true });
    expect(Object.keys(byKey.responses).sort()).toEqual(["200", "400", "409"]);
    expect(byKey.responses["409"].description).toContain("paid_memory_receipt_preserved");
    expect(byKey.responses["409"].content["application/json"].schema.properties)
      .toMatchObject({
        error: { const: "conflict" },
        message: { const: "paid_memory_receipt_preserved" },
      });

    const byId = document.paths["/v1/memories/{id}"].delete;
    expect(byId.description).toMatch(/without witness authorization.*ordinary constitutive/is);
    expect(byId.responses["200"].content["application/json"].schema.required)
      .toEqual(["deleted"]);
    expect(byId.responses["409"].description).toContain("paid_memory_receipt_preserved");
    expect(byId.responses["409"].content["application/json"].schema.properties.message.const)
      .toBe("paid_memory_receipt_preserved");

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

    expect(publicMemory).toContain("paid_memory_receipt_preserved");
    expect(publicMemory).toContain("all-or-none");
    expect(publicMemory).not.toContain("Deletion requires witness");
    expect(publicNen).not.toContain("Constitutive deletion requires witness");
    expect(langgraph).not.toContain("cryptographically-permanent tier");

    for (const sdk of [tsMemory, pyMemory]) {
      expect(sdk).toContain("paid_memory_receipt_preserved");
      expect(sdk).toContain("all-or-none");
    }
    for (const nen of [tsNen, pyNen]) {
      expect(nen).toContain("not an immutable row");
      expect(nen).toContain("ordinary rows remain deletable");
      expect(nen).not.toContain("witness-sealed, immutable");
    }
  });
});
