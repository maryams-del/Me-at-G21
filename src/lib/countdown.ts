/** Helpers for the big "x days till…" number on entry cards and the reminder dates under it. */

export type Countdown = { n: string; unit: string; tone: "soon" | "calm" | "over" };

const WORD = { expiry: "expiry", due: "due", renewal: "renewal", deadline: "deadline", charge: "next charge" } as const;
export type CountdownKind = keyof typeof WORD;

export function countdown(daysLeft: number | null | undefined, kind: CountdownKind): Countdown | null {
  if (daysLeft === null || daysLeft === undefined) return null;
  const word = WORD[kind];
  if (daysLeft < 0) {
    const d = -daysLeft;
    return { n: String(d), unit: kind === "expiry" ? `day${d === 1 ? "" : "s"} since expiry` : `day${d === 1 ? "" : "s"} overdue`, tone: "over" };
  }
  if (daysLeft === 0) return { n: "Today", unit: kind === "expiry" ? "expires" : `${word} day`, tone: "soon" };
  if (daysLeft <= 99) return { n: String(daysLeft), unit: `day${daysLeft === 1 ? "" : "s"} till ${word}`, tone: daysLeft <= 90 ? "soon" : "calm" };
  if (daysLeft < 730) { const m = Math.round(daysLeft / 30.44); return { n: String(m), unit: `months till ${word}`, tone: "calm" }; }
  const y = Math.round(daysLeft / 365.25);
  return { n: String(y), unit: `years till ${word}`, tone: "calm" };
}

/** "2026-12-14" shifted by n days (n may be negative). */
export function shiftDate(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = from.split("-").map(Number), b = to.split("-").map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/** "14/12" */
export function dayMonth(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Reminder line for a dated entry: the upcoming reminder days, e.g. "14/12, 06/01 · 09:00".
 * `offsets` are the stored negative "days before" numbers (0 = on the day).
 */
export function reminderLine(opts: { enabled: boolean; date: string | null | undefined; offsets: number[]; time?: string | null; today: string }): string {
  if (!opts.enabled) return "Reminders off";
  if (!opts.date) return opts.offsets.length ? `${opts.offsets.length} reminder${opts.offsets.length === 1 ? "" : "s"} set` : "No reminders set";
  const days = [...new Set(opts.offsets)].sort((a, b) => a - b).map((o) => shiftDate(opts.date as string, o)).filter((d) => d >= opts.today);
  if (!days.length) return "No reminders left before the date";
  return days.map(dayMonth).join(", ") + (opts.time ? ` · ${opts.time}` : "");
}

/** Reminder line for repeating entries (subscriptions, routines): "3 days before, and on the day · 09:00". */
export function relativeReminderLine(opts: { enabled: boolean; offsets: number[]; time?: string | null }): string {
  if (!opts.enabled) return "Reminders off";
  const before = [...new Set(opts.offsets.filter((o) => o < 0).map((o) => -o))].sort((a, b) => b - a);
  const onDay = opts.offsets.includes(0);
  const parts = before.length ? [`${before.join(", ")} day${before.length === 1 && before[0] === 1 ? "" : "s"} before`] : [];
  if (onDay) parts.push(before.length ? "and on the day" : "On the day");
  return (parts.join(", ") || "No reminders set") + (opts.time ? ` · ${opts.time}` : "");
}
