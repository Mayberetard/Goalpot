import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { isAddress, parseEther } from "viem";
import { goalPot } from "../lib/hooks";

const DAY = 86_400;

export function CreatePot({ onDone }: { onDone: (id?: bigint) => void }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  const [name, setName] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [goal, setGoal] = useState("");
  const [days, setDays] = useState("30");
  const [penalty, setPenalty] = useState("5");
  const [minDeposit, setMinDeposit] = useState("0.1");
  const [votingHours, setVotingHours] = useState("72");
  const [visibility, setVisibility] = useState<"open" | "invite">("open");
  const [inviteesRaw, setInviteesRaw] = useState("");
  const [err, setErr] = useState("");
  const [waiting, setWaiting] = useState(false);

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

      const deadline = Math.floor(Date.now() / 1000) + Math.round(durationDays * DAY);

      const invitees = inviteesRaw
        .split(/[\s,;]+/)
        .map((a) => a.trim())
        .filter(Boolean);
      if (visibility === "invite") {
        if (invitees.length > 100) throw new Error("At most 100 invitees at creation.");
        for (const a of invitees) {
          if (!isAddress(a)) throw new Error(`Not a valid address: ${a.slice(0, 20)}…`);
        }
      }

      const hash = await writeContractAsync({
        ...goalPot,
        functionName: "createPot",
        args: [
          name.trim(),
          dest as `0x${string}`,
          goalWei,
          deadline,
          penaltyBps,
          minWei,
          votingSecs,
          visibility === "open",
          visibility === "invite" ? (invitees as `0x${string}`[]) : [],
        ],
      });
      setWaiting(true);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      // PotCreated is the first log from our contract; potId is topic[1].
      const log = receipt.logs.find(
        (l) => l.address.toLowerCase() === goalPot.address.toLowerCase()
      );
      const id = log?.topics[1] ? BigInt(log.topics[1]) : undefined;
      onDone(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setWaiting(false);
    }
  }

  return (
    <section className="sheet">
      <h2 className="sheet-title">Open a new pot</h2>
      <p className="hint">
        Set the terms once — the contract enforces them forever after. Goal reached →
        funds release to the beneficiary. Deadline missed → everyone withdraws their
        stake back. Leaving early costs the penalty and needs a majority of the other
        members' deposited weight.
      </p>
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
        <label className="field">
          <span>Beneficiary (receives funds on success — defaults to you)</span>
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
            <span>Minimum first deposit (MON)</span>
            <input value={minDeposit} onChange={(e) => setMinDeposit(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Exit-vote window (hours)</span>
            <input value={votingHours} onChange={(e) => setVotingHours(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>Who can join?</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "open" | "invite")}
            >
              <option value="open">Open — anyone with the link</option>
              <option value="invite">Invite-only — addresses I approve</option>
            </select>
          </label>
        </div>
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
