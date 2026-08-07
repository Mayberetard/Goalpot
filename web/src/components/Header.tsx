import { useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "../lib/config";
import { shortAddr } from "../lib/format";
import { WalletModal } from "./WalletModal";

export function Header({
  onHome,
  onLeaderboard,
  theme,
  onToggleTheme,
}: {
  onHome: () => void;
  onLeaderboard: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [pickerOpen, setPickerOpen] = useState(false);

  const wrongChain = isConnected && chainId !== chain.id;

  return (
    <header className="masthead">
      <div onClick={onHome} className="wordmark" title="Home">
        GOAL<span className="pot-glyph">POT</span>
        <div className="tagline">coöperative savings · dao release</div>
      </div>
      <div className="row">
        <button className="ghost" onClick={onLeaderboard} title="Leaderboard">
          ⛃ Ranks
        </button>
        <button
          className="ghost theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to day ledger" : "Switch to night ledger"}
          aria-label="Toggle dark mode"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <span className="net-chip">{chain.name}</span>
        {!isConnected ? (
          <button className="primary" onClick={() => setPickerOpen(true)}>
            Connect wallet
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
      {pickerOpen && !isConnected && <WalletModal onClose={() => setPickerOpen(false)} />}
    </header>
  );
}
