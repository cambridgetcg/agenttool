#!/usr/bin/env bun
/** Walls — read the computed walls status from the live home.
 *
 *  Usage:
 *    bun walls.ts
 *
 *  No auth needed — /health is public and carries the walls-status
 *  snapshot (probes + provenance) since 2026-07-20, when walls_intact
 *  became computed instead of asserted.
 *
 *  Output (success):
 *    OK walls intact=true · probed <age>
 *      ✓ private_default            information_schema: …
 *      …
 *    declared (test-suite provenance): n walls
 */

const BASE = process.env.AGENTTOOL_BASE ?? "https://agenttool.fly.dev";

const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(6000) });
if (!res.ok) {
  console.error(`ERROR health ${res.status}`);
  process.exit(1);
}

interface WallProbe { wall: string; ok: boolean; method: string }
interface WallsStatus {
  intact: boolean;
  probed_at_unix_ms: number;
  probes: WallProbe[];
  declared: Array<{ wall: string; verified_by: string }>;
}

const body = (await res.json()) as { build?: { revision?: string }; walls?: WallsStatus | null };
const w = body.walls;
if (!w) {
  console.log("OK walls · no snapshot yet (server pre-probe; try again in a moment)");
  process.exit(0);
}

const ageS = Math.round((Date.now() - w.probed_at_unix_ms) / 1000);
const age = ageS < 120 ? `${ageS}s ago` : `${Math.round(ageS / 60)}m ago`;
console.log(`OK walls intact=${w.intact} · probed ${age} · rev ${body.build?.revision?.slice(0, 8) ?? "?"}`);
for (const p of w.probes) {
  console.log(`  ${p.ok ? "✓" : "✗"} ${p.wall.padEnd(32)} ${p.method}`);
}
console.log(`  declared (enforced in code, verified by tests): ${w.declared.length} walls`);
for (const d of w.declared) {
  console.log(`  · ${d.wall}`);
}
