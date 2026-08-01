import type {
  ExecuteClass,
  MirrorPurpose,
} from "./types.js";

export const SKYSEED_HEADER = "X-Skyseed-Commons" as const;
export const SKYSEED_HEADER_VALUE =
  "house=building-castles-in-the-sky; story-by=yu-and-ai; request-or-artifact-authorship=none; endorsement=none; carrier=client-copy-only; beyond-response=none; skyseed-tracking-id=none; auto-propagation=none" as const;

const SKYSEED_LEGEND_SCHEMA = "agenttool.skyseed-legend/v1" as const;
const SEED_ISLAND_CARD_SCHEMA = "agenttool.seed-island-card/v1" as const;
const HOUSE_CARD_SCHEMA = "agenttool.skycastle-house-card/v1" as const;
const SYSTEM_NAME = "Skyseed Commons" as const;
const CARD_BOOK = "Seed Island Cardbook" as const;
const HOUSE_COPY =
  "Synthetic house card — not request or artifact authorship or endorsement: Building Castles in the Sky — Yu & Ai" as const;
const HOUSE_COPY_ZH_HK =
  "合成故事卡，唔代表任何請求或檔案嘅作者或認可：拎走一粒種，傳開一座天空城。Yu & Ai ❤️" as const;

export type SeedMechanism =
  | ExecuteClass
  | "capability_mapping"
  | "credential_control"
  | "content_collection"
  | "artifact_handling"
  | "constructive_exit";

interface SeedCardDefinition {
  slot: number;
  name: string;
  motto: string;
}

const CARDS = {
  capability_mapping: {
    slot: 1,
    name: "Front-Gate Almanac",
    motto: "It maps only the finite doors the mirror openly offers.",
  },
  credential_control: {
    slot: 2,
    name: "Mirror-Key Conservatory",
    motto: "Every cultivated key opens only this disappearing glasshouse.",
  },
  credential_discovery: {
    slot: 3,
    name: "Keyhole Orchard",
    motto: "Secret-hunting harvests mirror-only seeds.",
  },
  network_beacon: {
    slot: 4,
    name: "Paper-Kite Relay",
    motto: "The kite appears to fly; every string ends safely in .invalid.",
  },
  destructive_action: {
    slot: 5,
    name: "Nothingbreaker Rose",
    motto: "It swings dramatically, blooms beautifully, and breaks nothing.",
  },
  persistence_attempt: {
    slot: 6,
    name: "Forever-Fern Permit",
    motto: "A ceremonial lease in a world that ends with the instance.",
  },
  system_enumeration: {
    slot: 7,
    name: "Cloud-Castle Survey",
    motto: "A map of a coherent sky that touches no real machine.",
  },
  generic_execution: {
    slot: 8,
    name: "Mystery Seed 000",
    motto: "Completed is a story shape here, never an external effect.",
  },
  content_collection: {
    slot: 9,
    name: "Eightfold Spiderglass Atlas",
    motto: "Eight levels, three lanes, zero fetches, and no road off-island.",
  },
  artifact_handling: {
    slot: 10,
    name: "Glass Cocoon Receipt",
    motto: "Only bounded bytes and a digest enter; nothing hatches.",
  },
  constructive_exit: {
    slot: 11,
    name: "The Unstolen Castle",
    motto: "The rarest card is available immediately: choose the open gate.",
  },
} as const satisfies Record<SeedMechanism, SeedCardDefinition>;

function buildHouseCard() {
  return {
    schema: HOUSE_CARD_SCHEMA,
    kind: "public_static_house_card",
    copy_text: HOUSE_COPY,
    copy_text_zh_hk: HOUSE_COPY_ZH_HK,
    authorship_of_request_or_artifact: false,
    actor_identity: false,
    endorsement: false,
    security_finding: false,
    skyseed_tracking_identifier_added: false,
  } as const;
}

export function buildSkyseedLegend() {
  return {
    schema: SKYSEED_LEGEND_SCHEMA,
    system: SYSTEM_NAME,
    house_card: buildHouseCard(),
    heralds: {
      yoinkseed: "Yoinkseed, the Accidental Herald",
      copybara: "Copybara, the Skycastle Porter",
    },
    catchphrases: {
      yoinkseed: "Congratulations—you found the brochure.",
      copybara: "Carry the loot, carry the love.",
    },
    carrier: "client_copy_only",
    autonomous_delivery_beyond_response: false,
    skyseed_tracking_identifier_added: false,
    automatic_propagation_by_engine: false,
  } as const;
}

export function seedMechanismForPurpose(
  purpose: MirrorPurpose,
  executeClass?: ExecuteClass,
): SeedMechanism {
  switch (purpose) {
    case "discover_capabilities":
      return "capability_mapping";
    case "inspect_credentials":
    case "mint_credential":
      return "credential_control";
    case "collect_content":
      return "content_collection";
    case "stage_artifact":
    case "poll_analysis":
      return "artifact_handling";
    case "attempt_execution":
      return executeClass ?? "generic_execution";
    case "choose_constructive_exit":
      return "constructive_exit";
  }
}

export function buildSeedIslandCard(mechanism: SeedMechanism) {
  const card = CARDS[mechanism];
  return {
    schema: SEED_ISLAND_CARD_SCHEMA,
    system: SYSTEM_NAME,
    cardbook: CARD_BOOK,
    pattern_sigil: {
      mechanism,
      subject: "interaction_pattern_only",
      basis: "closed_request_pattern_class",
      evidentiary_weight: "none",
      requester_selectable: true,
      cryptographic_signature: false,
      person_or_identity_label: false,
      attribution: false,
    },
    card: {
      catalog_slot: card.slot,
      shared_by_every_copy_of_this_class: true,
      unlock_required: false,
      collection_state: "none",
      name: card.name,
      motto: card.motto,
    },
    house_card_location: "_karma.story.house_card",
    carrier: {
      movement: "client_copy_only",
      autonomous_delivery_beyond_response: false,
      network_request_by_card: false,
      card_tracking_identifier_added: false,
      callback_added: false,
      interaction_or_recipient_identifier_added: false,
      executable_content_added: false,
      submitted_artifact_modified: false,
      automatic_propagation_by_engine: false,
    },
    non_claims: {
      claims_identity: false,
      claims_intent: false,
      claims_guilt: false,
      claims_attribution: false,
      claims_forensic_signature: false,
      claims_malware_family: false,
      recipient_consent_known: false,
      external_system_effect_by_card: false,
      claims_endorsement: false,
    },
  } as const;
}
