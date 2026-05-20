import Foundation
import StoreKit
import Tauri

// ─────────────────────────────────────────────────────────────────────────
// Why this plugin returns Encodable STRUCTS, never `[String: Any]` dicts.
//
// The release crash we chased for several builds
// (__swift_instantiateConcreteTypeFromMangledName, abort on the StoreKit
// dispatch queue — Swift SR-11564) was NOT in our code: it was in Tauri's
// own `Invoke.resolve(JsonObject)` path. That overload funnels into
// `JsonValue.jsonRepresentation()` → `prepare(dictionary:)`, which runs
// this on every value:
//
//     } else if let aDictionary = value as? JsonObject {   // [String: Any?]
//
// That `as? [String: Any?]` is a dynamic cast to a nested generic whose
// value type is `Optional<Any>`. To attempt it, the Swift runtime must
// instantiate `Dictionary<String, Optional<Any>>` metadata by mangled
// name; in our optimized/stripped static-library build that instantiation
// traps and, with panic=abort, kills the app the instant the IAP plugin
// resolves. It fires for ANY non-trivial dictionary payload, so neither
// the app-target DEAD_CODE_STRIPPING patch (the code lives in Tauri's SPM
// package) nor switching arg parsing to getArgs() could fix it.
//
// `Invoke.resolve<T: Encodable>(_:)` is a DIFFERENT overload: it calls
// `JSONEncoder().encode(data)` directly and never touches
// `prepare()`/`jsonRepresentation()`. Encoding a CONCRETE struct uses the
// compiler-synthesized witness (no runtime type-by-name lookup), so it
// sidesteps the trap entirely. Hence: every response below is a concrete
// Encodable struct, and we pass it straight to `invoke.resolve(_:)`.
//
// Property names are camelCase to match the serde `rename_all` contract on
// the Rust side (models.rs): Product {id,title,description,displayPrice}
// and PurchaseResult {productId,platform,transactionId}. The `plan` field
// is filled by guest-js from the id, so the native side omits it.
//
// Args are still read with `invoke.getArgs()` — that path coerces via
// JSONSerialization into Foundation types (NSArray/NSString/NSNumber) and
// only ever casts to those ObjC classes or to ubiquitous types like
// `[String]`, never to `[String: Any?]`, so it does not hit the trap.
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
  @objc public func getProducts(_ invoke: Invoke) throws {
    let args: JSObject = (try? invoke.getArgs()) ?? [:]
    let productIds = (args["productIds"] as? [String])
      ?? (args["productIds"] as? [Any])?.compactMap { $0 as? String }
      ?? []
    guard #available(iOS 15.0, *) else {
      invoke.reject("In-App Purchase requires iOS 15 or later")
      return
    }
    Task {
      do {
        // StoreKit silently drops unknown ids, so the caller can pass the
        // union of iOS+Android ids and we return only the ones that exist
        // in App Store Connect.
        let storeProducts = try await Product.products(for: productIds)
        let products = storeProducts.map { product in
          ProductPayload(
            id: product.id,
            title: product.displayName,
            description: product.description,
            displayPrice: product.displayPrice
          )
        }
        invoke.resolve(ProductsPayload(products: products))
      } catch {
        invoke.reject("failed to load products: \(error.localizedDescription)")
      }
    }
  }

  @objc public func purchase(_ invoke: Invoke) throws {
    let args: JSObject = (try? invoke.getArgs()) ?? [:]
    guard let productId = args["productId"] as? String else {
      invoke.reject("missing productId")
      return
    }
    guard #available(iOS 15.0, *) else {
      invoke.reject("In-App Purchase requires iOS 15 or later")
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
      invoke.reject("In-App Purchase requires iOS 15 or later")
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
