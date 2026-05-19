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
      <span className={`oauth-icon oauth-icon--${provider}`} aria-hidden />
      <span>{pending ? '…' : label}</span>
    </button>
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
