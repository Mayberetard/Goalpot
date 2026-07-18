import { formatEther } from "viem";

export function fmtMon(wei: bigint, digits = 4): string {
  const s = formatEther(wei);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, digits).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtDate(unix: bigint | number): string {
  return new Date(Number(unix) * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeLeft(deadline: bigint): string {
  const secs = Number(deadline) - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "closed";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/** Percent of goal reached, clamped for the progress bar. */
export function pct(balance: bigint, goal: bigint): number {
  if (goal === 0n) return 0;
  const p = Number((balance * 10000n) / goal) / 100;
  return Math.min(p, 100);
}
