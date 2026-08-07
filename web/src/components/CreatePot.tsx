import { useState } from "react";
import { useAccount, useDisconnect, usePublicClient, useWriteContract } from "wagmi";
import { isAddress, parseEther, decodeEventLog } from "viem";
import { factory, POT_TYPE } from "../lib/hooks";
import { goalPotFactoryAbi } from "../lib/abi";
import { isStaleConnectorError, STALE_SESSION_MSG } from "../lib/errors";
import { TEMPLATES, type Template } from "../lib/templates";

const DAY = 86_400;

const TYPE_COPY: Record<number, { label: string; blurb: string }> = {
  0: {
    label: "Standard",
    blurb:
      "Pool toward a shared goal. Goal reached → funds release to the beneficiary. Deadline missed → everyone refunded.",
  },
  1: {
    label: "Streak",
    blurb:
      "Everyone deposits on a fixed cadence. Miss an interval and you forfeit a slice of your stake to the members who kept up.",
  },
  2: {
    label: "Charity",
    blurb:
      "Crowdfund a named cause. Goal met → the charity is paid. Goal missed → every donor is refunded, always.",
  },
};

export function CreatePot({ onDone }: { onDone: (address?: string) => void }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  const [potType, setPotType] = useState<number>(POT_TYPE.Standard);
  const [name, setName] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState("30");
  const [penalty, setPenalty] = useState("5");
  const [minDeposit, setMinDeposit] = useState("0.1");
  const [votingHours, setVotingHours] = useState("72");
  const [visibility, setVisibility] = useState<"open" | "invite">("open");
  const [inviteesRaw, setInviteesRaw] = useState("");
  // streak
  const [intervalDays, setIntervalDays] = useState("7");
  const [totalIntervals, setTotalIntervals] = useState("12");
  const [missPenalty, setMissPenalty] = useState("10");
  const [startHours, setStartHours] = useState("24");
  // charity
  const [charityName, setCharityName] = useState("");
  const [registrationHash, setRegistrationHash] = useState("");

  const [err, setErr] = useState("");
  const [waiting, setWaiting] = useState(false);

  function applyTemplate(t: Template) {
    setPotType(t.potType);
    setName(t.name);
    setGoal(t.goal);
    setDays(String(t.days));
    setPenalty(t.penaltyPct);
    setMinDeposit(t.minDeposit);
    setVotingHours(String(t.votingHours));
    if (t.intervalDays) setIntervalDays(String(t.intervalDays));
    if (t.totalIntervals) setTotalIntervals(String(t.totalIntervals));
    if (t.missPenaltyPct) setMissPenalty(t.missPenaltyPct);
    if (t.charityName) setCharityName(t.charityName);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const nameBytes = new TextEncoder().encode(name.trim());
      if (nameBytes.length === 0 || nameBytes.length > 64)
        throw new Error("Name must be 1–64 bytes.");
      const dest = (beneficiary.trim() || address) as string;
      if (!dest || !isAddress(dest)) throw new Error("Beneficiary is not a valid address.");
      const goalWei = parseEther(goal as `${number}`);
      if (goalWei <= 0n) throw new Error("Goal must be positive.");
      const durationDays = Number(days);
      if (!Number.isFinite(durationDays) || durationDays <= 0 || durationDays > 3650)
        throw new Error("Duration must be between 0 and 3650 days.");
      const penaltyBps = Math.round(Number(penalty) * 100);
      if (!Number.isFinite(penaltyBps) || penaltyBps < 0 || penaltyBps > 2000)
        throw new Error("Penalty must be between 0% and 20%.");
      const minWei = parseEther((minDeposit || "0") as `${number}`);
      const votingSecs = Math.round(Number(votingHours) * 3600);
      if (!Number.isFinite(votingSecs) || votingSecs < 300 || votingSecs > 30 * DAY)
        throw new Error("Voting window must be between 5 minutes and 30 days.");

      const nowSec = Math.floor(Date.now() / 1000);
      const deadline = nowSec + Math.round(durationDays * DAY);

      const invitees = inviteesRaw
        .split(/[\s,;]+/)
        .map((a) => a.trim())
        .filter(Boolean);
      if (visibility === "invite") {
        if (invitees.length > 100) throw new Error("At most 100 invitees at creation.");
        for (const a of invitees)
          if (!isAddress(a)) throw new Error(`Not a valid address: ${a.slice(0, 20)}…`);
      }

      const p = {
        name: name.trim(),
        creator: dest as `0x${string}`, // overwritten by the factory with msg.sender
        beneficiary: dest as `0x${string}`,
        goal: goalWei,
        deadline,
        penaltyBps,
        minDeposit: minWei,
        votingPeriod: votingSecs,
        openJoin: visibility === "open",
      };
      const inviteList = visibility === "invite" ? (invitees as `0x${string}`[]) : [];

      let hash: `0x${string}`;
      if (potType === POT_TYPE.Streak) {
        const intervalSecs = Math.round(Number(intervalDays) * DAY);
        const intervals = Number(totalIntervals);
        const missBps = Math.round(Number(missPenalty) * 100);
        const startTime = nowSec + Math.round(Number(startHours) * 3600);
        if (!Number.isFinite(intervalSecs) || intervalSecs < 3600)
          throw new Error("Interval must be at least 1 hour.");
        if (!Number.isFinite(intervals) || intervals < 1 || intervals > 52)
          throw new Error("Intervals must be between 1 and 52.");
        if (!Number.isFinite(missBps) || missBps < 0 || missBps > 2000)
          throw new Error("Miss penalty must be between 0% and 20%.");
        if (startTime > deadline)
          throw new Error("The first deposit deadline must fall before the pot deadline.");
        hash = await writeContractAsync({
          ...factory,
          functionName: "createStreakPot",
          args: [
            p,
            inviteList,
            {
              intervalSeconds: intervalSecs,
              startTime,
              missPenaltyBps: missBps,
              totalIntervals: intervals,
            },
          ],
        });
      } else if (potType === POT_TYPE.Charity) {
        const cn = charityName.trim();
        if (cn.length === 0 || cn.length > 64)
          throw new Error("Charity name must be 1–64 characters.");
        hash = await writeContractAsync({
          ...factory,
          functionName: "createCharityPot",
          args: [p, inviteList, { charityName: cn, registrationHash: registrationHash.trim() }],
        });
      } else {
        hash = await writeContractAsync({
          ...factory,
          functionName: "createStandardPot",
          args: [p, inviteList],
        });
      }

      setWaiting(true);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      let clone: string | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== factory.address.toLowerCase()) continue;
        try {
          const parsed = decodeEventLog({
            abi: goalPotFactoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (parsed.eventName === "PotCreated") {
            clone = (parsed.args as any).clone as string;
            break;
          }
        } catch {
          /* not the event we're after */
        }
      }
      onDone(clone);
    } catch (e) {
      if (isStaleConnectorError(e)) {
        disconnect();
        setErr(STALE_SESSION_MSG);
      } else {
        setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    } finally {
      setWaiting(false);
    }
  }

  return (
    <section className="sheet">
      <h2 className="sheet-title">Open a new pot</h2>

      <div className="rule-label mt">Start from a template</div>
      <div className="template-row">
        {TEMPLATES.map((t) => (
          <button
            type="button"
            key={t.id}
            className="template-card"
            onClick={() => applyTemplate(t)}
          >
            <b>{t.label}</b>
            <small>{t.blurb}</small>
          </button>
        ))}
      </div>

      <div className="rule-label mt">Pot type</div>
      <div className="row type-row">
        {[POT_TYPE.Standard, POT_TYPE.Streak, POT_TYPE.Charity].map((t) => (
          <button
            type="button"
            key={t}
            className={potType === t ? "chip active" : "chip"}
            onClick={() => setPotType(t)}
          >
            {TYPE_COPY[t].label}
          </button>
        ))}
      </div>
      <p className="hint">{TYPE_COPY[potType].blurb}</p>

      <form onSubmit={submit}>
        <label className="field">
          <span>Pot name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lisbon trip fund"
            maxLength={64}
            required
          />
        </label>

        {potType === POT_TYPE.Charity && (
          <>
            <label className="field">
              <span>Charity name</span>
              <input
                value={charityName}
                onChange={(e) => setCharityName(e.target.value)}
                placeholder="Clean Water Fund"
                maxLength={64}
                required
              />
            </label>
            <label className="field">
              <span>Registration document hash (IPFS, optional)</span>
              <input
                value={registrationHash}
                onChange={(e) => setRegistrationHash(e.target.value)}
                placeholder="Qm…"
              />
            </label>
          </>
        )}

        <label className="field">
          <span>
            {potType === POT_TYPE.Charity ? "Charity payout address" : "Beneficiary"} (
            defaults to you)
          </span>
          <input
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            placeholder={address ?? "0x…"}
          />
        </label>

        <div className="form-grid">
          <label className="field">
            <span>Goal (MON)</span>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="10" required inputMode="decimal" />
          </label>
          <label className="field">
            <span>Deadline (days from now)</span>
            <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>Early-exit penalty (%)</span>
            <input value={penalty} onChange={(e) => setPenalty(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Minimum first {potType === POT_TYPE.Charity ? "donation" : "deposit"} (MON)</span>
            <input value={minDeposit} onChange={(e) => setMinDeposit(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Exit-vote window (hours)</span>
            <input value={votingHours} onChange={(e) => setVotingHours(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>Who can join?</span>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
              <option value="open">Open — anyone with the link</option>
              <option value="invite">Invite-only — addresses I approve</option>
            </select>
          </label>
        </div>

        {potType === POT_TYPE.Streak && (
          <>
            <div className="rule-label mt">Deposit schedule</div>
            <div className="form-grid">
              <label className="field">
                <span>Deposit every (days)</span>
                <input value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} inputMode="numeric" />
              </label>
              <label className="field">
                <span>Number of intervals (max 52)</span>
                <input value={totalIntervals} onChange={(e) => setTotalIntervals(e.target.value)} inputMode="numeric" />
              </label>
              <label className="field">
                <span>Missed-interval forfeit (%)</span>
                <input value={missPenalty} onChange={(e) => setMissPenalty(e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Joining closes in (hours)</span>
                <input value={startHours} onChange={(e) => setStartHours(e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <p className="hint">
              Everyone joins before the first deadline; nobody can join a streak already
              in progress. Forfeits are shared out by intervals met.
            </p>
          </>
        )}

        {visibility === "invite" && (
          <label className="field">
            <span>Invite addresses (one per line — you can add more later)</span>
            <textarea
              value={inviteesRaw}
              onChange={(e) => setInviteesRaw(e.target.value)}
              placeholder={"0xabc…\n0xdef…"}
              rows={3}
            />
          </label>
        )}

        <div className="row mt">
          <button className="primary" type="submit" disabled={!isConnected || isPending || waiting}>
            {waiting ? "Confirming…" : isPending ? "Sign in wallet…" : "Open pot"}
          </button>
          {!isConnected && <span className="hint">Connect a wallet first.</span>}
        </div>
        {err && <p className="error-note">{err}</p>}
      </form>
      <button className="crumb" onClick={() => onDone()}>
        ← back to the ledger
      </button>
    </section>
  );
}
