// LocalForge remote-push plugin (Android / FCM).
//
// Flow:
//   register() → (Android 13+) request POST_NOTIFICATIONS, then fetch the FCM
//                device token and resolve { platform:"android", token }.
//   tap        → the system tray notification opens the launcher activity with
//                the FCM `data` payload (org/srv/evt) as intent extras; we pull
//                `srv` and fire the "openServer" event the React layer listens
//                for. Handled both at load() (cold launch) and onNewIntent()
//                (warm, singleTask — already set by patch-android-manifest.cjs).
//
// ⚠️ VERIFY-ON-DEVICE (no Android toolchain on this host):
//   (1) FirebaseMessaging.getInstance() requires Firebase init — the app must
//       carry google-services.json + apply the google-services Gradle plugin
//       (injected by scripts/patch-android-firebase.cjs in CI).
//   (2) Tauri Android Plugin API surface (load(webView)/onNewIntent/trigger,
//       JSObject, @Command/@TauriPlugin) — mirrored from IapPlugin.kt.
//   (3) the FCM data→intent-extras mapping on tap.

package gg.localforge.push

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging

@InvokeArg
class QuickActionItem {
    lateinit var serverId: String
    lateinit var label: String
}

@InvokeArg
class SetQuickActionsArgs {
    var items: List<QuickActionItem> = emptyList()
}

@TauriPlugin
class PushPlugin(private val activity: Activity) : Plugin(activity) {

    override fun load(webView: WebView) {
        super.load(webView)
        // The app may have been COLD-LAUNCHED by tapping a notification.
        handleIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Warm path: singleTask activity receives the tap here.
        handleIntent(intent)
    }

    @Command
    fun register(invoke: Invoke) {
        // Android 13+ needs POST_NOTIFICATIONS to DISPLAY notifications.
        // Best-effort request; the token fetch proceeds either way (a denied
        // permission only suppresses display, not token delivery).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0
                )
            }
        }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful || task.result == null) {
                invoke.reject("push: ${task.exception?.localizedMessage ?: "no FCM token"}")
                return@addOnCompleteListener
            }
            val res = JSObject()
            res.put("platform", "android")
            res.put("token", task.result)
            invoke.resolve(res)
        }
    }

    private fun handleIntent(intent: Intent?) {
        val srv = intent?.getStringExtra("srv") ?: return
        if (srv.isEmpty()) return
        val data = JSObject()
        data.put("serverId", srv)
        // VERIFY: event-emit API name on device.
        trigger("openServer", data)
    }

    @Command
    fun setQuickActions(invoke: Invoke) {
        val args = invoke.parseArgs(SetQuickActionsArgs::class.java)
        // Each shortcut fires a VIEW intent at localforge://server?id=<id>,
        // which the existing tauri-plugin-deep-link handler routes to the
        // `cloud://open-server` event — no separate tap handling needed here.
        val shortcuts = args.items.take(4).map { item ->
            val intent = Intent(
                Intent.ACTION_VIEW,
                Uri.parse("localforge://server?id=${Uri.encode(item.serverId)}"),
            ).setPackage(activity.packageName)
            ShortcutInfoCompat.Builder(activity, "server_${item.serverId}")
                .setShortLabel(item.label)
                .setLongLabel(item.label)
                .setIntent(intent)
                .build()
        }
        ShortcutManagerCompat.setDynamicShortcuts(activity, shortcuts)
        invoke.resolve()
    }
}
