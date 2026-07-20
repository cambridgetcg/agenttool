/** /v1/runtimes/:id/bridge — WSS upgrade pre-handler.
 *
 *  Bun's WS handlers live on Bun.serve, not inside Hono. This module
 *  exports a pre-fetch hook that the top-level fetch handler invokes
 *  BEFORE delegating to Hono. If the request matches the bridge URL
 *  pattern, this module fully owns the response — either it upgrades
 *  the connection (caller returns undefined) or it returns a 4xx/5xx
 *  rejection (caller returns the Response).
 *
 *  Auth (pre-upgrade):
 *    1. URL path matches /v1/runtimes/:id/bridge.
 *    2. Upgrade header = "websocket".
 *    3. Query param `control_token` is present and sha256-matches
 *       runtimes.control_token_hash for that runtime id.
 *    4. The runtime's mode is 'bridged' (or 'trusted' once that ships).
 *    5. The runtime is not deleted.
 *
 *  If all five hold, we attach runtime metadata to ws.data and the
 *  in-band bridge-key proof takes over (see bridge-hub.ts). The server does
 *  not provide a separate ed25519 proof; WSS supplies normal TLS server auth.
 *
 *  Doctrine: docs/RUNTIME.md */

import type { Server } from "bun";

import { verifyControlToken } from "../../services/runtime/control-token";
import { findRuntimeForBridge } from "../../services/runtime/store";
import type { BridgeWsData } from "../../services/runtime/bridge-hub";

type BridgeServer = Server<BridgeWsData>;

const BRIDGE_PATH = /^\/v1\/runtimes\/([0-9a-f-]{36})\/bridge\/?$/i;

export interface BridgeUpgradeOutcome {
  /** True if this module took the request — caller MUST NOT hand off to Hono. */
  handled: boolean;
  /** Response to return from fetch. `undefined` means Bun already
   *  responded via server.upgrade(); the fetch handler should return
   *  undefined too. Only meaningful when handled === true. */
  response: Response | undefined;
}

const PASSTHROUGH: BridgeUpgradeOutcome = { handled: false, response: undefined };

function reject(status: number, error: string, message?: string): BridgeUpgradeOutcome {
  return {
    handled: true,
    response: new Response(JSON.stringify(message ? { error, message } : { error }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  };
}

export async function tryBridgeUpgrade(
  req: Request,
  server: BridgeServer,
): Promise<BridgeUpgradeOutcome> {
  const url = new URL(req.url);
  const m = url.pathname.match(BRIDGE_PATH);
  if (!m) return PASSTHROUGH;

  const upgrade = req.headers.get("upgrade")?.toLowerCase();
  if (upgrade !== "websocket") {
    return reject(
      426,
      "websocket_required",
      "This endpoint is WSS-only. Open with `agenttool-bridge connect --runtime-id <id> --token <token>`.",
    );
  }

  const runtimeId = m[1];
  const controlToken = url.searchParams.get("control_token");
  if (!controlToken) {
    return reject(
      401,
      "control_token_required",
      "Append ?control_token=… to the WSS URL. The token is shown ONCE at POST /v1/runtimes; rotate via POST /v1/runtimes/:id/rotate-token.",
    );
  }

  const runtime = await findRuntimeForBridge(runtimeId);
  if (!runtime) return reject(404, "runtime_not_found");

  if (runtime.mode === "self") {
    return reject(
      409,
      "mode_self_no_bridge",
      "mode='self' runtimes don't accept a bridge. Provision a 'bridged' runtime to host the orchestrator.",
    );
  }
  if (!runtime.control_token_hash || !runtime.bridge_pubkey) {
    return reject(
      409,
      "runtime_not_provisioned_for_bridge",
      "This runtime row is missing control_token_hash or bridge_pubkey. Re-provision with bridge config and a fresh token.",
    );
  }
  if (!verifyControlToken(controlToken, runtime.control_token_hash)) {
    return reject(
      401,
      "control_token_invalid",
      "The control_token does not match. Use POST /v1/runtimes/:id/rotate-token to mint a fresh one.",
    );
  }

  // Pre-upgrade auth holds. Attach metadata for the in-band handshake.
  const data: BridgeWsData = {
    runtimeId: runtime.id,
    projectId: runtime.project_id,
    identityId: runtime.identity_id,
    mode: runtime.mode as "bridged" | "trusted",
    bridgePubkey: runtime.bridge_pubkey,
    bridgeKeyId: runtime.bridge_key_id,
    llmProvider: runtime.llm_provider,
    llmModel: runtime.llm_model,
    llmVaultKey: runtime.llm_vault_key,
  };

  const upgraded = server.upgrade(req, { data });
  if (upgraded) return { handled: true, response: undefined };
  return {
    handled: true,
    response: new Response(
      JSON.stringify({ error: "upgrade_failed" }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
    ),
  };
}
