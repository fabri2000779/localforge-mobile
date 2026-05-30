/**
 * Top banner shown when a `localforge://invite` deep link arrives. Lets the
 * user accept a team invitation from the phone. If they're not signed in yet
 * it nudges them to sign in first (the banner persists; once signed in the
 * Accept button appears). On success it hands the joined org id back to App,
 * which refreshes the org list + switches to it (unlocking its DEK).
 */
import { useState, type CSSProperties } from 'react';
import { Mail, X, Check, Loader2 } from 'lucide-react';
import { cloudOrgsAcceptInvite, isCloudError } from '../lib/cloud';

export function AcceptInviteBanner({
  token,
  secret,
  signedIn,
  onAccepted,
  onDismiss,
}: {
  token: string;
  secret?: string | null;
  signedIn: boolean;
  onAccepted: (orgId: string) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const orgId = await cloudOrgsAcceptInvite(token, secret ?? null);
      onAccepted(orgId);
    } catch (e) {
      setErr(
        isCloudError(e)
          ? e.code === 'wrong_account'
            ? 'This invite is for a different email — sign in with that account.'
            : e.code === 'expired'
              ? 'This invitation has expired.'
              : e.code === 'already_accepted'
                ? "You're already a member."
                : (e.message ?? `Couldn't accept (${e.code}).`)
          : "Couldn't accept the invitation.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap} role="dialog" aria-live="polite">
      <span style={icon}>
        <Mail size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 14 }}>
          Team invitation
        </div>
        <div
          style={{
            color: err ? 'var(--danger)' : 'var(--text-muted)',
            fontSize: 12.5,
            marginTop: 2,
          }}
        >
          {err ??
            (signedIn
              ? 'Join this workspace to see and control its servers.'
              : 'Sign in first, then tap Accept.')}
        </div>
      </div>
      {signedIn && (
        <button type="button" onClick={accept} disabled={busy} style={acceptBtn}>
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Accept
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label="Dismiss" style={closeBtn}>
        <X size={16} />
      </button>
    </div>
  );
}

const wrap: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  paddingTop: 'max(12px, env(safe-area-inset-top))',
  background: 'var(--surface, #11161f)',
  borderBottom: '1px solid var(--border, #232c3a)',
  boxShadow: '0 6px 20px rgba(0,0,0,.35)',
};
const icon: CSSProperties = { color: 'var(--accent, #f97316)', display: 'flex' };
const acceptBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 10,
  border: 'none',
  // Forged-ember primary CTA — dark text on hot metal, matching the rest of
  // the app's primary buttons.
  background: 'linear-gradient(180deg, #fb923c, var(--accent, #f97316))',
  color: '#1c0f03',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
};
const closeBtn: CSSProperties = {
  display: 'flex',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted, #8aa0b8)',
  padding: 4,
};
