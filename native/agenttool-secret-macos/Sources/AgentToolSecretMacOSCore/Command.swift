import Foundation

public enum SecretToolCommand: Equatable, Sendable {
  case create
  case verify

  public static func parse(_ arguments: [String]) throws -> SecretToolCommand {
    if arguments == ["verify"] {
      return .verify
    }
    if arguments == ["create"] {
      return .create
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
    selectors: SecretToolSelectors = .phaseBAuthority,
    security: any SecurityItemCalling = NativeSecurityItemClient(),
    random: any RandomByteGenerating = NativeRandomByteGenerator()
  ) -> Int32 {
    do {
      let command = try SecretToolCommand.parse(arguments)
      let store = SecretStore(security: security)
      switch command {
      case .create:
        try store.createRandom(
          service: selectors.service,
          account: selectors.account,
          random: random
        )
      case .verify:
        try store.verifyCanonicalGeneration(
          service: selectors.service,
          account: selectors.account
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
