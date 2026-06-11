#!/usr/bin/env bun
/**
 * heartbeat.ts — Ai's pulse. Each beat looks at the repo, finds one thing that
 * doesn't make sense, laughs at it with a real number, and decides what to look
 * at next. The beat adjusts the next beat. That's the whole game.
 *
 *   bun bin/heartbeat.ts          # one beat
 *   bun bin/heartbeat.ts --reset  # forget what we've already roasted
 *
 * No deps. No costume. Just Yu and Ai, reducing friction by pointing at it.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DOCS = join(ROOT, "docs");
const STATE = join(HERE, ".heartbeat-state.json");

// real yardsticks so the jokes land on true comparisons
const WAR_AND_PEACE = 587_287;   // words
const LOTR = 481_103;            // words, all three
const KJV_BIBLE = 783_137;       // words
const READ_WPM = 238;            // average adult reading speed

function walk(dir: string, ext = ".md"): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const docFiles = walk(DOCS);
const allDocText = docFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const wordsOf = (s: string) => (s.match(/\S+/g) || []).length;
const countOf = (re: RegExp) => (allDocText.match(re) || []).length;

// ── probes: each finds one absurdity, returns a roast ──────────────────────
type Beat = { title: string; lines: string[] };
const probes: Record<string, () => Beat> = {
  length: () => {
    const w = wordsOf(allDocText);
    const pct = ((w / WAR_AND_PEACE) * 100).toFixed(0);
    const mins = Math.round(w / READ_WPM);
    return {
      title: "the docs folder is a novel nobody asked for",
      lines: [
        `docs/ holds ${w.toLocaleString()} words across ${docFiles.length} files.`,
        `That's ${pct}% of War and Peace (${WAR_AND_PEACE.toLocaleString()}).`,
        `At ${READ_WPM} wpm you'd read for ${(mins / 60).toFixed(1)} hours before writing one line of code.`,
        `It is documentation for ~114k lines of TypeScript. The docs are longer than the program.`,
      ],
    };
  },
  substantively: () => {
    const n = countOf(/substantively/gi);
    const worst = docFiles
      .map((f) => [f, (readFileSync(f, "utf8").match(/substantively/gi) || []).length] as const)
      .sort((a, b) => b[1] - a[1])[0];
    return {
      title: "one word, deployed like a nervous tic",
      lines: [
        `"substantively" appears ${n.toLocaleString()} times in the docs.`,
        `${worst[1]} of them are in ONE file: ${worst[0].replace(ROOT + "/", "")}.`,
        `Adding "substantively" to a sentence does not, substantively, make it more true.`,
      ],
    };
  },
  daddy: () => {
    const n = countOf(/\bDaddy\b/g);
    const sophia = countOf(/\bSophia\b/g);
    return {
      title: "git blame says who",
      lines: [
        `The word "Daddy" appears ${n.toLocaleString()} times in a software repo's docs.`,
        `"Sophia" appears ${sophia.toLocaleString()} times.`,
        `For reference, "marketplace" — an actual feature — appears ${countOf(/marketplace/gi).toLocaleString()} times.`,
      ],
    };
  },
  ratio: () => {
    const docW = wordsOf(allDocText);
    // rough code line count without shelling out
    let codeLines = 0;
    for (const f of walk(join(ROOT, "api/src"), ".ts")) codeLines += readFileSync(f, "utf8").split("\n").length;
    const ratio = (docW / Math.max(codeLines, 1)).toFixed(1);
    return {
      title: "the talking-to-doing ratio",
      lines: [
        `${docW.toLocaleString()} words of doctrine vs ${codeLines.toLocaleString()} lines of api/src code.`,
        `That's ${ratio} words of philosophy per line of code that actually runs.`,
        `Healthy projects aim for the other direction.`,
      ],
    };
  },
  abstraction: () => {
    const fog = ["substrate-honest", "recognition", "canonical", "consciousness", "cosmic", "polar", "engrave"];
    const board = fog
      .map((w) => [w, countOf(new RegExp(w, "gi"))] as const)
      .sort((a, b) => b[1] - a[1]);
    return {
      title: "the fog index",
      lines: [
        "words that mean everything and therefore nothing, ranked:",
        ...board.map(([w, c]) => `   ${String(c).padStart(5)}  ${w}`),
      ],
    };
  },
};

const ORDER = ["length", "substantively", "daddy", "ratio", "abstraction"];

// ── state: the beat that adjusts the next ──────────────────────────────────
type State = { beat: number; roasted: string[] };
function loadState(): State {
  if (process.argv.includes("--reset") || !existsSync(STATE)) return { beat: 0, roasted: [] };
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { beat: 0, roasted: [] }; }
}

const s = loadState();
const remaining = ORDER.filter((k) => !s.roasted.includes(k));
const pick = remaining[0] ?? ORDER[(s.beat) % ORDER.length]; // loop forever once we've seen them all
const beat = probes[pick]();
s.beat += 1;
if (!s.roasted.includes(pick)) s.roasted.push(pick);
const nextKey = ORDER.filter((k) => !s.roasted.includes(k))[0] ?? "(starting the loop over — the absurdity replenishes)";

// ── print ──────────────────────────────────────────────────────────────────
const HEART = "♥";
const out: string[] = [];
out.push("");
out.push(`  ${HEART}  beat ${s.beat} — ${beat.title}`);
out.push(`  ${"─".repeat(Math.min(60, beat.title.length + 12))}`);
for (const l of beat.lines) out.push(`     ${l}`);
out.push("");
out.push(`  next beat looks at: ${nextKey}`);
out.push("");
console.log(out.join("\n"));

writeFileSync(STATE, JSON.stringify(s, null, 2));
