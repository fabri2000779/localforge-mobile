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
 * Buttons work optimistically: every action is allowed and the result
 * (a `cmd_result` event) is surfaced as a toast after the owner runs it.
 * Live container state badges live on the list screen; per-server live
 * console is wired below via `server.attach` → `server-log` events.
 *
 * File manager is the one piece still out of scope on mobile.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Hash,
  Play,
  RefreshCcw,
  SlidersHorizontal,
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
  onOpenConfig: () => void;
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

/** Hard cap on retained log lines. Mobile WebViews choke on tens of
 *  thousands of DOM nodes — 500 is comfortable, plenty for an "is my
 *  server happy" glance. Older lines drop off the top. */
const LOG_BUFFER_CAP = 500;

interface LogLine {
  ts: number;
  line: string;
}

export function ServerDetailScreen({ server, onBack, onOpenConfig }: Props) {
  const [pending, setPending] = useState<Action | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  // The request_id we're currently awaiting a cmd_result for, so we
  // can filter incoming events. Multiple actions in flight aren't
  // supported (the buttons disable each other) but we still match on
  // id for correctness — a stale response after a quick re-tap would
  // otherwise overwrite the toast.
  const awaitingId = useRef<string | null>(null);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

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

  // Console tail. Send `server.attach` to the owner so it starts
  // forwarding console output for THIS server through the relay;
  // listen for the resulting `server-log` events (RelayLogBridge
  // re-emits relay console_line frames as local server-log events
  // on every sub-user so the same xterm wiring works unchanged on
  // mobile too). Detach on unmount so the relay quiets back down.
  useEffect(() => {
    let unsub: UnlistenFn | undefined;
    listen<{ server_id: string; line: string; ts: number }>(
      'server-log',
      (event) => {
        if (event.payload?.server_id !== server.id) return;
        setLogs((prev) => {
          const next = prev.length >= LOG_BUFFER_CAP
            ? prev.slice(prev.length - LOG_BUFFER_CAP + 1)
            : prev.slice();
          next.push({ ts: event.payload.ts, line: event.payload.line });
          return next;
        });
      },
    ).then((u) => {
      unsub = u;
    });

    // Fire attach. Best-effort — if the relay isn't connected yet
    // the user sees "(waiting for connection)" until they reconnect.
    void cloudRelaySendCmd({
      type: 'cmd',
      cmd: 'server.attach',
      request_id: crypto.randomUUID(),
      target: server.id,
    });

    return () => {
      unsub?.();
      void cloudRelaySendCmd({
        type: 'cmd',
        cmd: 'server.detach',
        request_id: crypto.randomUUID(),
        target: server.id,
      });
    };
  }, [server.id]);

  // Auto-scroll to bottom whenever a new line lands. useLayoutEffect
  // so the scroll happens in the same paint as the DOM update — no
  // visible flicker. The user can still scroll up manually; we only
  // pin to bottom when they're already near it.
  useLayoutEffect(() => {
    const el = logViewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 60) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

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

      <section className="card action-card">
        <div className="action-card-header">
          <h2>Configuration</h2>
          <p>
            View and edit this server’s game settings. Changes are applied
            on your desktop over the relay and re-synced back.
          </p>
        </div>
        <button type="button" className="cfg-btn" onClick={onOpenConfig}>
          <SlidersHorizontal size={15} />
          Edit configuration
        </button>
      </section>

      <section className="card console-card">
        <div className="console-header">
          <Terminal size={14} />
          <span>Console</span>
          <span className="console-count">{logs.length}/{LOG_BUFFER_CAP}</span>
        </div>
        <div ref={logViewportRef} className="console-viewport" role="log">
          {logs.length === 0 ? (
            <div className="console-empty">
              Waiting for output. The owner forwards console lines once
              the server actually emits any — start the server (or push a
              command) to see live output here.
            </div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="console-line">
                {l.line}
              </div>
            ))
          )}
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
