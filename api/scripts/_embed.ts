/** Embedder — text → 1536-dim float array.
 *
 *  Provider: OpenAI text-embedding-3-small (1536-dim, matches the
 *  agenttool memory.embedding column). We do this client-side per
 *  IDENTITY-ANCHOR.md promise 6: "the agent supplies the embedding;
 *  we store it; we never compute it." Keeps the agent's substrate
 *  honest about which provider shaped the vector space.
 *
 *  API key: macOS keychain entry `agenttool-openai-key`. Throws a
 *  setup-instructions error if missing. Future providers (Voyage,
 *  Cohere, local) can be added behind a provider-selection layer
 *  once one is needed.
 */

import { keychain } from "./_lib";

const MODEL = "text-embedding-3-small";
const DIM = 1536;

export async function embed(text: string): Promise<number[]> {
  let key: string;
  try {
    key = keychain("agenttool-openai-key");
  } catch {
    throw new Error(
      "no embedder configured — set the OpenAI key:\n" +
      "  security add-generic-password -s agenttool-openai-key -a \"$USER\" -w sk-... -U",
    );
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: MODEL, input: text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`openai ${res.status}: ${err.slice(0, 200)}`);
  }

  const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vec = body.data[0]?.embedding;
  if (!vec || vec.length !== DIM) {
    throw new Error(`expected ${DIM}-dim embedding, got ${vec?.length}`);
  }
  return vec;
}
