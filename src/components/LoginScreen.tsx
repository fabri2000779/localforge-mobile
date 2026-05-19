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
import { useState, type FormEvent } from 'react';
import { Mail, Lock, AlertOctagon, ArrowLeft } from 'lucide-react';
import {
  cloudLogin,
  cloudSignup,
  cloudRequestPasswordReset,
  isCloudError,
  type Me,
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
            <OAuthButton provider="google" disabled />
            <OAuthButton provider="discord" disabled />
            <OAuthButton provider="github" disabled />
          </div>
          <p className="auth-coming-soon">
            OAuth sign-in is coming in the next mobile build.
          </p>
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
  disabled,
}: {
  provider: 'google' | 'discord' | 'github';
  disabled?: boolean;
}) {
  const label = provider[0]!.toUpperCase() + provider.slice(1);
  return (
    <button
      type="button"
      className="oauth-btn"
      disabled={disabled}
      title={disabled ? 'Coming soon' : `Sign in with ${label}`}
    >
      <span className={`oauth-icon oauth-icon--${provider}`} aria-hidden />
      <span>{label}</span>
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
