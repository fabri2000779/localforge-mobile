// LocalForge Restore Credentials plugin (Android) — Zero-Tap Sign-In.
//
// Bridges androidx.credentials' Restore Credential API: `create` stores a WebAuthn key in Block
// Store (backed up with the user's Google backup), `get` signs the cloud's challenge with it on the
// next device, `clear` drops it on sign-out. The Rust auth module drives these and does the cloud
// round-trips; nothing here touches the network.
package gg.localforge.restorecred

import android.app.Activity
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreateRestoreCredentialRequest
import androidx.credentials.CreateRestoreCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetRestoreCredentialOption
import androidx.credentials.RestoreCredential
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.exceptions.restorecredential.E2eeUnavailableException
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class JsonArgs {
    lateinit var requestJson: String
}

@TauriPlugin
class RestoreCredPlugin(private val activity: Activity) : Plugin(activity) {
    private val credentialManager: CredentialManager by lazy { CredentialManager.create(activity) }
    private val executor get() = ContextCompat.getMainExecutor(activity)

    // Restore Credentials need Android 9+ (plus Play services); older devices report `unsupported`.
    private fun supported() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P

    /// { requestJson: PublicKeyCredentialCreationOptionsJSON } → { responseJson }
    @Command
    fun create(invoke: Invoke) {
        if (!supported()) {
            invoke.reject("unsupported")
            return
        }
        val args = invoke.parseArgs(JsonArgs::class.java)
        createWith(invoke, args.requestJson, cloudBackup = true)
    }

    private fun createWith(invoke: Invoke, requestJson: String, cloudBackup: Boolean) {
        val request = CreateRestoreCredentialRequest(requestJson, cloudBackup)
        credentialManager.createCredentialAsync(
            activity, request, null, executor,
            object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
                override fun onResult(result: CreateCredentialResponse) {
                    val json = (result as? CreateRestoreCredentialResponse)?.responseJson
                    if (json == null) {
                        invoke.reject("unexpected credential response type")
                        return
                    }
                    val ret = JSObject()
                    ret.put("responseJson", json)
                    invoke.resolve(ret)
                }

                override fun onError(e: CreateCredentialException) {
                    // No end-to-end-encrypted backup on this device (no screen lock / backup off):
                    // keep the key local-only, as the docs prescribe.
                    if (cloudBackup && e is E2eeUnavailableException) {
                        createWith(invoke, requestJson, cloudBackup = false)
                        return
                    }
                    invoke.reject("restore credential create failed: ${e.message ?: e.type}")
                }
            },
        )
    }

    /// { requestJson: PublicKeyCredentialRequestOptionsJSON } → { responseJson } or {} when the
    /// device holds no restore credential.
    @Command
    fun get(invoke: Invoke) {
        if (!supported()) {
            invoke.reject("unsupported")
            return
        }
        val args = invoke.parseArgs(JsonArgs::class.java)
        val request = GetCredentialRequest(listOf(GetRestoreCredentialOption(args.requestJson)))
        credentialManager.getCredentialAsync(
            activity, request, null, executor,
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val ret = JSObject()
                    (result.credential as? RestoreCredential)?.let { ret.put("responseJson", it.authenticationResponseJson) }
                    invoke.resolve(ret)
                }

                override fun onError(e: GetCredentialException) {
                    if (e is NoCredentialException) {
                        invoke.resolve(JSObject())
                        return
                    }
                    invoke.reject("restore credential get failed: ${e.message ?: e.type}")
                }
            },
        )
    }

    @Command
    fun clear(invoke: Invoke) {
        if (!supported()) {
            invoke.resolve()
            return
        }
        val request = ClearCredentialStateRequest(ClearCredentialStateRequest.TYPE_CLEAR_RESTORE_CREDENTIAL)
        credentialManager.clearCredentialStateAsync(
            request, null, executor,
            object : CredentialManagerCallback<Void?, ClearCredentialException> {
                override fun onResult(result: Void?) {
                    invoke.resolve()
                }

                override fun onError(e: ClearCredentialException) {
                    invoke.reject("restore credential clear failed: ${e.message ?: e.type}")
                }
            },
        )
    }
}
