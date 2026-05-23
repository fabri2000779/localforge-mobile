/**
 * View + edit a synced server's config from the phone.
 *
 * Flow:
 *   1. Check the sync-key status. To decrypt the config blob the mobile
 *      needs the DEK, which is unwrapped from the cloud's wrapped_dek
 *      with the user's passphrase (`cloud_sync_key_unlock`).
 *        - not_set_up → the owner never configured sync; nothing to show.
 *        - locked     → prompt for the passphrase, then unlock.
 *        - unlocked   → decrypt + show the config.
 *   2. The user edits the game settings (the `config` map). Port / RAM /
 *      game are shown read-only — the owner's `update_server_config`
 *      only takes the settings map.
 *   3. Save sends a `server.update_config` command over the relay. The
 *      owner's desktop RelayCommandExecutor applies it to the real
 *      container and re-syncs; the result comes back as a `cmd_result`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock, Save, Loader2, AlertOctagon, ShieldOff } from 'lucide-react';
import {
  cloudSyncKeyStatus,
  cloudSyncKeyUnlock,
  cloudServerConfig,
  cloudRelaySendCmd,
  subscribeRelayEvent,
  isCloudError,
  type ServerConfigView,
  type ServerSummary,
  type SyncKeyStatus,
} from '../lib/cloud';

interface Props {
  server: ServerSummary;
  onBack: () => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'not_set_up' }
  | { kind: 'locked'; busy: boolean; err: string | null }
  | { kind: 'ready'; cfg: ServerConfigView }
  | { kind: 'error'; msg: string };

function errText(e: unknown): string {
  return isCloudError(e) ? e.message ?? e.code : String(e);
}

export function ServerConfigScreen({ server, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [passphrase, setPassphrase] = useState('');
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const awaitingId = useRef<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await cloudServerConfig(server.id);
      setEdited({ ...cfg.config });
      setPhase({ kind: 'ready', cfg });
    } catch (e) {
      if (isCloudError(e) && e.code === 'locked') {
        setPhase({ kind: 'locked', busy: false, err: null });
      } else {
        setPhase({ kind: 'error', msg: errText(e) });
      }
    }
  }, [server.id]);

  // Decide the initial phase from the sync-key status.
  useEffect(() => {
    let cancelled = false;
    cloudSyncKeyStatus()
      .then((s: SyncKeyStatus) => {
        if (cancelled) return;
        if (s === 'not_set_up') setPhase({ kind: 'not_set_up' });
        else if (s === 'locked') setPhase({ kind: 'locked', busy: false, err: null });
        else void loadConfig();
      })
      .catch((e) => {
        if (!cancelled) setPhase({ kind: 'error', msg: errText(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [loadConfig]);

  // Catch the cmd_result for our update_config command.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    subscribeRelayEvent((raw) => {
      const m = raw as {
        kind?: string;
        request_id?: string;
        ok?: boolean;
        success?: boolean;
        error?: string;
      };
      if (m.kind !== 'cmd_result' || m.request_id !== awaitingId.current) return;
      awaitingId.current = null;
      setSaving(false);
      const ok = m.ok === true || m.success === true;
      setToast(
        ok
          ? { kind: 'ok', text: 'Saved — applied on your desktop.' }
          : { kind: 'err', text: m.error || 'The owner couldn’t apply the change.' },
      );
    }).then((u) => {
      unsub = u;
    });
    return () => unsub?.();
  }, []);

  async function onUnlock() {
    if (!passphrase.trim()) return;
    setPhase({ kind: 'locked', busy: true, err: null });
    try {
      await cloudSyncKeyUnlock(passphrase);
      setPassphrase('');
      setPhase({ kind: 'loading' });
      await loadConfig();
    } catch (e) {
      const msg = isCloudError(e)
        ? e.code === 'wrong_secret'
          ? 'Wrong passphrase — try again.'
          : e.code === 'sync_key_not_set'
            ? 'Sync isn’t set up on your desktop yet.'
            : e.message ?? e.code
        : String(e);
      setPhase({ kind: 'locked', busy: false, err: msg });
    }
  }

  async function onSave() {
    if (phase.kind !== 'ready' || saving) return;
    setSaving(true);
    setToast(null);
    const requestId = crypto.randomUUID();
    awaitingId.current = requestId;
    try {
      // The owner's RelayCommandExecutor reads `args.config` / `args.nodeId`
      // (CMD_MAP['server.update_config']); the cloud relay allows it for
      // admin+ senders. Config goes under `args`, NOT top-level.
      await cloudRelaySendCmd({
        type: 'cmd',
        cmd: 'server.update_config',
        request_id: requestId,
        target: server.id,
        args: { config: edited, nodeId: phase.cfg.nodeId ?? 'local' },
      });
      // Fallback if the owner is offline and no cmd_result ever lands.
      window.setTimeout(() => {
        if (awaitingId.current === requestId) {
          awaitingId.current = null;
          setSaving(false);
          setToast({ kind: 'err', text: 'No response — is your desktop online?' });
        }
      }, 15000);
    } catch (e) {
      awaitingId.current = null;
      setSaving(false);
      setToast({
        kind: 'err',
        text: isCloudError(e) ? e.message ?? e.code : 'Couldn’t send — is the relay connected?',
      });
    }
  }

  const dirty =
    phase.kind === 'ready' &&
    Object.keys(edited).some((k) => edited[k] !== phase.cfg.config[k]);

  return (
    <div className="detail-screen">
      <header className="detail-header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={16} />
        </button>
        <div className="detail-title">
          <div className="home-eyebrow">Configuration</div>
          <h1>{server.name}</h1>
        </div>
      </header>

      {phase.kind === 'loading' && (
        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', padding: 28 }}>
          <Loader2 size={18} className="spin" />
          <span>Loading config…</span>
        </section>
      )}

      {phase.kind === 'not_set_up' && (
        <section className="card cfg-notice">
          <ShieldOff size={20} />
          <h2>Sync isn’t set up</h2>
          <p>
            Open LocalForge on your desktop and set up a sync passphrase
            first. Until then there’s no encrypted config to read here.
          </p>
        </section>
      )}

      {phase.kind === 'error' && (
        <section className="card cfg-notice">
          <AlertOctagon size={20} />
          <h2>Couldn’t load config</h2>
          <p>{phase.msg}</p>
        </section>
      )}

      {phase.kind === 'locked' && (
        <section className="card cfg-notice">
          <Lock size={20} />
          <h2>Unlock to view config</h2>
          <p>
            Enter your sync passphrase (the one you set on desktop). It
            never leaves this device — it only unwraps your key here.
          </p>
          <input
            className="cfg-input"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Sync passphrase"
            autoCapitalize="none"
            autoCorrect="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onUnlock();
            }}
          />
          {phase.err && <div className="cfg-err">{phase.err}</div>}
          <button
            type="button"
            className="cfg-btn"
            disabled={phase.busy || !passphrase.trim()}
            onClick={() => void onUnlock()}
          >
            {phase.busy ? <Loader2 size={15} className="spin" /> : <Lock size={15} />}
            {phase.busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </section>
      )}

      {phase.kind === 'ready' && (
        <>
          <section className="card">
            <dl className="kv">
              <div>
                <dt>Game</dt>
                <dd>{phase.cfg.gameType}</dd>
              </div>
              <div>
                <dt>Port</dt>
                <dd className="mono">{phase.cfg.port}</dd>
              </div>
              <div>
                <dt>Memory</dt>
                <dd>{phase.cfg.memoryMb} MB</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <div className="action-card-header">
              <h2>Game settings</h2>
              <p>
                Edits are sent to your desktop over the relay; it applies
                them to the container and re-syncs. The server may need a
                restart for some changes to take effect.
              </p>
            </div>
            {Object.keys(edited).length === 0 ? (
              <p className="cfg-empty">This server has no editable settings.</p>
            ) : (
              <div className="cfg-fields">
                {Object.keys(edited)
                  .sort()
                  .map((key) => (
                    <label key={key} className="cfg-field">
                      <span className="cfg-label">{key}</span>
                      <input
                        className="cfg-input"
                        value={edited[key]}
                        autoCapitalize="none"
                        autoCorrect="off"
                        onChange={(e) =>
                          setEdited((cur) => ({ ...cur, [key]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
              </div>
            )}
          </section>

          {toast && (
            <div className={`cfg-toast ${toast.kind === 'ok' ? 'cfg-toast-ok' : 'cfg-toast-err'}`}>
              {toast.text}
            </div>
          )}

          <button
            type="button"
            className="cfg-btn cfg-save"
            disabled={!dirty || saving}
            onClick={() => void onSave()}
          >
            {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
          </button>
        </>
      )}
    </div>
  );
}
