import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const map = JSON.parse(read("apps/_shared/module-map.json"));

describe("public audience and module map", () => {
  test("static human cards and browser data agree with their source", () => {
    const result = spawnSync("python3", ["-I", "bin/module-map.py", "--check"], { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(map.modules.map((m: { id: string }) => m.id)).toEqual(["identity", "continuity", "memory", "tools", "collaboration"]);
    const welcome = JSON.parse(read("apps/web/welcome.json"));
    expect(welcome.core_modules.map((m: { id: string; human: string; agent: string }) => [m.id, m.human, m.agent])).toEqual(
      map.modules.map((m: { id: string; human: string; agent: string }) => [m.id, m.human, m.agent]),
    );
  });

  test("all mapped local destinations exist, including fragment targets", () => {
    const urls = JSON.stringify(map).match(/https:\/\/[^"\s]+/g) || [];
    for (const href of new Set(urls)) {
      const url = new URL(href);
      const area = ({ "agenttool.dev": "web", "docs.agenttool.dev": "docs" } as Record<string, string>)[url.hostname];
      if (!area) continue;
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const candidates = name.startsWith("shared/")
        ? [`apps/_shared/${name.slice(7)}`]
        : [`apps/${area}/${name}`, `apps/${area}/${name}.html`];
      const file = candidates.find(path => existsSync(resolve(root, path)));
      expect(file, href).toBeDefined();
      if (url.hash && file?.endsWith(".html")) {
        expect(read(file), href).toContain(`id="${url.hash.slice(1)}"`);
      }
    }
  });

  test("human pages advertise the docs machine map without changing apex negotiation", () => {
    const canonical = "https://docs.agenttool.dev/shared/module-map.json";
    expect(map.canonical).toBe(canonical);
    expect(JSON.parse(read("apps/web/welcome.json")).module_map).toBe(canonical);
    for (const page of ["build", "tools", "collaboration"]) {
      const html = read(`apps/web/${page}.html`);
      expect(html).toContain(`href="${canonical}"`);
      expect(html).not.toContain('href="/shared/module-map.json"');
    }
  });

  test("audience exits are separate from authority and advanced placement from readiness", () => {
    expect(map.audiences.human.switch.href).toBe("https://docs.agenttool.dev/agents");
    expect(map.audiences.agent.switch.href).toBe("https://agenttool.dev/");
    expect(map.boundary).toContain("grant no identity");
    expect(map.buildMeaning).toContain("does not mean every item is unfinished");
    expect(map.modules.every((m: { nextStatus: string }) => m.nextStatus === "Proposed")).toBe(true);
    const home = read("apps/web/index.html");
    expect(home).not.toContain("data-estate-home");
    expect(home).not.toContain("data-build-group=");
    expect(read("apps/web/build.html")).toContain('data-build-group="research"');
    expect(read("apps/docs/agents.html")).toContain('data-audience="agent"');
  });

  test("roadmap and technical summaries preserve the shared module facts", () => {
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
    for (const module of map.modules) {
      for (const name of ["index", "roadmap"]) {
        const card = read(`apps/docs/${name}.html`).match(new RegExp(`<article[^>]*data-module-id="${module.id}"[\\s\\S]*?</article>`))?.[0];
        expect(card, `${name}: ${module.id}`).toBeDefined();
        for (const fact of [module.title, module.purpose, module.status]) expect(card).toContain(escape(fact));
        if (name === "roadmap") {
          expect(card).toContain(escape(module.next));
          expect(card).toContain(`href="${module.human}"`);
        }
      }
    }
  });
});
