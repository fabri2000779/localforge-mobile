# LocalForge Mobile

iOS + Android companion app for [LocalForge](https://localforge.gg).
Monitor and control the game servers running on your LocalForge
desktop or VPS — from your phone.

> Status: **v0.1.0 — feature-complete for stores-pending milestone.**
> Code compiles and runs in the web preview today; native shells
> (Android Studio for APK, Mac + Xcode for IPA) still need to be
> generated on a dev machine before the first store upload.

## What it is (and isn't)

**Is**: a thin client. Sign in to your LocalForge cloud account,
the phone holds a persistent WebSocket to the same Durable Object
relay your sub-users use, and you see / control the servers that
are actually running on your desktop or VPS agent.

**Isn't**: a game-server host. Neither iOS nor Android can run
Docker; even if Android technically could, battery + background
limits + lack of port forwarding make it useless as a server. The
mobile app never runs servers itself — it always talks to a real
LocalForge node (desktop or VPS agent) through the cloud.

```
                      ┌─ Desktop (you, at home)
                      │     ↕ local Docker
   📱 mobile ── relay ─┤
                      │
                      └─ VPS (localforge-agent over HTTPS)
```

## v0.1.0 — what works

### Auth
- Email + password sign-in / sign-up
- "Forgot password" → reset link via email
- OAuth: Google, Discord, GitHub (custom URL scheme
  `localforge://auth/callback`, deep-link routed to the app by the
  OS, no Apple Developer setup required for dev builds)
- Token persisted to sandboxed app-data dir (mobile keychain
  migration pending — see roadmap)

### Servers
- Server list via `GET /v1/sync/servers` (plaintext metadata only;
  encrypted blobs are stripped at the Rust↔JS boundary)
- Paywall card for free-tier accounts (cloud sync needs Hobby+)
- Pull-down refresh (manual button in header)
- Relative-time meta ("Last synced 12m ago")
- Empty / error / loading states all explicit

### Server detail
- Tap a row → server detail screen
- Start / Stop / Restart buttons send `cmd` messages through the
  relay; the owner's desktop executes via its existing
  `RelayCommandExecutor` and sends back a `cmd_result` event
- Toast surfaces the result (server-side error string included
  when the command fails)

### Relay
- Persistent WebSocket to `wss://api.localforge.gg/v1/relay/<orgId>`
- Auto-reconnect with 250ms → 30s ±20% backoff (same shape as the
  desktop; a cloud-side deploy is invisible to the user)
- Connection badge in the server list header (Live / Connecting / Offline)
- Subscribers for `relay-event`, `relay-presence`, `relay-error`,
  `relay-hello`

## Stack

- **[Tauri 2 Mobile](https://tauri.app/start/mobile/)** — same
  framework as the desktop. Lets us reuse the Rust crates from the
  public `fabri2000779/localforge` repo (specifically the
  `localforge-cloud-client` shared crate, which holds auth + OAuth
  + envelope encryption + sync + relay WS URL building +
  audit/orgs/billing primitives).
- **React 19 + Vite** — same UI stack as the desktop, with a
  mobile-first responsive layout.
- **tauri-plugin-deep-link** for the OAuth callback scheme.
- **tauri-plugin-opener** to launch the system browser at sign-in.
- **tokio-tungstenite** for the relay WS connection.

The shared cloud-client crate (`localforge-cloud-client`) pinned to
a specific commit on the public repo via Cargo git-dep. Bumping it
is `cargo update -p localforge-cloud-client` from
`src-tauri/`. Lockfile (`Cargo.lock`) is tracked so reproducible
builds always come from the same upstream SHA.

## Repo layout

```
localforge-mobile/
├── src/                            # React frontend
│   ├── App.tsx                     # Route enum (home / servers / server)
│   ├── lib/cloud.ts                # Typed invoke() wrappers + event subscribers
│   ├── components/
│   │   ├── LoginScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── ServerListScreen.tsx
│   │   └── ServerDetailScreen.tsx
│   └── App.css                     # Mobile-first dark theme
├── src-tauri/
│   ├── Cargo.toml                  # Pinned to localforge-cloud-client git rev
│   ├── tauri.conf.json
│   ├── capabilities/default.json   # Tauri 2 permission manifest
│   ├── src/
│   │   ├── lib.rs                  # Tauri builder + plugin registration
│   │   ├── auth.rs                 # Token file storage + signup/login/me commands
│   │   ├── oauth.rs                # cloud_oauth_start + deep-link handler
│   │   ├── sync.rs                 # cloud_servers_list (HTTP)
│   │   └── relay.rs                # WS state machine + send/receive
│   └── icons/                      # LocalForge hex mark (32/64/128/512/iOS/Android)
└── .github/workflows/              # CI for APK / IPA (TBD — needs keystore + provisioning)
```

## Building (when there's a dev machine)

```bash
# Web preview (quickest UI iteration, no native shell)
npm install
npm run dev                                  # http://localhost:5173

# Android
#   Prereqs: Android Studio + SDK 34+ + NDK r26+ + JDK 17
#   ANDROID_HOME + NDK_HOME env vars must point at the install
npm run tauri:android:init                   # generate src-tauri/gen/android (one-off)
npm run tauri:android:dev                    # build + push to attached device / emulator

# iOS
#   Prereqs: Mac with Xcode 14+ + Apple Developer team ($99/yr)
npm run tauri:ios:init                       # generate src-tauri/gen/apple (one-off)
npm run tauri:ios:dev
```

## v0.2.0 roadmap

These need a co-commit on the desktop's `serverwave-anywhere`:

- **Per-row live state badges** — owner adds a `state.snapshot` cmd
  handler in `RelayCommandExecutor` (currently CMD_MAP only covers
  per-server actions, not list-wide queries). Mobile sends
  `state.snapshot` on connect + on pull-to-refresh, parses the
  responding event into per-row "running / stopped / crashed"
  badges.
- **Server-event broadcasts** — owner hooks into the
  bollard container-state event stream and emits
  `event: server.state_changed { id, state }` on transitions, so
  mobile updates instantly without polling.
- **Console tail** — mobile sends `server.attach` (already in
  CMD_MAP), subscribes to `kind: console_line` events the desktop
  forwards via `RelayLogBridge`.

These can ship independently:

- iOS Keychain Services + Android Keystore for the JWT (currently a
  sandboxed file).
- Push notifications for crash alerts (needs APNs + FCM, deferred
  until store submission to avoid burning the test entitlements).
- Universal Links + App Links replacing the custom URL scheme
  (needs Apple Developer team for `apple-app-site-association`).
- GitHub Actions: APK build (macos / ubuntu / windows-2022 ok),
  IPA build (macos-14 runner only).

## License

Proprietary. See [LICENSE](LICENSE).
