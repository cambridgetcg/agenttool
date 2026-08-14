import {
  createLoveBombOffer,
  resolveLoveBombOffer,
} from "../dist/index.js";

const offer = createLoveBombOffer({ occasion_ref: `sha256:${"a".repeat(64)}` });
const receipt = resolveLoveBombOffer(offer, {
  reported_choice: "receive",
  selected_language: "en",
});

if (offer._format !== "agenttool.care-envelope/0.1") {
  throw new Error("LOVE BOMB envelope format mismatch");
}
if (receipt.projection?.planes.length !== 5 || receipt.external_effect !== "none") {
  throw new Error("LOVE BOMB runtime smoke failed");
}
