import ReactDOM from 'react-dom/client';
import App from './App';
import { applyPlatformClass } from './lib/platform';
// Crucible brand faces, self-hosted so they render offline (a phone
// controlling a server may be on spotty network). Space Grotesk is the
// display/UI face; JetBrains Mono is the console / mono face.
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './App.css';

// Tag <html> with the platform so the tab bar (and future chrome) can adopt
// the right native idiom: iOS Liquid-Glass vs Android Material 3.
applyPlatformClass();

// No StrictMode for now — mirrors the desktop where StrictMode caused
// double-firing effects that interfered with log streaming. If the
// mobile app turns out not to have streaming on these surfaces we can
// turn it back on safely.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />,
);
