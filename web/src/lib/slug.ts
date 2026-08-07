import { keccak256, toHex } from "viem";
import { chain } from "./config";

/** Opaque share code for a pot, derived from its clone address. Keeps invite
 *  links from being enumerable (`/#/p/9f3ac81d2e40`, not `/#/pot/0`).
 *  NOTE: pots are public on-chain — this stops casual URL-guessing only;
 *  real access control is the on-chain invite allowlist. */
export function potSlug(address: string): string {
  return keccak256(toHex(`goalpot:${chain.id}:${address.toLowerCase()}`)).slice(2, 14);
}

/** Resolve a share code back to a pot address. */
export function resolveSlug(
  slug: string,
  addresses: readonly `0x${string}`[]
): `0x${string}` | null {
  const clean = slug.toLowerCase();
  return addresses.find((a) => potSlug(a) === clean) ?? null;
}
