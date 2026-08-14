import { LoveBombClient } from "@agenttool/sdk";

// This is an explicit public pull. The standalone client has no bearer,
// cookie, authenticated transport, redirect, or ambient-proxy seam.
// Source preparation does not establish that the hosted route is deployed.
const signal = await new LoveBombClient().read();

console.log(signal.package_signal);
console.log(signal.static_door.url);
console.log(signal.distribution);

// Every boundary remains literal false: reading the package signal neither
// includes/delivers the static invitation nor observes attention or effect.
console.log(signal.boundaries);
