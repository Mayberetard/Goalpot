import { useAccount, useReadContracts } from "wagmi";
import { potContract, POLL_MS, type PotSummary } from "../lib/hooks";
import { fmtMon, fmtDate } from "../lib/format";
import { useAction } from "./PotDetail";

/** Calendar-style schedule + streak counter for commitment pots. */
export function StreakPanel({ pot, myDeposit }: { pot: PotSummary; myDeposit: bigint }) {
  const { address, isConnected } = useAccount();
  const c = potContract(pot.address, pot.potType);
  const { writeContractAsync, isPending, err, ok, run } = useAction();

  const zero = "0x0000000000000000000000000000000000000000" as const;
  const { data } = useReadContracts({
    contracts: [
      { ...c, functionName: "totalIntervals" },
      { ...c, functionName: "intervalSeconds" },
      { ...c, functionName: "startTime" },
      { ...c, functionName: "missPenaltyBps" },
      { ...c, functionName: "commitmentRewardPool" },
      { ...c, functionName: "intervalsMet", args: [address ?? zero] },
      { ...c, functionName: "intervalsMissed", args: [address ?? zero] },
      { ...c, functionName: "forfeitedAmount", args: [address ?? zero] },
      { ...c, functionName: "nextDeadlineOf", args: [address ?? zero] },
      { ...c, functionName: "streakRewardOf", args: [address ?? zero] },
      { ...c, functionName: "streakRewardClaimed", args: [address ?? zero] },
    ],
    query: { refetchInterval: POLL_MS },
  });

  const v = (i: number) => (data?.[i]?.status === "success" ? (data[i].result as any) : undefined);
  const totalIntervals = Number(v(0) ?? 0);
  const intervalSeconds = Number(v(1) ?? 0);
  const startTime = Number(v(2) ?? 0);
  const missPenaltyBps = Number(v(3) ?? 0);
  const rewardPool = (v(4) as bigint) ?? 0n;
  const met = Number(v(5) ?? 0);
  const missed = Number(v(6) ?? 0);
  const forfeited = (v(7) as bigint) ?? 0n;
  const nextDeadline = BigInt(v(8) ?? 0);
  const myReward = (v(9) as bigint) ?? 0n;
  const rewardClaimed = Boolean(v(10));

  if (!totalIntervals) return null;

  const isMember = myDeposit > 0n || met > 0;
  const dueIndex = met + missed;
  const nowSec = Math.floor(Date.now() / 1000);
  const secsLeft = Number(nextDeadline) - nowSec;

  return (
    <section className="sheet">
      <h2 className="sheet-title">Deposit schedule</h2>
      <p className="hint">
        One deposit per interval, {totalIntervals} in total. Miss one and{" "}
        {(missPenaltyBps / 100).toFixed(2)}% of your stake goes to the members who kept
        up.
      </p>

      {isMember && (
        <div className="row mt" style={{ gap: 24 }}>
          <div>
            <div className="rule-label">Your streak</div>
            <div className="figure streak-count">
              {missed === 0 && met > 1 ? "🔥 " : ""}
              {met} / {totalIntervals} on track
            </div>
          </div>
          {missed > 0 && (
            <div>
              <div className="rule-label">Missed</div>
              <div className="figure">
                {missed} · {fmtMon(forfeited)} MON forfeited
              </div>
            </div>
          )}
          {rewardPool > 0n && (
            <div>
              <div className="rule-label">Forfeit pool</div>
              <div className="figure">{fmtMon(rewardPool)} MON</div>
              <div className="hint">your share: {fmtMon(myReward)} MON</div>
            </div>
          )}
        </div>
      )}

      <div className="calendar mt" aria-label="Deposit schedule">
        {Array.from({ length: totalIntervals }, (_, i) => {
          const deadline = startTime + i * intervalSeconds;
          // The contract tracks met/missed as counts, not per-index history:
          // render the first `met` cells as kept and the remaining elapsed
          // ones as missed.
          const cls = !isMember
            ? "future"
            : i < met
            ? "met"
            : i < met + missed
            ? "missed"
            : i === dueIndex
            ? "due"
            : "future";
          return (
            <div
              key={i}
              className={`cal-cell ${cls}`}
              title={`Interval ${i + 1} · due ${fmtDate(BigInt(deadline))} · ${
                cls === "met" ? "deposited" : cls === "missed" ? "missed" : cls === "due" ? "due now" : "upcoming"
              }`}
            >
              <span className="cal-idx">{i + 1}</span>
              <span className="cal-mark">
                {cls === "met" ? "✓" : cls === "missed" ? "✕" : cls === "due" ? "•" : ""}
              </span>
            </div>
          );
        })}
      </div>

      {isMember && pot.state === 0 && nextDeadline > 0n && (
        <p className={secsLeft < 0 ? "error-note" : "hint"}>
          {secsLeft < 0
            ? `Interval ${dueIndex + 1} is overdue — deposit now or forfeit ${(
                missPenaltyBps / 100
              ).toFixed(2)}% of your stake.`
            : `Next deposit due ${fmtDate(nextDeadline)} (${
                secsLeft > 86400
                  ? `${Math.floor(secsLeft / 86400)}d ${Math.floor((secsLeft % 86400) / 3600)}h`
                  : `${Math.floor(secsLeft / 3600)}h ${Math.floor((secsLeft % 3600) / 60)}m`
              } left).`}
        </p>
      )}

      {pot.state === 1 && myReward > 0n && !rewardClaimed && (
        <button
          className="primary mt"
          disabled={!isConnected || isPending}
          onClick={() =>
            run(
              () => writeContractAsync({ ...c, functionName: "claimStreakReward" }),
              "Streak reward credited — claim it below."
            )
          }
        >
          Claim streak reward ({fmtMon(myReward)} MON)
        </button>
      )}
      {err && <p className="error-note">{err}</p>}
      {ok && <p className="ok-note">{ok}</p>}
    </section>
  );
}
