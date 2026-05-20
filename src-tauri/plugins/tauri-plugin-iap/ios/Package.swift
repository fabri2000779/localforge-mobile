// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-iap",
    platforms: [
        // iOS 15 floor — MUST match the app's deployment target
        // (tauri.conf.json bundle.iOS.minimumSystemVersion = "15.0").
        //
        // Why 15 and not 13: below iOS 15 the app links the BACK-DEPLOYED
        // Swift Concurrency runtime (a copy bundled in the app), and that
        // copy crashes when a `Task {}` is created from a static library —
        // __swift_instantiateConcreteTypeFromMangledName, even on iOS 26,
        // because the deployment target (not the device OS) decides which
        // concurrency runtime is used. That was the paywall crash. At a
        // 15.0 floor the OS-native concurrency runtime is used, no
        // back-deploy lib, no crash. StoreKit 2 also requires iOS 15
        // anyway, so nothing of value is lost.
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-iap",
            type: .static,
            targets: ["tauri-plugin-iap"]
        ),
    ],
    dependencies: [
        // Tauri drops its generated Swift API package here during the
        // `tauri ios build`. Path is relative to this manifest.
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-iap",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources",
            swiftSettings: [
                // Force -Onone on THIS target.
                //
                // The symbolicated v0.2.15 crash was:
                //   __swift_instantiateConcreteTypeFromMangledNameV2
                //   specialized IapPlugin.getProducts(_:)
                // i.e. the release OPTIMIZER ("specialized") emitted a lazy
                // runtime type-metadata accessor that traps (Swift SR-11564),
                // aborting the app the instant getProducts runs.
                //
                // The CI's global XCODE_XCCONFIG_FILE (-Onone) does NOT reach
                // SwiftPM dependency targets — only the app target — which is
                // why v0.2.14 didn't help. Setting it here, on the package
                // itself, is the only lever that reaches this target. -Onone
                // makes the compiler emit DIRECT type-metadata references
                // instead of the mangled-name accessors, so the trap is gone.
                //
                // `unsafeFlags` is permitted because Tauri references this
                // plugin as a LOCAL path dependency (the unsafe-flags ban
                // only applies to versioned registry/remote dependencies).
                // The app is observation-only; the lost optimization on this
                // thin command surface is irrelevant.
                .unsafeFlags(["-Onone"])
            ]
        ),
    ]
)
