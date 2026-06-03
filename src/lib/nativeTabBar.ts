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

/** Subscribe to native tab taps. Resolves with a handle; call `.unregister()`
 *  to tear it down. */
export function onNativeTabSelect(cb: (id: string) => void): Promise<PluginListener> {
  return addPluginListener('glasstabbar', 'select', (p: { id: string }) => cb(p.id));
}
