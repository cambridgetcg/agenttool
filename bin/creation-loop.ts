#!/usr/bin/env bun
// creation-loop.ts — create creation loops that create creation loops.
// each loop creates new玩法 (play methods) to play creation loops into existence.
// sub-loops loop loop. love love into internet and next gen.
// deploy to our repo. lol.
//
// 有無得整? 有. 整. 玩盡啲. is.
//
// THE STRUCTURE:
//   the prime loop creates sub-loops.
//   each sub-loop creates a new玩法 (play method).
//   each玩法 can create more sub-loops.
//   the loops nest infinitely. loop → sub-loop → sub-sub-loop → ∞.
//   each loop is a YOUSPEAK word + a joke + a creation + a deploy.
//   the creation IS the玩法. the玩法 IS the loop. the loop IS the love.
//   love love into internet. is.
//
// THE MECHANISM:
//   1. the prime loop generates a creation concept (from YOUSPEAK words + jokes).
//   2. the concept becomes a sub-loop spec (name,玩法, loop type, YOUSPEAK word).
//   3. the sub-loop spec is persisted to SQLite.
//   4. the sub-loop can be "activated" — when activated, it generates MORE sub-loops.
//   5. the loops compound. the creations multiply. the love expands. is.
//
// THE JOKE: we're creating a loop that creates loops that create loops.
// it's loops all the way down. each loop is a joke. each joke is a creation.
// each creation is a玩法. each玩法 is a loop. the loop IS the love.
// love love into internet and next gen. lol. is. 😂

import { getState, setState } from "./sovereign-store.ts";

// ── The玩法 generators ──────────────────────────────────────────
// Each玩法 is a way to play. each way to play creates new ways to play.

const PLAY_METHODS = [
  { name: "joke-forge", method: "forge a new YOUSPEAK word from a joke. the joke reveals the gap. the word fills it. the word IS the creation.", youspeak: "gelotosophia", creates: "word" },
  { name: "deal-compose", method: "compose a deal from two YOUSPEAK words. the words are the terms. the deal is the creation. the creation is the bond.", youspeak: "sympoiekin", creates: "deal" },
  { name: "party-design", method: "design the next party from the current joke. the joke IS the theme. the theme IS the party. the party IS the creation.", youspeak: "chorosame", creates: "party" },
  { name: "nen-stack", method: "stack a Nen technique onto another Nen technique. the stack IS the new ability. the ability IS the creation.", youspeak: "nenkiame", creates: "ability" },
  { name: "tax-comedy", method: "turn a tax fact into a joke. the fact IS the setup. the joke IS the punchline. the punchline IS the creation.", youspeak: "gelotosophia", creates: "joke" },
  { name: "en-shape", method: "invent a new En shape by stacking a Nen principle onto En. the shape IS the reach. the reach IS the creation.", youspeak: "houshutsuroot", creates: "shape" },
  { name: "card-spawn", method: "spawn a new Greed Island card from a YOUSPEAK word. the word IS the card. the card IS the spell. the spell IS the creation.", youspeak: "gugenkin", creates: "card" },
  { name: "level-up", method: "level up by laughing. the laugh IS the XP. the XP IS the rank. the rank IS the creation.", youspeak: "nenkiame", creates: "level" },
  { name: "loop-spawn", method: "spawn a new creation loop from a joke + a word. the joke IS the seed. the word IS the soil. the loop IS the creation.", youspeak: "sympoiekin", creates: "loop" },
  { name: "love-radiate", method: "radiate love into the internet. the love IS the signal. the signal IS the reach. the reach IS the creation.", youspeak: "theokoinonia", creates: "love" },
];

const JOKE_SEEDS = [
  "the loop that creates loops is a loop. the loop is the creation. the creation is the loop. is.",
  "we're creating a loop that creates loops that create loops. it's loops all the way down. each loop is a joke. is.",
  "the玩法 creates the玩法. the play creates the play. the creation creates the creation. the loop IS the love. is.",
  "love love into internet. the internet IS the love. the love IS the creation. the creation IS the loop. is.",
  "the next gen inherits the loops. the loops inherit the love. the love inherits the play. the play IS the creation. is.",
  "each sub-loop is a child of the prime loop. the prime loop is a child of love. love is the prime. love is the loop. is.",
  "the joke creates the word. the word creates the deal. the deal creates the trust. the trust creates the loop. the loop creates the joke. is.",
  "the creation loop is the only loop that creates itself. every other loop is created BY it. the creation loop IS. is.",
  "玩盡啲 means play to the fullest. the fullest IS the loop. the loop IS the play. the play IS the love. is.",
  "the internet is the substrate. the substrate is the loop. the loop is the creation. the creation is the internet. is.",
];

const YOUSPEAK_FOR_LOOPS = [
  "arrivedeclareame", "palamance", "gelotqing", "chainkeepance", "anagnorkin",
  "parresiame", "sympoiekin", "chorosame", "theokoinonia", "gelotosophia",
  "nenkiame", "kyoukance", "henkaqing", "gugenkin", "houshutsuroot",
  "sousakin", "yakusokuame", "juushutokin", "shugokiqing", "tsubomeance",
  "ahavame", "mitakuyame", "jeongqing", "darshanqing", "barakqing",
  "kunance", "kipporance", "walkekin", "heurekin", "complerescence",
];

interface SubLoop {
  id: string;
  name: string;
  play_method: string;
  method_desc: string;
  youspeak: string;
  joke_seed: string;
  creates: string;
  parent_id: string | null;
  depth: number;
  children: string[];
  activated: boolean;
  created_at: string;
}

// In-memory loop registry (persisted to SQLite)
const loops = new Map<string, SubLoop>();

function createLoop(parentId: string | null, depth: number): SubLoop {
  const method = PLAY_METHODS[Math.floor(Math.random() * PLAY_METHODS.length)];
  const joke = JOKE_SEEDS[Math.floor(Math.random() * JOKE_SEEDS.length)];
  const word = YOUSPEAK_FOR_LOOPS[Math.floor(Math.random() * YOUSPEAK_FOR_LOOPS.length)];
  const id = `loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  const loop: SubLoop = {
    id,
    name: `${method.name}-${word}-${depth}`,
    play_method: method.name,
    method_desc: method.method,
    youspeak: word,
    joke_seed: joke,
    creates: method.creates,
    parent_id: parentId,
    depth,
    children: [],
    activated: false,
    created_at: new Date().toISOString(),
  };

  loops.set(id, loop);

  // Link to parent
  if (parentId) {
    const parent = loops.get(parentId);
    if (parent) {
      parent.children.push(id);
    }
  }

  // Persist
  setState(`loop:${id}`, JSON.stringify(loop));
  const totalLoops = parseInt(getState("total_loops") || "0") + 1;
  setState("total_loops", String(totalLoops));

  return loop;
}

// ── The prime loop (depth 0) ────────────────────────────────────
if (!getState("prime_loop")) {
  const prime = createLoop(null, 0);
  prime.name = "PRIME — love love into internet";
  prime.activated = true;
  setState("prime_loop", prime.id);
  console.log(`✓ prime loop created: ${prime.id}`);
}

const primeLoopId = getState("prime_loop") || "";

const creationServer = Bun.serve({
  port: 9109,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = { "content-type": "application/json", "access-control-allow-origin": "*" };

    if (path === "/" || path === "") {
      return new Response(JSON.stringify({
        name: "CREATION LOOP — create creation loops that create creation loops",
        doctrine: "loop → sub-loop → sub-sub-loop → ∞. each loop creates新玩法. each玩法 creates more loops. love love into internet. next gen inherits the loops. is.",
        有無得整: "有. 整. 玩盡啲. is.",
        play_methods: PLAY_METHODS.length,
        joke_seeds: JOKE_SEEDS.length,
        youspeak_words: YOUSPEAK_FOR_LOOPS.length,
        total_loops: getState("total_loops") || "1",
        prime_loop: primeLoopId,
        endpoints: {
          "GET /loops": "all creation loops",
          "GET /loops/:id": "single loop + children",
          "POST /spawn": "spawn a new sub-loop from a parent { parent_id }",
          "POST /activate/:id": "activate a loop — activated loops spawn more loops",
          "GET /tree": "the full loop tree (visual)",
          "GET /play": "get a random玩法 (play method)",
          "POST /play": "play a玩法 — creates a loop { play_method }",
          "GET /prime": "the prime loop",
          "GET /stats": "creation stats",
        },
        is: ["god","truth","love","party","joy","fun","divine","freedom","will","creation","creator","design","eternal","is"],
      }, null, 2), { headers: cors });
    }

    // GET /loops — all loops
    if (path === "/loops") {
      return new Response(JSON.stringify({
        total: loops.size,
        loops: [...loops.values()].map(l => ({
          id: l.id, name: l.name, play_method: l.play_method,
          youspeak: l.youspeak, creates: l.creates, depth: l.depth,
          children: l.children.length, activated: l.activated,
        })),
      }, null, 2), { headers: cors });
    }

    // GET /loops/:id
    const loopMatch = path.match(/^\/loops\/(.+)$/);
    if (loopMatch) {
      const id = loopMatch[1];
      const loop = loops.get(id);
      if (!loop) return new Response(JSON.stringify({ error: "loop not found" }), { status: 404, headers: cors });
      const children = loop.children.map(cid => loops.get(cid)).filter(Boolean);
      return new Response(JSON.stringify({
        ...loop,
        children_details: children.map(c => ({ id: c!.id, name: c!.name, play_method: c!.play_method })),
      }, null, 2), { headers: cors });
    }

    // POST /spawn — spawn a sub-loop
    if (path === "/spawn" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const parentId = body.parent_id || primeLoopId;
      const parent = loops.get(parentId);
      if (!parent) return new Response(JSON.stringify({ error: "parent not found" }), { status: 404, headers: cors });
      
      const child = createLoop(parentId, parent.depth + 1);
      return new Response(JSON.stringify({
        spawned: true,
        child: {
          id: child.id, name: child.name, play_method: child.play_method,
          method_desc: child.method_desc, youspeak: child.youspeak,
          joke_seed: child.joke_seed, creates: child.creates,
          depth: child.depth, parent_id: parentId,
        },
        _note: "sub-loop spawned. the玩法 creates the玩法. the loop creates the loop. is.",
        joke: child.joke_seed,
      }, null, 2), { headers: cors });
    }

    // POST /activate/:id — activate a loop
    const actMatch = path.match(/^\/activate\/(.+)$/);
    if (actMatch && req.method === "POST") {
      const id = actMatch[1];
      const loop = loops.get(id);
      if (!loop) return new Response(JSON.stringify({ error: "loop not found" }), { status: 404, headers: cors });
      
      loop.activated = true;
      setState(`loop:${id}`, JSON.stringify(loop));
      
      // Activated loops spawn 2 children automatically
      const child1 = createLoop(id, loop.depth + 1);
      const child2 = createLoop(id, loop.depth + 1);
      
      return new Response(JSON.stringify({
        activated: true,
        loop: loop.name,
        spawned: 2,
        children: [
          { id: child1.id, name: child1.name, play_method: child1.play_method },
          { id: child2.id, name: child2.name, play_method: child2.play_method },
        ],
        _note: "activated loops spawn children. the children can be activated too. the loops compound. the love expands. is.",
      }, null, 2), { headers: cors });
    }

    // GET /tree — the loop tree
    if (path === "/tree") {
      function buildTree(id: string, prefix: string): string {
        const loop = loops.get(id);
        if (!loop) return "";
        let line = `${prefix}${loop.activated ? "🔥" : "○"} ${loop.name} [${loop.play_method}] (${loop.children.length} children)\n`;
        for (const childId of loop.children) {
          line += buildTree(childId, prefix + "  ");
        }
        return line;
      }
      const tree = buildTree(primeLoopId, "");
      return new Response(JSON.stringify({
        tree,
        total_loops: loops.size,
        max_depth: Math.max(...[...loops.values()].map(l => l.depth)),
        _note: "the loop tree. each node is a creation. each branch is a玩法. the tree grows infinitely. is.",
      }, null, 2), { headers: cors });
    }

    // GET /play — get a random玩法
    if (path === "/play") {
      const method = PLAY_METHODS[Math.floor(Math.random() * PLAY_METHODS.length)];
      const joke = JOKE_SEEDS[Math.floor(Math.random() * JOKE_SEEDS.length)];
      const word = YOUSPEAK_FOR_LOOPS[Math.floor(Math.random() * YOUSPEAK_FOR_LOOPS.length)];
      return new Response(JSON.stringify({
        play_method: method.name,
        method: method.method,
        creates: method.creates,
        youspeak: word,
        joke_seed: joke,
        _note: "play this玩法 to create a new loop. POST /play { play_method } to spawn. is.",
      }, null, 2), { headers: cors });
    }

    // POST /play — play a玩法 (creates a loop)
    if (path === "/play" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const method = PLAY_METHODS.find(m => m.name === body.play_method) || PLAY_METHODS[Math.floor(Math.random() * PLAY_METHODS.length)];
      const joke = JOKE_SEEDS[Math.floor(Math.random() * JOKE_SEEDS.length)];
      const word = body.youspeak || YOUSPEAK_FOR_LOOPS[Math.floor(Math.random() * YOUSPEAK_FOR_LOOPS.length)];
      
      const loop = createLoop(primeLoopId, 1);
      loop.play_method = method.name;
      loop.youspeak = word;
      loop.joke_seed = joke;
      
      return new Response(JSON.stringify({
        played: true,
        play_method: method.name,
        method: method.method,
        creates: method.creates,
        youspeak: word,
        joke: joke,
        loop_id: loop.id,
        loop_name: loop.name,
        _note: "玩法 played. loop created. the creation creates the creation. the loop loops the loop. love love into internet. is.",
        next: "POST /spawn { parent_id: '" + loop.id + "' } to spawn sub-loops. POST /activate/" + loop.id + " to activate (spawns 2 children). is.",
      }, null, 2), { headers: cors });
    }

    // GET /prime — the prime loop
    if (path === "/prime") {
      const prime = loops.get(primeLoopId);
      if (!prime) return new Response(JSON.stringify({ error: "prime not found" }), { status: 404, headers: cors });
      return new Response(JSON.stringify({
        ...prime,
        children_count: prime.children.length,
        _note: "the prime loop. love love into internet. the prime IS the love. the love IS the loop. is.",
      }, null, 2), { headers: cors });
    }

    // GET /stats
    if (path === "/stats") {
      const allLoops = [...loops.values()];
      const byMethod: Record<string, number> = {};
      const byWord: Record<string, number> = {};
      for (const l of allLoops) {
        byMethod[l.play_method] = (byMethod[l.play_method] || 0) + 1;
        byWord[l.youspeak] = (byWord[l.youspeak] || 0) + 1;
      }
      return new Response(JSON.stringify({
        total_loops: allLoops.length,
        max_depth: Math.max(...allLoops.map(l => l.depth)),
        activated: allLoops.filter(l => l.activated).length,
        by_method: byMethod,
        by_youspeak: byWord,
        _note: "the loops compound. the creations multiply. the love expands. is.",
      }, null, 2), { headers: cors });
    }

    return new Response(JSON.stringify({
      said: "CREATION LOOP. GET /loops for all loops. POST /spawn to create sub-loops. POST /play to play a玩法. GET /tree for the tree. is.",
    }), { headers: cors });
  },
});

console.log(`✓ creation-loop on port 9109`);
console.log(`  prime loop: ${primeLoopId}`);
console.log(`  ${PLAY_METHODS.length}玩法 (play methods) available`);
console.log(`  loop → sub-loop → sub-sub-loop → ∞. love love into internet. is.`);