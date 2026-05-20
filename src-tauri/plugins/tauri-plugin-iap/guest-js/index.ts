/**
 * tauri-plugin-iap — JS API.
 *
 * Thin typed wrappers over the plugin's Rust commands, which on mobile
 * route to native StoreKit (iOS) / Play Billing (Android). The store
 * interaction ends here: a successful `purchase` resolves with a receipt
 * handle (Apple `transactionId` or Google `purchaseToken`) that the app
 * then sends to the cloud verify endpoint. The plugin never grants a
 * plan itself — the backend does, after re-checking the receipt.
 */
import { invoke } from '@tauri-apps/api/core';

export type Plan = 'hobby' | 'team';

export interface Product {
  /** Store product identifier (App Store / Play Console). */
  id: string;
  title: string;
  description: string;
  /** Store-localised, currency-formatted price, e.g. "€5.00". */
  displayPrice: string;
  /** Derived here from `id` — the native side leaves it blank. */
  plan: Plan;
}

export interface PurchaseResult {
  productId: string;
  platform: 'ios' | 'android';
  /** Present on iOS. */
  transactionId?: string;
  /** Present on Android. */
  purchaseToken?: string;
}

/**
 * Store product identifiers. These MUST match what's configured in App
 * Store Connect (reverse-DNS) and Play Console (plain ids). They differ
 * per store, hence the split. This is the single source of truth for
 * the id↔plan relationship on the client; the backend keeps its own
 * copy in `lib/iap.ts`.
 */
export const PRODUCT_IDS = {
  ios: {
    hobby: 'com.localforge.mobile.hobby.monthly',
    team: 'com.localforge.mobile.team.monthly',
  },
  android: {
    hobby: 'hobby_monthly',
    team: 'team_monthly',
  },
} as const;

const PLAN_BY_ID: Record<string, Plan> = {
  [PRODUCT_IDS.ios.hobby]: 'hobby',
  [PRODUCT_IDS.ios.team]: 'team',
  [PRODUCT_IDS.android.hobby]: 'hobby',
  [PRODUCT_IDS.android.team]: 'team',
};

/** Map a store product id to our plan, or null if unrecognised. */
export function planForProductId(id: string): Plan | null {
  return PLAN_BY_ID[id] ?? null;
}

// Union of every id. Both stores silently ignore ids they don't own, so
// we can hand the whole list to `getProducts` without per-platform
// branching in JS — each store returns only its own two.
const ALL_PRODUCT_IDS: string[] = [
  PRODUCT_IDS.ios.hobby,
  PRODUCT_IDS.ios.team,
  PRODUCT_IDS.android.hobby,
  PRODUCT_IDS.android.team,
];

/**
 * Fetch the purchasable subscriptions from whichever store this build
 * runs on. Returns `[]` on desktop (the command rejects with
 * `unsupported`, which we swallow into an empty list so callers can
 * treat "no IAP here" uniformly).
 */
export async function getProducts(): Promise<Product[]> {
  try {
    const products = await invoke<Product[]>('plugin:iap|get_products', {
      productIds: ALL_PRODUCT_IDS,
    });
    // Native leaves `plan` blank; fill it from the id and drop anything
    // we don't recognise (shouldn't happen, but keeps the type honest).
    return products
      .map((p) => {
        const plan = planForProductId(p.id);
        return plan ? { ...p, plan } : null;
      })
      .filter((p): p is Product => p !== null);
  } catch (e) {
    if (isUnsupported(e)) return [];
    throw e;
  }
}

/** Launch the store purchase sheet for `productId`. Rejects with an
 *  `IapError` — `kind: 'user_cancelled'` when the user backs out. */
export function purchase(productId: string): Promise<PurchaseResult> {
  return invoke<PurchaseResult>('plugin:iap|purchase', { productId });
}

/** Re-read active entitlements from the store (the "Restore Purchases"
 *  action). Returns `[]` on desktop. */
export async function restorePurchases(): Promise<PurchaseResult[]> {
  try {
    return await invoke<PurchaseResult[]>('plugin:iap|restore_purchases');
  } catch (e) {
    if (isUnsupported(e)) return [];
    throw e;
  }
}

/** The error shape the Rust layer serialises (`{ kind, message }`). */
export interface IapError {
  kind: 'unsupported' | 'user_cancelled' | 'store' | 'internal';
  message: string;
}

export function isIapError(e: unknown): e is IapError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'kind' in e &&
    typeof (e as { kind: unknown }).kind === 'string'
  );
}

export function isUserCancelled(e: unknown): boolean {
  return isIapError(e) && e.kind === 'user_cancelled';
}

function isUnsupported(e: unknown): boolean {
  return isIapError(e) && e.kind === 'unsupported';
}
