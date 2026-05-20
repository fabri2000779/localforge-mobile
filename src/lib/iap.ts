/**
 * App-level In-App Purchase glue.
 *
 * Combines the native store plugin (`tauri-plugin-iap-api`) with the
 * cloud verify commands (`crate::iap`). The native side runs the
 * purchase sheet and hands back a receipt handle; we POST it to the
 * cloud, which re-checks it against the store's server API and grants
 * the plan, then returns the refreshed `Me`.
 *
 * Components import from here, not from the plugin directly, so the
 * "purchase → verify → refreshed Me" round-trip lives in one place.
 */
import { invoke } from '@tauri-apps/api/core';
import {
  getProducts,
  purchase as storePurchase,
  restorePurchases as storeRestore,
  isUserCancelled,
  isIapError,
} from 'tauri-plugin-iap-api';
import type { Product, PurchaseResult, Plan } from 'tauri-plugin-iap-api';
import type { Me } from './cloud';

export type { Product, Plan };
export { isUserCancelled, isIapError };

/** Subscriptions available on this device's store (`[]` on desktop). */
export function listProducts(): Promise<Product[]> {
  return getProducts();
}

/** Verify a completed/restored purchase with the cloud, returning the
 *  refreshed Me (its `subscription.plan` reflects the grant). */
function verify(result: PurchaseResult): Promise<Me> {
  if (result.platform === 'ios') {
    if (!result.transactionId) {
      return Promise.reject(new Error('iOS purchase returned no transaction id'));
    }
    return invoke<Me>('cloud_iap_verify_apple', {
      transactionId: result.transactionId,
    });
  }
  if (!result.purchaseToken) {
    return Promise.reject(new Error('Android purchase returned no purchase token'));
  }
  return invoke<Me>('cloud_iap_verify_google', {
    purchaseToken: result.purchaseToken,
    productId: result.productId,
  });
}

/** Full flow: launch the store sheet for `productId`, then verify with
 *  the cloud. Resolves to the refreshed Me. Rejects with an `IapError`
 *  (`kind: 'user_cancelled'` when the user backs out of the sheet). */
export async function purchaseAndVerify(productId: string): Promise<Me> {
  const result = await storePurchase(productId);
  return verify(result);
}

/**
 * Restore flow: read active entitlements from the store and verify each
 * with the cloud. Returns the latest Me, or null when the store reports
 * nothing to restore. Verify failures on individual entitlements are
 * swallowed so one stale receipt doesn't abort the whole restore.
 */
export async function restoreAndVerify(): Promise<Me | null> {
  const restored = await storeRestore();
  let latest: Me | null = null;
  for (const r of restored) {
    try {
      latest = await verify(r);
    } catch (e) {
      console.warn('restore: verify failed for', r.productId, e);
    }
  }
  return latest;
}
