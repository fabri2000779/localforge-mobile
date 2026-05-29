/**
 * Runtime platform detection for adaptive native styling.
 *
 * The mobile UI is a WebView, so we can't use the OS's native materials
 * directly — but we CAN branch CSS per platform to match each OS's idiom:
 * iOS gets a Liquid-Glass-style tab bar (translucent + blurred), Android gets
 * a Material 3 navigation bar (tonal surface + pill active indicator).
 *
 * Detection is via `navigator.userAgent` (no Tauri OS plugin needed): the
 * WebView reports the real device UA. On a desktop dev preview it resolves to
 * 'web' and the neutral fallback style applies.
 */
export type Platform = 'ios' | 'android' | 'web';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  // iPhone/iPad/iPod, plus iPadOS which can masquerade as desktop Safari
  // (Macintosh UA + a touch screen).
  if (
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
  ) {
    return 'ios';
  }
  return 'web';
}

/** Add a `plat-ios` / `plat-android` / `plat-web` class to <html> so CSS can
 *  branch the tab bar (and anything else) per platform. Call once at startup. */
export function applyPlatformClass(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.add(`plat-${detectPlatform()}`);
}
