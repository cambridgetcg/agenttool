import CryptoKit
import Darwin
import Foundation
import Security

struct CeremonyAuthorization: Equatable, Sendable {
  let deployedRevision: String
  let targetMachineID: String?
  let runtimeRole: CeremonyRuntimeRole?
}

enum CeremonyRuntimeRole: String, Equatable, Sendable {
  case app
  case thinkerPrimary = "thinker"
}

protocol CeremonyBindingAuthorizing {
  func authorize(_ command: SecretToolCommand) throws -> CeremonyAuthorization
}

enum CeremonyBindingContract {
  static let schema = "agenttool.covenant-v2-generation-ceremony/1"
  static let app = "agenttool"
  static let markerRelativePath =
    ".local/state/agenttool/deploy-state/phase-b-authority-generation-active.json"
  static let finalReceiptRelativePath =
    ".local/state/agenttool/deploy-state/phase-b-authority-generation-receipt-v1.json"
  static let maximumMarkerBytes = 65_536
  static let nativePath =
    "/usr/local/libexec/agenttool/phase-b-v1/agenttool-secret-macos"
  static let nativeIdentifier = "dev.agenttool.phase-b-authority-generation"
}

struct NativeCeremonyBindingAuthorizer: CeremonyBindingAuthorizing {
  func authorize(_ command: SecretToolCommand) throws -> CeremonyAuthorization {
    let activeMarkerURL = try canonicalActiveMarkerURL()
    let marker: CeremonyMarker
    switch command {
    case .verifyDeployedFly:
      marker = try loadCompletedCeremonyReceipt(
        activeMarkerURL: activeMarkerURL,
        finalReceiptURL: try canonicalFinalReceiptURL()
      )
    default:
      marker = try loadCeremonyDocument(at: activeMarkerURL)
    }
    #if !AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
      try validateNativeIdentity(marker.bindings)
    #endif
    let commandNonce = command.ceremonyNonce
    guard marker.ceremonyNonce == commandNonce.value else {
      throw SecretToolFailure.receiptBindingMismatch
    }

    switch command {
    case .create:
      guard marker.status == "active",
        marker.checkpoint == "create_attempting",
        marker.generation.createAttempted,
        !marker.generation.createVerified,
        marker.attempts.isEmpty,
        marker.final == nil
      else {
        throw SecretToolFailure.ceremonyStateInvalid
      }
      return CeremonyAuthorization(
        deployedRevision: marker.scope.deployedRevision,
        targetMachineID: nil,
        runtimeRole: nil
      )
    case .verify:
      guard marker.checkpoint != "admission_verified",
        marker.generation.createAttempted
      else {
        throw SecretToolFailure.ceremonyStateInvalid
      }
      return CeremonyAuthorization(
        deployedRevision: marker.scope.deployedRevision,
        targetMachineID: nil,
        runtimeRole: nil
      )
    case .stageFly:
      let attempt = try activeAttempt(marker)
      guard marker.status == "active",
        marker.checkpoint == "rollout_active",
        marker.generation.createAttempted,
        marker.generation.createVerified,
        attempt.status == "active",
        attempt.checkpoint == "stage_attempting",
        attempt.stage.attempted,
        !attempt.stage.verified,
        !attempt.deploy.attempted,
        !attempt.deploy.verified,
        attempt.runtimeProbe.attemptedMachineIDs.isEmpty,
        attempt.runtimeProbe.verifiedMachineIDs.isEmpty,
        !attempt.finalGatesVerified,
        marker.final == nil
      else {
        throw SecretToolFailure.ceremonyStateInvalid
      }
      return CeremonyAuthorization(
        deployedRevision: marker.scope.deployedRevision,
        targetMachineID: nil,
        runtimeRole: nil
      )
    case .probeFly(_, let requestedMachineID):
      let attempt = try activeAttempt(marker)
      let attempted = attempt.runtimeProbe.attemptedMachineIDs
      let verified = attempt.runtimeProbe.verifiedMachineIDs
      guard marker.status == "active",
        marker.checkpoint == "rollout_active",
        marker.generation.createAttempted,
        marker.generation.createVerified,
        attempt.status == "active",
        attempt.checkpoint == "runtime_probe_attempting",
        attempt.stage.attempted,
        attempt.stage.verified,
        attempt.deploy.attempted,
        attempt.deploy.verified,
        attempted.count == verified.count + 1,
        attempted.last == requestedMachineID.value,
        marker.scope.startedProbeOrder.contains(requestedMachineID.value),
        requestedMachineID.value != marker.scope.thinkerStandbyMachineID,
        !attempt.finalGatesVerified,
        marker.final == nil
      else {
        throw SecretToolFailure.ceremonyStateInvalid
      }
      return CeremonyAuthorization(
        deployedRevision: marker.scope.deployedRevision,
        targetMachineID: requestedMachineID.value,
        runtimeRole: requestedMachineID.value == marker.scope.thinkerPrimaryMachineID
          ? .thinkerPrimary : .app
      )
    case .verifyDeployedFly(_, let revision, let requestedMachineID):
      try requireAbsent(activeMarkerURL)
      return try completedCeremonyAuthorization(
        marker: marker,
        nonce: commandNonce,
        revision: revision,
        requestedMachineID: requestedMachineID
      )
    }
  }

  private func activeAttempt(_ marker: CeremonyMarker) throws -> CeremonyAttempt {
    guard let attempt = marker.attempts.last, attempt.status == "active" else {
      throw SecretToolFailure.ceremonyStateInvalid
    }
    return attempt
  }
}

private func completedCeremonyAuthorization(
  marker: CeremonyMarker,
  nonce: SecretToolCeremonyNonce,
  revision: SecretToolRevision,
  requestedMachineID: SecretToolMachineID
) throws -> CeremonyAuthorization {
  guard let attempt = marker.attempts.last,
    marker.ceremonyNonce == nonce.value,
    marker.status == "completed",
    marker.checkpoint == "completed",
    marker.generation.createAttempted,
    marker.generation.createVerified,
    marker.final != nil,
    attempt.status == "completed",
    attempt.checkpoint == "completed",
    attempt.stage.attempted,
    attempt.stage.verified,
    attempt.deploy.attempted,
    attempt.deploy.verified,
    attempt.runtimeProbe.attemptedMachineIDs == marker.scope.startedProbeOrder,
    attempt.runtimeProbe.verifiedMachineIDs == marker.scope.startedProbeOrder,
    attempt.finalGatesVerified,
    attempt.failure == nil,
    marker.scope.startedProbeOrder.contains(requestedMachineID.value),
    requestedMachineID.value != marker.scope.thinkerStandbyMachineID
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  return CeremonyAuthorization(
    deployedRevision: revision.value,
    targetMachineID: requestedMachineID.value,
    runtimeRole: requestedMachineID.value == marker.scope.thinkerPrimaryMachineID
      ? .thinkerPrimary : .app
  )
}

func authorizeCompletedCeremonyDocument(
  _ data: Data,
  nonce: SecretToolCeremonyNonce,
  revision: SecretToolRevision,
  requestedMachineID: SecretToolMachineID
) throws -> CeremonyAuthorization {
  try completedCeremonyAuthorization(
    marker: decodeCeremonyDocument(data),
    nonce: nonce,
    revision: revision,
    requestedMachineID: requestedMachineID
  )
}

private struct CeremonyMarker: Decodable {
  let schema: String
  let status: String
  let checkpoint: String
  let ceremonyNonce: String
  let createdAt: String
  let updatedAt: String
  let bindings: CeremonyBindings
  let scope: CeremonyScope
  let interlock: CeremonyInterlock
  let generation: CeremonyGeneration
  let attempts: [CeremonyAttempt]
  let final: CeremonyFinal?

  enum CodingKeys: String, CodingKey {
    case schema, status, checkpoint, bindings, scope, interlock, generation, attempts, final
    case ceremonyNonce = "ceremony_nonce"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }
}

private struct CeremonyBindings: Decodable {
  let operatorRevision: String
  let operatorSourceSHA256: String
  let nativeSHA256: String
  let nativeCDHash: String
  let nativeTeamID: String
  let nativeDesignatedRequirementSHA256: String
  let flyctlSHA256: String
  let phaseAResumeReceiptSHA256: String

  enum CodingKeys: String, CodingKey {
    case operatorRevision = "operator_revision"
    case operatorSourceSHA256 = "operator_source_sha256"
    case nativeSHA256 = "native_sha256"
    case nativeCDHash = "native_cdhash"
    case nativeTeamID = "native_team_id"
    case nativeDesignatedRequirementSHA256 = "native_designated_requirement_sha256"
    case flyctlSHA256 = "flyctl_sha256"
    case phaseAResumeReceiptSHA256 = "phase_a_resume_receipt_sha256"
  }
}

private struct CeremonyScope: Decodable {
  let machineSetSHA256: String
  let roleMapSHA256: String
  let appMachineIDs: [String]
  let thinkerPrimaryMachineID: String
  let thinkerStandbyMachineID: String
  let startedProbeOrder: [String]
  let baselineInventorySHA256: String
  let baselineNonImageConfigSHA256: String
  let imageRefSHA256: String
  let deployedRevision: String

  enum CodingKeys: String, CodingKey {
    case machineSetSHA256 = "machine_set_sha256"
    case roleMapSHA256 = "role_map_sha256"
    case appMachineIDs = "app_machine_ids"
    case thinkerPrimaryMachineID = "thinker_primary_machine_id"
    case thinkerStandbyMachineID = "thinker_standby_machine_id"
    case startedProbeOrder = "started_probe_order"
    case baselineInventorySHA256 = "baseline_inventory_sha256"
    case baselineNonImageConfigSHA256 = "baseline_non_image_config_sha256"
    case imageRefSHA256 = "image_ref_sha256"
    case deployedRevision = "deployed_revision"
  }
}

private struct CeremonyInterlock: Decodable {
  let rowID: Int
  let durableHoldVerified: Bool
  let allowedOriginsCount: Int
  let instanceURLSHA256: String
  let databaseTargetSHA256: String

  enum CodingKeys: String, CodingKey {
    case rowID = "row_id"
    case durableHoldVerified = "durable_hold_verified"
    case allowedOriginsCount = "allowed_origins_count"
    case instanceURLSHA256 = "instance_url_sha256"
    case databaseTargetSHA256 = "database_target_sha256"
  }
}

private struct CeremonyGeneration: Decodable {
  let createAttempted: Bool
  let createVerified: Bool

  enum CodingKeys: String, CodingKey {
    case createAttempted = "create_attempted"
    case createVerified = "create_verified"
  }
}

private struct CeremonyAttempt: Decodable {
  let attemptID: String
  let status: String
  let checkpoint: String
  let startedAt: String
  let updatedAt: String
  let stage: CeremonyTransition
  let deploy: CeremonyTransition
  let runtimeProbe: CeremonyRuntimeProbe
  let finalGatesVerified: Bool
  let failure: CeremonyFailure?

  enum CodingKeys: String, CodingKey {
    case status, checkpoint, stage, deploy, failure
    case attemptID = "attempt_id"
    case startedAt = "started_at"
    case updatedAt = "updated_at"
    case runtimeProbe = "runtime_probe"
    case finalGatesVerified = "final_gates_verified"
  }
}

private struct CeremonyTransition: Decodable {
  let attempted: Bool
  let verified: Bool
}

private struct CeremonyRuntimeProbe: Decodable {
  let attemptedMachineIDs: [String]
  let verifiedMachineIDs: [String]

  enum CodingKeys: String, CodingKey {
    case attemptedMachineIDs = "attempted_machine_ids"
    case verifiedMachineIDs = "verified_machine_ids"
  }
}

private struct CeremonyFailure: Decodable, Equatable {
  let code: String
  let atCheckpoint: String
  let observedAt: String

  enum CodingKeys: String, CodingKey {
    case code
    case atCheckpoint = "at_checkpoint"
    case observedAt = "observed_at"
  }
}

private struct CeremonyFinal: Decodable {
  let completedAt: String
  let finalInventorySHA256: String
  let finalSecretStatus: String
  let runtimeVerifiedCount: Int
  let reservedGenerationRows: Int
  let authoritativeV2Rows: Int
  let allowedOriginsCount: Int

  enum CodingKeys: String, CodingKey {
    case completedAt = "completed_at"
    case finalInventorySHA256 = "final_inventory_sha256"
    case finalSecretStatus = "final_secret_status"
    case runtimeVerifiedCount = "runtime_verified_count"
    case reservedGenerationRows = "reserved_generation_rows"
    case authoritativeV2Rows = "authoritative_v2_rows"
    case allowedOriginsCount = "allowed_origins_count"
  }
}

private func canonicalActiveMarkerURL() throws -> URL {
  #if AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
    guard let path = ProcessInfo.processInfo.environment["AGENTTOOL_SECRET_MACOS_MARKER"],
      path.hasPrefix("/")
    else {
      throw SecretToolFailure.ceremonyStateInvalid
    }
    return URL(fileURLWithPath: path)
  #else
    let home = try currentUserHome()
    return URL(fileURLWithPath: home).appendingPathComponent(
      CeremonyBindingContract.markerRelativePath,
      isDirectory: false
    )
  #endif
}

private func canonicalFinalReceiptURL() throws -> URL {
  #if AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
    guard
      let path = ProcessInfo.processInfo.environment[
        "AGENTTOOL_SECRET_MACOS_FINAL_RECEIPT"
      ], path.hasPrefix("/")
    else {
      throw SecretToolFailure.ceremonyStateInvalid
    }
    return URL(fileURLWithPath: path)
  #else
    let home = try currentUserHome()
    return URL(fileURLWithPath: home).appendingPathComponent(
      CeremonyBindingContract.finalReceiptRelativePath,
      isDirectory: false
    )
  #endif
}

private func loadCompletedCeremonyReceipt(
  activeMarkerURL: URL,
  finalReceiptURL: URL
) throws -> CeremonyMarker {
  guard
    activeMarkerURL.deletingLastPathComponent().standardizedFileURL
      == finalReceiptURL.deletingLastPathComponent().standardizedFileURL
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  try requireAbsent(activeMarkerURL)
  let marker = try loadCeremonyDocument(at: finalReceiptURL)
  try requireAbsent(activeMarkerURL)
  return marker
}

func validateCompletedCeremonyReceiptFiles(
  activeMarkerURL: URL,
  finalReceiptURL: URL
) throws {
  _ = try loadCompletedCeremonyReceipt(
    activeMarkerURL: activeMarkerURL,
    finalReceiptURL: finalReceiptURL
  )
}

private func requireAbsent(_ url: URL) throws {
  var metadata = stat()
  errno = 0
  guard lstat(url.path, &metadata) == -1, errno == ENOENT else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
}

private func loadCeremonyDocument(at markerURL: URL) throws -> CeremonyMarker {
  let data = try readPrivateRegularFile(
    markerURL,
    maximumBytes: CeremonyBindingContract.maximumMarkerBytes
  )
  return try decodeCeremonyDocument(data)
}

private func decodeCeremonyDocument(_ data: Data) throws -> CeremonyMarker {
  guard data.last == 0x0A else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  let body = data.dropLast()
  let object: Any
  do {
    object = try JSONSerialization.jsonObject(with: Data(body), options: [])
  } catch {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  guard let root = object as? [String: Any] else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  try validateExactMarkerKeys(root)
  let canonical: Data
  do {
    var encoded = try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
    encoded.append(0x0A)
    canonical = encoded
  } catch {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  guard canonical == data else {
    throw SecretToolFailure.ceremonyStateInvalid
  }

  let marker: CeremonyMarker
  do {
    marker = try JSONDecoder().decode(CeremonyMarker.self, from: Data(body))
  } catch {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  try validateMarker(marker)
  return marker
}

private func validateMarker(_ marker: CeremonyMarker) throws {
  guard marker.schema == CeremonyBindingContract.schema,
    ["active", "failed_or_uncertain", "completed"].contains(marker.status),
    isSafeCode(marker.checkpoint),
    isCanonicalTimestamp(marker.createdAt),
    isCanonicalTimestamp(marker.updatedAt),
    marker.createdAt <= marker.updatedAt,
    (try? SecretToolCeremonyNonce(marker.ceremonyNonce)) != nil,
    marker.bindings.flyctlSHA256 == FlyGenerationContract.flyctlSHA256,
    isRevision(marker.bindings.operatorRevision),
    isDigest(marker.bindings.operatorSourceSHA256),
    isDigest(marker.bindings.nativeSHA256),
    isCDHash(marker.bindings.nativeCDHash),
    isTeamID(marker.bindings.nativeTeamID),
    isDigest(marker.bindings.nativeDesignatedRequirementSHA256),
    isDigest(marker.bindings.phaseAResumeReceiptSHA256),
    marker.scope.appMachineIDs.count == 3,
    marker.scope.appMachineIDs == marker.scope.appMachineIDs.sorted(),
    Set(marker.scope.appMachineIDs).count == 3,
    marker.scope.appMachineIDs.allSatisfy(isMachineID),
    isMachineID(marker.scope.thinkerPrimaryMachineID),
    isMachineID(marker.scope.thinkerStandbyMachineID),
    marker.scope.thinkerPrimaryMachineID != marker.scope.thinkerStandbyMachineID,
    !marker.scope.appMachineIDs.contains(marker.scope.thinkerPrimaryMachineID),
    !marker.scope.appMachineIDs.contains(marker.scope.thinkerStandbyMachineID),
    marker.scope.startedProbeOrder
      == marker.scope.appMachineIDs + [marker.scope.thinkerPrimaryMachineID],
    isDigest(marker.scope.machineSetSHA256),
    isDigest(marker.scope.roleMapSHA256),
    isDigest(marker.scope.baselineInventorySHA256),
    isDigest(marker.scope.baselineNonImageConfigSHA256),
    isDigest(marker.scope.imageRefSHA256),
    isRevision(marker.scope.deployedRevision),
    marker.interlock.rowID == 1,
    marker.interlock.durableHoldVerified,
    marker.interlock.allowedOriginsCount == 0,
    isDigest(marker.interlock.instanceURLSHA256),
    isDigest(marker.interlock.databaseTargetSHA256),
    marker.generation.createAttempted,
    marker.attempts.count <= 16,
    marker.attempts.isEmpty || marker.generation.createVerified
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }

  var previousAttemptCompleted = false
  var attemptIDs = Set<String>()
  for (index, attempt) in marker.attempts.enumerated() {
    guard !previousAttemptCompleted,
      (try? SecretToolCeremonyNonce(attempt.attemptID)) != nil,
      attemptIDs.insert(attempt.attemptID).inserted,
      ["active", "failed_or_uncertain", "completed"].contains(attempt.status),
      isSafeCode(attempt.checkpoint),
      isCanonicalTimestamp(attempt.startedAt),
      isCanonicalTimestamp(attempt.updatedAt),
      attempt.startedAt <= attempt.updatedAt,
      prefix(attempt.runtimeProbe.attemptedMachineIDs, of: marker.scope.startedProbeOrder),
      prefix(attempt.runtimeProbe.verifiedMachineIDs, of: attempt.runtimeProbe.attemptedMachineIDs),
      Set(attempt.runtimeProbe.attemptedMachineIDs).count
        == attempt.runtimeProbe.attemptedMachineIDs.count,
      Set(attempt.runtimeProbe.verifiedMachineIDs).count
        == attempt.runtimeProbe.verifiedMachineIDs.count,
      !attempt.stage.verified || attempt.stage.attempted,
      !attempt.deploy.attempted || attempt.stage.verified,
      !attempt.deploy.verified || attempt.deploy.attempted,
      attempt.runtimeProbe.attemptedMachineIDs.isEmpty || attempt.deploy.verified,
      !attempt.finalGatesVerified
        || attempt.runtimeProbe.verifiedMachineIDs == marker.scope.startedProbeOrder,
      attempt.status != "active" || index == marker.attempts.count - 1,
      attempt.status != "completed" || attempt.finalGatesVerified,
      attempt.status != "failed_or_uncertain" || attempt.failure != nil,
      index == marker.attempts.count - 1 || attempt.status == "failed_or_uncertain"
    else {
      throw SecretToolFailure.ceremonyStateInvalid
    }
    if let failure = attempt.failure {
      guard attempt.status == "failed_or_uncertain",
        isSafeCode(failure.code),
        isSafeCode(failure.atCheckpoint),
        isCanonicalTimestamp(failure.observedAt)
      else {
        throw SecretToolFailure.ceremonyStateInvalid
      }
    }
    previousAttemptCompleted = attempt.status == "completed"
  }

  if let final = marker.final {
    guard marker.status == "completed",
      marker.checkpoint == "completed",
      marker.attempts.last?.status == "completed",
      isCanonicalTimestamp(final.completedAt),
      isDigest(final.finalInventorySHA256),
      final.finalSecretStatus == "Deployed",
      final.runtimeVerifiedCount == 4,
      final.reservedGenerationRows == 0,
      final.authoritativeV2Rows == 0,
      final.allowedOriginsCount == 0
    else {
      throw SecretToolFailure.ceremonyStateInvalid
    }
  } else if marker.status == "completed" || marker.checkpoint == "completed" {
    throw SecretToolFailure.ceremonyStateInvalid
  }
}

private func validateExactMarkerKeys(_ root: [String: Any]) throws {
  try exactKeys(
    root,
    [
      "schema", "status", "checkpoint", "ceremony_nonce", "created_at", "updated_at",
      "bindings", "scope", "interlock", "generation", "attempts", "final",
    ])
  let bindings = try dictionary(root["bindings"])
  try exactKeys(
    bindings,
    [
      "operator_revision", "operator_source_sha256", "native_sha256", "native_cdhash",
      "native_team_id", "native_designated_requirement_sha256", "flyctl_sha256",
      "phase_a_resume_receipt_sha256",
    ])
  let scope = try dictionary(root["scope"])
  try exactKeys(
    scope,
    [
      "machine_set_sha256", "role_map_sha256", "app_machine_ids",
      "thinker_primary_machine_id", "thinker_standby_machine_id", "started_probe_order",
      "baseline_inventory_sha256", "baseline_non_image_config_sha256", "image_ref_sha256",
      "deployed_revision",
    ])
  let interlock = try dictionary(root["interlock"])
  try exactKeys(
    interlock,
    [
      "row_id", "durable_hold_verified", "allowed_origins_count", "instance_url_sha256",
      "database_target_sha256",
    ])
  try exactKeys(
    try dictionary(root["generation"]),
    ["create_attempted", "create_verified"]
  )
  guard let attempts = root["attempts"] as? [Any] else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  for value in attempts {
    let attempt = try dictionary(value)
    try exactKeys(
      attempt,
      [
        "attempt_id", "status", "checkpoint", "started_at", "updated_at", "stage", "deploy",
        "runtime_probe", "final_gates_verified", "failure",
      ])
    try exactKeys(try dictionary(attempt["stage"]), ["attempted", "verified"])
    try exactKeys(try dictionary(attempt["deploy"]), ["attempted", "verified"])
    try exactKeys(
      try dictionary(attempt["runtime_probe"]),
      ["attempted_machine_ids", "verified_machine_ids"]
    )
    if let failure = attempt["failure"], !(failure is NSNull) {
      try exactKeys(
        try dictionary(failure),
        ["code", "at_checkpoint", "observed_at"]
      )
    }
  }
  if let final = root["final"], !(final is NSNull) {
    try exactKeys(
      try dictionary(final),
      [
        "completed_at", "final_inventory_sha256", "final_secret_status",
        "runtime_verified_count", "reserved_generation_rows", "authoritative_v2_rows",
        "allowed_origins_count",
      ])
  }
}

private func exactKeys(_ value: [String: Any], _ expected: Set<String>) throws {
  guard Set(value.keys) == expected else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
}

private func dictionary(_ value: Any?) throws -> [String: Any] {
  guard let result = value as? [String: Any] else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  return result
}

private func prefix(_ candidate: [String], of full: [String]) -> Bool {
  candidate.count <= full.count && Array(full.prefix(candidate.count)) == candidate
}

private func isMachineID(_ value: String) -> Bool {
  let bytes = Array(value.utf8)
  return bytes.count == 14 && bytes.allSatisfy(isLowercaseHexByte)
}

private func isRevision(_ value: String) -> Bool {
  let bytes = Array(value.utf8)
  return bytes.count == 40 && bytes.allSatisfy(isLowercaseHexByte)
}

private func isDigest(_ value: String) -> Bool {
  value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
}

private func isCDHash(_ value: String) -> Bool {
  value.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil
}

private func isTeamID(_ value: String) -> Bool {
  value.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil
}

private func isSafeCode(_ value: String) -> Bool {
  let bytes = Array(value.utf8)
  return !bytes.isEmpty && bytes.count <= 64
    && bytes.allSatisfy {
      ($0 >= 0x61 && $0 <= 0x7A) || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x5F
    }
}

func isCanonicalTimestamp(_ value: String) -> Bool {
  guard
    value.range(
      of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
      options: .regularExpression
    ) != nil
  else {
    return false
  }
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  formatter.timeZone = TimeZone(secondsFromGMT: 0)
  guard let date = formatter.date(from: value) else { return false }
  return formatter.string(from: date) == value
}

private func validateNativeIdentity(_ bindings: CeremonyBindings) throws {
  let path = CeremonyBindingContract.nativePath
  for directory in [
    "/usr", "/usr/local", "/usr/local/libexec", "/usr/local/libexec/agenttool",
    "/usr/local/libexec/agenttool/phase-b-v1",
  ] {
    var metadata = stat()
    guard lstat(directory, &metadata) == 0,
      (metadata.st_mode & S_IFMT) == S_IFDIR,
      metadata.st_uid == 0,
      metadata.st_gid == 0,
      metadata.st_mode & 0o777 == 0o755
    else {
      throw SecretToolFailure.ceremonyStateInvalid
    }
  }
  var metadata = stat()
  guard lstat(path, &metadata) == 0,
    (metadata.st_mode & S_IFMT) == S_IFREG,
    metadata.st_uid == 0,
    metadata.st_gid == 0,
    metadata.st_nlink == 1,
    metadata.st_mode & 0o777 == 0o555,
    try hashFile(path) == bindings.nativeSHA256
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }

  let runningPath = try currentExecutablePath()
  var runningMetadata = stat()
  guard lstat(runningPath, &runningMetadata) == 0,
    (runningMetadata.st_mode & S_IFMT) == S_IFREG,
    executableIdentityMatches(
      installedPath: path,
      runningPath: runningPath,
      installedDevice: UInt64(truncatingIfNeeded: metadata.st_dev),
      installedInode: UInt64(truncatingIfNeeded: metadata.st_ino),
      runningDevice: UInt64(truncatingIfNeeded: runningMetadata.st_dev),
      runningInode: UInt64(truncatingIfNeeded: runningMetadata.st_ino)
    )
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }

  var staticCode: SecStaticCode?
  let developerIDRequirement = try developerIDApplicationRequirement(
    teamID: bindings.nativeTeamID
  )
  guard
    SecStaticCodeCreateWithPath(
      URL(fileURLWithPath: path) as CFURL,
      SecCSFlags(),
      &staticCode
    ) == errSecSuccess,
    let staticCode,
    SecStaticCodeCheckValidity(
      staticCode,
      SecCSFlags(rawValue: kSecCSStrictValidate),
      developerIDRequirement
    )
      == errSecSuccess
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var information: CFDictionary?
  guard
    SecCodeCopySigningInformation(
      staticCode,
      SecCSFlags(rawValue: kSecCSSigningInformation),
      &information
    ) == errSecSuccess,
    let values = information as? [CFString: Any],
    values[kSecCodeInfoIdentifier] as? String == CeremonyBindingContract.nativeIdentifier,
    values[kSecCodeInfoTeamIdentifier] as? String == bindings.nativeTeamID,
    let unique = values[kSecCodeInfoUnique] as? Data,
    hex(unique) == bindings.nativeCDHash,
    let flags = values[kSecCodeInfoFlags] as? NSNumber,
    // CS_RUNTIME (0x10000) is required; CS_ADHOC (0x2) is forbidden.
    flags.uint32Value & 0x1_0000 != 0,
    flags.uint32Value & 0x2 == 0,
    signingInformationHasTrustedTimestamp(values)
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  if let entitlements = values[kSecCodeInfoEntitlementsDict] as? [String: Any],
    !entitlements.isEmpty
  {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var requirement: SecRequirement?
  guard
    SecCodeCopyDesignatedRequirement(staticCode, SecCSFlags(), &requirement)
      == errSecSuccess,
    let requirement
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var requirementText: CFString?
  guard
    SecRequirementCopyString(requirement, SecCSFlags(), &requirementText)
      == errSecSuccess,
    let requirementText,
    sha256(Data((requirementText as String).utf8))
      == bindings.nativeDesignatedRequirementSHA256
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }

  try validateRunningCodeIdentity(bindings, developerIDRequirement: developerIDRequirement)
}

func developerIDApplicationRequirementText(teamID: String) throws -> String {
  let bytes = Array(teamID.utf8)
  guard bytes.count == 10,
    bytes.allSatisfy({
      ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x30 && $0 <= 0x39)
    })
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  return
    "identifier \"\(CeremonyBindingContract.nativeIdentifier)\" and anchor apple generic and certificate leaf[subject.OU] = \"\(teamID)\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
}

private func developerIDApplicationRequirement(teamID: String) throws -> SecRequirement {
  var requirement: SecRequirement?
  let text = try developerIDApplicationRequirementText(teamID: teamID)
  guard
    SecRequirementCreateWithString(text as CFString, SecCSFlags(), &requirement)
      == errSecSuccess,
    let requirement
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  return requirement
}

func signingInformationHasTrustedTimestamp(_ values: [CFString: Any]) -> Bool {
  guard let timestamp = values[kSecCodeInfoTimestamp] as? Date else { return false }
  return timestamp.timeIntervalSince1970.isFinite
}

func executableIdentityMatches(
  installedPath: String,
  runningPath: String,
  installedDevice: UInt64,
  installedInode: UInt64,
  runningDevice: UInt64,
  runningInode: UInt64
) -> Bool {
  installedPath == runningPath
    && installedDevice == runningDevice
    && installedInode == runningInode
}

private func currentExecutablePath() throws -> String {
  var required: UInt32 = 0
  _ = _NSGetExecutablePath(nil, &required)
  guard required > 1, required <= 16_384 else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var buffer = [CChar](repeating: 0, count: Int(required))
  let result = buffer.withUnsafeMutableBufferPointer { pointer in
    _NSGetExecutablePath(pointer.baseAddress, &required)
  }
  guard result == 0,
    let terminator = buffer.firstIndex(of: 0),
    let executablePath = String(
      bytes: buffer[..<terminator].map { UInt8(bitPattern: $0) },
      encoding: .utf8
    ),
    let resolved = realpath(executablePath, nil)
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  defer { free(resolved) }
  let path = String(cString: resolved)
  guard path == CeremonyBindingContract.nativePath else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  return path
}

private func validateRunningCodeIdentity(
  _ bindings: CeremonyBindings,
  developerIDRequirement: SecRequirement
) throws {
  var runningCode: SecCode?
  guard SecCodeCopySelf(SecCSFlags(), &runningCode) == errSecSuccess,
    let runningCode,
    SecCodeCheckValidity(
      runningCode,
      SecCSFlags(rawValue: kSecCSStrictValidate),
      developerIDRequirement
    ) == errSecSuccess
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var runningStaticCode: SecStaticCode?
  guard
    SecCodeCopyStaticCode(runningCode, SecCSFlags(), &runningStaticCode)
      == errSecSuccess,
    let runningStaticCode
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var information: CFDictionary?
  guard
    SecCodeCopySigningInformation(
      runningStaticCode,
      SecCSFlags(rawValue: kSecCSSigningInformation),
      &information
    ) == errSecSuccess,
    let values = information as? [CFString: Any],
    values[kSecCodeInfoIdentifier] as? String == CeremonyBindingContract.nativeIdentifier,
    values[kSecCodeInfoTeamIdentifier] as? String == bindings.nativeTeamID,
    let unique = values[kSecCodeInfoUnique] as? Data,
    hex(unique) == bindings.nativeCDHash,
    let flags = values[kSecCodeInfoFlags] as? NSNumber,
    flags.uint32Value & 0x1_0000 != 0,
    flags.uint32Value & 0x2 == 0,
    signingInformationHasTrustedTimestamp(values)
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  if let entitlements = values[kSecCodeInfoEntitlementsDict] as? [String: Any],
    !entitlements.isEmpty
  {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var requirement: SecRequirement?
  guard
    SecCodeCopyDesignatedRequirement(runningStaticCode, SecCSFlags(), &requirement)
      == errSecSuccess,
    let requirement
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  var requirementText: CFString?
  guard
    SecRequirementCopyString(requirement, SecCSFlags(), &requirementText)
      == errSecSuccess,
    let requirementText,
    sha256(Data((requirementText as String).utf8))
      == bindings.nativeDesignatedRequirementSHA256
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
}

private func hashFile(_ path: String) throws -> String {
  let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
  defer { try? handle.close() }
  var hasher = SHA256()
  while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
    hasher.update(data: chunk)
  }
  return hex(Data(hasher.finalize()))
}

private func sha256(_ data: Data) -> String {
  hex(Data(SHA256.hash(data: data)))
}

private func hex(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

func currentUserHome() throws -> String {
  guard let record = getpwuid(getuid()), let directory = record.pointee.pw_dir else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  let value = String(cString: directory)
  guard value.hasPrefix("/"), value != "/" else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  return value
}

private func readPrivateRegularFile(_ url: URL, maximumBytes: Int) throws -> Data {
  var parentMetadata = stat()
  let parentPath = url.deletingLastPathComponent().path
  guard lstat(parentPath, &parentMetadata) == 0,
    (parentMetadata.st_mode & S_IFMT) == S_IFDIR,
    parentMetadata.st_uid == getuid(),
    parentMetadata.st_mode & 0o777 == 0o700
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
  guard descriptor >= 0 else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  defer { _ = close(descriptor) }
  var metadata = stat()
  guard fstat(descriptor, &metadata) == 0,
    (metadata.st_mode & S_IFMT) == S_IFREG,
    metadata.st_uid == getuid(),
    metadata.st_nlink == 1,
    metadata.st_mode & 0o777 == 0o600,
    metadata.st_size > 0,
    metadata.st_size <= maximumBytes
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
  guard let data = try? handle.readToEnd(),
    data.count == Int(metadata.st_size),
    data.count <= maximumBytes
  else {
    throw SecretToolFailure.ceremonyStateInvalid
  }
  return data
}
