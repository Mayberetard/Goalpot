import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
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

/** Deployed GoalPotFactory. Set via web/.env → VITE_FACTORY_ADDRESS=0x... */
export const FACTORY_ADDRESS = (import.meta.env.VITE_FACTORY_ADDRESS ?? "") as `0x${string}`;

/** WalletConnect project id (free at https://cloud.reown.com). Optional. */
export const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID ?? "";

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [
    injected(),
    ...(WC_PROJECT_ID
      ? [
          walletConnect({
            projectId: WC_PROJECT_ID,
            showQrModal: true,
            metadata: {
              name: "Goalpot",
              description: "Group savings pots on Monad with DAO-gated early exit",
              url: typeof window !== "undefined" ? window.location.origin : "",
              icons: [],
            },
          }),
        ]
      : []),
  ],
  transports: {
    // VITE_RPC_URL is a dev-only override (e.g. a local node); defaults to the
    // chain's public RPC.
    [monadTestnet.id]: http(import.meta.env.VITE_RPC_URL, { batch: true }),
    [monadMainnet.id]: http(import.meta.env.VITE_RPC_URL, { batch: true }),
  },
});

export const explorerUrl = chain.blockExplorers!.default.url;

/** Mainnet, for ENS reverse lookups only — names don't live on Monad. */
export const ensChain = {
  id: 1,
  rpc: import.meta.env.VITE_ENS_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
};
