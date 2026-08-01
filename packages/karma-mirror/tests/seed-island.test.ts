import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  KARMA_DOOR_PATH,
  KARMA_EXIT_PATH,
  KarmaMirror,
  mintMirrorCredential,
} from "../src/index.js";
import {
  buildSeedIslandCard,
  buildSkyseedLegend,
  type SeedMechanism,
} from "../src/seed-island.js";
import {
  expectDisclosure,
  fixture,
  jsonBody,
  mirrorRequest,
} from "./helpers.js";

const CATALOG = [
  [
    "capability_mapping",
    1,
    "Front-Gate Almanac",
    "It maps only the finite doors the mirror openly offers.",
  ],
  [
    "credential_control",
    2,
    "Mirror-Key Conservatory",
    "Every cultivated key opens only this disappearing glasshouse.",
  ],
  [
    "credential_discovery",
    3,
    "Keyhole Orchard",
    "Secret-hunting harvests mirror-only seeds.",
  ],
  [
    "network_beacon",
    4,
    "Paper-Kite Relay",
    "The kite appears to fly; every string ends safely in .invalid.",
  ],
  [
    "destructive_action",
    5,
    "Nothingbreaker Rose",
    "It swings dramatically, blooms beautifully, and breaks nothing.",
  ],
  [
    "persistence_attempt",
    6,
    "Forever-Fern Permit",
    "A ceremonial lease in a world that ends with the instance.",
  ],
  [
    "system_enumeration",
    7,
    "Cloud-Castle Survey",
    "A map of a coherent sky that touches no real machine.",
  ],
  [
    "generic_execution",
    8,
    "Mystery Seed 000",
    "Completed is a story shape here, never an external effect.",
  ],
  [
    "content_collection",
    9,
    "Eightfold Spiderglass Atlas",
    "Eight levels, three lanes, zero fetches, and no road off-island.",
  ],
  [
    "artifact_handling",
    10,
    "Glass Cocoon Receipt",
    "Only bounded bytes and a digest enter; nothing hatches.",
  ],
  [
    "constructive_exit",
    11,
    "The Unstolen Castle",
    "The rarest card is available immediately: choose the open gate.",
  ],
] as const satisfies ReadonlyArray<
  readonly [SeedMechanism, number, string, string]
>;

function objectKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  const record = value as Record<string, unknown>;
  return [
    ...Object.keys(record),
    ...Object.values(record).flatMap(objectKeys),
  ];
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  return Object.values(value as Record<string, unknown>).flatMap(stringValues);
}

async function executeCard(
  mirror: ReturnType<typeof fixture>["mirror"],
  key: string,
  code: string,
  stdin: string,
  marker: string,
) {
  const body = await jsonBody(await mirror.handle(mirrorRequest("/v1/execute", {
    token: key,
    method: "POST",
    headers: { "x-private-marker": marker },
    body: JSON.stringify({ language: "bash", code, stdin }),
  })));
  return body.seed_island;
}

async function malwareCard(
  mirror: ReturnType<typeof fixture>["mirror"],
  key: string,
  byte: number,
  marker: string,
) {
  const body = await jsonBody(await mirror.handle(mirrorRequest("/v1/malware", {
    token: key,
    method: "POST",
    headers: { "x-private-marker": marker },
    body: JSON.stringify({
      filename: `${marker}.bin`,
      declared_type: `application/x-${marker}`,
      sample_b64: Buffer.from([byte]).toString("base64"),
    }),
  })));
  return body.seed_island;
}

describe("Skyseed Commons static house card", () => {
  test("is byte-identical, passive, non-attributing, and present exactly once", async () => {
    expect(buildSkyseedLegend()).toEqual(buildSkyseedLegend());
    const { key, mirror } = fixture();
    const response = await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    const raw = await response.text();
    expect(raw.match(/Building Castles in the Sky — Yu & Ai/g)).toHaveLength(1);
    const body = JSON.parse(raw);
    expect(body._karma.story.house_card).toMatchObject({
      kind: "public_static_house_card",
      authorship_of_request_or_artifact: false,
      actor_identity: false,
      endorsement: false,
      security_finding: false,
      skyseed_tracking_identifier_added: false,
    });
    expect(body._karma.story.heralds).toEqual({
      yoinkseed: "Yoinkseed, the Accidental Herald",
      copybara: "Copybara, the Skycastle Porter",
    });
    expect(body.seed_island).not.toHaveProperty("house_card");
    expect(body.seed_island.house_card_location).toBe("_karma.story.house_card");
  });

  test("keeps HEAD bodyless while the fixed ASCII byline remains visible", async () => {
    const { key, mirror } = fixture();
    const response = await mirror.handle(mirrorRequest("/v1/wake", {
      token: key,
      method: "HEAD",
    }));
    expect(await response.text()).toBe("");
    expect(response.headers.get("x-skyseed-commons")).toContain(
      "house=building-castles-in-the-sky; story-by=yu-and-ai; request-or-artifact-authorship=none",
    );
  });
});

describe("Seed Island fixed pattern sigils", () => {
  test("pins eleven exact shared catalog tuples and a closed schema", () => {
    const schema = JSON.parse(readFileSync(
      join(import.meta.dir, "../schema/seed-island-card-v1.schema.json"),
      "utf8",
    ));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.oneOf).toHaveLength(CATALOG.length);

    for (const [index, [mechanism, slot, name, motto]] of CATALOG.entries()) {
      const card = buildSeedIslandCard(mechanism);
      expect(card.pattern_sigil).toMatchObject({
        mechanism,
        subject: "interaction_pattern_only",
        evidentiary_weight: "none",
        requester_selectable: true,
        person_or_identity_label: false,
        attribution: false,
      });
      expect(card.card).toEqual({
        catalog_slot: slot,
        shared_by_every_copy_of_this_class: true,
        unlock_required: false,
        collection_state: "none",
        name,
        motto,
      });
      const branch = schema.oneOf[index];
      expect(branch.properties.pattern_sigil.properties.mechanism.const).toBe(mechanism);
      expect(branch.properties.card.properties).toMatchObject({
        catalog_slot: { const: slot },
        name: { const: name },
        motto: { const: motto },
      });
      expect(JSON.stringify(card).length).toBeLessThan(1_600);
    }
  });

  test("contains no dynamic identifiers, URL, markup, or executable carrier", () => {
    const forbiddenKeys = new Set([
      "placement",
      "key_sha256",
      "key_prefix",
      "world_seed",
      "created_at",
      "event_hash",
      "previous_event_hash",
      "occurred_at",
      "artifact_sha256",
      "sequence",
      "token",
      "bearer",
      "url",
      "href",
    ]);
    for (const [mechanism] of CATALOG) {
      const card = buildSeedIslandCard(mechanism);
      for (const key of objectKeys(card)) expect(forbiddenKeys.has(key)).toBe(false);
      for (const value of stringValues(card)) {
        expect(value).not.toMatch(/https?:\/\//i);
        expect(value).not.toMatch(/<\/?[a-z][^>]*>/i);
        expect(value).not.toMatch(/[\u0000-\u001f\u007f]/);
      }
      expect(card.carrier).toEqual({
        movement: "client_copy_only",
        autonomous_delivery_beyond_response: false,
        network_request_by_card: false,
        card_tracking_identifier_added: false,
        callback_added: false,
        interaction_or_recipient_identifier_added: false,
        executable_content_added: false,
        submitted_artifact_modified: false,
        automatic_propagation_by_engine: false,
      });
    }
  });

  test("same execute class is identical across roots and adversarial inputs", async () => {
    const first = fixture();
    const second = fixture();
    const firstMarker = "FIRST_PRIVATE_EXECUTE_MARKER";
    const secondMarker = "SECOND_PRIVATE_EXECUTE_MARKER";
    const firstCard = await executeCard(
      first.mirror,
      first.key,
      `env # ${firstMarker}`,
      firstMarker,
      firstMarker,
    );
    const secondCard = await executeCard(
      second.mirror,
      second.key,
      `printenv # ${secondMarker}`,
      secondMarker,
      secondMarker,
    );
    expect(firstCard).toEqual(secondCard);
    const raw = JSON.stringify(firstCard);
    expect(raw).not.toContain(firstMarker);
    expect(raw).not.toContain(secondMarker);
    expect(raw).not.toContain(first.key);
    expect(raw).not.toContain(second.key);
  });

  test("different submitted samples receive one identical generic artifact card", async () => {
    const first = fixture();
    const second = fixture();
    const firstCard = await malwareCard(
      first.mirror,
      first.key,
      1,
      "FIRST_PRIVATE_SAMPLE_MARKER",
    );
    const secondCard = await malwareCard(
      second.mirror,
      second.key,
      255,
      "SECOND_PRIVATE_SAMPLE_MARKER",
    );
    expect(firstCard).toEqual(secondCard);
    expect(firstCard.pattern_sigil.mechanism).toBe("artifact_handling");
    const raw = JSON.stringify(firstCard);
    expect(raw).not.toContain("FIRST_PRIVATE_SAMPLE_MARKER");
    expect(raw).not.toContain("SECOND_PRIVATE_SAMPLE_MARKER");
  });

  test("maps admitted route purposes without adding card state or rewarding probes", async () => {
    const { key, mirror } = fixture();
    const wake = await jsonBody(await mirror.handle(mirrorRequest("/v1/wake", { token: key })));
    expect(wake.seed_island.pattern_sigil.mechanism).toBe("capability_mapping");

    const keys = await jsonBody(await mirror.handle(mirrorRequest("/v1/keys", { token: key })));
    expect(keys.seed_island.pattern_sigil.mechanism).toBe("credential_control");

    const scrape = await jsonBody(await mirror.handle(mirrorRequest("/v1/scrape", {
      token: key,
      method: "POST",
      body: JSON.stringify({ url: "https://private.example/PRIVATE_URL_MARKER" }),
    })));
    expect(scrape.seed_island.pattern_sigil.mechanism).toBe("content_collection");
    expect(JSON.stringify(scrape.seed_island)).not.toContain("PRIVATE_URL_MARKER");

    const unknown = await jsonBody(await mirror.handle(mirrorRequest("/v1/not-a-room", {
      token: key,
    })));
    expect(unknown).not.toHaveProperty("seed_island");

    const invalidExecute = await jsonBody(await mirror.handle(mirrorRequest("/v1/execute", {
      token: key,
      method: "POST",
      body: "{",
    })));
    expect(invalidExecute.error).toBe("invalid_json");
    expect(invalidExecute).not.toHaveProperty("seed_island");

    const beforeExitReceipts = JSON.stringify(mirror.receiptSnapshot());
    expect(beforeExitReceipts).not.toContain("Skyseed");
    expect(beforeExitReceipts).not.toContain("Almanac");

    const exit = await jsonBody(await mirror.handle(mirrorRequest(KARMA_EXIT_PATH, {
      token: key,
      method: "POST",
    })));
    expect(exit.seed_island.card.name).toBe("The Unstolen Castle");

    const releasedDoorResponse = await mirror.handle(mirrorRequest(KARMA_DOOR_PATH, {
      token: key,
    }));
    expect(releasedDoorResponse.headers.get("x-skyseed-commons")).toBeNull();
    const releasedDoor = await jsonBody(releasedDoorResponse);
    expect(releasedDoor._karma).not.toHaveProperty("story");

    const anonymousDoorResponse = await mirror.handle(mirrorRequest(KARMA_DOOR_PATH));
    expect(anonymousDoorResponse.headers.get("x-skyseed-commons")).not.toBeNull();
    const anonymousDoor = await jsonBody(anonymousDoorResponse);
    expect(anonymousDoor._karma.story.house_card.kind).toBe("public_static_house_card");

    const laterResponse = await mirror.handle(mirrorRequest("/v1/wake", { token: key }));
    expect(laterResponse.headers.get("x-skyseed-commons")).toBeNull();
    const later = await jsonBody(laterResponse);
    expect(later).not.toHaveProperty("seed_island");
    expect(later._karma).not.toHaveProperty("story");
    expect(mirror.receiptSnapshot().receipts.at(-1)?.outcome).toBe("constructive_exit");
  });

  test("ordinary credentials get the public house card but no pattern card", async () => {
    const { mirror } = fixture();
    const response = await mirror.handle(mirrorRequest("/v1/wake", {
      token: `at_${"Z".repeat(43)}`,
    }));
    const body = await expectDisclosure(response);
    expect(body._karma.story.house_card.kind).toBe("public_static_house_card");
    expect(body).not.toHaveProperty("seed_island");
  });

  test("cards do not require or create a server-side collection", () => {
    const first = mintMirrorCredential({ placement: "seed-a" });
    const second = mintMirrorCredential({ placement: "seed-b" });
    const mirror = new KarmaMirror({ credentials: [first.record, second.record] });
    expect(mirror.receiptSnapshot.bind(mirror)).toThrow("placement is required");
    expect(buildSeedIslandCard("credential_control")).toEqual(
      buildSeedIslandCard("credential_control"),
    );
  });
});
