import Foundation

public struct SecretToolMachineID: Equatable, Sendable {
  public let value: String

  public init(_ value: String) throws {
    let bytes = Array(value.utf8)
    guard bytes.count == 14, bytes.allSatisfy(isLowercaseHexByte) else {
      throw SecretToolFailure.invalidMachineID
    }
    self.value = value
  }
}

public struct SecretToolRevision: Equatable, Sendable {
  public let value: String

  public init(_ value: String) throws {
    let bytes = Array(value.utf8)
    guard bytes.count == 40, bytes.allSatisfy(isLowercaseHexByte) else {
      throw SecretToolFailure.invalidRevision
    }
    self.value = value
  }
}

public enum SecretToolCommand: Equatable, Sendable {
  case create(SecretToolCeremonyNonce)
  case verify(SecretToolCeremonyNonce)
  case stageFly(SecretToolCeremonyNonce)
  case probeFly(SecretToolCeremonyNonce, SecretToolMachineID)
  case verifyDeployedFly(
    SecretToolCeremonyNonce,
    SecretToolRevision,
    SecretToolMachineID
  )

  var ceremonyNonce: SecretToolCeremonyNonce {
    switch self {
    case .create(let nonce), .verify(let nonce), .stageFly(let nonce),
      .probeFly(let nonce, _), .verifyDeployedFly(let nonce, _, _):
      return nonce
    }
  }

  public static func parse(_ arguments: [String]) throws -> SecretToolCommand {
    if arguments.count == 3, arguments[1] == "--receipt-nonce" {
      let nonce = try SecretToolCeremonyNonce(arguments[2])
      switch arguments[0] {
      case "create": return .create(nonce)
      case "verify": return .verify(nonce)
      case "stage-fly": return .stageFly(nonce)
      default: break
      }
    }
    if arguments.count == 5,
      arguments[0] == "probe-fly",
      arguments[1] == "--receipt-nonce",
      arguments[3] == "--machine"
    {
      return .probeFly(
        try SecretToolCeremonyNonce(arguments[2]),
        try SecretToolMachineID(arguments[4])
      )
    }
    if arguments.count == 7,
      arguments[0] == "verify-deployed-fly",
      arguments[1] == "--receipt-nonce",
      arguments[3] == "--revision",
      arguments[5] == "--machine"
    {
      return .verifyDeployedFly(
        try SecretToolCeremonyNonce(arguments[2]),
        try SecretToolRevision(arguments[4]),
        try SecretToolMachineID(arguments[6])
      )
    }
    throw SecretToolFailure.invalidInvocation
  }
}

public struct SecretToolSelectors: Equatable, Sendable {
  public static let phaseBAuthority = SecretToolSelectors(
    validatedService: "agenttool-covenant-v2-authority-generation",
    validatedAccount: "macair"
  )

  public let service: String
  public let account: String

  public init(service: String, account: String) throws {
    self.service = try validatedService(service)
    self.account = try validatedAccount(account)
  }

  private init(validatedService service: String, validatedAccount account: String) {
    self.service = service
    self.account = account
  }
}

public enum AgentToolSecretMacOSCommand {
  public static func run(
    arguments: [String],
    errorOutput: FileHandle,
    selectors: SecretToolSelectors = .phaseBAuthority
  ) -> Int32 {
    invoke(
      arguments: arguments,
      errorOutput: errorOutput,
      selectors: selectors,
      security: NativeSecurityItemClient(),
      random: NativeRandomByteGenerator(),
      ceremony: NativeCeremonyBindingAuthorizer(),
      flyFactory: { try NativeFlyGenerationOperator() }
    )
  }

  static func invoke(
    arguments: [String],
    errorOutput: FileHandle,
    selectors: SecretToolSelectors,
    security: any SecurityItemCalling,
    random: any RandomByteGenerating,
    ceremony: any CeremonyBindingAuthorizing,
    flyFactory: () throws -> any FlyGenerationOperating
  ) -> Int32 {
    do {
      let command = try SecretToolCommand.parse(arguments)
      let authorization = try ceremony.authorize(command)
      let store = SecretStore(security: security)
      switch command {
      case .create(let nonce):
        try store.createRandom(
          service: selectors.service,
          account: selectors.account,
          ceremonyNonce: nonce,
          random: random
        )
      case .verify(let nonce):
        try store.verifyCanonicalGeneration(
          service: selectors.service,
          account: selectors.account,
          ceremonyNonce: nonce
        )
      case .stageFly(let nonce):
        let fly = try flyFactory()
        try store.stageCanonicalGeneration(
          service: selectors.service,
          account: selectors.account,
          ceremonyNonce: nonce,
          using: fly
        )
      case .probeFly(let nonce, let machineID):
        guard authorization.targetMachineID == machineID.value,
          let runtimeRole = authorization.runtimeRole
        else {
          throw SecretToolFailure.ceremonyStateInvalid
        }
        let fly = try flyFactory()
        try store.verifyCanonicalGenerationOnFlyRuntime(
          service: selectors.service,
          account: selectors.account,
          ceremonyNonce: nonce,
          machineID: machineID,
          expectedRevision: authorization.deployedRevision,
          role: runtimeRole,
          using: fly
        )
      case .verifyDeployedFly(let nonce, let revision, let machineID):
        guard authorization.targetMachineID == machineID.value,
          authorization.deployedRevision == revision.value,
          let runtimeRole = authorization.runtimeRole
        else {
          throw SecretToolFailure.ceremonyStateInvalid
        }
        let fly = try flyFactory()
        try store.verifyCanonicalGenerationOnFlyRuntime(
          service: selectors.service,
          account: selectors.account,
          ceremonyNonce: nonce,
          machineID: machineID,
          expectedRevision: authorization.deployedRevision,
          role: runtimeRole,
          using: fly
        )
      }
      return 0
    } catch let failure as SecretToolFailure {
      writeSafeFailure(failure, to: errorOutput)
      return failure.exitCode
    } catch {
      let failure = SecretToolFailure.internalFailure
      writeSafeFailure(failure, to: errorOutput)
      return failure.exitCode
    }
  }

  private static func writeSafeFailure(
    _ failure: SecretToolFailure,
    to errorOutput: FileHandle
  ) {
    let message = Data("agenttool-secret-macos:\(failure.safeCode)\n".utf8)
    try? errorOutput.write(contentsOf: message)
  }
}

private func validatedService(_ value: String) throws -> String {
  let bytes = Array(value.utf8)
  guard bytes.count >= 11,
    bytes.count <= 128,
    value.hasPrefix("agenttool-"),
    bytes.allSatisfy(isServiceByte),
    bytes.last.map(isAlphaNumeric) == true
  else {
    throw SecretToolFailure.invalidSelector
  }
  return value
}

private func validatedAccount(_ value: String) throws -> String {
  let bytes = Array(value.utf8)
  guard !bytes.isEmpty,
    bytes.count <= 128,
    bytes.allSatisfy(isAccountByte),
    bytes.first.map(isAlphaNumeric) == true,
    bytes.last.map(isAlphaNumeric) == true
  else {
    throw SecretToolFailure.invalidSelector
  }
  return value
}

private func isServiceByte(_ byte: UInt8) -> Bool {
  isLowercaseLetter(byte)
    || isDigit(byte)
    || byte == 0x2D
    || byte == 0x2E
    || byte == 0x5F
}

private func isAccountByte(_ byte: UInt8) -> Bool {
  isAlphaNumeric(byte)
    || byte == 0x2D
    || byte == 0x2E
    || byte == 0x40
    || byte == 0x5F
    || byte == 0x2B
}

private func isAlphaNumeric(_ byte: UInt8) -> Bool {
  isLowercaseLetter(byte) || isUppercaseLetter(byte) || isDigit(byte)
}

private func isLowercaseLetter(_ byte: UInt8) -> Bool {
  byte >= 0x61 && byte <= 0x7A
}

private func isUppercaseLetter(_ byte: UInt8) -> Bool {
  byte >= 0x41 && byte <= 0x5A
}

private func isDigit(_ byte: UInt8) -> Bool {
  byte >= 0x30 && byte <= 0x39
}
