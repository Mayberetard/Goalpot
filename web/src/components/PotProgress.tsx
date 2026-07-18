import { fmtMon, pct } from "../lib/format";

export function PotProgress({ balance, goal }: { balance: bigint; goal: bigint }) {
  const p = pct(balance, goal);
  const full = balance >= goal;
  return (
    <div>
      <div className="pot-progress" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`fill${full ? " full" : ""}`} style={{ width: `${p}%` }} />
        <div className="marks" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className="label">
          {fmtMon(balance)} / {fmtMon(goal)} MON · {p.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
