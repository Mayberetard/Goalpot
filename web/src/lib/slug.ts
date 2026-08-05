import { keccak256, toHex } from "viem";
import { chain, GOALPOT_ADDRESS } from "./config";

/** Opaque share code for a pot. Derived from chain + contract + id, so links
 *  look like /#/p/9f3ac81d2e40 instead of an enumerable /#/pot/0.
 *  NOTE: pots are public on-chain — this stops casual URL-guessing only;
 *  real access control is the on-chain invite allowlist. */
export function potSlug(potId: bigint): string {
  return keccak256(
    toHex(`goalpot:${chain.id}:${GOALPOT_ADDRESS.toLowerCase()}:${potId}`)
  ).slice(2, 14);
}

/** Resolve a slug back to a pot id by scanning [0, potCount). */
export function resolveSlug(slug: string, potCount: bigint): bigint | null {
  const clean = slug.toLowerCase();
  for (let i = 0n; i < potCount; i++) {
    if (potSlug(i) === clean) return i;
  }
  return null;
}
