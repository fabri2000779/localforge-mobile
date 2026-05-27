/**
 * Account tab — profile, plan, live cloud reachability, sign out.
 * Replaces the old "home" screen; navigation now lives in the tab bar.
 */
import { useState } from 'react';
import { Cloud, CloudOff, LogOut, RefreshCw, Check, Users } from 'lucide-react';
import { cloudLogout, type Me, type OrgSummary } from '../lib/cloud';

export function AccountScreen({
  me,
  desktopOnline,
  onlineNodeIds,
  orgs,
  activeOrgId,
  onSwitchOrg,
  onSignedOut,
}: {
  me: Me;
  desktopOnline: boolean;
  onlineNodeIds: Set<string>;
  orgs: OrgSummary[];
  activeOrgId: string | null;
  onSwitchOrg: (orgId: string | null) => void;
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
