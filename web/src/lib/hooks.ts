import { useReadContract } from "wagmi";
import { goalPotAbi } from "./abi";
import { GOALPOT_ADDRESS } from "./config";

/** On-chain Pot struct as decoded by viem. */
export type Pot = {
  name: string;
  creator: `0x${string}`;
  beneficiary: `0x${string}`;
  goal: bigint;
  deadline: bigint | number;
  votingPeriod: bigint | number;
  penaltyBps: number;
  minDeposit: bigint;
  state: number; // 0 Active, 1 Released, 2 Refunding
  totalDeposited: bigint;
  penaltyPool: bigint;
  memberCount: number;
  refundTotal: bigint;
  refundPenalty: bigint;
};

export const goalPot = {
  address: GOALPOT_ADDRESS,
  abi: goalPotAbi,
} as const;

/** Poll interval for live chain data (ms). Kept modest to respect the public RPC. */
export const POLL_MS = 6_000;

export function usePotCount() {
  return useReadContract({
    ...goalPot,
    functionName: "potCount",
    query: { refetchInterval: POLL_MS },
  });
}

export function usePot(potId: bigint) {
  return useReadContract({
    ...goalPot,
    functionName: "getPot",
    args: [potId],
    query: { refetchInterval: POLL_MS },
  });
}

export const STATE_LABEL = ["active", "released", "refunding"] as const;
