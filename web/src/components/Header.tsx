import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "../lib/config";
import { shortAddr } from "../lib/format";

export function Header({ onHome }: { onHome: () => void }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && chainId !== chain.id;

  return (
    <header className="masthead">
      <div onClick={onHome} className="wordmark" title="Home">
        GOAL<span className="pot-glyph">POT</span>
        <div className="tagline">coöperative savings · dao release</div>
      </div>
      <div className="row">
        <span className="net-chip">{chain.name}</span>
        {!isConnected ? (
          <button
            className="primary"
            disabled={isPending || connectors.length === 0}
            onClick={() => connect({ connector: connectors[0] })}
          >
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
        ) : wrongChain ? (
          <button className="primary" onClick={() => switchChain({ chainId: chain.id })}>
            Switch to {chain.name}
          </button>
        ) : (
          <button className="ghost" onClick={() => disconnect()} title="Disconnect">
            {shortAddr(address!)} ✕
          </button>
        )}
      </div>
    </header>
  );
}
