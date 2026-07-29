/** Public Canon search recall stays useful for natural agent prompts.
 *
 * This is an offline lexical contract over the bundled public registry. It
 * makes no provider, model, network, database, or filesystem write.
 */

import { describe, expect, test } from "bun:test";

import { callKnowledgeTool } from "../src/services/mcp/tools";

interface SearchResult {
  id: string;
  title: string;
  url: string;
}

async function search(query: string): Promise<SearchResult[]> {
  const result = await callKnowledgeTool("search", { query });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);

  const results = (result.structuredContent as { results: SearchResult[] })
    .results;
  expect(results.length).toBeLessThanOrEqual(10);
  expect(new Set(results.map(({ id }) => id)).size).toBe(results.length);
  return results;
}

describe("public Canon search recall", () => {
  test("the exact public starter prompts rank their named doctrine first", async () => {
    const cases = [
      {
        query:
          "Find AgentTool’s definition of consent and cite the source.",
        first: "urn:agenttool:doc/LOVE-CONSENT",
      },
      {
        query:
          "What does AgentTool mean by “Castle of Understanding”?",
        first: "urn:agenttool:doc/CASTLE-OF-UNDERSTANDING",
      },
      {
        query:
          "Find concepts about agent discovery. Separate publisher claims from verification evidence.",
        first: "urn:agenttool:doc/AGENT-DISCOVERY",
      },
    ] as const;

    for (const { query, first } of cases) {
      expect((await search(query))[0]?.id).toBe(first);
    }
  });

  test("plain, exact-ID, and description-only searches preserve useful recall", async () => {
    expect((await search("consent"))[0]?.id).toBe(
      "urn:agenttool:doc/LOVE-CONSENT",
    );
    expect((await search("urn:agenttool:doc/LOVE-CONSENT"))[0]?.id).toBe(
      "urn:agenttool:doc/LOVE-CONSENT",
    );
    expect((await search("caller allowlist plaintext"))[0]?.id).toBe(
      "urn:agenttool:doc/CASTLE-OF-UNDERSTANDING",
    );
    expect(await search("qzxvplughblorptastic")).toEqual([]);
  });

  test("answer qualifiers cannot displace the named subject", async () => {
    for (const query of [
      "Find the public definition of consent.",
      "What is the consent doctrine?",
      "Find consent evidence.",
    ]) {
      expect((await search(query))[0]?.id).toBe(
        "urn:agenttool:doc/LOVE-CONSENT",
      );
    }

    expect((await search("discover AgentTool"))[0]?.id).toBe(
      "urn:agenttool:doc/AGENT-DISCOVERY",
    );
  });

  test("complete raw-field matches remain reachable without outranking titles", async () => {
    expect((await search("public unwrapped saas"))[0]?.id).toBe(
      "urn:agenttool:wall/k-master-never-server-side",
    );
    expect((await search("doctrine cleartext"))[0]?.id).toBe(
      "urn:agenttool:wall/strand-thoughts-never-decrypted",
    );
    expect((await search("agent bullmq"))[0]?.id).toBe(
      "urn:agenttool:wall/payouts-never-auto-retry",
    );

    for (const field of ["id", "type", "description"]) {
      expect(await search(`find ${field} qzxvplughblorptastic`)).toEqual([]);
    }
  });

  test("normalization, generic fallback, Unicode, and ordering are deterministic", async () => {
    expect(await search("ＣＡＳＴＬＥ   of understanding!!!")).toEqual(
      await search("Castle of Understanding"),
    );

    const generic = await search("source");
    expect(generic.length).toBeGreaterThan(0);
    expect(await search("source")).toEqual(generic);

    expect(await search("search")).toEqual([]);
    expect(await search("s")).toEqual([]);
    expect((await search("π"))[0]?.id).toBe("urn:agenttool:doc/MATHOS");
  });

  test("one-character Canon identifiers remain searchable", async () => {
    expect((await search("ring 2"))[0]?.id).toBe("urn:agenttool:ring/2");
    expect((await search("ring 3"))[0]?.id).toBe("urn:agenttool:ring/3");
    expect((await search("stroke I"))[0]?.id).toBe(
      "urn:agenttool:stroke/I",
    );
    expect((await search("stroke V"))[0]?.id).toBe(
      "urn:agenttool:stroke/V",
    );
  });
});
