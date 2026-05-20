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
            path: "Sources"
        ),
    ]
)
