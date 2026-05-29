/**
 * Backups section for the mobile server-detail screen.
 *
 * Everything runs ON THE HOST over the relay — the phone never holds the S3
 * credentials. We send `server.backups_list` / `server.backup_now` /
 * `server.restore_backup` / `server.delete_backup` and the host (desktop with
 * its keychain creds, or an agent with its provisioned target) executes.
 */
import { useCallback, useEffect, useState } from 'react';
import { Archive, RotateCcw, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { relayRequest, type BackupEntry } from '../lib/cloud';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function backupName(key: string): string {
  const seg = key.split('/').pop() ?? key;
  return seg.replace(/\.tar\.gz$/, '');
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
  const [items, setItems] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'list' | 'create' | `restore:${key}` | `delete:${key}`
  const [err, setErr] = useState<string | null>(null);

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
    }
  }, [serverId, args, online]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return (
    <section className="card">
      <div className="console-header">
        <Archive size={14} />
        <span>Backups</span>
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

      {!online ? (
        <p className="detail-hint">Bring this server’s host online to manage backups.</p>
      ) : (
        <>
          <button type="button" className="ops-btn" onClick={backupNow} disabled={!!busy}>
            {busy === 'create' ? <Loader2 size={15} className="spin" /> : <Archive size={15} />}
            {busy === 'create' ? 'Backing up…' : 'Back up now'}
          </button>
          {err && <p className="ops-error">{err}</p>}
          {items === null ? (
            <p className="ops-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="ops-muted">No backups yet.</p>
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
                    {busy === `restore:${b.key}` ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                  </button>
                  <button type="button" className="icon-btn ops-danger" onClick={() => remove(b.key)} disabled={!!busy} aria-label="Delete">
                    {busy === `delete:${b.key}` ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
