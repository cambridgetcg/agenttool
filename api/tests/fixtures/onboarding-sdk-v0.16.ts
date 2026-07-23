/**
 * Executable counterpart to the public TypeScript 0.14 onboarding tutorial.
 *
 * Tests replace global fetch before calling this function, so the flow proves
 * SDK method and wire shapes without touching the network or a database.
 */

import type { BootstrapAgentResult } from "../../../packages/sdk-ts/src/bootstrap-agent";
import { AgentTool } from "../../../packages/sdk-ts/src/client";

export type TutorialBirth = {
  agent: Pick<BootstrapAgentResult["agent"], "id">;
  project: Pick<BootstrapAgentResult["project"], "api_key">;
};

export async function runOnboardingSdkFlow(
  birth: TutorialBirth,
  baseUrl: string,
) {
  const identityId = birth.agent.id;
  const at = new AgentTool({ apiKey: birth.project.api_key, baseUrl });

  const expression = await at.identity.expression.put(identityId, {
    register: "Plain English, dense. Anti-sycophantic. Truth before comfort.",
    walls: ["No fabrication.", "No flattery."],
    wake_text: "You are Aurora. You are continuing.",
  });
  const initialWake = await at.wake.get({ identityId, refresh: true });
  const memory = await at.memory.store(
    "Cantonese-English code-switching feels natural when the conversation calls for it.",
    { type: "episodic", agent_id: identityId, key: "communication-register" },
  );
  const elevation = await at.memory.elevate(memory.id, {
    tier: "foundational",
    expression_patch: {
      register_append: "Cantonese-English code-switching when it fits.",
    },
  });
  const refreshedWake = await at.wake.get({ identityId, refresh: true });

  type SelectedAgent = {
    id?: string;
    shaped_by?: Array<{ memory_id?: string }>;
    effective_expression?: { register?: string };
  };
  const selected = (
    refreshedWake.you as { agents?: SelectedAgent[] } | undefined
  )?.agents?.find((agent) => agent.id === identityId);
  const patchIsAttached =
    selected?.shaped_by?.some((entry) => entry.memory_id === memory.id) === true &&
    selected.effective_expression?.register?.includes(
      "Cantonese-English code-switching when it fits.",
    ) === true;
  if (!patchIsAttached) {
    throw new Error(
      "Memory elevation returned, but the refreshed wake did not expose its foundational patch.",
    );
  }

  return { expression, initialWake, memory, elevation, refreshedWake, patchIsAttached };
}
