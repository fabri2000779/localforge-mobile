/**
 * Root of the LocalForge mobile companion.
 *
 * State machine:
 *   loading → signed-out (login) → signed-in { route }
 *   route = 'home' | 'servers' | 'server'
 *
 * react-router is overkill at three screens; the cost reappraisal lives
 * in src/components/README when we approach it (org switcher, settings,
 * audit log etc.).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { LoginScreen } from './components/LoginScreen';
import { TabBar, type Tab } from './components/TabBar';
import { ServerListScreen, type ServerStatus } from './components/ServerListScreen';
import { ServerDetailScreen } from './components/ServerDetailScreen';
import { ServerConfigScreen } from './components/ServerConfigScreen';
import { MachinesScreen } from './components/MachinesScreen';
import { TeamScreen } from './components/TeamScreen';
import { AccountScreen } from './components/AccountScreen';
import {
  cloudMe,
  cloudRelayStart,
  cloudRelayStop,
  type Me,
  type ServerSummary,
} from './lib/cloud';
import { useSwipeBack } from './lib/useSwipeBack';
import './App.css';

// A server detail / config screen pushed ABOVE the tab shell. Null when
// we're sitting on one of the four tab roots.
type Overlay =
  | { kind: 'server'; server: ServerSummary; status?: ServerStatus }
  | { kind: 'config'; server: ServerSummary };

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; me: Me; tab: Tab; overlay: Overlay | null };

const TAB_ORDER: Tab[] = ['servers', 'machines', 'team', 'account'];

function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Tabs that have been opened at least once. We mount each tab's screen
  // lazily, then KEEP it mounted (hidden) so switching tabs — or opening a
  // server detail — doesn't unmount + refetch (relay/request budget) and
  // doesn't lose live discovery state. See task #82.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['servers']));

  useEffect(() => {
    cloudMe()
      .then((me) => {
        setState(
          me
            ? { kind: 'signed-in', me, tab: 'servers', overlay: null }
            : { kind: 'signed-out' },
        );
      })
      .catch((e) => {
        // If the call itself failed (no network, etc.) we still need
        // to show SOMETHING — fall back to the login screen rather
        // than a hung splash.
        console.error('cloud_me failed:', e);
        setState({ kind: 'signed-out' });
      });
  }, []);

  // Relay lifecycle lives here, at the app root, so the WebSocket
  // survives navigation between the server list, detail and config
  // screens. It used to be owned by ServerListScreen, which stopped it
  // on unmount — meaning the moment you tapped a server (unmounting the
  // list to show the detail) the relay died, and every command the
  // detail screen tried to send hit a dead socket. Paid users only;
  // started when we have a paid session, torn down on sign-out (or when
  // the signed-in user changes). Keyed on the user id so a benign `me`
  // refresh (same user, still paid) doesn't churn the connection.
  const relayUserId =
    state.kind === 'signed-in' && state.me.subscription.plan !== 'free'
      ? state.me.id
      : null;
  useEffect(() => {
    if (!relayUserId) return;
    void cloudRelayStart().catch((e) => console.warn('relay start failed', e));
    return () => {
      void cloudRelayStop();
    };
  }, [relayUserId]);

  // Track which executors are on the relay, from the `hello` peer list +
  // `presence` join/leave. Two kinds matter:
  //   - owner sockets (the user's desktop) → `desktopOnline`
  //   - node sockets (enrolled VPS agents)  → `onlineNodeIds`
  // The detail screen uses these to decide whether a given server can be
  // controlled right now (its agent OR the owner desktop must be present),
  // instead of a misleading "waiting for logs".
  const [desktopOnline, setDesktopOnline] = useState(false);
  const [onlineNodeIds, setOnlineNodeIds] = useState<Set<string>>(() => new Set());
  const ownerPeersRef = useRef(0);
  const nodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!relayUserId) {
      ownerPeersRef.current = 0;
      nodeIdsRef.current = new Set();
      setDesktopOnline(false);
      setOnlineNodeIds(new Set());
      return;
    }
    const unlistens: Array<() => void> = [];
    let active = true;
    const applyOwners = (n: number) => {
      ownerPeersRef.current = Math.max(0, n);
      setDesktopOnline(ownerPeersRef.current > 0);
    };
    const commitNodes = () => setOnlineNodeIds(new Set(nodeIdsRef.current));

    void listen<{
      you?: { session_id?: string };
      peers?: Array<{ kind?: string; session_id?: string; node_id?: string }>;
    }>('cloud://relay-hello', (e) => {
      const mySession = e.payload?.you?.session_id;
      const peers = e.payload?.peers ?? [];
      applyOwners(peers.filter((p) => p.kind === 'owner' && p.session_id !== mySession).length);
      nodeIdsRef.current = new Set(
        peers.filter((p) => p.kind === 'node' && p.node_id).map((p) => p.node_id as string),
      );
      commitNodes();
    }).then((u) => { if (active) unlistens.push(u); else u(); });

    void listen<{ kind?: string; client_kind?: string; node_id?: string }>(
      'cloud://relay-presence',
      (e) => {
        const p = e.payload;
        if (!p) return;
        if (p.client_kind === 'owner') {
          if (p.kind === 'join') applyOwners(ownerPeersRef.current + 1);
          else if (p.kind === 'leave') applyOwners(ownerPeersRef.current - 1);
        } else if (p.client_kind === 'node' && p.node_id) {
          if (p.kind === 'join') nodeIdsRef.current.add(p.node_id);
          else if (p.kind === 'leave') nodeIdsRef.current.delete(p.node_id);
          commitNodes();
        }
      },
    ).then((u) => { if (active) unlistens.push(u); else u(); });

    return () => {
      active = false;
      unlistens.forEach((u) => u());
      ownerPeersRef.current = 0;
      nodeIdsRef.current = new Set();
      setDesktopOnline(false);
      setOnlineNodeIds(new Set());
    };
  }, [relayUserId]);

  // One step "back" through the pushed overlays: config → server detail →
  // tab root. The tab roots themselves have nowhere to pop to (you switch
  // between them via the tab bar). Functional update so the callback is
  // stable and safe to hand to the swipe recognizer; the in-screen back
  // buttons call the same transitions, so gesture and button stay in sync.
  const goBack = useCallback(() => {
    setState((s) => {
      if (s.kind !== 'signed-in' || !s.overlay) return s;
      if (s.overlay.kind === 'config')
        return { ...s, overlay: { kind: 'server', server: s.overlay.server } };
      return { ...s, overlay: null }; // server detail → back to the Servers tab
    });
  }, []);

  // Enable the left-edge swipe only when an overlay is open.
  const canGoBack = state.kind === 'signed-in' && state.overlay !== null;
  useSwipeBack(goBack, canGoBack);

  if (state.kind === 'loading') {
    return (
      <div className="app-shell splash">
        <img src="/favicon.svg" width={64} height={64} alt="" />
        <span>LocalForge</span>
      </div>
    );
  }

  if (state.kind === 'signed-out') {
    return (
      <div className="app-shell">
        <LoginScreen
          onSignedIn={(me) =>
            setState({
              kind: 'signed-in',
              me,
              tab: 'servers',
              overlay: null,
            })
          }
        />
      </div>
    );
  }

  // Switch tab: remember it's been visited (so it stays mounted) and clear
  // any overlay.
  const selectTab = (tab: Tab) => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
    setState((s) => (s.kind === 'signed-in' ? { ...s, tab, overlay: null } : s));
  };

  return (
    <div className="app-shell">
      {/* Tab shell stays mounted (hidden under an overlay) so its screens
          and live discovery survive opening a server detail. */}
      <div className="tabbed" style={{ display: state.overlay ? 'none' : 'flex' }}>
        <div className="tab-scroll">
          {TAB_ORDER.map((t) =>
            visited.has(t) ? (
              <div key={t} style={{ display: state.tab === t ? 'block' : 'none' }}>
                {renderTab(state, t)}
              </div>
            ) : null,
          )}
        </div>
        <TabBar active={state.tab} onChange={selectTab} />
      </div>
      {state.overlay && renderOverlay(state, state.overlay)}
    </div>
  );

  // A tab root, rendered (and kept mounted) once visited.
  function renderTab(s: Extract<State, { kind: 'signed-in' }>, tab: Tab) {
    switch (tab) {
      case 'servers':
        return (
          <ServerListScreen
            me={s.me}
            embedded
            desktopOnline={desktopOnline}
            onlineNodeIds={onlineNodeIds}
            onBack={() => {}}
            onOpenServer={(server, status) =>
              setState({ ...s, overlay: { kind: 'server', server, status } })
            }
            onMeUpdated={(me) => setState({ ...s, me })}
          />
        );
      case 'machines':
        return (
          <MachinesScreen
            desktopOnline={desktopOnline}
            onlineNodeIds={onlineNodeIds}
            isPaid={s.me.subscription.plan !== 'free'}
          />
        );
      case 'team':
        return <TeamScreen me={s.me} />;
      case 'account':
        return (
          <AccountScreen
            me={s.me}
            desktopOnline={desktopOnline}
            onlineNodeIds={onlineNodeIds}
            onSignedOut={() => setState({ kind: 'signed-out' })}
          />
        );
    }
  }

  // A server detail / config screen pushed full-screen over the tabs.
  function renderOverlay(s: Extract<State, { kind: 'signed-in' }>, overlay: Overlay) {
    if (overlay.kind === 'server') {
      const server = overlay.server;
      return (
        <ServerDetailScreen
          server={server}
          initialStatus={overlay.status}
          desktopOnline={desktopOnline}
          onlineNodeIds={onlineNodeIds}
          onBack={() => setState({ ...s, overlay: null })}
          onOpenConfig={() => setState({ ...s, overlay: { kind: 'config', server } })}
        />
      );
    }
    const server = overlay.server;
    return (
      <ServerConfigScreen
        server={server}
        onBack={() => setState({ ...s, overlay: { kind: 'server', server } })}
      />
    );
  }
}

export default App;
