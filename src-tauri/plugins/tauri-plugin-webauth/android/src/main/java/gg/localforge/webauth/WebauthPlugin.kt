package gg.localforge.webauth

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class AuthArgs {
    lateinit var url: String
    lateinit var scheme: String
}

/// In-app OAuth via Chrome Custom Tabs. Unlike the old external-browser
/// flow, the Custom Tab runs INSIDE the app's task, so the
/// `scheme://auth/callback` redirect comes back to the WARM activity via
/// onNewIntent — no cold-start, which is what crashed the old flow.
///
/// `authenticate()` stashes the in-flight Invoke, opens the tab, and
/// resolves once onNewIntent sees the matching custom-scheme redirect.
/// The redirect only reaches us because the app's MainActivity carries an
/// intent-filter for the `localforge` scheme (added to the generated
/// AndroidManifest in CI).
@TauriPlugin
class WebauthPlugin(private val activity: Activity) : Plugin(activity) {
    private var pending: Invoke? = null
    private var scheme: String = ""

    @Command
    fun authenticate(invoke: Invoke) {
        val args = invoke.parseArgs(AuthArgs::class.java)
        // Only one auth at a time; cancel any stale one.
        pending?.reject("another sign-in is already in progress")
        pending = invoke
        scheme = args.scheme
        activity.runOnUiThread {
            try {
                CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(args.url))
            } catch (e: Exception) {
                pending = null
                invoke.reject("failed to open browser: ${e.message}")
            }
        }
    }

    // Fired when the OS routes the `scheme://…` redirect back to the
    // (warm) MainActivity. Tauri forwards new intents to every plugin.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val data = intent.data ?: return
        if (data.scheme != scheme) return // not our redirect — ignore
        val inv = pending ?: return
        pending = null
        val ret = JSObject()
        ret.put("url", data.toString())
        inv.resolve(ret)
    }
}
