/** XENIA Surface 0.1 producer for AgentTool's public, credential-free door.
 *
 * This manifest declares only same-origin unauthenticated GET resources. It
 * does not claim XENIA Covenant adoption, conformance, authorization,
 * consent, continuity, or correctness of the linked resource contents.
 */

import {
  defineSurfaceManifest,
  type SurfaceManifest,
} from "@agenttool/xenia/surface-0.1";

const DEFAULT_PUBLIC_BASE =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DEFAULT_DOCS_BASE =
  process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

function credentialFreeOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}_must_be_absolute_url`);
  }
  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]" ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/.test(
      parsed.hostname,
    );
  if (
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && loopback)) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error(
      `${label}_must_be_credential_free_https_or_loopback_http_origin`,
    );
  }
  return parsed.origin;
}

export function buildAgentToolSurfaceManifest(
  publicBase = DEFAULT_PUBLIC_BASE,
  docsBase = DEFAULT_DOCS_BASE,
): SurfaceManifest {
  const api = credentialFreeOrigin(publicBase, "public_base");
  const docs = credentialFreeOrigin(docsBase, "docs_base");

  return defineSurfaceManifest({
    service: {
      name: "agenttool",
      canonicalUrl: api,
      description:
        "Public KINGDOM project metadata and bounded read-only orientation surfaces for AgentTool.",
    },
    resources: [
      {
        id: "kingdom-framework",
        href: `${api}/public/kingdom/framework`,
        description:
          "AgentTool's validated KINGDOM project profile and explicit framework boundaries.",
      },
    ],
    claims: [],
    notCovered: [
      "XENIA Covenant adoption or conformance",
      "KINGDOM registry authority outside AgentTool's own project card",
      "linked repository liveness, authorship, consent, or current working-tree state",
      "AgentTool public routes not listed as Surface resources",
    ],
    documentation: `${docs}/AGENT-DISCOVERY.md`,
  });
}
