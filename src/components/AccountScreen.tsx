/**
 * Account tab — profile, plan, live cloud reachability, sign out.
 * Replaces the old "home" screen; navigation now lives in the tab bar.
 */
import { useEffect, useState } from 'react';
import {
  Archive,
  Cloud,
  CloudOff,
  LogOut,
  RefreshCw,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Users,
  KeyRound,
  Lock,
  Loader2,
  Link2,
  ExternalLink,
} from 'lucide-react';
import {
  cloudLogout,
  cloudPushUnregister,
  cloudDeleteAccount,
  openManageSubscriptions,
  cloudOrgsAcceptInvite,
  cloudSyncKeySetup,
  cloudSyncKeyStatus,
  cloudSyncKeyUnlock,
  cloudBackupTargetsList,
  cloudBackupTargetAdd,
  cloudBackupTargetDelete,
  isCloudError,
  type Me,
  type OrgSummary,
  type SyncKeyStatus,
  type BackupTargetView,
  type BackupTargetInput,
} from '../lib/cloud';
import { detectPlatform } from '../lib/platform';

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function logout() {
    setLoggingOut(true);
    try {
      // Revoke this device's push token first — it needs the still-valid
      // session, and a signed-out device must stop receiving crash pushes.
      await cloudPushUnregister().catch(() => {
        /* best-effort — never block sign-out */
      });
      await cloudLogout();
    } finally {
      onSignedOut();
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteErr(null);
    try {
      await cloudDeleteAccount();
      // Account + all cloud data are gone and the local session is wiped —
      // drop back to the sign-in screen.
      onSignedOut();
    } catch (e) {
      setDeleteErr(
        isCloudError(e)
          ? e.code === 'subscription_active'
            ? 'Cancel your subscription before deleting your account.'
            : (e.message ?? e.code)
          : 'Could not delete the account. Check your connection and try again.',
      );
      setDeleting(false);
    }
  }

  const plan = me.subscription.plan;
  const planLabel = plan[0]!.toUpperCase() + plan.slice(1);
  // Apple/Google forbid apps from cancelling a user's store subscription, so on
  // account deletion we must warn them it keeps billing and hand them off to the
  // store's manage-subscriptions page (required by App Store Guideline 5.1.1(v)).
  const platform = detectPlatform();
  const storeName = platform === 'android' ? 'Google Play' : 'the App Store';
  const showSubWarning = plan !== 'free' && (platform === 'ios' || platform === 'android');
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

      {/* Backup storage — only meaningful for paid users who can sync targets */}
      {plan !== 'free' && <BackupStorageSection />}

      <button
        type="button"
        className="ghost-btn danger-btn"
        onClick={logout}
        disabled={loggingOut}
      >
        {loggingOut ? <RefreshCw size={15} className="spin" /> : <LogOut size={15} />}
        {loggingOut ? 'Signing out…' : 'Sign out'}
      </button>

      {!confirmingDelete ? (
        <button
          type="button"
          className="ghost-btn danger-btn"
          onClick={() => setConfirmingDelete(true)}
          disabled={loggingOut}
        >
          <Trash2 size={15} /> Delete account
        </button>
      ) : (
        <section className="card" style={{ borderColor: 'rgba(239,68,68,0.4)' }}>
          <div className="lf-sectlabel" style={{ color: '#fca5a5' }}>Delete account</div>
          <p className="home-sub" style={{ margin: '0 0 10px' }}>
            This permanently deletes your LocalForge account and all cloud data —
            synced servers, machines, team members, backup settings and
            encryption keys. It can’t be undone. The servers on your own
            machines are not affected.
          </p>
          {showSubWarning && (
            <div
              style={{
                marginBottom: 10,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(251,191,36,0.10)',
                border: '1px solid rgba(251,191,36,0.30)',
                fontSize: 12.5,
                lineHeight: 1.5,
                color: 'var(--text-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <span>
                Deleting your account does{' '}
                <strong style={{ color: 'var(--text-strong)' }}>not</strong> cancel
                your subscription. If you subscribed through {storeName}, you'll
                keep being billed until you cancel it there yourself.
              </span>
              <button
                type="button"
                className="ops-btn"
                style={{ marginTop: 0 }}
                onClick={() => void openManageSubscriptions()}
              >
                <ExternalLink size={14} /> Manage subscription
              </button>
            </div>
          )}
          {deleteErr && <div className="cfg-err" style={{ marginBottom: 8 }}>{deleteErr}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="ops-btn"
              style={{ marginTop: 0, flex: 1, background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
              onClick={() => void deleteAccount()}
              disabled={deleting}
            >
              {deleting ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
              {deleting ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              type="button"
              className="ops-btn"
              style={{ marginTop: 0 }}
              onClick={() => { setConfirmingDelete(false); setDeleteErr(null); }}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

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

// ── Backup Storage section ───────────────────────────────────────────────────

const EMPTY_CREDS: BackupTargetInput = {
  endpoint: '', region: 'us-east-1', bucket: '', accessKey: '', secretKey: '', pathStyle: false,
};

/**
 * Org-level backup storage management in the Account tab. Admin users can add /
 * remove named S3-compatible targets. The credentials are DEK-encrypted before
 * they leave the device — the cloud only stores ciphertext.
 */
function BackupStorageSection() {
  const [targets, setTargets] = useState<BackupTargetView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creds, setCreds] = useState<BackupTargetInput>(EMPTY_CREDS);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Distinguishes "load failed" (locked key / offline) from a genuinely empty
  // list, so we don't show "No storage configured" when targets exist but
  // couldn't be fetched.
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Inline delete confirm (window.confirm is broken in Tauri mobile WebViews).
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = () => {
    setLoadErr(null);
    cloudBackupTargetsList()
      .then((list) => { setTargets(list); })
      .catch((e) => {
        setLoadErr(isCloudError(e) && e.code === 'locked'
          ? 'Unlock your sync key to view backup storage.'
          : 'Couldn’t load backup storage — check your connection.');
        setTargets([]);
      });
  };

  useEffect(() => { load(); }, []);

  const addTarget = async () => {
    if (!newName.trim() || !creds.bucket.trim() || !creds.accessKey.trim() || !creds.secretKey.trim()) return;
    setBusy('add'); setErr(null);
    try {
      const id = crypto.randomUUID();
      const t = await cloudBackupTargetAdd(id, newName.trim(), creds);
      setTargets((prev) => [...(prev ?? []), t]);
      setAdding(false);
      setNewName('');
      setCreds(EMPTY_CREDS);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const removeTarget = async (id: string) => {
    setBusy(`del:${id}`);
    setPendingDelete(null);
    try {
      await cloudBackupTargetDelete(id);
      setTargets((prev) => (prev ?? []).filter((t) => t.id !== id));
      if (expanded === id) setExpanded(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (targets === null) return null; // still loading — don't flash a section

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="lf-tile"><Archive size={15} /></div>
          <div>
            <div className="nav-card-title" style={{ fontSize: 14 }}>Backup Storage</div>
            <div className="nav-card-sub">
              {targets.length === 0 ? 'No storage configured' : `${targets.length} target${targets.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        {!adding && (
          <button
            type="button"
            className="ghost-btn"
            style={{ padding: '5px 10px', fontSize: 12, gap: 5 }}
            onClick={() => setAdding(true)}
          >
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      {err && <p className="ops-error">{err}</p>}

      {/* Load error (locked key / offline) — distinct from genuinely empty */}
      {loadErr && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-muted)' }}>{loadErr}</span>
          <button type="button" className="ghost-btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={load}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Target list */}
      {targets.map((t) => (
        <div key={t.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 8 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
            onClick={() => setExpanded(expanded === t.id ? null : t.id)}
          >
            <div className="ops-row-main">
              <span className="ops-row-title">{t.name}</span>
              <span className="ops-row-sub">{t.bucket}{t.endpoint ? ` · ${t.endpoint}` : ''}</span>
            </div>
            <button
              type="button"
              className="icon-btn ops-danger"
              disabled={!!busy}
              onClick={(e) => { e.stopPropagation(); setPendingDelete(t.id); }}
              aria-label="Remove"
            >
              {busy === `del:${t.id}` ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
            </button>
            {expanded === t.id ? <ChevronUp size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          </div>
          {pendingDelete === t.id && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>
                Remove "{t.name}"? Existing backups in the bucket are NOT deleted.
              </span>
              <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none', background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
                onClick={() => removeTarget(t.id)} disabled={!!busy}>Remove</button>
              <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none' }}
                onClick={() => setPendingDelete(null)}>Cancel</button>
            </div>
          )}
          {expanded === t.id && (
            <div style={{ marginTop: 8, paddingLeft: 4, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <div>Bucket: <span style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{t.bucket}</span></div>
              <div>Endpoint: <span style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{t.endpoint || 'AWS S3 default'}</span></div>
              <div>Region: <span style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{t.region}</span></div>
              <div>Access key: <span style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>{t.accessKey}</span></div>
              <div>Secret key: <span style={{ color: 'var(--text-dim)' }}>•••••••• (encrypted)</span></div>
            </div>
          )}
        </div>
      ))}

      {/* Add form */}
      {adding && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="lf-sectlabel" style={{ marginBottom: 4 }}>New backup storage</p>
          {[
            { placeholder: 'Name (e.g. R2 Production)', value: newName, onChange: (v: string) => setNewName(v) },
          ].map((f, i) => (
            <input key={i} className="ops-field" placeholder={f.placeholder} value={f.value} onChange={(e) => f.onChange(e.target.value)} />
          ))}
          <input className="ops-field" placeholder="Bucket" value={creds.bucket} onChange={(e) => setCreds({ ...creds, bucket: e.target.value })} />
          <input className="ops-field" placeholder="Endpoint URL (empty = AWS S3)" value={creds.endpoint} onChange={(e) => setCreds({ ...creds, endpoint: e.target.value })} />
          <input className="ops-field" placeholder="Region (e.g. auto, us-east-1)" value={creds.region} onChange={(e) => setCreds({ ...creds, region: e.target.value })} />
          <input className="ops-field" placeholder="Access key ID" value={creds.accessKey} onChange={(e) => setCreds({ ...creds, accessKey: e.target.value })} autoCapitalize="off" />
          <input className="ops-field" placeholder="Secret access key" value={creds.secretKey} onChange={(e) => setCreds({ ...creds, secretKey: e.target.value })} autoCapitalize="off" type="password" />
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={creds.pathStyle} onChange={(e) => setCreds({ ...creds, pathStyle: e.target.checked })} />
            Path-style (MinIO / self-hosted)
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="ops-btn"
              style={{ marginTop: 0 }}
              disabled={busy === 'add' || !newName.trim() || !creds.bucket.trim() || !creds.accessKey.trim() || !creds.secretKey.trim()}
              onClick={addTarget}
            >
              {busy === 'add' ? <Loader2 size={14} className="spin" /> : <Archive size={14} />}
              Save storage
            </button>
            <button type="button" className="ops-btn" style={{ marginTop: 0 }} onClick={() => { setAdding(false); setCreds(EMPTY_CREDS); setNewName(''); }} disabled={busy === 'add'}>
              Cancel
            </button>
          </div>
        </div>
      )}
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
