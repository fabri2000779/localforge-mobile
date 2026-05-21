package gg.localforge.webauth

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/// Catches the `localforge://auth/callback?...` OAuth redirect fired by
/// Chrome Custom Tabs and hands it to the webauth plugin — WITHOUT ever
/// letting the VIEW intent reach Tauri's MainActivity.
///
/// Why a dedicated activity instead of MainActivity.onNewIntent:
/// tao 0.35.2 unconditionally calls `env.get_string(intent.getType()).unwrap()`
/// while processing any VIEW intent delivered to its NativeActivity
/// (ndk_glue.rs:511). A browser redirect carries no MIME type, so
/// getType() is null and the unwrap panics → SIGABRT. Routing the
/// redirect here keeps it off MainActivity entirely, so tao never sees
/// it and never crashes. (This is the same isolation AppAuth uses with
/// its RedirectUriReceiverActivity.)
///
/// Declared in this plugin's AndroidManifest.xml with the
/// localforge://auth intent-filter; the manifest merger folds it into
/// the app at build time, so no CI manifest patching is needed.
class RedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
    }

    // singleTask: a second redirect (or a re-entry) is delivered here
    // rather than spawning a new instance.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        intent?.data?.let { WebauthPlugin.deliverCallback(it.toString()) }
        // Bring the app's MainActivity back to the foreground (this also
        // dismisses the Custom Tab sitting on top of our task) and drop
        // this transient activity off the stack.
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(it)
        }
        finish()
    }
}
