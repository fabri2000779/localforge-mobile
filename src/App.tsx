/**
 * Root of the LocalForge mobile companion.
 *
 * State machine: loading → signed-out (login) → signed-in.
 * Once signed in, a simple route enum selects between Home and the
 * server list. We'll graduate to react-router once we have more than
 * 3 screens; today this is cheaper and zero-dep.
 */
import { useEffect, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { HomeScreen } from './components/HomeScreen';
import { ServerListScreen } from './components/ServerListScreen';
import { cloudMe, type Me } from './lib/cloud';
import './App.css';

type Route = 'home' | 'servers';

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
            ? { kind: 'signed-in', me, route: 'home' }
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
            setState({ kind: 'signed-in', me, route: 'home' })
          }
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {state.route === 'home' ? (
        <HomeScreen
          me={state.me}
          onSignedOut={() => setState({ kind: 'signed-out' })}
          onOpenServers={() =>
            setState({ ...state, route: 'servers' })
          }
        />
      ) : (
        <ServerListScreen
          me={state.me}
          onBack={() => setState({ ...state, route: 'home' })}
        />
      )}
    </div>
  );
}

export default App;
