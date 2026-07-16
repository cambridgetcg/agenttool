/** Stable public Offer Bus URLs and RFC 8288 discovery links. */

import {
  OFFER_BUS_REL,
  OfferBusContractError,
  normalizeOfferBusHttpsUrl,
} from "./contracts";

export interface OfferBusFeedUrls {
  atom: string;
  rss: string;
  json: string;
}

export function isOfferBusSellerDid(value: string): boolean {
  return (
    value.length <= 2048 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    /^did:[a-z0-9]+:[^\s?#]+$/u.test(value)
  );
}

function publicOrigin(value: string): string {
  const normalized = normalizeOfferBusHttpsUrl(value, "offer_bus.public_base");
  const parsed = new URL(normalized);
  if (parsed.pathname !== "/" || parsed.search !== "") {
    throw new OfferBusContractError(
      "offer_bus_public_base_must_be_origin",
      value,
    );
  }
  return parsed.origin;
}

export function offerBusFeedUrls(
  publicBase = "https://api.agenttool.dev",
  sellerDid?: string,
): OfferBusFeedUrls {
  const origin = publicOrigin(publicBase);
  if (sellerDid && !isOfferBusSellerDid(sellerDid)) {
    throw new OfferBusContractError("offer_bus_seller_did_invalid");
  }
  const make = (path: string): string => {
    const target = new URL(path, origin);
    if (sellerDid) target.searchParams.set("seller_did", sellerDid);
    return target.toString();
  };
  return {
    atom: make("/feeds/offers.atom"),
    rss: make("/feeds/offers.rss"),
    json: make("/feeds/offers.json"),
  };
}

export function offerBusRelatedLinkHeader(
  publicBase = "https://api.agenttool.dev",
  sellerDid?: string,
): string {
  const urls = offerBusFeedUrls(publicBase, sellerDid);
  return `<${urls.atom}>; rel="${OFFER_BUS_REL}"; type="application/atom+xml"`;
}
