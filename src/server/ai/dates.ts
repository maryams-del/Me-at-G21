import { addDays, nextWeekday, isoWeekday } from "@/lib/time";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Deterministic natural-date resolver used by the offline parser and to double-check LLM output.
 * Returns null if no date phrase is present. Relative to `today` in the owner's timezone.
 */
export function resolveDatePhrase(text: string, today: string): string | null {
  const t = text.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(\d{4}-\d{2}-\d{2})\b/))) return m[1];
  if (/\bday before yesterday\b/.test(t)) return addDays(today, -2);
  if (/\byesterday\b/.test(t)) return addDays(today, -1);
  if (/\btoday\b|\btonight\b|\bthis morning\b|\bthis evening\b/.test(t)) return today;
  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if ((m = t.match(/\bin (\d{1,3}) days?\b/))) return addDays(today, Number(m[1]));
  if ((m = t.match(/\b(\d{1,3}) days? ago\b/))) return addDays(today, -Number(m[1]));
  if ((m = t.match(/\bin (\d{1,2}) weeks?\b/))) return addDays(today, 7 * Number(m[1]));
  if ((m = t.match(/\blast (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))) {
    const wd = WEEKDAYS.indexOf(m[1]) + 1;
    const back = (isoWeekday(today) - wd + 7) % 7 || 7;
    return addDays(today, -back);
  }
  if ((m = t.match(/\bnext (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))) {
    const wd = WEEKDAYS.indexOf(m[1]) + 1;
    const d = nextWeekday(addDays(today, 1), wd);
    // "next Thursday" said on Monday → the coming Thursday (common usage); never today
    return d;
  }
  if ((m = t.match(/\b(?:on |by |this |until )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))) {
    const wd = WEEKDAYS.indexOf(m[1]) + 1;
    return nextWeekday(addDays(today, isoWeekday(today) === wd ? 0 : 1), wd);
  }
  const monthRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTHS.join("|")})(?: (\\d{4}))?\\b|\\b(${MONTHS.join("|")}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`);
  if ((m = t.match(monthRe))) {
    const day = Number(m[1] ?? m[5]);
    const month = MONTHS.indexOf(m[2] ?? m[4]) + 1;
    let year = Number(m[3] ?? m[6] ?? today.slice(0, 4));
    const iso = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!m[3] && !m[6] && iso(year) < addDays(today, -180)) year += 1;
    return iso(year);
  }
  return null;
}
