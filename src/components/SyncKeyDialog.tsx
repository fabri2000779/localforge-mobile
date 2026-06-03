/**
 * Envelope-encryption setup / unlock, shown after sign-in when the sync key
 * isn't ready on this device. Mirrors the desktop `SyncKeyDialog`.
 *
 *   not_set_up → "Create your sync password" (passphrase + confirm)
 *   locked     → "Unlock your synced data"   (single input)
 *
 * OAuth users (Apple/Google/…) have no account password, so without this they
 * never establish the KEK — their X25519 keypair is never published and team
 * grants + config decryption silently break. Dismissable ("Skip for now"):
 * local/observation-only use stays possible, matching desktop.
 */
import { useState, type FormEvent } from 'react';
import { KeyRound, ShieldCheck, AlertOctagon } from 'lucide-react';
import {
  cloudSyncKeySetup,
  cloudSyncKeyUnlock,
  isCloudError,
  type SyncKeyStatus,
} from '../lib/cloud';

interface Props {
  /** Never 'unlocked' — the parent only mounts this when setup/unlock is due. */
  status: Exclude<SyncKeyStatus, 'unlocked'>;
  /** Re-check status after a successful setup/unlock (dialog unmounts when it
   *  flips to 'unlocked'). */
  onDone: () => void;
  /** Dismiss for this session. */
  onSkip: () => void;
}

export function SyncKeyDialog({ status, onDone, onSkip }: Props) {
  const isSetup = status === 'not_set_up';
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (isSetup) {
      if (passphrase.length < 12) {
        setErr('Use at least 12 characters — this passphrase encrypts every config you sync.');
        return;
      }
      if (passphrase !== confirm) {
        setErr("The passphrases don't match.");
        return;
      }
    } else if (!passphrase) {
      setErr('Enter your sync password.');
      return;
    }
    setSubmitting(true);
    try {
      if (isSetup) await cloudSyncKeySetup(passphrase);
      else await cloudSyncKeyUnlock(passphrase);
      onDone();
    } catch (e) {
      setErr(prettyErr(e, isSetup));
      setSubmitting(false);
    }
  }

  return (
    <div className="sync-overlay" role="dialog" aria-modal="true">
      <div className="auth-screen">
        <div className="auth-header">
          <div className="auth-mark auth-mark--key">
            <KeyRound size={22} />
          </div>
          <h1>{isSetup ? 'Create your sync password' : 'Unlock your synced data'}</h1>
          <p>
            {isSetup
              ? "This encrypts every server config we sync to the cloud — we can't read it. You'll need it to sign in on another device, so pick something memorable or save it to a password manager."
              : 'Enter the sync password you set up on your first device. We use it to decrypt your synced configs on this phone — the cloud never sees it.'}
          </p>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label className="auth-field">
            <span>
              <span className="auth-field-icon"><KeyRound size={14} /></span>
              Sync password
            </span>
            <input
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              required
              minLength={isSetup ? 12 : undefined}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={isSetup ? 'At least 12 characters' : 'Your sync password'}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          {isSetup && (
            <label className="auth-field">
              <span>Confirm</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat the passphrase"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
          )}

          {err && (
            <div className="auth-error">
              <AlertOctagon size={14} />
              <span>{err}</span>
            </div>
          )}

          {isSetup && (
            <div className="sync-note">
              <ShieldCheck size={14} />
              <span>
                This passphrase never leaves your device. If you forget it,
                cloud-synced configs can't be recovered — your servers themselves
                are unaffected.
              </span>
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? '…' : isSetup ? 'Create sync password' : 'Unlock'}
          </button>
        </form>

        <div className="auth-switch">
          <button type="button" className="auth-link inline" onClick={onSkip}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

function prettyErr(e: unknown, isSetup: boolean): string {
  if (isCloudError(e)) {
    switch (e.code) {
      case 'wrong_secret':
        return "That doesn't match the password from your first device. Try again.";
      case 'sync_key_not_set':
        return 'Set up the sync password on your desktop first, then unlock here.';
      case 'sync_key_already_set':
        return 'Sync is already set up on your account — enter your existing password to unlock.';
      case 'network':
        return 'No connection — check your internet and try again.';
    }
    if (e.message) return e.message;
  }
  return isSetup
    ? "Couldn't save the sync password. Check your connection and try again."
    : "Couldn't unlock on this device. Check your connection and try again.";
}
