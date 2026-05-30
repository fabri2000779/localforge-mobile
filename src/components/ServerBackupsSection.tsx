/**
 * Backups tab — backup OPERATIONS for a server.
 *
 * Storage management (which S3 bucket and credentials) lives in
 * Account → Backup Storage. Here the user just picks WHICH of the org's
 * configured targets to use and runs backup / restore / delete.
 *
 * If no storage is configured at all, an inline hint points to Account.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, RotateCcw, Trash2, RefreshCw, Loader2, Settings } from 'lucide-react';
import {
  cloudBackupTargetsList,
  relayRequest,
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
  const firstLoad = useRef(true);

  const args = useCallback(
    (extra: Record<string, unknown> = {}) =>
      nodeId ? { nodeId, ...(selectedId ? { targetId: selectedId } : {}), ...extra } : extra,
    [nodeId, selectedId],
  );

  // Load the org's target list from the cloud.
  const loadTargets = useCallback(async () => {
    try {
      const list = await cloudBackupTargetsList();
      setTargets(list);
      if (!selectedId && list.length > 0) setSelectedId(list[0]!.id);
    } catch {
      setTargets([]);
    }
  }, [selectedId]);

  // Load the backup list from the host via relay.
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
    if (!window.confirm('Restore this backup? The server stops and its current data is replaced.')) return;
    setBusy(`restore:${key}`);
    setErr(null);
    try {
      await relayRequest({ cmd: 'server.restore_backup', target: serverId, args: args({ key }), timeoutMs: 180_000 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (key: string) => {
    if (!window.confirm('Delete this backup permanently?')) return;
    setBusy(`delete:${key}`);
    setErr(null);
    try {
      await relayRequest({ cmd: 'server.delete_backup', target: serverId, args: args({ key }) });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  // Still loading
  if (targets === null) {
    return (
      <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: 28 }}>
        <Loader2 size={16} className="spin" style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</span>
      </section>
    );
  }

  // No storage configured — direct to Account tab
  if (targets.length === 0) {
    return (
      <section className="card" style={{ textAlign: 'center', padding: '28px 20px', gap: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Archive size={32} style={{ color: 'var(--text-dim, #475569)' }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
            No backup storage configured
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            Add an S3-compatible bucket in <strong style={{ color: 'var(--text-main)' }}>Account → Backup Storage</strong> to start backing up this server.
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
      {/* Storage selector + back up now */}
      <section className="card">
        <div className="console-header">
          <Archive size={14} />
          <span>Backup storage</span>
          <button
            type="button"
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => void refresh()}
            disabled={!online || !!busy}
            aria-label="Refresh backups"
          >
            <RefreshCw size={14} className={busy === 'list' ? 'spin' : ''} />
          </button>
        </div>

        {/* Target selector — only when multiple exist */}
        {targets.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, marginBottom: 10 }}>
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`detail-tab${selectedId === t.id ? ' detail-tab--active' : ''}`}
                style={{ flex: 'none' }}
                onClick={() => setSelectedId(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        {/* Selected target summary */}
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

      {/* Backup list */}
      {selected && online && (
        <section className="card">
          <div className="console-header" style={{ marginBottom: 8 }}>
            <Archive size={14} />
            <span>
              Backups{targets.length > 1 ? ` in ${selected.name}` : ''}
            </span>
          </div>
          {items === null ? (
            <p className="ops-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="ops-muted">No backups yet. Tap "Back up now" to create one.</p>
          ) : (
            <ul className="ops-list">
              {items.map((b) => (
                <li key={b.key} className="ops-row">
                  <div className="ops-row-main">
                    <span className="ops-row-title">{backupName(b.key)}</span>
                    <span className="ops-row-sub">
                      {fmtBytes(b.size)} · {new Date(b.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => restore(b.key)} disabled={!!busy} aria-label="Restore">
                    {busy === `restore:${b.key}` ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
                  </button>
                  <button type="button" className="icon-btn ops-danger" onClick={() => remove(b.key)} disabled={!!busy} aria-label="Delete">
                    {busy === `delete:${b.key}` ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
