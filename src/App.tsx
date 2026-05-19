/**
 * Root of the LocalForge mobile companion.
 *
 * State machine is tiny: on mount we ask Rust whether a session is
 * stored on disk (`cloud_me`). If yes, we land on Home; if no, on
 * the login screen. There's no offline mode — the mobile app is a
 * pure cloud client.
 */
import { useEffect, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { HomeScreen } from './components/HomeScreen';
import { cloudMe, type Me } from './lib/cloud';
import './App.css';

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; me: Me };

function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    cloudMe()
      .then((me) => {
        setState(me ? { kind: 'signed-in', me } : { kind: 'signed-out' });
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

  return (
    <div className="app-shell">
      {state.kind === 'signed-out' ? (
        <LoginScreen
          onSignedIn={(me) => setState({ kind: 'signed-in', me })}
        />
      ) : (
        <HomeScreen
          me={state.me}
          onSignedOut={() => setState({ kind: 'signed-out' })}
        />
      )}
    </div>
  );
}

export default App;
