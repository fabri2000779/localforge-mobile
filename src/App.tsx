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
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { LoginScreen } from './components/LoginScreen';
import { TabBar, type Tab } from './components/TabBar';
import { ServerListScreen, type ServerStatus } from './components/ServerListScreen';
import { ServerDetailScreen } from './components/ServerDetailScreen';
import { ServerConfigScreen } from './components/ServerConfigScreen';
import { MachinesScreen } from './components/MachinesScreen';
import { TeamScreen } from './components/TeamScreen';
import { AccountScreen } from './components/AccountScreen';
import { AcceptInviteBanner } from './components/AcceptInviteBanner';
import {
  cloudClearOrgDek,
  cloudInvalidateLocalDek,
  cloudMe,
  cloudOrgsList,
  cloudProcessGrants,
  cloudRelayStart,
  cloudRelayStop,
  cloudSetActiveOrg,
  cloudUnlockOrgDek,
  subscribeInviteReceived,
  subscribeRelayEvent,
  type Me,
  type OrgSummary,
  type ServerSummary,
} from './lib/cloud';
import { useSwipeBack } from './lib/useSwipeBack';
import {
  hasNativeTabBar,
  showNativeTabBar,
  hideNativeTabBar,
  setNativeSelected,
  onNativeTabSelect,
} from './lib/nativeTabBar';
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

// Native iOS tab bar items — same order as TAB_ORDER. The React TabBar uses
// lucide icons; the native UITabBar needs Apple SF Symbols.
const NATIVE_TABS = [
  { id: 'servers', label: 'Servers', sfSymbol: 'square.grid.2x2' },
  { id: 'machines', label: 'Machines', sfSymbol: 'externaldrive' },
  { id: 'team', label: 'Team', sfSymbol: 'person.2' },
  { id: 'account', label: 'Account', sfSymbol: 'person.crop.circle' },
];

function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Tabs that have been opened at least once. We mount each tab's screen
  // lazily, then KEEP it mounted (hidden) so switching tabs — or opening a
  // server detail — doesn't unmount + refetch (relay/request budget) and
  // doesn't lose live discovery state. See task #82.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(['servers']));
  // Every org the user belongs to + the one they're currently viewing. A
  // sub-user switches to the OWNER's org to see + control its servers;
  // `null` means their own primary org. Drives the X-LocalForge-Org header +
  // which org the relay connects to.
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  // A pending team invitation (from a `localforge://invite` deep link), shown
  // as a top banner until the user accepts or dismisses it.
  const [invite, setInvite] = useState<{ token: string; secret?: string | null } | null>(null);

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

  // Listen for invitation deep links at the app root (any state), so tapping
  // an invite link surfaces the accept banner even before sign-in. Persists
  // until the user accepts or dismisses.
  useEffect(() => {
    let un: UnlistenFn | null = null;
    void subscribeInviteReceived((p) => setInvite(p)).then((fn) => {
      un = fn;
    });
    return () => {
      if (un) un();
    };
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
  const signedInId = state.kind === 'signed-in' ? state.me.id : null;

  // Load the orgs the user belongs to (for the switcher). Reset the active
  // org when the signed-in user changes / signs out.
  useEffect(() => {
    if (!signedInId) {
      setOrgs([]);
      setActiveOrgId(null);
      return;
    }
    void cloudOrgsList().then(setOrgs).catch(() => setOrgs([]));
  }, [signedInId]);

  useEffect(() => {
    if (!relayUserId) return;
    // Point HTTP (X-LocalForge-Org) AND the relay at the active org before
    // connecting, so a sub-user observes the OWNER's org. Re-runs on switch.
    void cloudSetActiveOrg(activeOrgId).catch(() => {});
    void cloudRelayStart(activeOrgId).catch((e) => console.warn('relay start failed', e));
    return () => {
      void cloudRelayStop();
    };
  }, [relayUserId, activeOrgId]);

  // React to a key rotation done on another device (a member was removed). Our
  // cached DEK for the active org is now stale: a member re-opens the fresh
  // sealed grant; an owner's phone invalidates its cached own-DEK so the next
  // op re-derives it (rather than re-sealing the stale one over the new grants).
  useEffect(() => {
    if (!relayUserId) return;
    let un: UnlistenFn | null = null;
    void subscribeRelayEvent((msg) => {
      if (msg?.kind !== 'dek_rotated') return;
      const target = activeOrgId ? orgs.find((o) => o.id === activeOrgId) : null;
      const owned = activeOrgId === null || (target?.isOwner ?? false);
      if (owned) {
        void cloudInvalidateLocalDek().catch(() => {});
      } else if (activeOrgId) {
        void cloudUnlockOrgDek(activeOrgId).catch(() => {});
      }
    }).then((fn) => { un = fn; });
    return () => { if (un) un(); };
  }, [relayUserId, activeOrgId, orgs]);

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

  // Switch the active org: set the HTTP header FIRST (so the remounted tab
  // screens fetch against the right org), then flip state — which both
  // remounts the tabs (via the key below) and restarts the relay on the new
  // org (the effect above).
  const switchOrg = useCallback(async (orgId: string | null) => {
    const target = orgId ? orgs.find((o) => o.id === orgId) : null;
    const owned = orgId === null || (target?.isOwner ?? false);
    // DEK FIRST (it doesn't need the active-org header), THEN the header, then
    // flip React state — so a config decrypt can't run against a half-applied
    // org+key pair. The DEK follows the org: our own for an org we own, the
    // borrowed sealed-grant DEK for another owner's org.
    if (owned) {
      try { await cloudClearOrgDek(); } catch { /* */ }
    } else if (orgId) {
      try { await cloudUnlockOrgDek(orgId); } catch { /* surfaces as locked in config */ }
    }
    try { await cloudSetActiveOrg(orgId); } catch { /* falls back to primary */ }
    if (owned) {
      // Owner: seal grants to any members still waiting (the "confirm" step).
      // Fire-and-forget — needs our sync key unlocked; harmless no-op/412 else.
      const ownId = orgId ?? orgs.find((o) => o.isOwner)?.id;
      if (ownId) void cloudProcessGrants(ownId).catch(() => {});
    }
    setActiveOrgId(orgId);
  }, [orgs]);

  // After accepting an invite: refresh the org list, switch to the joined org
  // (which unlocks its DEK), and land on the Servers tab.
  const onInviteAccepted = useCallback(async (orgId: string) => {
    setInvite(null);
    try { setOrgs(await cloudOrgsList()); } catch { /* keep current list */ }
    await switchOrg(orgId);
    setState((s) => (s.kind === 'signed-in' ? { ...s, tab: 'servers', overlay: null } : s));
  }, [switchOrg]);

  // Enable the left-edge swipe only when an overlay is open.
  const canGoBack = state.kind === 'signed-in' && state.overlay !== null;
  useSwipeBack(goBack, canGoBack);

  // Switch tab: mark it visited (so it stays mounted) + clear any overlay.
  // A stable callback so the native-bar tap listener can hold onto it.
  const selectTab = useCallback((tab: Tab) => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
    setState((s) => (s.kind === 'signed-in' ? { ...s, tab, overlay: null } : s));
  }, []);

  // ── Native iOS tab bar (glasstabbar plugin) ───────────────────────────────
  // iOS gets a real UITabBar (Liquid Glass on iOS 26) mounted over the webview;
  // the CSS <TabBar> is hidden there. We hide the native bar under a full-screen
  // overlay (server detail/config) and when signed out. Android/desktop no-op.
  const signedIn = state.kind === 'signed-in';
  const hasOverlay = state.kind === 'signed-in' && state.overlay !== null;
  const currentTab = state.kind === 'signed-in' ? state.tab : null;
  const tabRef = useRef<Tab>('servers');
  if (currentTab) tabRef.current = currentTab;

  // Bridge native taps → route switch. Two paths (the plugin `select` event
  // AND a `window.__lfNativeTabSelect` global the Swift calls via the WebView)
  // so a tap lands even if the plugin-event path isn't delivered.
  useEffect(() => {
    if (!hasNativeTabBar || !signedIn) return;
    const w = window as unknown as { __lfNativeTabSelect?: (id: string) => void };
    w.__lfNativeTabSelect = (id) => selectTab(id as Tab);
    let listener: { unregister: () => void } | null = null;
    void onNativeTabSelect((id) => selectTab(id as Tab)).then((l) => {
      listener = l;
    });
    return () => {
      listener?.unregister();
      delete w.__lfNativeTabSelect;
    };
  }, [signedIn, selectTab]);

  // Mount the bar on a tab root; remove it under an overlay or when signed out.
  useEffect(() => {
    if (!hasNativeTabBar) return;
    if (signedIn && !hasOverlay) void showNativeTabBar(NATIVE_TABS, tabRef.current);
    else void hideNativeTabBar();
  }, [signedIn, hasOverlay]);

  // Keep the native highlight in sync when the route changes programmatically.
  useEffect(() => {
    if (!hasNativeTabBar || !signedIn || hasOverlay || !currentTab) return;
    void setNativeSelected(currentTab);
  }, [signedIn, hasOverlay, currentTab]);

  // Rendered (fixed-position) above whatever shell is showing, so an invite
  // can be accepted from the login screen or any tab.
  const inviteBanner = invite ? (
    <AcceptInviteBanner
      token={invite.token}
      secret={invite.secret}
      signedIn={state.kind === 'signed-in'}
      onAccepted={onInviteAccepted}
      onDismiss={() => setInvite(null)}
    />
  ) : null;

  if (state.kind === 'loading') {
    return (
      <div className="app-shell splash">
        {inviteBanner}
        <img src="/favicon.svg" width={64} height={64} alt="" />
        <span>LocalForge</span>
      </div>
    );
  }

  if (state.kind === 'signed-out') {
    return (
      <div className="app-shell">
        {inviteBanner}
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

  return (
    <div className="app-shell">
      {inviteBanner}
      {/* Tab shell stays mounted (hidden under an overlay) so its screens
          and live discovery survive opening a server detail. */}
      <div className="tabbed" style={{ display: state.overlay ? 'none' : 'flex' }}>
        {/* Keyed on the active org so switching remounts the tab screens —
            they refetch against the newly-active org (header already set). */}
        <div className="tab-scroll" key={`org-${activeOrgId ?? 'primary'}`}>
          {TAB_ORDER.map((t) =>
            visited.has(t) ? (
              <div key={t} style={{ display: state.tab === t ? 'block' : 'none' }}>
                {renderTab(state, t)}
              </div>
            ) : null,
          )}
        </div>
        {/* iOS uses the native UITabBar (glasstabbar plugin); only render the
            CSS bar on Android/desktop. */}
        {!hasNativeTabBar && <TabBar active={state.tab} onChange={selectTab} />}
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
            orgs={orgs}
            activeOrgId={activeOrgId}
            onSwitchOrg={switchOrg}
            onJoinedOrg={onInviteAccepted}
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
        activeOrgId={activeOrgId}
        onBack={() => setState({ ...s, overlay: { kind: 'server', server } })}
      />
    );
  }
}

export default App;
