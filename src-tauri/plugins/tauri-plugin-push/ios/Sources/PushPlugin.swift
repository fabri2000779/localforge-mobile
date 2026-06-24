// LocalForge remote-push plugin (iOS / APNs).
//
// Flow:
//   register()  → request UNUserNotificationCenter authorization, then
//                 UIApplication.registerForRemoteNotifications(). The APNs
//                 device token arrives asynchronously in
//                 didRegisterForRemoteNotificationsWithDeviceToken; we resolve
//                 the stored Invoke there with { platform:"ios", token:<hex> }.
//   tap         → didReceive (UNUserNotificationCenterDelegate) pulls the
//                 opaque server id out of the push payload (aps + lf:{srv})
//                 and fires the "openServer" plugin event to JS.
//
// ⚠️ VERIFY-ON-DEVICE: three Tauri-iOS-API touchpoints can't be checked on a
// Windows host (no Xcode / no generated tauri-api package):
//   (1) that the Tauri AppDelegate FORWARDS
//       application(_:didRegisterForRemoteNotificationsWithDeviceToken:) to
//       plugins (so this override actually fires). If it doesn't, the token
//       must instead be captured in the generated AppDelegate + handed over.
//   (2) the exact event-emit method name (`trigger(_:data:)` here).
//   (3) Invoke.resolve / reject signatures (mirrored from IapPlugin).
// Also requires the "Push Notifications" capability (aps-environment
// entitlement) on the App ID + a provisioning profile that includes it.

import Foundation
import Tauri
import UIKit
import UserNotifications
import WebKit  // WKWebView — the Plugin.load(webview:) override parameter type

class PushPlugin: Plugin, UNUserNotificationCenterDelegate {
    // The in-flight register() call, resolved once APNs hands us a token
    // (or rejected if registration fails / permission is denied).
    private var pendingRegister: Invoke?

    public override func load(webview: WKWebView) {
        // Become the notification-center delegate so taps route through us.
        UNUserNotificationCenter.current().delegate = self

        // Cold-start case: if the app was LAUNCHED by tapping a push, the
        // delegate isn't set in time to catch didReceive, so the launch
        // payload would be lost. UNUserNotificationCenter replays the
        // response to the delegate once set, so the willPresent/didReceive
        // path below still covers it on modern iOS.
    }

    @objc public func register(_ invoke: Invoke) throws {
        self.pendingRegister = invoke
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, error in
            guard let self = self else { return }
            if let error = error {
                self.failRegister("push: \(error.localizedDescription)")
                return
            }
            if !granted {
                self.failRegister("denied")
                return
            }
            // registerForRemoteNotifications MUST be called on the main thread.
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    // MARK: - APNs callbacks (forwarded by the Tauri AppDelegate — see VERIFY)

    @objc public func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        pendingRegister?.resolve(["platform": "ios", "token": token])
        pendingRegister = nil
    }

    @objc public func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        failRegister("push: \(error.localizedDescription)")
    }

    private func failRegister(_ message: String) {
        pendingRegister?.reject(message)
        pendingRegister = nil
    }

    // MARK: - UNUserNotificationCenterDelegate (taps + foreground)

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        emitOpenServer(from: response.notification.request.content.userInfo)
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show crash alerts even when the app is foregrounded.
        completionHandler([.banner, .sound])
    }

    /// Pull the opaque server id out of the push payload and fire the
    /// "openServer" event the React layer listens for. Payload shape (set by
    /// the cloud, lib/push.ts): { aps: {...}, lf: { org, srv, evt } }.
    private func emitOpenServer(from userInfo: [AnyHashable: Any]) {
        guard let lf = userInfo["lf"] as? [String: Any],
              let srv = lf["srv"] as? String,
              !srv.isEmpty
        else { return }
        // VERIFY: event-emit API name on device.
        trigger("openServer", data: ["serverId": srv])
    }

    // MARK: - Quick Actions (home-screen shortcuts)

    struct QuickActionItem: Decodable {
        let serverId: String
        let label: String
    }
    struct SetQuickActionsArgs: Decodable {
        let items: [QuickActionItem]
    }

    @objc public func setQuickActions(_ invoke: Invoke) throws {
        // VERIFY: invoke.parseArgs / invoke.resolve signatures on device.
        let args = try invoke.parseArgs(SetQuickActionsArgs.self)
        // iOS surfaces up to ~4 shortcuts; keep the most relevant.
        let items = args.items.prefix(4).map { item -> UIApplicationShortcutItem in
            UIApplicationShortcutItem(
                type: "openServer",
                localizedTitle: item.label,
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: "server.rack"),
                userInfo: ["serverId": item.serverId as NSString]
            )
        }
        DispatchQueue.main.async {
            UIApplication.shared.shortcutItems = items
        }
        invoke.resolve()
    }

    // Forwarded by the Tauri AppDelegate when a home-screen Quick Action is
    // tapped. ⚠️ VERIFY-ON-DEVICE that Tauri forwards this delegate method.
    @objc public func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        if let srv = shortcutItem.userInfo?["serverId"] as? String, !srv.isEmpty {
            trigger("openServer", data: ["serverId": srv])
            completionHandler(true)
        } else {
            completionHandler(false)
        }
    }
}

@_cdecl("init_plugin_push")
func initPlugin() -> Plugin {
    return PushPlugin()
}
