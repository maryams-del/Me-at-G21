/**
 * Time rules
 *  - "Local date" = calendar date in the owner's IANA timezone (default Asia/Riyadh), ISO 'YYYY-MM-DD'.
 *  - Instants are JS Dates / timestamptz (UTC).
 *  - Calendar-month arithmetic clamps to the last valid day: Jan 31 + 1 month = Feb 28/29,
 *    Aug 31 + 6 months = Feb 28/29. It never overflows into the next month.
 *  - Hijri dates use the Umm al-Qura calendar (Intl `islamic-umalqura`), the official Saudi
 *    civil convention. Actual Ramadan/Shawwal start depends on moon sighting and may differ by
 *    a day; the UI says so wherever Hijri dates are used.
 */
import { DateTime } from "luxon";

export const DEFAULT_TZ = "Asia/Riyadh";
export type LocalDate = string; // 'YYYY-MM-DD'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function assertLocalDate(d: string): LocalDate {
  if (!ISO_DATE.test(d) || !DateTime.fromISO(d, { zone: "UTC" }).isValid) throw new Error(`Invalid date: ${d}`);
  return d;
}

export function todayLocal(tz = DEFAULT_TZ, now: Date = new Date()): LocalDate {
  return DateTime.fromJSDate(now).setZone(tz).toISODate()!;
}

const d = (s: LocalDate) => DateTime.fromISO(s, { zone: "UTC" });

export function addDays(date: LocalDate, n: number): LocalDate {
  return d(date).plus({ days: n }).toISODate()!;
}

/** Calendar-month addition with end-of-month clamping (Luxon semantics, verified by tests). */
export function addMonths(date: LocalDate, n: number): LocalDate {
  return d(date).plus({ months: n }).toISODate()!;
}

export function addInterval(date: LocalDate, value: number, unit: "day" | "week" | "month"): LocalDate {
  if (unit === "day") return addDays(date, value);
  if (unit === "week") return addDays(date, value * 7);
  return addMonths(date, value);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round(d(b).diff(d(a), "days").days);
}

/** Wall-clock local date + 'HH:mm' in tz → UTC instant (DST-safe; Riyadh has no DST). */
export function localToInstant(date: LocalDate, time: string, tz = DEFAULT_TZ): Date {
  const [h, m] = time.split(":").map(Number);
  const dt = DateTime.fromISO(date, { zone: tz }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  if (!dt.isValid) throw new Error(`Invalid local time ${date} ${time} ${tz}`);
  return dt.toJSDate();
}

export function instantToLocal(at: Date, tz = DEFAULT_TZ) {
  const dt = DateTime.fromJSDate(at).setZone(tz);
  return { date: dt.toISODate()!, time: dt.toFormat("HH:mm") };
}

/** ISO weekday 1=Mon … 7=Sun */
export function isoWeekday(date: LocalDate): number {
  return d(date).weekday;
}

/** Next date on/after `from` whose ISO weekday matches. */
export function nextWeekday(from: LocalDate, weekday: number): LocalDate {
  const diff = (weekday - isoWeekday(from) + 7) % 7;
  return addDays(from, diff);
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" (the owner's preferred display format). */
export function dmy(date: LocalDate | null | undefined): string {
  if (!date || !ISO_DATE.test(date)) return date ?? "";
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

export function formatLocalDate(date: LocalDate, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(d(date).toJSDate());
}

export function formatInstant(at: Date, tz = DEFAULT_TZ, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }).format(at);
}

/* ─────────────── Hijri (Umm al-Qura) ─────────────── */

const hijriFmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
  year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC",
});

export function toHijri(date: LocalDate): { year: number; month: number; day: number } {
  const parts = hijriFmt.formatToParts(d(date).toJSDate());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value.replace(/\D/g, ""));
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function formatHijri(date: LocalDate): string {
  return new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(d(date).toJSDate());
}

/**
 * Gregorian date for a Hijri (Umm al-Qura) date. Deterministic: estimates then scans ±40 days.
 * If the requested day does not exist in that month (e.g. 30th of a 29-day month), returns the
 * last day of that month.
 */
export function fromHijri(year: number, month: number, day: number): LocalDate {
  // Mean Hijri year = 354.367 days; epoch 1 Muharram 1 AH ≈ 622-07-19 (proleptic Gregorian)
  const approxDays = Math.round((year - 1) * 354.367 + (month - 1) * 29.53 + (day - 1));
  let guess = DateTime.fromISO("0622-07-19", { zone: "UTC" }).plus({ days: approxDays }).toISODate()!;
  let lastInMonth: LocalDate | null = null;
  for (let off = -40; off <= 40; off++) {
    const cand = addDays(guess, off);
    const h = toHijri(cand);
    if (h.year === year && h.month === month) {
      if (h.day === day) return cand;
      lastInMonth = cand;
    }
  }
  if (lastInMonth) return lastInMonth;
  throw new Error(`Cannot resolve Hijri date ${year}-${month}-${day}`);
}

export const HIJRI_MONTHS = [
  "Muharram", "Safar", "Rabiʻ I", "Rabiʻ II", "Jumada I", "Jumada II",
  "Rajab", "Shaʻban", "Ramadan", "Shawwal", "Dhuʻl-Qiʻdah", "Dhuʻl-Hijjah",
];
