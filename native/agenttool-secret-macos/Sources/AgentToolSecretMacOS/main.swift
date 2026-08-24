import AgentToolSecretMacOSCore
import Darwin
import Foundation

#if AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
  import LocalAuthentication
  import Security
#endif

let arguments = Array(CommandLine.arguments.dropFirst())

#if AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
  if arguments == ["fixture-attest"] {
    Darwin.exit(0)
  }
  let selectors = try SecretToolSelectors(
    service: "agenttool-native-cli-test-integration",
    account: "test-ci"
  )
  if arguments == ["fixture-clean"] {
    let context = LAContext()
    context.interactionNotAllowed = true
    let cleanupStatus = SecItemDelete(
      [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: selectors.service,
        kSecAttrAccount: selectors.account,
        kSecAttrSynchronizable: false,
        kSecUseAuthenticationContext: context,
      ] as CFDictionary)
    if cleanupStatus == errSecSuccess || cleanupStatus == errSecItemNotFound {
      Darwin.exit(0)
    }
    let failure: SecretToolFailure =
      cleanupStatus == errSecInteractionNotAllowed || cleanupStatus == errSecUserCanceled
      ? .interactionForbidden
      : .storeFailed
    let message = Data("agenttool-secret-macos:\(failure.safeCode)\n".utf8)
    try? FileHandle.standardError.write(contentsOf: message)
    Darwin.exit(failure.exitCode)
  }
#else
  let selectors = SecretToolSelectors.phaseBAuthority
#endif

let status = AgentToolSecretMacOSCommand.run(
  arguments: arguments,
  errorOutput: FileHandle.standardError,
  selectors: selectors
)

if status != 0 {
  Darwin.exit(status)
}
