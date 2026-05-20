import Foundation
import StoreKit
import Tauri

// ─────────────────────────────────────────────────────────────────────────
// Crash-avoidance notes (Swift SR-11564 —
// __swift_instantiateConcreteTypeFromMangledName aborts on launch of a
// plugin command in release). Three independent mitigations, all needed:
//
// 1. THE TARGET IS BUILT -Onone (see ../Package.swift swiftSettings). The
//    symbolicated v0.2.15 crash was `specialized IapPlugin.getProducts` →
//    the OPTIMIZER emitted a lazy runtime type-metadata accessor that
//    traps. -Onone makes the compiler emit direct metadata references.
//    This is the primary fix; the rest are belt-and-suspenders.
//
// 2. RESPONSES ARE CONCRETE Encodable STRUCTS, never `[String: Any]`
//    dicts. Passing a dict takes Tauri's `resolve(JsonObject)` overload →
//    `JsonValue.prepare()` whose `value as? [String: Any?]` cast forces
//    `Dictionary<String, Optional<Any>>` metadata instantiation (same
//    trap). The Encodable overload calls `JSONEncoder().encode` directly
//    and never touches `prepare()`.
//
// 3. ARGS ARE READ VIA `getRawArgs()` + JSONSerialization, NOT
//    `invoke.getArgs()`. getArgs() returns `[String: JSValue]` — a
//    dictionary keyed on Tauri's custom existential protocol, another
//    exotic type the optimizer instantiates lazily. JSONSerialization
//    yields Foundation objects we read through the ubiquitous
//    `[String: Any]` / `[String]` types, whose metadata is always present.
//
// 4. getProducts NEVER calls `invoke.reject(...)`. reject() builds
//    `["message": msg]` and runs it through the SAME `prepare()` cast in
//    Tauri's package (which is still optimized — we only control OUR
//    target's -Onone). So the hot path (tap "Servers" → getProducts)
//    resolves an (possibly empty) payload instead of rejecting. purchase/
//    restore still reject because the Rust side needs to distinguish
//    cancel/failure; those fire only on explicit user action.
//
// Field names are camelCase to match the serde `rename_all` contract on
// the Rust side (models.rs).
// ─────────────────────────────────────────────────────────────────────────

/// One purchasable product, shaped for the Rust `Product` type.
struct ProductPayload: Encodable {
  let id: String
  let title: String
  let description: String
  let displayPrice: String
}

/// `getProducts` response wrapper. Native always resolves an object (the
/// Android side can't resolve a bare array), so the list is nested.
struct ProductsPayload: Encodable {
  let products: [ProductPayload]
}

/// One completed/restored purchase, shaped for the Rust `PurchaseResult`
/// type. `purchaseToken` (Android-only) is omitted; serde defaults the
/// absent Option to None.
struct PurchasePayload: Encodable {
  let productId: String
  let platform: String
  let transactionId: String
}

/// `restorePurchases` response wrapper.
struct PurchasesPayload: Encodable {
  let purchases: [PurchasePayload]
}

/// StoreKit 2 bridge. Each command hops onto a `Task` because StoreKit's
/// product/purchase APIs are async; the `Invoke` is resolved/rejected
/// from inside the task once the await chain finishes.
///
/// Scope is deliberately thin: this returns the store's product list and
/// the receipt handle (StoreKit `transaction.id`) for a completed
/// purchase. Entitlement granting lives on the backend, which re-checks
/// every transaction id against the App Store Server API — the client is
/// never trusted to assert "I paid".
class IapPlugin: Plugin {
  // MARK: - Arg parsing (Foundation-only, no Tauri existential types)

  /// Read a `[String]` field out of the raw JSON args. Returns [] on any
  /// problem — getProducts treats "no ids" as "no products", never an error.
  private static func stringArray(fromRawArgs raw: String, key: String) -> [String] {
    guard let data = raw.data(using: .utf8),
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let arr = obj[key] as? [String]
    else {
      return []
    }
    return arr
  }

  /// Read a single `String` field out of the raw JSON args, or nil.
  private static func string(fromRawArgs raw: String, key: String) -> String? {
    guard let data = raw.data(using: .utf8),
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      return nil
    }
    return obj[key] as? String
  }

  // MARK: - Commands

  @objc public func getProducts(_ invoke: Invoke) throws {
    guard #available(iOS 15.0, *) else {
      // Old iOS: no StoreKit 2. Resolve an empty list rather than reject —
      // reject routes through Tauri's prepare() which can trap in release.
      invoke.resolve(ProductsPayload(products: []))
      return
    }
    let productIds = Self.stringArray(fromRawArgs: invoke.getRawArgs(), key: "productIds")
    Task {
      // StoreKit silently drops unknown ids, so the caller can pass the
      // union of iOS+Android ids and we return only the ones that exist in
      // App Store Connect. On error we resolve an empty list (never reject)
      // so the paywall degrades to "no plans" instead of crashing.
      let storeProducts = (try? await Product.products(for: productIds)) ?? []
      let products = storeProducts.map { product in
        ProductPayload(
          id: product.id,
          title: product.displayName,
          description: product.description,
          displayPrice: product.displayPrice
        )
      }
      invoke.resolve(ProductsPayload(products: products))
    }
  }

  @objc public func purchase(_ invoke: Invoke) throws {
    guard #available(iOS 15.0, *) else {
      invoke.reject("In-App Purchase requires iOS 15 or later")
      return
    }
    guard let productId = Self.string(fromRawArgs: invoke.getRawArgs(), key: "productId") else {
      invoke.reject("missing productId")
      return
    }
    Task {
      do {
        let products = try await Product.products(for: [productId])
        guard let product = products.first else {
          invoke.reject("product not found: \(productId)")
          return
        }
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
          switch verification {
          case .verified(let transaction):
            // Finish immediately. For auto-renewable subs the entitlement
            // stays queryable via the App Store Server API (backend
            // verify) and `currentEntitlements`, so finishing here only
            // clears the unfinished-transaction queue.
            await transaction.finish()
            invoke.resolve(
              PurchasePayload(
                productId: transaction.productID,
                platform: "ios",
                transactionId: String(transaction.id)
              ))
          case .unverified(_, let error):
            invoke.reject("could not verify purchase: \(error.localizedDescription)")
          }
        case .userCancelled:
          // Surfaced as Error::UserCancelled on the Rust side (string
          // match) so the UI stays silent instead of toasting.
          invoke.reject("user_cancelled")
        case .pending:
          invoke.reject("purchase is pending approval (Ask to Buy / SCA)")
        @unknown default:
          invoke.reject("unknown purchase result")
        }
      } catch {
        invoke.reject("purchase failed: \(error.localizedDescription)")
      }
    }
  }

  @objc public func restorePurchases(_ invoke: Invoke) throws {
    guard #available(iOS 15.0, *) else {
      invoke.resolve(PurchasesPayload(purchases: []))
      return
    }
    Task {
      // Explicit "Restore" tap → force a sync so revoked/renewed state is
      // fresh. Best-effort: `currentEntitlements` still answers from the
      // on-device receipt if the sync fails or is declined.
      try? await AppStore.sync()
      var restored: [PurchasePayload] = []
      for await result in Transaction.currentEntitlements {
        if case .verified(let transaction) = result {
          restored.append(
            PurchasePayload(
              productId: transaction.productID,
              platform: "ios",
              transactionId: String(transaction.id)
            ))
        }
      }
      invoke.resolve(PurchasesPayload(purchases: restored))
    }
  }
}

@_cdecl("init_plugin_iap")
func initPlugin() -> Plugin {
  return IapPlugin()
}
