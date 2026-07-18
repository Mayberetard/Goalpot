/** wagmi persists connections in localStorage; after a deploy that changes the
 *  connector config, a rehydrated session can lose its methods and every write
 *  fails with "... is not a function". Detect it so the UI can self-heal by
 *  dropping the dead session instead of surfacing a cryptic error. */
export function isStaleConnectorError(e: unknown): boolean {
  return (
    e instanceof Error &&
    /getChainId is not a function|connector.*not.*function/i.test(e.message)
  );
}

export const STALE_SESSION_MSG =
  "Your wallet session went stale after an app update — it has been reset. Reconnect your wallet and try again.";
