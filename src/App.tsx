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
import type { PluginListener } from '@tauri-apps/api/core';
import {
  register as registerPush,
  onOpenServer as onPushOpenServer,
  setQuickActions,
} from 'tauri-plugin-push-api';
import { LoginScreen } from './components/LoginScreen';
import { TabBar, type Tab } from './components/TabBar';
import { ServerListScreen, type ServerStatus } from './components/ServerListScreen';
import { ServerDetailScreen } from './components/ServerDetailScreen';
import { ServerConfigScreen } from './components/ServerConfigScreen';
import { MachinesScreen } from './components/MachinesScreen';
import { TeamScreen } from './components/TeamScreen';
import { AccountScreen } from './components/AccountScreen';
import { AcceptInviteBanner } from './components/AcceptInviteBanner';
import { SyncKeyDialog } from './components/SyncKeyDialog';
import {
  cloudClearOrgDek,
  cloudInvalidateLocalDek,
  cloudMe,
  cloudOrgsList,
  cloudProcessGrants,
  cloudPushRegister,
  cloudRelayStart,
  cloudRelayStop,
  cloudServersList,
  cloudSetActiveOrg,
  cloudSyncKeyStatus,
  cloudUnlockOrgDek,
  deepLinkReplay,
  subscribeInviteReceived,
  subscribeOpenServer,
  subscribeRelayEvent,
  type Me,
  type OrgSummary,
  type ServerSummary,
  type SyncKeyStatus,
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
  // Distinguishes "org list not fetched yet" from "no orgs" — a cross-org
  // push resolve must WAIT for the list instead of consuming the pending
  // open against an empty array (audit finding).
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  // A pending team invitation (from a `localforge://invite` deep link), shown
  // as a top banner until the user accepts or dismisses it.
  const [invite, setInvite] = useState<{ token: string; secret?: string | null } | null>(null);
  // A server (id + optional originating org) from a tapped crash push /
  // Quick Action, held until we're signed in so a cold-start or signed-out
  // tap isn't dropped (a separate effect resolves + navigates once state
  // becomes 'signed-in', switching orgs first when the push crossed orgs).
  const [pendingOpenServer, setPendingOpenServer] = useState<{
    id: string;
    orgId: string | null;
  } | null>(null);
  // Guards the cross-org switch so each pending open only attempts it once.
  const pendingSwitchTriedRef = useRef(false);
  // Assigned every render once `switchOrg` (declared further down) exists —
  // the resolve effect sits above that declaration and referencing the const
  // directly from its deps would TDZ-crash on first render.
  const switchOrgRef = useRef<((orgId: string | null) => Promise<void>) | null>(null);
  // Envelope-encryption (sync key) status for the signed-in user, and whether
  // the setup/unlock dialog was dismissed this session. OAuth users have no
  // account password to derive the KEK from, so they MUST set a passphrase here
  // or their keypair is never published (team grants + config decrypt break).
  const [syncKeyStatus, setSyncKeyStatus] = useState<SyncKeyStatus | null>(null);
  const [syncKeyDismissed, setSyncKeyDismissed] = useState(false);

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

  // OAuth can persist the token but fail the follow-up /me on a network blip —
  // Rust emits `cloud://signed-in-partial` and NOTHING listened, so the login
  // screen hung despite a valid session (audit finding). Retry /me with
  // backoff and complete the sign-in.
  useEffect(() => {
    let cancelled = false;
    let un: UnlistenFn | null = null;
    void listen('cloud://signed-in-partial', () => {
      void (async () => {
        for (let i = 0; i < 3 && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          try {
            const me = await cloudMe();
            if (me && !cancelled) {
              setState({ kind: 'signed-in', me, tab: 'servers', overlay: null });
              return;
            }
          } catch {
            /* transient — retry */
          }
        }
      })();
    }).then((fn) => {
      if (cancelled) fn();
      else un = fn;
    });
    return () => {
      cancelled = true;
      if (un) un();
    };
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

  // A tapped crash push or a home-screen Quick Action deep-links here with a
  // server id (`cloud://open-server`). We only STASH it here — the resolve +
  // navigate happens in the effect below once we're signed in, so a tap that
  // cold-starts the app (state still 'loading') or arrives while signed-out
  // isn't dropped. The `cancelled` flag closes the listen()-promise teardown
  // race (cleanup running before the subscribe promise resolves).
  useEffect(() => {
    let cancelled = false;
    let un: UnlistenFn | null = null;
    void subscribeOpenServer((serverId, orgId) => {
      pendingSwitchTriedRef.current = false;
      setPendingOpenServer({ id: serverId, orgId: orgId ?? null });
    }).then((fn) => {
      if (cancelled) fn();
      else {
        un = fn;
        // Replay the cold-launch deep link now that the listener exists —
        // Rust's on_open_url fires before the webview subscribes, so a link
        // that LAUNCHED the app was silently dropped (audit finding).
        void deepLinkReplay().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
      if (un) un();
    };
  }, []);

  // Resolve a pending open against the user's synced inventory and push that
  // server's detail (Servers tab). Runs when a pending id is set AND we're
  // signed in — covering the cold-start / post-login replay. If the push came
  // from a DIFFERENT org we belong to, switch the active org first (tried at
  // most once per pending open); the activeOrgId flip re-runs this effect
  // into the resolve branch. Best-effort: an id we can't resolve (org we
  // left / not yet synced) just lands on Servers.
  useEffect(() => {
    if (state.kind !== 'signed-in' || !pendingOpenServer) return;
    let cancelled = false;
    const { id, orgId } = pendingOpenServer;
    // A cross-org open can't be routed until the org list has loaded — bail
    // WITHOUT consuming the pending open; the orgsLoaded flip re-runs this
    // effect (audit finding: the resolve raced the org fetch and gave up).
    if (orgId && !orgsLoaded) return;
    const own = orgs.find((o) => o.isOwner);
    const currentOrgId = activeOrgId ?? own?.id ?? null;
    const target =
      orgId && orgId !== currentOrgId ? orgs.find((o) => o.id === orgId) : undefined;
    if (target && !pendingSwitchTriedRef.current && switchOrgRef.current) {
      pendingSwitchTriedRef.current = true;
      // switchOrg never rejects (it catches each step internally) and always
      // ends by flipping activeOrgId — which re-runs this effect to resolve.
      void switchOrgRef.current(target.isOwner ? null : target.id);
      return;
    }
    void cloudServersList()
      .then((servers) => {
        if (cancelled) return;
        const server = servers.find((s) => s.id === id) ?? null;
        setVisited((v) => (v.has('servers') ? v : new Set(v).add('servers')));
        setState((s) =>
          s.kind === 'signed-in'
            ? { ...s, tab: 'servers', overlay: server ? { kind: 'server', server } : null }
            : s,
        );
        pendingSwitchTriedRef.current = false;
        setPendingOpenServer(null);
      })
      .catch(() => {
        if (cancelled) return;
        setState((s) => (s.kind === 'signed-in' ? { ...s, tab: 'servers', overlay: null } : s));
        pendingSwitchTriedRef.current = false;
        setPendingOpenServer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state.kind, pendingOpenServer, activeOrgId, orgs, orgsLoaded]);

  // Once signed in: (a) register this device for remote push and hand the
  // token to the cloud, and (b) route a tapped crash push (the native plugin's
  // `openServer` event) into the same pending-open flow as deep links. Both
  // are best-effort — registerPush rejects with 'unsupported' on desktop or
  // 'denied' if the user declines, and neither should disrupt the app.
  useEffect(() => {
    if (state.kind !== 'signed-in') return;
    let cancelled = false;
    let listener: PluginListener | null = null;
    void registerPush()
      // Map device platform → push provider: iOS uses APNs, Android uses FCM.
      .then((res) => cloudPushRegister(res.platform === 'ios' ? 'apns' : 'fcm', res.token))
      .catch(() => {
        /* desktop / permission denied / offline — non-fatal */
      });
    void onPushOpenServer((serverId, orgId) => {
      pendingSwitchTriedRef.current = false;
      setPendingOpenServer({ id: serverId, orgId: orgId ?? null });
    })
      .then((l) => {
        if (cancelled) void l.unregister();
        else listener = l;
      })
      .catch(() => {
        /* desktop preview: no plugin event channel — non-fatal */
      });
    return () => {
      cancelled = true;
      if (listener) void listener.unregister();
    };
  }, [state.kind]);

  // Refresh home-screen Quick Actions from the ACTIVE org's synced servers
  // (top 4) — they went stale after an org switch (audit finding).
  useEffect(() => {
    if (state.kind !== 'signed-in') return;
    void cloudServersList()
      .then((servers) =>
        setQuickActions(servers.slice(0, 4).map((s) => ({ serverId: s.id, label: s.name }))),
      )
      .catch(() => {
        /* desktop no-op / offline — non-fatal */
      });
  }, [state.kind, activeOrgId]);

  // Sign-out hygiene: wipe Quick Actions (they'd keep the previous account's
  // server names on the home screen) + any pending open (audit finding).
  useEffect(() => {
    if (state.kind !== 'signed-out') return;
    setPendingOpenServer(null);
    pendingSwitchTriedRef.current = false;
    void setQuickActions([]).catch(() => {});
  }, [state.kind]);

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
      setOrgsLoaded(false);
      setActiveOrgId(null);
      return;
    }
    setOrgsLoaded(false);
    void cloudOrgsList()
      .then(setOrgs)
      .catch(() => setOrgs([]))
      .finally(() => setOrgsLoaded(true));
  }, [signedInId]);

  // Sync-key status follows the signed-in user; re-checked after a successful
  // setup/unlock (the dialog hides when it flips to 'unlocked').
  const refreshSyncKey = useCallback(() => {
    cloudSyncKeyStatus().then(setSyncKeyStatus).catch(() => setSyncKeyStatus(null));
  }, []);
  useEffect(() => {
    if (!signedInId) {
      setSyncKeyStatus(null);
      setSyncKeyDismissed(false);
      return;
    }
    setSyncKeyDismissed(false);
    refreshSyncKey();
  }, [signedInId, refreshSyncKey]);

  useEffect(() => {
    if (!relayUserId) return;
    let cancelled = false;
    // Point HTTP (X-LocalForge-Org) AND the relay at the active org before
    // connecting, so a sub-user observes the OWNER's org. Re-runs on switch.
    // SEQUENCED stop → header → start: these were three un-awaited calls, so
    // on an org switch the previous effect's async stop could land AFTER the
    // new start and kill the fresh connection with no retry (audit finding).
    void (async () => {
      await cloudRelayStop().catch(() => {});
      if (cancelled) return;
      await cloudSetActiveOrg(activeOrgId).catch(() => {});
      if (cancelled) return;
      await cloudRelayStart(activeOrgId).catch((e) => console.warn('relay start failed', e));
    })();
    return () => {
      cancelled = true;
      void cloudRelayStop();
    };
  }, [relayUserId, activeOrgId]);

  // React to a key rotation done on another device (a member was removed). Our
  // cached DEK for the active org is now stale: a member re-opens the fresh
  // sealed grant; an owner's phone invalidates its cached own-DEK so the next
  // op re-derives it (rather than re-sealing the stale one over the new grants).
  useEffect(() => {
    if (!relayUserId) return;
    let cancelled = false;
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
    }).then((fn) => {
      // Cancellation guard — this effect's deps change in normal use (org
      // switch), and without it a cleanup racing the listen() promise leaked
      // a duplicate listener (audit finding).
      if (cancelled) fn();
      else un = fn;
    });
    return () => {
      cancelled = true;
      if (un) un();
    };
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
  // Expose to the pending-open resolve effect above (declared before this
  // const exists — see the ref's comment).
  switchOrgRef.current = switchOrg;

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
  // The sync-key modal sits above everything (incl. the native tab bar), so the
  // native bar is hidden while it's up.
  const syncDialogOpen =
    signedIn && !syncKeyDismissed && syncKeyStatus !== null && syncKeyStatus !== 'unlocked';
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
    if (signedIn && !hasOverlay && !syncDialogOpen) void showNativeTabBar(NATIVE_TABS, tabRef.current);
    else void hideNativeTabBar();
  }, [signedIn, hasOverlay, syncDialogOpen]);

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
      {syncDialogOpen && (
        <SyncKeyDialog
          status={syncKeyStatus as Exclude<SyncKeyStatus, 'unlocked'>}
          onDone={refreshSyncKey}
          onSkip={() => setSyncKeyDismissed(true)}
        />
      )}
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
