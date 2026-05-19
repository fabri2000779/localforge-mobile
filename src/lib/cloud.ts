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
}

export function cloudServersList(): Promise<ServerSummary[]> {
  return invoke<ServerSummary[]>('cloud_servers_list');
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
