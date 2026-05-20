/**
 * Signed-in home. Shows account state and the entry into the server
 * list. v0.0.x has just one nav target (servers); future commits add
 * billing, audit log, settings.
 */
import { useState } from 'react';
import { ChevronRight, LogOut, ServerCog } from 'lucide-react';
import { cloudLogout, type Me } from '../lib/cloud';

interface Props {
  me: Me;
  onSignedOut: () => void;
  onOpenServers: () => void;
}

export function HomeScreen({ me, onSignedOut, onOpenServers }: Props) {
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

  return (
    <div className="home-screen">
      <header className="home-header">
        <div>
          <div className="home-eyebrow">Signed in</div>
          <div className="home-name">{displayName}</div>
          <div className="home-email">{me.email}</div>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={logout}
          disabled={loggingOut}
          aria-label="Sign out"
        >
          <LogOut size={16} />
        </button>
      </header>

      <section className="card">
        <div className="card-row">
          <div>
            <div className="home-eyebrow">Plan</div>
            <div className="home-plan">
              <span className={`plan-badge plan-${plan}`}>{planLabel}</span>
            </div>
            {me.subscription.currentPeriodEnd && (
              <div className="home-sub">
                {me.subscription.cancelAtPeriodEnd ? 'Cancels' : 'Renews'} on{' '}
                <strong>
                  {new Date(me.subscription.currentPeriodEnd).toLocaleDateString()}
                </strong>
              </div>
            )}
          </div>
        </div>
      </section>

      <button type="button" className="nav-card" onClick={onOpenServers}>
        <div className="nav-card-icon">
          <ServerCog size={20} />
        </div>
        <div className="nav-card-body">
          <div className="nav-card-title">Your servers</div>
          <div className="nav-card-sub">
            {plan === 'free'
              ? 'Sync unlocks with Hobby — preview the list anyway'
              : 'Live status, console and start/stop controls'}
          </div>
        </div>
        <ChevronRight size={18} className="nav-card-chev" />
      </button>
    </div>
  );
}
