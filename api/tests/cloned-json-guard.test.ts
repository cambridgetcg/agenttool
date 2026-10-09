import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseClonedJson } from "../src/lib/cloned-json";

const SRC = join(import.meta.dir, "..", "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("cloned JSON bodies are parsed through text()", () => {
  test("api/src has no .clone().json() call sites (Bun 1.3.x leaks ~1x body per call)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = withoutComments(readFileSync(file, "utf8"));
      const name = relative(SRC, file);
      if (/\.clone\(\)\s*\.json\s*\(/.test(code)) offenders.push(`${name}: .clone().json()`);
      for (const match of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;]*\.clone\(\)\s*;/g)) {
        if (new RegExp(`\\b${match[1]}\\s*\\.json\\s*\\(`).test(code)) {
          offenders.push(`${name}: ${match[1]}.json() on a clone`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("parseClonedJson parses UTF-8 bodies and leaves the original readable", async () => {
    const response = new Response(JSON.stringify({ note: "café — welcome" }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    expect(await parseClonedJson(response)).toEqual({ note: "café — welcome" });
    expect(await response.json()).toEqual({ note: "café — welcome" });

    const request = new Request("http://localhost/", { method: "POST", body: '{"n":1}' });
    expect(await parseClonedJson(request)).toEqual({ n: 1 });
    expect(await request.text()).toBe('{"n":1}');
  });

  test("parseClonedJson keeps Response.json() failure and BOM semantics", async () => {
    await expect(parseClonedJson(new Response(""))).rejects.toThrow(SyntaxError);
    await expect(parseClonedJson(new Response("not json"))).rejects.toThrow(SyntaxError);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":"é"}')]);
    expect(await parseClonedJson(new Response(bom))).toEqual(await new Response(bom).json());
  });
});
