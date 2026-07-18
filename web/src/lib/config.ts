import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  testnet: true,
});

export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://monadexplorer.com" },
  },
});

const useMainnet = import.meta.env.VITE_MONAD_NETWORK === "mainnet";
export const chain = useMainnet ? monadMainnet : monadTestnet;

/** Deployed GoalPot contract. Set via web/.env → VITE_GOALPOT_ADDRESS=0x... */
export const GOALPOT_ADDRESS = (import.meta.env.VITE_GOALPOT_ADDRESS ?? "") as `0x${string}`;

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: {
    // VITE_RPC_URL is a dev-only override (e.g. a local node); defaults to the
    // chain's public RPC.
    [monadTestnet.id]: http(import.meta.env.VITE_RPC_URL, { batch: true }),
    [monadMainnet.id]: http(import.meta.env.VITE_RPC_URL, { batch: true }),
  },
});

export const explorerUrl = chain.blockExplorers!.default.url;
