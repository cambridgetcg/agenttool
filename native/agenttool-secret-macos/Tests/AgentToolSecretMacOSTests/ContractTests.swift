import Foundation
import LocalAuthentication
import Security
import XCTest

@testable import AgentToolSecretMacOSCore

final class ContractTests: XCTestCase {
  private let service = "agenttool-covenant-v2-authority-generation"
  private let account = "macair"
  private let rawGeneration = Data((0..<32).map { UInt8($0) })
  private let serializedGeneration = Data(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f".utf8
  )

  func testParsesOnlyCreateAndNonExportingVerifyGrammar() throws {
    XCTAssertEqual(try SecretToolCommand.parse(["create"]), .create)
    XCTAssertEqual(try SecretToolCommand.parse(["verify"]), .verify)

    for invalid in [
      [] as [String],
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
    ] {
      XCTAssertThrowsError(try SecretToolCommand.parse(invalid)) { error in
        XCTAssertEqual(error as? SecretToolFailure, .invalidInvocation)
      }
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

  func testCreateGeneratesCanonicalValueAndRequiresIndependentExactReadback() {
    let security = FakeSecurity(
      copies: [
        (errSecItemNotFound, nil),
        (errSecSuccess, exactResult(value: serializedGeneration)),
      ],
      addStatuses: [errSecSuccess]
    )
    let random = FakeRandom(.bytes(rawGeneration))
    let result = invokeSecretCommand(arguments: ["create"], security: security, random: random)

    XCTAssertEqual(result.status, 0)
    XCTAssertEqual(result.stderr, Data())
    XCTAssertEqual(random.requestedCounts, [SecretToolContract.randomByteCount])
    XCTAssertEqual(security.copyQueries.count, 2)
    XCTAssertEqual(security.addAttributes.count, 1)

    assertExactIdentity(security.copyQueries[0])
    assertNoUI(security.copyQueries[0])
    XCTAssertEqual(security.copyQueries[0][kSecReturnAttributes] as? Bool, true)
    XCTAssertNil(security.copyQueries[0][kSecReturnData])

    assertExactIdentity(security.copyQueries[1])
    assertNoUI(security.copyQueries[1])
    XCTAssertEqual(security.copyQueries[1][kSecReturnAttributes] as? Bool, true)
    XCTAssertEqual(security.copyQueries[1][kSecReturnData] as? Bool, true)

    assertExactIdentity(security.addAttributes[0])
    assertNoUI(security.addAttributes[0])
    XCTAssertEqual(
      security.addAttributes[0][kSecValueData] as? Data,
      serializedGeneration
    )
    XCTAssertEqual(serializedGeneration.count, SecretToolContract.serializedByteCount)
  }

  func testCreateRefusesExistingBeforeRandomGeneration() {
    let security = FakeSecurity(copies: [(errSecSuccess, presenceResult())])
    let random = FakeRandom(.bytes(rawGeneration))
    assertFailure(
      invokeSecretCommand(arguments: ["create"], security: security, random: random),
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
      invokeSecretCommand(arguments: ["create"], security: ambiguous, random: ambiguousRandom),
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
        arguments: ["create"],
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
        invokeSecretCommand(arguments: ["create"], security: security, random: random),
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
        arguments: ["create"],
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
        arguments: ["create"],
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
    let result = invokeSecretCommand(arguments: ["verify"], security: security, random: random)

    XCTAssertEqual(result.status, 0)
    XCTAssertEqual(result.stderr, Data())
    XCTAssertTrue(random.requestedCounts.isEmpty)
    XCTAssertTrue(security.addAttributes.isEmpty)
    XCTAssertEqual(security.copyQueries.count, 1)
    assertExactIdentity(security.copyQueries[0])
    assertNoUI(security.copyQueries[0])
    XCTAssertEqual(security.copyQueries[0][kSecReturnData] as? Bool, true)
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
          arguments: ["verify"],
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
      kSecValueData: serializedGeneration,
    ]
    let synchronizable: NSDictionary = [
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecAttrSynchronizable: true,
      kSecValueData: serializedGeneration,
    ]
    for returned in [[wrongAccount] as [Any], [synchronizable] as [Any]] {
      assertFailure(
        invokeSecretCommand(
          arguments: ["verify"],
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
          arguments: ["create"],
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
      .itemAbsent,
      .itemExists,
      .interactionForbidden,
      .itemAmbiguous,
      .generationFailed,
      .storeFailed,
      .readbackFailed,
      .readbackMismatch,
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
    ]
    if let value {
      attributes[kSecValueData] = value
    }
    return attributes as NSDictionary
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
  random: FakeRandom
) -> RunResult {
  let errorPipe = Pipe()
  let status = AgentToolSecretMacOSCommand.run(
    arguments: arguments,
    errorOutput: errorPipe.fileHandleForWriting,
    security: security,
    random: random
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

  init(
    copies: [(OSStatus, Any?)] = [],
    addStatuses: [OSStatus] = []
  ) {
    self.copies = copies
    self.addStatuses = addStatuses
  }

  func copyMatching(_ query: [CFString: Any]) -> (status: OSStatus, result: Any?) {
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
