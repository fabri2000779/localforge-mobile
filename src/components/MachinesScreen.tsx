/**
 * Machines tab — the org fleet (desktops + agents) the user can reach
 * over the relay. Data from `cloud_list_machines` (GET /v1/nodes/machines);
 * `online` is live from the relay DO. We OR in the locally-tracked online
 * node ids so a machine that just came up shows green without a refetch.
 */
import { useEffect, useState } from 'react';
import { HardDrive, Server, Cloud, RefreshCw } from 'lucide-react';
import { cloudListMachines, isCloudError, type Machine } from '../lib/cloud';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; machines: Machine[] };

export function MachinesScreen({
  desktopOnline,
  onlineNodeIds,
  isPaid,
}: {
  desktopOnline: boolean;
  onlineNodeIds: Set<string>;
  isPaid: boolean;
}) {
  const [state, setState] = useState<State>(isPaid ? { kind: 'loading' } : { kind: 'ready', machines: [] });
  const [refreshing, setRefreshing] = useState(false);
  // Re-fetch the fleet whenever relay presence changes, so a machine that
  // just came/went online flips its badge without a manual refresh.
  const presenceKey = `${desktopOnline ? 1 : 0}|${[...onlineNodeIds].sort().join(',')}`;

  async function load(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    try {
      const machines = await cloudListMachines();
      setState({ kind: 'ready', machines });
    } catch (e) {
      setState({
        kind: 'error',
        message: isCloudError(e) ? (e.message ?? `Couldn't load machines (${e.code}).`) : 'Something went wrong.',
      });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (isPaid) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaid, presenceKey]);

  if (!isPaid) {
    return (
      <div className="tab-screen">
        <div className="tab-screen-head"><h1>Machines</h1></div>
        <section className="card" style={{ textAlign: 'center', padding: '26px 18px' }}>
          <div className="empty-mark" style={{ margin: '0 auto 12px' }}><HardDrive size={26} /></div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>Your machines</h2>
          <p className="home-sub" style={{ marginTop: 6 }}>
            Upgrade to see and switch between every machine running your
            servers — your desktop and your VPS agents.
          </p>
        </section>
      </div>
    );
  }

  // Live overlay: a machine is online if the cloud says so OR it's in our
  // locally-tracked relay presence set.
  const isOnline = (m: Machine) => m.online || onlineNodeIds.has(m.id);
  const machines = state.kind === 'ready' ? state.machines : [];
  const desktops = machines.filter((m) => m.kind === 'desktop');
  const agents = machines.filter((m) => m.kind === 'agent');

  return (
    <div className="tab-screen">
      <div className="tab-screen-head">
        <h1>Machines</h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw size={16} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined} />
        </button>
      </div>

      {state.kind === 'error' && (
        <section className="card" style={{ textAlign: 'center', padding: '22px 18px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>Couldn't load machines</h2>
          <p className="home-sub" style={{ marginTop: 6 }}>{state.message}</p>
          <button type="button" className="ghost-btn" style={{ marginTop: 12 }} onClick={() => load()}>Try again</button>
        </section>
      )}

      {state.kind === 'ready' && machines.length === 0 && (
        <section className="card" style={{ textAlign: 'center', padding: '24px 18px' }}>
          <div className="empty-mark" style={{ margin: '0 auto 12px' }}><HardDrive size={26} /></div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>No machines yet</h2>
          <p className="home-sub" style={{ marginTop: 6 }}>
            Sign in to LocalForge on a desktop, or connect a VPS agent, and it
            shows up here.
          </p>
        </section>
      )}

      {desktops.length > 0 && <MachineGroup label="Desktops" machines={desktops} isOnline={isOnline} />}
      {agents.length > 0 && <MachineGroup label="VPS agents" machines={agents} isOnline={isOnline} />}
    </div>
  );
}

function MachineGroup({
  label,
  machines,
  isOnline,
}: {
  label: string;
  machines: Machine[];
  isOnline: (m: Machine) => boolean;
}) {
  return (
    <>
      <div className="lf-sectlabel">{label}</div>
      {machines.map((m) => {
        const online = isOnline(m);
        const desktop = m.kind === 'desktop';
        return (
          <section className="card" key={m.id}>
            <div className="card-row" style={{ alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div className={`lf-tile ${desktop ? '' : 'violet'}`}>
                  {desktop ? <Server size={18} /> : <Cloud size={18} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="nav-card-title" style={{ fontSize: 14 }}>{m.name}</div>
                  <div className="nav-card-sub">
                    {desktop ? 'Desktop' : 'VPS agent'}
                    {!online && m.lastSeenAt ? ` · last seen ${relativeTime(m.lastSeenAt)}` : ''}
                  </div>
                </div>
              </div>
              <span className={`status-badge ${online ? 'status-badge--ok' : 'status-badge--muted'}`}>
                <span className="status-dot" aria-hidden />
                {online ? 'online' : 'offline'}
              </span>
            </div>
          </section>
        );
      })}
    </>
  );
}

function relativeTime(unixMs: number): string {
  const diffMs = Date.now() - unixMs;
  if (diffMs < 0) return 'just now';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(unixMs).toLocaleDateString();
}
