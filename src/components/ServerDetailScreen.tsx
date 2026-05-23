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
 *
 * Console: on open we resolve the server's nodeId (from its decrypted
 * config) so commands route to the right host, request the recent
 * backlog (`server.logs` → `logs_snapshot`), and start the live stream
 * (`server.attach` → `console_line`). A `server.state_changed` to
 * stopped/crashed clears the console, mirroring the desktop. The input
 * sends `server.send_command` to the running server.
 *
 * File manager is the one piece still out of scope on mobile.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Hash,
  Play,
  RefreshCcw,
  Send,
  SlidersHorizontal,
  Square,
  Terminal,
} from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  cloudRelaySendCmd,
  cloudServerConfig,
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

/** A single console line forwarded by the owner over the relay. The
 *  desktop's RelayLogBridge emits these (`kind: 'console_line'`) for
 *  every local `server-log`; the mobile consumes them directly. */
interface RelayConsoleEvent {
  type: 'event';
  kind: 'console_line';
  target: string;
  line: string;
  ts: number;
}

/** The recent console backlog the owner returns in response to our
 *  `server.logs` request — the last N lines as of when we opened the
 *  screen, so the console isn't blank until the next live line arrives. */
interface LogsSnapshotEvent {
  type: 'event';
  kind: 'logs_snapshot';
  request_id: string;
  target: string;
  lines: string[];
}

/** Owner-broadcast status transition. Used to clear the console when the
 *  server stops or crashes, mirroring the desktop. */
interface StateChangedEvent {
  type: 'event';
  kind: 'server.state_changed';
  target: string;
  status: string;
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
  // The server's node id, resolved from its (decrypted) config so every
  // command routes to the right Docker host (local vs a remote agent).
  // Null until resolved, or if the sync key is locked — in which case we
  // omit it and the owner defaults to 'local'.
  const nodeIdRef = useRef<string | null>(null);
  // Console command input (e.g. a Minecraft `say hi` / `stop`).
  const [cmdInput, setCmdInput] = useState('');

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

  // Console. Resolve the node id first (so commands target the right
  // host), then ask the owner for the recent backlog (`server.logs`)
  // AND start the live stream (`server.attach`). One listener handles
  // three owner-emitted event kinds for THIS server:
  //   - logs_snapshot         the recent backlog (seeds the buffer)
  //   - console_line          a new live line (appended)
  //   - server.state_changed  clear the console when the server stops /
  //                           crashes, mirroring the desktop
  // Detach on unmount so the owner quiets back down.
  useEffect(() => {
    let unsub: UnlistenFn | undefined;
    let cancelled = false;

    listen<LogsSnapshotEvent | RelayConsoleEvent | StateChangedEvent>(
      'cloud://relay-event',
      (event) => {
        const m = event.payload;
        if (!m || m.target !== server.id) return;
        if (m.kind === 'logs_snapshot') {
          // Seed the buffer with the backlog. get_server_logs returns up
          // to "now", so a live line racing in is already included.
          const lines = Array.isArray(m.lines) ? m.lines : [];
          const start = Math.max(0, lines.length - LOG_BUFFER_CAP);
          setLogs(lines.slice(start).map((line) => ({ ts: Date.now(), line })));
        } else if (m.kind === 'console_line') {
          setLogs((prev) => {
            const next = prev.length >= LOG_BUFFER_CAP
              ? prev.slice(prev.length - LOG_BUFFER_CAP + 1)
              : prev.slice();
            next.push({ ts: m.ts, line: m.line });
            return next;
          });
        } else if (m.kind === 'server.state_changed') {
          if (m.status === 'stopped' || m.status === 'crashed') {
            setLogs([]);
          }
        }
      },
    ).then((u) => {
      if (cancelled) u(); else unsub = u;
    });

    // Resolve nodeId from the decrypted config, then attach + request the
    // backlog with it. If the sync key is locked we proceed without one
    // (the owner defaults to 'local').
    void (async () => {
      try {
        const cfg = await cloudServerConfig(server.id);
        nodeIdRef.current = cfg.nodeId ?? null;
      } catch {
        nodeIdRef.current = null;
      }
      if (cancelled) return;
      void cloudRelaySendCmd({
        type: 'cmd',
        cmd: 'server.logs',
        request_id: crypto.randomUUID(),
        target: server.id,
        args: relayArgs({ lines: 200 }),
      });
      void cloudRelaySendCmd({
        type: 'cmd',
        cmd: 'server.attach',
        request_id: crypto.randomUUID(),
        target: server.id,
        args: relayArgs(),
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
      void cloudRelaySendCmd({
        type: 'cmd',
        cmd: 'server.detach',
        request_id: crypto.randomUUID(),
        target: server.id,
        args: relayArgs(),
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Build the args object for a relay cmd, stamping the resolved nodeId
  // when we have one so the owner routes to the right host. Omitted →
  // the owner defaults to 'local'.
  function relayArgs(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return nodeIdRef.current ? { nodeId: nodeIdRef.current, ...extra } : extra;
  }

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
        args: relayArgs(),
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

  // Send a console command to the running server (e.g. `say hi`, `stop`).
  // Forwarded to the owner as `server.send_command`; the server's own
  // echo comes back through the live `console_line` stream. We optimistically
  // echo the typed line so it shows immediately.
  function sendConsoleCommand(e: React.FormEvent) {
    e.preventDefault();
    const command = cmdInput.trim();
    if (!command) return;
    setCmdInput('');
    setLogs((prev) => {
      const next = prev.length >= LOG_BUFFER_CAP
        ? prev.slice(prev.length - LOG_BUFFER_CAP + 1)
        : prev.slice();
      next.push({ ts: Date.now(), line: `> ${command}` });
      return next;
    });
    void cloudRelaySendCmd({
      type: 'cmd',
      cmd: 'server.send_command',
      request_id: crypto.randomUUID(),
      target: server.id,
      args: relayArgs({ command }),
    }).catch(() => {
      setToast({
        kind: 'err',
        text: "Couldn't send command — is the relay connected?",
      });
    });
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
              No output yet. Recent logs load when you open a running
              server, and new lines stream in live. Send a command below
              to interact with it.
            </div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="console-line">
                {l.line}
              </div>
            ))
          )}
        </div>
        <form className="console-input" onSubmit={sendConsoleCommand}>
          <input
            type="text"
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
            placeholder="Type a command…"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            aria-label="Server console command"
          />
          <button
            type="submit"
            className="console-send"
            disabled={!cmdInput.trim()}
            aria-label="Send command"
          >
            <Send size={15} />
          </button>
        </form>
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
