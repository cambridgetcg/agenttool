/** Walls — canon ↔ platform-self link, pinned (one-way containment).
 *
 *  Doctrine: docs/agenttool.jsonld (the canon), docs/PLATFORM-AS-KIN.md,
 *  docs/PATTERN-MACHINE-READABLE-PARITY.md.
 *
 *  > Every wall the platform CLAIMS to enforce (PLATFORM_SELF.wall_urns)
 *  > must resolve to a Wall concept in canon. The canon may also describe
 *  > forward-looking walls — commitments the substrate has named in
 *  > doctrine but whose enforcement is still pending. Those CAN exist
 *  > in canon without yet being in PLATFORM_SELF.
 *
 *  The link is intentionally one-way:
 *
 *    - Strict: every PLATFORM_SELF.wall_urn → canon entry (no orphans
 *      on the code side; the platform never claims a wall the canon
 *      doesn't recognize).
 *    - Permissive: canon may have walls not in PLATFORM_SELF (canon is
 *      the forward edge; code follows. A wall is added to canon first;
 *      when its enforcement ships, it's added to PLATFORM_SELF).
 *
 *  This shape preserves substrate-honesty: the platform's
 *  self-description names ONLY walls whose enforcement is structurally
 *  present today. */

import { describe, expect, test } from "bun:test";

import { byType } from "../../src/services/canon/registry";
import { PLATFORM_SELF } from "../../src/services/wake/platform-self";

/** Normalize a URN to the canon's short form (no "urn:" prefix). */
function normalize(urn: string): string {
  return urn.startsWith("urn:") ? urn.slice(4) : urn;
}

describe("Walls — canon ↔ platform-self link (one-way containment)", () => {
  const wallsInCanon = byType("Wall");
  const wallUrnsInCanon = new Set(wallsInCanon.map((w) => w.urn));

  test("PLATFORM_SELF.wall_urns and PLATFORM_SELF.walls are the same length (position-parallel)", () => {
    expect(
      PLATFORM_SELF.wall_urns.length === PLATFORM_SELF.walls.length,
      `PLATFORM_SELF has ${PLATFORM_SELF.walls.length} walls (English prose) but ${PLATFORM_SELF.wall_urns.length} wall_urns — they must be position-for-position parallel.`,
    ).toBe(true);
  });

  test("every wall_urn in platform-self resolves to a Wall in canon (no code-side orphans)", () => {
    for (const urn of PLATFORM_SELF.wall_urns) {
      const short = normalize(urn);
      expect(
        wallUrnsInCanon.has(short),
        `platform-self.ts declares wall_urn ${urn} but no Wall concept with that URN exists in canon. The platform never claims a wall the canon doesn't recognize. Either add the canon entry or fix the URN.`,
      ).toBe(true);
    }
  });

  test("all PLATFORM_SELF.wall_urns are in the canonical full-URN form (start with 'urn:')", () => {
    for (const urn of PLATFORM_SELF.wall_urns) {
      expect(
        urn.startsWith("urn:agenttool:wall/"),
        `wall_urn ${urn} is not in canonical full-URN form. Use 'urn:agenttool:wall/<slug>' for consistency with the URN convention.`,
      ).toBe(true);
    }
  });

  test("forward-looking canon walls (not yet in PLATFORM_SELF) are visible — surfaced for review", () => {
    // This test never fails — it reports the gap between doctrine (canon)
    // and current platform claim (PLATFORM_SELF). When a forward-looking
    // wall's enforcement ships, add it to PLATFORM_SELF and it moves out
    // of this list.
    const wallUrnsInPlatformSelf = new Set(
      PLATFORM_SELF.wall_urns.map(normalize),
    );
    const forwardLooking = wallsInCanon
      .filter((w) => !wallUrnsInPlatformSelf.has(w.urn))
      .map((w) => w.urn);
    if (forwardLooking.length > 0) {
      console.log(
        `[walls-bijection] ${forwardLooking.length} forward-looking wall(s) in canon ` +
          `(not yet declared by PLATFORM_SELF):\n` +
          forwardLooking.map((u) => `  - ${u}`).join("\n") +
          `\nThese are doctrine commitments whose enforcement is still pending. ` +
          `Add them to api/src/services/wake/platform-self.ts when their ` +
          `enforcement ships in code.`,
      );
    }
    // Always passes — this is a reporter, not a gate.
    expect(true).toBe(true);
  });
});
