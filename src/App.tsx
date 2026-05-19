/**
 * Pre-alpha shell. Once the cloud client is wired up (extracted from
 * the desktop's src-tauri/src/cloud/* into a shared crate), this turns
 * into a real login → server list flow. For now it just confirms that
 * the Tauri + React + Vite scaffold renders on a phone.
 */
import { Smartphone } from 'lucide-react';

function App() {
  return (
    <div className="app-shell">
      <header className="app-titlebar">
        <Smartphone size={16} />
        <span>LocalForge</span>
      </header>

      <main className="app-main">
        <div className="card">
          <h1>Pre-alpha</h1>
          <p>
            The mobile companion. Sign-in, server list and console will
            land here as the cloud client crate stabilises. Right now
            you're looking at the scaffold confirming the React + Tauri
            mobile pipeline renders.
          </p>
          <p className="hint">
            Building locally: <code>npm run tauri android dev</code>
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
