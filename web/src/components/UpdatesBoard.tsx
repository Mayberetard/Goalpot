import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import { potContract, type PotSummary } from "../lib/hooks";
import { fmtDate, shortAddr } from "../lib/format";
import { useAction } from "./PotDetail";

const UPDATE_EVENT = parseAbiItem(
  "event PotUpdatePosted(address indexed author, string message, uint256 timestamp)"
);

type Post = { author: `0x${string}`; message: string; timestamp: bigint };

/** Per-pot message board. Posts live in the event log rather than IPFS or a
 *  database: no gateway to go down, no server to run, and the chain already
 *  proves who wrote what and when. */
export function UpdatesBoard({ pot, myDeposit }: { pot: PotSummary; myDeposit: bigint }) {
  const client = usePublicClient();
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, err, ok, run } = useAction();
  const [posts, setPosts] = useState<Post[]>([]);
  const [draft, setDraft] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [reload, setReload] = useState(0);

  const canPost =
    !!address &&
    (myDeposit > 0n || address.toLowerCase() === pot.creator.toLowerCase());

  useEffect(() => {
    let live = true;
    if (!client) return;
    client
      .getLogs({ address: pot.address, event: UPDATE_EVENT, fromBlock: 0n, toBlock: "latest" })
      .then((logs) => {
        if (!live) return;
        setPosts(
          logs.map((l) => ({
            author: (l.args as any).author,
            message: (l.args as any).message as string,
            timestamp: (l.args as any).timestamp as bigint,
          }))
        );
      })
      .catch(() => live && setLoadErr("Could not load updates from this RPC."));
    return () => {
      live = false;
    };
  }, [client, pot.address, reload]);

  return (
    <section className="sheet">
      <h2 className="sheet-title">Updates</h2>
      {canPost && (
        <div className="row mt">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={280}
            placeholder="Post an update for the group (280 chars)"
            aria-label="Post an update"
          />
          <button
            disabled={!isConnected || isPending || draft.trim().length === 0}
            onClick={() =>
              run(async () => {
                await writeContractAsync({
                  ...potContract(pot.address, pot.potType),
                  functionName: "postUpdate",
                  args: [draft.trim()],
                });
                setDraft("");
                setTimeout(() => setReload((r) => r + 1), 2500);
              }, "Update posted.")
            }
          >
            Post
          </button>
        </div>
      )}
      {!canPost && (
        <p className="hint">Members and the pot creator can post updates here.</p>
      )}

      {loadErr && <p className="error-note">{loadErr}</p>}
      {posts.length === 0 && !loadErr && <p className="empty-note">No updates yet.</p>}
      <div className="updates mt">
        {posts
          .slice()
          .reverse()
          .map((p, i) => (
            <article key={i} className="update">
              <div className="update-meta">
                {shortAddr(p.author)}
                {address && p.author.toLowerCase() === address.toLowerCase() && " (you)"} ·{" "}
                {fmtDate(p.timestamp)}
              </div>
              <p>{p.message}</p>
            </article>
          ))}
      </div>
      {err && <p className="error-note">{err}</p>}
      {ok && <p className="ok-note">{ok}</p>}
    </section>
  );
}
