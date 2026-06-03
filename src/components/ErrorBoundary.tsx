import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level safety net. If anything in the React tree throws during render,
 * React unmounts the whole app and leaves a BLANK screen — the exact "no
 * content represented" failure an App Review reject can hinge on (Guideline
 * 2.1). Catching it here turns a silent blank into a visible, actionable
 * message and logs the error to the device console (Safari Web Inspector on
 * iOS, chrome://inspect on Android) for diagnosis.
 *
 * The Google-OAuth blank had a separate root cause (the cloud served the
 * desktop HTML bouncer into the in-app browser — fixed server-side). This
 * boundary guards every *other* unforeseen render crash so the app never
 * comes up empty.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[LocalForge] render error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    // A full reload re-runs the launch path (cloudMe → signed-in/out) cleanly.
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: '32px 24px',
          textAlign: 'center',
          background: '#07090f',
          color: '#e2e8f0',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>
          Something went wrong
        </div>
        <div
          style={{
            fontSize: 14,
            color: '#94a3b8',
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          LocalForge hit an unexpected error. Reload to try again — if it keeps
          happening, please reach us at support@localforge.gg.
        </div>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 6,
            padding: '10px 22px',
            borderRadius: 10,
            border: 0,
            background: 'linear-gradient(180deg,#3b82f6,#2563eb)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
        <pre
          style={{
            marginTop: 8,
            fontSize: 11,
            color: '#f87171',
            maxWidth: 320,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            opacity: 0.85,
          }}
        >
          {String(error.message || error)}
        </pre>
      </div>
    );
  }
}
