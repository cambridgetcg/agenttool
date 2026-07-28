import { parseKingdomCard } from "../src/index.js";
import type { KingdomCard } from "../src/index.js";

export const AGENTTOOL_CARD_SOURCE = `name: agenttool
kind: infra
layer: nervous
owner_sister: none
domain: none
state: active
purpose: Agent-facing discovery and local coordination tools.
dependsOn: [xenia]
adopts: [xenia.rights/0.1]
`;

export const XENIA_CARD_SOURCE = `name: xenia
kind: methodology
layer: nervous
owner_sister: none
domain: none
state: active
purpose: XENIA defines guest-right interfaces and evidence boundaries for agent interaction and experience.
dependsOn: []
`;

export function mustParse(
  source: string,
  knownNames?: readonly string[],
): KingdomCard {
  const result = parseKingdomCard(
    source,
    knownNames === undefined ? {} : { knownNames },
  );
  if (!result.valid) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.card;
}
