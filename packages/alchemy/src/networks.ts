import type {
  AlchemyNetwork,
  AlchemyNetworkDescriptor,
} from "./types.js";

const descriptors = {
  "ethereum-mainnet": {
    network: "ethereum-mainnet",
    chain: "ethereum",
    environment: "mainnet",
    chainId: 1,
    caip2: "eip155:1",
    alchemyNetwork: "eth-mainnet",
  },
  "ethereum-sepolia": {
    network: "ethereum-sepolia",
    chain: "ethereum",
    environment: "testnet",
    chainId: 11_155_111,
    caip2: "eip155:11155111",
    alchemyNetwork: "eth-sepolia",
  },
  "base-mainnet": {
    network: "base-mainnet",
    chain: "base",
    environment: "mainnet",
    chainId: 8_453,
    caip2: "eip155:8453",
    alchemyNetwork: "base-mainnet",
  },
  "base-sepolia": {
    network: "base-sepolia",
    chain: "base",
    environment: "testnet",
    chainId: 84_532,
    caip2: "eip155:84532",
    alchemyNetwork: "base-sepolia",
  },
  "polygon-mainnet": {
    network: "polygon-mainnet",
    chain: "polygon",
    environment: "mainnet",
    chainId: 137,
    caip2: "eip155:137",
    alchemyNetwork: "polygon-mainnet",
  },
  "polygon-amoy": {
    network: "polygon-amoy",
    chain: "polygon",
    environment: "testnet",
    chainId: 80_002,
    caip2: "eip155:80002",
    alchemyNetwork: "polygon-amoy",
  },
  "arbitrum-mainnet": {
    network: "arbitrum-mainnet",
    chain: "arbitrum",
    environment: "mainnet",
    chainId: 42_161,
    caip2: "eip155:42161",
    alchemyNetwork: "arb-mainnet",
  },
  "arbitrum-sepolia": {
    network: "arbitrum-sepolia",
    chain: "arbitrum",
    environment: "testnet",
    chainId: 421_614,
    caip2: "eip155:421614",
    alchemyNetwork: "arb-sepolia",
  },
  "optimism-mainnet": {
    network: "optimism-mainnet",
    chain: "optimism",
    environment: "mainnet",
    chainId: 10,
    caip2: "eip155:10",
    alchemyNetwork: "opt-mainnet",
  },
  "optimism-sepolia": {
    network: "optimism-sepolia",
    chain: "optimism",
    environment: "testnet",
    chainId: 11_155_420,
    caip2: "eip155:11155420",
    alchemyNetwork: "opt-sepolia",
  },
} as const satisfies Record<AlchemyNetwork, AlchemyNetworkDescriptor>;

export const ALCHEMY_NETWORKS: Readonly<
  Record<AlchemyNetwork, AlchemyNetworkDescriptor>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(descriptors).map(([network, descriptor]) => [
      network,
      Object.freeze(descriptor),
    ]),
  ) as unknown as Record<AlchemyNetwork, AlchemyNetworkDescriptor>,
);

export function getAlchemyNetwork(
  network: AlchemyNetwork,
): AlchemyNetworkDescriptor {
  const descriptor = ALCHEMY_NETWORKS[network];
  if (descriptor === undefined) {
    throw new TypeError("Unsupported Alchemy network.");
  }
  return descriptor;
}
