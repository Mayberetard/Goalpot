import { useEffect } from "react";
import { useConnect } from "wagmi";
import { WC_PROJECT_ID } from "../lib/config";

const isMobile = /Android|iPhone|iPad|iPod/i.test(
  typeof navigator === "undefined" ? "" : navigator.userAgent
);

/** Current page as a deep link that opens inside a wallet's in-app browser,
 *  where the wallet injects a provider and the extension flow works. */
function dappUrl() {
  const { host, pathname, hash, href, origin } = window.location;
  return {
    metamask: `https://metamask.app.link/dapp/${host}${pathname}${hash}`,
    phantom: `https://phantom.app/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(origin)}`,
  };
}

export function WalletModal({ onClose }: { onClose: () => void }) {
  const { connect, connectors, isPending, error } = useConnect();

  const hasInjected =
    typeof window !== "undefined" && typeof (window as any).ethereum !== "undefined";
  const injectedConnector = connectors.find((c) => c.id === "injected");
  const wcConnector = connectors.find((c) => c.id === "walletConnect");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const links = dappUrl();

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h3 className="sheet-title">Connect a wallet</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {hasInjected && injectedConnector && (
          <button
            className="wallet-option"
            disabled={isPending}
            onClick={() =>
              connect({ connector: injectedConnector }, { onSuccess: onClose })
            }
          >
            <span className="wallet-glyph">⛭</span>
            <span>
              Browser wallet
              <small>MetaMask, Rabby, Phantom… (detected)</small>
            </span>
          </button>
        )}

        {wcConnector && (
          <button
            className="wallet-option"
            disabled={isPending}
            onClick={() => connect({ connector: wcConnector }, { onSuccess: onClose })}
          >
            <span className="wallet-glyph">⧉</span>
            <span>
              WalletConnect
              <small>Scan a QR or pick any mobile wallet</small>
            </span>
          </button>
        )}

        {isMobile && !hasInjected && (
          <>
            <a className="wallet-option" href={links.metamask}>
              <span className="wallet-glyph">◆</span>
              <span>
                Open in MetaMask
                <small>Loads this page inside the MetaMask app</small>
              </span>
            </a>
            <a className="wallet-option" href={links.phantom}>
              <span className="wallet-glyph">◈</span>
              <span>
                Open in Phantom
                <small>Loads this page inside the Phantom app</small>
              </span>
            </a>
          </>
        )}

        {!hasInjected && !wcConnector && !isMobile && (
          <p className="hint mt">
            No wallet extension detected. Install MetaMask or Rabby, or open this
            page on your phone inside a wallet app's browser.
          </p>
        )}
        {!wcConnector && WC_PROJECT_ID === "" && (
          <p className="hint mt">
            Tip for operators: set <code>VITE_WC_PROJECT_ID</code> to enable
            WalletConnect for every mobile wallet.
          </p>
        )}
        {error && <p className="error-note">{error.message.split("\n")[0]}</p>}
      </div>
    </div>
  );
}
