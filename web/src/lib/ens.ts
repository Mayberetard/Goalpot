import { useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { ensChain } from "./config";
import { shortAddr } from "./format";

/** ENS lives on Ethereum mainnet, not Monad, so reverse lookups go to a
 *  separate read-only client. Failures are silent: the UI falls back to
 *  shortened addresses and never blocks on this. */
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(ensChain.rpc, { batch: true, retryCount: 0 }),
});

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

async function lookup(address: Address): Promise<string | null> {
  const key = address.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  if (inflight.has(key)) return inflight.get(key)!;

  const p = ensClient
    .getEnsName({ address })
    .then((n) => {
      cache.set(key, n ?? null);
      return n ?? null;
    })
    .catch(() => {
      cache.set(key, null); // don't retry a failing endpoint per render
      return null;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** ENS name for one address, or null while loading/absent. */
export function useEnsName(address?: string): string | null {
  const [name, setName] = useState<string | null>(
    address ? cache.get(address.toLowerCase()) ?? null : null
  );
  useEffect(() => {
    let live = true;
    if (!address) return;
    lookup(address as Address).then((n) => live && setName(n));
    return () => {
      live = false;
    };
  }, [address]);
  return name;
}

/** ENS name if there is one, else a shortened address. */
export function useDisplayName(address?: string): string {
  const name = useEnsName(address);
  if (!address) return "";
  return name ?? shortAddr(address);
}
