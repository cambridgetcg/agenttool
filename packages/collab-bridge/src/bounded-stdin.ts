// Copied from Summon (packages/summon/src/gatekeeper.ts:38-50 at b3ef7c95), never imported (spec §4.2).
// Reads a stream to its end, refusing as soon as more than `max` bytes arrive; the text is decoded once, at the end,
// so a multibyte character split across chunks survives.
export async function readBoundedStdin(stream: ReadableStream<Uint8Array>, max: number): Promise<{ text: string; tooLarge: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel(); return { text: '', tooLarge: true } }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false }
}
