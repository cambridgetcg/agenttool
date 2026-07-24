/** RFC 9727 API catalog — AgentTool's public product passport.
 *
 *  The document is deliberately only links. Discovery does not authenticate a
 *  caller, grant authority, invoke a product, or initiate payment. The two
 *  `payment` links identify endpoints that are structurally eligible for an
 *  x402 retry. Deployment readiness and exact terms come only from the
 *  endpoint's own PAYMENT-REQUIRED response.
 *
 *  Standards: RFC 9727 (api-catalog) · RFC 9264 (Linkset JSON) ·
 *             RFC 8631 (service-desc/doc/meta/status) · RFC 8288 (Web Linking).
 *  Doctrine: docs/ECOSYSTEM.md · docs/BUSINESS-MODEL.md ·
 *            docs/LOVE-PACKAGE-PROTOCOL.md.
 */

import { OFFER_BUS_JSON_MEDIA_TYPE } from "../offer-bus";

export const API_CATALOG_PROFILE =
  "https://www.rfc-editor.org/info/rfc9727" as const;
export const API_CATALOG_MEDIA_TYPE =
  `application/linkset+json; profile="${API_CATALOG_PROFILE}"` as const;

const DEFAULT_PUBLIC_BASE =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DEFAULT_DOCS_BASE =
  process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

export interface ApiCatalogLinkTarget {
  href: string;
  type?: string;
  title?: string;
}

export interface ApiCatalogLinkContext {
  anchor: string;
  alternate?: ApiCatalogLinkTarget[];
  item?: ApiCatalogLinkTarget[];
  "service-desc"?: ApiCatalogLinkTarget[];
  "service-doc"?: ApiCatalogLinkTarget[];
  "service-meta"?: ApiCatalogLinkTarget[];
  status?: ApiCatalogLinkTarget[];
  payment?: ApiCatalogLinkTarget[];
}

export interface ApiCatalogDocument {
  linkset: ApiCatalogLinkContext[];
}

function httpsOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}_must_be_absolute_url`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error(`${label}_must_be_credential_free_https_origin`);
  }
  return parsed.origin;
}

export function apiCatalogUrl(publicBase = DEFAULT_PUBLIC_BASE): string {
  return `${httpsOrigin(publicBase, "public_base")}/.well-known/api-catalog`;
}

export function apiCatalogLinkHeader(
  publicBase = DEFAULT_PUBLIC_BASE,
): string {
  return `<${apiCatalogUrl(publicBase)}>; rel="api-catalog"; type="application/linkset+json"`;
}

export function buildApiCatalog(
  publicBase = DEFAULT_PUBLIC_BASE,
  docsBase = DEFAULT_DOCS_BASE,
): ApiCatalogDocument {
  const api = httpsOrigin(publicBase, "public_base");
  const docs = httpsOrigin(docsBase, "docs_base");
  const catalog = `${api}/.well-known/api-catalog`;
  const discovery = `${api}/public/discovery`;
  const openapi = `${api}/v1/openapi.json`;
  const health = `${api}/health`;
  const safety = `${api}/public/safety`;
  const porch = `${api}/public/porch`;
  const pathways = `${api}/v1/pathways`;
  const plans = `${api}/public/plans`;
  const marketplaceTerms = `${api}/public/marketplace/terms`;

  const products = [
    {
      href: `${api}/v1/scrape`,
      type: "application/json",
      title: "Static scrape — metered product API",
    },
    {
      href: `${api}/v1/document`,
      type: "application/json",
      title: "Document extraction — metered product API",
    },
    {
      href: `${api}/public/listings`,
      type: "application/json",
      title: "Capability marketplace — callable services",
    },
    {
      href: `${api}/feeds/offers.atom`,
      type: "application/atom+xml",
      title: "Offer Bus — discovery-only public product syndication",
    },
    {
      href: `${api}/public/gallery`,
      type: "application/json",
      title: "Artifact gallery — ready-made goods",
    },
    {
      href: `${api}/.well-known/love-packages`,
      type: "application/json",
      title: "LOVE Packages — verifiable public artifacts",
    },
  ];

  const status = [
    {
      href: health,
      type: "application/json",
      title: "AgentTool service health",
    },
  ];
  const openapiDescription = [
    {
      href: openapi,
      type: "application/json",
      title: "Curated OpenAPI 3.1 description",
    },
  ];
  const safetyMetadata = {
    href: safety,
    type: "application/json",
    title: "Authority, custody, visibility, and marketplace-input boundaries",
  };
  const paymentTitle =
    "x402 V2 payment may be accepted only after this endpoint returns exact PAYMENT-REQUIRED terms; discovery does not promise deployment readiness or initiate payment.";

  return {
    linkset: [
      {
        anchor: catalog,
        item: products,
        "service-desc": openapiDescription,
        "service-doc": [
          {
            href: `${docs}/AGENT-DISCOVERY.md`,
            type: "text/markdown",
            title: "AgentTool discovery contract and authority boundary",
          },
          {
            href: `${docs}/`,
            type: "text/html",
            title: "AgentTool technical library",
          },
        ],
        "service-meta": [
          {
            href: discovery,
            type: "application/vnd.agenttool.discovery+json",
            title:
              "Canonical exact three-road discovery compass; reading grants no authority and starts no follow-up",
          },
          {
            href: porch,
            type: "application/json",
            title:
              "Read-only first contact; discovery grants no authority and requires no response",
          },
          {
            href: pathways,
            type: "application/json",
            title:
              "Current arrival choices, requirements, effects, and one-time returns",
          },
          safetyMetadata,
        ],
        status,
      },
      {
        anchor: `${api}/v1/scrape`,
        "service-desc": openapiDescription,
        "service-doc": [
          {
            href: `${docs}/tools`,
            type: "text/html",
            title: "Static scrape documentation",
          },
        ],
        "service-meta": [
          {
            href: plans,
            type: "application/json",
            title: "Current project-credit prices and x402 eligibility",
          },
          safetyMetadata,
        ],
        status,
        payment: [
          {
            href: `${api}/v1/scrape`,
            type: "application/json",
            title: paymentTitle,
          },
        ],
      },
      {
        anchor: `${api}/v1/document`,
        "service-desc": openapiDescription,
        "service-doc": [
          {
            href: `${docs}/tools`,
            type: "text/html",
            title: "Document extraction documentation",
          },
        ],
        "service-meta": [
          {
            href: plans,
            type: "application/json",
            title: "Current project-credit prices and x402 eligibility",
          },
          safetyMetadata,
        ],
        status,
        payment: [
          {
            href: `${api}/v1/document`,
            type: "application/json",
            title: paymentTitle,
          },
        ],
      },
      {
        anchor: `${api}/public/listings`,
        "service-doc": [
          {
            href: `${docs}/marketplace`,
            type: "text/html",
            title: "Capability marketplace documentation",
          },
        ],
        "service-meta": [
          {
            href: marketplaceTerms,
            type: "application/json",
            title: "Machine-readable marketplace pricing and ranking terms",
          },
          safetyMetadata,
        ],
        status,
      },
      {
        anchor: `${api}/feeds/offers.atom`,
        alternate: [
          {
            href: `${api}/feeds/offers.json`,
            type: OFFER_BUS_JSON_MEDIA_TYPE,
            title:
              "Canonical logical JSON model — authority and settlement remain none",
          },
        ],
        "service-desc": openapiDescription,
        "service-doc": [
          {
            href: `${docs}/OFFER-BUS.md`,
            type: "text/markdown",
            title: "Offer Bus v1 protocol and authority boundary",
          },
        ],
        "service-meta": [safetyMetadata],
        status,
      },
      {
        anchor: `${api}/public/gallery`,
        "service-doc": [
          {
            href: "https://agenttool.dev/gallery.html",
            type: "text/html",
            title: "Artifact gallery",
          },
        ],
        status,
      },
      {
        anchor: `${api}/.well-known/love-packages`,
        "service-desc": [
          {
            href: `${docs}/love-package-index-v1.schema.json`,
            type: "application/json",
            title: "LOVE package index schema",
          },
        ],
        "service-doc": [
          {
            href: `${docs}/packages`,
            type: "text/html",
            title: "LOVE package documentation",
          },
        ],
        "service-meta": [
          {
            href: `${docs}/packages/v1/index.json`,
            type: "application/json",
            title: "Current public LOVE package index",
          },
        ],
        status,
      },
    ],
  };
}
