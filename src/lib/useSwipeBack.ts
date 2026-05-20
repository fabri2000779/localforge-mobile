import { useEffect } from 'react';

/**
 * Functional left-edge "swipe back" for the mobile webview.
 *
 * Two reasons the native iOS edge-swipe does nothing here:
 *   1. WKWebView ships with `allowsBackForwardNavigationGestures` OFF and
 *      Tauri doesn't turn it on.
 *   2. Our navigation is a React state machine (App.tsx `route`), not URL
 *      history, so even if the gesture fired it'd have nothing to pop.
 *
 * So we recognise the gesture ourselves: a touch that STARTS within
 * `EDGE_PX` of the left edge and travels right far enough, straight
 * enough and quick enough counts as "back" and calls `onBack`. Passive
 * listeners — we never preventDefault, so normal scrolling/taps are
 * unaffected.
 *
 * `enabled` lets the caller disable it on root screens (login / home)
 * where there's nothing to go back to.
 */
const EDGE_PX = 28; // drag must begin this close to the left edge
const MIN_DX = 70; // minimum rightward travel to count as a back swipe
const MAX_DY = 45; // vertical slop above which it's a scroll, not a swipe
const MAX_MS = 700; // slower than this is a drag/scroll, not a flick

export function useSwipeBack(onBack: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let armed = false;

    function onStart(e: TouchEvent) {
      const t = e.touches[0];
      // Only arm when a single finger lands at the very left edge.
      if (!t || e.touches.length > 1 || t.clientX > EDGE_PX) {
        armed = false;
        return;
      }
      armed = true;
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
    }

    function onEnd(e: TouchEvent) {
      if (!armed) return;
      armed = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      const dt = Date.now() - startT;
      if (dx >= MIN_DX && dy <= MAX_DY && dt <= MAX_MS) onBack();
    }

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [onBack, enabled]);
}
