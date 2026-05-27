/**
 * Account tab — profile, plan, live cloud reachability, sign out.
 * Replaces the old "home" screen; navigation now lives in the tab bar.
 */
import { useEffect, useState } from 'react';
import {
  Cloud,
  CloudOff,
  LogOut,
  RefreshCw,
  Check,
  Users,
  KeyRound,
  Lock,
  Loader2,
  Link2,
} from 'lucide-react';
import {
  cloudLogout,
  cloudOrgsAcceptInvite,
  cloudSyncKeySetup,
  cloudSyncKeyStatus,
  cloudSyncKeyUnlock,
  isCloudError,
  type Me,
  type OrgSummary,
  type SyncKeyStatus,
} from '../lib/cloud';

export function AccountScreen({
  me,
  desktopOnline,
  onlineNodeIds,
  orgs,
  activeOrgId,
  onSwitchOrg,
  onJoinedOrg,
  onSignedOut,
}: {
  me: Me;
  desktopOnline: boolean;
  onlineNodeIds: Set<string>;
  orgs: OrgSummary[];
  activeOrgId: string | null;
  onSwitchOrg: (orgId: string | null) => void;
  onJoinedOrg: (orgId: string) => void;
  onSignedOut: () => void;
}) {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await cloudLogout();
    } finally {
      onSignedOut();
    }
  }

  const plan = me.subscription.plan;
  const planLabel = plan[0]!.toUpperCase() + plan.slice(1);
  const displayName = me.displayName?.trim() || me.email.split('@')[0];
  const initials = displayName.slice(0, 2).toUpperCase();
  const reachable = (desktopOnline ? 1 : 0) + onlineNodeIds.size;
  const live = reachable > 0;
  // The sync passphrase matters for paid users (their own data) and for any
  // sub-user (so the owner can grant them access) — but not a free user with
  // only their own (empty) org.
  const needsSync = plan !== 'free' || orgs.some((o) => !o.isOwner);

  return (
    <div className="tab-screen">
      <div className="tab-screen-head">
        <h1>Account</h1>
      </div>

      <section className="card" style={{ textAlign: 'center', padding: '22px 16px' }}>
        <div className="account-avatar">{initials}</div>
        <div className="account-name">{displayName}</div>
        <div className="home-email">{me.email}</div>
        <div style={{ marginTop: 10 }}>
          <span className={`plan-badge plan-${plan}`}>{planLabel} plan</span>
        </div>
        {me.subscription.currentPeriodEnd && (
          <div className="home-sub" style={{ marginTop: 8 }}>
            {me.subscription.cancelAtPeriodEnd ? 'Cancels' : 'Renews'} on{' '}
            <strong>
              {new Date(me.subscription.currentPeriodEnd).toLocaleDateString()}
            </strong>
          </div>
        )}
      </section>

      {orgs.length > 1 && (
        <section className="card">
          <div className="lf-sectlabel">Workspace</div>
          {orgs.map((o) => {
            const effective = activeOrgId ?? orgs.find((x) => x.isOwner)?.id ?? null;
            const active = o.id === effective;
            return (
              <button
                key={o.id}
                type="button"
                className="member-row"
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => onSwitchOrg(o.isOwner ? null : o.id)}
              >
                <div className={`lf-tile ${active ? '' : 'muted'}`}><Users size={16} /></div>
                <div className="member-meta">
                  <div className="member-name">
                    {o.name}
                    {o.isOwner && <span className="member-self">yours</span>}
                  </div>
                  <div className="member-email">{o.role}</div>
                </div>
                {active && <Check size={16} style={{ color: 'var(--accent, #22d3a8)' }} aria-label="Active" />}
              </button>
            );
          })}
        </section>
      )}

      <section className="card">
        <div className="card-row" style={{ alignItems: 'center' }}>
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={`lf-tile ${live ? '' : 'muted'}`}>
              {live ? <Cloud size={18} /> : <CloudOff size={18} />}
            </div>
            <div>
              <div className="nav-card-title" style={{ fontSize: 14 }}>Relay</div>
              <div className="nav-card-sub">
                {plan === 'free'
                  ? 'Upgrade to control servers remotely'
                  : live
                    ? `${reachable} machine${reachable === 1 ? '' : 's'} reachable`
                    : 'No machines online right now'}
              </div>
            </div>
          </div>
          <span className={`status-badge ${live ? 'status-badge--ok' : 'status-badge--muted'}`}>
            <span className="status-dot" aria-hidden />
            {live ? 'Live' : 'Offline'}
          </span>
        </div>
      </section>

      {needsSync && <SyncKeySection />}

      <JoinByLinkSection onJoinedOrg={onJoinedOrg} />

      <button
        type="button"
        className="ghost-btn danger-btn"
        onClick={logout}
        disabled={loggingOut}
      >
        {loggingOut ? <RefreshCw size={15} className="spin" /> : <LogOut size={15} />}
        {loggingOut ? 'Signing out…' : 'Sign out'}
      </button>

      <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>
        LocalForge mobile
      </div>
    </div>
  );
}

/**
 * Sync passphrase management. Shows the right action for the current state:
 *   not_set_up → create a passphrase (mobile-only members get their keypair
 *                published here, so the owner can grant them access).
 *   locked     → unlock with the passphrase.
 *   unlocked   → a compact "ready" badge.
 */
function SyncKeySection() {
  const [status, setStatus] = useState<SyncKeyStatus | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function refresh() {
    return cloudSyncKeyStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }
  useEffect(() => {
    void refresh();
  }, []);

  if (status === null || status === 'unlocked') {
    return (
      <section className="card">
        <div className="card-row" style={{ alignItems: 'center' }}>
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={`lf-tile ${status === 'unlocked' ? '' : 'muted'}`}>
              <KeyRound size={18} />
            </div>
            <div>
              <div className="nav-card-title" style={{ fontSize: 14 }}>Sync key</div>
              <div className="nav-card-sub">
                {status === 'unlocked' ? 'Unlocked on this device' : 'Checking…'}
              </div>
            </div>
          </div>
          {status === 'unlocked' && (
            <span className="status-badge status-badge--ok">
              <span className="status-dot" aria-hidden />
              Ready
            </span>
          )}
        </div>
      </section>
    );
  }

  const isSetup = status === 'not_set_up';

  async function submit() {
    if (!pass.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (isSetup) await cloudSyncKeySetup(pass);
      else await cloudSyncKeyUnlock(pass);
      setPass('');
      await refresh();
    } catch (e) {
      setErr(
        isCloudError(e)
          ? e.code === 'wrong_secret'
            ? 'Wrong passphrase — try again.'
            : (e.message ?? e.code)
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="lf-sectlabel">{isSetup ? 'Set up sync passphrase' : 'Unlock sync'}</div>
      <p className="home-sub" style={{ margin: '0 0 10px' }}>
        {isSetup
          ? 'Pick a passphrase to encrypt your data and unlock team access. It never leaves your device — keep it safe, it can’t be reset.'
          : 'Enter your sync passphrase to unlock encrypted configs on this device.'}
      </p>
      <input
        className="invite-input"
        type="password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        placeholder={isSetup ? 'Choose a passphrase' : 'Sync passphrase'}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      {err && <div className="cfg-err" style={{ marginTop: 8 }}>{err}</div>}
      <button
        type="button"
        className="auth-submit"
        style={{ width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        disabled={busy || !pass.trim()}
        onClick={() => void submit()}
      >
        {busy ? <Loader2 size={15} className="spin" /> : isSetup ? <KeyRound size={15} /> : <Lock size={15} />}
        {busy ? 'Working…' : isSetup ? 'Set up sync' : 'Unlock'}
      </button>
    </section>
  );
}

/** Accept an invitation by pasting its link — a fallback for when the deep
 *  link doesn't fire (and a way for anyone, owner included, to join). */
function JoinByLinkSection({ onJoinedOrg }: { onJoinedOrg: (orgId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function join() {
    const parsed = parseInviteLink(link);
    if (!parsed) {
      setErr('Paste the full invite link.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const orgId = await cloudOrgsAcceptInvite(parsed.token, parsed.secret);
      setLink('');
      setOpen(false);
      onJoinedOrg(orgId);
    } catch (e) {
      setErr(
        isCloudError(e)
          ? e.code === 'wrong_account'
            ? 'This invite is for a different email.'
            : e.code === 'expired'
              ? 'This invitation has expired.'
              : e.code === 'already_accepted'
                ? "You're already a member."
                : (e.message ?? e.code)
          : "Couldn't accept the invitation.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ghost-btn"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        onClick={() => setOpen(true)}
      >
        <Link2 size={15} /> Join with an invite link
      </button>
    );
  }

  return (
    <section className="card">
      <div className="lf-sectlabel">Join with invite link</div>
      <input
        className="invite-input"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="Paste the invite link"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {err && <div className="cfg-err" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="auth-submit"
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          disabled={busy || !link.trim()}
          onClick={() => void join()}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Join
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

/** Pull the token (+ optional `#k=` / `&k=` handoff secret) out of an invite
 *  link. Falls back to treating a bare string as the token. */
function parseInviteLink(raw: string): { token: string; secret: string | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    const token = u.searchParams.get('token');
    if (!token) return null;
    let secret = u.searchParams.get('k');
    if (!secret && u.hash) {
      for (const pair of u.hash.replace(/^#/, '').split('&')) {
        const [k, v] = pair.split('=');
        if (k === 'k' && v) secret = decodeURIComponent(v);
      }
    }
    return { token, secret };
  } catch {
    // Not a URL — treat the whole string as a bare token.
    return { token: trimmed, secret: null };
  }
}
