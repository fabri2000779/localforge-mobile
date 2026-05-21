// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-webauth",
    platforms: [
        // iOS 15 floor — matches the app's deployment target
        // (tauri.conf.json bundle.iOS.minimumSystemVersion). Keeps this
        // target on the OS-native Swift Concurrency runtime, not the
        // buggy back-deploy copy (the lesson from the IAP plugin).
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-webauth",
            type: .static,
            targets: ["tauri-plugin-webauth"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-webauth",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources",
            swiftSettings: [
                // -Onone: stop the optimizer emitting lazy mangled-name
                // type-metadata accessors that trap at runtime in release
                // (Swift SR-11564 — same defensive flag as tauri-plugin-iap).
                .unsafeFlags(["-Onone"]),
            ]
        ),
    ]
)
