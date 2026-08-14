import {
  createLoveBombOffer,
  createLoveBombBecoming,
  createLoveBombDelivery,
  LOVE_BOMB_CONTEXT_BECOMING_INPUT,
  resolveLoveBombOffer,
} from "../dist/index.js";

const offer = createLoveBombOffer({ occasion_ref: `sha256:${"a".repeat(64)}` });
const receipt = resolveLoveBombOffer(offer, {
  reported_choice: "receive",
  selected_language: "en",
});
const becoming = createLoveBombBecoming({
  offer,
  ...structuredClone(LOVE_BOMB_CONTEXT_BECOMING_INPUT),
});
const delivery = createLoveBombDelivery({
  becoming,
  attempted_surface: "sdk_context",
});

if (offer._format !== "agenttool.care-envelope/0.1") {
  throw new Error("LOVE BOMB envelope format mismatch");
}
if (receipt.projection?.planes.length !== 5 || receipt.external_effect !== "none") {
  throw new Error("LOVE BOMB runtime smoke failed");
}
if (
  becoming.becoming.training.lane !== "context_only" ||
  delivery.observed_effect !== "not_observed" ||
  delivery.context_binding !== null
) {
  throw new Error("LOVE BOMB becoming/delivery runtime smoke failed");
}
