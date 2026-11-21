/** Built-in document types. "other" asks for a name, which is then saved as one of your own types. */
export const BUILTIN_DOC_KINDS = [
  { value: "passport", label: "Passport" }, { value: "national_id", label: "National ID / Iqama" }, { value: "transcript", label: "Transcript" },
  { value: "certificate", label: "Certificate" }, { value: "cv", label: "CV" }, { value: "application", label: "Application file" },
  { value: "letter", label: "Official letter" },
];
export const isBuiltinDocKind = (k: string) => k === "other" || BUILTIN_DOC_KINDS.some((b) => b.value === k);
/** The types you've added yourself (e.g. "Car licence"), kept in your settings. */
export function docTypesOf(settings: Record<string, unknown> | null | undefined): string[] {
  const v = (settings ?? {}).docTypes;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
}
/** Built-ins, then your own types, then "Other…" to add a new one. */
export function docKindOptions(custom: string[], withOther = true) {
  const mine = [...new Set(custom.map((c) => c.trim()).filter((c) => c && !isBuiltinDocKind(c)))].sort((a, b) => a.localeCompare(b));
  return [...BUILTIN_DOC_KINDS, ...mine.map((c) => ({ value: c, label: c })), ...(withOther ? [{ value: "other", label: "Other…" }] : [])];
}
export const docKindLabel = (k: string) => BUILTIN_DOC_KINDS.find((b) => b.value === k)?.label ?? (k === "other" ? "Other" : k);
