import {
  KARMA_HEADER,
  KarmaMirror,
  mintMirrorCredential,
} from "../dist/index.js";

const { key, record } = mintMirrorCredential({
  placement: "node-smoke",
  now: new Date("2026-08-01T00:00:00.000Z"),
});
const mirror = new KarmaMirror({ credentials: [record] });
const response = await mirror.handle(
  new Request("https://mirror.invalid/v1/wake", {
    headers: { authorization: `Bearer ${key}` },
  }),
);
if (response.status !== 200 || !response.headers.get(KARMA_HEADER)) {
  throw new Error("built KARMA Mirror did not answer its planted credential");
}
process.stdout.write("node smoke: KARMA Mirror built handler answers in-band synthetic\n");
