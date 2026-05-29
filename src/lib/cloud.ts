/**
 * Typed wrappers around the Tauri `invoke()` bridge for every cloud
 * command the Rust side registers.
 *
 * Mirror of the desktop's auth store. Each call:
 *   1. Forwards to the matching Rust #[tauri::command]
 *   2. Maps ApiError JSON into a typed reject we can `catch`
 *
 * We don't bring zustand in for v0.0.x — the only piece of cross-
 * screen state is `me`, and `App.tsx` holds it directly. When we add
 * org switching / server lists we'll lift state into a store.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// Wire types — match the cloud-client Rust definitions byte-for-byte.
// ---------------------------------------------------------------------------

export interface Subscription {
  plan: 'free' | 'hobby' | 'team';
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: number | null;
  purgeAt?: number | null;
}

export interface SyncKeyInfo {
  wrappedDek: string;
  kekSalt: string;
  kekParams: unknown | null;
}

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  emailVerifiedAt: number | null;
  createdAt: number;
  subscription: Subscription;
  syncKey: SyncKeyInfo | null;
}

/** Shape of a rejected cloud call. The Rust side returns this as the
 *  serialized form of `ApiError`. We catch it in the screens and
 *  surface the `code` / `message` to the user. */
export interface CloudError {
  status: number;
  code: string;
  message: string | null;
}

/** Type-guard for catch blocks — `invoke` rejects with `unknown`. */
export function isCloudError(e: unknown): e is CloudError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string'
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Returns the current Me if a valid session is stored, otherwise null. */
export function cloudMe(): Promise<Me | null> {
  return invoke<Me | null>('cloud_me');
}

export function cloudLogin(email: string, password: string): Promise<Me> {
  return invoke<Me>('cloud_login', { email, password });
}

export function cloudSignup(
  email: string,
  password: string,
  displayName?: string,
): Promise<Me> {
  return invoke<Me>('cloud_signup', {
    email,
    password,
    displayName: displayName || null,
  });
}

export function cloudLogout(): Promise<void> {
  return invoke('cloud_logout');
}

export function cloudRequestPasswordReset(email: string): Promise<void> {
  return invoke('cloud_request_password_reset', { email });
}

// ---------------------------------------------------------------------------
// Sync — the cloud-stored server list. Mobile only ever reads
// (observation-only in v0.0.x); the encrypted blob is stripped on the
// Rust side so the IPC stays lean.
// ---------------------------------------------------------------------------

export interface ServerSummary {
  id: string;
  name: string;
  updatedAt: number;
  /** Set ONLY for servers discovered live on an enrolled agent node over
   *  the relay (not cloud-synced). Carries the node_id they run on so the
   *  detail screen routes commands straight to that agent instead of doing
   *  a cloud-config lookup (which doesn't exist for agent-only servers).
   *  Undefined for normal cloud-synced servers. */
  nodeId?: string;
}

export function cloudServersList(): Promise<ServerSummary[]> {
  return invoke<ServerSummary[]>('cloud_servers_list');
}

// ---------------------------------------------------------------------------
// Machines — the org fleet (desktops + agents) the user can address over the
// relay. Live `online` comes from the relay DO's socket set, not a timestamp.
// ---------------------------------------------------------------------------

export interface Machine {
  id: string;
  name: string;
  kind: 'desktop' | 'agent';
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
}

export function cloudListMachines(): Promise<Machine[]> {
  return invoke<Machine[]>('cloud_list_machines');
}

// ---------------------------------------------------------------------------
// Org / team — members + invitations (Team plan). Mirrors the cloud's
// /v1/orgs/* and the desktop's member management.
// ---------------------------------------------------------------------------

export interface Member {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string; // owner | admin | operator | viewer
  joined_at: number;
}

export interface OrgInfo {
  id: string;
  name: string;
  role: string;
  isOwner: boolean;
  createdAt: number;
  members: Member[];
}

/** The user's primary org with its member list. */
export function cloudOrgMe(): Promise<OrgInfo> {
  return invoke<OrgInfo>('cloud_org_me');
}

/** Invite a sub-user by email + role (viewer|operator|admin). Admin+ only
 *  (the cloud 403s otherwise). */
export function cloudOrgInvite(orgId: string, email: string, role: string): Promise<void> {
  return invoke('cloud_org_invite', { orgId, email, role });
}

export interface OrgSummary {
  id: string;
  name: string;
  role: string;
  isOwner: boolean;
  createdAt: number;
  joinedAt: number;
}

/** Every org the user belongs to (own + invited). Powers the org switcher. */
export function cloudOrgsList(): Promise<OrgSummary[]> {
  return invoke<OrgSummary[]>('cloud_orgs_list');
}

/** Point cloud calls at a specific org (a sub-user viewing the owner's org),
 *  sent as X-LocalForge-Org. `null` → the caller's primary org. */
export function cloudSetActiveOrg(orgId: string | null): Promise<void> {
  return invoke('cloud_set_active_org', { orgId });
}

/** Accept an invitation from the phone. `token` is the invitation id; `secret`
 *  is the handoff key from the link #fragment (when present) so the new member
 *  decrypts the owner's servers immediately. Returns the joined org id. */
export function cloudOrgsAcceptInvite(token: string, secret?: string | null): Promise<string> {
  return invoke<string>('cloud_orgs_accept_invite', { token, secret: secret ?? null });
}

/** Sub-user side: unlock the org DEK for an org we don't own so we can decrypt
 *  the owner's server configs. 'granted' | 'no_grant' (owner hasn't sealed us
 *  yet) | 'no_keypair' (set up your sync key first). */
export type UnlockOrgResult = 'granted' | 'no_grant' | 'no_keypair';
export function cloudUnlockOrgDek(orgId: string): Promise<UnlockOrgResult> {
  return invoke<UnlockOrgResult>('cloud_unlock_org_dek', { orgId });
}

/** Switch decryption back to our own DEK (when returning to an org we own). */
export function cloudClearOrgDek(): Promise<void> {
  return invoke('cloud_clear_org_dek');
}

/** Invalidate this device's cached OWN DEK after a rotation done elsewhere, so
 *  the next op re-derives it from the passphrase instead of re-sealing a stale
 *  key. Used by the owner's phone on a `dek_rotated` relay event. */
export function cloudInvalidateLocalDek(): Promise<void> {
  return invoke('cloud_invalidate_local_dek');
}

/** Owner side ("confirm"): seal our org DEK to every member who joined but has
 *  no grant yet. Returns how many were newly granted. Requires our sync key
 *  unlocked (rejects with code `locked` otherwise). No-op if we're not the
 *  owner. */
export function cloudProcessGrants(orgId: string): Promise<number> {
  return invoke<number>('cloud_process_grants', { orgId });
}

/** Deep-link invite received (`localforge://invite`). The payload carries the
 *  invitation token + optional handoff secret. */
export function subscribeInviteReceived(
  handler: (p: { token: string; secret?: string | null }) => void,
): Promise<UnlistenFn> {
  return listen<{ token: string; secret?: string | null }>(
    'cloud://invite-received',
    (e) => handler(e.payload),
  );
}

// ---------------------------------------------------------------------------
// Sync key (DEK) — needed to decrypt a server's config for the
// viewer/editor. The DEK is unwrapped from `me.syncKey.wrappedDek` with
// the user's passphrase and cached locally; see src-tauri/src/vault.rs.
// ---------------------------------------------------------------------------

export type SyncKeyStatus = 'not_set_up' | 'locked' | 'unlocked';

/** 'not_set_up' (owner never set sync up) | 'locked' (need passphrase) |
 *  'unlocked' (DEK cached, can decrypt). */
export function cloudSyncKeyStatus(): Promise<SyncKeyStatus> {
  return invoke<SyncKeyStatus>('cloud_sync_key_status');
}

/** Unlock the DEK with the account password / sync passphrase. Rejects
 *  with code `wrong_secret` on a bad passphrase, `sync_key_not_set` if
 *  the owner never configured sync. */
export function cloudSyncKeyUnlock(secret: string): Promise<void> {
  return invoke('cloud_sync_key_unlock', { secret });
}

/** Set up envelope encryption from the phone (members who never used the
 *  desktop). Picks a fresh DEK + the chosen passphrase as the KEK, and
 *  publishes the user's keypair so they can receive org grants. Only call when
 *  status is `not_set_up` (the cloud 409s if a key already exists). */
export function cloudSyncKeySetup(secret: string): Promise<void> {
  return invoke('cloud_sync_key_setup', { secret });
}

/** Decrypted config of one synced server. `gameType` is the template
 *  id (e.g. "minecraft-java"); `config` is the editable game settings. */
export interface ServerConfigView {
  id: string;
  name: string;
  gameType: string;
  port: number;
  memoryMb: number;
  config: Record<string, string>;
  nodeId: string | null;
}

/** Decrypt + return one server's config. Rejects with code `locked`
 *  (412) when the sync key hasn't been unlocked on this device. */
export function cloudServerConfig(serverId: string): Promise<ServerConfigView> {
  return invoke<ServerConfigView>('cloud_server_config', { serverId });
}

// ---------------------------------------------------------------------------
// Relay — WebSocket bridge to the owner's desktop. The Rust side
// keeps the connection alive across reconnects; React subscribes to
// the named events below and sends commands via `cloudRelaySendCmd`.
// ---------------------------------------------------------------------------

export function cloudRelayStart(orgId?: string | null): Promise<void> {
  return invoke('cloud_relay_start', { orgId: orgId ?? null });
}
export function cloudRelayStop(): Promise<void> {
  return invoke('cloud_relay_stop');
}
export function cloudRelaySendCmd(payload: Record<string, unknown>): Promise<void> {
  return invoke('cloud_relay_send_cmd', { payload });
}

export function subscribeRelayConnected(handler: () => void): Promise<UnlistenFn> {
  return listen('cloud://relay-connected', () => handler());
}
export function subscribeRelayDisconnected(handler: () => void): Promise<UnlistenFn> {
  return listen('cloud://relay-disconnected', () => handler());
}
/** Owner-emitted event message. Body shape depends on `kind` — caller
 *  is responsible for narrowing. */
export function subscribeRelayEvent(
  handler: (msg: Record<string, unknown>) => void,
): Promise<UnlistenFn> {
  return listen<Record<string, unknown>>('cloud://relay-event', (e) => handler(e.payload));
}

// ---------------------------------------------------------------------------
// Backups + schedules (driven over the relay; the host holds the S3 creds —
// the secret never reaches the phone or the cloud). Wire shapes mirror the
// Rust `BackupEntry` / `Schedule` / `ScheduleAction` (all camelCase).
// ---------------------------------------------------------------------------

export interface BackupEntry {
  key: string;
  size: number;
  createdAt: number;
}

export type ScheduleAction =
  | { kind: 'restart' }
  | { kind: 'command'; command: string }
  | { kind: 'broadcast'; message: string };

export interface Schedule {
  id: string;
  serverId: string;
  cron: string;
  action: ScheduleAction;
  enabled: boolean;
  lastRun?: number | null;
}

/**
 * Send a relay cmd to the host and await its reply, correlated by request_id.
 * Resolves with the matching event payload — a `snapshotKind` event (for list
 * cmds that carry data inline) or a successful `cmd_result`. Rejects on a
 * failed cmd_result or after `timeoutMs` (the host may be offline).
 */
export async function relayRequest(opts: {
  cmd: string;
  target: string;
  args?: Record<string, unknown>;
  snapshotKind?: string;
  timeoutMs?: number;
}): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID();
  let resolveFn!: (v: Record<string, unknown>) => void;
  let rejectFn!: (e: Error) => void;
  const result = new Promise<Record<string, unknown>>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  const timer = setTimeout(
    () => rejectFn(new Error('Timed out — is the host online?')),
    opts.timeoutMs ?? 15000,
  );
  const unsub = await subscribeRelayEvent((msg) => {
    if (msg.request_id !== requestId) return;
    if (opts.snapshotKind && msg.kind === opts.snapshotKind) {
      resolveFn(msg);
      return;
    }
    if (msg.kind === 'cmd_result') {
      if (msg.success) resolveFn(msg);
      else rejectFn(new Error(typeof msg.error === 'string' ? msg.error : 'Command failed'));
    }
  });
  try {
    await cloudRelaySendCmd({
      type: 'cmd',
      cmd: opts.cmd,
      request_id: requestId,
      target: opts.target,
      args: opts.args ?? {},
    });
    return await result;
  } finally {
    clearTimeout(timer);
    unsub();
  }
}

// ---------------------------------------------------------------------------
// OAuth — fire-and-forget. The actual token arrives via the
// `cloud://signed-in` event AFTER the user completes the browser flow;
// callers subscribe with `onSignedIn()` below before invoking start.
// ---------------------------------------------------------------------------

export type OAuthProvider = 'google' | 'discord' | 'github';

export function cloudOAuthStart(provider: OAuthProvider): Promise<void> {
  return invoke('cloud_oauth_start', { provider });
}

/** Subscribe to the deep-link OAuth completion event. Resolves to an
 *  unlisten fn the caller should invoke in cleanup. Named with the
 *  `subscribe…` prefix so it doesn't collide with component prop
 *  names like `onSignedIn`. */
export function subscribeSignedIn(handler: (me: Me) => void): Promise<UnlistenFn> {
  return listen<Me>('cloud://signed-in', (event) => {
    handler(event.payload);
  });
}

/** Subscribe to OAuth failures (no token in callback, /me failed,
 *  etc). Used by the LoginScreen to flip out of the "waiting for
 *  browser" state and show the error inline. */
export interface OAuthErrorEvent {
  code: string;
  message: string | null;
}
export function subscribeAuthError(handler: (e: OAuthErrorEvent) => void): Promise<UnlistenFn> {
  return listen<OAuthErrorEvent>('cloud://auth-error', (event) => {
    handler(event.payload);
  });
}
