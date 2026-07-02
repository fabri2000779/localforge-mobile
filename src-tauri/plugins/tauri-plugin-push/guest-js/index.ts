import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core';

export interface RegisterResult {
  platform: 'ios' | 'android';
  token: string;
}

export interface PushError {
  kind: 'unsupported' | 'denied' | 'push' | 'internal';
  message: string;
}

export function isPushError(e: unknown): e is PushError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e;
}

/** Request notification permission + register for remote push; resolves with
 *  this device's token. Rejects with kind 'denied' if the user declines, or
 *  'unsupported' on desktop. The app forwards the token to the cloud via
 *  `cloud_push_register`. */
export async function register(): Promise<RegisterResult> {
  return invoke<RegisterResult>('plugin:push|register');
}

/** Fires when a crash push (or home-screen Quick Action) is tapped — the
 *  payload carries the opaque server id, plus the org id when the push came
 *  from a different org than the active one (the app switches first). The app
 *  resolves the id to a synced server and deep-links to it. */
export async function onOpenServer(
  handler: (serverId: string, orgId?: string | null) => void,
): Promise<PluginListener> {
  return addPluginListener(
    'push',
    'openServer',
    (e: { serverId?: string; orgId?: string | null }) => {
      if (e?.serverId) handler(e.serverId, e.orgId ?? null);
    },
  );
}

export interface QuickAction {
  serverId: string;
  /** Display label (the server name). */
  label: string;
}

/** Replace the app's home-screen Quick Actions with one per server (call with
 *  the user's pinned / most-recent servers). No-op on desktop. */
export async function setQuickActions(items: QuickAction[]): Promise<void> {
  return invoke('plugin:push|set_quick_actions', { items });
}
