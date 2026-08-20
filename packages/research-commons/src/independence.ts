import { compareUnicode, deepFreeze } from "./canonical.js";
import { fail } from "./errors.js";
import { validateEffectiveController } from "./records.js";
import type { EffectiveController, Sha256Id } from "./types.js";

export interface DeclaredControllerPartition {
  readonly controller_ids: readonly Sha256Id[];
  readonly independence_posture: "DECLARATION_ONLY_NOT_INDEPENDENCE_PROOF";
  readonly independent_identity_proved: false;
}

const ROOT_KEYS = [
  "data_root",
  "funding_root",
  "model_root",
  "operator_root",
  "organization_root",
  "toolchain_root",
] as const;

function find(parents: number[], index: number): number {
  let root = index;
  while (parents[root] !== root) root = parents[root]!;
  while (parents[index] !== index) {
    const next = parents[index]!;
    parents[index] = root;
    index = next;
  }
  return root;
}

function union(parents: number[], left: number, right: number): void {
  const a = find(parents, left);
  const b = find(parents, right);
  if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
}

export function declaredControllerPartitions(
  input: readonly EffectiveController[],
): readonly DeclaredControllerPartition[] {
  const controllers = input.map((controller, index) =>
    validateEffectiveController(controller, `$controllers[${String(index)}]`));
  const ids = controllers.map((controller) => controller.controller_id);
  if (new Set(ids).size !== ids.length) fail("integrity_error", "Controller identifiers must be unique");
  const parents = controllers.map((_, index) => index);
  const rootOwners = new Map<Sha256Id, number>();
  controllers.forEach((controller, index) => {
    for (const key of ROOT_KEYS) {
      const root = controller[key];
      const owner = rootOwners.get(root);
      if (owner === undefined) rootOwners.set(root, index);
      else union(parents, index, owner);
    }
  });
  const groups = new Map<number, Sha256Id[]>();
  controllers.forEach((controller, index) => {
    const root = find(parents, index);
    const group = groups.get(root) ?? [];
    group.push(controller.controller_id);
    groups.set(root, group);
  });
  const partitions = [...groups.values()]
    .map((controllerIds) => ({
      controller_ids: controllerIds.sort(compareUnicode),
      independence_posture: "DECLARATION_ONLY_NOT_INDEPENDENCE_PROOF" as const,
      independent_identity_proved: false as const,
    }))
    .sort((left, right) => compareUnicode(left.controller_ids[0]!, right.controller_ids[0]!));
  return deepFreeze(partitions);
}

export function assertNoDeclaredControllerOverlap(
  controllerIds: readonly Sha256Id[],
  controllers: readonly EffectiveController[],
  path: string,
): void {
  if (new Set(controllerIds).size !== controllerIds.length) {
    fail("independence_error", `${path} repeats a controller identifier`);
  }
  const relevant = new Set(controllerIds);
  const partitions = declaredControllerPartitions(controllers);
  for (const partition of partitions) {
    const overlap = partition.controller_ids.filter((id) => relevant.has(id));
    if (overlap.length > 1) {
      fail(
        "independence_error",
        `${path} shares a declared effective-controller dependency root; declarations are not identity proof`,
      );
    }
  }
}

export function hasNoDeclaredControllerOverlap(
  left: Sha256Id,
  right: Sha256Id,
  controllers: readonly EffectiveController[],
): boolean {
  try {
    assertNoDeclaredControllerOverlap([left, right], controllers, "$controller_pair");
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ResearchCommonsError") return false;
    throw error;
  }
}
