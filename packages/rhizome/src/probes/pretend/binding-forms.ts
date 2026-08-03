/** rhizome/probes/pretend/binding-forms — how a language binds a name.
 *
 *  Several guards in this repository defend a shared helper by asserting
 *  that nobody re-defines its name locally. `packages/sdk-ts/tests/
 *  url-encoding.test.ts` is the pattern:
 *
 *    LOCAL_ENCODER_DEFINITION  — "any binding of the name at ANY nesting
 *                                depth" (its own words)
 *    SHARED_ENCODER_IMPORT     — the one binding that counts
 *
 *  A call site is read as encoded only when the first pattern does NOT
 *  match and the second one does. So the guard is exactly as strong as the
 *  first pattern's coverage of the language, and no test can notice a form
 *  the pattern never contemplated: the file simply reads as clean.
 *
 *  This module is the vocabulary that coverage is measured against. It is a
 *  literal catalogue — a syntax fact cannot be derived from a corpus that
 *  only shows the forms somebody already wrote — so it carries the four
 *  things this package demands of any literal boundary:
 *
 *    exported            every form is public and reviewable here;
 *    reasoned            each carries why it binds and whether the binding
 *                        actually captures a bare call;
 *    staleness-checked   each carries a `witness` regex, and the probe only
 *                        reports a form it can point at in this tree. A form
 *                        the catalogue names and the corpus does not contain
 *                        is reported as absent, never asserted;
 *    stated in output    the catalogue's own incompleteness is a declared
 *                        `ProbeLimit`, published on every run.
 *
 *  `shadowsBareCall` is the load-bearing field. A TypeScript class property
 *  `encodePathSegment = (v) => v` is a binding of that name, and a detector
 *  that claims to cover any binding misses it — but a bare
 *  `encodePathSegment(id)` inside the class still resolves to the module
 *  import, because class properties are not in lexical scope. Reporting that
 *  as a hole would be a finding that cannot be exploited. Reporting it as a
 *  correct-by-accident narrowing is the true statement, and the difference
 *  between the two is exactly what this field records.
 */

/** One way a language can bind an identifier. */
export interface BindingForm {
  id: string;
  /** File extension family this form belongs to. */
  language: "ts" | "py";
  /** Source that binds `%N%`. `%N%` is replaced with the guarded symbol. */
  template: string;
  /** Whether an unqualified `%N%(x)` in the same file resolves to THIS
   *  binding. `false` means a detector that misses the form is narrower
   *  than it claims and still sound in practice. */
  shadowsBareCall: boolean;
  /** Why it does or does not capture the call. */
  why: string;
  /** Finds a real occurrence of this form somewhere in the corpus, so the
   *  catalogue is checked against the tree rather than believed. */
  witness: RegExp;
}

export const BINDING_FORMS: readonly BindingForm[] = Object.freeze([
  {
    id: "ts/module-function",
    language: "ts",
    template: "function %N%(value: string): string {\n  return value;\n}",
    shadowsBareCall: true,
    why: "a module-level function declaration is the binding every unqualified call in the module resolves to",
    witness: /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m,
  },
  {
    id: "ts/module-const-arrow",
    language: "ts",
    template: "const %N% = (value: string): string => value;",
    shadowsBareCall: true,
    why: "a module-level const shadows an import of the same name and captures every unqualified call",
    witness: /^(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\(/m,
  },
  {
    id: "ts/class-method",
    language: "ts",
    template: "class Holder {\n  %N%(value: string): string {\n    return value;\n  }\n}",
    shadowsBareCall: false,
    why: "reachable only as `this.%N%(...)`; a bare call inside the class still resolves to the module scope",
    witness: /^ {2}(?!\s)(?:private |public |protected |static |async )*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::[^{;\n]*)?\{/m,
  },
  {
    id: "ts/class-property-arrow",
    language: "ts",
    template: "class Holder {\n  %N% = (value: string): string => value;\n}",
    shadowsBareCall: false,
    why: "a class field is a property, not a lexical binding; `this.%N%(...)` reaches it and a bare call does not",
    witness: /^ {2}(?!\s)(?:private |public |protected |static |readonly )*[A-Za-z_$][\w$]*\s*(?::[^=\n]*)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=\n]*)?=>/m,
  },
  {
    id: "ts/object-literal-property",
    language: "ts",
    template: "const holder = {\n  %N%: (value: string): string => value,\n};",
    shadowsBareCall: false,
    why: "reachable only as `holder.%N%(...)`",
    witness: /^\s{2,}[A-Za-z_$][\w$]*:\s*(?:async\s*)?\([^)]*\)\s*(?::[^=\n]*)?=>/m,
  },
  {
    id: "ts/aliased-import",
    language: "ts",
    template: 'import { laxSegment as %N% } from "./_shim.js";',
    shadowsBareCall: true,
    why: "an import alias binds the local name outright: every unqualified call in the module reaches the aliased module's function, and the name at the call site is unchanged",
    witness: /^import\s*\{[^}]*\bas\b[^}]*\}\s*from\s*["']/m,
  },
  {
    id: "py/module-def",
    language: "py",
    template: "def %N%(value: str) -> str:\n    return value",
    shadowsBareCall: true,
    why: "a module-level def is the binding every unqualified call resolves to",
    witness: /^def\s+[A-Za-z_][\w]*\s*\(/m,
  },
  {
    id: "py/module-assignment",
    language: "py",
    template: "%N% = lambda value: value",
    shadowsBareCall: true,
    why: "rebinding the module global captures every unqualified call, including calls written before it",
    witness: /^[A-Za-z_][\w]*\s*=\s*lambda\b/m,
  },
  {
    id: "py/class-method-def",
    language: "py",
    template: "class Holder:\n    def %N%(self, value):\n        return value",
    shadowsBareCall: false,
    why: "reachable only as `self.%N%(...)`; a bare call in a method body skips the class namespace",
    witness: /^ {4}def\s+[A-Za-z_][\w]*\s*\(/m,
  },
  {
    id: "py/function-local-def",
    language: "py",
    template: "def caller():\n    def %N%(value):\n        return value",
    shadowsBareCall: true,
    why: "the innermost binding wins; every call in the enclosing function reaches it",
    witness: /^ {4}def\s+[A-Za-z_][\w]*\s*\(/m,
  },
  {
    id: "py/aliased-import",
    language: "py",
    template: "from ._shim import lax_segment as %N%",
    shadowsBareCall: true,
    why: "an import alias binds the module global outright and leaves every call site spelled exactly as before",
    witness: /^(?:from\s+\.?[\w.]+\s+)?import\s+[^\n]*\bas\b/m,
  },
]);

/** Render a form for a concrete symbol. */
export function render(form: BindingForm, symbol: string): string {
  return form.template.replaceAll("%N%", symbol);
}
