import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

// No StrictMode for now — mirrors the desktop where StrictMode caused
// double-firing effects that interfered with log streaming. If the
// mobile app turns out not to have streaming on these surfaces we can
// turn it back on safely.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />,
);
