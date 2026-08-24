import Darwin
import Foundation
import LocalAuthentication
import Security
import XCTest

@testable import AgentToolSecretMacOSCore

final class KeychainRoundTripTests: XCTestCase {
  func testSyntheticNoUICreateVerifyDuplicateAndExactCleanup() throws {
    try requireIntegrationGate()

    let suffix = UUID().uuidString.lowercased()
    let service = "agenttool-native-test-\(suffix)"
    let account = "test-\(suffix)"
    let store = SecretStore()
    try cleanup(service: service, account: account, allowAbsent: true)
    defer {
      XCTAssertNoThrow(try cleanup(service: service, account: account, allowAbsent: false))
      XCTAssertThrowsError(
        try store.verifyCanonicalGeneration(service: service, account: account)
      ) { error in
        XCTAssertEqual(error as? SecretToolFailure, .itemAbsent)
      }
    }

    XCTAssertThrowsError(
      try store.verifyCanonicalGeneration(service: service, account: account)
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .itemAbsent)
    }

    try store.createRandom(service: service, account: account)
    XCTAssertNoThrow(
      try store.verifyCanonicalGeneration(service: service, account: account)
    )
    XCTAssertThrowsError(
      try store.createRandom(service: service, account: account)
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .itemExists)
    }

    XCTAssertThrowsError(
      try store.verifyCanonicalGeneration(
        service: service,
        account: "other-\(suffix)"
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

    try requireFixtureAttestation(
      try runBinary(binaryPath, arguments: ["fixture-attest"])
    )
    try requireSuccessWithoutOutput(
      try runBinary(binaryPath, arguments: ["fixture-clean"])
    )
    defer {
      do {
        try requireSuccessWithoutOutput(
          try runBinary(binaryPath, arguments: ["fixture-clean"])
        )
        assertFailure(
          try runBinary(binaryPath, arguments: ["verify"]),
          .itemAbsent
        )
      } catch {
        XCTFail("fixed fixture cleanup did not settle safely")
      }
    }

    assertFailure(
      try runBinary(binaryPath, arguments: ["verify"]),
      .itemAbsent
    )
    try requireSuccessWithoutOutput(
      try runBinary(binaryPath, arguments: ["create"])
    )
    try requireSuccessWithoutOutput(
      try runBinary(binaryPath, arguments: ["verify"])
    )

    assertFailure(
      try runBinary(binaryPath, arguments: ["create"]),
      .itemExists
    )
    assertSuccessWithoutOutput(try runBinary(binaryPath, arguments: ["verify"]))
    assertFailure(
      try runBinary(binaryPath, arguments: ["get"]),
      .invalidInvocation
    )
    assertFailure(
      try runBinary(binaryPath, arguments: ["put", "--policy", "overwrite"]),
      .invalidInvocation
    )
    try requireSuccessWithoutOutput(
      try runBinary(binaryPath, arguments: ["fixture-clean"])
    )
    assertFailure(
      try runBinary(binaryPath, arguments: ["verify"]),
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
  arguments: [String]
) throws -> ProcessResult {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: binaryPath)
  process.arguments = arguments

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
