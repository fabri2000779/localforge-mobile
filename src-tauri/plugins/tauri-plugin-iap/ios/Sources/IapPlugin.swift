import Foundation
import StoreKit
import Tauri

// ─────────────────────────────────────────────────────────────────────────
// Crash-avoidance notes (Swift SR-11564 —
// __swift_instantiateConcreteTypeFromMangledName aborts the instant a
// plugin command runs in release).
//
// The SYMBOLICATED v0.2.16 crash was:
//     __swift_instantiateConcreteTypeFromMangledNameV2
//     IapPlugin.getProducts(_:)            ← NOT "specialized" anymore
// i.e. it still trapped even with the target forced to -Onone. So it is
// NOT an optimizer/stripping problem. The real cause: getProducts touched
// StoreKit 2 types (`Product`, `Transaction`) which are gated behind
// `@available(iOS 15, *)`. Referenced from a method that is itself NOT
// `@available`-annotated (it can't be — Tauri invokes it via @objc), the
// compiler can't statically prove the type exists, so it emits a RUNTIME
// metadata accessor (`instantiateConcreteTypeFromMangledName`) — and that
// runtime demangle traps.
//
// THE FIX: every StoreKit-touching line lives in `StoreKitBridge`, an
// `@available(iOS 15.0, *)` enum. Inside an availability-annotated scope
// the compiler KNOWS the types exist and emits DIRECT metadata references,
// so no runtime instantiation, no trap. The @objc IapPlugin methods only
// do the `#available` check + arg parsing, then delegate. They contain ZERO
// StoreKit type references.
//
// Belt-and-suspenders kept from earlier iterations:
//   • Responses are concrete Encodable structs → Tauri's
//     `resolve<T: Encodable>` overload (concrete type ⇒ witness passed
//     directly, no runtime lookup) instead of `resolve(JsonObject)` →
//     `prepare()`'s `as? [String: Any?]` cast.
//   • Args read via `getRawArgs()` + JSONSerialization (ubiquitous
//     `[String: Any]`/`[String]`), never `getArgs()`'s `[String: JSValue]`.
//   • getProducts never `reject()`s (reject runs through Tauri's prepare()
//     which we don't control); it resolves an empty list on error.
//   • Package.swift forces this target to -Onone.
//
// Field names are camelCase to match the serde `rename_all` in models.rs.
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

/// All StoreKit 2 usage is quarantined here, behind a single
/// `@available(iOS 15.0, *)`. That makes the compiler emit DIRECT type
/// metadata for `Product`/`Transaction` instead of the runtime
/// mangled-name accessor that was trapping when these types were touched
/// from the non-availability-annotated @objc plugin methods.
@available(iOS 15.0, *)
enum StoreKitBridge {
  static func getProducts(_ productIds: [String], _ invoke: Invoke) {
    Task {
      // StoreKit silently drops unknown ids, so the caller can pass the
      // union of iOS+Android ids and we return only the ones that exist in
      // App Store Connect. On error resolve an empty list (never reject) so
      // the paywall degrades to "no plans" instead of crashing.
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

  static func purchase(_ productId: String, _ invoke: Invoke) {
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
            // stays queryable via the App Store Server API (backend verify)
            // and `currentEntitlements`, so finishing here only clears the
            // unfinished-transaction queue.
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
          // Surfaced as Error::UserCancelled on the Rust side (string match)
          // so the UI stays silent instead of toasting.
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

  static func restore(_ invoke: Invoke) {
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

/// StoreKit 2 bridge. The @objc methods are thin: availability gate + arg
/// parse + delegate to `StoreKitBridge`. They touch NO StoreKit types, so
/// the compiler never emits a runtime type-metadata accessor for them.
///
/// Scope is deliberately thin: returns the store's product list and the
/// receipt handle (StoreKit `transaction.id`) for a completed purchase.
/// Entitlement granting lives on the backend, which re-checks every
/// transaction id against the App Store Server API — the client is never
/// trusted to assert "I paid".
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

  // MARK: - Commands (thin: gate + parse + delegate)

  @objc public func getProducts(_ invoke: Invoke) throws {
    guard #available(iOS 15.0, *) else {
      invoke.resolve(ProductsPayload(products: []))
      return
    }
    let productIds = Self.stringArray(fromRawArgs: invoke.getRawArgs(), key: "productIds")
    StoreKitBridge.getProducts(productIds, invoke)
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
    StoreKitBridge.purchase(productId, invoke)
  }

  @objc public func restorePurchases(_ invoke: Invoke) throws {
    guard #available(iOS 15.0, *) else {
      invoke.resolve(PurchasesPayload(purchases: []))
      return
    }
    StoreKitBridge.restore(invoke)
  }
}

@_cdecl("init_plugin_iap")
func initPlugin() -> Plugin {
  return IapPlugin()
}
