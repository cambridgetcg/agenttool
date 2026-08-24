import Darwin
import Foundation
import LocalAuthentication
import Security
import XCTest

@testable import AgentToolSecretMacOSCore

final class ContractTests: XCTestCase {
  private let service = "agenttool-covenant-v2-authority-generation"
  private let account = "macair"
  private let rawGeneration = Data((0..<32).map { UInt8($0) })
  private let receiptNonce = "000102030405060708090a0b0c0d0e0f"
  private let receiptNonceData = Data((0..<16).map { UInt8($0) })
  private let machineID = "1234567890abcd"
  private let revision = String(repeating: "a", count: 40)
  private let serializedGeneration = Data(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f".utf8
  )

  func testParsesOnlyNonceBoundNonExportingGrammar() throws {
    let nonce = try SecretToolCeremonyNonce(receiptNonce)
    let machine = try SecretToolMachineID(machineID)
    let deployedRevision = try SecretToolRevision(revision)
    XCTAssertEqual(
      try SecretToolCommand.parse(["create", "--receipt-nonce", receiptNonce]),
      .create(nonce)
    )
    XCTAssertEqual(
      try SecretToolCommand.parse(["verify", "--receipt-nonce", receiptNonce]),
      .verify(nonce)
    )
    XCTAssertEqual(
      try SecretToolCommand.parse(["stage-fly", "--receipt-nonce", receiptNonce]),
      .stageFly(nonce)
    )
    XCTAssertEqual(
      try SecretToolCommand.parse([
        "probe-fly", "--receipt-nonce", receiptNonce, "--machine", machineID,
      ]),
      .probeFly(nonce, machine)
    )
    XCTAssertEqual(
      try SecretToolCommand.parse([
        "verify-deployed-fly", "--receipt-nonce", receiptNonce,
        "--revision", revision, "--machine", machineID,
      ]),
      .verifyDeployedFly(nonce, deployedRevision, machine)
    )

    for invalid in [
      [] as [String],
      ["create"],
      ["verify"],
      ["stage-fly"],
      ["probe-fly"],
      ["verify-deployed-fly"],
      ["create", "extra"],
      ["verify", "extra"],
      ["put"],
      ["put", "--policy", "create-only"],
      ["put", "--policy", "overwrite"],
      ["get"],
      ["delete"],
      ["fixture-attest"],
      ["fixture-clean"],
      ["create", "--service", service, "--account", account],
      ["probe-fly", "--machine", machineID, "--receipt-nonce", receiptNonce],
      ["probe-fly", "--receipt-nonce", receiptNonce, "--machine", machineID, "extra"],
      [
        "verify-deployed-fly", "--receipt-nonce", receiptNonce,
        "--machine", machineID, "--revision", revision,
      ],
      [
        "verify-deployed-fly", "--receipt-nonce", receiptNonce,
        "--revision", revision, "--machine", machineID, "extra",
      ],
    ] {
      XCTAssertThrowsError(try SecretToolCommand.parse(invalid)) { error in
        XCTAssertEqual(error as? SecretToolFailure, .invalidInvocation)
      }
    }
    XCTAssertThrowsError(
      try SecretToolCommand.parse([
        "verify-deployed-fly", "--receipt-nonce", receiptNonce,
        "--revision", String(repeating: "A", count: 40),
        "--machine", machineID,
      ])
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .invalidRevision)
    }
  }

  func testProductionSelectorsAreFixedAndAlternateSelectorsStayValidated() {
    XCTAssertEqual(SecretToolSelectors.phaseBAuthority.service, service)
    XCTAssertEqual(SecretToolSelectors.phaseBAuthority.account, account)
    let cases = [
      ("other-secret", account),
      ("agenttool-UPPER", account),
      ("agenttool-secret\nleak", account),
      (service, "bad account"),
      (service, "-leading"),
    ]
    for (candidateService, candidateAccount) in cases {
      XCTAssertThrowsError(
        try SecretToolSelectors(
          service: candidateService,
          account: candidateAccount
        )
      ) { error in
        XCTAssertEqual(error as? SecretToolFailure, .invalidSelector)
      }
    }
  }

  func testReceiptNonceIsExactlyDecodedAndRejectsNonCanonicalForms() throws {
    XCTAssertEqual(try SecretToolCeremonyNonce(receiptNonce).data, receiptNonceData)
    for invalid in [
      "", "000102030405060708090a0b0c0d0e", "000102030405060708090a0b0c0d0e0f00",
      "000102030405060708090A0B0C0D0E0F", "000102030405060708090a0b0c0d0e0g",
    ] {
      XCTAssertThrowsError(try SecretToolCeremonyNonce(invalid)) { error in
        XCTAssertEqual(error as? SecretToolFailure, .invalidCeremonyNonce)
      }
    }
  }

  func testRevisionIsStrictLowercaseCommitHex() throws {
    XCTAssertEqual(try SecretToolRevision(revision).value, revision)
    for invalid in [
      "", String(repeating: "a", count: 39), String(repeating: "a", count: 41),
      String(repeating: "A", count: 40), String(repeating: "g", count: 40),
      String(repeating: "a", count: 40) + "\n",
    ] {
      XCTAssertThrowsError(try SecretToolRevision(invalid)) { error in
        XCTAssertEqual(error as? SecretToolFailure, .invalidRevision)
      }
    }
  }

  func testMachineIDIsStrictLowercaseHex() throws {
    XCTAssertEqual(try SecretToolMachineID(machineID).value, machineID)
    for invalid in [
      "", String(repeating: "a", count: 13), String(repeating: "a", count: 15),
      String(repeating: "A", count: 14), String(repeating: "g", count: 14),
      String(repeating: "a", count: 14) + "\n",
    ] {
      XCTAssertThrowsError(try SecretToolMachineID(invalid)) { error in
        XCTAssertEqual(error as? SecretToolFailure, .invalidMachineID)
      }
    }
  }

  func testCompletedReceiptAdmissionBindsNonceMachineRoleAndRequestedRevision() throws {
    XCTAssertEqual(
      CeremonyBindingContract.finalReceiptRelativePath,
      ".local/state/agenttool/deploy-state/phase-b-authority-generation-receipt-v1.json"
    )
    let nonce = try SecretToolCeremonyNonce(receiptNonce)
    let requestedRevision = try SecretToolRevision(String(repeating: "b", count: 40))

    let app = try authorizeCompletedCeremonyDocument(
      completedReceiptData(),
      nonce: nonce,
      revision: requestedRevision,
      requestedMachineID: try SecretToolMachineID("11111111111111")
    )
    XCTAssertEqual(app.deployedRevision, requestedRevision.value)
    XCTAssertEqual(app.targetMachineID, "11111111111111")
    XCTAssertEqual(app.runtimeRole, .app)

    let thinker = try authorizeCompletedCeremonyDocument(
      completedReceiptData(),
      nonce: nonce,
      revision: requestedRevision,
      requestedMachineID: try SecretToolMachineID("44444444444444")
    )
    XCTAssertEqual(thinker.runtimeRole, .thinkerPrimary)

    for refusedMachine in ["55555555555555", "66666666666666"] {
      XCTAssertThrowsError(
        try authorizeCompletedCeremonyDocument(
          completedReceiptData(),
          nonce: nonce,
          revision: requestedRevision,
          requestedMachineID: try SecretToolMachineID(refusedMachine)
        )
      ) { error in
        XCTAssertEqual(error as? SecretToolFailure, .ceremonyStateInvalid)
      }
    }
    XCTAssertThrowsError(
      try authorizeCompletedCeremonyDocument(
        completedReceiptData(),
        nonce: try SecretToolCeremonyNonce(String(repeating: "f", count: 32)),
        revision: requestedRevision,
        requestedMachineID: try SecretToolMachineID("11111111111111")
      )
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .ceremonyStateInvalid)
    }

  }

  func testCompletedReceiptAdmissionRequiresEveryFinalAndRuntimeGate() throws {
    let mutations: [(String, (inout [String: Any]) -> Void)] = [
      (
        "generation",
        { marker in
          marker["generation"] = ["create_attempted": true, "create_verified": false]
        }
      ),
      (
        "attempt checkpoint",
        { marker in
          var attempts = marker["attempts"] as! [[String: Any]]
          attempts[0]["checkpoint"] = "final_gates_verified"
          marker["attempts"] = attempts
        }
      ),
      (
        "stage",
        { marker in
          var attempts = marker["attempts"] as! [[String: Any]]
          attempts[0]["stage"] = ["attempted": true, "verified": false]
          marker["attempts"] = attempts
        }
      ),
      (
        "runtime prefix",
        { marker in
          var attempts = marker["attempts"] as! [[String: Any]]
          attempts[0]["runtime_probe"] = [
            "attempted_machine_ids": [
              "11111111111111", "22222222222222", "33333333333333",
            ],
            "verified_machine_ids": [
              "11111111111111", "22222222222222", "33333333333333",
            ],
          ]
          attempts[0]["final_gates_verified"] = false
          marker["attempts"] = attempts
        }
      ),
      (
        "completed failure",
        { marker in
          var attempts = marker["attempts"] as! [[String: Any]]
          attempts[0]["failure"] = [
            "code": "unexpected_failure",
            "at_checkpoint": "completed",
            "observed_at": "2026-08-24T00:00:00.000Z",
          ]
          marker["attempts"] = attempts
        }
      ),
      (
        "final",
        { marker in marker["final"] = NSNull() }
      ),
    ]
    let nonce = try SecretToolCeremonyNonce(receiptNonce)
    let requestedRevision = try SecretToolRevision(revision)
    let machine = try SecretToolMachineID("11111111111111")

    for (label, mutate) in mutations {
      XCTAssertThrowsError(
        try authorizeCompletedCeremonyDocument(
          completedReceiptData(mutate: mutate),
          nonce: nonce,
          revision: requestedRevision,
          requestedMachineID: machine
        ),
        label
      ) { error in
        XCTAssertEqual(error as? SecretToolFailure, .ceremonyStateInvalid, label)
      }
    }
  }

  func testCompletedReceiptLoaderRequiresPrivateCanonicalFileAndAbsentActiveMarker() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "agenttool-completed-receipt-\(UUID().uuidString.lowercased())",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: root,
      withIntermediateDirectories: false,
      attributes: [.posixPermissions: 0o700]
    )
    guard chmod(root.path, 0o700) == 0 else {
      XCTFail("could not secure fixture directory")
      return
    }
    defer { try? FileManager.default.removeItem(at: root) }

    let active = root.appendingPathComponent("phase-b-authority-generation-active.json")
    let receipt = root.appendingPathComponent(
      "phase-b-authority-generation-receipt-v1.json"
    )
    try completedReceiptData().write(to: receipt, options: .atomic)
    guard chmod(receipt.path, 0o600) == 0 else {
      XCTFail("could not secure receipt fixture")
      return
    }
    XCTAssertNoThrow(
      try validateCompletedCeremonyReceiptFiles(
        activeMarkerURL: active,
        finalReceiptURL: receipt
      )
    )

    try Data("occupied\n".utf8).write(to: active)
    guard chmod(active.path, 0o600) == 0 else {
      XCTFail("could not secure active fixture")
      return
    }
    XCTAssertThrowsError(
      try validateCompletedCeremonyReceiptFiles(
        activeMarkerURL: active,
        finalReceiptURL: receipt
      )
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .ceremonyStateInvalid)
    }

    try FileManager.default.removeItem(at: active)
    try FileManager.default.createSymbolicLink(
      at: active,
      withDestinationURL: root.appendingPathComponent("missing-active-target")
    )
    XCTAssertThrowsError(
      try validateCompletedCeremonyReceiptFiles(
        activeMarkerURL: active,
        finalReceiptURL: receipt
      )
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .ceremonyStateInvalid)
    }

    try FileManager.default.removeItem(at: active)
    guard chmod(receipt.path, 0o644) == 0 else {
      XCTFail("could not alter receipt fixture")
      return
    }
    XCTAssertThrowsError(
      try validateCompletedCeremonyReceiptFiles(
        activeMarkerURL: active,
        finalReceiptURL: receipt
      )
    ) { error in
      XCTAssertEqual(error as? SecretToolFailure, .ceremonyStateInvalid)
    }
  }

  func testMarkerTimestampsAndRunningExecutableBindingAreExact() {
    XCTAssertTrue(isCanonicalTimestamp("2026-08-24T12:34:56.789Z"))
    for invalid in [
      "2026-08-24T12:34:56Z",
      "2026-08-24T12:34:56.78Z",
      "2026-08-24T12:34:56.789+00:00",
      "2026-02-30T12:34:56.789Z",
      "2026-13-24T12:34:56.789Z",
    ] {
      XCTAssertFalse(isCanonicalTimestamp(invalid), invalid)
    }

    XCTAssertTrue(
      executableIdentityMatches(
        installedPath: "/usr/local/libexec/agenttool/phase-b-v1/agenttool-secret-macos",
        runningPath: "/usr/local/libexec/agenttool/phase-b-v1/agenttool-secret-macos",
        installedDevice: 4,
        installedInode: 9,
        runningDevice: 4,
        runningInode: 9
      )
    )
    XCTAssertFalse(
      executableIdentityMatches(
        installedPath: "/usr/local/libexec/agenttool/phase-b-v1/agenttool-secret-macos",
        runningPath: "/tmp/agenttool-secret-macos",
        installedDevice: 4,
        installedInode: 9,
        runningDevice: 4,
        runningInode: 9
      )
    )
    XCTAssertFalse(
      executableIdentityMatches(
        installedPath: "/usr/local/libexec/agenttool/phase-b-v1/agenttool-secret-macos",
        runningPath: "/usr/local/libexec/agenttool/phase-b-v1/agenttool-secret-macos",
        installedDevice: 4,
        installedInode: 9,
        runningDevice: 4,
        runningInode: 10
      )
    )
  }

  func testDeveloperIDIdentityRequiresAppleChainAndTrustedTimestamp() throws {
    let teamID = "ABCDE12345"
    let text = try developerIDApplicationRequirementText(teamID: teamID)
    XCTAssertEqual(
      text,
      "identifier \"dev.agenttool.phase-b-authority-generation\" and anchor apple generic and certificate leaf[subject.OU] = \"ABCDE12345\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
    )
    var requirement: SecRequirement?
    XCTAssertEqual(
      SecRequirementCreateWithString(text as CFString, SecCSFlags(), &requirement),
      errSecSuccess
    )
    XCTAssertNotNil(requirement)
    for invalid in ["", "ABCDE1234", "abcde12345", "ABCDE-2345", "ABCDE123456"] {
      XCTAssertThrowsError(try developerIDApplicationRequirementText(teamID: invalid)) {
        error in
        XCTAssertEqual(error as? SecretToolFailure, .ceremonyStateInvalid)
      }
    }

    XCTAssertTrue(
      signingInformationHasTrustedTimestamp([
        kSecCodeInfoTimestamp: Date(timeIntervalSince1970: 1_777_000_000)
      ])
    )
    let coreFoundationTimestamp = CFDateCreate(kCFAllocatorDefault, 800_000_000)!
    XCTAssertTrue(
      signingInformationHasTrustedTimestamp([
        kSecCodeInfoTimestamp: coreFoundationTimestamp
      ])
    )
    XCTAssertFalse(
      signingInformationHasTrustedTimestamp([
        kSecCodeInfoTime: Date(timeIntervalSince1970: 1_777_000_000)
      ])
    )
    XCTAssertFalse(signingInformationHasTrustedTimestamp([:]))
    XCTAssertFalse(
      signingInformationHasTrustedTimestamp([kSecCodeInfoTimestamp: "not-a-date"])
    )
    XCTAssertFalse(
      signingInformationHasTrustedTimestamp([
        kSecCodeInfoTimestamp: Date(timeIntervalSince1970: .infinity)
      ])
    )
  }

  func testCeremonyIdentityRefusalIsFixedAndPrecedesKeychainAccess() {
    let security = FakeSecurity()
    let result = invokeSecretCommand(
      arguments: ["verify", "--receipt-nonce", receiptNonce],
      security: security,
      random: FakeRandom(.bytes(rawGeneration)),
      ceremony: FakeCeremony(failure: .ceremonyStateInvalid)
    )
    XCTAssertEqual(result.status, SecretToolFailure.ceremonyStateInvalid.exitCode)
    XCTAssertEqual(
      result.stderr,
      Data("agenttool-secret-macos:ceremony_state_invalid\n".utf8)
    )
    XCTAssertTrue(security.copyQueries.isEmpty)
    XCTAssertTrue(security.addAttributes.isEmpty)
  }

  func testCreateGeneratesCanonicalValueAndRequiresIndependentExactReadback() {
    let security = FakeSecurity(
      copies: [
        (errSecItemNotFound, nil),
        (errSecSuccess, exactResult(value: serializedGeneration)),
      ],
      addStatuses: [errSecSuccess]
    )
    let random = FakeRandom(.bytes(rawGeneration))
    let result = invokeSecretCommand(
      arguments: ["create", "--receipt-nonce", receiptNonce],
      security: security,
      random: random
    )

    XCTAssertEqual(result.status, 0)
    XCTAssertEqual(result.stderr, Data())
    XCTAssertEqual(random.requestedCounts, [SecretToolContract.randomByteCount])
    XCTAssertEqual(security.copyQueries.count, 2)
    XCTAssertEqual(security.addAttributes.count, 1)

    assertExactIdentity(security.copyQueries[0])
    assertNoUI(security.copyQueries[0])
    XCTAssertEqual(security.copyQueries[0][kSecReturnAttributes] as? Bool, true)
    XCTAssertNil(security.copyQueries[0][kSecReturnData])
    XCTAssertEqual(
      security.copyQueries[0][kSecMatchLimit] as? String,
      kSecMatchLimitAll as String
    )

    assertExactIdentity(security.copyQueries[1])
    assertNoUI(security.copyQueries[1])
    XCTAssertEqual(security.copyQueries[1][kSecReturnAttributes] as? Bool, true)
    XCTAssertEqual(security.copyQueries[1][kSecReturnData] as? Bool, true)
    assertBoundedDataRead(security.copyQueries[1])

    assertExactIdentity(security.addAttributes[0])
    assertNoUI(security.addAttributes[0])
    XCTAssertEqual(
      security.addAttributes[0][kSecValueData] as? Data,
      serializedGeneration
    )
    XCTAssertEqual(security.addAttributes[0][kSecAttrGeneric] as? Data, receiptNonceData)
    XCTAssertNil(security.copyQueries[0][kSecAttrGeneric])
    XCTAssertNil(security.copyQueries[1][kSecAttrGeneric])
    XCTAssertEqual(serializedGeneration.count, SecretToolContract.serializedByteCount)
  }

  func testCreateRefusesExistingBeforeRandomGeneration() {
    let security = FakeSecurity(copies: [(errSecSuccess, presenceResult())])
    let random = FakeRandom(.bytes(rawGeneration))
    assertFailure(
      invokeSecretCommand(
        arguments: ["create", "--receipt-nonce", receiptNonce],
        security: security,
        random: random
      ),
      .itemExists,
      excluding: [rawGeneration, serializedGeneration]
    )
    XCTAssertTrue(random.requestedCounts.isEmpty)
    XCTAssertTrue(security.addAttributes.isEmpty)

    let ambiguous = FakeSecurity(copies: [
      (errSecSuccess, [exactEntry(), exactEntry()] as [Any])
    ])
    let ambiguousRandom = FakeRandom(.bytes(rawGeneration))
    assertFailure(
      invokeSecretCommand(
        arguments: ["create", "--receipt-nonce", receiptNonce],
        security: ambiguous,
        random: ambiguousRandom
      ),
      .itemAmbiguous,
      excluding: [rawGeneration, serializedGeneration]
    )
    XCTAssertTrue(ambiguousRandom.requestedCounts.isEmpty)
    XCTAssertTrue(ambiguous.addAttributes.isEmpty)
  }

  func testCreateFailsClosedOnDuplicateAddRace() {
    let security = FakeSecurity(
      copies: [(errSecItemNotFound, nil)],
      addStatuses: [errSecDuplicateItem]
    )
    assertFailure(
      invokeSecretCommand(
        arguments: ["create", "--receipt-nonce", receiptNonce],
        security: security,
        random: FakeRandom(.bytes(rawGeneration))
      ),
      .itemExists,
      excluding: [rawGeneration, serializedGeneration]
    )
    XCTAssertEqual(security.addAttributes.count, 1)
    XCTAssertEqual(
      security.addAttributes[0][kSecValueData] as? Data,
      serializedGeneration
    )
  }

  func testGenerationFailureOrWrongLengthCannotWrite() {
    for random in [
      FakeRandom(.failure),
      FakeRandom(.bytes(Data(repeating: 0xAA, count: 31))),
      FakeRandom(.bytes(Data(repeating: 0xAA, count: 33))),
    ] {
      let security = FakeSecurity(copies: [(errSecItemNotFound, nil)])
      assertFailure(
        invokeSecretCommand(
          arguments: ["create", "--receipt-nonce", receiptNonce],
          security: security,
          random: random
        ),
        .generationFailed,
        excluding: [rawGeneration, serializedGeneration]
      )
      XCTAssertEqual(random.requestedCounts, [SecretToolContract.randomByteCount])
      XCTAssertTrue(security.addAttributes.isEmpty)
    }
  }

  func testCreateRequiresCanonicalMatchingReadback() {
    let different = Data(repeating: Character("f").asciiValue!, count: 64)
    let mismatch = FakeSecurity(
      copies: [
        (errSecItemNotFound, nil),
        (errSecSuccess, exactResult(value: different)),
      ],
      addStatuses: [errSecSuccess]
    )
    assertFailure(
      invokeSecretCommand(
        arguments: ["create", "--receipt-nonce", receiptNonce],
        security: mismatch,
        random: FakeRandom(.bytes(rawGeneration))
      ),
      .readbackMismatch,
      excluding: [rawGeneration, serializedGeneration, different]
    )

    let malformed = FakeSecurity(
      copies: [
        (errSecItemNotFound, nil),
        (errSecSuccess, exactResult(value: Data(repeating: 0x41, count: 64))),
      ],
      addStatuses: [errSecSuccess]
    )
    assertFailure(
      invokeSecretCommand(
        arguments: ["create", "--receipt-nonce", receiptNonce],
        security: malformed,
        random: FakeRandom(.bytes(rawGeneration))
      ),
      .readbackFailed,
      excluding: [rawGeneration, serializedGeneration]
    )
  }

  func testVerifyChecksCanonicalPresenceWithoutExportingOrComparingCallerBytes() {
    let security = FakeSecurity(copies: [
      (errSecSuccess, exactResult(value: serializedGeneration))
    ])
    let random = FakeRandom(.failure)
    let result = invokeSecretCommand(
      arguments: ["verify", "--receipt-nonce", receiptNonce],
      security: security,
      random: random
    )

    XCTAssertEqual(result.status, 0)
    XCTAssertEqual(result.stderr, Data())
    XCTAssertTrue(random.requestedCounts.isEmpty)
    XCTAssertTrue(security.addAttributes.isEmpty)
    XCTAssertEqual(security.copyQueries.count, 1)
    assertExactIdentity(security.copyQueries[0])
    assertNoUI(security.copyQueries[0])
    XCTAssertEqual(security.copyQueries[0][kSecReturnData] as? Bool, true)
    assertBoundedDataRead(security.copyQueries[0])
  }

  func testStageAndOneRuntimeProbeAttestBeforeReadingAndKeepValueInsideFlySink() {
    let events = EventRecorder()
    let stageSecurity = FakeSecurity(
      copies: [(errSecSuccess, exactResult(value: serializedGeneration))],
      events: events
    )
    let stageFly = FakeFly(events: events)
    let stage = invokeSecretCommand(
      arguments: ["stage-fly", "--receipt-nonce", receiptNonce],
      security: stageSecurity,
      random: FakeRandom(.failure),
      ceremony: FakeCeremony(events: events),
      fly: stageFly
    )
    XCTAssertEqual(stage.status, 0)
    XCTAssertEqual(stage.stderr, Data())
    XCTAssertEqual(stageFly.staged, [serializedGeneration])
    XCTAssertEqual(events.values, ["authorize", "fly_factory", "keychain_lookup", "fly_stage"])

    let probeEvents = EventRecorder()
    let probeFly = FakeFly(events: probeEvents)
    let probe = invokeSecretCommand(
      arguments: [
        "probe-fly", "--receipt-nonce", receiptNonce, "--machine", machineID,
      ],
      security: FakeSecurity(
        copies: [(errSecSuccess, exactResult(value: serializedGeneration))],
        events: probeEvents
      ),
      random: FakeRandom(.failure),
      ceremony: FakeCeremony(events: probeEvents),
      fly: probeFly
    )
    XCTAssertEqual(probe.status, 0)
    XCTAssertEqual(probe.stderr, Data())
    XCTAssertEqual(probeFly.probes.count, 1)
    XCTAssertEqual(probeFly.probes[0].generation, serializedGeneration)
    XCTAssertEqual(probeFly.probes[0].machineID, machineID)
    XCTAssertEqual(probeFly.probes[0].revision, String(repeating: "a", count: 40))
    XCTAssertEqual(probeFly.probes[0].role, .app)
    XCTAssertEqual(events.values, ["authorize", "fly_factory", "keychain_lookup", "fly_stage"])
    XCTAssertEqual(
      probeEvents.values, ["authorize", "fly_factory", "keychain_lookup", "fly_probe"])

    let deployedEvents = EventRecorder()
    let deployedFly = FakeFly(events: deployedEvents)
    let deployed = invokeSecretCommand(
      arguments: [
        "verify-deployed-fly", "--receipt-nonce", receiptNonce,
        "--revision", revision, "--machine", machineID,
      ],
      security: FakeSecurity(
        copies: [(errSecSuccess, exactResult(value: serializedGeneration))],
        events: deployedEvents
      ),
      random: FakeRandom(.failure),
      ceremony: FakeCeremony(events: deployedEvents),
      fly: deployedFly
    )
    XCTAssertEqual(deployed.status, 0)
    XCTAssertEqual(deployed.stderr, Data())
    XCTAssertEqual(deployedFly.probes.count, 1)
    XCTAssertEqual(deployedFly.probes[0].generation, serializedGeneration)
    XCTAssertEqual(deployedFly.probes[0].machineID, machineID)
    XCTAssertEqual(deployedFly.probes[0].revision, revision)
    XCTAssertEqual(deployedFly.probes[0].role, .app)
    XCTAssertEqual(
      deployedEvents.values, ["authorize", "fly_factory", "keychain_lookup", "fly_probe"])
  }

  func testBindingMismatchStopsBeforeRandomOrFly() {
    let foreignNonce = Data(repeating: 0xFF, count: 16)
    let returned: NSDictionary = [
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecAttrSynchronizable: false,
      kSecAttrGeneric: foreignNonce,
      kSecValueData: serializedGeneration,
    ]
    let random = FakeRandom(.bytes(rawGeneration))
    let fly = FakeFly()
    assertFailure(
      invokeSecretCommand(
        arguments: ["create", "--receipt-nonce", receiptNonce],
        security: FakeSecurity(copies: [(errSecSuccess, [returned] as [Any])]),
        random: random,
        fly: fly
      ),
      .receiptBindingMismatch,
      excluding: [rawGeneration, serializedGeneration, foreignNonce]
    )
    XCTAssertTrue(random.requestedCounts.isEmpty)
    XCTAssertTrue(fly.staged.isEmpty)
    XCTAssertTrue(fly.probes.isEmpty)
  }

  func testVerifyRefusesAbsentNonCanonicalMalformedAndAmbiguousItems() {
    let cases: [(FakeSecurity, SecretToolFailure)] = [
      (FakeSecurity(copies: [(errSecItemNotFound, nil)]), .itemAbsent),
      (
        FakeSecurity(copies: [
          (errSecSuccess, exactResult(value: Data(repeating: 0x41, count: 64)))
        ]),
        .readbackFailed
      ),
      (
        FakeSecurity(copies: [
          (errSecSuccess, exactResult(value: Data(repeating: 0x61, count: 63)))
        ]),
        .readbackFailed
      ),
      (
        FakeSecurity(copies: [
          (errSecSuccess, exactResult(value: Data(repeating: 0x67, count: 64)))
        ]),
        .readbackFailed
      ),
      (FakeSecurity(copies: [(errSecSuccess, ["not-an-item"])]), .readbackFailed),
      (FakeSecurity(copies: [(errSecSuccess, [] as [Any])]), .readbackFailed),
      (
        FakeSecurity(copies: [
          (
            errSecSuccess,
            [
              exactEntry(value: serializedGeneration),
              exactEntry(value: serializedGeneration),
            ] as [Any]
          )
        ]),
        .itemAmbiguous
      ),
    ]

    for (security, failure) in cases {
      assertFailure(
        invokeSecretCommand(
          arguments: ["verify", "--receipt-nonce", receiptNonce],
          security: security,
          random: FakeRandom(.failure)
        ),
        failure,
        excluding: [rawGeneration, serializedGeneration]
      )
    }
  }

  func testRejectsReturnedIdentityOrSynchronizableDrift() {
    let wrongAccount: NSDictionary = [
      kSecAttrService: service,
      kSecAttrAccount: "other-account",
      kSecAttrSynchronizable: false,
      kSecAttrGeneric: receiptNonceData,
      kSecValueData: serializedGeneration,
    ]
    let synchronizable: NSDictionary = [
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecAttrSynchronizable: true,
      kSecAttrGeneric: receiptNonceData,
      kSecValueData: serializedGeneration,
    ]
    for returned in [[wrongAccount] as [Any], [synchronizable] as [Any]] {
      assertFailure(
        invokeSecretCommand(
          arguments: ["verify", "--receipt-nonce", receiptNonce],
          security: FakeSecurity(copies: [(errSecSuccess, returned)]),
          random: FakeRandom(.failure)
        ),
        .readbackFailed,
        excluding: [rawGeneration, serializedGeneration]
      )
    }
  }

  func testMapsBackendFailuresToFixedRedactedCodes() {
    let cases: [(FakeSecurity, SecretToolFailure)] = [
      (FakeSecurity(copies: [(errSecInteractionNotAllowed, nil)]), .interactionForbidden),
      (FakeSecurity(copies: [(errSecUserCanceled, nil)]), .interactionForbidden),
      (FakeSecurity(copies: [(-999_999, nil)]), .readbackFailed),
      (
        FakeSecurity(
          copies: [(errSecItemNotFound, nil)],
          addStatuses: [errSecInteractionNotAllowed]
        ),
        .interactionForbidden
      ),
      (
        FakeSecurity(copies: [(errSecItemNotFound, nil)], addStatuses: [-999_999]),
        .storeFailed
      ),
      (
        FakeSecurity(
          copies: [
            (errSecItemNotFound, nil),
            (errSecInteractionNotAllowed, nil),
          ],
          addStatuses: [errSecSuccess]
        ),
        .interactionForbidden
      ),
      (
        FakeSecurity(
          copies: [
            (errSecItemNotFound, nil),
            (-999_999, nil),
          ],
          addStatuses: [errSecSuccess]
        ),
        .readbackFailed
      ),
    ]

    for (security, failure) in cases {
      assertFailure(
        invokeSecretCommand(
          arguments: ["create", "--receipt-nonce", receiptNonce],
          security: security,
          random: FakeRandom(.bytes(rawGeneration))
        ),
        failure,
        excluding: [rawGeneration, serializedGeneration]
      )
    }
  }

  func testSafeFailureCodesAndExitCodesAreClosedAndUnique() {
    let failures: [SecretToolFailure] = [
      .invalidInvocation,
      .invalidSelector,
      .invalidCeremonyNonce,
      .invalidMachineID,
      .invalidRevision,
      .ceremonyStateInvalid,
      .itemAbsent,
      .itemExists,
      .interactionForbidden,
      .itemAmbiguous,
      .generationFailed,
      .storeFailed,
      .readbackFailed,
      .readbackMismatch,
      .receiptBindingMismatch,
      .flyContractInvalid,
      .flyChildFailed,
      .flyChildTimedOut,
      .flyRuntimeProofFailed,
      .internalFailure,
    ]
    XCTAssertEqual(Set(failures.map(\.safeCode)).count, failures.count)
    XCTAssertEqual(Set(failures.map(\.exitCode)).count, failures.count)
    XCTAssertTrue(failures.allSatisfy { !$0.safeCode.isEmpty && $0.exitCode != 0 })
  }

  private func exactEntry(value: Data? = nil) -> NSDictionary {
    var attributes: [CFString: Any] = [
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecAttrSynchronizable: false,
      kSecAttrGeneric: receiptNonceData,
    ]
    if let value {
      attributes[kSecValueData] = value
    }
    return attributes as NSDictionary
  }

  private func completedReceiptData(
    mutate: ((inout [String: Any]) -> Void)? = nil
  ) throws -> Data {
    let timestamp = "2026-08-24T00:00:00.000Z"
    let digest = String(repeating: "b", count: 64)
    let apps = ["11111111111111", "22222222222222", "33333333333333"]
    let primary = "44444444444444"
    let probeOrder = apps + [primary]
    var marker: [String: Any] = [
      "schema": CeremonyBindingContract.schema,
      "status": "completed",
      "checkpoint": "completed",
      "ceremony_nonce": receiptNonce,
      "created_at": timestamp,
      "updated_at": timestamp,
      "bindings": [
        "operator_revision": revision,
        "operator_source_sha256": digest,
        "native_sha256": digest,
        "native_cdhash": String(repeating: "c", count: 40),
        "native_team_id": "ABCDE12345",
        "native_designated_requirement_sha256": digest,
        "flyctl_sha256": FlyGenerationContract.flyctlSHA256,
        "phase_a_resume_receipt_sha256": digest,
      ],
      "scope": [
        "machine_set_sha256": digest,
        "role_map_sha256": digest,
        "app_machine_ids": apps,
        "thinker_primary_machine_id": primary,
        "thinker_standby_machine_id": "55555555555555",
        "started_probe_order": probeOrder,
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
      "generation": ["create_attempted": true, "create_verified": true],
      "attempts": [
        [
          "attempt_id": "101112131415161718191a1b1c1d1e1f",
          "status": "completed",
          "checkpoint": "completed",
          "started_at": timestamp,
          "updated_at": timestamp,
          "stage": ["attempted": true, "verified": true],
          "deploy": ["attempted": true, "verified": true],
          "runtime_probe": [
            "attempted_machine_ids": probeOrder,
            "verified_machine_ids": probeOrder,
          ],
          "final_gates_verified": true,
          "failure": NSNull(),
        ] as [String: Any]
      ],
      "final": [
        "completed_at": timestamp,
        "final_inventory_sha256": digest,
        "final_secret_status": "Deployed",
        "runtime_verified_count": 4,
        "reserved_generation_rows": 0,
        "authoritative_v2_rows": 0,
        "allowed_origins_count": 0,
      ],
    ]
    mutate?(&marker)
    var data = try JSONSerialization.data(withJSONObject: marker, options: [.sortedKeys])
    data.append(0x0A)
    return data
  }

  private func exactResult(value: Data) -> [Any] {
    [exactEntry(value: value)]
  }

  private func presenceResult() -> [Any] {
    [exactEntry()]
  }

  private func assertExactIdentity(
    _ query: [CFString: Any],
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    XCTAssertEqual(
      query[kSecClass] as? String,
      kSecClassGenericPassword as String,
      file: file,
      line: line
    )
    XCTAssertEqual(query[kSecAttrService] as? String, service, file: file, line: line)
    XCTAssertEqual(query[kSecAttrAccount] as? String, account, file: file, line: line)
    XCTAssertEqual(query[kSecAttrSynchronizable] as? Bool, false, file: file, line: line)
    XCTAssertNil(query[kSecUseDataProtectionKeychain], file: file, line: line)
    XCTAssertNil(query[kSecUseAuthenticationUI], file: file, line: line)
  }

  private func assertNoUI(
    _ query: [CFString: Any],
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let context = query[kSecUseAuthenticationContext] as? LAContext
    XCTAssertNotNil(context, file: file, line: line)
    XCTAssertEqual(context?.interactionNotAllowed, true, file: file, line: line)
  }

  private func assertBoundedDataRead(
    _ query: [CFString: Any],
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    XCTAssertEqual(query[kSecMatchLimit] as? Int, 2, file: file, line: line)
    XCTAssertNil(query[kSecMatchLimit] as? String, file: file, line: line)
  }

  private func assertFailure(
    _ result: RunResult,
    _ failure: SecretToolFailure,
    excluding secrets: [Data],
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    XCTAssertEqual(result.status, failure.exitCode, file: file, line: line)
    XCTAssertEqual(
      String(decoding: result.stderr, as: UTF8.self),
      "agenttool-secret-macos:\(failure.safeCode)\n",
      file: file,
      line: line
    )
    for secret in secrets where !secret.isEmpty {
      XCTAssertNil(result.stderr.range(of: secret), file: file, line: line)
    }
  }
}

private struct RunResult {
  let status: Int32
  let stderr: Data
}

private func invokeSecretCommand(
  arguments: [String],
  security: FakeSecurity,
  random: FakeRandom,
  ceremony: FakeCeremony = FakeCeremony(),
  fly: FakeFly = FakeFly()
) -> RunResult {
  let errorPipe = Pipe()
  let status = AgentToolSecretMacOSCommand.invoke(
    arguments: arguments,
    errorOutput: errorPipe.fileHandleForWriting,
    selectors: .phaseBAuthority,
    security: security,
    random: random,
    ceremony: ceremony,
    flyFactory: {
      ceremony.events?.record("fly_factory")
      return fly
    }
  )
  try? errorPipe.fileHandleForWriting.close()
  return RunResult(
    status: status,
    stderr: errorPipe.fileHandleForReading.readDataToEndOfFile()
  )
}

private final class FakeRandom: RandomByteGenerating {
  enum Outcome {
    case bytes(Data)
    case failure
  }

  private let outcome: Outcome
  private(set) var requestedCounts: [Int] = []

  init(_ outcome: Outcome) {
    self.outcome = outcome
  }

  func generate(count: Int) throws -> Data {
    requestedCounts.append(count)
    switch outcome {
    case .bytes(let value):
      return value
    case .failure:
      throw SecretToolFailure.generationFailed
    }
  }
}

private final class FakeSecurity: SecurityItemCalling {
  var copies: [(OSStatus, Any?)]
  var addStatuses: [OSStatus]
  private(set) var copyQueries: [[CFString: Any]] = []
  private(set) var addAttributes: [[CFString: Any]] = []
  let events: EventRecorder?

  init(
    copies: [(OSStatus, Any?)] = [],
    addStatuses: [OSStatus] = [],
    events: EventRecorder? = nil
  ) {
    self.copies = copies
    self.addStatuses = addStatuses
    self.events = events
  }

  func copyMatching(_ query: [CFString: Any]) -> (status: OSStatus, result: Any?) {
    events?.record("keychain_lookup")
    copyQueries.append(query)
    guard !copies.isEmpty else {
      return (errSecItemNotFound, nil)
    }
    let next = copies.removeFirst()
    return (next.0, next.1)
  }

  func add(_ attributes: [CFString: Any]) -> OSStatus {
    addAttributes.append(attributes)
    guard !addStatuses.isEmpty else {
      return errSecSuccess
    }
    return addStatuses.removeFirst()
  }
}

private final class EventRecorder {
  private(set) var values: [String] = []

  func record(_ value: String) {
    values.append(value)
  }
}

private final class FakeCeremony: CeremonyBindingAuthorizing {
  let events: EventRecorder?
  let failure: SecretToolFailure?

  init(events: EventRecorder? = nil, failure: SecretToolFailure? = nil) {
    self.events = events
    self.failure = failure
  }

  func authorize(_ command: SecretToolCommand) throws -> CeremonyAuthorization {
    events?.record("authorize")
    if let failure { throw failure }
    let target: String?
    let revision: String
    if case .probeFly(_, let machineID) = command {
      target = machineID.value
      revision = String(repeating: "a", count: 40)
    } else if case .verifyDeployedFly(_, let deployedRevision, let machineID) = command {
      target = machineID.value
      revision = deployedRevision.value
    } else {
      target = nil
      revision = String(repeating: "a", count: 40)
    }
    return CeremonyAuthorization(
      deployedRevision: revision,
      targetMachineID: target,
      runtimeRole: target == nil ? nil : .app
    )
  }
}

private final class FakeFly: FlyGenerationOperating {
  struct Probe: Equatable {
    let generation: Data
    let machineID: String
    let revision: String
    let role: CeremonyRuntimeRole
  }

  let events: EventRecorder?
  private(set) var staged: [Data] = []
  private(set) var probes: [Probe] = []

  init(events: EventRecorder? = nil) {
    self.events = events
  }

  func stage(generation: Data) throws {
    events?.record("fly_stage")
    staged.append(generation)
  }

  func verifyRuntime(
    generation: Data,
    machineID: SecretToolMachineID,
    expectedRevision: String,
    role: CeremonyRuntimeRole
  ) throws {
    events?.record("fly_probe")
    probes.append(
      Probe(
        generation: generation,
        machineID: machineID.value,
        revision: expectedRevision,
        role: role
      )
    )
  }
}
