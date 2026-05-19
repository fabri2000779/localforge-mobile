/**
 * Server list — what the user has stored in the cloud (one row per
 * synced server, regardless of which desktop/VPS it actually runs on).
 *
 * v0.0.x is observation-only: just name + last-synced timestamp.
 * "Online / Offline" + console + start/stop come in subsequent
 * commits once the mobile relay client lands. Tapping a row today
 * shows the detail card with the metadata we have; the live state
 * panel below it is a "Coming next" placeholder.
 */
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Lock,
  RefreshCw,
  ServerCog,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  cloudRelayStart,
  cloudRelaySendCmd,
  cloudRelayStop,
  cloudServersList,
  isCloudError,
  subscribeRelayConnected,
  subscribeRelayDisconnected,
  subscribeRelayEvent,
  type Me,
  type ServerSummary,
} from '../lib/cloud';

/** Per-server live status reported by the owner via state.snapshot
 *  or server.state_changed. Mirrors the desktop's ServerStatus enum. */
export type ServerStatus =
  | 'running'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'crashed'
  | 'installing'
  | 'unknown';

interface Props {
  me: Me;
  onBack: () => void;
  onOpenServer: (server: ServerSummary) => void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'paywalled' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; servers: ServerSummary[] };

export function ServerListScreen({ me, onBack, onOpenServer }: Props) {
  // Free-tier users get the paywall card without us even firing the
  // request — the cloud would 402 anyway, no need to round-trip.
  const isPaid = me.subscription.plan !== 'free';
  const [state, setState] = useState<State>(
    isPaid ? { kind: 'loading' } : { kind: 'paywalled' },
  );
  const [refreshing, setRefreshing] = useState(false);
  /** Live connection status to the relay WebSocket. Drives the small
   *  badge in the header so the user knows whether the list reflects
   *  the owner's current state or only the cached snapshot. */
  const [relayStatus, setRelayStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected'>('idle');
  /** Per-server live status keyed by server id. Empty until the owner
   *  responds to `state.snapshot` (sent on connect + on every manual
   *  refresh). Subsequent server.state_changed events patch single
   *  entries. */
  const [statuses, setStatuses] = useState<Map<string, ServerStatus>>(new Map());

  // Mount the relay connection for paid users — Tauri keeps it open
  // across screen navigations until we stop it, but we tear it down
  // on unmount so we don't keep a WS dangling when the user signs
  // out + comes back. The infrastructure is ready for live state;
  // the owner-side `state_snapshot` command handler that actually
  // populates `relay-event` lands in a follow-up co-commit on the
  // desktop crate.
  useEffect(() => {
    if (!isPaid) return;
    let unsubConnected: (() => void) | undefined;
    let unsubDisconnected: (() => void) | undefined;
    let unsubEvent: (() => void) | undefined;
    setRelayStatus('connecting');

    // On connect: ask the owner for a full snapshot of every server's
    // current container status. The owner's RelayCommandExecutor
    // catches state.snapshot and replies with kind: state_snapshot.
    subscribeRelayConnected(() => {
      setRelayStatus('connected');
      void cloudRelaySendCmd({
        type: 'cmd',
        cmd: 'state.snapshot',
        request_id: crypto.randomUUID(),
      });
    }).then((u) => {
      unsubConnected = u;
    });
    subscribeRelayDisconnected(() => setRelayStatus('disconnected')).then((u) => {
      unsubDisconnected = u;
    });
    subscribeRelayEvent((msg) => {
      // Owner snapshot — replace the whole map. Drop entries the
      // owner didn't include (server was deleted owner-side).
      if (msg.kind === 'state_snapshot' && Array.isArray(msg.servers)) {
        const next = new Map<string, ServerStatus>();
        for (const s of msg.servers as Array<{ id: string; status: ServerStatus }>) {
          if (s?.id) next.set(s.id, s.status ?? 'unknown');
        }
        setStatuses(next);
        return;
      }
      // Patch a single row. server.state_changed fires every time the
      // owner-side serverStore observes a status transition.
      if (msg.kind === 'server.state_changed' && typeof msg.target === 'string') {
        const target = msg.target;
        const status = (msg.status ?? 'unknown') as ServerStatus;
        setStatuses((prev) => {
          const next = new Map(prev);
          next.set(target, status);
          return next;
        });
      }
    }).then((u) => {
      unsubEvent = u;
    });
    cloudRelayStart().catch((e) => {
      console.warn('relay start failed', e);
      setRelayStatus('disconnected');
    });
    return () => {
      unsubConnected?.();
      unsubDisconnected?.();
      unsubEvent?.();
      void cloudRelayStop();
    };
  }, [isPaid]);

  async function load(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    try {
      const servers = await cloudServersList();
      setState({ kind: 'ready', servers });
      // Piggy-back: also ask the relay for a fresh state snapshot if
      // it's connected. Without this, refresh would update the list
      // but leave stale badges from the connect-time snapshot.
      if (relayStatus === 'connected') {
        void cloudRelaySendCmd({
          type: 'cmd',
          cmd: 'state.snapshot',
          request_id: crypto.randomUUID(),
        });
      }
    } catch (e) {
      // 402 → paid plan required. Any other error → show inline.
      if (isCloudError(e) && e.status === 402) {
        setState({ kind: 'paywalled' });
      } else {
        setState({
          kind: 'error',
          message: isCloudError(e)
            ? (e.message ?? `Couldn't load servers (${e.code}).`)
            : e instanceof Error
              ? e.message
              : 'Something went wrong.',
        });
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (isPaid) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="list-screen">
      <header className="list-header">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="list-title">
          <div className="home-eyebrow">Cloud</div>
          <h1>Your servers</h1>
          {isPaid && <RelayBadge status={relayStatus} />}
        </div>
        {state.kind === 'ready' && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => load(true)}
            disabled={refreshing}
            aria-label="Refresh"
          >
            <RefreshCw
              size={16}
              style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined}
            />
          </button>
        )}
      </header>

      {state.kind === 'loading' && <ListLoading />}
      {state.kind === 'paywalled' && <Paywall plan={me.subscription.plan} />}
      {state.kind === 'error' && (
        <ListError message={state.message} onRetry={() => load()} />
      )}
      {state.kind === 'ready' &&
        (state.servers.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="server-list">
            {state.servers.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                status={statuses.get(s.id)}
                onOpen={() => onOpenServer(s)}
              />
            ))}
          </ul>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RelayBadge({
  status,
}: {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected';
}) {
  if (status === 'idle') return null;
  const isLive = status === 'connected';
  const label =
    status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline';
  return (
    <span className={`relay-badge ${isLive ? 'relay-badge--live' : ''}`}>
      {isLive ? <Wifi size={11} /> : <WifiOff size={11} />}
      {label}
    </span>
  );
}

function ServerRow({
  server,
  status,
  onOpen,
}: {
  server: ServerSummary;
  status: ServerStatus | undefined;
  onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" className="server-row" onClick={onOpen}>
        <div className="server-row-icon">
          <ServerCog size={18} />
        </div>
        <div className="server-row-body">
          <div className="server-row-name-row">
            <div className="server-row-name">{server.name}</div>
            {status && <StatusBadge status={status} />}
          </div>
          <div className="server-row-meta">
            Last synced {relativeTime(server.updatedAt)}
          </div>
        </div>
        <ChevronRight size={16} className="server-row-chev" />
      </button>
    </li>
  );
}

function StatusBadge({ status }: { status: ServerStatus }) {
  // Color buckets: green = healthy, amber = transitioning, red = bad,
  // muted = unknown / installing. Labels are 1–2 words to fit on a
  // 360 px width device beside the server name without truncation.
  const variant = statusVariant(status);
  return (
    <span className={`status-badge status-badge--${variant}`}>
      <span className="status-dot" aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

function statusVariant(s: ServerStatus): 'ok' | 'busy' | 'bad' | 'muted' {
  switch (s) {
    case 'running': return 'ok';
    case 'starting':
    case 'stopping': return 'busy';
    case 'crashed': return 'bad';
    case 'stopped':
    case 'installing':
    case 'unknown':
    default:
      return 'muted';
  }
}

function statusLabel(s: ServerStatus): string {
  switch (s) {
    case 'running': return 'Running';
    case 'stopped': return 'Stopped';
    case 'starting': return 'Starting';
    case 'stopping': return 'Stopping';
    case 'crashed': return 'Crashed';
    case 'installing': return 'Installing';
    default: return '—';
  }
}

function ListLoading() {
  return (
    <div className="list-state">
      <div className="server-skeleton" />
      <div className="server-skeleton" />
      <div className="server-skeleton" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="list-state">
      <div className="empty-mark">
        <ServerCog size={28} />
      </div>
      <h2>No cloud-synced servers yet</h2>
      <p>
        Spin up a server in the LocalForge desktop app — once it syncs to
        the cloud, it'll appear here within a few seconds.
      </p>
    </div>
  );
}

function ListError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="list-state">
      <h2>Couldn't load your servers</h2>
      <p>{message}</p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function Paywall({ plan }: { plan: 'free' | 'hobby' | 'team' }) {
  return (
    <div className="list-state">
      <div className="empty-mark empty-mark--lock">
        <Lock size={24} />
      </div>
      <h2>Cloud sync is a paid feature</h2>
      <p>
        Server sync, sub-user access and the audit log unlock with the
        Hobby plan (€5/mo). The LocalForge desktop app stays free
        forever for local hosting and remote VPS agents.
      </p>
      <p className="list-state-hint">
        You're currently on <strong>{plan[0]!.toUpperCase() + plan.slice(1)}</strong>. Upgrade
        from the desktop app or at <code>localforge.gg/account</code>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function relativeTime(unixMs: number): string {
  const diffMs = Date.now() - unixMs;
  if (diffMs < 0) return 'in the future';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(unixMs).toLocaleDateString();
}
