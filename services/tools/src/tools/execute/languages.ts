/** Language configurations for sandboxed execution. */

export interface LanguageConfig {
  cmd: string;
  args?: string[];
  fileExt: string;
  defaultTimeout: number; // ms
  maxTimeout: number;     // ms
  memoryLimit: string;    // informational (not enforced in subprocess mode)
}

export const languages: Record<string, LanguageConfig> = {
  python: {
    cmd: "python3",
    args: ["-c"],
    fileExt: ".py",
    defaultTimeout: 10_000,
    maxTimeout: 30_000,
    memoryLimit: "256m",
  },
  javascript: {
    cmd: "node",
    args: ["-e"],
    fileExt: ".js",
    defaultTimeout: 10_000,
    maxTimeout: 30_000,
    memoryLimit: "256m",
  },
  bash: {
    cmd: "sh",
    args: ["-c"],
    fileExt: ".sh",
    defaultTimeout: 10_000,
    maxTimeout: 30_000,
    memoryLimit: "128m",
  },
};

export type SupportedLanguage = keyof typeof languages;

export function isValidLanguage(lang: string): lang is SupportedLanguage {
  return lang in languages;
}
