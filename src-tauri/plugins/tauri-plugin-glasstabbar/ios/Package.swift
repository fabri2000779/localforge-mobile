// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-glasstabbar",
    platforms: [
        // iOS 15 floor — matches the app's deployment target. The Liquid
        // Glass material is applied automatically by UITabBar at runtime on
        // iOS 26; older iOS shows the standard translucent bar.
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-glasstabbar",
            type: .static,
            targets: ["tauri-plugin-glasstabbar"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-glasstabbar",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources",
            swiftSettings: [
                // -Onone: same defensive flag as the iap/webauth plugins
                // (Swift SR-11564 — optimizer-emitted lazy type-metadata
                // accessors can trap at runtime in release).
                .unsafeFlags(["-Onone"]),
            ]
        ),
    ]
)
