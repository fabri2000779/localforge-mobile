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
