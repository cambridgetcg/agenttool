/** Value-minimal classification of bounded synthetic child diagnostics.
 * No raw output, path, syscall argument, receipt, or free-form error is returned.
 */
export function classifyCapturedOutput(text: string) {
  const errorCodes = [
    "argument_error", "canonical_error", "conflict", "file_error",
    "integrity_error", "not_found", "ordering_error", "pin_error",
    "receipt_error", "internal_error",
  ];
  const jsonLineErrors: string[] = [];
  for (const line of text.split("\n", 64)) {
    try {
      const value = JSON.parse(line);
      if (errorCodes.includes(value?.error) && !jsonLineErrors.includes(value.error)) {
        jsonLineErrors.push(value.error);
      }
    } catch { /* Stack excerpts and incomplete JSON do not disclose raw text. */ }
  }
  const markers: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["bun_crash_banner", /oh no: Bun has crashed\./u],
    ["bun_panic", /\bpanic(?:\([^\n)]{0,80}\))?:/u],
    ["bun_version_banner", /^Bun v[0-9]+\.[0-9]+\.[0-9]+/mu],
    ["sqlite_error_header", /^SQLiteError:/mu],
    ["constructive_error_header", /^ConstructiveError:/mu],
    ["generic_error_header", /^(?:[A-Za-z]*Error|error):/mu],
    ["sqlite_busy", /\bSQLITE_BUSY\b|database is locked/u],
    ["sqlite_locked", /\bSQLITE_LOCKED\b|database table is locked/u],
    ["permission_refusal", /no group\/other write bits/u],
  ];
  for (const [marker, pattern] of patterns) if (pattern.test(text)) markers.push(marker);
  const systemErrors = ["EACCES", "EAGAIN", "EBADF", "EIO", "EMFILE", "ENFILE", "ENOENT", "ENOSPC", "EPIPE", "EROFS"]
    .filter((code) => new RegExp("\\b" + code + "\\b", "u").test(text));
  const sourceFrames: Array<{ file: string; line: number; column: number }> = [];
  for (const match of text.matchAll(/\b(store|cli|bin|io)\.(ts|js):([0-9]{1,5}):([0-9]{1,5})\b/gu)) {
    const frame = { file: `${match[1]}.${match[2]}`, line: Number(match[3]), column: Number(match[4]) };
    if (!sourceFrames.some((value) => value.file === frame.file && value.line === frame.line && value.column === frame.column)) sourceFrames.push(frame);
    if (sourceFrames.length === 8) break;
  }
  return { json_line_errors: jsonLineErrors, markers, system_errors: systemErrors, source_frames: sourceFrames };
}

export function classifyLinuxSyscall(text: string, architecture: string) {
  if (architecture !== "x64") return { syscall: null, stdio_descriptor: null };
  const fields = text.trim().split(/\s+/u, 3);
  const names: Record<string, string> = {
    "0": "read", "1": "write", "3": "close", "7": "poll", "9": "mmap",
    "10": "mprotect", "11": "munmap", "17": "pread64", "18": "pwrite64",
    "20": "writev", "23": "select", "72": "fcntl", "74": "fsync",
    "75": "fdatasync", "202": "futex", "232": "epoll_wait",
    "257": "openat", "262": "newfstatat", "270": "pselect6", "271": "ppoll",
    "281": "epoll_pwait", "318": "getrandom",
  };
  const number = fields[0] ?? "";
  const syscall = Object.hasOwn(names, number) ? names[number] ?? null : null;
  const descriptor = Number(fields[1]);
  const stdio = syscall === "read" || syscall === "write" || syscall === "writev";
  return { syscall, stdio_descriptor: stdio && [0, 1, 2].includes(descriptor) ? descriptor : null };
}
