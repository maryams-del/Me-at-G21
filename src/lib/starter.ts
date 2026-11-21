/** What a newly invited person starts with: the basic spaces only. They can switch hidden spaces back on in Settings. */
export const STARTER_HIDDEN_SPACES = ["/care/period", "/education/applications"];
/** Routine quick-adds left out for invited people. */
export const STARTER_HIDDEN_TEMPLATES = ["brushes", "bedsheets"];

export function starterSettings(): Record<string, unknown> {
  return {
    spaceOverrides: Object.fromEntries(STARTER_HIDDEN_SPACES.map((h) => [h, { hidden: true }])),
    routineTemplatesOff: STARTER_HIDDEN_TEMPLATES,
  };
}
export function routineTemplatesOffOf(settings: Record<string, unknown> | null | undefined): string[] {
  const v = (settings ?? {}).routineTemplatesOff;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
