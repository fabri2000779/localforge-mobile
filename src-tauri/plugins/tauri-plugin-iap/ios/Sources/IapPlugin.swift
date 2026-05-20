import Foundation
import StoreKit
import Tauri

// Args mirror the camelCase payloads the Rust bridge sends. JSONDecoder
// matches keys verbatim, so property names must equal the wire names.
class GetProductsArgs: Decodable {
  let productIds: [String]
}

class PurchaseArgs: Decodable {
  let productId: String
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
    let args = try invoke.parseArgs(GetProductsArgs.self)
    guard #available(iOS 15.0, *) else {
      invoke.reject("In-App Purchase requires iOS 15 or later")
      return
    }
    Task {
      do {
        // StoreKit silently drops unknown ids, so the caller can pass the
        // union of iOS+Android ids and we return only the ones that exist
        // in App Store Connect.
        let storeProducts = try await Product.products(for: args.productIds)
        let payload: [[String: Any]] = storeProducts.map { product in
          [
            "id": product.id,
            "title": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
          ]
        }
        invoke.resolve(["products": payload])
      } catch {
        invoke.reject("failed to load products: \(error.localizedDescription)")
      }
    }
  }

  @objc public func purchase(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PurchaseArgs.self)
    guard #available(iOS 15.0, *) else {
      invoke.reject("In-App Purchase requires iOS 15 or later")
      return
    }
    Task {
      do {
        let products = try await Product.products(for: [args.productId])
        guard let product = products.first else {
          invoke.reject("product not found: \(args.productId)")
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
            invoke.resolve([
              "productId": transaction.productID,
              "platform": "ios",
              "transactionId": String(transaction.id),
            ])
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
      var restored: [[String: Any]] = []
      for await result in Transaction.currentEntitlements {
        if case .verified(let transaction) = result {
          restored.append([
            "productId": transaction.productID,
            "platform": "ios",
            "transactionId": String(transaction.id),
          ])
        }
      }
      invoke.resolve(["purchases": restored])
    }
  }
}

@_cdecl("init_plugin_iap")
func initPlugin() -> Plugin {
  return IapPlugin()
}
