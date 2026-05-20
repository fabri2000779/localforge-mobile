package gg.localforge.iap

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

@InvokeArg
class GetProductsArgs {
    var productIds: List<String> = emptyList()
}

@InvokeArg
class PurchaseArgs {
    lateinit var productId: String
}

/// Google Play Billing bridge. Mirrors the iOS StoreKit plugin's surface:
/// list subscription products, launch a purchase, restore active subs.
///
/// Play Billing is callback-based and delivers the purchase result on a
/// separate listener (`onPurchasesUpdated`), so `purchase()` stashes the
/// in-flight `Invoke` and resolves it once the result arrives. As on iOS,
/// the client only returns the receipt handle (purchase token); the
/// backend re-verifies it against the Play Developer API before granting.
@TauriPlugin
class IapPlugin(private val activity: Activity) : Plugin(activity), PurchasesUpdatedListener {

    private val billingClient: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
        )
        .build()

    // purchase() resolves asynchronously from onPurchasesUpdated; the
    // in-flight Invoke lives here in the meantime.
    private var pendingPurchase: Invoke? = null

    // ── connection ──────────────────────────────────────────────────
    // Lazily (re)connect, then run `block`. Play disconnects the service
    // periodically, so every entry point routes through here.
    private fun withConnection(onError: (String) -> Unit, block: () -> Unit) {
        if (billingClient.isReady) {
            block()
            return
        }
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    block()
                } else {
                    onError("billing setup failed: ${result.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                // No-op: the next withConnection() call reconnects.
            }
        })
    }

    // ── getProducts ─────────────────────────────────────────────────
    @Command
    fun getProducts(invoke: Invoke) {
        val args = invoke.parseArgs(GetProductsArgs::class.java)
        withConnection({ invoke.reject(it) }) {
            val productList = args.productIds.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()
            billingClient.queryProductDetailsAsync(params) { result, details ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    invoke.reject("failed to load products: ${result.debugMessage}")
                    return@queryProductDetailsAsync
                }
                val arr = JSArray()
                for (pd in details) {
                    val phase = pd.subscriptionOfferDetails
                        ?.firstOrNull()
                        ?.pricingPhases
                        ?.pricingPhaseList
                        ?.firstOrNull()
                    val obj = JSObject()
                    obj.put("id", pd.productId)
                    obj.put("title", pd.name)
                    obj.put("description", pd.description)
                    obj.put("displayPrice", phase?.formattedPrice ?: "")
                    arr.put(obj)
                }
                val ret = JSObject()
                ret.put("products", arr)
                invoke.resolve(ret)
            }
        }
    }

    // ── purchase ────────────────────────────────────────────────────
    @Command
    fun purchase(invoke: Invoke) {
        val args = invoke.parseArgs(PurchaseArgs::class.java)
        if (pendingPurchase != null) {
            invoke.reject("another purchase is already in progress")
            return
        }
        withConnection({ invoke.reject(it) }) {
            val productList = listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(args.productId)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            )
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()
            billingClient.queryProductDetailsAsync(params) { result, details ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK || details.isEmpty()) {
                    invoke.reject("product not found: ${args.productId}")
                    return@queryProductDetailsAsync
                }
                val pd = details.first()
                val offerToken = pd.subscriptionOfferDetails?.firstOrNull()?.offerToken
                if (offerToken == null) {
                    invoke.reject("no subscription offer for ${args.productId}")
                    return@queryProductDetailsAsync
                }
                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(
                        listOf(
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(pd)
                                .setOfferToken(offerToken)
                                .build()
                        )
                    )
                    .build()
                pendingPurchase = invoke
                // launchBillingFlow must run on the UI thread; the query
                // callback may not be on it.
                activity.runOnUiThread {
                    val launch = billingClient.launchBillingFlow(activity, flowParams)
                    if (launch.responseCode != BillingClient.BillingResponseCode.OK) {
                        pendingPurchase = null
                        invoke.reject("failed to start purchase: ${launch.debugMessage}")
                    }
                    // Success path resolves later in onPurchasesUpdated.
                }
            }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        val invoke = pendingPurchase
        pendingPurchase = null
        if (invoke == null) {
            // Out-of-band update (e.g. a deferred purchase completing).
            // Acknowledge so it isn't auto-refunded after 3 days.
            purchases?.forEach { maybeAcknowledge(it) }
            return
        }
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val purchase = purchases?.firstOrNull {
                    it.purchaseState == Purchase.PurchaseState.PURCHASED
                }
                if (purchase == null) {
                    invoke.reject("purchase is pending")
                    return
                }
                maybeAcknowledge(purchase)
                val obj = JSObject()
                obj.put("productId", purchase.products.firstOrNull() ?: "")
                obj.put("platform", "android")
                obj.put("purchaseToken", purchase.purchaseToken)
                invoke.resolve(obj)
            }
            BillingClient.BillingResponseCode.USER_CANCELED ->
                invoke.reject("user_cancelled")
            else ->
                invoke.reject("purchase failed: ${result.debugMessage}")
        }
    }

    // Acknowledge a PURCHASED, not-yet-acknowledged subscription so Play
    // doesn't auto-refund it. Best-effort: the backend verify is the
    // source of truth for entitlement, this only keeps the money.
    private fun maybeAcknowledge(purchase: Purchase) {
        if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED && !purchase.isAcknowledged) {
            val params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.purchaseToken)
                .build()
            billingClient.acknowledgePurchase(params) { /* best-effort */ }
        }
    }

    // ── restorePurchases ────────────────────────────────────────────
    @Command
    fun restorePurchases(invoke: Invoke) {
        withConnection({ invoke.reject(it) }) {
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
            billingClient.queryPurchasesAsync(params) { result, purchases ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    invoke.reject("failed to query purchases: ${result.debugMessage}")
                    return@queryPurchasesAsync
                }
                val arr = JSArray()
                for (purchase in purchases) {
                    if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) continue
                    maybeAcknowledge(purchase)
                    val obj = JSObject()
                    obj.put("productId", purchase.products.firstOrNull() ?: "")
                    obj.put("platform", "android")
                    obj.put("purchaseToken", purchase.purchaseToken)
                    arr.put(obj)
                }
                val ret = JSObject()
                ret.put("purchases", arr)
                invoke.resolve(ret)
            }
        }
    }
}
