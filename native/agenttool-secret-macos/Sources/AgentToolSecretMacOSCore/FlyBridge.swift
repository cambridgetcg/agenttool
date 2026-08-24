import CryptoKit
import Darwin
import Foundation
import Security

protocol FlyGenerationOperating {
  func stage(generation: Data) throws
  func verifyRuntime(
    generation: Data,
    machineID: SecretToolMachineID,
    expectedRevision: String,
    role: CeremonyRuntimeRole
  ) throws
}

enum FlyGenerationContract {
  static let app = "agenttool"
  static let secretName = "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION"
  static let flyctlVersion = "v0.4.74"
  static let flyctlCommit = "b74c9391409b3e443383a5f4d928cef007825ddc"
  static let flyctlSHA256 =
    "7e919b0f42867e33d736398ba151ed00f2bfb577bf9424fbe57573bfee9ae1b3"
  static let flyctlCDHash = "5a0840f2fb36907b43e04019b30bc00774b6ca49"
  static let flyctlByteCount: Int64 = 110_007_826
  static let flyctlPath =
    "/usr/local/libexec/agenttool/phase-b-v1/flyctl-v0.4.74-darwin-arm64"
  static let flyHomeRelativePath = ".local/state/agenttool/phase-b/fly-home"
  #if AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
    static let stageTimeoutSeconds = 2.0
    static let probeTimeoutSeconds = 2.0
  #else
    static let stageTimeoutSeconds = 60.0
    static let probeTimeoutSeconds = 30.0
  #endif
}

struct NativeFlyGenerationOperator: FlyGenerationOperating {
  private let execution: NativeFlyExecution

  init() throws {
    execution = try NativeFlyExecution()
  }

  func stage(generation: Data) throws {
    guard isCanonicalGeneration(generation) else {
      throw SecretToolFailure.readbackFailed
    }
    var input = Data("\(FlyGenerationContract.secretName)=".utf8)
    input.append(generation)
    input.append(0x0A)
    defer { input.resetBytes(in: input.startIndex..<input.endIndex) }

    do {
      try execution.run(
        arguments: [
          "secrets", "import", "--stage", "--app", FlyGenerationContract.app,
        ],
        input: input,
        timeoutSeconds: FlyGenerationContract.stageTimeoutSeconds
      )
    } catch NativeFlyExecutionFailure.timedOut {
      throw SecretToolFailure.flyChildTimedOut
    } catch {
      throw SecretToolFailure.flyChildFailed
    }
  }

  func verifyRuntime(
    generation: Data,
    machineID: SecretToolMachineID,
    expectedRevision: String,
    role: CeremonyRuntimeRole
  ) throws {
    guard isCanonicalGeneration(generation), isRevision(expectedRevision) else {
      throw SecretToolFailure.flyContractInvalid
    }
    var input = generation
    input.append(0x0A)
    defer { input.resetBytes(in: input.startIndex..<input.endIndex) }
    do {
      try execution.run(
        arguments: [
          "ssh", "console", "--app", FlyGenerationContract.app,
          "--machine", machineID.value, "--quiet", "--pty=false",
          "--command",
          runtimeProofCommand(
            expectedRevision: expectedRevision,
            machineID: machineID,
            role: role
          ),
        ],
        input: input,
        timeoutSeconds: FlyGenerationContract.probeTimeoutSeconds
      )
    } catch NativeFlyExecutionFailure.timedOut {
      throw SecretToolFailure.flyChildTimedOut
    } catch {
      throw SecretToolFailure.flyRuntimeProofFailed
    }
  }
}

private enum NativeFlyExecutionFailure: Error {
  case launchFailed
  case inputFailed
  case childFailed
  case timedOut
  case wouldNotSettle
}

private struct NativeFlyExecution {
  let executablePath: String
  let flyHome: String
  let environment: [String]

  init() throws {
    let home = try currentUserHome()

    #if AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
      guard
        let fixture = ProcessInfo.processInfo.environment[
          "AGENTTOOL_SECRET_MACOS_FLY_FIXTURE"
        ], !fixture.isEmpty,
        let fixtureHome = ProcessInfo.processInfo.environment[
          "AGENTTOOL_SECRET_MACOS_FLY_HOME"
        ], fixtureHome.hasPrefix("/")
      else {
        throw SecretToolFailure.flyContractInvalid
      }
      executablePath = fixture
      flyHome = fixtureHome
      try validateFixtureExecutable(fixture)
    #else
      executablePath = FlyGenerationContract.flyctlPath
      flyHome =
        URL(fileURLWithPath: home).appendingPathComponent(
          FlyGenerationContract.flyHomeRelativePath,
          isDirectory: true
        ).path
      try validateProductionExecutable(executablePath)
    #endif

    try validateFlyHome(flyHome)
    guard let record = getpwuid(getuid()),
      let namePointer = record.pointee.pw_name
    else {
      throw SecretToolFailure.flyContractInvalid
    }
    let username = String(cString: namePointer)
    guard !username.isEmpty,
      username.utf8.allSatisfy({ $0 >= 0x21 && $0 <= 0x7E })
    else {
      throw SecretToolFailure.flyContractInvalid
    }
    environment = [
      "HOME=\(flyHome)",
      "USER=\(username)",
      "LOGNAME=\(username)",
      "LANG=C",
      "LC_ALL=C",
      "NO_COLOR=1",
      "TERM=dumb",
      "PATH=/usr/bin:/bin",
    ]
  }

  func run(
    arguments: [String],
    input: Data,
    timeoutSeconds: Double
  ) throws {
    guard !input.isEmpty, input.count < Int(PIPE_BUF), timeoutSeconds > 0 else {
      throw NativeFlyExecutionFailure.inputFailed
    }
    try validateFlyHome(flyHome)
    #if AGENTTOOL_KEYCHAIN_INTEGRATION_BUILD
      try validateFixtureExecutable(executablePath)
    #else
      try validateProductionExecutable(executablePath)
    #endif

    var coreLimit = rlimit(rlim_cur: 0, rlim_max: 0)
    guard setrlimit(RLIMIT_CORE, &coreLimit) == 0 else {
      throw NativeFlyExecutionFailure.launchFailed
    }
    // Keep a caught operator signal from killing this supervisor while its
    // separately grouped child could continue orphaned. The operation remains
    // bounded here; the handlers are restored after the child is reaped.
    let previousInterrupt = signal(SIGINT, SIG_IGN)
    let previousTermination = signal(SIGTERM, SIG_IGN)
    defer {
      _ = signal(SIGINT, previousInterrupt)
      _ = signal(SIGTERM, previousTermination)
    }

    var pipeDescriptors: [Int32] = [0, 0]
    guard pipe(&pipeDescriptors) == 0 else {
      throw NativeFlyExecutionFailure.launchFailed
    }
    let childInput = pipeDescriptors[0]
    let parentInput = pipeDescriptors[1]
    guard fcntl(parentInput, F_SETNOSIGPIPE, 1) == 0 else {
      _ = close(childInput)
      _ = close(parentInput)
      throw NativeFlyExecutionFailure.launchFailed
    }
    let nullDescriptor = open("/dev/null", O_WRONLY | O_CLOEXEC)
    guard nullDescriptor >= 0 else {
      _ = close(childInput)
      _ = close(parentInput)
      throw NativeFlyExecutionFailure.launchFailed
    }

    var actions: posix_spawn_file_actions_t? = nil
    var attributes: posix_spawnattr_t? = nil
    guard posix_spawn_file_actions_init(&actions) == 0,
      posix_spawnattr_init(&attributes) == 0
    else {
      _ = close(childInput)
      _ = close(parentInput)
      _ = close(nullDescriptor)
      throw NativeFlyExecutionFailure.launchFailed
    }
    defer {
      posix_spawn_file_actions_destroy(&actions)
      posix_spawnattr_destroy(&attributes)
    }
    guard posix_spawn_file_actions_adddup2(&actions, childInput, STDIN_FILENO) == 0,
      posix_spawn_file_actions_adddup2(&actions, nullDescriptor, STDOUT_FILENO) == 0,
      posix_spawn_file_actions_adddup2(&actions, nullDescriptor, STDERR_FILENO) == 0,
      posix_spawn_file_actions_addclose(&actions, parentInput) == 0,
      posix_spawn_file_actions_addclose(&actions, childInput) == 0,
      posix_spawn_file_actions_addclose(&actions, nullDescriptor) == 0,
      posix_spawn_file_actions_addchdir_np(&actions, "/") == 0,
      posix_spawnattr_setpgroup(&attributes, 0) == 0
    else {
      _ = close(childInput)
      _ = close(parentInput)
      _ = close(nullDescriptor)
      throw NativeFlyExecutionFailure.launchFailed
    }
    let flags = Int16(POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETPGROUP)
    guard posix_spawnattr_setflags(&attributes, flags) == 0 else {
      _ = close(childInput)
      _ = close(parentInput)
      _ = close(nullDescriptor)
      throw NativeFlyExecutionFailure.launchFailed
    }

    var processID: pid_t = 0
    let spawnStatus = try withCStringArray([executablePath] + arguments) { argv in
      try withCStringArray(environment) { environmentPointers in
        posix_spawn(
          &processID,
          executablePath,
          &actions,
          &attributes,
          argv,
          environmentPointers
        )
      }
    }
    _ = close(childInput)
    _ = close(nullDescriptor)
    guard spawnStatus == 0, processID > 0 else {
      _ = close(parentInput)
      throw NativeFlyExecutionFailure.launchFailed
    }

    let bytesWritten = input.withUnsafeBytes { bytes -> Int in
      guard let baseAddress = bytes.baseAddress else { return -1 }
      return Darwin.write(parentInput, baseAddress, input.count)
    }
    _ = close(parentInput)
    guard bytesWritten == input.count else {
      try settleAfterFailure(processID)
      throw NativeFlyExecutionFailure.inputFailed
    }

    guard let status = waitForExit(processID, timeoutSeconds: timeoutSeconds) else {
      try terminateAndSettleProcessGroup(processID, childAlreadyReaped: false)
      throw NativeFlyExecutionFailure.timedOut
    }
    guard processGroupIsEmpty(processID) else {
      try terminateAndSettleProcessGroup(processID, childAlreadyReaped: true)
      throw NativeFlyExecutionFailure.childFailed
    }
    guard exitedSuccessfully(status) else {
      throw NativeFlyExecutionFailure.childFailed
    }
  }
}

private func settleAfterFailure(_ processID: pid_t) throws {
  try terminateAndSettleProcessGroup(processID, childAlreadyReaped: false)
}

private func terminateAndSettleProcessGroup(
  _ processID: pid_t,
  childAlreadyReaped: Bool
) throws {
  _ = kill(-processID, SIGTERM)
  if waitForProcessGroupSettlement(
    processID,
    childAlreadyReaped: childAlreadyReaped,
    timeoutSeconds: 2
  ) {
    return
  }
  _ = kill(-processID, SIGKILL)
  guard
    waitForProcessGroupSettlement(
      processID,
      childAlreadyReaped: childAlreadyReaped,
      timeoutSeconds: 2
    )
  else {
    throw NativeFlyExecutionFailure.wouldNotSettle
  }
}

private func waitForProcessGroupSettlement(
  _ processID: pid_t,
  childAlreadyReaped: Bool,
  timeoutSeconds: Double
) -> Bool {
  var childReaped = childAlreadyReaped
  let timeout = UInt64(timeoutSeconds * 1_000_000_000)
  let deadline = DispatchTime.now().uptimeNanoseconds &+ timeout
  while DispatchTime.now().uptimeNanoseconds < deadline {
    if !childReaped {
      var status: Int32 = 0
      let result = waitpid(processID, &status, WNOHANG)
      if result == processID {
        childReaped = true
      } else if result == -1 {
        if errno == EINTR {
          continue
        }
        if errno == ECHILD {
          childReaped = true
        } else {
          return false
        }
      }
    }
    if childReaped, processGroupIsEmpty(processID) {
      return true
    }
    usleep(10_000)
  }
  return childReaped && processGroupIsEmpty(processID)
}

private func processGroupIsEmpty(_ processID: pid_t) -> Bool {
  errno = 0
  return kill(-processID, 0) == -1 && errno == ESRCH
}

private func waitForExit(_ processID: pid_t, timeoutSeconds: Double) -> Int32? {
  let timeout = UInt64(timeoutSeconds * 1_000_000_000)
  let deadline = DispatchTime.now().uptimeNanoseconds &+ timeout
  while DispatchTime.now().uptimeNanoseconds < deadline {
    var status: Int32 = 0
    let result = waitpid(processID, &status, WNOHANG)
    if result == processID { return status }
    if result == -1, errno != EINTR { return nil }
    usleep(10_000)
  }
  return nil
}

private func exitedSuccessfully(_ status: Int32) -> Bool {
  (status & 0x7F) == 0 && ((status >> 8) & 0xFF) == 0
}

private func withCStringArray<T>(
  _ values: [String],
  _ body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) throws -> T
) throws -> T {
  var pointers = values.map { strdup($0) }
  guard pointers.allSatisfy({ $0 != nil }) else {
    for pointer in pointers where pointer != nil { free(pointer) }
    throw NativeFlyExecutionFailure.launchFailed
  }
  pointers.append(nil)
  defer {
    for pointer in pointers where pointer != nil { free(pointer) }
  }
  return try pointers.withUnsafeMutableBufferPointer { buffer in
    try body(buffer.baseAddress!)
  }
}

private func validateProductionExecutable(_ path: String) throws {
  try validateRootOwnedPathChain(path)
  var metadata = stat()
  guard lstat(path, &metadata) == 0,
    (metadata.st_mode & S_IFMT) == S_IFREG,
    metadata.st_uid == 0,
    metadata.st_gid == 0,
    metadata.st_nlink == 1,
    metadata.st_mode & 0o777 == 0o555,
    metadata.st_size == FlyGenerationContract.flyctlByteCount,
    try sha256(path) == FlyGenerationContract.flyctlSHA256,
    try isArm64MachO(path),
    try codeDirectoryHash(path) == FlyGenerationContract.flyctlCDHash
  else {
    throw SecretToolFailure.flyContractInvalid
  }
}

private func validateRootOwnedPathChain(_ path: String) throws {
  let requiredDirectories = [
    "/usr", "/usr/local", "/usr/local/libexec", "/usr/local/libexec/agenttool",
    "/usr/local/libexec/agenttool/phase-b-v1",
  ]
  guard path == FlyGenerationContract.flyctlPath else {
    throw SecretToolFailure.flyContractInvalid
  }
  for directory in requiredDirectories {
    var metadata = stat()
    guard lstat(directory, &metadata) == 0,
      (metadata.st_mode & S_IFMT) == S_IFDIR,
      metadata.st_uid == 0,
      metadata.st_gid == 0,
      metadata.st_mode & 0o777 == 0o755
    else {
      throw SecretToolFailure.flyContractInvalid
    }
  }
}

private func validateFixtureExecutable(_ path: String) throws {
  var metadata = stat()
  guard path.hasPrefix("/"),
    lstat(path, &metadata) == 0,
    (metadata.st_mode & S_IFMT) == S_IFREG,
    metadata.st_uid == getuid(),
    metadata.st_nlink == 1,
    metadata.st_mode & 0o022 == 0,
    metadata.st_mode & S_IXUSR != 0
  else {
    throw SecretToolFailure.flyContractInvalid
  }
}

private func validateFlyHome(_ path: String) throws {
  var directory = stat()
  guard lstat(path, &directory) == 0,
    (directory.st_mode & S_IFMT) == S_IFDIR,
    directory.st_uid == getuid(),
    directory.st_mode & 0o777 == 0o700
  else {
    throw SecretToolFailure.flyContractInvalid
  }
  let configPath = URL(fileURLWithPath: path).appendingPathComponent(
    ".fly/config.yml",
    isDirectory: false
  ).path
  var config = stat()
  guard lstat(configPath, &config) == 0,
    (config.st_mode & S_IFMT) == S_IFREG,
    config.st_uid == getuid(),
    config.st_nlink == 1,
    config.st_mode & 0o777 == 0o600,
    config.st_size > 0,
    config.st_size <= 65_536
  else {
    throw SecretToolFailure.flyContractInvalid
  }
}

private func sha256(_ path: String) throws -> String {
  let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
  defer { try? handle.close() }
  var hasher = SHA256()
  while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
    hasher.update(data: chunk)
  }
  return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

private func isArm64MachO(_ path: String) throws -> Bool {
  let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
  defer { try? handle.close() }
  guard let header = try handle.read(upToCount: 8), header.count == 8 else { return false }
  return Array(header) == [0xCF, 0xFA, 0xED, 0xFE, 0x0C, 0x00, 0x00, 0x01]
}

private func codeDirectoryHash(_ path: String) throws -> String {
  var staticCode: SecStaticCode?
  guard
    SecStaticCodeCreateWithPath(
      URL(fileURLWithPath: path) as CFURL,
      SecCSFlags(),
      &staticCode
    ) == errSecSuccess,
    let staticCode,
    SecStaticCodeCheckValidity(staticCode, SecCSFlags(rawValue: kSecCSStrictValidate), nil)
      == errSecSuccess
  else {
    throw SecretToolFailure.flyContractInvalid
  }
  var information: CFDictionary?
  guard
    SecCodeCopySigningInformation(
      staticCode,
      SecCSFlags(rawValue: kSecCSSigningInformation),
      &information
    ) == errSecSuccess,
    let values = information as? [CFString: Any],
    let unique = values[kSecCodeInfoUnique] as? Data
  else {
    throw SecretToolFailure.flyContractInvalid
  }
  return unique.map { String(format: "%02x", $0) }.joined()
}

private func isCanonicalGeneration(_ generation: Data) -> Bool {
  generation.count == SecretToolContract.serializedByteCount
    && generation.allSatisfy(isLowercaseHexByte)
}

private func isRevision(_ value: String) -> Bool {
  value.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil
}

private func runtimeProofCommand(
  expectedRevision: String,
  machineID: SecretToolMachineID,
  role: CeremonyRuntimeRole
) -> String {
  let sourcePath = role == .app ? "src/index.ts" : "src/thinker.ts"
  let script = [
    "try{",
    "const input=new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());",
    "if(input.length!==65||input[64]!==10)process.exit(1);",
    "const expected=input.slice(0,64);const expectedText=new TextDecoder().decode(expected);",
    "const fs=await import(\"node:fs/promises\");",
    "const candidates=[];for(const name of await fs.readdir(\"/proc\")){if(!/^[0-9]+$/.test(name))continue;try{const command=await fs.readFile(\"/proc/\"+name+\"/cmdline\");const parts=new TextDecoder(\"utf-8\",{fatal:true}).decode(command).split(String.fromCharCode(0));if(parts.pop()!==\"\"||parts.some(part=>part===\"\"))continue;const executable=(parts[0]??\"\").split(\"/\").at(-1);if(executable===\"bun\"&&parts.length===3&&parts[1]===\"run\"&&parts[2]===\"\(sourcePath)\")candidates.push(name)}catch{}}",
    "if(candidates.length!==1)process.exit(1);",
    "const processEnvironment=await fs.readFile(\"/proc/\"+candidates[0]+\"/environ\");const target=Object.create(null);for(const field of new TextDecoder(\"utf-8\",{fatal:true}).decode(processEnvironment).split(String.fromCharCode(0))){if(!field)continue;const separator=field.indexOf(\"=\");if(separator<1)process.exit(1);const key=field.slice(0,separator);if(Object.hasOwn(target,key))process.exit(1);target[key]=field.slice(separator+1)}",
    "const actual=target.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION??\"\";",
    "if(!/^[0-9a-f]{64}$/.test(expectedText)||!/^[0-9a-f]{64}$/.test(actual))process.exit(1);",
    "const crypto=await import(\"node:crypto\");",
    "const expectedHash=crypto.createHash(\"sha256\").update(expected).digest();",
    "const actualHash=crypto.createHash(\"sha256\").update(actual).digest();",
    "if(!crypto.timingSafeEqual(expectedHash,actualHash))process.exit(1);",
    "if(target.AGENTTOOL_GIT_REVISION!==\"\(expectedRevision)\")process.exit(1);",
    "if(target.AGENTTOOL_SOURCE_DIRTY!==\"false\")process.exit(1);",
    "if(target.AGENTTOOL_DISABLE_WORKERS!==\"1\")process.exit(1);",
    "if(target.FLY_MACHINE_ID!==\"\(machineID.value)\")process.exit(1);",
    "if(target.FLY_PROCESS_GROUP!==\"\(role.rawValue)\")process.exit(1);",
    "if(target.DATABASE_URL!==process.env.DATABASE_URL||target.DATABASE_SESSION_URL!==process.env.DATABASE_SESSION_URL)process.exit(1);",
    "if(target.REDIS_URL!==undefined)process.exit(1);",
    role == .thinkerPrimary
      ? "if(target.AGENTOOL_ENABLE_THINKER!==\"1\")process.exit(1);"
      : "",
    "const module=await import(\"/app/src/db/verify-connections.ts\");",
    "await module.verifyDeployedDatabaseConnections();",
    role == .app
      ? "const response=await fetch(\"http://127.0.0.1:3000/health\");const body=await response.json();if(!response.ok||body?.build?.revision!==\"\(expectedRevision)\"||body?.build?.dirty!==false||body?.covenant_v2_authority!==\"configured\")process.exit(1);"
      : "",
    "}catch{process.exit(1)}",
  ].joined()
  return "bun --no-install --no-env-file -e '\(script)'"
}
