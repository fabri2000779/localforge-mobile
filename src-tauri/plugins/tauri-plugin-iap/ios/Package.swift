// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "tauri-plugin-iap",
    platforms: [
        // Keep the package floor at iOS 13 to match Tauri's generated
        // Xcode deployment target — a package can't require a HIGHER
        // minimum than the app that links it. StoreKit 2 (iOS 15) is
        // reached only inside `if #available(iOS 15, *)` guards, so it
        // weak-links cleanly and older devices get a "requires iOS 15"
        // reject instead of a load failure.
        .iOS(.v13),
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
