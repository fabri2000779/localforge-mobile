/**
 * First screen the user lands on cold. There's no anonymous mode on
 * mobile — the phone isn't a node, so we have nothing to show before
 * a cloud session exists.
 *
 * Three modes share the card: sign in, sign up, forgot password. The
 * OAuth row is rendered but disabled until the cloud-side
 * /v1/auth/<provider>/start?mobile=1 + the mobile-callback bouncer
 * land — that's the next mobile + cloud co-commit.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Mail, Lock, AlertOctagon, ArrowLeft } from 'lucide-react';
import {
  cloudLogin,
  cloudSignup,
  cloudRequestPasswordReset,
  cloudOAuthStart,
  isCloudError,
  subscribeAuthError,
  subscribeSignedIn,
  type Me,
  type OAuthErrorEvent,
  type OAuthProvider,
} from '../lib/cloud';

type Mode = 'signin' | 'signup' | 'forgot';

interface Props {
  onSignedIn: (me: Me) => void;
}

export function LoginScreen({ onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  // True while we're waiting for the OAuth deep-link to come back from
  // the system browser. UX-wise we lock the whole card so the user
  // doesn't kick off three OAuth flows in parallel.
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null);

  // Subscribe to the deep-link events the Rust side emits when the
  // OAuth callback lands. Both listeners are torn down on unmount —
  // Tauri's `listen` resolves with an unlisten fn we MUST call back
  // or the handler leaks across re-renders + screen changes.
  useEffect(() => {
    let unsubSignedIn: (() => void) | undefined;
    let unsubError: (() => void) | undefined;
    subscribeSignedIn((me) => {
      setOauthPending(null);
      setError(null);
      onSignedIn(me);
    }).then((u) => {
      unsubSignedIn = u;
    });
    subscribeAuthError((e) => {
      setOauthPending(null);
      setError(prettyAuthError(e));
    }).then((u) => {
      unsubError = u;
    });
    return () => {
      unsubSignedIn?.();
      unsubError?.();
    };
    // `onSignedIn` is the parent's callback prop — re-subscribing on
    // each render would tear down + rebuild the Tauri event listener
    // every keystroke. We snapshot at mount and rely on parents
    // holding stable refs (App.tsx does).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startOAuth(provider: OAuthProvider) {
    setError(null);
    setOauthPending(provider);
    try {
      await cloudOAuthStart(provider);
      // If the OS for some reason refuses to open the browser, the
      // deep-link event will never fire. We let the user retry by
      // clicking again — there's no good timeout to pick here, and
      // a "stuck" pending state at least makes the failure visible.
    } catch (e) {
      setOauthPending(null);
      setError(e instanceof Error ? e.message : 'Could not open the browser.');
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'forgot') {
        await cloudRequestPasswordReset(email.trim());
        setResetSent(true);
        return;
      }
      const me =
        mode === 'signin'
          ? await cloudLogin(email.trim(), password)
          : await cloudSignup(
              email.trim(),
              password,
              displayName.trim() || undefined,
            );
      onSignedIn(me);
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === 'forgot' && resetSent) {
    return (
      <ResetSentMessage
        email={email}
        onBack={() => {
          setResetSent(false);
          setMode('signin');
        }}
      />
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-header">
        <div className="auth-mark">
          <img src="/favicon.svg" width={40} height={40} alt="" />
        </div>
        <div className="auth-wordmark">Local<span>Forge</span></div>
        <h1>{mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset password' : 'Sign in'}</h1>
        <p>
          {mode === 'signup'
            ? 'Cloud sync, sub-users and live alerts — same account as the LocalForge desktop.'
            : mode === 'forgot'
              ? "We'll email you a link to set a new password."
              : 'Welcome back. Use the same credentials as the desktop app.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="auth-form">
        {mode === 'signup' && (
          <Field
            label="Display name (optional)"
            type="text"
            autoComplete="name"
            placeholder="What should we call you?"
            value={displayName}
            onChange={setDisplayName}
            disabled={submitting}
          />
        )}
        <Field
          label="Email"
          type="email"
          icon={<Mail size={14} />}
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={setEmail}
          disabled={submitting}
        />
        {mode !== 'forgot' && (
          <Field
            label="Password"
            type="password"
            icon={<Lock size={14} />}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={10}
            placeholder={mode === 'signup' ? 'At least 10 characters' : ''}
            value={password}
            onChange={setPassword}
            disabled={submitting}
          />
        )}

        {error && (
          <div className="auth-error">
            <AlertOctagon size={14} />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          className="auth-submit"
          disabled={
            submitting ||
            !email ||
            (mode !== 'forgot' && password.length < 10)
          }
        >
          {submitting
            ? '…'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'forgot'
                ? 'Send reset link'
                : 'Sign in'}
        </button>

        {mode === 'signin' && (
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              setError(null);
              setMode('forgot');
            }}
          >
            Forgot password?
          </button>
        )}
      </form>

      {mode !== 'forgot' && (
        <>
          <div className="auth-divider">
            <span>or continue with</span>
          </div>

          <div className="oauth-row">
            <OAuthButton
              provider="google"
              pending={oauthPending === 'google'}
              disabled={submitting || (oauthPending !== null && oauthPending !== 'google')}
              onClick={() => startOAuth('google')}
            />
            <OAuthButton
              provider="discord"
              pending={oauthPending === 'discord'}
              disabled={submitting || (oauthPending !== null && oauthPending !== 'discord')}
              onClick={() => startOAuth('discord')}
            />
            <OAuthButton
              provider="github"
              pending={oauthPending === 'github'}
              disabled={submitting || (oauthPending !== null && oauthPending !== 'github')}
              onClick={() => startOAuth('github')}
            />
          </div>
          {oauthPending && (
            <p className="auth-coming-soon">
              Finish signing in in your browser — we'll bounce you back here.
            </p>
          )}
        </>
      )}

      <div className="auth-switch">
        {mode === 'signin' && (
          <>
            New here?{' '}
            <button
              type="button"
              className="auth-link inline"
              onClick={() => {
                setError(null);
                setMode('signup');
              }}
            >
              Create an account
            </button>
          </>
        )}
        {mode === 'signup' && (
          <>
            Already have an account?{' '}
            <button
              type="button"
              className="auth-link inline"
              onClick={() => {
                setError(null);
                setMode('signin');
              }}
            >
              Sign in
            </button>
          </>
        )}
        {mode === 'forgot' && (
          <button
            type="button"
            className="auth-link inline back"
            onClick={() => {
              setError(null);
              setMode('signin');
            }}
          >
            <ArrowLeft size={13} /> Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  onChange: (v: string) => void;
  icon?: React.ReactNode;
  autoComplete?: string;
  inputMode?: 'email' | 'text';
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  minLength?: number;
  disabled?: boolean;
}

function Field({
  label,
  type,
  value,
  onChange,
  icon,
  autoComplete,
  inputMode,
  placeholder,
  autoFocus,
  required,
  minLength,
  disabled,
}: FieldProps) {
  return (
    <label className="auth-field">
      <span>
        {icon && <span className="auth-field-icon">{icon}</span>}
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        minLength={minLength}
        disabled={disabled}
        // iOS-specific: don't capitalise the first letter of emails or
        // passwords, and don't try to auto-correct them.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
    </label>
  );
}

function OAuthButton({
  provider,
  pending,
  disabled,
  onClick,
}: {
  provider: 'google' | 'discord' | 'github';
  pending?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const label = provider[0]!.toUpperCase() + provider.slice(1);
  return (
    <button
      type="button"
      className="oauth-btn"
      disabled={disabled}
      onClick={onClick}
      title={`Sign in with ${label}`}
      aria-busy={pending || undefined}
    >
      <ProviderGlyph provider={provider} />
      <span>{pending ? '…' : label}</span>
    </button>
  );
}

/** Inline brand SVGs — rendered as markup, so there are no image
 *  assets to 404 in the bundled WebView (the old CSS color-chips looked
 *  broken). */
function ProviderGlyph({ provider }: { provider: 'google' | 'discord' | 'github' }) {
  if (provider === 'google') {
    return (
      <svg className="oauth-glyph" viewBox="0 0 48 48" width={18} height={18} aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    );
  }
  if (provider === 'discord') {
    return (
      <svg className="oauth-glyph" viewBox="0 0 24 24" width={18} height={18} fill="#5865F2" aria-hidden>
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    );
  }
  return (
    <svg className="oauth-glyph" viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function ResetSentMessage({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-header">
        <div className="auth-mark auth-mark--ok">
          <Mail size={20} />
        </div>
        <h1>Check your inbox</h1>
        <p>
          If <strong>{email}</strong> matches a LocalForge account, we just
          emailed you a link to set a new password. The link is good for 24
          hours.
        </p>
      </div>
      <button type="button" className="auth-submit" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Map the `cloud://auth-error` event payload (emitted by the Rust
 *  oauth handler) to a sentence the user can act on. */
function prettyAuthError(e: OAuthErrorEvent): string {
  switch (e.code) {
    case 'no_token':
      return "The provider didn't return a token. Try again.";
    case 'token_store':
      return "We couldn't save your session locally. Free up some storage and try again.";
    default:
      return e.message ?? `OAuth failed (${e.code}).`;
  }
}

function prettyError(e: unknown): string {
  if (!isCloudError(e)) {
    return e instanceof Error ? e.message : 'Something went wrong.';
  }
  switch (e.code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'email_taken':
      return 'An account with that email already exists.';
    case 'weak_password':
      return 'That password is too weak. Try at least 10 characters.';
    case 'rate_limited':
      return 'Too many attempts — wait a minute and try again.';
    case 'network':
      return 'No connection — check your internet and try again.';
    default:
      return e.message ?? `Sign-in failed (${e.code}).`;
  }
}
