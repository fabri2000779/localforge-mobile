/**
 * Schedules section for the mobile server-detail screen.
 *
 * Cron actions are stored + fired ON THE HOST (desktop while open, agent 24/7).
 * The phone just CRUDs the defs over the relay: `server.schedules_list`,
 * `server.upsert_schedule`, `server.delete_schedule`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Clock, Trash2, RefreshCw, Loader2, Plus } from 'lucide-react';
import {
  relayRequest, cloudBackupTargetsList,
  type Schedule, type ScheduleAction, type BackupTargetView,
} from '../lib/cloud';

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every day at 4:00 AM', cron: '0 4 * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Weekly · Sunday 3:00 AM', cron: '0 3 * * 0' },
];

function describeAction(a: ScheduleAction): string {
  if (a.kind === 'restart') return 'Restart';
  if (a.kind === 'command') return `Command: ${a.command}`;
  if (a.kind === 'backup') return 'Backup to S3';
  return `Broadcast: ${a.message}`;
}

export function ServerSchedulesSection({
  serverId,
  nodeId,
  online,
}: {
  serverId: string;
  nodeId: string | null;
  online: boolean;
}) {
  const [items, setItems] = useState<Schedule[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Inline delete confirmation (window.confirm is broken in Tauri mobile WebViews).
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // create form
  const [adding, setAdding] = useState(false);
  const [cron, setCron] = useState(CRON_PRESETS[0]!.cron);
  const [kind, setKind] = useState<ScheduleAction['kind']>('restart');
  const [text, setText] = useState('');
  // Backup targets for the "backup" action picker (cloud call, decrypted with
  // the org DEK — works regardless of host online state). null = loading.
  const [targets, setTargets] = useState<BackupTargetView[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [keepLast, setKeepLast] = useState('7'); // retention floor (blank = no limit)
  const [maxAgeDays, setMaxAgeDays] = useState(''); // age limit in days (blank = none)

  const args = useCallback(
    (extra: Record<string, unknown> = {}) => (nodeId ? { nodeId, ...extra } : extra),
    [nodeId],
  );

  const refresh = useCallback(async () => {
    if (!online) return;
    setBusy('list');
    setErr(null);
    try {
      const msg = await relayRequest({
        cmd: 'server.schedules_list',
        target: serverId,
        args: args(),
        snapshotKind: 'schedules_snapshot',
      });
      setItems((msg.schedules as Schedule[] | undefined) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [serverId, args, online]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load backup targets once so the "backup" action can offer a picker.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await cloudBackupTargetsList();
        if (!alive) return;
        setTargets(list);
        if (list.length > 0) setTargetId((cur) => cur || list[0]!.id);
      } catch {
        if (alive) setTargets([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const upsert = async (schedule: Schedule, busyKey: string) => {
    setBusy(busyKey);
    setErr(null);
    try {
      await relayRequest({ cmd: 'server.upsert_schedule', target: serverId, args: args({ schedule }) });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const add = async () => {
    let action: ScheduleAction;
    if (kind === 'command') {
      if (!text.trim()) return;
      action = { kind: 'command', command: text.trim() };
    } else if (kind === 'broadcast') {
      if (!text.trim()) return;
      action = { kind: 'broadcast', message: text.trim() };
    } else if (kind === 'backup') {
      if (!targetId) return;
      const kl = parseInt(keepLast, 10);
      const ma = parseInt(maxAgeDays, 10);
      action = {
        kind: 'backup',
        targetId,
        keepLast: Number.isFinite(kl) && kl > 0 ? kl : undefined,
        maxAgeDays: Number.isFinite(ma) && ma > 0 ? ma : undefined,
      };
    } else {
      action = { kind: 'restart' };
    }
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      serverId,
      cron,
      action,
      enabled: true,
    };
    await upsert(schedule, 'create');
    setAdding(false);
    setText('');
    setKind('restart');
  };

  const toggle = (s: Schedule) => upsert({ ...s, enabled: !s.enabled }, `toggle:${s.id}`);

  const remove = async (id: string) => {
    setBusy(`delete:${id}`);
    setErr(null);
    setPendingDelete(null);
    try {
      await relayRequest({ cmd: 'server.delete_schedule', target: serverId, args: args({ schedule_id: id }) });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <div className="console-header">
        <Clock size={14} />
        <span>Schedules</span>
        <button
          type="button"
          className="icon-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => void refresh()}
          disabled={!online || !!busy}
          aria-label="Refresh schedules"
        >
          <RefreshCw size={14} className={busy === 'list' ? 'spin' : ''} />
        </button>
      </div>

      {!online ? (
        <p className="detail-hint">Bring this server’s host online to manage schedules.</p>
      ) : (
        <>
          {err && <p className="ops-error">{err}</p>}
          {items === null ? (
            <p className="ops-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="ops-muted">No schedules yet.</p>
          ) : (
            <ul className="ops-list">
              {items.map((s) => (
                <li key={s.id} className="ops-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="ops-row-main">
                      <span className="ops-row-title">{describeAction(s.action)}</span>
                      <span className="ops-row-sub">
                        <code>{s.cron}</code>
                        {s.lastRun ? ` · last ${new Date(s.lastRun).toLocaleString()}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`ops-toggle${s.enabled ? ' ops-toggle--on' : ''}`}
                      onClick={() => toggle(s)}
                      disabled={!!busy}
                    >
                      {busy === `toggle:${s.id}` ? '…' : s.enabled ? 'On' : 'Off'}
                    </button>
                    <button type="button" className="icon-btn ops-danger" onClick={() => setPendingDelete(s.id)} disabled={!!busy} aria-label="Delete">
                      {busy === `delete:${s.id}` ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                  {pendingDelete === s.id && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>Delete this schedule?</span>
                      <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none', background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
                        onClick={() => remove(s.id)} disabled={!!busy}>Delete</button>
                      <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none' }}
                        onClick={() => setPendingDelete(null)}>Cancel</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <div style={{ marginTop: 10 }}>
              <select className="ops-field" value={cron} onChange={(e) => setCron(e.target.value)}>
                {CRON_PRESETS.map((p) => (
                  <option key={p.cron} value={p.cron}>{p.label}</option>
                ))}
              </select>
              <select className="ops-field" value={kind} onChange={(e) => setKind(e.target.value as ScheduleAction['kind'])}>
                <option value="restart">Restart</option>
                <option value="broadcast">Broadcast a message</option>
                <option value="command">Run a console command</option>
                <option value="backup">Back up to S3</option>
              </select>
              {(kind === 'command' || kind === 'broadcast') && (
                <input
                  className="ops-field"
                  placeholder={kind === 'broadcast' ? 'Message to announce' : 'Console command'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              )}
              {kind === 'backup' && (
                targets === null ? (
                  <p className="ops-muted">Loading backup targets…</p>
                ) : targets.length === 0 ? (
                  <p className="ops-error">No S3 backup target yet. Add one under the server’s Backups, then schedule it.</p>
                ) : (
                  <>
                    <select className="ops-field" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                      {targets.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <input
                      className="ops-field" type="number" inputMode="numeric" min="0"
                      placeholder="Keep last (e.g. 7)"
                      value={keepLast} onChange={(e) => setKeepLast(e.target.value)}
                    />
                    <input
                      className="ops-field" type="number" inputMode="numeric" min="0"
                      placeholder="Delete older than (days, optional)"
                      value={maxAgeDays} onChange={(e) => setMaxAgeDays(e.target.value)}
                    />
                  </>
                )
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="ops-btn" style={{ marginTop: 0 }} onClick={add} disabled={busy === 'create'}>
                  {busy === 'create' ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} Add
                </button>
                <button type="button" className="ops-btn" style={{ marginTop: 0 }} onClick={() => { setAdding(false); setText(''); }} disabled={busy === 'create'}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="ops-btn" onClick={() => setAdding(true)} disabled={!!busy}>
              <Plus size={15} /> Add schedule
            </button>
          )}
        </>
      )}
    </section>
  );
}
