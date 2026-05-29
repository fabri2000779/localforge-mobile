/**
 * Backups tab — multi-target S3 backup management for a server.
 *
 * The phone never holds S3 credentials. It:
 *   1. Pulls the org's named target list from the cloud (DEK-encrypted).
 *   2. Lets admin users add/remove targets right on the phone.
 *   3. Fires backup commands (backup now / list / restore / delete) over the
 *      relay — the host executes using the selected target.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Plus, RotateCcw, Trash2, RefreshCw, Loader2, ChevronDown } from 'lucide-react';
import {
  cloudBackupTargetsList,
  cloudBackupTargetAdd,
  cloudBackupTargetDelete,
  relayRequest,
  type BackupEntry,
  type BackupTargetView,
  type BackupTargetInput,
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

const EMPTY_CREDS: BackupTargetInput = {
  endpoint: '', region: 'us-east-1', bucket: '', accessKey: '',
  secretKey: '', pathStyle: false,
};

export function ServerBackupsSection({
  serverId, nodeId, online,
}: { serverId: string; nodeId: string | null; online: boolean }) {
  const [targets, setTargets] = useState<BackupTargetView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // config panel
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [creds, setCreds] = useState<BackupTargetInput>(EMPTY_CREDS);
  const [showTargets, setShowTargets] = useState(false);
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
    } catch (e) {
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

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    if (selectedId) void refresh();
  }, [refresh, selectedId]);

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

  const addTarget = async () => {
    if (!newName.trim() || !creds.bucket.trim() || !creds.accessKey.trim()) return;
    setBusy('add-target');
    setErr(null);
    try {
      const id = crypto.randomUUID();
      const t = await cloudBackupTargetAdd(id, newName.trim(), creds);
      setTargets((prev) => [...(prev ?? []), t]);
      setSelectedId(t.id);
      setShowAdd(false);
      setNewName('');
      setCreds(EMPTY_CREDS);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const deleteTarget = async (id: string, name: string) => {
    if (!window.confirm(`Remove backup target "${name}"?`)) return;
    setBusy(`del-target:${id}`);
    try {
      await cloudBackupTargetDelete(id);
      const updated = (targets ?? []).filter((t) => t.id !== id);
      setTargets(updated);
      if (selectedId === id) setSelectedId(updated[0]?.id ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const selected = targets?.find((t) => t.id === selectedId);

  return (
    <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Target selector */}
      {targets !== null && (
        <section className="card">
          <div className="console-header">
            <Archive size={14} />
            <span>Backup storage</span>
            <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }}
              onClick={() => setShowTargets(!showTargets)} aria-label="Manage targets">
              <ChevronDown size={14} style={{ transform: showTargets ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }} />
            </button>
          </div>

          {targets.length === 0 ? (
            <p className="detail-hint">No backup storage configured yet. Add one below.</p>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {targets.map((t) => (
                <button key={t.id} type="button"
                  className={`detail-tab${selectedId === t.id ? ' detail-tab--active' : ''}`}
                  style={{ flex: 'none', gap: 6 }}
                  onClick={() => setSelectedId(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {showTargets && (
            <div style={{ marginTop: 10 }}>
              {targets.map((t) => (
                <div key={t.id} className="ops-row" style={{ marginBottom: 6 }}>
                  <div className="ops-row-main">
                    <span className="ops-row-title">{t.name}</span>
                    <span className="ops-row-sub">{t.bucket} · {t.endpoint || 'AWS S3'}</span>
                  </div>
                  <button type="button" className="icon-btn ops-danger"
                    disabled={!!busy} onClick={() => deleteTarget(t.id, t.name)} aria-label="Remove">
                    {busy === `del-target:${t.id}` ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              ))}

              {showAdd ? (
                <div style={{ marginTop: 8 }}>
                  <input className="ops-field" placeholder="Name (e.g. Backblaze B2)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <input className="ops-field" placeholder="Bucket" value={creds.bucket} onChange={(e) => setCreds({ ...creds, bucket: e.target.value })} />
                  <input className="ops-field" placeholder="Endpoint URL (empty = AWS)" value={creds.endpoint} onChange={(e) => setCreds({ ...creds, endpoint: e.target.value })} />
                  <input className="ops-field" placeholder="Region" value={creds.region} onChange={(e) => setCreds({ ...creds, region: e.target.value })} />
                  <input className="ops-field" placeholder="Access key ID" value={creds.accessKey} onChange={(e) => setCreds({ ...creds, accessKey: e.target.value })} autoCapitalize="off" />
                  <input className="ops-field" placeholder="Secret access key" value={creds.secretKey} onChange={(e) => setCreds({ ...creds, secretKey: e.target.value })} autoCapitalize="off" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <input type="checkbox" checked={creds.pathStyle} onChange={(e) => setCreds({ ...creds, pathStyle: e.target.checked })} />
                      Path-style (MinIO / self-hosted)
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="ops-btn" style={{ marginTop: 0 }} onClick={addTarget} disabled={busy === 'add-target'}>
                      {busy === 'add-target' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Save
                    </button>
                    <button type="button" className="ops-btn" style={{ marginTop: 0 }} onClick={() => { setShowAdd(false); setCreds(EMPTY_CREDS); setNewName(''); }} disabled={busy === 'add-target'}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="ops-btn" style={{ marginTop: 6 }} onClick={() => setShowAdd(true)} disabled={!!busy}>
                  <Plus size={14} /> Add backup storage
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Backup list + actions */}
      {selected && (
        <section className="card">
          <div className="console-header">
            <Archive size={14} />
            <span>Backups in {selected.name}</span>
            <button type="button" className="icon-btn" style={{ marginLeft: 'auto' }}
              onClick={() => void refresh()} disabled={!online || !!busy} aria-label="Refresh">
              <RefreshCw size={14} className={busy === 'list' ? 'spin' : ''} />
            </button>
          </div>

          {!online ? (
            <p className="detail-hint">Bring this server's host online to manage backups.</p>
          ) : (
            <>
              <button type="button" className="ops-btn" onClick={backupNow} disabled={!!busy}>
                {busy === 'create' ? <Loader2 size={14} className="spin" /> : <Archive size={14} />}
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
                        <span className="ops-row-sub">{fmtBytes(b.size)} · {new Date(b.createdAt).toLocaleString()}</span>
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
            </>
          )}
        </section>
      )}

      {/* No targets + add prompt when targets panel isn't showing */}
      {targets !== null && targets.length === 0 && !showTargets && (
        <button type="button" className="ops-btn" onClick={() => setShowTargets(true)}>
          <Plus size={14} /> Configure backup storage
        </button>
      )}
    </div>
  );
}
