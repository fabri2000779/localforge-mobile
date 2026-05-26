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

export function cloudRelayStart(): Promise<void> {
  return invoke('cloud_relay_start');
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
