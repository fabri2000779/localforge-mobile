import Foundation
import Tauri
import UIKit
import WebKit

// Native iOS tab bar overlaid on the Tauri webview. On iOS 26 the system
// UITabBar renders with the Liquid Glass material automatically (it's the
// same component WhatsApp/Slack use), so we don't hand-roll any blur.
//
// Defensive patterns carried over from tauri-plugin-iap / -webauth:
//   * read args via getRawArgs() + JSONSerialization (NOT parseArgs/getArgs),
//   * resolve a concrete Encodable struct (never the prepare() dict path),
//   * the whole target is built -Onone (see ../Package.swift).

/// `{ "ok": true }` returned to Rust for the fire-and-forget commands.
struct OkResponse: Encodable {
  let ok: Bool
}

class GlassTabBarPlugin: Plugin, UITabBarDelegate {
  // Retained for the lifetime of the bar.
  private var tabBar: UITabBar?
  // Maps a UITabBarItem.tag (its index) → the JS tab id.
  private var itemIds: [String] = []

  /// `{ items: [{id,label,sfSymbol}], selected?: string }` → mount/replace
  /// the native bar.
  @objc public func showBar(_ invoke: Invoke) throws {
    let raw = invoke.getRawArgs()
    guard let data = raw.data(using: .utf8),
      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let items = obj["items"] as? [[String: Any]]
    else {
      invoke.reject("missing items")
      return
    }
    let selected = obj["selected"] as? String
    DispatchQueue.main.async {
      self.install(items: items, selected: selected)
      invoke.resolve(OkResponse(ok: true))
    }
  }

  /// `{ id: string }` → move the highlight (used when JS navigates tabs
  /// programmatically, e.g. a deep link).
  @objc public func setSelected(_ invoke: Invoke) throws {
    let raw = invoke.getRawArgs()
    let id =
      ((try? JSONSerialization.jsonObject(with: raw.data(using: .utf8) ?? Data()))
        as? [String: Any])?["id"] as? String
    DispatchQueue.main.async {
      if let id = id, let idx = self.itemIds.firstIndex(of: id),
        let items = self.tabBar?.items, idx < items.count
      {
        self.tabBar?.selectedItem = items[idx]
      }
      invoke.resolve(OkResponse(ok: true))
    }
  }

  @objc public func hideBar(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      self.tabBar?.removeFromSuperview()
      self.tabBar = nil
      invoke.resolve(OkResponse(ok: true))
    }
  }

  // The app's key window — the same anchor the webauth plugin uses.
  private func keyWindow() -> UIWindow? {
    for scene in UIApplication.shared.connectedScenes {
      if let ws = scene as? UIWindowScene {
        if let key = ws.windows.first(where: { $0.isKeyWindow }) { return key }
        if let first = ws.windows.first { return first }
      }
    }
    return nil
  }

  private func install(items: [[String: Any]], selected: String?) {
    guard let window = keyWindow() else { return }
    self.tabBar?.removeFromSuperview()

    let tb = UITabBar()
    tb.translatesAutoresizingMaskIntoConstraints = false
    tb.delegate = self

    var barItems: [UITabBarItem] = []
    var ids: [String] = []
    for (i, it) in items.enumerated() {
      let label = it["label"] as? String
      let symbol = (it["sfSymbol"] as? String) ?? "circle"
      let id = (it["id"] as? String) ?? String(i)
      let item = UITabBarItem(title: label, image: UIImage(systemName: symbol), tag: i)
      barItems.append(item)
      ids.append(id)
    }
    tb.setItems(barItems, animated: false)
    self.itemIds = ids
    if let sel = selected, let idx = ids.firstIndex(of: sel), idx < barItems.count {
      tb.selectedItem = barItems[idx]
    } else {
      tb.selectedItem = barItems.first
    }

    // Pin to the bottom edge; UITabBar extends itself over the home
    // indicator and adds the safe-area inset to its own content.
    window.addSubview(tb)
    NSLayoutConstraint.activate([
      tb.leadingAnchor.constraint(equalTo: window.leadingAnchor),
      tb.trailingAnchor.constraint(equalTo: window.trailingAnchor),
      tb.bottomAnchor.constraint(equalTo: window.bottomAnchor),
    ])
    self.tabBar = tb
  }

  // Tap → tell JS which tab. JS owns the content switch + hides the CSS bar.
  // TWO delivery paths, because the Tauri plugin-event path is unverified on
  // this app's Tauri version (the IAP/webauth plugins are request/response
  // only). Either one switching the tab is enough; selectTab is idempotent.
  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    let idx = item.tag
    guard idx >= 0 && idx < itemIds.count else { return }
    let id = itemIds[idx]
    // Path 1: the documented plugin event (addPluginListener on the JS side).
    self.trigger("select", data: ["id": id])
    // Path 2: call a JS global straight through the WebView. `id` is one of
    // our own fixed ids (servers/machines/team/account) — no injection risk.
    if let window = keyWindow(), let webView = Self.findWebView(in: window) {
      let js = "window.__lfNativeTabSelect && window.__lfNativeTabSelect('\(id)')"
      webView.evaluateJavaScript(js, completionHandler: nil)
    }
  }

  private static func findWebView(in view: UIView) -> WKWebView? {
    if let wv = view as? WKWebView { return wv }
    for sub in view.subviews {
      if let found = findWebView(in: sub) { return found }
    }
    return nil
  }
}

@_cdecl("init_plugin_glasstabbar")
func initPlugin() -> Plugin {
  return GlassTabBarPlugin()
}
