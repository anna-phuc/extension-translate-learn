import { useCallback, useEffect, useState } from "react";
import { CheckIcon, RetryIcon } from "../../components/icons.tsx";
import { helperStatus, setupCommand, type HelperStatus } from "../../lib/helper.ts";

/** The helper's status, checked when the panel opens and again on demand. Null while a check runs. */
export function useHelperStatus() {
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const refresh = useCallback(() => {
    setStatus(null);
    helperStatus().then(setStatus);
  }, []);
  useEffect(refresh, [refresh]);
  return { status, refresh };
}

/** Text with `code` spans, for the setup messages that name a command. */
const Commands = ({ text }: { text: string }) => (
  <>{text.split(/`([^`]+)`/).map((part, index) => (index % 2 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>))}</>
);

export function ConnectionStatus({ status, hasKey, onRefresh }: { status: HelperStatus | null; hasKey: boolean; onRefresh(): void }) {
  // Claude Code unavailable but a key is there: lookups work, on the key.
  const onKey = hasKey && status !== null && status.state !== "ready";
  return (
    <div className={`connection connection-${onKey ? "api" : (status?.state ?? "checking")}`} role="status">
      <div className="connection-line">
        {status?.state === "ready" || onKey ? <CheckIcon size={16} /> : <span className="connection-dot" />}
        <span className="connection-title">
          {status === null
            ? "Checking your Claude connection…"
            : onKey
              ? "Using your API key"
              : status.state === "ready"
              ? "Connected to your Claude account"
              : status.state === "signed-out"
                ? "Claude Code is not signed in"
                : "The Claude helper isn't set up"}
        </span>
        <button type="button" className="tl-icon-button" title="Check again" aria-label="Check again" onClick={onRefresh} disabled={status === null}>
          <RetryIcon size={14} />
        </button>
      </div>
      {status?.state === "ready" ? (
        <p className="connection-detail">
          {status.version}
          {status.account ? ` · ${status.account}` : ""}
        </p>
      ) : null}
      {onKey ? (
        <p className="connection-detail">
          Claude Code isn't {status?.state === "signed-out" ? "signed in" : "set up"} on this computer, so lookups use your API key, billed to your Anthropic
          account. To use your Claude account instead, follow the steps below; the key then stays unused.
        </p>
      ) : null}
      {status?.state === "signed-out" ? (
        <p className="connection-detail">
          <Commands text={status.message} />
        </p>
      ) : null}
      {status?.state === "missing" ? (
        <div className="connection-detail">
          <p>Lookups run on the Claude Code installed on this computer, signed in to your Claude account. A small helper connects Chrome to it. Set it up once:</p>
          <ol>
            <li>
              In Terminal, go to the extension's folder and run <code>{setupCommand}</code>.
            </li>
            <li>If it says Claude Code isn't signed in, run <code>claude auth login</code>.</li>
            <li>Click the check-again button above.</li>
          </ol>
          {status.message && !status.message.includes(setupCommand) ? (
            <p className="connection-reason">
              <Commands text={status.message} />
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
