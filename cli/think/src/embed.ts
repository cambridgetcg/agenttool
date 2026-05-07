/** Embedding provider — OpenAI text-embedding-3-small (1536-dim).
 *
 *  Optional. If `embedding_provider` isn't configured, consolidate skips
 *  the embedding and the memory is list-retrievable but not cosine-
 *  searchable until the agent embeds it later.
 *
 *  We support OpenAI here because text-embedding-3-small defaults to 1536
 *  dimensions which matches our memory.memories.embedding column. Voyage
 *  (1024) and Cohere (1024 / 4096) would need padding/truncation; deferred. */

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(private apiKey: string, private model = "text-embedding-3-small") {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        // text-embedding-3-small defaults to 1536; explicit for clarity.
        dimensions: 1536,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    const vec = data.data[0]?.embedding;
    if (!vec || vec.length !== 1536) {
      throw new Error(
        `OpenAI returned embedding of length ${vec?.length ?? "?"}, expected 1536`,
      );
    }
    return vec;
  }
}

export function buildEmbedder(name: "openai", apiKey: string, model?: string): EmbeddingProvider {
  if (name === "openai") return new OpenAIEmbeddingProvider(apiKey, model);
  throw new Error(`Unknown embedding provider: ${name}`);
}
