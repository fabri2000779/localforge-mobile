/**
 * Per-server detail / control screen.
 *
 * The mobile sends control commands (start / stop / restart) through
 * the relay; the owner's desktop receives them in its
 * `RelayCommandExecutor` (CMD_MAP['server.start'] / 'server.stop' /
 * 'server.restart'), executes against the local Docker backend, and
 * sends a `cmd_result` event back. We catch the result and surface a
 * brief toast so the user knows whether the command landed.
 *
 * v0.1.x does NOT show live container state (running / stopped /
 * crashed) — that needs a `state.snapshot` round-trip on connect
 * that the desktop owner isn't yet wired to answer. The button
 * states therefore work optimistically: every action is allowed,
 * the result is reported after the fact.
 *
 * Console tail and file manager are explicitly out of scope for v0.1.x.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Hash,
  Play,
  RefreshCcw,
  Square,
  Terminal,
} from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  cloudRelaySendCmd,
  type ServerSummary,
} from '../lib/cloud';

interface Props {
  server: ServerSummary;
  onBack: () => void;
}

type Action = 'start' | 'stop' | 'restart';

type Toast =
  | { kind: 'ok'; text: string }
  | { kind: 'err'; text: string };

interface CmdResultEvent {
  type: 'event';
  kind: 'cmd_result';
  request_id: string;
  cmd: string;
  target: string;
  success: boolean;
  error?: string;
}

export function ServerDetailScreen({ server, onBack }: Props) {
  const [pending, setPending] = useState<Action | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // The request_id we're currently awaiting a cmd_result for, so we
  // can filter incoming events. Multiple actions in flight aren't
  // supported (the buttons disable each other) but we still match on
  // id for correctness — a stale response after a quick re-tap would
  // otherwise overwrite the toast.
  const awaitingId = useRef<string | null>(null);

  // Toast self-dismiss after 3s. Cleared on unmount + every new toast.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Subscribe to relay events to catch cmd_result responses from the
  // owner. Single listener for the whole screen lifetime.
  useEffect(() => {
    let unsub: UnlistenFn | undefined;
    listen<CmdResultEvent>('cloud://relay-event', (event) => {
      const msg = event.payload;
      if (msg?.kind !== 'cmd_result') return;
      if (msg.request_id !== awaitingId.current) return;
      awaitingId.current = null;
      setPending(null);
      setToast(
        msg.success
          ? { kind: 'ok', text: friendlySuccess(msg.cmd) }
          : { kind: 'err', text: friendlyError(msg.cmd, msg.error) },
      );
    }).then((u) => {
      unsub = u;
    });
    return () => {
      unsub?.();
    };
  }, []);

  async function fire(action: Action) {
    if (pending) return;
    setPending(action);
    setToast(null);
    const requestId = crypto.randomUUID();
    awaitingId.current = requestId;
    try {
      await cloudRelaySendCmd({
        type: 'cmd',
        cmd: `server.${action}`,
        request_id: requestId,
        target: server.id,
        // nodeId default to 'local' on the receiving side; we don't
        // know the node from here in v0.1.x, which is fine for
        // single-node hobby setups.
      });
    } catch (e) {
      awaitingId.current = null;
      setPending(null);
      setToast({
        kind: 'err',
        text:
          e instanceof Error
            ? `Couldn't send command: ${e.message}`
            : "Couldn't send command — is the relay connected?",
      });
    }
  }

  return (
    <div className="detail-screen">
      <header className="detail-header">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="detail-title">
          <div className="home-eyebrow">Server</div>
          <h1>{server.name}</h1>
        </div>
      </header>

      <section className="card">
        <dl className="kv">
          <div>
            <dt>
              <Hash size={12} /> ID
            </dt>
            <dd className="mono">{server.id}</dd>
          </div>
          <div>
            <dt>Last synced</dt>
            <dd>
              {new Date(server.updatedAt).toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card action-card">
        <div className="action-card-header">
          <h2>Controls</h2>
          <p>
            Commands are forwarded to your LocalForge desktop or VPS over
            the relay. The result comes back here once the owner finishes
            executing.
          </p>
        </div>
        <div className="action-row">
          <ActionButton
            label="Start"
            icon={<Play size={16} />}
            tone="positive"
            disabled={!!pending}
            loading={pending === 'start'}
            onClick={() => fire('start')}
          />
          <ActionButton
            label="Stop"
            icon={<Square size={16} />}
            tone="danger"
            disabled={!!pending}
            loading={pending === 'stop'}
            onClick={() => fire('stop')}
          />
          <ActionButton
            label="Restart"
            icon={<RefreshCcw size={16} />}
            tone="neutral"
            disabled={!!pending}
            loading={pending === 'restart'}
            onClick={() => fire('restart')}
          />
        </div>
      </section>

      <section className="card card-coming-soon">
        <Terminal size={18} color="#60a5fa" />
        <div>
          <h2>Console tail arrives in v0.2</h2>
          <p>
            Live log streaming, command input and file manager will land
            once the owner-side state.snapshot + server.log.subscribe
            handlers are wired on the desktop. The infrastructure (relay
            connection, event subscriber) is already in place — only
            the wire contract is pending.
          </p>
        </div>
      </section>

      {toast && (
        <div className={`toast toast--${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ActionButtonProps {
  label: string;
  icon: React.ReactNode;
  tone: 'positive' | 'danger' | 'neutral';
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

function ActionButton({
  label,
  icon,
  tone,
  disabled,
  loading,
  onClick,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      className={`action-btn action-btn--${tone}`}
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="action-spin">…</span> : icon}
      <span>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function friendlySuccess(cmd: string): string {
  switch (cmd) {
    case 'server.start': return 'Server started.';
    case 'server.stop': return 'Server stopped.';
    case 'server.restart': return 'Server restarting.';
    default: return 'Done.';
  }
}

function friendlyError(cmd: string, err?: string): string {
  // The owner returns a raw stringified Rust error. Surface as-is on
  // the rare paths users can actually act on (port-in-use, no-image,
  // etc.) and keep a generic fallback for everything else.
  const what =
    cmd === 'server.start'
      ? 'start'
      : cmd === 'server.stop'
        ? 'stop'
        : cmd === 'server.restart'
          ? 'restart'
          : 'finish';
  if (!err) return `Couldn't ${what} the server.`;
  return `Couldn't ${what}: ${err}`;
}
