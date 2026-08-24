import Foundation
import LocalAuthentication
import Security

public enum SecretToolContract {
  public static let randomByteCount = 32
  public static let serializedByteCount = 64
}

public enum SecretToolFailure: Error, Equatable, Sendable {
  case invalidInvocation
  case invalidSelector
  case itemAbsent
  case itemExists
  case interactionForbidden
  case itemAmbiguous
  case generationFailed
  case storeFailed
  case readbackFailed
  case readbackMismatch
  case internalFailure

  public var safeCode: String {
    switch self {
    case .invalidInvocation: "invalid_invocation"
    case .invalidSelector: "invalid_selector"
    case .itemAbsent: "item_absent"
    case .itemExists: "item_exists"
    case .interactionForbidden: "interaction_forbidden"
    case .itemAmbiguous: "item_ambiguous"
    case .generationFailed: "generation_failed"
    case .storeFailed: "store_failed"
    case .readbackFailed: "readback_failed"
    case .readbackMismatch: "readback_mismatch"
    case .internalFailure: "internal_failure"
    }
  }

  public var exitCode: Int32 {
    switch self {
    case .invalidInvocation: 2
    case .invalidSelector: 3
    case .itemAbsent:
      4
    case .itemExists:
      5
    case .interactionForbidden:
      6
    case .itemAmbiguous:
      7
    case .generationFailed:
      8
    case .storeFailed:
      9
    case .readbackFailed:
      10
    case .readbackMismatch:
      11
    case .internalFailure:
      70
    }
  }
}

public protocol SecurityItemCalling {
  func copyMatching(_ query: [CFString: Any]) -> (status: OSStatus, result: Any?)
  func add(_ attributes: [CFString: Any]) -> OSStatus
}

public protocol RandomByteGenerating {
  func generate(count: Int) throws -> Data
}

public struct NativeSecurityItemClient: SecurityItemCalling {
  public init() {}

  public func copyMatching(
    _ query: [CFString: Any]
  ) -> (status: OSStatus, result: Any?) {
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    return (status, result)
  }

  public func add(_ attributes: [CFString: Any]) -> OSStatus {
    SecItemAdd(attributes as CFDictionary, nil)
  }
}

public struct NativeRandomByteGenerator: RandomByteGenerating {
  public init() {}

  public func generate(count: Int) throws -> Data {
    guard count > 0 else {
      throw SecretToolFailure.generationFailed
    }
    var value = Data(count: count)
    let status = value.withUnsafeMutableBytes { bytes in
      guard let baseAddress = bytes.baseAddress else {
        return errSecParam
      }
      return SecRandomCopyBytes(kSecRandomDefault, count, baseAddress)
    }
    guard status == errSecSuccess else {
      value.resetBytes(in: value.startIndex..<value.endIndex)
      throw SecretToolFailure.generationFailed
    }
    return value
  }
}

public struct SecretStore {
  private enum Presence {
    case absent
    case present
  }

  private enum Lookup {
    case absent
    case found(Data)
  }

  private let security: any SecurityItemCalling

  public init(security: any SecurityItemCalling = NativeSecurityItemClient()) {
    self.security = security
  }

  public func createRandom(
    service: String,
    account: String,
    random: any RandomByteGenerating = NativeRandomByteGenerator()
  ) throws {
    if case .present = try presence(service: service, account: account) {
      throw SecretToolFailure.itemExists
    }

    var raw: Data
    do {
      raw = try random.generate(count: SecretToolContract.randomByteCount)
    } catch {
      throw SecretToolFailure.generationFailed
    }
    guard raw.count == SecretToolContract.randomByteCount else {
      raw.resetBytes(in: raw.startIndex..<raw.endIndex)
      throw SecretToolFailure.generationFailed
    }
    defer {
      raw.resetBytes(in: raw.startIndex..<raw.endIndex)
    }
    var value = lowercaseHex(raw)
    defer {
      value.resetBytes(in: value.startIndex..<value.endIndex)
    }

    try add(value, service: service, account: account)

    var storedValue: Data
    do {
      switch try lookup(service: service, account: account) {
      case .absent:
        throw SecretToolFailure.readbackFailed
      case .found(let readbackValue):
        storedValue = readbackValue
      }
    } catch SecretToolFailure.interactionForbidden {
      throw SecretToolFailure.interactionForbidden
    } catch SecretToolFailure.itemAmbiguous {
      throw SecretToolFailure.itemAmbiguous
    } catch is SecretToolFailure {
      throw SecretToolFailure.readbackFailed
    } catch {
      throw SecretToolFailure.readbackFailed
    }
    defer {
      storedValue.resetBytes(in: storedValue.startIndex..<storedValue.endIndex)
    }
    guard constantTimeEqual(value, storedValue) else {
      throw SecretToolFailure.readbackMismatch
    }
  }

  public func verifyCanonicalGeneration(
    service: String,
    account: String
  ) throws {
    var stored: Data
    switch try lookup(service: service, account: account) {
    case .absent:
      throw SecretToolFailure.itemAbsent
    case .found(let value):
      stored = value
    }
    stored.resetBytes(in: stored.startIndex..<stored.endIndex)
  }

  private func presence(service: String, account: String) throws -> Presence {
    let response = security.copyMatching(presenceQuery(service: service, account: account))
    if response.status == errSecItemNotFound {
      return .absent
    }
    if isInteractionFailure(response.status) {
      throw SecretToolFailure.interactionForbidden
    }
    guard response.status == errSecSuccess else {
      throw SecretToolFailure.readbackFailed
    }
    let attributes = try exactlyOneAttributes(from: response.result)
    try validateIdentity(attributes, service: service, account: account)
    return .present
  }

  private func lookup(service: String, account: String) throws -> Lookup {
    let response = security.copyMatching(readQuery(service: service, account: account))
    if response.status == errSecItemNotFound {
      return .absent
    }
    if isInteractionFailure(response.status) {
      throw SecretToolFailure.interactionForbidden
    }
    guard response.status == errSecSuccess else {
      throw SecretToolFailure.readbackFailed
    }
    let attributes = try exactlyOneAttributes(from: response.result)
    try validateIdentity(attributes, service: service, account: account)
    guard let value = attributes.object(forKey: kSecValueData) as? Data else {
      throw SecretToolFailure.readbackFailed
    }
    guard value.count == SecretToolContract.serializedByteCount,
      value.allSatisfy(isLowercaseHexByte)
    else {
      throw SecretToolFailure.readbackFailed
    }
    return .found(value)
  }

  private func add(_ value: Data, service: String, account: String) throws {
    var attributes = identityQuery(service: service, account: account)
    attributes[kSecValueData] = value
    let status = security.add(attributes)
    if status == errSecDuplicateItem {
      throw SecretToolFailure.itemExists
    }
    if isInteractionFailure(status) {
      throw SecretToolFailure.interactionForbidden
    }
    guard status == errSecSuccess else {
      throw SecretToolFailure.storeFailed
    }
  }

  private func identityQuery(service: String, account: String) -> [CFString: Any] {
    let context = LAContext()
    context.interactionNotAllowed = true
    return [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecAttrSynchronizable: false,
      kSecUseAuthenticationContext: context,
    ]
  }

  private func readQuery(service: String, account: String) -> [CFString: Any] {
    var query = identityQuery(service: service, account: account)
    // The legacy macOS Keychain rejects password data with the special
    // kSecMatchLimitAll value. A numeric bound of two still distinguishes the
    // only accepted cardinality (exactly one) from an ambiguous result.
    query[kSecMatchLimit] = 2
    query[kSecReturnAttributes] = true
    query[kSecReturnData] = true
    return query
  }

  private func presenceQuery(service: String, account: String) -> [CFString: Any] {
    var query = identityQuery(service: service, account: account)
    query[kSecMatchLimit] = kSecMatchLimitAll
    query[kSecReturnAttributes] = true
    return query
  }

  private func exactlyOneAttributes(from result: Any?) throws -> NSDictionary {
    guard let entries = result as? [Any] else {
      throw SecretToolFailure.readbackFailed
    }
    guard entries.count == 1 else {
      throw entries.isEmpty
        ? SecretToolFailure.readbackFailed
        : SecretToolFailure.itemAmbiguous
    }
    guard let attributes = entries[0] as? NSDictionary else {
      throw SecretToolFailure.readbackFailed
    }
    return attributes
  }

  private func validateIdentity(
    _ attributes: NSDictionary,
    service: String,
    account: String
  ) throws {
    guard
      attributes.object(forKey: kSecAttrService) as? String == service,
      attributes.object(forKey: kSecAttrAccount) as? String == account
    else {
      throw SecretToolFailure.readbackFailed
    }
    if let synchronizable = attributes.object(forKey: kSecAttrSynchronizable) as? Bool,
      synchronizable
    {
      throw SecretToolFailure.readbackFailed
    }
  }
}

private func isInteractionFailure(_ status: OSStatus) -> Bool {
  status == errSecInteractionNotAllowed || status == errSecUserCanceled
}

private let lowercaseHexAlphabet = Array("0123456789abcdef".utf8)

private func lowercaseHex(_ raw: Data) -> Data {
  var encoded = Data(capacity: raw.count * 2)
  for byte in raw {
    encoded.append(lowercaseHexAlphabet[Int(byte >> 4)])
    encoded.append(lowercaseHexAlphabet[Int(byte & 0x0F)])
  }
  return encoded
}

private func isLowercaseHexByte(_ byte: UInt8) -> Bool {
  (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66)
}

func constantTimeEqual(_ lhs: Data, _ rhs: Data) -> Bool {
  guard lhs.count == rhs.count else {
    return false
  }
  return lhs.withUnsafeBytes { leftBytes in
    rhs.withUnsafeBytes { rightBytes in
      let left = leftBytes.bindMemory(to: UInt8.self)
      let right = rightBytes.bindMemory(to: UInt8.self)
      var difference: UInt8 = 0
      for index in 0..<left.count {
        difference |= left[index] ^ right[index]
      }
      return difference == 0
    }
  }
}
