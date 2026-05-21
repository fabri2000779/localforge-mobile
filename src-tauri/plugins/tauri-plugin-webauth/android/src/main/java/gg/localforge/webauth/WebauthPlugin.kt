package gg.localforge.webauth

import android.app.Activity
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

/// In-app OAuth via Chrome Custom Tabs.
///
/// IMPORTANT: the localforge://auth/callback redirect must NOT be routed
/// to Tauri's MainActivity — tao 0.35.2 panics processing any VIEW intent
/// whose getType() is null (ndk_glue.rs:511, `.unwrap()` on the null MIME
/// type), and a browser redirect has no MIME type. So a dedicated
/// `RedirectActivity` (declared in this plugin's manifest) catches the
/// redirect instead, hands the URL here via `deliverCallback`, and bounces
/// back to the app. tao never sees the intent → no crash.
@TauriPlugin
class WebauthPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        // The in-flight authenticate() call, resolved by RedirectActivity
        // once the OAuth redirect lands. @Volatile: written on the plugin
        // (binder) thread, read on the RedirectActivity (UI) thread.
        @Volatile
        private var pending: Invoke? = null

        fun deliverCallback(url: String) {
            val inv = pending ?: return
            pending = null
            val ret = JSObject()
            ret.put("url", url)
            inv.resolve(ret)
        }
    }

    @Command
    fun authenticate(invoke: Invoke) {
        val args = invoke.parseArgs(AuthArgs::class.java)
        // Only one auth at a time; cancel any stale one.
        pending?.reject("another sign-in is already in progress")
        pending = invoke
        activity.runOnUiThread {
            try {
                CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(args.url))
            } catch (e: Exception) {
                pending = null
                invoke.reject("failed to open browser: ${e.message}")
            }
        }
    }
}
