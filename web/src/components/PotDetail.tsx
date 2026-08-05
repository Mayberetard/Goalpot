import { useState } from "react";
import { useAccount, useDisconnect, useReadContract, useWriteContract } from "wagmi";
import { isStaleConnectorError, STALE_SESSION_MSG } from "../lib/errors";
import { parseEther } from "viem";
import { goalPot, usePot, POLL_MS, STATE_LABEL, type Pot } from "../lib/hooks";
import { explorerUrl } from "../lib/config";
import { fmtMon, fmtDate, shortAddr, timeLeft } from "../lib/format";
import { PotProgress } from "./PotProgress";
import { InvitePanel } from "./InvitePanel";

function useAction() {
  const { writeContractAsync, isPending } = useWriteContract();
  const { disconnect } = useDisconnect();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setErr("");
    setOk("");
    try {
      await fn();
      setOk(okMsg);
    } catch (e) {
      if (isStaleConnectorError(e)) {
        disconnect();
        setErr(STALE_SESSION_MSG);
      } else {
        setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    }
  }
  return { writeContractAsync, isPending, err, ok, run };
}

export function PotDetail({ potId, onBack }: { potId: bigint; onBack: () => void }) {
  const { address } = useAccount();
  const { data: potData, error } = usePot(potId);
  const pot = potData as unknown as Pot | undefined;

  const { data: myDeposit } = useReadContract({
    ...goalPot,
    functionName: "depositOf",
    args: [potId, address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: POLL_MS },
  });
  const { data: invited } = useReadContract({
    ...goalPot,
    functionName: "invitedOf",
    args: [potId, address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: POLL_MS },
  });

  if (error) {
    const notFound = /PotNotFound|reverted/i.test(error.message);
    return (
      <section className="sheet">
        {notFound ? (
          <>
            <div className="rule-label">No such entry</div>
            <p>
              This pot doesn't exist on the current contract — the link may be
              from an older deployment, or the pot hasn't been created yet.
            </p>
          </>
        ) : (
          <p className="error-note">RPC unreachable: {error.message.split("\n")[0]}</p>
        )}
        <button className="crumb" onClick={onBack}>← back to the ledger</button>
      </section>
    );
  }
  if (!pot) return <section className="sheet"><p className="empty-note">Reading the chain…</p></section>;

  const balance = pot.totalDeposited + pot.penaltyPool;
  const deadlinePassed = Number(pot.deadline) * 1000 < Date.now();
  const goalReached = balance >= pot.goal;

  return (
    <>
      <section className="sheet">
        <div className="row spread">
          <div>
            <div className="rule-label">Pot Nº {String(potId).padStart(3, "0")}</div>
            <h2 className="sheet-title">{pot.name}</h2>
          </div>
          <div className="row">
            {!pot.openJoin && <span className="stamp active">invite-only</span>}
            <span className={`stamp ${STATE_LABEL[pot.state]}`}>{STATE_LABEL[pot.state]}</span>
          </div>
        </div>

        <div className="mt">
          <PotProgress balance={balance} goal={pot.goal} />
        </div>

        <div className="row mt" style={{ gap: 24 }}>
          <div>
            <div className="rule-label">Deadline</div>
            <div className="figure">{fmtDate(pot.deadline)}</div>
            <div className="hint">{pot.state === 0 ? timeLeft(BigInt(pot.deadline)) : "settled"}</div>
          </div>
          <div>
            <div className="rule-label">Early-exit penalty</div>
            <div className="figure">{(pot.penaltyBps / 100).toFixed(2)}%</div>
          </div>
          <div>
            <div className="rule-label">Min. first deposit</div>
            <div className="figure">{fmtMon(pot.minDeposit)} MON</div>
          </div>
          <div>
            <div className="rule-label">Beneficiary</div>
            <div className="figure">
              <a href={`${explorerUrl}/address/${pot.beneficiary}`} target="_blank" rel="noreferrer">
                {shortAddr(pot.beneficiary)}
              </a>
            </div>
          </div>
          {pot.penaltyPool > 0n && (
            <div>
              <div className="rule-label">Penalty pool</div>
              <div className="figure">{fmtMon(pot.penaltyPool)} MON</div>
            </div>
          )}
        </div>
      </section>

      {pot.state === 0 && (
        <ActionsPanel
          potId={potId}
          pot={pot}
          myDeposit={(myDeposit as bigint | undefined) ?? 0n}
          invited={(invited as boolean | undefined) ?? false}
          goalReached={goalReached}
          deadlinePassed={deadlinePassed}
        />
      )}
      {pot.state === 0 && !deadlinePassed && <InvitePanel potId={potId} pot={pot} />}
      {pot.state === 2 && (
        <RefundPanel potId={potId} myDeposit={(myDeposit as bigint | undefined) ?? 0n} pot={pot} />
      )}
      {pot.state === 0 && !deadlinePassed && (
        <ExitPanel potId={potId} pot={pot} myDeposit={(myDeposit as bigint | undefined) ?? 0n} />
      )}

      <MembersTable potId={potId} me={address} />

      <button className="crumb" onClick={onBack}>← back to the ledger</button>
    </>
  );
}

function ActionsPanel({
  potId,
  pot,
  myDeposit,
  invited,
  goalReached,
  deadlinePassed,
}: {
  potId: bigint;
  pot: Pot;
  myDeposit: bigint;
  invited: boolean;
  goalReached: boolean;
  deadlinePassed: boolean;
}) {
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const { writeContractAsync, isPending, err, ok, run } = useAction();

  const notInvited = !pot.openJoin && myDeposit === 0n && !invited;
  const depositDisabled = !isConnected || isPending || deadlinePassed || notInvited;

  return (
    <section className="sheet">
      <h2 className="sheet-title">Pay in</h2>
      {myDeposit > 0n && (
        <p className="hint">Your stake: <b className="figure">{fmtMon(myDeposit)} MON</b></p>
      )}
      {isConnected && notInvited && (
        <p className="hint">
          This pot is invite-only and your address isn't on the allowlist yet — ask
          the pot creator to invite you.
        </p>
      )}
      {!deadlinePassed && (
        <div className="row mt">
          <input
            style={{ maxWidth: 200 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`min ${fmtMon(pot.minDeposit)} MON`}
            inputMode="decimal"
            aria-label="Deposit amount in MON"
          />
          <button
            className="primary"
            disabled={depositDisabled}
            onClick={() =>
              run(async () => {
                const wei = parseEther(amount as `${number}`);
                if (wei <= 0n) throw new Error("Enter a positive amount.");
                await writeContractAsync({
                  ...goalPot,
                  functionName: "deposit",
                  args: [potId],
                  value: wei,
                });
                setAmount("");
              }, "Deposit sent. The ledger updates as the chain confirms.")
            }
          >
            Deposit
          </button>
        </div>
      )}

      {goalReached && (
        <div className="mt">
          <p className="hint">The goal is met. Anyone may release the pot to the beneficiary.</p>
          <button
            className="approve"
            disabled={!isConnected || isPending}
            onClick={() =>
              run(
                () =>
                  writeContractAsync({ ...goalPot, functionName: "release", args: [potId] }),
                "Release sent."
              )
            }
          >
            Release {fmtMon(pot.totalDeposited + pot.penaltyPool)} MON → beneficiary
          </button>
        </div>
      )}

      {deadlinePassed && !goalReached && (
        <div className="mt">
          <p className="hint">Deadline missed. Claim below to flip the pot to refunds and take your share back.</p>
          <button
            disabled={!isConnected || isPending || myDeposit === 0n}
            onClick={() =>
              run(
                () =>
                  writeContractAsync({ ...goalPot, functionName: "claimRefund", args: [potId] }),
                "Refund claimed."
              )
            }
          >
            Claim refund
          </button>
        </div>
      )}
      {err && <p className="error-note">{err}</p>}
      {ok && <p className="ok-note">{ok}</p>}
    </section>
  );
}

function RefundPanel({ potId, myDeposit, pot }: { potId: bigint; myDeposit: bigint; pot: Pot }) {
  const { isConnected } = useAccount();
  const { writeContractAsync, isPending, err, ok, run } = useAction();
  const bonus = pot.refundTotal > 0n ? (pot.refundPenalty * myDeposit) / pot.refundTotal : 0n;
  return (
    <section className="sheet">
      <h2 className="sheet-title">Refunds open</h2>
      <p className="hint">
        The deadline passed before the goal was met. Every member pulls back their own
        stake, plus their share of any early-exit penalties.
      </p>
      {myDeposit > 0n ? (
        <button
          className="primary mt"
          disabled={!isConnected || isPending}
          onClick={() =>
            run(
              () => writeContractAsync({ ...goalPot, functionName: "claimRefund", args: [potId] }),
              "Refund claimed."
            )
          }
        >
          Claim {fmtMon(myDeposit + bonus)} MON
        </button>
      ) : (
        <p className="hint">Nothing left to claim from this address.</p>
      )}
      {err && <p className="error-note">{err}</p>}
      {ok && <p className="ok-note">{ok}</p>}
    </section>
  );
}

function ExitPanel({ potId, pot, myDeposit }: { potId: bigint; pot: Pot; myDeposit: bigint }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, err, ok, run } = useAction();

  const { data: req } = useReadContract({
    ...goalPot,
    functionName: "exitRequestOf",
    args: [potId],
    query: { refetchInterval: POLL_MS },
  });
  const { data: round } = useReadContract({
    ...goalPot,
    functionName: "exitRound",
    args: [potId],
    query: { refetchInterval: POLL_MS },
  });
  const { data: voted } = useReadContract({
    ...goalPot,
    functionName: "hasVoted",
    args: [
      potId,
      (round as bigint | undefined) ?? 0n,
      address ?? "0x0000000000000000000000000000000000000000",
    ],
    query: { enabled: !!address && !!round, refetchInterval: POLL_MS },
  });

  // exitRequestOf tuple: [requester, deadline, yesWeight, noWeight, eligibleWeight, open]
  const r = req as
    | readonly [`0x${string}`, number | bigint, bigint, bigint, bigint, boolean]
    | undefined;
  const open = !!r?.[5];
  const requester = r?.[0];
  const voteDeadline = r ? BigInt(r[1]) : 0n;
  const yes = r?.[2] ?? 0n;
  const no = r?.[3] ?? 0n;
  const eligible = r?.[4] ?? 0n;
  const expired = open && Number(voteDeadline) * 1000 < Date.now();
  const soloExit = open && eligible === 0n;
  const passed = open && (soloExit || yes * 2n > eligible);
  const iAmRequester = !!address && requester?.toLowerCase() === address.toLowerCase();
  const yesPct = eligible > 0n ? Number((yes * 100n) / eligible) : 0;
  const noPct = eligible > 0n ? Number((no * 100n) / eligible) : 0;

  return (
    <section className="sheet">
      <h2 className="sheet-title">Early exit — put it to a vote</h2>
      <p className="hint">
        Leaving before the goal needs a majority of the other members' deposited
        weight, and costs {(pot.penaltyBps / 100).toFixed(2)}% — which stays in the pot
        for everyone else.
      </p>

      {!open || expired ? (
        <div className="mt">
          {expired && <p className="hint">The previous request expired without passing.</p>}
          <button
            disabled={!isConnected || isPending || myDeposit === 0n}
            onClick={() =>
              run(
                () => writeContractAsync({ ...goalPot, functionName: "requestExit", args: [potId] }),
                "Exit requested — the vote is open."
              )
            }
          >
            Request to leave ({fmtMon((myDeposit * BigInt(10000 - pot.penaltyBps)) / 10000n)} MON after penalty)
          </button>
          {myDeposit === 0n && <p className="hint">Only members with a stake can request an exit.</p>}
        </div>
      ) : (
        <div className="mt">
          <div className="rule-label">
            {shortAddr(requester!)} asks to leave · vote closes {fmtDate(voteDeadline)}
          </div>
          <div className="vote-bar mt" title={`yes ${fmtMon(yes)} / no ${fmtMon(no)} of ${fmtMon(eligible)} MON eligible`}>
            <div className="yes" style={{ width: `${yesPct}%` }} />
            <div className="no" style={{ width: `${noPct}%` }} />
          </div>
          <div className="row spread mt">
            <span className="figure" style={{ fontSize: "0.8rem" }}>
              {soloExit
                ? "no other members — the exit can be executed directly"
                : `YES ${fmtMon(yes)} · NO ${fmtMon(no)} · needs >${fmtMon(eligible / 2n)} MON yes`}
            </span>
          </div>
          <div className="row mt">
            {!iAmRequester && myDeposit > 0n && !voted && (
              <>
                <button
                  className="approve"
                  disabled={!isConnected || isPending}
                  onClick={() =>
                    run(
                      () =>
                        writeContractAsync({
                          ...goalPot,
                          functionName: "voteOnExit",
                          args: [potId, true],
                        }),
                      "Voted yes."
                    )
                  }
                >
                  Approve exit
                </button>
                <button
                  disabled={!isConnected || isPending}
                  onClick={() =>
                    run(
                      () =>
                        writeContractAsync({
                          ...goalPot,
                          functionName: "voteOnExit",
                          args: [potId, false],
                        }),
                      "Voted no."
                    )
                  }
                >
                  Refuse
                </button>
              </>
            )}
            {!!voted && <span className="hint">Your vote is on the ledger.</span>}
            {passed && (
              <button
                className="primary"
                disabled={!isConnected || isPending}
                onClick={() =>
                  run(
                    () =>
                      writeContractAsync({ ...goalPot, functionName: "executeExit", args: [potId] }),
                    "Exit executed."
                  )
                }
              >
                Execute exit (majority reached)
              </button>
            )}
          </div>
        </div>
      )}
      {err && <p className="error-note">{err}</p>}
      {ok && <p className="ok-note">{ok}</p>}
    </section>
  );
}

function MembersTable({ potId, me }: { potId: bigint; me?: `0x${string}` }) {
  const { data } = useReadContract({
    ...goalPot,
    functionName: "getMembers",
    args: [potId, 0n, 100n],
    query: { refetchInterval: POLL_MS },
  });
  const [addrs, amounts, total] = (data ?? [[], [], 0n]) as unknown as [
    readonly `0x${string}`[],
    readonly bigint[],
    bigint
  ];

  return (
    <section className="sheet">
      <h2 className="sheet-title">Members</h2>
      {addrs.length === 0 ? (
        <p className="empty-note">No deposits yet.</p>
      ) : (
        <div className="table-wrap mt">
        <table className="ledger">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Address</th>
              <th>Stake (MON)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {addrs.map((a, i) => (
              <tr key={a} className={me && a.toLowerCase() === me.toLowerCase() ? "me" : ""}>
                <td>{String(i + 1).padStart(2, "0")}</td>
                <td>
                  <a href={`${explorerUrl}/address/${a}`} target="_blank" rel="noreferrer">
                    {shortAddr(a)}
                  </a>
                  {me && a.toLowerCase() === me.toLowerCase() && " (you)"}
                </td>
                <td>{fmtMon(amounts[i])}</td>
                <td>{amounts[i] === 0n ? "exited / refunded" : "in"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {total > 100n && <p className="hint">Showing first 100 of {String(total)} members.</p>}
    </section>
  );
}
