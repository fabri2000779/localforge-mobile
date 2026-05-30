/**
 * Backups tab — backup OPERATIONS for a server.
 *
 * Storage management lives in Account → Backup Storage. Here the user
 * picks WHICH target to use and runs backup / restore / delete. All
 * destructive actions use inline confirmations because window.confirm
 * is not functional in Tauri mobile WebViews.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, RotateCcw, Trash2, RefreshCw, Loader2, Settings } from 'lucide-react';
import {
  cloudBackupTargetsList,
  relayRequest,
  isCloudError,
  type BackupEntry,
  type BackupTargetView,
} from '../lib/cloud';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function backupName(key: string): string {
  return (key.split('/').pop() ?? key).replace(/\.tar\.gz$/, '');
}

export function ServerBackupsSection({
  serverId,
  nodeId,
  online,
}: {
  serverId: string;
  nodeId: string | null;
  online: boolean;
}) {
  const [targets, setTargets] = useState<BackupTargetView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Inline confirm: holds the key of the pending destructive action.
  // `restore:${key}` or `delete:${key}`
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  // Distinguishes a failed targets fetch from a genuinely empty list.
  const [targetsErr, setTargetsErr] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const args = useCallback(
    (extra: Record<string, unknown> = {}) =>
      nodeId ? { nodeId, ...(selectedId ? { targetId: selectedId } : {}), ...extra } : extra,
    [nodeId, selectedId],
  );

  // Load the org's target list — no selectedId dep to avoid double-fetch.
  const loadTargets = useCallback(async () => {
    setTargetsErr(null);
    try {
      const list = await cloudBackupTargetsList();
      setTargets(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (e) {
      setTargetsErr(isCloudError(e) && e.code === 'locked'
        ? 'Unlock your sync key (Account) to see backup storage.'
        : 'Couldn’t load backup storage — check your connection.');
      setTargets([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!online || !selectedId) return;
    setBusy('list');
    setErr(null);
    try {
      const msg = await relayRequest({
        cmd: 'server.backups_list',
        target: serverId,
        args: args(),
        snapshotKind: 'backups_snapshot',
      });
      setItems((msg.backups as BackupEntry[] | undefined) ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      firstLoad.current = false;
    }
  }, [serverId, args, online, selectedId]);

  useEffect(() => { void loadTargets(); }, [loadTargets]);
  useEffect(() => { if (selectedId) void refresh(); }, [refresh, selectedId]);

  const backupNow = async () => {
    setBusy('create');
    setErr(null);
    try {
      await relayRequest({ cmd: 'server.backup_now', target: serverId, args: args(), timeoutMs: 180_000 });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const restore = async (key: string) => {
    setBusy(`restore:${key}`);
    setErr(null);
    setPendingConfirm(null);
    try {
      await relayRequest({ cmd: 'server.restore_backup', target: serverId, args: args({ key }), timeoutMs: 180_000 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (key: string) => {
    setBusy(`delete:${key}`);
    setErr(null);
    setPendingConfirm(null);
    try {
      await relayRequest({ cmd: 'server.delete_backup', target: serverId, args: args({ key }) });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (targets === null) {
    return (
      <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: 28 }}>
        <Loader2 size={16} className="spin" style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</span>
      </section>
    );
  }

  if (targets.length === 0) {
    // Load failed (locked key / offline) — show the reason + retry, NOT the
    // "go configure storage" empty state (which would be wrong if targets exist).
    if (targetsErr) {
      return (
        <section className="card" style={{ textAlign: 'center', padding: '24px 20px', gap: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Archive size={30} style={{ color: 'var(--text-dim, #475569)' }} />
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{targetsErr}</p>
          <button type="button" className="ops-btn" style={{ marginTop: 0, width: 'auto' }} onClick={() => void loadTargets()}>
            <RefreshCw size={14} /> Retry
          </button>
        </section>
      );
    }
    return (
      <section className="card" style={{ textAlign: 'center', padding: '28px 20px', gap: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Archive size={32} style={{ color: 'var(--text-dim, #475569)' }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>No backup storage configured</p>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            Add an S3-compatible bucket in{' '}
            <strong style={{ color: 'var(--text-main)' }}>Account → Backup Storage</strong>
            {' '}to start backing up this server.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          <Settings size={13} /> Tap Account in the bottom bar
        </div>
      </section>
    );
  }

  const selected = targets.find((t) => t.id === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <section className="card">
        <div className="console-header">
          <Archive size={14} />
          <span>Backup storage</span>
          <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }}
            onClick={() => void refresh()} disabled={!online || !!busy} aria-label="Refresh">
            <RefreshCw size={14} className={busy === 'list' ? 'spin' : ''} />
          </button>
        </div>

        {targets.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, marginBottom: 10 }}>
            {targets.map((t) => (
              <button key={t.id} type="button"
                className={`detail-tab${selectedId === t.id ? ' detail-tab--active' : ''}`}
                style={{ flex: 'none' }} onClick={() => setSelectedId(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 10px' }}>
            {targets.length === 1 && <strong style={{ color: 'var(--text-main)' }}>{selected.name} · </strong>}
            {selected.bucket}{selected.endpoint ? ` · ${selected.endpoint}` : ''}
          </p>
        )}

        {!online ? (
          <p className="detail-hint">Bring this server's host online to manage backups.</p>
        ) : (
          <button type="button" className="ops-btn" onClick={backupNow} disabled={!!busy}>
            {busy === 'create' ? <Loader2 size={14} className="spin" /> : <Archive size={14} />}
            {busy === 'create' ? 'Backing up…' : 'Back up now'}
          </button>
        )}
        {err && <p className="ops-error">{err}</p>}
      </section>

      {selected && online && (
        <section className="card">
          <div className="console-header" style={{ marginBottom: 8 }}>
            <Archive size={14} />
            <span>Backups{targets.length > 1 ? ` in ${selected.name}` : ''}</span>
          </div>
          {items === null ? (
            <p className="ops-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="ops-muted">No backups yet. Tap "Back up now" to create one.</p>
          ) : (
            <ul className="ops-list">
              {items.map((b) => (
                <li key={b.key} className="ops-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="ops-row-main">
                      <span className="ops-row-title">{backupName(b.key)}</span>
                      <span className="ops-row-sub">
                        {fmtBytes(b.size)} · {new Date(b.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <button type="button" className="icon-btn" onClick={() => setPendingConfirm(`restore:${b.key}`)}
                      disabled={!!busy} aria-label="Restore">
                      {busy === `restore:${b.key}` ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
                    </button>
                    <button type="button" className="icon-btn ops-danger" onClick={() => setPendingConfirm(`delete:${b.key}`)}
                      disabled={!!busy} aria-label="Delete">
                      {busy === `delete:${b.key}` ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                  {/* Inline confirm — avoids window.confirm which is broken in Tauri mobile WebViews */}
                  {pendingConfirm === `restore:${b.key}` && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>
                        Restore? Server stops and current data is replaced.
                      </span>
                      <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none', background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
                        onClick={() => restore(b.key)} disabled={!!busy}>Restore</button>
                      <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none' }}
                        onClick={() => setPendingConfirm(null)}>Cancel</button>
                    </div>
                  )}
                  {pendingConfirm === `delete:${b.key}` && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>
                        Delete this backup permanently?
                      </span>
                      <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none', background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
                        onClick={() => remove(b.key)} disabled={!!busy}>Delete</button>
                      <button type="button" className="ops-btn" style={{ marginTop: 0, flex: 'none' }}
                        onClick={() => setPendingConfirm(null)}>Cancel</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
