// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "agenttool-secret-macos",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(
      name: "agenttool-secret-macos",
      targets: ["AgentToolSecretMacOS"]
    )
  ],
  targets: [
    .target(
      name: "AgentToolSecretMacOSCore",
      linkerSettings: [
        .linkedFramework("LocalAuthentication"),
        .linkedFramework("Security"),
      ]
    ),
    .executableTarget(
      name: "AgentToolSecretMacOS",
      dependencies: ["AgentToolSecretMacOSCore"]
    ),
    .testTarget(
      name: "AgentToolSecretMacOSTests",
      dependencies: ["AgentToolSecretMacOSCore"]
    ),
    .testTarget(
      name: "AgentToolSecretMacOSIntegrationTests",
      dependencies: ["AgentToolSecretMacOSCore"],
      linkerSettings: [
        .linkedFramework("LocalAuthentication"),
        .linkedFramework("Security"),
      ]
    ),
  ]
)
