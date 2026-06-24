// swift-tools-version:5.5
// Mirrors tauri-plugin-iap/ios/Package.swift — see the long-form rationale
// there for the .iOS(.v15) floor + the -Onone flag (Swift SR-11564 lazy
// type-metadata accessor trap under the release optimizer in a static lib).
import PackageDescription

let package = Package(
    name: "tauri-plugin-push",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-push",
            type: .static,
            targets: ["tauri-plugin-push"]
        ),
    ],
    dependencies: [
        // Tauri drops its generated Swift API package here during
        // `tauri ios build`. Path is relative to this manifest.
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-push",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources",
            swiftSettings: [
                .unsafeFlags(["-Onone"])
            ]
        ),
    ]
)
