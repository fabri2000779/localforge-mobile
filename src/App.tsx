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
import { HomeScreen } from './components/HomeScreen';
import { ServerListScreen, type ServerStatus } from './components/ServerListScreen';
import { ServerDetailScreen } from './components/ServerDetailScreen';
import { ServerConfigScreen } from './components/ServerConfigScreen';
import {
  cloudMe,
  cloudRelayStart,
  cloudRelayStop,
  type Me,
  type ServerSummary,
} from './lib/cloud';
import { useSwipeBack } from './lib/useSwipeBack';
import './App.css';

type Route =
  | { kind: 'home' }
  | { kind: 'servers' }
  | { kind: 'server'; server: ServerSummary; status?: ServerStatus }
  | { kind: 'config'; server: ServerSummary };

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; me: Me; route: Route };

function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    cloudMe()
      .then((me) => {
        setState(
          me
            ? { kind: 'signed-in', me, route: { kind: 'home' } }
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

  // Track whether the owner's executor (their desktop / VPS agent) is
  // actually on the relay. The detail screen uses this to say "your
  // desktop isn't connected" instead of a misleading "waiting for logs"
  // when nothing can answer. We count the *other* owner-kind sockets
  // (everything but this phone) from the relay `hello` peer list, then
  // adjust on `presence` join/leave.
  const [desktopOnline, setDesktopOnline] = useState(false);
  const ownerPeersRef = useRef(0);
  useEffect(() => {
    if (!relayUserId) {
      ownerPeersRef.current = 0;
      setDesktopOnline(false);
      return;
    }
    const unlistens: Array<() => void> = [];
    let active = true;
    const apply = (n: number) => {
      ownerPeersRef.current = Math.max(0, n);
      setDesktopOnline(ownerPeersRef.current > 0);
    };
    void listen<{ you?: { session_id?: string }; peers?: Array<{ kind?: string; session_id?: string }> }>(
      'cloud://relay-hello',
      (e) => {
        const mySession = e.payload?.you?.session_id;
        const peers = e.payload?.peers ?? [];
        apply(peers.filter((p) => p.kind === 'owner' && p.session_id !== mySession).length);
      },
    ).then((u) => { if (active) unlistens.push(u); else u(); });
    void listen<{ kind?: string; client_kind?: string }>(
      'cloud://relay-presence',
      (e) => {
        if (e.payload?.client_kind !== 'owner') return;
        if (e.payload.kind === 'join') apply(ownerPeersRef.current + 1);
        else if (e.payload.kind === 'leave') apply(ownerPeersRef.current - 1);
      },
    ).then((u) => { if (active) unlistens.push(u); else u(); });
    return () => {
      active = false;
      unlistens.forEach((u) => u());
      ownerPeersRef.current = 0;
      setDesktopOnline(false);
    };
  }, [relayUserId]);

  // One step "back" through the signed-in routes: server → servers →
  // home. Functional update so the callback is stable (no `state` dep)
  // and safe to hand to the swipe recognizer. The icon-btn back buttons
  // call the same transitions, so gesture and button stay in lock-step.
  const goBack = useCallback(() => {
    setState((s) => {
      if (s.kind !== 'signed-in') return s;
      if (s.route.kind === 'config')
        return { ...s, route: { kind: 'server', server: s.route.server } };
      if (s.route.kind === 'server') return { ...s, route: { kind: 'servers' } };
      if (s.route.kind === 'servers') return { ...s, route: { kind: 'home' } };
      return s; // home is the root — nothing to pop
    });
  }, []);

  // Enable the left-edge swipe only when there's somewhere to go back to.
  const canGoBack = state.kind === 'signed-in' && state.route.kind !== 'home';
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
              route: { kind: 'home' },
            })
          }
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {renderRoute(state)}
    </div>
  );

  function renderRoute(s: Extract<State, { kind: 'signed-in' }>) {
    switch (s.route.kind) {
      case 'home':
        return (
          <HomeScreen
            me={s.me}
            onSignedOut={() => setState({ kind: 'signed-out' })}
            onOpenServers={() =>
              setState({ ...s, route: { kind: 'servers' } })
            }
          />
        );
      case 'servers':
        return (
          <ServerListScreen
            me={s.me}
            onBack={() => setState({ ...s, route: { kind: 'home' } })}
            onOpenServer={(server, status) =>
              setState({ ...s, route: { kind: 'server', server, status } })
            }
            onMeUpdated={(me) => setState({ ...s, me })}
          />
        );
      case 'server': {
        const server = s.route.server;
        return (
          <ServerDetailScreen
            server={server}
            initialStatus={s.route.status}
            desktopOnline={desktopOnline}
            onBack={() => setState({ ...s, route: { kind: 'servers' } })}
            onOpenConfig={() => setState({ ...s, route: { kind: 'config', server } })}
          />
        );
      }
      case 'config': {
        const server = s.route.server;
        return (
          <ServerConfigScreen
            server={server}
            onBack={() => setState({ ...s, route: { kind: 'server', server } })}
          />
        );
      }
    }
  }
}

export default App;
