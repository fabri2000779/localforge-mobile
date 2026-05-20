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
import { useEffect, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { HomeScreen } from './components/HomeScreen';
import { ServerListScreen } from './components/ServerListScreen';
import { ServerDetailScreen } from './components/ServerDetailScreen';
import { cloudMe, type Me, type ServerSummary } from './lib/cloud';
import './App.css';

type Route =
  | { kind: 'home' }
  | { kind: 'servers' }
  | { kind: 'server'; server: ServerSummary };

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
            onOpenServer={(server) =>
              setState({ ...s, route: { kind: 'server', server } })
            }
            onMeUpdated={(me) => setState({ ...s, me })}
          />
        );
      case 'server':
        return (
          <ServerDetailScreen
            server={s.route.server}
            onBack={() => setState({ ...s, route: { kind: 'servers' } })}
          />
        );
    }
  }
}

export default App;
