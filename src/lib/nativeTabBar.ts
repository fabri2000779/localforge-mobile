/**
 * JS bridge to the `tauri-plugin-glasstabbar` native iOS tab bar.
 *
 * On iOS the app mounts a real UITabBar (Liquid Glass on iOS 26) over the
 * webview and switches the React route from its tap events; the in-webview
 * CSS <TabBar> is hidden. On Android + desktop `hasNativeTabBar` is false and
 * these calls are never made (the CSS bar stays).
 */
import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { detectPlatform } from './platform';

export interface NativeTab {
  id: string;
  label: string;
  /** Apple SF Symbol name for the icon. */
  sfSymbol: string;
}

/** The native bar only exists on iOS. */
export const hasNativeTabBar = detectPlatform() === 'ios';

export function showNativeTabBar(items: NativeTab[], selected: string): Promise<void> {
  return invoke<void>('plugin:glasstabbar|show_bar', { items, selected }).catch(() => {});
}

export function setNativeSelected(id: string): Promise<void> {
  return invoke<void>('plugin:glasstabbar|set_selected', { id }).catch(() => {});
}

export function hideNativeTabBar(): Promise<void> {
  return invoke<void>('plugin:glasstabbar|hide_bar').catch(() => {});
}

/** Subscribe to native tab taps via the plugin event. Resolves with a handle;
 *  call `.unregister()` to tear it down. Payload shape varies across Tauri
 *  versions, so we extract the id defensively. (A second delivery path —
 *  `window.__lfNativeTabSelect`, called from Swift — backs this up.) */
export function onNativeTabSelect(cb: (id: string) => void): Promise<PluginListener> {
  return addPluginListener('glasstabbar', 'select', (raw: unknown) => {
    const id = extractId(raw);
    if (id) cb(id);
  });
}

function extractId(raw: unknown): string | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return raw as string;
    }
  }
  if (v && typeof v === 'object') {
    const o = v as { id?: unknown; payload?: { id?: unknown } };
    if (typeof o.id === 'string') return o.id;
    if (o.payload && typeof o.payload.id === 'string') return o.payload.id;
  }
  return null;
}
