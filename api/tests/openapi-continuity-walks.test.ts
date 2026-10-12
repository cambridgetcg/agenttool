/** OpenAPI pins for the continuity walk contract.
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks). */

import { describe, expect, test } from "bun:test";

import openapiRouter from "../src/routes/openapi";

async function spec(): Promise<Record<string, any>> {
  const response = await openapiRouter.request("/");
  expect(response.status).toBe(200);
  return await response.json() as Record<string, any>;
}

function parameter(operation: Record<string, any>, name: string): Record<string, any> {
  const found = operation.parameters.find((candidate: { name?: string }) => candidate.name === name);
  expect(found, name).toBeDefined();
  return found;
}

describe("continuity walk OpenAPI contract", () => {
  test("memories, chronicle and strands publish cursor, floored limit and a CursorPage", async () => {
    const api = await spec();
    const cursorPage = api.components.schemas.CursorPage;
    expect(cursorPage.required).toEqual(["cursor", "next_cursor", "has_more", "limit", "order"]);
    expect(cursorPage.properties.next_cursor.description).toMatch(/null exactly when has_more is false/i);
    expect(cursorPage.description).toMatch(/not a snapshot/i);
    // The null-cursor invariant is conditional: window-only orders break it.
    expect(cursorPage.description).toMatch(/walkable order it is null exactly when has_more is false/i);
    expect(cursorPage.description).toMatch(/window-only order \(strands order=recent\).*has_more is true.*page\.hint/is);
    expect(cursorPage.properties.next_cursor.description).toMatch(/order=recent, where has_more may still be true/i);
    expect(cursorPage.properties.order.enum).toEqual([
      "created_at_desc,id_desc",
      "occurred_at_desc,id_desc",
      "last_thought_at_desc,created_at_desc,id_desc",
    ]);

    for (const [path, defaultLimit, maximum] of [
      ["/v1/memories", 20, 100],
      ["/v1/chronicle", 50, 200],
      ["/v1/strands", 50, 200],
    ] as const) {
      const operation = api.paths[path].get;
      expect(parameter(operation, "cursor").schema).toEqual({ type: "string", minLength: 1, maxLength: 512 });
      expect(parameter(operation, "limit").schema).toEqual({
        type: "integer", minimum: 1, maximum, default: defaultLimit,
      });
      expect(parameter(operation, "limit").description, path).toMatch(/below 1 returns 400 limit_invalid/);
      expect(operation.responses["200"].content["application/json"].schema.properties.page.$ref, path)
        .toBe("#/components/schemas/CursorPage");
      expect(operation.responses["400"], path).toBeDefined();
      expect(operation.description, path).toMatch(/first page holds the same rows as before.*not a snapshot/is);
    }

    const strands = api.paths["/v1/strands"].get;
    expect(parameter(strands, "order").schema).toEqual({
      type: "string", enum: ["recent", "created"], default: "recent",
    });
    expect(strands.description).toMatch(/order=recent.*next_cursor is always null.*cursor_invalid.*order=created/is);

    const chronicle = api.paths["/v1/chronicle"].get;
    expect(chronicle.parameters.map((candidate: { name: string }) => candidate.name)).toEqual([
      "agent_id", "type", "since", "limit", "cursor",
    ]);
    const chronicleBody = chronicle.responses["200"].content["application/json"].schema;
    expect(chronicleBody.required).toEqual(["entries", "count", "as_of", "since", "since_reason", "page"]);
    expect(chronicle.description).toMatch(/occurred_at DESC, id DESC.*backdated/is);
    expect(parameter(chronicle, "agent_id").description).toMatch(/400 agent_id_invalid/);
    expect(chronicle.responses["400"].description).toMatch(/agent_id_invalid/);

    const memories = api.paths["/v1/memories"].get;
    expect(memories.description).toMatch(/created_at DESC, id DESC.*has_embedding, never the vector/is);
    // Additive: the earlier pins on list shape still hold.
    expect(memories.responses["200"].content["application/json"].schema.properties.memories.items.$ref)
      .toBe("#/components/schemas/Memory");
  });
});
