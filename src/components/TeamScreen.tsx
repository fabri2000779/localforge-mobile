/**
 * Team tab — member list + invite-by-email (Team plan). Data from
 * `cloud_org_me`; invites via `cloud_org_invite`. Admin+ sees the invite
 * form (the cloud enforces the role gate too). Non-Team plans get an
 * upsell.
 */
import { useEffect, useState } from 'react';
import { Users, Send, RefreshCw, Loader2 } from 'lucide-react';
import {
  cloudOrgInvite,
  cloudOrgMe,
  isCloudError,
  type Me,
  type Member,
  type OrgInfo,
} from '../lib/cloud';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; org: OrgInfo };

const ROLES = ['viewer', 'operator', 'admin'] as const;

export function TeamScreen({ me }: { me: Me }) {
  const isTeam = me.subscription.plan === 'team';
  const [state, setState] = useState<State>({ kind: 'loading' });

  async function load() {
    try {
      const org = await cloudOrgMe();
      setState({ kind: 'ready', org });
    } catch (e) {
      setState({
        kind: 'error',
        message: isCloudError(e) ? (e.message ?? `Couldn't load your team (${e.code}).`) : 'Something went wrong.',
      });
    }
  }

  useEffect(() => {
    if (isTeam) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeam]);

  if (!isTeam) {
    return (
      <div className="tab-screen">
        <div className="tab-screen-head"><h1>Team</h1></div>
        <section className="card" style={{ textAlign: 'center', padding: '26px 18px' }}>
          <div className="empty-mark empty-mark--lock" style={{ margin: '0 auto 12px' }}><Users size={24} /></div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>Bring your team</h2>
          <p className="home-sub" style={{ marginTop: 6 }}>
            On the Team plan you can invite members and give them roles
            (viewer, operator, admin) to operate your servers with you.
          </p>
        </section>
      </div>
    );
  }

  const org = state.kind === 'ready' ? state.org : null;
  const canInvite = !!org && (org.isOwner || org.role === 'admin');
  const members = org ? [...org.members].sort((a, b) => roleRank(b.role) - roleRank(a.role)) : [];

  return (
    <div className="tab-screen">
      <div className="tab-screen-head">
        <h1>Team</h1>
        <span className="plan-badge plan-team">
          {org ? `${org.members.length}/10` : 'Team'}
        </span>
      </div>

      {state.kind === 'loading' && (
        <div className="list-state"><Loader2 size={18} className="spin" /></div>
      )}

      {state.kind === 'error' && (
        <section className="card" style={{ textAlign: 'center', padding: '22px 18px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>Couldn't load your team</h2>
          <p className="home-sub" style={{ marginTop: 6 }}>{state.message}</p>
          <button type="button" className="ghost-btn" style={{ marginTop: 12 }} onClick={() => { setState({ kind: 'loading' }); void load(); }}>
            <RefreshCw size={15} /> Try again
          </button>
        </section>
      )}

      {org && (
        <>
          <section className="card" style={{ padding: '4px 14px' }}>
            {members.map((m) => (
              <MemberRow key={m.id} member={m} isSelf={m.id === me.id} />
            ))}
          </section>

          {canInvite && <InviteForm orgId={org.id} onInvited={load} />}
        </>
      )}
    </div>
  );
}

function MemberRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const name = member.display_name?.trim() || member.email.split('@')[0];
  const initials = (member.display_name?.trim() || member.email).slice(0, 2).toUpperCase();
  return (
    <div className="member-row">
      <span className="account-avatar" style={{ width: 36, height: 36, fontSize: 13, margin: 0 }}>{initials}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nav-card-title" style={{ fontSize: 14 }}>{name}{isSelf ? ' (you)' : ''}</div>
        <div className="nav-card-sub">{member.email}</div>
      </div>
      <span className={`role-pill role-pill--${roleClass(member.role)}`}>{capitalize(member.role)}</span>
    </div>
  );
}

function InviteForm({ orgId, onInvited }: { orgId: string; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('operator');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email.trim());

  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await cloudOrgInvite(orgId, email.trim(), role);
      setNotice({ kind: 'ok', text: `Invitation sent to ${email.trim()}.` });
      setEmail('');
      onInvited();
    } catch (e) {
      setNotice({
        kind: 'err',
        text: isCloudError(e)
          ? e.code === 'already_member'
            ? 'That person is already on your team.'
            : (e.message ?? `Couldn't send the invite (${e.code}).`)
          : "Couldn't send the invite.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="lf-sectlabel">Invite a member</div>
      <section className="card">
        <input
          type="email"
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@email.com"
          className="invite-input"
          aria-label="Invitee email"
        />
        <div className="seg-roles" style={{ margin: '11px 0 12px' }}>
          {ROLES.map((r) => (
            <button key={r} type="button" className={role === r ? 'on' : ''} onClick={() => setRole(r)}>
              {capitalize(r)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="auth-submit"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          disabled={!valid || busy}
          onClick={send}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          Send invite
        </button>
        {notice && (
          <p
            className="list-state-hint"
            style={{ marginTop: 10, color: notice.kind === 'err' ? 'var(--danger)' : 'var(--text-muted)' }}
          >
            {notice.text}
          </p>
        )}
      </section>
    </>
  );
}

function roleClass(role: string): string {
  return role === 'owner' || role === 'admin' || role === 'operator' ? role : 'viewer';
}
function roleRank(role: string): number {
  return role === 'owner' ? 3 : role === 'admin' ? 2 : role === 'operator' ? 1 : 0;
}
function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
