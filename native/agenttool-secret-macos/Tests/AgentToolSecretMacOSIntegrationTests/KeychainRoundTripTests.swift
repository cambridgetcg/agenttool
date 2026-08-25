import Darwin
import Foundation
import LocalAuthentication
import Security
import XCTest

@testable import AgentToolSecretMacOSCore

final class KeychainRoundTripTests: XCTestCase {
  private let receiptNonce = "000102030405060708090a0b0c0d0e0f"

  func testSyntheticNoUICreateVerifyDuplicateAndExactCleanup() throws {
    try requireIntegrationGate()

    let suffix = UUID().uuidString.lowercased()
    let service = "agenttool-native-test-\(suffix)"
    let account = "test-\(suffix)"
    let store = SecretStore()
    let nonce = try SecretToolCeremonyNonce(receiptNonce)
    try cleanup(service: service, account: account, allowAbsent: true)
    defer {
      XCTAssertNoThrow(try cleanup(service: service, account: account, allowAbsent: false))
      XCTAssertThrowsError(
        try store.verifyCanonicalGeneration(
          service: service,
          account: account,
          ceremonyNonce: nonce
        )
      ) { error in
        XCTAssertEqual(error as? SecretToolFailure, .itemAbsent)
      }
    }

    XCTAssertThrowsError(
      try store.verifyCanonicalGeneration(
        service: service,
        account: account,
        ceremonyNonce: nonce
      )
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .itemAbsent)
    }

    try store.createRandom(service: service, account: account, ceremonyNonce: nonce)
    XCTAssertNoThrow(
      try store.verifyCanonicalGeneration(
        service: service,
        account: account,
        ceremonyNonce: nonce
      )
    )
    XCTAssertThrowsError(
      try store.createRandom(service: service, account: account, ceremonyNonce: nonce)
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .itemExists)
    }

    XCTAssertThrowsError(
      try store.verifyCanonicalGeneration(
        service: service,
        account: "other-\(suffix)",
        ceremonyNonce: nonce
      )
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .itemAbsent)
    }
  }

  func testFixedFixtureExecutableCreatesAndVerifiesWithoutSecretIO() throws {
    try requireIntegrationGate()
    guard
      let binaryPath = ProcessInfo.processInfo.environment[
        "AGENTTOOL_SECRET_MACOS_BINARY"
      ], !binaryPath.isEmpty,
      FileManager.default.isExecutableFile(atPath: binaryPath)
    else {
      throw IntegrationFailure.binaryUnavailable
    }

    let fixture = try FlyFixture()
    defer { fixture.remove() }
    let environment = fixture.environment

    try requireFixtureAttestation(
      try runBinary(binaryPath, arguments: ["fixture-attest"], environment: environment)
    )
    try requireSuccessWithoutOutput(
      try runBinary(binaryPath, arguments: ["fixture-clean"], environment: environment)
    )
    defer {
      do {
        try requireSuccessWithoutOutput(
          try runBinary(binaryPath, arguments: ["fixture-clean"], environment: environment)
        )
        try fixture.writeMarker(.generationVerified)
        assertFailure(
          try runBinary(
            binaryPath,
            arguments: ["verify", "--receipt-nonce", receiptNonce],
            environment: environment
          ),
          .itemAbsent
        )
      } catch {
        XCTFail("fixed fixture cleanup did not settle safely")
      }
    }

    try fixture.writeMarker(.createAttempting)
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: ["verify", "--receipt-nonce", receiptNonce],
        environment: environment
      ),
      .itemAbsent
    )
    try requireSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: ["create", "--receipt-nonce", receiptNonce],
        environment: environment
      )
    )
    try fixture.writeMarker(.generationVerified)
    try requireSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: ["verify", "--receipt-nonce", receiptNonce],
        environment: environment
      )
    )

    assertFailure(
      try runBinary(
        binaryPath,
        arguments: ["create", "--receipt-nonce", receiptNonce],
        environment: environment
      ),
      .ceremonyStateInvalid
    )
    assertSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: ["verify", "--receipt-nonce", receiptNonce],
        environment: environment
      )
    )
    try fixture.writeMarker(.stageAttempting)
    try requireSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: ["stage-fly", "--receipt-nonce", receiptNonce],
        environment: environment
      )
    )
    XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.stageProofPath))

    try fixture.installEarlyExitExecutable()
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: ["stage-fly", "--receipt-nonce", receiptNonce],
        environment: environment
      ),
      .flyChildFailed
    )
    try fixture.installTermIgnoringExecutable()
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: ["stage-fly", "--receipt-nonce", receiptNonce],
        environment: environment
      ),
      .flyChildTimedOut
    )
    try fixture.assertHungChildWasReaped()
    try fixture.installResidualDescendantExecutable()
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: ["stage-fly", "--receipt-nonce", receiptNonce],
        environment: environment
      ),
      .flyChildFailed
    )
    try fixture.assertResidualDescendantWasReaped()
    try fixture.installNormalExecutable()

    try fixture.writeMarker(.probeAttemptingWithoutGeneration)
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: [
          "probe-fly", "--receipt-nonce", receiptNonce, "--machine",
          fixture.probeMachineID,
        ],
        environment: environment
      ),
      .ceremonyStateInvalid
    )

    try fixture.writeMarker(.probeAttempting)
    try requireSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: [
          "probe-fly", "--receipt-nonce", receiptNonce, "--machine",
          fixture.probeMachineID,
        ],
        environment: environment
      )
    )
    XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.probeProofPath))

    try fixture.writeMarker(.thinkerProbeAttempting)
    try requireSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: [
          "probe-fly", "--receipt-nonce", receiptNonce, "--machine",
          fixture.thinkerMachineID,
        ],
        environment: environment
      )
    )
    XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.thinkerProbeProofPath))

    try fixture.writeMarker(.completed)
    try requireSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: [
          "verify-deployed-fly", "--receipt-nonce", receiptNonce,
          "--revision", String(repeating: "a", count: 40),
          "--machine", fixture.probeMachineID,
        ],
        environment: environment
      )
    )
    try requireSuccessWithoutOutput(
      try runBinary(
        binaryPath,
        arguments: [
          "verify-deployed-fly", "--receipt-nonce", receiptNonce,
          "--revision", String(repeating: "a", count: 40),
          "--machine", fixture.thinkerMachineID,
        ],
        environment: environment
      )
    )
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: [
          "verify-deployed-fly", "--receipt-nonce", receiptNonce,
          "--revision", String(repeating: "a", count: 40),
          "--machine", "55555555555555",
        ],
        environment: environment
      ),
      .ceremonyStateInvalid
    )

    try fixture.writeMarker(.generationVerified)
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: [
          "verify-deployed-fly", "--receipt-nonce", receiptNonce,
          "--revision", String(repeating: "a", count: 40),
          "--machine", fixture.probeMachineID,
        ],
        environment: environment
      ),
      .ceremonyStateInvalid
    )

    assertFailure(
      try runBinary(binaryPath, arguments: ["get"], environment: environment),
      .invalidInvocation
    )
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: ["put", "--policy", "overwrite"],
        environment: environment
      ),
      .invalidInvocation
    )
    try requireSuccessWithoutOutput(
      try runBinary(binaryPath, arguments: ["fixture-clean"], environment: environment)
    )
    try fixture.writeMarker(.generationVerified)
    assertFailure(
      try runBinary(
        binaryPath,
        arguments: ["verify", "--receipt-nonce", receiptNonce],
        environment: environment
      ),
      .itemAbsent
    )
  }

  func testOrdinaryProductionBinaryCannotPassFixtureAdmission() throws {
    try requireIntegrationGate()
    guard
      let binaryPath = ProcessInfo.processInfo.environment[
        "AGENTTOOL_SECRET_MACOS_PRODUCTION_BINARY"
      ], !binaryPath.isEmpty,
      FileManager.default.isExecutableFile(atPath: binaryPath)
    else {
      throw IntegrationFailure.binaryUnavailable
    }

    XCTAssertThrowsError(
      try requireFixtureAttestation(
        try runBinary(binaryPath, arguments: ["fixture-attest"])
      )
    ) { error in
      XCTAssertEqual(error as? IntegrationFailure, .binaryNotFixture)
    }
    assertFailure(
      try runBinary(binaryPath, arguments: ["fixture-clean"]),
      .invalidInvocation
    )
  }

  private func requireIntegrationGate() throws {
    guard ProcessInfo.processInfo.environment["AGENTTOOL_KEYCHAIN_INTEGRATION"] == "1"
    else {
      throw XCTSkip("live Keychain integration is explicitly disabled")
    }
  }

  private func cleanup(
    service: String,
    account: String,
    allowAbsent: Bool
  ) throws {
    let context = LAContext()
    context.interactionNotAllowed = true
    let status = SecItemDelete(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecAttrAccount: account,
        kSecAttrSynchronizable: false,
        kSecUseAuthenticationContext: context,
      ] as CFDictionary)
    if status == errSecSuccess || (allowAbsent && status == errSecItemNotFound) {
      return
    }
    throw CleanupFailure.failed
  }
}

private struct ProcessResult {
  let status: Int32
  let stdout: Data
  let stderr: Data
}

private enum IntegrationFailure: Error, Equatable {
  case binaryUnavailable
  case binaryNotFixture
  case fixtureSetupFailed
  case childRefused
  case childTimedOut
  case childWouldNotSettle
}

private func requireFixtureAttestation(_ result: ProcessResult) throws {
  guard result.status == 0, result.stdout.isEmpty, result.stderr.isEmpty else {
    throw IntegrationFailure.binaryNotFixture
  }
}

private func requireSuccessWithoutOutput(_ result: ProcessResult) throws {
  guard result.status == 0, result.stdout.isEmpty, result.stderr.isEmpty else {
    throw IntegrationFailure.childRefused
  }
}

private func runBinary(
  _ binaryPath: String,
  arguments: [String],
  environment: [String: String]? = nil
) throws -> ProcessResult {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: binaryPath)
  process.arguments = arguments
  if let environment {
    process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }
  }

  let outputPipe = Pipe()
  let errorPipe = Pipe()
  process.standardInput = FileHandle.nullDevice
  process.standardOutput = outputPipe
  process.standardError = errorPipe

  let settled = DispatchSemaphore(value: 0)
  process.terminationHandler = { _ in settled.signal() }
  try process.run()

  if settled.wait(timeout: .now() + 10) == .timedOut {
    process.terminate()
    if settled.wait(timeout: .now() + 2) == .timedOut {
      Darwin.kill(process.processIdentifier, SIGKILL)
      guard settled.wait(timeout: .now() + 2) == .success else {
        throw IntegrationFailure.childWouldNotSettle
      }
    }
    throw IntegrationFailure.childTimedOut
  }

  return ProcessResult(
    status: process.terminationStatus,
    stdout: outputPipe.fileHandleForReading.readDataToEndOfFile(),
    stderr: errorPipe.fileHandleForReading.readDataToEndOfFile()
  )
}

private func assertSuccessWithoutOutput(
  _ result: ProcessResult,
  file: StaticString = #filePath,
  line: UInt = #line
) {
  XCTAssertEqual(result.status, 0, file: file, line: line)
  XCTAssertTrue(result.stdout.isEmpty, file: file, line: line)
  XCTAssertTrue(result.stderr.isEmpty, file: file, line: line)
}

private func assertFailure(
  _ result: ProcessResult,
  _ failure: SecretToolFailure,
  file: StaticString = #filePath,
  line: UInt = #line
) {
  XCTAssertEqual(result.status, failure.exitCode, file: file, line: line)
  XCTAssertTrue(result.stdout.isEmpty, file: file, line: line)
  XCTAssertEqual(
    String(decoding: result.stderr, as: UTF8.self),
    "agenttool-secret-macos:\(failure.safeCode)\n",
    file: file,
    line: line
  )
}

private enum CleanupFailure: Error {
  case failed
}

private enum FixtureMarkerState {
  case createAttempting
  case generationVerified
  case stageAttempting
  case probeAttempting
  case probeAttemptingWithoutGeneration
  case thinkerProbeAttempting
  case completed
}

private final class FlyFixture {
  let rootURL: URL
  let markerURL: URL
  let finalReceiptURL: URL
  let executableURL: URL
  let flyHomeURL: URL
  let probeMachineID = "11111111111111"
  let thinkerMachineID = "44444444444444"

  var stageProofPath: String {
    rootURL.appendingPathComponent("stage.ok").path
  }

  var probeProofPath: String {
    rootURL.appendingPathComponent("probe.ok").path
  }

  var thinkerProbeProofPath: String {
    rootURL.appendingPathComponent("thinker-probe.ok").path
  }

  var environment: [String: String] {
    [
      "AGENTTOOL_SECRET_MACOS_MARKER": markerURL.path,
      "AGENTTOOL_SECRET_MACOS_FINAL_RECEIPT": finalReceiptURL.path,
      "AGENTTOOL_SECRET_MACOS_FLY_FIXTURE": executableURL.path,
      "AGENTTOOL_SECRET_MACOS_FLY_HOME": flyHomeURL.path,
    ]
  }

  init() throws {
    rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(
      "agenttool-phase-b-native-\(UUID().uuidString.lowercased())",
      isDirectory: true
    )
    markerURL = rootURL.appendingPathComponent("active.json")
    finalReceiptURL = rootURL.appendingPathComponent("receipt.json")
    executableURL = rootURL.appendingPathComponent("flyctl-fixture")
    flyHomeURL = rootURL.appendingPathComponent("fly-home", isDirectory: true)

    try FileManager.default.createDirectory(
      at: rootURL,
      withIntermediateDirectories: false,
      attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.createDirectory(
      at: flyHomeURL.appendingPathComponent(".fly", isDirectory: true),
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let configURL = flyHomeURL.appendingPathComponent(".fly/config.yml")
    try Data("access_token: fixture-only\n".utf8).write(to: configURL)
    guard chmod(configURL.path, 0o600) == 0 else {
      throw IntegrationFailure.fixtureSetupFailed
    }

    try installNormalExecutable()
  }

  func installNormalExecutable() throws {
    try writeExecutable(Self.normalScript)
  }

  func installEarlyExitExecutable() throws {
    try writeExecutable("#!/bin/bash\nexit 42\n")
  }

  func installTermIgnoringExecutable() throws {
    try writeExecutable(
      #"""
      #!/bin/bash
      trap '' TERM
      printf '%s\n' "$$" > "${0%/*}/hung.pid"
      while :; do /bin/sleep 1; done
      """#
    )
  }

  func installResidualDescendantExecutable() throws {
    try writeExecutable(
      #"""
      #!/bin/bash
      set -euo pipefail
      proof_dir="${0%/*}"
      exec 3<&0
      IFS= read -r payload
      /bin/sh -c 'trap "" TERM; printf "%s\n" "$$" > "$1"; while :; do /bin/sleep 1; done' fixture "$proof_dir/residual.pid" <&3 &
      while [[ ! -s "$proof_dir/residual.pid" ]]; do /bin/sleep 0.05; done
      exit 0
      """#
    )
  }

  func assertHungChildWasReaped() throws {
    try assertProcessWasReaped("hung.pid")
  }

  func assertResidualDescendantWasReaped() throws {
    try assertProcessWasReaped("residual.pid")
  }

  private func assertProcessWasReaped(_ filename: String) throws {
    let path = rootURL.appendingPathComponent(filename).path
    guard let text = try? String(contentsOfFile: path, encoding: .utf8),
      let processID = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)),
      processID > 0,
      kill(processID, 0) == -1,
      errno == ESRCH
    else {
      throw IntegrationFailure.childWouldNotSettle
    }
  }

  func writeMarker(_ state: FixtureMarkerState) throws {
    let timestamp = "2026-08-24T00:00:00.000Z"
    let digest = String(repeating: "b", count: 64)
    let revision = String(repeating: "a", count: 40)
    let appIDs = ["11111111111111", "22222222222222", "33333333333333"]
    let primary = "44444444444444"
    let standby = "55555555555555"
    let generation: [String: Any]
    let checkpoint: String
    let attempts: [[String: Any]]
    var markerStatus = "active"
    var final: Any = NSNull()
    var destinationURL = markerURL
    switch state {
    case .createAttempting:
      checkpoint = "create_attempting"
      generation = ["create_attempted": true, "create_verified": false]
      attempts = []
    case .generationVerified:
      checkpoint = "generation_verified"
      generation = ["create_attempted": true, "create_verified": true]
      attempts = []
    case .stageAttempting:
      checkpoint = "rollout_active"
      generation = ["create_attempted": true, "create_verified": true]
      attempts = [
        attempt(
          checkpoint: "stage_attempting",
          stage: ["attempted": true, "verified": false],
          deploy: ["attempted": false, "verified": false],
          attemptedMachines: [],
          verifiedMachines: [],
          timestamp: timestamp
        )
      ]
    case .probeAttempting:
      checkpoint = "rollout_active"
      generation = ["create_attempted": true, "create_verified": true]
      attempts = [
        attempt(
          checkpoint: "runtime_probe_attempting",
          stage: ["attempted": true, "verified": true],
          deploy: ["attempted": true, "verified": true],
          attemptedMachines: [probeMachineID],
          verifiedMachines: [],
          timestamp: timestamp
        )
      ]
    case .probeAttemptingWithoutGeneration:
      checkpoint = "rollout_active"
      generation = ["create_attempted": false, "create_verified": false]
      attempts = [
        attempt(
          checkpoint: "runtime_probe_attempting",
          stage: ["attempted": true, "verified": true],
          deploy: ["attempted": true, "verified": true],
          attemptedMachines: [probeMachineID],
          verifiedMachines: [],
          timestamp: timestamp
        )
      ]
    case .thinkerProbeAttempting:
      checkpoint = "rollout_active"
      generation = ["create_attempted": true, "create_verified": true]
      attempts = [
        attempt(
          checkpoint: "runtime_probe_attempting",
          stage: ["attempted": true, "verified": true],
          deploy: ["attempted": true, "verified": true],
          attemptedMachines: appIDs + [primary],
          verifiedMachines: appIDs,
          timestamp: timestamp
        )
      ]
    case .completed:
      markerStatus = "completed"
      checkpoint = "completed"
      generation = ["create_attempted": true, "create_verified": true]
      attempts = [
        attempt(
          status: "completed",
          checkpoint: "completed",
          stage: ["attempted": true, "verified": true],
          deploy: ["attempted": true, "verified": true],
          attemptedMachines: appIDs + [primary],
          verifiedMachines: appIDs + [primary],
          finalGatesVerified: true,
          timestamp: timestamp
        )
      ]
      final = [
        "completed_at": timestamp,
        "final_inventory_sha256": digest,
        "final_secret_status": "Deployed",
        "runtime_verified_count": 4,
        "reserved_generation_rows": 0,
        "authoritative_v2_rows": 0,
        "allowed_origins_count": 0,
      ]
      destinationURL = finalReceiptURL
    }

    let marker: [String: Any] = [
      "schema": "agenttool.covenant-v2-generation-ceremony/1",
      "status": markerStatus,
      "checkpoint": checkpoint,
      "ceremony_nonce": "000102030405060708090a0b0c0d0e0f",
      "created_at": timestamp,
      "updated_at": timestamp,
      "bindings": [
        "operator_revision": revision,
        "operator_source_sha256": digest,
        "native_sha256": digest,
        "native_cdhash": String(repeating: "c", count: 40),
        "native_team_id": "ABCDE12345",
        "native_designated_requirement_sha256": digest,
        "flyctl_sha256":
          "7e919b0f42867e33d736398ba151ed00f2bfb577bf9424fbe57573bfee9ae1b3",
        "phase_a_resume_receipt_sha256": digest,
      ],
      "scope": [
        "machine_set_sha256": digest,
        "role_map_sha256": digest,
        "app_machine_ids": appIDs,
        "thinker_primary_machine_id": primary,
        "thinker_standby_machine_id": standby,
        "started_probe_order": appIDs + [primary],
        "baseline_inventory_sha256": digest,
        "baseline_non_image_config_sha256": digest,
        "image_ref_sha256": digest,
        "deployed_revision": revision,
      ],
      "interlock": [
        "row_id": 1,
        "durable_hold_verified": true,
        "allowed_origins_count": 0,
        "instance_url_sha256": digest,
        "database_target_sha256": digest,
      ],
      "generation": generation,
      "attempts": attempts,
      "final": final,
    ]
    var data = try JSONSerialization.data(withJSONObject: marker, options: [.sortedKeys])
    data.append(0x0A)
    if destinationURL == finalReceiptURL,
      FileManager.default.fileExists(atPath: markerURL.path)
    {
      try FileManager.default.removeItem(at: markerURL)
    }
    try data.write(to: destinationURL, options: .atomic)
    guard chmod(destinationURL.path, 0o600) == 0 else {
      throw IntegrationFailure.fixtureSetupFailed
    }
  }

  func remove() {
    try? FileManager.default.removeItem(at: rootURL)
  }

  private func attempt(
    status: String = "active",
    checkpoint: String,
    stage: [String: Bool],
    deploy: [String: Bool],
    attemptedMachines: [String],
    verifiedMachines: [String],
    finalGatesVerified: Bool = false,
    timestamp: String
  ) -> [String: Any] {
    [
      "attempt_id": "101112131415161718191a1b1c1d1e1f",
      "status": status,
      "checkpoint": checkpoint,
      "started_at": timestamp,
      "updated_at": timestamp,
      "stage": stage,
      "deploy": deploy,
      "runtime_probe": [
        "attempted_machine_ids": attemptedMachines,
        "verified_machine_ids": verifiedMachines,
      ],
      "final_gates_verified": finalGatesVerified,
      "failure": NSNull(),
    ]
  }

  private func writeExecutable(_ source: String) throws {
    try Data(source.utf8).write(to: executableURL, options: .atomic)
    guard chmod(executableURL.path, 0o700) == 0 else {
      throw IntegrationFailure.fixtureSetupFailed
    }
  }

  private static let normalScript = #"""
    #!/bin/bash
    set -euo pipefail
    proof_dir="${0%/*}"
    if [[ "$#" -eq 5 && "$1" == "secrets" && "$2" == "import" && "$3" == "--stage" && "$4" == "--app" && "$5" == "agenttool" ]]; then
      IFS= read -r payload
      [[ "$payload" =~ ^AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION=[0-9a-f]{64}$ ]]
      if IFS= read -r extra; then exit 91; fi
      printf '%s\n' "$payload"
      printf '%s\n' "$payload" >&2
      : > "$proof_dir/stage.ok"
      exit 0
    fi
    if [[ "$#" -eq 10 && "$1" == "ssh" && "$2" == "console" && "$3" == "--app" && "$4" == "agenttool" && "$5" == "--machine" && "$6" == "11111111111111" && "$7" == "--quiet" && "$8" == "--pty=false" && "$9" == "--command" ]]; then
      [[ "${10}" == *"AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION"* ]]
      [[ "${10}" == *"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"* ]]
      [[ "${10}" == *"src/index.ts"* ]]
      [[ "${10}" == *"11111111111111"* ]]
      [[ "${10}" == *"127.0.0.1:3000/health"* ]]
      IFS= read -r payload
      [[ "$payload" =~ ^[0-9a-f]{64}$ ]]
      if IFS= read -r extra; then exit 92; fi
      printf '%s\n' "$payload"
      printf '%s\n' "$payload" >&2
      : > "$proof_dir/probe.ok"
      exit 0
    fi
    if [[ "$#" -eq 10 && "$1" == "ssh" && "$2" == "console" && "$3" == "--app" && "$4" == "agenttool" && "$5" == "--machine" && "$6" == "44444444444444" && "$7" == "--quiet" && "$8" == "--pty=false" && "$9" == "--command" ]]; then
      [[ "${10}" == *"AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION"* ]]
      [[ "${10}" == *"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"* ]]
      [[ "${10}" == *"src/thinker.ts"* ]]
      [[ "${10}" == *"44444444444444"* ]]
      [[ "${10}" != *"127.0.0.1:3000/health"* ]]
      IFS= read -r payload
      [[ "$payload" =~ ^[0-9a-f]{64}$ ]]
      if IFS= read -r extra; then exit 94; fi
      : > "$proof_dir/thinker-probe.ok"
      exit 0
    fi
    exit 93
    """#
}
