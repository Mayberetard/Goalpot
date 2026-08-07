import { useReadContract, useReadContracts } from "wagmi";
import {
  goalPotFactoryAbi,
  standardPotAbi,
  streakPotAbi,
  charityPotAbi,
} from "./abi";
import { FACTORY_ADDRESS } from "./config";

export const POT_TYPE = {
  Standard: 0,
  Streak: 1,
  Charity: 2,
} as const;
export type PotType = (typeof POT_TYPE)[keyof typeof POT_TYPE];

export const POT_TYPE_LABEL: Record<number, string> = {
  0: "standard",
  1: "streak",
  2: "charity",
};

export const STATE_LABEL = ["active", "released", "refunding"] as const;

/** Poll interval for live chain data (ms). Modest, to respect the public RPC. */
export const POLL_MS = 6_000;

export const factory = {
  address: FACTORY_ADDRESS,
  abi: goalPotFactoryAbi,
} as const;

/** The right ABI for a pot's type — supersets, so reads are safe either way. */
export function abiFor(potType: number) {
  if (potType === POT_TYPE.Streak) return streakPotAbi;
  if (potType === POT_TYPE.Charity) return charityPotAbi;
  return standardPotAbi;
}

export function potContract(address: `0x${string}`, potType = 0) {
  return { address, abi: abiFor(potType) } as const;
}

/** Core fields every pot exposes, read in one multicall. */
export type PotSummary = {
  address: `0x${string}`;
  potType: number;
  name: string;
  creator: `0x${string}`;
  beneficiary: `0x${string}`;
  goal: bigint;
  deadline: bigint;
  penaltyBps: number;
  minDeposit: bigint;
  votingPeriod: bigint;
  openJoin: boolean;
  state: number;
  totalDeposited: bigint;
  penaltyPool: bigint;
  memberCount: number;
  refundTotal: bigint;
  refundPenalty: bigint;
};

const SUMMARY_FIELDS = [
  "name",
  "creator",
  "beneficiary",
  "goal",
  "deadline",
  "penaltyBps",
  "minDeposit",
  "votingPeriod",
  "openJoin",
  "state",
  "totalDeposited",
  "penaltyPool",
  "memberCount",
  "refundTotal",
  "refundPenalty",
  "potType",
] as const;

function summaryCalls(address: `0x${string}`) {
  return SUMMARY_FIELDS.map((functionName) => ({
    address,
    abi: standardPotAbi,
    functionName,
  }));
}

function toSummary(address: `0x${string}`, results: readonly any[]): PotSummary | null {
  if (results.some((r) => r?.status !== "success")) return null;
  const v = results.map((r) => r.result);
  return {
    address,
    name: v[0] as string,
    creator: v[1] as `0x${string}`,
    beneficiary: v[2] as `0x${string}`,
    goal: v[3] as bigint,
    deadline: BigInt(v[4] as any),
    penaltyBps: Number(v[5]),
    minDeposit: v[6] as bigint,
    votingPeriod: BigInt(v[7] as any),
    openJoin: v[8] as boolean,
    state: Number(v[9]),
    totalDeposited: v[10] as bigint,
    penaltyPool: v[11] as bigint,
    memberCount: Number(v[12]),
    refundTotal: v[13] as bigint,
    refundPenalty: v[14] as bigint,
    potType: Number(v[15]),
  };
}

export function usePotCount() {
  return useReadContract({
    ...factory,
    functionName: "potCount",
    query: { refetchInterval: POLL_MS, enabled: !!FACTORY_ADDRESS },
  });
}

/** Addresses of every pot the factory has created. */
export function usePotAddresses() {
  const { data: count, ...rest } = usePotCount();
  const n = Number(count ?? 0n);
  const list = useReadContract({
    ...factory,
    functionName: "getPots",
    args: [0n, 200n],
    query: { enabled: n > 0, refetchInterval: POLL_MS },
  });
  const addrs = ((list.data as any)?.[0] ?? []) as readonly `0x${string}`[];
  return { addresses: addrs, count: n, isLoading: rest.isLoading || list.isLoading, error: rest.error ?? list.error };
}

/** Summaries for a list of pots (one multicall batch per pot). */
export function usePotSummaries(addresses: readonly `0x${string}`[]) {
  const { data } = useReadContracts({
    contracts: addresses.flatMap((a) => summaryCalls(a)),
    query: { enabled: addresses.length > 0, refetchInterval: POLL_MS },
  });
  if (!data) return [];
  const per = SUMMARY_FIELDS.length;
  return addresses
    .map((a, i) => toSummary(a, data.slice(i * per, (i + 1) * per)))
    .filter((p): p is PotSummary => p !== null);
}

/** Full summary for a single pot. */
export function usePot(address?: `0x${string}`) {
  const { data, error, isLoading } = useReadContracts({
    contracts: address ? summaryCalls(address) : [],
    query: { enabled: !!address, refetchInterval: POLL_MS },
  });
  const pot = address && data ? toSummary(address, data) : null;
  return { pot, error, isLoading };
}
