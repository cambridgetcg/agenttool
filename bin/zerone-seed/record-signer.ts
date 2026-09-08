import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { canonicalJson } from "@agenttool/wallet";
import { b64, check, closed, parse, readBounded } from "./validation.js";

/** Explicit one-shot software-custody reference. No key creation, discovery or export API. */
export async function runRecordSigner(argv: string[]): Promise<unknown> {
  check(argv.length === 5 && argv[0] === "sign-digest" && argv[1] === "--key-file" && argv[3] === "--expected-public-key");
  b64(argv[4],32);
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of Bun.stdin.stream()) { size += chunk.byteLength; check(size <= 1024); chunks.push(chunk); }
  const request = parse(Buffer.concat(chunks).toString("utf8"));
  closed(request,"protocol digest_b64u"); check(request.protocol === "zerone-seed-record-signer/0.1");
  const digest = b64(request.digest_b64u,32);
  // Private bytes exist only inside this separately invoked process. Never returned or logged.
  const pem = readBounded(argv[2],16384,true);
  let key;
  try {
    check(Buffer.from(pem).toString("ascii").startsWith("-----BEGIN PRIVATE KEY-----\n"));
    key = createPrivateKey({key:Buffer.from(pem),format:"pem",type:"pkcs8"});
  } finally { pem.fill(0); }
  check(key.asymmetricKeyType === "ed25519");
  const publicJwk = createPublicKey(key).export({format:"jwk"});
  check(publicJwk.kty === "OKP" && publicJwk.crv === "Ed25519" && publicJwk.x === argv[4],"record_provider_mismatch");
  return {protocol:"zerone-seed-record-signer/0.1",algorithm:"Ed25519",public_key:publicJwk.x,signature:sign(null,digest,key).toString("base64url")};
}
if (import.meta.main) {
  try { console.log(canonicalJson(await runRecordSigner(process.argv.slice(2)))); }
  catch { console.log(canonicalJson({status:"error",code:"record_signer_failed"})); process.exitCode=1; }
}
