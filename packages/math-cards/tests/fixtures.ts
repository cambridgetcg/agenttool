import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export const vectors = JSON.parse(
  readFileSync(`${root}/vectors/agenttool-math-cards-v0.1.json`, "utf8"),
) as {
  schema_version: string;
  cases: {
    ready_proof: VectorCase;
    incomplete_model: VectorCase;
    redesign_measurement: VectorCase;
    malformed: { input: Record<string, any>; error: { name: string; code: string; message: string } };
  };
};

export interface VectorCase {
  input: Record<string, any>;
  card: Record<string, any>;
  assessment: Record<string, any>;
}

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
