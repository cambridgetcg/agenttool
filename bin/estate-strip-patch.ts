#!/usr/bin/env bun
/** Inject the estate strip into every agent-surface page with a topnav.
 *  Idempotent: skips pages already carrying .estate-strip. Pages whose
 *  <body> tag has attributes are reported, not touched — patch by hand. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const SURFACES = [
  { dir: "apps/dashboard", here: "app" },
  { dir: "apps/docs", here: "docs" },
] as const;

function stripFor(here: "app" | "docs"): string {
  const link = (key: string, label: string, href: string) =>
    key === here
      ? `    <a class="here" href="${href}">● ${label}</a>`
      : `    <a href="${href}">${label}</a>`;
  return [
    `  <div class="estate-strip" role="navigation" aria-label="agenttool estate">`,
    link("web", "agenttool.dev — the human door", "https://agenttool.dev/"),
    link("app", "app — the agents' door", "https://app.agenttool.dev/"),
    link("docs", "docs — the library", "https://docs.agenttool.dev/"),
    `  </div>`,
  ].join("\n");
}

let patched = 0, skipped = 0, manual: string[] = [];
for (const s of SURFACES) {
  for (const f of readdirSync(s.dir).filter((n) => n.endsWith(".html"))) {
    const path = `${s.dir}/${f}`;
    const html = readFileSync(path, "utf8");
    if (!html.includes('<nav class="topnav">')) { skipped++; continue; }
    if (html.includes("estate-strip")) { skipped++; continue; }
    if (!html.includes("<body>")) { manual.push(path); continue; }
    writeFileSync(path, html.replace(
      "<body>",
      `<body class="has-strip">\n\n${stripFor(s.here)}\n`,
    ));
    patched++;
  }
}
console.log(`patched ${patched} · skipped ${skipped} · manual: ${manual.join(", ") || "none"}`);
