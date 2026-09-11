// Deterministic TEST ONLY subprocess; no native cryptography or network claim.
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalJson } from "@agenttool/wallet";
import { digest, parse } from "./validation.js";

if(import.meta.main) {
  const request=parse(await Bun.stdin.text());
  if(process.argv[3] !== "--trust-file" || !process.argv.includes("--disposable-test")) process.exit(9);
  const fixture=parse(readFileSync(process.argv[4],"utf8"));
  appendFileSync(fixture.log_path,request.command+"\n",{mode:0o600});
  if(fixture.mode === "oversize") { console.log("x".repeat(262145)); process.exit(0); }
  if(fixture.mode === "stderr") { process.stderr.write("x".repeat(9000)); await Bun.sleep(10000); }
  const obs=fixture.observation;
  const plan=request.plan;
  let result: any;
  const signedSummary=() => {
    const bytes=readFileSync(request.signed_tx_path);
    return {plan_id:plan.plan_id,commitment_hash:plan.commitment_hash,signer_key_id:plan.commitment.signer_key_id,
      sign_doc_bytes_hash:plan.sign_doc_bytes_hash,signed_tx_bytes_hash:digest(bytes),tx_hash:digest(bytes).slice(7).toUpperCase()};
  };
  switch(request.command) {
    case "inspect": result=obs; break;
    case "simulate":
      result={status:"succeeded",plan_id:plan.plan_id,simulation_tx_bytes_hash:plan.simulation_tx_bytes_hash,evidence:obs.evidence,code:0,gas_wanted:"18446744073709551615",gas_used:BigInt(plan.commitment.gas_limit) < 80000n ? "40000":"80000"};
      if(fixture.mode === "stale-simulation") result.evidence={...obs.evidence,latest_height:"101"};
      break;
    case "sign": {
      if(fixture.mode === "missing-key") process.exit(8);
      const fd=openSync(request.signed_tx_path,"wx",0o600);
      try { writeFileSync(fd,Buffer.from(`TEST-ONLY-NOT-A-NATIVE-TX:${plan.plan_id}`)); fsyncSync(fd); } finally {closeSync(fd);}
      if(fixture.mode === "crash-sign") process.exit(8);
      result=signedSummary(); break;
    }
    case "verify": result=signedSummary(); if(fixture.mode === "bad-signed") result.signer_key_id=digest(new Uint8Array([1])); break;
    case "submit": if(fixture.mode === "submit-timeout") await Bun.sleep(10000); result={status:"accepted",tx_hash:request.expected_tx_hash}; break;
    case "lookup":
      if(fixture.mode === "absent") result={status:"absent",tx_hash:request.tx_hash,evidence:obs.evidence};
      else if(fixture.mode === "lookup-unknown") result={status:"unknown",tx_hash:request.tx_hash,reason:"unavailable"};
      else result={status:"included",tx_hash:request.tx_hash,inclusion:obs.evidence.anchor,
        evidence:{...obs.evidence,anchor:{...obs.evidence.anchor,height:"101"},latest_height:"101"},code:["failed","ante-failed"].includes(fixture.mode) ? 7:0,gas_used:"85000",credited_amount_uzrn:["failed","ante-failed","credit-unknown"].includes(fixture.mode) ? null:"222000",claimant_sequence:(BigInt(plan.commitment.sequence)+(fixture.mode === "ante-failed" ? 0n:1n)).toString(),allowance:obs.allowance};
      break;
    default: {
      const bytes=new Uint8Array([10,1,1]);
      result={type_url:request.command === "operator-grant" ? "/cosmos.feegrant.v1beta1.MsgGrantAllowance" : request.command === "operator-revoke" ? "/cosmos.feegrant.v1beta1.MsgRevokeAllowance":"/zerone.claiming_pot.v1.MsgAddBootstrapEntry",value_b64u:Buffer.from(bytes).toString("base64url"),value_hash:digest(bytes)};
    }
  }
  const response: any={protocol:request.protocol,request_id:request.request_id,command:request.command,status:"ok",result};
  if(fixture.mode === "wrong-id") response.request_id="wrong";
  if(fixture.mode === "null") response.result=null;
  if(fixture.mode === "extra") response.secret="reject-not-forward";
  console.log(canonicalJson(response));
}
