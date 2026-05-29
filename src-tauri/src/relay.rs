//! Mobile relay WebSocket client.
//!
//! Stays connected to `wss://api.localforge.gg/v1/relay/<orgId>` for
//! as long as the user has a paid plan + the screen calling
//! `cloud_relay_start` is mounted. Surfaces every server-side message
//! to React via Tauri events. Mobile is observation-only — it sends
//! commands to the owner (start, stop, list_state) and listens for
//! events back; it never processes incoming `cmd` messages because
//! only the owner's desktop executes those.
//!
//! Events emitted to JS:
//!
//!   cloud://relay-connected       fresh connection established
//!   cloud://relay-disconnected    dropped, will retry with backoff
//!   cloud://relay-hello           initial hello frame (role + peers)
//!   cloud://relay-event           any `event` frame from the owner
//!   cloud://relay-presence        peer joined / left
//!   cloud://relay-error           server-side rejection
//!
//! Reconnect: 250ms → 30s with ±20% jitter, same shape as the desktop
//! so a cloud-side restart is invisible to the user.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

use localforge_cloud_client::api::{self, ApiError};
use localforge_cloud_client::api_origin;
use localforge_cloud_client::relay::ws_host;

#[derive(Default)]
pub struct RelayState {
    /// Cancellation handle for the active connect-loop. Replaced on
    /// every start so we never accumulate ghost loops if the React
    /// layer mounts the ServerListScreen twice without unmounting.
    cancel: Mutex<Option<oneshot::Sender<()>>>,
    /// Sender side of the outbound channel. Tauri commands push
    /// serialised JSON here; the loop drains into the WS.
    outbound: Mutex<Option<mpsc::UnboundedSender<String>>>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cloud_relay_start(
    app: AppHandle,
    state: tauri::State<'_, Arc<RelayState>>,
    org_id: Option<String>,
) -> Result<(), String> {
    // Replace any prior loop. A clean shutdown of the previous one
    // prevents the "two WS connections, both bound to the same
    // emitter, each duplicating every event" footgun.
    {
        let mut guard = state.cancel.lock().await;
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }

    let token = crate::auth::load_token(&app).ok_or_else(|| "unauthenticated".to_string())?;
    // Connect to the chosen ACTIVE org (a sub-user observing the owner's org)
    // when given; else the caller's primary org. Mirrors the desktop.
    let org_id = match org_id {
        Some(id) if !id.is_empty() => id,
        _ => fetch_org_id(&token)
            .await
            .map_err(|e| format!("fetch org: {e}"))?,
    };

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    {
        let mut cguard = state.cancel.lock().await;
        *cguard = Some(cancel_tx);
        let mut oguard = state.outbound.lock().await;
        *oguard = Some(out_tx);
    }

    let app_for_loop = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut backoff = Backoff::new();
        // Build the relay's TLS connector once; reused on every reconnect.
        let connector = relay_tls_connector();

        loop {
            // Stop signal? Wrap try_recv in a match because oneshot
            // returns Err(Empty) when nothing's been sent, which is
            // the common case here.
            if cancel_rx.try_recv().is_ok() {
                return;
            }

            // Token may have been cleared mid-flight (user logged out).
            // The loop just dies in that case; React's logout path
            // already calls cloud_relay_stop too, but defence-in-depth.
            let token = match crate::auth::load_token(&app_for_loop) {
                Some(t) => t,
                None => {
                    tracing::info!("[relay] no token; bailing out");
                    return;
                }
            };

            let origin = api_origin();
            let host = ws_host(&origin);
            let url = format!(
                "wss://{}/v1/relay/{}?token={}",
                host,
                org_id,
                urlencoded(&token),
            );

            // Staged, time-boxed connect (see `connect_relay`). The
            // one-shot `connect_async_tls_with_config` hung forever on
            // mobile — `[relay] connecting` logged, then silence: no
            // error, no success, no timeout. `connect_relay` bounds each
            // stage so a stuck path errors + retries, and logs which
            // stage (DNS / TCP / TLS+upgrade) stalls.
            match connect_relay(&url, &host, &connector).await {
                Ok(mut ws) => {
                    backoff.reset();
                    let _ = app_for_loop.emit("cloud://relay-connected", ());

                    // Multiplex three things: cancellation, outbound
                    // messages queued by Tauri commands, inbound WS
                    // frames. `biased` so cancellation wins ties.
                    loop {
                        tokio::select! {
                            biased;
                            _ = &mut cancel_rx => {
                                let _ = ws.send(Message::Close(None)).await;
                                return;
                            }
                            outbound = out_rx.recv() => match outbound {
                                Some(text) => {
                                    if ws.send(Message::Text(text.into())).await.is_err() {
                                        tracing::warn!("[relay] send failed; reconnecting");
                                        break;
                                    }
                                }
                                None => return,    // channel closed
                            },
                            frame = ws.next() => match frame {
                                Some(Ok(Message::Text(txt))) => {
                                    handle_text(&app_for_loop, &txt);
                                }
                                Some(Ok(Message::Ping(p))) => {
                                    let _ = ws.send(Message::Pong(p)).await;
                                }
                                Some(Ok(_)) => { /* ignore binary / pong */ }
                                Some(Err(e)) => {
                                    tracing::warn!("[relay] frame err: {}", e);
                                    break;
                                }
                                None => break,
                            }
                        }
                    }

                    let _ = app_for_loop.emit("cloud://relay-disconnected", ());
                }
                Err(e) => {
                    tracing::warn!("[relay] connect failed: {}", e);
                }
            }

            tokio::time::sleep(backoff.next()).await;
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn cloud_relay_stop(
    state: tauri::State<'_, Arc<RelayState>>,
) -> Result<(), String> {
    let mut cguard = state.cancel.lock().await;
    if let Some(tx) = cguard.take() {
        let _ = tx.send(());
    }
    let mut oguard = state.outbound.lock().await;
    oguard.take();
    Ok(())
}

/// Send a `cmd` message through the active relay connection. The
/// React layer hands us a raw JSON object — we trust it to be
/// well-formed; the cloud + the owner validate on receipt.
#[tauri::command]
pub async fn cloud_relay_send_cmd(
    state: tauri::State<'_, Arc<RelayState>>,
    payload: serde_json::Value,
) -> Result<(), String> {
    let guard = state.outbound.lock().await;
    let Some(tx) = guard.as_ref() else {
        return Err("relay not connected".into());
    };
    let text = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    tx.send(text).map_err(|_| "relay channel closed".to_string())
}

// ---------------------------------------------------------------------------

async fn fetch_org_id(token: &str) -> Result<String, ApiError> {
    #[derive(Deserialize)]
    struct OrgMe {
        id: String,
    }
    let r: OrgMe = api::get("/v1/orgs/me", Some(token)).await?;
    Ok(r.id)
}

fn handle_text(app: &AppHandle, txt: &str) {
    // Parse ONCE. We route on the top-level `type` and forward the whole value
    // to React (which routes further on `kind`). Mobile doesn't process `cmd`
    // (only owners do) but still surfaces it for visibility.
    let Ok(value) = serde_json::from_str::<serde_json::Value>(txt) else {
        tracing::debug!("[relay] skipped non-JSON frame: {} bytes", txt.len());
        return;
    };
    let ty = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let event_name = match ty {
        "hello" => "cloud://relay-hello",
        "event" => "cloud://relay-event",
        "presence" => "cloud://relay-presence",
        "error" => "cloud://relay-error",
        "cmd" => "cloud://relay-cmd",
        _ => {
            tracing::debug!("[relay] unrecognised type: {}", ty);
            return;
        }
    };
    let _ = app.emit(event_name, &value);
}

fn urlencoded(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Build the rustls connector for the relay WebSocket: bundled Mozilla
/// webpki roots + the ring provider, handed explicitly to
/// tokio-tungstenite via `connect_async_tls_with_config`.
///
/// Why not the default `connect_async`: on iOS its built-in TLS setup
/// failed to bring up the WSS connection (the upgrade never reached the
/// cloud, so the mobile saw servers via HTTP sync but got no relay logs
/// or control). This mirrors the explicit webpki+ring config the cloud
/// HTTP client uses, which works reliably on every platform.
fn relay_tls_connector() -> tokio_tungstenite::Connector {
    // Idempotent: the process-default provider is installed at startup
    // in lib.rs; this is a harmless no-op if so.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    tokio_tungstenite::Connector::Rustls(std::sync::Arc::new(config))
}

/// Per-stage budget for a single relay connect attempt. Without a bound,
/// the connect could hang forever on a half-open network path — exactly
/// what we observed on mobile (`connecting` logged, then permanent
/// silence). A bounded attempt turns that into an error the reconnect
/// loop retries with backoff.
const CONNECT_STAGE_TIMEOUT: Duration = Duration::from_secs(10);

/// What a fully-established relay connection looks like: a WS stream over
/// a (TLS-wrapped) TCP socket. Same concrete type the old one-shot
/// `connect_async_tls_with_config` produced, so the read/write loop is
/// unchanged.
type RelayWs =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Staged, instrumented relay connect: DNS → TCP → TLS + WS upgrade,
/// each step logged and wrapped in `CONNECT_STAGE_TIMEOUT`.
///
/// Why not the one-shot `tokio_tungstenite::connect_async_tls_with_config`:
/// on mobile that call hung indefinitely with no error, no success, and
/// no timeout, so the reconnect loop never even got to back off + retry —
/// the relay was simply dead (servers visible via HTTP sync, but no logs
/// and no control). Splitting the connect does two things:
///   1. No stage can stall the loop forever; a stuck path errors and we
///      retry on the normal backoff schedule.
///   2. The per-stage logs pinpoint *where* it stalls (name resolution
///      vs TCP reachability vs the TLS/upgrade handshake) — invisible
///      with the opaque one-shot call.
async fn connect_relay(
    url: &str,
    host: &str,
    connector: &tokio_tungstenite::Connector,
) -> Result<RelayWs, String> {
    use tokio::time::timeout;

    // --- DNS. Log every resolved address so an IPv4/IPv6 split (a common
    // mobile-network stall) is visible.
    tracing::debug!("[relay] resolving {host}:443");
    let addrs: Vec<std::net::SocketAddr> =
        timeout(CONNECT_STAGE_TIMEOUT, tokio::net::lookup_host((host, 443u16)))
            .await
            .map_err(|_| format!("dns timeout for {host}"))?
            .map_err(|e| format!("dns error for {host}: {e}"))?
            .collect();
    if addrs.is_empty() {
        return Err(format!("dns returned no addresses for {host}"));
    }
    tracing::debug!("[relay] resolved {} addr(s): {:?}", addrs.len(), addrs);

    // --- TCP. Try resolved addresses in order; first to connect wins.
    let mut tcp = None;
    let mut last_err = String::from("no addresses tried");
    for addr in &addrs {
        tracing::debug!("[relay] tcp connect {addr}");
        match timeout(CONNECT_STAGE_TIMEOUT, tokio::net::TcpStream::connect(addr)).await {
            Ok(Ok(s)) => {
                tracing::debug!("[relay] tcp connected {addr}");
                tcp = Some(s);
                break;
            }
            Ok(Err(e)) => {
                last_err = format!("tcp {addr}: {e}");
                tracing::warn!("[relay] {last_err}");
            }
            Err(_) => {
                last_err = format!("tcp timeout {addr}");
                tracing::warn!("[relay] {last_err}");
            }
        }
    }
    let tcp = tcp.ok_or(last_err)?;
    let _ = tcp.set_nodelay(true);

    // --- TLS handshake + WS upgrade over the socket we just opened,
    // using the explicit webpki + ring connector. `url` carries the host
    // so tokio-tungstenite derives the correct SNI / Host header.
    tracing::debug!("[relay] tls + ws upgrade");
    let (ws, _resp) = timeout(
        CONNECT_STAGE_TIMEOUT,
        tokio_tungstenite::client_async_tls_with_config(url, tcp, None, Some(connector.clone())),
    )
    .await
    .map_err(|_| "tls/ws upgrade timeout".to_string())?
    .map_err(|e| format!("tls/ws upgrade: {e}"))?;
    tracing::debug!("[relay] ws established");
    Ok(ws)
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

struct Backoff {
    attempt: u32,
}

impl Backoff {
    fn new() -> Self {
        Self { attempt: 0 }
    }
    fn reset(&mut self) {
        self.attempt = 0;
    }
    /// 250ms → 500ms → 1s → 2s → 4s → 8s → 16s → cap 30s, ±20% jitter.
    /// Same shape as the desktop so observable reconnect timing
    /// matches between platforms.
    fn next(&mut self) -> Duration {
        let base_ms: u64 = match self.attempt {
            0 => 250,
            1 => 500,
            2 => 1_000,
            3 => 2_000,
            4 => 4_000,
            5 => 8_000,
            6 => 16_000,
            _ => 30_000,
        };
        self.attempt = (self.attempt + 1).min(7);
        let jitter: f64 = rand::rng().random_range(-0.2..0.2);
        let ms = (base_ms as f64 * (1.0 + jitter)).max(100.0);
        Duration::from_millis(ms as u64)
    }
}
