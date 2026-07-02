/**
 * Servers tab — every server the user can reach, grouped by the machine
 * it runs on. Sources:
 *   - cloud-synced list (`cloud_servers_list`) for the inventory + names.
 *   - live relay discovery: for each ONLINE machine (desktop or agent, from
 *     `cloud_list_machines`) we send `state.snapshot` with request_id
 *     `disc:<machineId>`. The relay routes it to that exact machine (agents
 *     via sendToNode, desktops via sendToDevice — Phase 3), so every
 *     discovered server carries its machine id WITHOUT decrypting anything.
 * That machine id lets us label + group + filter, and route inline
 * start/stop straight to the right executor.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Cloud,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Server,
  ServerCog,
  Square,
} from 'lucide-react';
import {
  cloudListMachines,
  cloudRelaySendCmd,
  cloudServersList,
  openExternalUrl,
  isCloudError,
  subscribeRelayConnected,
  subscribeRelayDisconnected,
  subscribeRelayEvent,
  type Machine,
  type Me,
  type ServerSummary,
} from '../lib/cloud';
import {
  listProducts,
  purchaseAndVerify,
  restoreAndVerify,
  isUserCancelled,
  isIapError,
  type Product,
  type Plan,
} from '../lib/iap';

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
  onlineNodeIds: Set<string>;
  /** Whether an owner desktop is live on the relay. Used (with onlineNodeIds)
   *  as the presence signal that re-fetches the fleet so a machine that just
   *  came/went online updates without remounting. */
  desktopOnline?: boolean;
  embedded?: boolean;
  onBack: () => void;
  onOpenServer: (server: ServerSummary, status?: ServerStatus) => void;
  onMeUpdated: (me: Me) => void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'paywalled' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; servers: ServerSummary[] };

const ALL = '__all__';

export function ServerListScreen({ me, onlineNodeIds, desktopOnline, embedded, onBack, onOpenServer, onMeUpdated }: Props) {
  const isPaid = me.subscription.plan !== 'free';
  const [state, setState] = useState<State>(isPaid ? { kind: 'loading' } : { kind: 'paywalled' });
  const [refreshing, setRefreshing] = useState(false);
  const [statuses, setStatuses] = useState<Map<string, ServerStatus>>(new Map());
  // In-flight inline actions (request_id → what to revert to). Lets the
  // cmd_result handler roll back the optimistic status + surface the error —
  // failures used to leave the row on 'Starting…' forever (audit finding).
  const pendingCmdsRef = useRef<Map<string, { serverId: string; prev: ServerStatus | undefined }>>(
    new Map(),
  );
  const [actionErr, setActionErr] = useState<string | null>(null);
  /** Servers discovered live on a machine, keyed by machineId (the disc
   *  request_id). Includes desktops + agents now. */
  const [nodeServers, setNodeServers] = useState<Map<string, ServerSummary[]>>(new Map());
  /** The org fleet — id → name/kind/online — for labels + discovery targets. */
  const [machines, setMachines] = useState<Machine[]>([]);
  /** Active machine filter chip, or ALL. */
  const [filter, setFilter] = useState<string>(ALL);

  // Relay status badge + per-server status from snapshots / transitions.
  useEffect(() => {
    if (!isPaid) return;
    let unsubConnected: (() => void) | undefined;
    let unsubDisconnected: (() => void) | undefined;
    let unsubEvent: (() => void) | undefined;

    subscribeRelayConnected(() => {
      void cloudRelaySendCmd({ type: 'cmd', cmd: 'state.snapshot', request_id: crypto.randomUUID() });
    }).then((u) => { unsubConnected = u; });
    subscribeRelayDisconnected(() => {}).then((u) => { unsubDisconnected = u; });
    subscribeRelayEvent((msg) => {
      if (msg.kind === 'state_snapshot' && Array.isArray(msg.servers)) {
        const servers = msg.servers as Array<{ id?: string; status?: ServerStatus; name?: string }>;
        const rid = typeof msg.request_id === 'string' ? msg.request_id : '';
        if (rid.startsWith('disc:')) {
          const machineId = rid.slice('disc:'.length);
          const discovered: ServerSummary[] = servers
            .filter((s) => !!s?.id)
            .map((s) => ({ id: s.id as string, name: s.name ?? (s.id as string), updatedAt: Date.now(), nodeId: machineId }));
          setNodeServers((prev) => {
            const next = new Map(prev);
            next.set(machineId, discovered);
            return next;
          });
        }
        setStatuses((prev) => {
          const next = new Map(prev);
          for (const s of servers) if (s?.id) next.set(s.id, s.status ?? 'unknown');
          return next;
        });
        return;
      }
      if (msg.kind === 'cmd_result' && typeof msg.request_id === 'string') {
        const pending = pendingCmdsRef.current.get(msg.request_id);
        if (pending) {
          pendingCmdsRef.current.delete(msg.request_id);
          if (msg.success === false) {
            setStatuses((prev) => {
              const next = new Map(prev);
              if (pending.prev === undefined) next.delete(pending.serverId);
              else next.set(pending.serverId, pending.prev);
              return next;
            });
            setActionErr(typeof msg.error === 'string' ? msg.error : 'Command failed on the host');
          }
        }
        return;
      }
      if (msg.kind === 'server.state_changed' && typeof msg.target === 'string') {
        const target = msg.target;
        const status = (msg.status ?? 'unknown') as ServerStatus;
        setStatuses((prev) => {
          const next = new Map(prev);
          next.set(target, status);
          return next;
        });
      }
    }).then((u) => { unsubEvent = u; });

    void cloudRelaySendCmd({ type: 'cmd', cmd: 'state.snapshot', request_id: crypto.randomUUID() }).catch(() => {});
    return () => {
      unsubConnected?.();
      unsubDisconnected?.();
      unsubEvent?.();
    };
  }, [isPaid]);

  // Stable presence signal (contents, not Set identity — App.tsx mints a
  // fresh Set per event). Drives the fleet re-fetch so a machine that just
  // came/went online updates m.online → discovery targets, without a remount.
  const presenceKey = useMemo(
    () => `${desktopOnline ? 1 : 0}|${[...onlineNodeIds].sort().join(',')}`,
    [desktopOnline, onlineNodeIds],
  );

  // Fleet list for labels + discovery targets — re-fetched on presence change.
  useEffect(() => {
    if (!isPaid) return;
    void cloudListMachines().then(setMachines).catch(() => setMachines([]));
  }, [isPaid, presenceKey]);

  // Discover servers on every machine that's online — desktops AND agents.
  // The relay routes each disc to the right executor; responses carry the
  // machine id so we can group/label them.
  const onlineMachineIds = useMemo(() => {
    const ids = new Set<string>(onlineNodeIds);
    for (const m of machines) if (m.online) ids.add(m.id);
    return [...ids];
  }, [machines, onlineNodeIds]);
  const onlineKey = onlineMachineIds.join(',');

  useEffect(() => {
    if (!isPaid) return;
    for (const id of onlineMachineIds) {
      void cloudRelaySendCmd({
        type: 'cmd',
        cmd: 'state.snapshot',
        request_id: `disc:${id}`,
        args: { nodeId: id },
      }).catch(() => {});
    }
    // Drop servers from machines that went offline.
    setNodeServers((prev) => {
      const live = new Set(onlineMachineIds);
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) if (!live.has(id)) { next.delete(id); changed = true; }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaid, onlineKey]);

  async function load(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    try {
      const [servers] = await Promise.all([cloudServersList()]);
      setState({ kind: 'ready', servers });
      void cloudListMachines().then(setMachines).catch(() => {});
      void cloudRelaySendCmd({ type: 'cmd', cmd: 'state.snapshot', request_id: crypto.randomUUID() }).catch(() => {});
    } catch (e) {
      if (isCloudError(e) && e.status === 402) setState({ kind: 'paywalled' });
      else setState({ kind: 'error', message: isCloudError(e) ? (e.message ?? `Couldn't load servers (${e.code}).`) : 'Something went wrong.' });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (isPaid) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUpgraded(updated: Me) {
    onMeUpdated(updated);
    setState({ kind: 'loading' });
    void load();
  }

  // serverId → machineId, from live discovery.
  const serverMachine = useMemo(() => {
    const map = new Map<string, string>();
    for (const [machineId, list] of nodeServers) for (const s of list) map.set(s.id, machineId);
    return map;
  }, [nodeServers]);

  const machineName = (id: string | undefined): string | null => {
    if (!id) return null;
    return machines.find((m) => m.id === id)?.name ?? null;
  };

  // Full list = synced servers + live-discovered (dedup by id).
  const allServers = useMemo<ServerSummary[]>(() => {
    const cloud = state.kind === 'ready' ? state.servers : [];
    const seen = new Set(cloud.map((s) => s.id));
    const extra: ServerSummary[] = [];
    for (const list of nodeServers.values()) for (const s of list) if (!seen.has(s.id)) { seen.add(s.id); extra.push(s); }
    return [...cloud, ...extra];
  }, [state, nodeServers]);

  // The machine id a server belongs to: live discovery wins, else its own
  // nodeId (agent-only rows), else unknown.
  const machineOf = (s: ServerSummary): string | undefined => serverMachine.get(s.id) ?? s.nodeId;

  const displayed = useMemo(
    () => (filter === ALL ? allServers : allServers.filter((s) => machineOf(s) === filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allServers, filter, serverMachine],
  );

  // Chips: machines that actually host a visible server.
  const chipMachines = useMemo(() => {
    const ids = new Set<string>();
    for (const s of allServers) { const id = machineOf(s); if (id) ids.add(id); }
    return machines.filter((m) => ids.has(m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allServers, machines, serverMachine]);

  function sendAction(server: ServerSummary, action: 'start' | 'stop') {
    const nodeId = machineOf(server) ?? 'local';
    const requestId = crypto.randomUUID();
    const prev = statuses.get(server.id);
    pendingCmdsRef.current.set(requestId, { serverId: server.id, prev });
    setActionErr(null);
    void cloudRelaySendCmd({
      type: 'cmd',
      cmd: `server.${action}`,
      request_id: requestId,
      target: server.id,
      args: { nodeId },
    }).catch(() => {
      // Couldn't even reach the relay — revert the optimistic status and say
      // so (it used to fail silently; audit finding).
      pendingCmdsRef.current.delete(requestId);
      setStatuses((prevMap) => {
        const next = new Map(prevMap);
        if (prev === undefined) next.delete(server.id);
        else next.set(server.id, prev);
        return next;
      });
      setActionErr("Couldn't reach the relay — check your connection.");
    });
    // Optimistic: reflect the transition immediately; the real status
    // arrives via server.state_changed (or cmd_result reverts it).
    setStatuses((prevMap) => {
      const next = new Map(prevMap);
      next.set(server.id, action === 'start' ? 'starting' : 'stopping');
      return next;
    });
  }

  return (
    <div className="list-screen">
      <header className="list-header">
        {!embedded && (
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
            <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
        <div className="list-title">
          <h1>Servers</h1>
          {state.kind === 'ready' && (
            <div className="list-sub">
              {machines.length} node{machines.length === 1 ? '' : 's'} · {allServers.length} server{allServers.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
        {isPaid && (
          <span className={`relay-badge ${desktopOnline || onlineNodeIds.size > 0 ? 'relay-badge--live' : ''}`}>
            <span className="status-dot" aria-hidden />
            {desktopOnline || onlineNodeIds.size > 0 ? 'Live' : 'Offline'}
          </span>
        )}
        {state.kind === 'ready' && (
          <button type="button" className="icon-btn" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh">
            <RefreshCw size={16} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined} />
          </button>
        )}
      </header>

      {actionErr && (
        <div role="alert" style={{ color: '#fca5a5', fontSize: 13, padding: '6px 16px' }}>
          {actionErr}
        </div>
      )}

      {state.kind === 'loading' && <ListLoading />}
      {state.kind === 'paywalled' && <Paywall plan={me.subscription.plan} onUpgraded={handleUpgraded} />}
      {state.kind === 'error' && <ListError message={state.message} onRetry={() => load()} />}
      {state.kind === 'ready' &&
        (allServers.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {chipMachines.length > 0 && (
              <div className="filter-chips">
                <button className={`fchip ${filter === ALL ? 'on' : ''}`} onClick={() => setFilter(ALL)}>All</button>
                {chipMachines.map((m) => (
                  <button key={m.id} className={`fchip ${filter === m.id ? 'on' : ''}`} onClick={() => setFilter(m.id)}>
                    {m.kind === 'desktop' ? <Server size={12} /> : <Cloud size={12} />}
                    {m.name}
                  </button>
                ))}
              </div>
            )}
            <ul className="server-list">
              {displayed.map((s) => (
                <ServerRow
                  key={s.id}
                  server={s}
                  status={statuses.get(s.id)}
                  machine={machineName(machineOf(s))}
                  // Stamp the discovered node id so the detail screen routes
                  // relay cmds (start/backup/schedule/…) to the right host even
                  // when the synced config can't be decrypted (sync key locked).
                  onOpen={() => onOpenServer({ ...s, nodeId: machineOf(s) }, statuses.get(s.id))}
                  onAction={(a) => sendAction(s, a)}
                />
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

// Forged monogram tile: a 2-letter glyph on a deterministic on-brand
// gradient, echoing the design's GameIcon. The INITIALS carry the identity
// (colour is decorative), so it stays legible regardless of colour vision.
const MONOGRAM_GRADIENTS = [
  'linear-gradient(135deg, #fb923c, #c2410c)', // ember
  'linear-gradient(135deg, #38bdf8, #0369a1)', // steel
  'linear-gradient(135deg, #34d399, #047857)', // emerald
  'linear-gradient(135deg, #a78bfa, #6d28d9)', // violet
  'linear-gradient(135deg, #f472b6, #be185d)', // rose
  'linear-gradient(135deg, #facc15, #b45309)', // amber
];
function serverInitials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0]!.slice(0, 2);
  return words[0]![0]! + words[1]![0]!;
}
function monogramGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MONOGRAM_GRADIENTS[h % MONOGRAM_GRADIENTS.length]!;
}

function ServerRow({
  server,
  status,
  machine,
  onOpen,
  onAction,
}: {
  server: ServerSummary;
  status: ServerStatus | undefined;
  machine: string | null;
  onOpen: () => void;
  onAction: (action: 'start' | 'stop') => void;
}) {
  const running = status === 'running' || status === 'starting';
  const busy = status === 'starting' || status === 'stopping';
  return (
    <li>
      <button type="button" className="server-row" onClick={onOpen}>
        <div className="server-row-icon" style={{ background: monogramGradient(server.name) }}>
          {serverInitials(server.name)}
        </div>
        <div className="server-row-body">
          <div className="server-row-name-row">
            <div className="server-row-name">{server.name}</div>
            {status && <StatusBadge status={status} />}
          </div>
          <div className="server-row-meta">
            {machine ? <>on <strong style={{ color: 'var(--text)' }}>{machine}</strong></> : 'Cloud-synced'}
          </div>
        </div>
        {status && status !== 'installing' && (
          <span
            role="button"
            tabIndex={0}
            className={`row-action ${running ? 'row-action--stop' : 'row-action--start'}`}
            aria-label={running ? 'Stop' : 'Start'}
            aria-disabled={busy}
            onClick={(e) => { e.stopPropagation(); if (!busy) onAction(running ? 'stop' : 'start'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); if (!busy) onAction(running ? 'stop' : 'start'); } }}
          >
            {running ? <Square size={14} /> : <Play size={14} />}
          </span>
        )}
        <ChevronRight size={16} className="server-row-chev" />
      </button>
    </li>
  );
}

function StatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span className={`status-badge status-badge--${statusVariant(status)}`}>
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
    default: return 'muted';
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
      <div className="empty-mark"><ServerCog size={28} /></div>
      <h2>No servers yet</h2>
      <p>Spin up a server in the LocalForge desktop app — once it syncs, it appears here within a few seconds.</p>
    </div>
  );
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="list-state">
      <h2>Couldn't load your servers</h2>
      <p>{message}</p>
      <button type="button" className="auth-submit" onClick={onRetry}>Try again</button>
    </div>
  );
}

function Paywall({
  plan,
  onUpgraded,
}: {
  plan: 'free' | 'hobby' | 'team';
  onUpgraded: (me: Me) => void;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listProducts().then((p) => { if (alive) setProducts(p); }).catch((e) => { if (alive) setLoadError(paywallErr(e)); });
    return () => { alive = false; };
  }, []);

  async function buy(productId: string) {
    setNotice(null);
    setBusyId(productId);
    try {
      const me = await purchaseAndVerify(productId);
      onUpgraded(me);
    } catch (e) {
      if (!isUserCancelled(e)) setNotice(paywallErr(e));
    } finally {
      setBusyId(null);
    }
  }

  async function restore() {
    setNotice(null);
    setRestoring(true);
    try {
      const me = await restoreAndVerify();
      if (me && me.subscription.plan !== 'free') onUpgraded(me);
      else setNotice('No active subscription found to restore.');
    } catch (e) {
      setNotice(paywallErr(e));
    } finally {
      setRestoring(false);
    }
  }

  const ordered = (products ?? []).slice().sort((a, b) => planRank(a.plan) - planRank(b.plan));
  const busy = busyId !== null || restoring;

  return (
    <div className="list-state">
      <div className="empty-mark empty-mark--lock"><Lock size={24} /></div>
      <h2>Unlock cloud sync</h2>
      <p>
        Server sync, sub-user access and the audit log unlock with a
        subscription. The LocalForge desktop app stays free forever for local
        hosting and remote VPS agents.
      </p>

      {products === null && !loadError && (
        <div className="paywall-loading"><Loader2 size={16} className="spin" /> Loading plans…</div>
      )}
      {loadError && <p className="list-state-hint paywall-error">{loadError}</p>}
      {products !== null && ordered.length === 0 && !loadError && (
        <p className="list-state-hint">In-app purchases aren't available on this device.</p>
      )}
      {ordered.length > 0 && (
        <ul className="paywall-plans">
          {ordered.map((p) => (
            <li key={p.id} className="paywall-plan">
              <div className="paywall-plan-info">
                <div className="paywall-plan-name">{planTitle(p.plan)}</div>
                <div className="paywall-plan-desc">{planBlurb(p.plan)}</div>
                <div className="paywall-plan-terms">{p.displayPrice} per month · auto-renewing monthly subscription</div>
              </div>
              <button type="button" className="auth-submit paywall-buy" disabled={busy} onClick={() => buy(p.id)}>
                {busyId === p.id ? <Loader2 size={15} className="spin" /> : `${p.displayPrice}/mo`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="list-state-hint paywall-error">{notice}</p>}
      <button type="button" className="paywall-restore" onClick={restore} disabled={busy}>
        {restoring ? 'Restoring…' : 'Restore purchases'}
      </button>
      <p className="paywall-fineprint">
        Subscriptions renew automatically each month until cancelled. Cancel
        anytime in your device's store account settings. You're currently on{' '}
        <strong>{plan[0]!.toUpperCase() + plan.slice(1)}</strong>.
      </p>
      <p className="paywall-legal">
        <button type="button" className="paywall-legal-link" onClick={() => void openExternalUrl('https://localforge.gg/privacy')}>
          Privacy Policy
        </button>
        <span className="paywall-legal-sep"> · </span>
        <button type="button" className="paywall-legal-link" onClick={() => void openExternalUrl('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}>
          Terms of Use (EULA)
        </button>
      </p>
    </div>
  );
}

function planRank(p: Plan): number { return p === 'hobby' ? 0 : 1; }
function planTitle(p: Plan): string { return p === 'hobby' ? 'Hobby' : 'Team'; }
function planBlurb(p: Plan): string {
  return p === 'hobby' ? 'Cloud sync, audit log, and one sub-user seat.' : 'Everything in Hobby, plus team members and roles.';
}
function paywallErr(e: unknown): string {
  if (isIapError(e)) return e.message || 'Something went wrong with the store.';
  if (isCloudError(e)) return e.message ?? `Couldn't verify the purchase (${e.code}).`;
  return e instanceof Error ? e.message : 'Something went wrong.';
}
