/**
 * Post-login holding screen. v0.0.x just confirms you're signed in
 * and shows plan/subscription state. The server list, live console
 * and command sender land in subsequent commits once the relay
 * client is wired.
 */
import { useState } from 'react';
import { LogOut, Sparkles } from 'lucide-react';
import { cloudLogout, type Me } from '../lib/cloud';

interface Props {
  me: Me;
  onSignedOut: () => void;
}

export function HomeScreen({ me, onSignedOut }: Props) {
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

      <section className="card card-coming-soon">
        <Sparkles size={18} color="#60a5fa" />
        <div>
          <h2>Server list arrives next</h2>
          <p>
            The mobile relay client is the next piece — once it lands you'll
            see every server running on your LocalForge desktop or VPS, and
            you'll be able to start, stop and tail logs from your phone.
          </p>
        </div>
      </section>
    </div>
  );
}
