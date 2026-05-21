import AuthenticationServices
import Foundation
import Tauri
import UIKit

// Defensive patterns carried over from tauri-plugin-iap (Swift SR-11564):
//   * read args via getRawArgs() + JSONSerialization, NOT parseArgs/getArgs
//     (those instantiate exotic type metadata that can trap in release),
//   * resolve a concrete Encodable struct (binds resolve<T: Encodable>,
//     never Tauri's prepare() dict path),
//   * the whole target is built -Onone (see ../Package.swift).

/// `{ "url": "<callback url>" }` returned to Rust.
struct CallbackResponse: Encodable {
  let url: String
}

/// Presents the OAuth provider's page in ASWebAuthenticationSession — an
/// in-app Safari that captures the `scheme://…` redirect WITHOUT a
/// deep-link round-trip. The user never leaves the app.
class WebauthPlugin: Plugin, ASWebAuthenticationPresentationContextProviding {
  // Must be retained for the lifetime of the session, or it deallocates
  // and the sheet never appears.
  private var session: ASWebAuthenticationSession?

  @objc public func authenticate(_ invoke: Invoke) throws {
    let raw = invoke.getRawArgs()
    guard let data = raw.data(using: .utf8),
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let urlStr = obj["url"] as? String,
      let url = URL(string: urlStr),
      let scheme = obj["scheme"] as? String
    else {
      invoke.reject("missing url/scheme")
      return
    }

    let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) {
      callbackURL, error in
      if let error = error {
        let nsErr = error as NSError
        // User tapped Cancel on the consent sheet → stay silent.
        if nsErr.domain == ASWebAuthenticationSessionErrorDomain
          && nsErr.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
        {
          invoke.reject("user_cancelled")
        } else {
          invoke.reject("auth failed: \(error.localizedDescription)")
        }
        return
      }
      guard let callbackURL = callbackURL else {
        invoke.reject("no callback url")
        return
      }
      invoke.resolve(CallbackResponse(url: callbackURL.absoluteString))
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = false
    self.session = session
    DispatchQueue.main.async {
      if !session.start() {
        invoke.reject("could not start the sign-in session")
      }
    }
  }

  // Anchor the auth sheet on the app's key window.
  public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    for scene in UIApplication.shared.connectedScenes {
      if let ws = scene as? UIWindowScene {
        if let key = ws.windows.first(where: { $0.isKeyWindow }) { return key }
        if let first = ws.windows.first { return first }
      }
    }
    return ASPresentationAnchor()
  }
}

@_cdecl("init_plugin_webauth")
func initPlugin() -> Plugin {
  return WebauthPlugin()
}
