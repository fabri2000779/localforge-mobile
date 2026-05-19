# LocalForge Mobile

iOS + Android companion app for [LocalForge](https://localforge.gg).
Lets you monitor and control your game servers from your phone — your
servers keep running on your desktop or VPS, the phone is the remote.

> Status: **pre-alpha**. Repo scaffolded, nothing shippable yet.

## What it is (and isn't)

**Is**: a thin client. You sign in to your LocalForge cloud account on
your phone, the phone connects to the same WebSocket relay your
sub-users use (Durable Object on Cloudflare), and you see / control
the servers that are actually running on your desktop or on your VPS
agent.

**Isn't**: a game-server host. Neither iOS nor Android can run Docker;
even if Android technically could, battery + background limits + lack
of port forwarding make it useless as a server. The mobile app never
runs servers itself — it always talks to a real LocalForge node
(desktop or VPS agent) through the cloud.

```
                      ┌─ Desktop (you, at home)
                      │     ↕ local Docker
   📱 mobile ── relay ─┤
                      │
                      └─ VPS (localforge-agent over HTTPS)
```

## v0.1 scope

- Cloud relay only — no direct-to-agent mode for now (simpler, works
  behind NAT). Direct mode is on the roadmap.
- Read + control: server list, status, start/stop, console tail,
  basic file actions.
- iOS 15+ and Android 9+ (API 28+).

Not in v0.1:
- File transfers (uploading multi-GB world saves over LTE = no).
- Local mDNS discovery of agents on your LAN.
- Push notifications for server crashes (planned for v0.2).

## Stack

- **[Tauri 2 Mobile](https://tauri.app/start/mobile/)** — same framework
  as the desktop. Lets us reuse the Rust crates that already exist in
  the public `fabri2000779/localforge` repo (the `localforge-core`
  catalogue + `localforge-backend-remote` HTTPS client) instead of
  reimplementing them in Swift/Kotlin/JS.
- **React 19 + Vite** — same UI stack as the desktop, with a
  mobile-first responsive layout.
- **Cloud client** — the auth / OAuth / envelope-encryption code from
  the desktop will be extracted into a shared `localforge-cloud-client`
  crate in the public repo, then consumed here. Until that refactor
  lands, this app talks to the cloud API directly.

## Repo layout (planned)

```
localforge-mobile/
├── src/                       # React frontend
├── src-tauri/
│   ├── Cargo.toml             # Tauri shell + reuse of public crates
│   ├── tauri.conf.json        # Mobile-aware config
│   ├── capabilities/          # Tauri 2 permission manifests
│   └── src/
│       ├── lib.rs             # Mobile + desktop entrypoint
│       └── main.rs            # Desktop-only entry (dev)
├── .github/workflows/
│   ├── android.yml            # APK / AAB build (TBD)
│   └── ios.yml                # IPA build on macos-15 runner (TBD)
└── ...
```

## Building (when the scaffold can build anything)

```bash
# Web dev preview (no native shell)
npm run dev

# Android (requires Android Studio + SDK + NDK + JDK 17)
npm run tauri android dev

# iOS (requires Xcode on a Mac)
npm run tauri ios dev
```

## What's pending

- [ ] Run `tauri android init` once Android Studio + NDK are installed
      on a dev machine.
- [ ] Generate an Android keystore and stash the base64 in GH secrets.
- [ ] Set up an Apple Developer team + provisioning profile.
- [ ] Extract the desktop's `src-tauri/src/cloud/*` into a shared crate
      in the public repo; consume it here as a git dependency.
- [ ] Build pipeline for both stores (CI matrix).
- [ ] Register with App Store Connect and Play Console.

See `context.md` (gitignored) for working notes.

## License

Proprietary. See [LICENSE](LICENSE).
