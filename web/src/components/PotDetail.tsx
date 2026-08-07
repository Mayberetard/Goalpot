import { useEffect, useState } from "react";
import { useAccount, useDisconnect, useReadContract, useWriteContract } from "wagmi";
import { parseEther } from "viem";
import {
  potContract,
  usePot,
  POLL_MS,
  STATE_LABEL,
  POT_TYPE,
  POT_TYPE_LABEL,
  type PotSummary,
} from "../lib/hooks";
import { explorerUrl } from "../lib/config";
import { fmtMon, fmtDate, shortAddr, timeLeft } from "../lib/format";
import { useDisplayName } from "../lib/ens";
import { isStaleConnectorError, STALE_SESSION_MSG } from "../lib/errors";
import { PotProgress } from "./PotProgress";
import { InvitePanel } from "./InvitePanel";
import { StreakPanel } from "./StreakPanel";
import { DonorWall } from "./DonorWall";
import { UpdatesBoard } from "./UpdatesBoard";

export function useAction() {
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

export function PotDetail({
  address,
  onBack,
}: {
  address: `0x${string}`;
  onBack: () => void;
}) {
  const { address: me } = useAccount();
  const { pot, error, isLoading } = usePot(address);

  const { data: myDeposit } = useReadContract({
    ...potContract(address),
    functionName: "depositOf",
    args: [me ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!me, refetchInterval: POLL_MS },
  });
  const { data: invited } = useReadContract({
    ...potContract(address),
    functionName: "invitedOf",
    args: [me ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!me, refetchInterval: POLL_MS },
  });

  const beneficiaryName = useDisplayName(pot?.beneficiary);

  // Keep the tab title (and anything that scrapes the live DOM) in step with
  // the pot being viewed; crawler-facing tags are served by /api/s.
  useEffect(() => {
    if (!pot) return;
    const funded =
      pot.goal > 0n
        ? Number(((pot.totalDeposited + pot.penaltyPool) * 10000n) / pot.goal) / 100
        : 0;
    document.title = `${pot.name} — ${funded.toFixed(0)}% funded · Goalpot`;
    return () => {
      document.title = "Goalpot — Cooperative Savings Ledger on Monad";
    };
  }, [pot?.name, pot?.goal, pot?.totalDeposited, pot?.penaltyPool]);

  if (isLoading && !pot)
    return (
      <section className="sheet">
        <p className="empty-note">Reading the chain…</p>
      </section>
    );

  if (!pot)
    return (
      <section className="sheet">
        <div className="rule-label">No such entry</div>
        <p>
          {error
            ? "No pot contract found at this address — the link may be from an older deployment, or the Monad RPC is unreachable."
            : "This pot doesn't exist on the current factory."}
        </p>
        <button className="crumb" onClick={onBack}>
          ← back to the ledger
        </button>
      </section>
    );

  const balance = pot.totalDeposited + pot.penaltyPool;
  const deadlinePassed = Number(pot.deadline) * 1000 < Date.now();
  const goalReached = balance >= pot.goal;
  const mine = (myDeposit as bigint | undefined) ?? 0n;
  const isCharity = pot.potType === POT_TYPE.Charity;

  return (
    <>
      <section className="sheet">
        <div className="row spread">
          <div>
            <div className="rule-label">
              {isCharity ? "Appeal" : "Pot"} · {shortAddr(pot.address)}
            </div>
            <h2 className="sheet-title">{pot.name}</h2>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {pot.potType !== 0 && (
              <span className={`stamp type-${pot.potType}`}>
                {POT_TYPE_LABEL[pot.potType]}
              </span>
            )}
            {!pot.openJoin && <span className="stamp active">invite-only</span>}
            <span className={`stamp ${STATE_LABEL[pot.state]}`}>
              {STATE_LABEL[pot.state]}
            </span>
          </div>
        </div>

        <div className="mt">
          <PotProgress balance={balance} goal={pot.goal} />
        </div>

        <div className="row mt" style={{ gap: 24 }}>
          <div>
            <div className="rule-label">Deadline</div>
            <div className="figure">{fmtDate(pot.deadline)}</div>
            <div className="hint">{pot.state === 0 ? timeLeft(pot.deadline) : "settled"}</div>
          </div>
          <div>
            <div className="rule-label">Early-exit penalty</div>
            <div className="figure">{(pot.penaltyBps / 100).toFixed(2)}%</div>
          </div>
          <div>
            <div className="rule-label">Min. first {isCharity ? "donation" : "deposit"}</div>
            <div className="figure">{fmtMon(pot.minDeposit)} MON</div>
          </div>
          <div>
            <div className="rule-label">{isCharity ? "Charity payout" : "Beneficiary"}</div>
            <div className="figure">
              <a
                href={`${explorerUrl}/address/${pot.beneficiary}`}
                target="_blank"
                rel="noreferrer"
              >
                {beneficiaryName}
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
          pot={pot}
          myDeposit={mine}
          invited={(invited as boolean | undefined) ?? false}
          goalReached={goalReached}
          deadlinePassed={deadlinePassed}
        />
      )}
      {pot.potType === POT_TYPE.Streak && <StreakPanel pot={pot} myDeposit={mine} />}
      {pot.state === 1 && <ReleasedPanel pot={pot} />}
      {pot.state === 2 && <RefundPanel pot={pot} myDeposit={mine} />}
      {pot.state === 0 && !deadlinePassed && !isCharity && (
        <ExitPanel pot={pot} myDeposit={mine} />
      )}
      {pot.state === 0 && !deadlinePassed && <InvitePanel pot={pot} />}
      {isCharity && <DonorWall pot={pot} />}

      <MembersTable pot={pot} me={me} />
      <UpdatesBoard pot={pot} myDeposit={mine} />

      <button className="crumb" onClick={onBack}>
        ← back to the ledger
      </button>
    </>
  );
}

function ActionsPanel({
  pot,
  myDeposit,
  invited,
  goalReached,
  deadlinePassed,
}: {
  pot: PotSummary;
  myDeposit: bigint;
  invited: boolean;
  goalReached: boolean;
  deadlinePassed: boolean;
}) {
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const { writeContractAsync, isPending, err, ok, run } = useAction();
  const isCharity = pot.potType === POT_TYPE.Charity;
  const c = potContract(pot.address, pot.potType);

  const notInvited = !pot.openJoin && myDeposit === 0n && !invited;
  const disabled = !isConnected || isPending || deadlinePassed || notInvited;

  return (
    <section className="sheet">
      <h2 className="sheet-title">{isCharity ? "Donate" : "Pay in"}</h2>
      {myDeposit > 0n && (
        <p className="hint">
          {isCharity ? "You've donated" : "Your stake"}:{" "}
          <b className="figure">{fmtMon(myDeposit)} MON</b>
        </p>
      )}
      {isConnected && notInvited && (
        <p className="hint">
          This pot is invite-only and your address isn't on the allowlist yet — ask the
          creator to invite you.
        </p>
      )}

      {!deadlinePassed && (
        <>
          <div className="row mt">
            <input
              style={{ maxWidth: 200 }}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`min ${fmtMon(pot.minDeposit)} MON`}
              inputMode="decimal"
              aria-label={isCharity ? "Donation amount in MON" : "Deposit amount in MON"}
            />
            <button
              className="primary"
              disabled={disabled}
              onClick={() =>
                run(async () => {
                  const wei = parseEther(amount as `${number}`);
                  if (wei <= 0n) throw new Error("Enter a positive amount.");
                  if (isCharity) {
                    await writeContractAsync({
                      ...c,
                      functionName: "donateWithMessage",
                      args: [message.slice(0, 140)],
                      value: wei,
                    });
                  } else {
                    await writeContractAsync({ ...c, functionName: "deposit", value: wei });
                  }
                  setAmount("");
                  setMessage("");
                }, isCharity ? "Donation sent — thank you." : "Deposit sent. The ledger updates as the chain confirms.")
              }
            >
              {isCharity ? "Donate" : "Deposit"}
            </button>
          </div>
          {isCharity && (
            <label className="field">
              <span>Public message for the donor wall (optional, 140 chars)</span>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={140}
                placeholder="In memory of…"
              />
            </label>
          )}
        </>
      )}

      {goalReached && (
        <div className="mt">
          <p className="hint">
            The goal is met. Anyone may settle the pot; the{" "}
            {isCharity ? "charity" : "beneficiary"} then claims the payout.
          </p>
          <button
            className="approve"
            disabled={!isConnected || isPending}
            onClick={() =>
              run(
                () => writeContractAsync({ ...c, functionName: "release" }),
                "Release sent — the beneficiary can claim the payout."
              )
            }
          >
            Release {fmtMon(pot.totalDeposited + pot.penaltyPool)} MON
          </button>
        </div>
      )}

      {deadlinePassed && !goalReached && (
        <div className="mt">
          <p className="hint">
            Deadline missed. Claim below to flip the pot to refunds and take your share
            back.
          </p>
          <button
            disabled={!isConnected || isPending || myDeposit === 0n}
            onClick={() =>
              run(
                () => writeContractAsync({ ...c, functionName: "claimRefund" }),
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

function ReleasedPanel({ pot }: { pot: PotSummary }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, err, ok, run } = useAction();
  const c = potContract(pot.address, pot.potType);
  const { data: pending } = useReadContract({
    ...c,
    functionName: "claimable",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: POLL_MS },
  });
  const { data: benePending } = useReadContract({
    ...c,
    functionName: "claimable",
    args: [pot.beneficiary],
    query: { refetchInterval: POLL_MS },
  });
  const mine = (pending as bigint | undefined) ?? 0n;
  const bene = (benePending as bigint | undefined) ?? 0n;
  const beneficiaryName = useDisplayName(pot.beneficiary);

  return (
    <section className="sheet">
      <h2 className="sheet-title">Goal reached — released</h2>
      {mine > 0n ? (
        <>
          <p className="hint">You have funds to collect from this pot.</p>
          <button
            className="primary mt"
            disabled={!isConnected || isPending}
            onClick={() =>
              run(() => writeContractAsync({ ...c, functionName: "claim" }), "Payout claimed.")
            }
          >
            Claim {fmtMon(mine)} MON
          </button>
        </>
      ) : bene > 0n ? (
        <p className="hint">
          {fmtMon(bene)} MON is waiting for {beneficiaryName} to claim.
        </p>
      ) : (
        <p className="hint">The payout has been claimed. This ledger is closed.</p>
      )}
      {err && <p className="error-note">{err}</p>}
      {ok && <p className="ok-note">{ok}</p>}
    </section>
  );
}

function RefundPanel({ pot, myDeposit }: { pot: PotSummary; myDeposit: bigint }) {
  const { isConnected } = useAccount();
  const { writeContractAsync, isPending, err, ok, run } = useAction();
  const c = potContract(pot.address, pot.potType);
  const bonus =
    pot.refundTotal > 0n ? (pot.refundPenalty * myDeposit) / pot.refundTotal : 0n;

  return (
    <section className="sheet">
      <h2 className="sheet-title">Refunds open</h2>
      <p className="hint">
        The deadline passed before the goal was met. Everyone pulls back their own stake,
        plus their share of any penalties or forfeits.
      </p>
      {myDeposit > 0n ? (
        <button
          className="primary mt"
          disabled={!isConnected || isPending}
          onClick={() =>
            run(
              () => writeContractAsync({ ...c, functionName: "claimRefund" }),
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

function ExitPanel({ pot, myDeposit }: { pot: PotSummary; myDeposit: bigint }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, err, ok, run } = useAction();
  const [delegateTo, setDelegateTo] = useState("");
  const c = potContract(pot.address, pot.potType);

  const { data: req } = useReadContract({
    ...c,
    functionName: "exitRequest",
    query: { refetchInterval: POLL_MS },
  });
  const { data: round } = useReadContract({
    ...c,
    functionName: "exitRound",
    query: { refetchInterval: POLL_MS },
  });
  const { data: voted } = useReadContract({
    ...c,
    functionName: "hasVoted",
    args: [(round as bigint | undefined) ?? 0n, address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address && round !== undefined, refetchInterval: POLL_MS },
  });
  const { data: myWeight } = useReadContract({
    ...c,
    functionName: "voteWeightOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: POLL_MS },
  });
  const { data: myDelegate } = useReadContract({
    ...c,
    functionName: "delegateOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: POLL_MS },
  });

  const r = req as
    | readonly [`0x${string}`, number | bigint, bigint, bigint, bigint, bigint, boolean]
    | undefined;
  const open = !!r?.[6];
  const requester = r?.[0];
  const voteDeadline = r ? BigInt(r[1]) : 0n;
  const yes = r?.[2] ?? 0n;
  const no = r?.[3] ?? 0n;
  const abstain = r?.[4] ?? 0n;
  const eligible = r?.[5] ?? 0n;

  const expired = open && Number(voteDeadline) * 1000 < Date.now();
  const soloExit = open && eligible === 0n;
  const votedWeight = yes + no + abstain;
  const quorumNeeded = (eligible * 2500n) / 10000n;
  const quorumMet = votedWeight >= quorumNeeded;
  const passed =
    open && (soloExit || yes * 2n > eligible || (expired && quorumMet && yes > no));
  const iAmRequester = !!address && requester?.toLowerCase() === address.toLowerCase();
  const width = (w: bigint) => (eligible > 0n ? Number((w * 100n) / eligible) : 0);
  const requesterName = useDisplayName(requester);
  const delegateName = useDisplayName(
    myDelegate && myDelegate !== "0x0000000000000000000000000000000000000000"
      ? (myDelegate as string)
      : undefined
  );

  return (
    <section className="sheet">
      <h2 className="sheet-title">Early exit — put it to a vote</h2>
      <p className="hint">
        Leaving before the goal needs a majority of the other members' deposited weight,
        and costs {(pot.penaltyBps / 100).toFixed(2)}% — which stays in the pot for
        everyone else. After the voting window closes, at least 25% of eligible weight
        must have voted for the result to count.
      </p>

      {!open || (expired && !passed) ? (
        <div className="mt">
          {expired && !passed && (
            <p className="hint">The previous request closed without passing.</p>
          )}
          <button
            disabled={!isConnected || isPending || myDeposit === 0n}
            onClick={() =>
              run(
                () => writeContractAsync({ ...c, functionName: "requestExit" }),
                "Exit requested — the vote is open."
              )
            }
          >
            Request to leave (
            {fmtMon((myDeposit * BigInt(10000 - pot.penaltyBps)) / 10000n)} MON after
            penalty)
          </button>
          {myDeposit === 0n && (
            <p className="hint">Only members with a stake can request an exit.</p>
          )}
        </div>
      ) : (
        <div className="mt">
          <div className="rule-label">
            {requesterName} asks to leave · vote closes {fmtDate(voteDeadline)}
          </div>
          <div
            className="vote-bar mt"
            title={`yes ${fmtMon(yes)} / no ${fmtMon(no)} / abstain ${fmtMon(
              abstain
            )} of ${fmtMon(eligible)} MON eligible`}
          >
            <div className="yes" style={{ width: `${width(yes)}%` }} />
            <div className="no" style={{ width: `${width(no)}%` }} />
            <div className="abstain" style={{ width: `${width(abstain)}%` }} />
          </div>
          <div className="row spread mt">
            <span className="figure" style={{ fontSize: "0.8rem" }}>
              {soloExit
                ? "no other members — the exit can be executed directly"
                : `YES ${fmtMon(yes)} · NO ${fmtMon(no)} · ABSTAIN ${fmtMon(abstain)}`}
            </span>
          </div>
          {!soloExit && (
            <div className="hint">
              Quorum {fmtMon(votedWeight)} / {fmtMon(quorumNeeded)} MON{" "}
              {quorumMet ? "✓ met" : "— not yet met"}
            </div>
          )}
          <div className="row mt">
            {!iAmRequester && (myWeight as bigint ?? 0n) > 0n && !voted && (
              <>
                <button
                  className="approve"
                  disabled={!isConnected || isPending}
                  onClick={() =>
                    run(
                      () => writeContractAsync({ ...c, functionName: "voteOnExit", args: [1] }),
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
                      () => writeContractAsync({ ...c, functionName: "voteOnExit", args: [0] }),
                      "Voted no."
                    )
                  }
                >
                  Refuse
                </button>
                <button
                  className="ghost"
                  disabled={!isConnected || isPending}
                  onClick={() =>
                    run(
                      () => writeContractAsync({ ...c, functionName: "voteOnExit", args: [2] }),
                      "Abstained."
                    )
                  }
                >
                  Abstain
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
                    () => writeContractAsync({ ...c, functionName: "executeExit" }),
                    "Exit executed."
                  )
                }
              >
                Execute exit
              </button>
            )}
          </div>
        </div>
      )}

      {myDeposit > 0n && (
        <div className="mt delegate-box">
          <div className="rule-label">Vote delegation</div>
          {myDelegate && myDelegate !== "0x0000000000000000000000000000000000000000" ? (
            <div className="row">
              <span className="hint">Your weight is voted by {delegateName}.</span>
              <button
                className="ghost"
                disabled={!isConnected || isPending}
                onClick={() =>
                  run(
                    () =>
                      writeContractAsync({
                        ...c,
                        functionName: "setDelegate",
                        args: ["0x0000000000000000000000000000000000000000"],
                      }),
                    "Delegation cleared."
                  )
                }
              >
                Take it back
              </button>
            </div>
          ) : (
            <div className="row">
              <input
                style={{ maxWidth: 260 }}
                value={delegateTo}
                onChange={(e) => setDelegateTo(e.target.value)}
                placeholder="0x… member address"
                aria-label="Delegate vote weight to address"
              />
              <button
                disabled={!isConnected || isPending || !delegateTo}
                onClick={() =>
                  run(
                    () =>
                      writeContractAsync({
                        ...c,
                        functionName: "setDelegate",
                        args: [delegateTo as `0x${string}`],
                      }),
                    "Delegated."
                  )
                }
              >
                Delegate
              </button>
            </div>
          )}
          <p className="hint">
            One level only: your delegate must be a member who hasn't delegated their own
            weight away.
          </p>
        </div>
      )}

      {err && <p className="error-note">{err}</p>}
      {ok && <p className="ok-note">{ok}</p>}
    </section>
  );
}

function MembersTable({ pot, me }: { pot: PotSummary; me?: `0x${string}` }) {
  const { data } = useReadContract({
    ...potContract(pot.address, pot.potType),
    functionName: "getMembers",
    args: [0n, 100n],
    query: { refetchInterval: POLL_MS },
  });
  const [addrs, amounts, total] = (data ?? [[], [], 0n]) as unknown as [
    readonly `0x${string}`[],
    readonly bigint[],
    bigint
  ];
  const isCharity = pot.potType === POT_TYPE.Charity;

  return (
    <section className="sheet">
      <h2 className="sheet-title">{isCharity ? "Donors" : "Members"}</h2>
      {addrs.length === 0 ? (
        <p className="empty-note">No {isCharity ? "donations" : "deposits"} yet.</p>
      ) : (
        <div className="table-wrap mt">
          <table className="ledger">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Address</th>
                <th>{isCharity ? "Donated" : "Stake"} (MON)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {addrs.map((a, i) => (
                <MemberRow
                  key={a}
                  index={i}
                  address={a}
                  amount={amounts[i]}
                  isMe={!!me && a.toLowerCase() === me.toLowerCase()}
                  isCharity={isCharity}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > 100n && <p className="hint">Showing first 100 of {String(total)}.</p>}
    </section>
  );
}

function MemberRow({
  index,
  address,
  amount,
  isMe,
  isCharity,
}: {
  index: number;
  address: `0x${string}`;
  amount: bigint;
  isMe: boolean;
  isCharity: boolean;
}) {
  const name = useDisplayName(address);
  return (
    <tr className={isMe ? "me" : ""}>
      <td>{String(index + 1).padStart(2, "0")}</td>
      <td>
        <a href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer">
          {name}
        </a>
        {isMe && " (you)"}
      </td>
      <td>{fmtMon(amount)}</td>
      <td>{amount === 0n ? (isCharity ? "refunded" : "exited / refunded") : "in"}</td>
    </tr>
  );
}
