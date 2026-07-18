/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOALPOT_ADDRESS?: string;
  readonly VITE_MONAD_NETWORK?: "testnet" | "mainnet";
  readonly VITE_RPC_URL?: string;
  readonly VITE_WC_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
