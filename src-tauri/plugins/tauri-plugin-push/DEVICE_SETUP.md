# tauri-plugin-push — device-session checklist

The Rust + JS layers of this plugin are written and compile-verified
(`cargo check` + `tsc` both green). The **native Swift/Kotlin and the
build/credential config below could NOT be verified on the Windows dev host**
(no Xcode / Android toolchain / device, and the iOS/Android projects are
generated at build time). This is the exact list to make push + Quick Actions
live, to be done in a session with a Mac/Xcode + Android Studio + a real device.

## iOS (APNs)

1. **App ID capability:** in the Apple Developer portal, enable **Push
   Notifications** on `com.localforge.mobile`, and regenerate the provisioning
   profile so it carries `aps-environment`.
2. **Entitlement:** the generated Xcode app target needs an
   `aps-environment` entitlement (`development` for TestFlight, `production`
   for the App Store). Inject it post-`tauri ios init` (an `ios-overrides` /
   entitlements patch in `.github/workflows/ios.yml`) — the existing
   `XCODE_XCCONFIG_FILE` step is the place to extend.
3. **Verify the 3 `VERIFY-ON-DEVICE` touchpoints** in `ios/Sources/PushPlugin.swift`:
   - that the Tauri AppDelegate forwards
     `didRegisterForRemoteNotificationsWithDeviceToken` + `performActionFor` to
     the plugin (if not, capture them in the generated AppDelegate and forward);
   - the event-emit API (`trigger(_:data:)`);
   - `Invoke.parseArgs` / `resolve` signatures (cross-check against `IapPlugin.swift`).
4. **Backend is ready:** APNs secrets are set + verified (the `.p8` imports +
   ES256-signs); the cloud sends to `api.push.apple.com` (production). For a
   TestFlight (sandbox-token) test, add a sandbox-host fallback in the cloud
   `lib/push.ts` (1-line host swap).

## Android (FCM)

1. **Firebase project** `localforge-2b1e1` already exists (service account set
   + verified live: OAuth round-trip returned a token). Add the **Android app**
   (`gg.localforge.mobile`) to it and download **`google-services.json`**.
2. **Wire Firebase into the generated project:** after `tauri android init`,
   run `node scripts/patch-android-firebase.cjs src-tauri/gen/android <google-services.json>`
   (provide the json from a CI secret). Verify the Gradle plugin-DSL shape
   against the actual generated `build.gradle.kts` (see the script's VERIFY note).
3. **Verify the `VERIFY-ON-DEVICE` touchpoints** in
   `android/.../PushPlugin.kt`: the Tauri Android Plugin API surface
   (`load(webView)` / `onNewIntent` / `trigger`, `@Command`/`@InvokeArg`,
   `JSObject`) against `IapPlugin.kt`, and the FCM data→intent-extras mapping.

## What already works without a device (verified here)

- Cloud delivery (real APNs/FCM send), `/v1/push/register`, `/v1/push/notify`
  (hardened: operator role + rate limit + server-in-org check) — deployed.
- The desktop crash→notify trigger (journal-based).
- The app layer: `cloud_push_register`, the `open-server` deep-link routing,
  the pending-open replay (cold-start safe), and the Quick Actions wiring
  (Android shortcuts reuse the existing `localforge://server?id=` deep link).

## End-to-end test (on device)

1. Sign in on the device → app calls `register()` → cloud stores the token
   (`GET /v1/push/tokens` shows 1).
2. Crash a server on the owner's desktop → desktop hits `/v1/push/notify` →
   the device gets a generic "A server crashed" notification.
3. Tap it → the app deep-links to that server's detail.
4. Long-press the app icon → Quick Actions list the top servers → tap → same.
